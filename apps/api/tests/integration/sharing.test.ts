import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { setImmediate } from "node:timers/promises";

import { TRPCError } from "@trpc/server";
import { eq, sql } from "drizzle-orm";

import { user } from "@prostapaper/db/auth-schema";
import { caseAuditEvents, cases, documents } from "@prostapaper/db/schema";

import { CaseService } from "#cases/service";
import { DatabaseService } from "#database/service";
import { DocumentService } from "#documents/service";
import { CaseIngestTrigger } from "#ingest/trigger";
import { integration } from "#integration/env";
import { RedcapClient } from "#redcap/client";
import { ObjectStorageService } from "#storage/service";

class Storage extends ObjectStorageService {
  constructor() {
    super("eu-central-1", "sharing-test");
  }
  override async presignDownload(key: string) {
    await setImmediate();

    return `https://storage.invalid/${key}`;
  }
  override async head() {
    await setImmediate();

    return { versionId: "source-v1", size: 100 };
  }
  override async presignUpload() {
    await setImmediate();

    return { url: "https://storage.invalid/upload", fields: {} };
  }
}

class Trigger extends CaseIngestTrigger {
  constructor() {
    super("eu-central-1", "sharing-test");
  }
  override async caseSubmitted() {
    await setImmediate();

    return;
  }
}

const denied = (error: unknown) => error instanceof TRPCError && error.code === "NOT_FOUND";

