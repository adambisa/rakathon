import { createHash, randomUUID } from "node:crypto";
import { readFile, rename, rm, writeFile } from "node:fs/promises";

import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { prepareRedcapUpload, type SurgeryRecord, toRedcapRows } from "@prostapaper/contracts";

interface RedcapConfig {
  REDCAP_API_URL: string;
  REDCAP_API_TOKEN?: string | undefined;
  REDCAP_GATEWAY_COOKIE_FILE?: string | undefined;
  REDCAP_RELAY_URL?: string | undefined;
  REDCAP_RELAY_SECRET?: string | undefined;
}

type RedcapFetch = (url: URL, init: RequestInit) => Promise<Response>;

const unconfirmed = "REDCap import could not be confirmed. Reconcile the target before retrying.";

export class RedcapImportUnconfirmed extends Error {
  constructor() {
    super(unconfirmed);
    this.name = "RedcapImportUnconfirmed";
  }
}

const gatewayNames = new Set([
  "BNIS___utm_is1",
  "BNIS___utm_is2",
  "BNIS___utm_is3",
  "BNIS_vid",
  "BNIS_x-bni-jas",
  "x-bni-ci",
  "x-bni-fpc",
  "x-bni-rncf",
]);

/** Server-only client. New records are always allocated by REDCap. */
export class RedcapClient {
  private readonly config: RedcapConfig;
  private readonly fetcher: RedcapFetch;
  private gatewaySource: string | undefined;
  private gatewayCookies: Record<string, string> | undefined;

  constructor(config: RedcapConfig, fetcher: RedcapFetch = fetch) {
    this.config = { ...config };
    this.fetcher = fetcher;
  }

  private async request(parameters: Record<string, string>, signal?: AbortSignal): Promise<unknown> {
    const {
      REDCAP_API_URL: url,
      REDCAP_API_TOKEN: token,
      REDCAP_RELAY_URL: relayUrl,
      REDCAP_RELAY_SECRET: relaySecret,
    } = this.config;
    if (token === undefined || token === "") throw new Error("REDCap is not configured");
    if (
      (relayUrl === undefined) !== (relaySecret === undefined) ||
      (relaySecret !== undefined && !/^[\w-]{40,256}$/.test(relaySecret)) ||
      (relayUrl !== undefined && this.config.REDCAP_GATEWAY_COOKIE_FILE !== undefined)
    ) {
      throw new Error("Invalid REDCap relay configuration");
    }
    const endpoint = new URL(relayUrl ?? url);
    if (
      endpoint.protocol !== "https:" ||
      endpoint.username ||
      endpoint.password ||
      endpoint.search ||
      endpoint.hash
    ) {
      throw new Error("Invalid REDCap API URL");
    }
    let deadline = AbortSignal.timeout(15_000);
    if (signal !== undefined) deadline = AbortSignal.any([deadline, signal]);
    deadline.throwIfAborted();
    const headers: Record<string, string> = { Accept: "application/json" };
    if (relaySecret !== undefined) headers["Authorization"] = `Bearer ${relaySecret}`;
    let gatewayCookies: Record<string, string> | undefined;
    if (this.config.REDCAP_GATEWAY_COOKIE_FILE !== undefined) {
      try {
        const raw = await readFile(this.config.REDCAP_GATEWAY_COOKIE_FILE, {
          encoding: "utf8",
          signal: deadline,
        });
        const cookies = z.record(z.string(), z.string()).parse(JSON.parse(raw));
        if (Object.entries(cookies).some(([name, value]) => !gatewayNames.has(name) || /[\r\n;]/.test(value)))
          throw new Error("Invalid gateway cookies");
        if (raw !== this.gatewaySource) {
          this.gatewaySource = raw;
          this.gatewayCookies = cookies;
        }
        gatewayCookies = this.gatewayCookies ?? cookies;
        headers["Cookie"] = Object.entries(gatewayCookies)
          .map(([name, value]) => `${name}=${value}`)
          .join("; ");
      } catch {
        throw new Error("Invalid REDCap gateway configuration");
      }
    }
    // Never attach credentials to a redirect, log response bodies or retry imports.
    try {
      const response = await this.fetcher(endpoint, {
        method: "POST",
        redirect: "error",
        signal: deadline,
        headers,
        body: new URLSearchParams({ ...parameters, token, format: "json", returnFormat: "json" }),
      });
      if (!response.ok) throw new Error("HTTP failure");
      const result: unknown = await response.json();
      if (result !== null && typeof result === "object" && "error" in result) throw new Error("API failure");

      if (gatewayCookies !== undefined)
        await this.refreshGateway(gatewayCookies, response.headers.getSetCookie());

      return result;
    } catch {
      // Remote errors may contain the token or clinical content.
      throw new Error("REDCap request failed. Check permissions and gateway access.");
    }
  }

