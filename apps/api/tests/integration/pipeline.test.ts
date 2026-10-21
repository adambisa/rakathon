import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { setImmediate } from "node:timers/promises";

import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";

import { user } from "@prostapaper/db/auth-schema";
import { completeMapping, startMapping } from "@prostapaper/db/cases";
import { completeExtraction, listCaseDocuments, startExtraction } from "@prostapaper/db/documents";
import { withCaseLock } from "@prostapaper/db/locking";

import { CaseService } from "#cases/service";
import { DatabaseService } from "#database/service";
import { DocumentService } from "#documents/service";
import { CaseIngestTrigger } from "#ingest/trigger";
import { integration } from "#integration/env";
import { ObjectStorageService } from "#storage/service";

class Storage extends ObjectStorageService {
  readonly objects = new Map<string, { versionId: string; size: number }>();
  onHead: (() => Promise<void>) | undefined;

  constructor() {
    super("eu-central-1", "pipeline-test-bucket");
  }

  override async writeSample(key: string, body: Uint8Array): Promise<void> {
    await setImmediate();
    assert.equal(body[0], 0xff);
    assert.equal(body[1], 0xd8);
    this.objects.set(key, { versionId: "sample-v1", size: body.length });
  }

  override async head(key: string) {
    await setImmediate();
    await this.onHead?.();

    return this.objects.get(key);
  }
}

class Trigger extends CaseIngestTrigger {
  calls = 0;
  fail = false;

  constructor() {
    super("eu-central-1", "pipeline-test-ingest");
  }

  override async caseSubmitted(): Promise<void> {
    await setImmediate();
    this.calls += 1;
    if (this.fail) throw new Error("Invoke unavailable");
  }
}

async function setup(database: DatabaseService) {
  assert.ok(integration.COMPOSE_PROJECT_NAME.startsWith("prostapaper-test-"));
  const [owner] = await database.db
    .select({ id: user.id })
    .from(user)
    .where(eq(user.email, "reviewer@prostapaper.local"));
  assert.ok(owner);
  const storage = new Storage();
  const trigger = new Trigger();
  const service = new CaseService(storage, database, { ingest: trigger });
  const documents = new DocumentService(storage, database);
  const item = await service.create("Pipeline integration", owner.id);
  const documentId = randomUUID();
  await documents.register(
    {
      caseId: item.id,
      documentId,
      kind: "text_description",
      file: { filename: "report.jpg", contentType: "image/jpeg", size: 12 },
    },
    owner.id,
  );

  return { storage, trigger, service, documents, item, documentId, ownerId: owner.id };
}