await test("case sharing grants inherited access, separates roles, and attributes reviewer actions", async () => {
  assert.ok(integration.COMPOSE_PROJECT_NAME.startsWith("prostapaper-test-"));
  const database = new DatabaseService();
  try {
    await database.migrate("../../packages/db/migrations");
    const [owner, reviewer, viewer, stranger] = [
      randomUUID(),
      randomUUID(),
      randomUUID(),
      randomUUID(),
    ] as const;

    await database.db
      .insert(user)
      .values(
        [owner, reviewer, viewer, stranger].map((id) => ({
          id,
          name: `Sharing ${id}`,
          email: `${id}@example.test`,
          displayEmail: `${id}@example.test`,
        })),
      )
      .returning({ id: user.id });
    const storage = new Storage();
    const service = new CaseService(storage, database, {
      ingest: new Trigger(),
      redcap: new RedcapClient({ REDCAP_API_URL: "https://redcap.invalid/api/" }),
    });
    const files = new DocumentService(storage, database);
    const item = await service.create("Shared demo", owner);
    assert.equal(item.accessRole, "owner");
    assert.deepEqual(item.owner, {
      id: owner,
      name: `Sharing ${owner}`,
      email: `${owner}@example.test`,
      image: null,
    });
    const directory = await service.sharing(item.id, owner);
    assert.ok(directory.some((person) => person.id === reviewer && person.role === null));
    await assert.rejects(service.sharing(item.id, stranger), denied);
    await assert.rejects(
      service.addAccess({ caseId: item.id, userId: stranger, role: "reviewer" }, stranger),
      denied,
    );
    await Promise.all([
      service.addAccess({ caseId: item.id, userId: reviewer, role: "reviewer" }, owner),
      service.addAccess({ caseId: item.id, userId: viewer, role: "viewer" }, owner),
    ]);
    // Adding again never changes a previously granted role.
    await service.addAccess({ caseId: item.id, userId: viewer, role: "reviewer" }, owner);
    await service.addAccess({ caseId: item.id, userId: owner, role: "viewer" }, owner);
    const reviewerCase = await service.findById(item.id, reviewer);
    assert.equal(reviewerCase.accessRole, "reviewer");
    const viewerCase = await service.findById(item.id, viewer);
    assert.equal(viewerCase.accessRole, "viewer");
    assert.deepEqual(reviewerCase.owner, item.owner);
    assert.deepEqual(viewerCase.owner, item.owner);
    const viewerCases = await service.list(viewer, 50);
    assert.deepEqual(viewerCases.cases.find((row) => row.id === item.id)?.owner, item.owner);
    const strangerCases = await service.list(stranger, 50);
    assert.ok(!strangerCases.cases.some((row) => row.id === item.id));
    await assert.rejects(service.sharing(item.id, viewer), denied);
    await assert.rejects(
      service.addAccess({ caseId: item.id, userId: stranger, role: "viewer" }, reviewer),
      denied,
    );
    await assert.rejects(service.findById(item.id, stranger), denied);

    const documentId = randomUUID();
    const registration = {
      caseId: item.id,
      documentId,
      kind: "text_description" as const,
      file: { filename: "report.jpg", contentType: "image/jpeg" as const, size: 100 },
    };
    await assert.rejects(files.register(registration, viewer), denied);
    await files.register(registration, reviewer);
    const ownerDocument = await files.findById(documentId, owner);
    assert.equal(ownerDocument.uploadedBy.id, reviewer);
    const viewerDocument = await files.findById(documentId, viewer);
    assert.equal(viewerDocument.id, documentId);
    const viewerDocuments = await files.list(viewer);
    assert.ok(viewerDocuments.some((row) => row.id === documentId));
    await assert.rejects(files.findById(documentId, stranger), denied);
    await assert.rejects(files.presign(documentId, viewer), denied);
    await files.presign(documentId, reviewer);
    await assert.rejects(service.submit(item.id, viewer), denied);
    await service.submit(item.id, reviewer);
    await database.db
      .update(documents)
      .set({
        extractionStartedAt: sql`now()`,
        extractedAt: sql`now()`,
        extractionResultKey: "extraction.json",
      })
      .where(eq(documents.id, documentId));
    await database.db
      .update(cases)
      .set({ mappingStartedAt: sql`now()`, mappedAt: sql`now()`, mappingResultKey: "mapping.json" })
      .where(eq(cases.id, item.id));
    const reviewQueue = await service.reviewQueue(reviewer);
    assert.ok(reviewQueue.some((row) => row.id === item.id));
    await Promise.all(
      [owner, reviewer, viewer].map(async (actor) => {
        const sourceTicket = await files.presignGet(documentId, actor);
        assert.ok(sourceTicket.url.includes("/source"));
        const extractionTicket = await files.presignGet(documentId, actor, "extraction");
        assert.ok(extractionTicket.url.includes("extraction.json"));
        const mappingTicket = await service.presignMapping(item.id, actor);
        assert.ok(mappingTicket.url.includes("mapping.json"));
      }),
    );
    await assert.rejects(files.presignGet(documentId, stranger), denied);
    await assert.rejects(files.presignGet(documentId, stranger, "extraction"), denied);
    await assert.rejects(service.presignMapping(item.id, stranger), denied);
    await assert.rejects(service.startReview(item.id, viewer), denied);
    await service.startReview(item.id, reviewer);
    await assert.rejects(service.approve(item.id, viewer), denied);
    await service.approve(item.id, reviewer);
    const [approved] = await database.db.select().from(cases).where(eq(cases.id, item.id));
    assert.equal(approved?.approvedBy, reviewer);
    await assert.rejects(service.reopen(item.id, viewer), denied);
    await assert.rejects(service.sendToRedcap(item.id, reviewer), denied);
    await assert.rejects(service.sendToRedcap(item.id, viewer), denied);
    await service.reopen(item.id, reviewer);
    const events = await database.db
      .select()
      .from(caseAuditEvents)
      .where(eq(caseAuditEvents.caseId, item.id));
    assert.deepEqual(
      events.map((event) => [event.kind, event.actorId]),
      [
        ["approved", reviewer],
        ["reopened", reviewer],
      ],
    );
    const members = await service.sharing(item.id, owner);
    assert.equal(members.find((person) => person.id === owner)?.role, "owner");
    assert.equal(members.find((person) => person.id === viewer)?.role, "viewer");
  } finally {
    await database.close();
  }
});