  private async refreshGateway(cookies: Record<string, string>, setCookies: string[]): Promise<void> {
    const path = this.config.REDCAP_GATEWAY_COOKIE_FILE;
    if (path === undefined || setCookies.length === 0) return;
    const updated = new Map(Object.entries(this.gatewayCookies ?? cookies));
    for (const header of setCookies) {
      const pair = header.split(";", 1)[0] ?? "";
      const separator = pair.indexOf("=");
      const name = pair.slice(0, separator);
      const value = pair.slice(separator + 1);
      if (separator < 0 || !gatewayNames.has(name) || /[\r\n;]/.test(value)) continue;
      if (value === "" || /;\s*max-age=0(?:;|$)/i.test(header)) updated.delete(name);
      else updated.set(name, value);
    }
    const next = Object.fromEntries(updated);
    // Keep rotations usable even with read-only or single-file secret mounts.
    this.gatewayCookies = next;
    const raw = JSON.stringify(next);
    const temporary = `${path}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, raw, { mode: 0o600, flag: "wx" });
      await rename(temporary, path);
      this.gatewaySource = raw;
    } catch {
      // Cookie persistence must not turn a confirmed import into an unconfirmed one.
    } finally {
      try {
        await rm(temporary, { force: true });
      } catch {
        // Best-effort cleanup; the temporary file contains only private gateway cookies.
      }
    }
  }

  async checkProject(signal?: AbortSignal): Promise<void> {
    const project = z
      .object({ project_id: z.coerce.number(), record_autonumbering_enabled: z.coerce.number() })
      .safeParse(await this.request({ content: "project" }, signal));
    if (!project.success || project.data.project_id !== 64) {
      throw new Error("REDCap token must belong to project 64");
    }
    if (project.data.record_autonumbering_enabled !== 1)
      throw new Error("REDCap automatic record numbering must be enabled");
  }

  async upload(
    record: SurgeryRecord,
    submissionId: string,
    signal?: AbortSignal,
  ): Promise<{ recordId: string }> {
    const { data } = prepareRedcapSubmission(record, submissionId);
    await this.checkProject(signal);
    signal?.throwIfAborted();
    try {
      const result = await this.request(
        {
          content: "record",
          action: "import",
          type: "flat",
          overwriteBehavior: "normal",
          forceAutoNumber: "true",
          dateFormat: "YMD",
          returnContent: "ids",
          data,
        },
        signal,
      );
      const ids = z.array(z.string().trim().min(1)).safeParse(result);
      if (!ids.success || ids.data.length !== 1) throw new Error("Unexpected IDs");
      const recordId = ids.data[0];
      if (recordId === undefined) throw new Error("Missing record ID");

      return { recordId };
    } catch {
      // A timeout or malformed reply can occur after REDCap committed the import.
      throw new RedcapImportUnconfirmed();
    }
  }
}

export function prepareRedcapSubmission(
  record: SurgeryRecord,
  submissionId: string,
): { data: string; payloadHash: string } {
  // Serialize once before network work; a caller cannot mutate the payload in flight.
  const prepared = prepareRedcapUpload(toRedcapRows(record, submissionId));
  if (prepared.errors.length > 0)
    throw new TRPCError({ code: "BAD_REQUEST", message: prepared.errors.join("\n") });
  const rows = prepared.rows.map((row) =>
    row["redcap_repeat_instrument"] === "surgery_c61_resected_lesion"
      ? { ...row, surgery_c61_resected_lesion_complete: "2" }
      : row,
  );
  const data = JSON.stringify(rows);

  return { data, payloadHash: createHash("sha256").update(data).digest("hex") };
}
