import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { setImmediate, setTimeout as delay } from "node:timers/promises";

import { TRPCError } from "@trpc/server";
import { eq, sql } from "drizzle-orm";

import { user } from "@prostapaper/db/auth-schema";
import { caseAuditEvents, cases, documents } from "@prostapaper/db/schema";

import { CaseService } from "#cases/service";
import { DatabaseService } from "#database/service";
import { fixture } from "#fixtures/surgery";
import { CaseIngestTrigger } from "#ingest/trigger";
import { integration } from "#integration/env";
import { RedcapClient, RedcapImportUnconfirmed } from "#redcap/client";
import { ObjectStorageService } from "#storage/service";

function deferred() {
  let release: (() => void) | undefined;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });

  return {
    promise,
    resolve: () => {
      assert.ok(release);
      release();
    },
  };
}

class Storage extends ObjectStorageService {
  fail = false;
  slow = false;
  onRead: (() => Promise<void>) | undefined;
  constructor() {
    super("eu-central-1", "export-tests");
  }
  override async readJson(_key: string, signal?: AbortSignal): Promise<unknown> {
    if (this.slow) await delay(1000, undefined, { signal });
    await setImmediate();
    await this.onRead?.();
    if (this.fail) throw new Error("S3 unavailable");

    return { record: fixture() };
  }
}

class Redcap extends RedcapClient {
  calls = 0;
  started = deferred();
  outcome: "success" | "preflight" | "unconfirmed" = "success";
  wait: Promise<void> = Promise.resolve();
  constructor() {
    super({ REDCAP_API_URL: "https://redcap.invalid/api/" });
  }
  override async upload() {
    this.calls++;
    this.started.resolve();
    await this.wait;
    if (this.outcome === "preflight") throw new Error("Project check failed");
    if (this.outcome === "unconfirmed") throw new RedcapImportUnconfirmed();

    return { recordId: randomUUID() };
  }
}

const conflict = (error: unknown) => error instanceof TRPCError && error.code === "CONFLICT";