await test("submit validates objects, commits pinned versions before invoke, and retries a queued case", async () => {
  const database = new DatabaseService();
  try {
    const { storage, trigger, service, item, documentId, ownerId } = await setup(database);
    const submit = async () => service.submit(item.id, ownerId);
    const rejects = async (code: string) =>
      assert.rejects(submit(), (error: unknown) => error instanceof TRPCError && error.code === code);
    await rejects("PRECONDITION_FAILED");
    assert.equal(trigger.calls, 0);
    storage.objects.set(`uploads/${documentId}/source`, { versionId: "source-v1", size: 13 });
    await rejects("CONFLICT");
    storage.objects.set(`uploads/${documentId}/source`, { versionId: "source-v1", size: 12 });
    trigger.fail = true;
    await rejects("INTERNAL_SERVER_ERROR");
    const queued = await service.findById(item.id, ownerId);
    assert.equal(queued.status, "queued");
    assert.equal(queued.documents[0]?.status, "uploaded");
    const [before] = await listCaseDocuments(database.db, item.id);
    assert.ok(before?.uploadedAt);
    assert.equal(before.sourceVersionId, "source-v1");
    trigger.fail = false;
    storage.objects.set(`uploads/${documentId}/source`, { versionId: "late-v2", size: 99 });
    storage.onHead = async () => {
      await setImmediate();
      throw new Error("Queued retries must not access S3");
    };
    await submit();
    const [after] = await listCaseDocuments(database.db, item.id);
    assert.equal(after?.sourceVersionId, "source-v1");
    assert.deepEqual(after.uploadedAt, before.uploadedAt);
    assert.equal(trigger.calls, 2);
    await startExtraction(database.db, documentId);
    const extracting = await service.findById(item.id, ownerId);
    assert.equal(extracting.documents[0]?.status, "extracting");
    await completeExtraction(database.db, documentId, `derived/${documentId}/document.json`);
    let runs = 0;
    const map = async () =>
      withCaseLock(database.db, `mapping:${item.id}`, async () => {
        if (!(await startMapping(database.db, item.id))) return;
        runs += 1;
        const mapping = await service.findById(item.id, ownerId);
        assert.equal(mapping.status, "mapping");
        await assert.rejects(
          withCaseLock(database.db, `mapping:${item.id}`.toUpperCase(), async () => {
            await setImmediate();
            runs += 1;
          }),
          /Case processing lock is busy/,
        );
        await completeMapping(database.db, item.id, `mapping/${item.id}/record.json`);
      });
    await map();
    await map();
    assert.equal(runs, 1);
    const ready = await service.findById(item.id, ownerId);
    assert.equal(ready.status, "ready_for_review");
    assert.equal(ready.documents[0]?.status, "extracted");
  } finally {
    await database.close();
  }
});

await test("a document registered during HEAD cannot slip past submission", async () => {
  const database = new DatabaseService();
  try {
    const { storage, trigger, service, documents, item, documentId, ownerId } = await setup(database);
    storage.objects.set(`uploads/${documentId}/source`, { versionId: "source-v1", size: 12 });
    storage.onHead = async () => {
      storage.onHead = undefined;
      await documents.register(
        {
          caseId: item.id,
          documentId: randomUUID(),
          kind: "sector_map",
          file: { filename: "sheet.jpg", contentType: "image/jpeg", size: 12 },
        },
        ownerId,
      );
    };
    await assert.rejects(
      service.submit(item.id, ownerId),
      (error: unknown) => error instanceof TRPCError && error.code === "PRECONDITION_FAILED",
    );
    const draft = await service.findById(item.id, ownerId);
    assert.equal(draft.status, "draft");
    assert.equal(trigger.calls, 0);
  } finally {
    await database.close();
  }
});

await test("case locks are released on failure and permit a new attempt", async () => {
  const database = new DatabaseService();
  try {
    const key = `mapping:${randomUUID()}`;
    let blockedRuns = 0;
    await assert.rejects(
      withCaseLock(database.db, key, async () => {
        await assert.rejects(
          withCaseLock(database.db, key, async () => {
            await setImmediate();
            blockedRuns += 1;
          }),
          /Case processing lock is busy/,
        );
        throw new Error("Mapping failed");
      }),
      /Mapping failed/,
    );
    assert.equal(blockedRuns, 0);
    let retried = false;
    await withCaseLock(database.db, key, async () => {
      await setImmediate();
      retried = true;
    });
    assert.equal(retried, true);
  } finally {
    await database.close();
  }
});

await test("bundled examples register both images and enter the normal ingestion flow", async () => {
  const database = new DatabaseService();
  try {
    const { service, documents, ownerId, trigger } = await setup(database);
    const created = await service.createSample("0005", ownerId, documents);
    const submitted = await service.submit(created.id, ownerId);
    assert.equal(submitted.name, "Rakathon 5");
    assert.equal(submitted.status, "queued");
    assert.equal(submitted.documents.length, 2);
    assert.equal(trigger.calls, 1);
    const stored = await listCaseDocuments(database.db, created.id);
    assert.deepEqual(stored.map((doc) => doc.kind).toSorted(), ["sector_map", "text_description"]);
    assert.ok(stored.every((doc) => doc.sourceVersionId === "sample-v1" && doc.uploadedAt !== null));
  } finally {
    await database.close();
  }
});