await test("REDCap workflow persists receipts, serializes sends, enforces ownership and locks exports", async () => {
  // Run only against an isolated test database; no clinical service or real API is contacted.
  assert.ok(integration.COMPOSE_PROJECT_NAME.startsWith("prostapaper-test-"));
  const database = new DatabaseService();
  const ownerId = randomUUID();
  const otherId = randomUUID();
  try {
    await database.migrate("../../packages/db/migrations");
    await database.db
      .insert(user)
      .values([
        {
          id: ownerId,
          name: "Export owner",
          email: `${ownerId}@example.test`,
          displayEmail: `${ownerId}@example.test`,
        },
        {
          id: otherId,
          name: "Other owner",
          email: `${otherId}@example.test`,
          displayEmail: `${otherId}@example.test`,
        },
      ])
      .returning({ id: user.id });
    const storage = new Storage();
    const redcap = new Redcap();
    const service = new CaseService(storage, database, {
      ingest: new CaseIngestTrigger("eu-central-1", "unused"),
      redcap,
    });
    const createApproved = async (name = "Export test") => {
      const item = await service.create(name, ownerId);
      const docId = randomUUID();
      await database.db
        .insert(documents)
        .values({
          id: docId,
          caseId: item.id,
          uploadedBy: ownerId,
          filename: "report.jpg",
          sizeBytes: 12,
          contentType: "image/jpeg",
          storageBucket: "export-tests",
          storageKey: `source/${docId}`,
          kind: "text_description",
          uploadedAt: sql`now()`,
          sourceVersionId: "v1",
        })
        .returning({ id: documents.id });
      await database.db
        .update(cases)
        .set({ submittedAt: sql`now()` })
        .where(eq(cases.id, item.id));
      await database.db
        .update(documents)
        .set({
          extractionStartedAt: sql`now()`,
          extractedAt: sql`now()`,
          extractionResultKey: `extracted/${docId}`,
        })
        .where(eq(documents.id, docId));
      await database.db
        .update(cases)
        .set({
          mappingStartedAt: sql`now()`,
          mappedAt: sql`now()`,
          mappingResultKey: `mapping/${item.id}/record.json`,
          reviewStartedAt: sql`now()`,
        })
        .where(eq(cases.id, item.id));

      return service.approve(item.id, ownerId);
    };
    const item = await createApproved();
    await assert.rejects(
      service.sendToRedcap(item.id, otherId),
      (e: unknown) => e instanceof TRPCError && e.code === "NOT_FOUND",
    );
    assert.equal(redcap.calls, 0);
    const reopened = await service.reopen(item.id, ownerId);
    assert.equal(reopened.status, "in_review");
    await assert.rejects(service.sendToRedcap(item.id, ownerId), conflict);
    await service.approve(item.id, ownerId);
    const gate = deferred();
    redcap.wait = gate.promise;
    const sending = service.sendToRedcap(item.id, ownerId);
    await redcap.started.promise;
    await assert.rejects(service.sendToRedcap(item.id, ownerId), conflict);
    await assert.rejects(service.reopen(item.id, ownerId), conflict);
    gate.resolve();
    const exported = await sending;
    assert.equal(redcap.calls, 1);
    assert.equal(exported.status, "exported");
    assert.notEqual(exported.redcapRecordId, null);
    assert.notEqual(exported.exportedAt, null);
    await assert.rejects(
      database.db.update(cases).set({ name: "Changed after export" }).where(eq(cases.id, item.id)),
    );
    await assert.rejects(
      database.db.update(cases).set({ redcapRecordId: "replacement" }).where(eq(cases.id, item.id)),
    );
    await assert.rejects(service.sendToRedcap(item.id, ownerId), conflict);
    await assert.rejects(service.reopen(item.id, ownerId), conflict);
    const ownerExports = await service.exports(ownerId);
    assert.equal(ownerExports.length, 1);
    const otherExports = await service.exports(otherId);
    assert.equal(otherExports.length, 0);

    const preflight = await createApproved();
    redcap.outcome = "preflight";
    await assert.rejects(service.sendToRedcap(preflight.id, ownerId));
    const retryable = await service.findById(preflight.id, ownerId);
    assert.equal(retryable.status, "approved");
    redcap.outcome = "success";
    storage.fail = true;
    const before = redcap.calls;
    await assert.rejects(service.sendToRedcap(preflight.id, ownerId));
    assert.equal(redcap.calls, before);
    const storageFailure = await service.findById(preflight.id, ownerId);
    assert.equal(storageFailure.status, "approved");
    storage.fail = false;
    const retried = await service.sendToRedcap(preflight.id, ownerId);
    assert.equal(retried.status, "exported");

    const uncertain = await createApproved();
    redcap.outcome = "unconfirmed";
    await assert.rejects(service.sendToRedcap(uncertain.id, ownerId));
    const locked = await service.findById(uncertain.id, ownerId);
    assert.equal(locked.status, "exporting");
    assert.equal(locked.exportUnconfirmed, true);
    await assert.rejects(service.sendToRedcap(uncertain.id, ownerId), conflict);
    await assert.rejects(service.reopen(uncertain.id, ownerId), conflict);
    const finalExports = await service.exports(ownerId);
    assert.equal(finalExports.length, 2);

    const timedOut = await createApproved();
    const boundedService = new CaseService(storage, database, {
      ingest: new CaseIngestTrigger("eu-central-1", "unused"),
      redcap,
      exportTimeoutMs: 20,
    });
    storage.slow = true;
    const beforeTimeout = redcap.calls;
    await assert.rejects(boundedService.sendToRedcap(timedOut.id, ownerId));
    storage.slow = false;
    const afterTimeout = await service.findById(timedOut.id, ownerId);
    assert.equal(afterTimeout.status, "approved");
    assert.equal(redcap.calls, beforeTimeout);

    const history = await database.db
      .select()
      .from(caseAuditEvents)
      .where(eq(caseAuditEvents.caseId, item.id));
    assert.equal(history.filter((event) => event.kind === "approved").length, 2);
    assert.equal(history.filter((event) => event.kind === "reopened").length, 1);
    const confirmed = history.find((event) => event.kind === "export_confirmed");
    assert.ok(confirmed);
    assert.equal(confirmed.actorId, ownerId);
    assert.equal(confirmed.redcapRecordId, exported.redcapRecordId);
    assert.match(confirmed.payloadHash ?? "", /^[a-f0-9]{64}$/);
    assert.notEqual(confirmed.attemptId, null);
    await assert.rejects(
      database.db
        .update(caseAuditEvents)
        .set({ kind: "reopened" })
        .where(eq(caseAuditEvents.id, confirmed.id)),
    );
    await assert.rejects(database.db.delete(caseAuditEvents).where(eq(caseAuditEvents.id, confirmed.id)));

    const receiptFailure = await createApproved("Receipt failure");
    redcap.outcome = "success";
    await database.db
      .execute(sql`CREATE FUNCTION app.reject_test_receipt() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.name = 'Receipt failure' AND NEW.exported_at IS NOT NULL THEN RAISE EXCEPTION 'Synthetic receipt failure'; END IF; RETURN NEW; END $$`);
    await database.db.execute(
      sql`CREATE TRIGGER reject_test_receipt BEFORE UPDATE ON app.cases FOR EACH ROW EXECUTE FUNCTION app.reject_test_receipt()`,
    );
    try {
      await assert.rejects(service.sendToRedcap(receiptFailure.id, ownerId));
      const failureHistory = await database.db
        .select()
        .from(caseAuditEvents)
        .where(eq(caseAuditEvents.caseId, receiptFailure.id));
      const retained = failureHistory.find((event) => event.kind === "export_confirmed");
      assert.ok(retained?.redcapRecordId !== null && retained?.redcapRecordId !== undefined);
      const failedCase = await service.findById(receiptFailure.id, ownerId);
      assert.equal(failedCase.exportUnconfirmed, true);
      await assert.rejects(service.sendToRedcap(receiptFailure.id, ownerId), conflict);
    } finally {
      await database.db.execute(sql`DROP TRIGGER reject_test_receipt ON app.cases`);
      await database.db.execute(sql`DROP FUNCTION app.reject_test_receipt()`);
    }

    const replaced = await createApproved();
    const replacementAttempt = randomUUID();
    const beforeReplacement = redcap.calls;
    storage.onRead = async () => {
      storage.onRead = undefined;
      await database.db
        .update(cases)
        .set({ exportStartedAt: null, exportAttemptId: null, exportPayloadHash: null })
        .where(eq(cases.id, replaced.id));
      await database.db
        .update(cases)
        .set({ exportStartedAt: sql`now()`, exportAttemptId: replacementAttempt })
        .where(eq(cases.id, replaced.id));
    };
    await assert.rejects(service.sendToRedcap(replaced.id, ownerId));
    assert.equal(redcap.calls, beforeReplacement);
    const [replacement] = await database.db.select().from(cases).where(eq(cases.id, replaced.id));
    assert.equal(replacement?.exportAttemptId, replacementAttempt);
    assert.equal(replacement.status, "exporting");

    const interrupted = await createApproved();
    await database.db
      .update(cases)
      .set({ exportStartedAt: sql`now()` })
      .where(eq(cases.id, interrupted.id));
    await assert.rejects(service.sendToRedcap(interrupted.id, ownerId), conflict);
  } finally {
    await database.close();
  }
});
