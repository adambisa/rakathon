import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { test } from "node:test";
import { setImmediate } from "node:timers/promises";

import { TRPCError } from "@trpc/server";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";

import type { ReviewFieldRef, ReviewSave, ReviewSectionRef, SurgeryRecord } from "@prostapaper/contracts";
import { user } from "@prostapaper/db/auth-schema";
import { caseAuditEvents, caseReviews, cases, documents, reviewRevisions } from "@prostapaper/db/schema";

import { CaseService } from "#cases/service";
import { DatabaseService } from "#database/service";
import { mappingEvidenceFixture } from "#fixtures/mapping";
import { fixture } from "#fixtures/surgery";
import { CaseIngestTrigger } from "#ingest/trigger";
import { integration } from "#integration/env";
import { prepareRedcapSubmission, RedcapClient } from "#redcap/client";
import { ReviewService } from "#review/service";
import { ObjectStorageService, type StoredObjectIdentity } from "#storage/service";

class Storage extends ObjectStorageService {
  readonly objects = new Map<string, { raw: string; versionId: string }>();
  readonly versions = new Map<string, { raw: string; versionId: string }>();
  reads = 0;
  writes = 0;
  failWrite = false;
  afterWrite: (() => Promise<void>) | undefined;
  constructor() {
    super("eu-central-1", "review-tests");
  }
  put(key: string, value: unknown) {
    const object = { raw: JSON.stringify(value), versionId: randomUUID() };
    this.objects.set(key, object);
    this.versions.set(`${key}:${object.versionId}`, object);

    return { versionId: object.versionId, sha256: createHash("sha256").update(object.raw).digest("hex") };
  }
  override async readVersionedJson(key: string) {
    const object = this.objects.get(key);
    assert.ok(object);
    const identity = {
      versionId: object.versionId,
      sha256: createHash("sha256").update(object.raw).digest("hex"),
    };

    return { value: await this.readJson(key, undefined, identity), identity };
  }
  override async writeJson(key: string, value: unknown) {
    this.writes++;
    await setImmediate();
    if (this.failWrite) throw new Error("Synthetic storage failure");
    assert.equal(this.objects.has(key), false);
    const identity = this.put(key, value);
    await this.afterWrite?.();

    return identity;
  }
  override async readJson(
    key: string,
    _signal?: AbortSignal,
    identity?: StoredObjectIdentity,
  ): Promise<unknown> {
    this.reads++;
    await setImmediate();
    let object = this.objects.get(key);
    if (identity !== undefined && object?.versionId !== identity.versionId)
      object = this.versions.get(`${key}:${identity.versionId}`);
    assert.ok(object, "Referenced artifact must exist");
    if (identity !== undefined) {
      assert.equal(identity.versionId, object.versionId);
      assert.equal(identity.sha256, createHash("sha256").update(object.raw).digest("hex"));
    }

    return JSON.parse(object.raw);
  }
}

class RecordingRedcap extends RedcapClient {
  record: SurgeryRecord | undefined;
  attemptId: string | undefined;
  data: string | undefined;
  constructor() {
    super(
      { REDCAP_API_URL: "https://redcap.invalid/api/", REDCAP_API_TOKEN: "synthetic-token".repeat(3) },
      async (_input, init) => {
        await setImmediate();
        assert.ok(init.body instanceof URLSearchParams);
        if (init.body.get("content") === "project")
          return Response.json({ project_id: 64, record_autonumbering_enabled: 1 });
        this.data = init.body.get("data") ?? undefined;

        return Response.json([randomUUID()]);
      },
    );
  }
  override async upload(record: SurgeryRecord, attemptId: string) {
    await setImmediate();
    this.record = structuredClone(record);
    this.attemptId = attemptId;

    return super.upload(record, attemptId);
  }
}

const hasCode = (code: TRPCError["code"]) => (error: unknown) =>
  error instanceof TRPCError && error.code === code;

await test("saved review revisions preserve corrections and identities, serialize saves and cannot bypass approval", async (t) => {
  assert.ok(integration.COMPOSE_PROJECT_NAME.startsWith("prostapaper-test-"));
  const database = new DatabaseService();
  const ownerId = randomUUID();
  const otherId = randomUUID();
  const reviewerId = randomUUID();
  const viewerId = randomUUID();
  const storage = new Storage();
  const redcap = new RecordingRedcap();
  const service = new CaseService(storage, database, {
    ingest: new CaseIngestTrigger("eu-central-1", "unused"),
    redcap,
  });
  const reviews = new ReviewService(storage, database);
  try {
    await database.migrate("../../packages/db/migrations");
    await database.db
      .insert(user)
      .values(
        [ownerId, otherId, reviewerId, viewerId].map((id) => ({
          id,
          name: "Synthetic reviewer",
          email: `${id}@example.test`,
          displayEmail: `${id}@example.test`,
        })),
      )
      .returning({ id: user.id });
    const create = async (record = fixture()) => {
      const item = await service.create("Synthetic two-lesion review", ownerId);
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
          storageBucket: "review-tests",
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
          extractionResultKey: `derived/${docId}`,
        })
        .where(eq(documents.id, docId));
      const mappingIdentity = `mapping/${item.id}/record.json`;
      await database.db
        .update(cases)
        .set({ mappingStartedAt: sql`now()`, mappedAt: sql`now()`, mappingResultKey: mappingIdentity })
        .where(eq(cases.id, item.id));
      const lesion = record.lesions[0];
      assert.ok(lesion);
      record.lesions.push({ ...structuredClone(lesion), sur_prostate_regions: ["pzpl_base_rs"] });
      storage.put(mappingIdentity, { record });
      await service.startReview(item.id, ownerId);

      return { caseId: item.id, mappingIdentity };
    };
    const item = await create();
    const request = (expectedRevision: number, operations: ReviewSave["operations"]): ReviewSave => ({
      ...item,
      expectedRevision,
      requestId: randomUUID(),
      operations,
    });
    const revision = async () => {
      const workspace = await reviews.get(item.caseId, ownerId);

      return workspace.revision;
    };
    const revisionCount = async () => {
      const rows = await database.db
        .select()
        .from(reviewRevisions)
        .where(eq(reviewRevisions.caseId, item.caseId));

      return rows.length;
    };
    const first = request(0, [
      {
        kind: "update_lesion",
        lesionId: "lesion-1",
        changes: { lesion_y_mm: 9, hist_type_sur: null },
      },
      { kind: "update_lesion", lesionId: "lesion-2", changes: { lesion_x_mm: 0 } },
    ]);

    await t.test(
      "case notes persist independently of clinical values and keep revision/access guards",
      async () => {
        const target = await create();
        const original = await reviews.get(target.caseId, ownerId);
        assert.equal(original.note, "");
        const command = {
          ...target,
          expectedRevision: 0,
          requestId: randomUUID(),
          operations: [],
          note: "  Doplňující poznámka ke kontrole.  ",
        };
        const firstNote = await reviews.save(command, ownerId);
        assert.equal(firstNote.note, "Doplňující poznámka ke kontrole.");
        assert.deepEqual(firstNote.snapshot.record, original.record);
        assert.deepEqual(await reviews.save(command, ownerId), firstNote);
        const reloadedNote = await reviews.get(target.caseId, ownerId);
        assert.equal(reloadedNote.note, firstNote.note);
        await assert.rejects(
          reviews.save({ ...command, requestId: randomUUID(), note: "Zastaralá změna" }, ownerId),
          hasCode("CONFLICT"),
        );
        const edited = await reviews.save(
          {
            ...target,
            expectedRevision: 1,
            requestId: randomUUID(),
            operations: [{ kind: "update_lesion", lesionId: "lesion-1", changes: { lesion_x_mm: 13 } }],
          },
          ownerId,
        );
        assert.equal(edited.note, firstNote.note);
        const decided = await reviews.decideField(
          {
            ...target,
            expectedRevision: 2,
            requestId: randomUUID(),
            reference: { scope: "lesion", lesionId: "lesion-1", field: "lesion_x_mm" },
            note: "Rozměr ověřen v nálezu.",
          },
          ownerId,
        );
        assert.equal(decided.note, firstNote.note);
        const beforeClear = await reviews.get(target.caseId, ownerId);
        const clear = { ...target, expectedRevision: 3, requestId: randomUUID(), operations: [], note: "" };
        const cleared = await reviews.save(clear, ownerId);
        assert.equal(cleared.note, "");
        assert.deepEqual(cleared.snapshot.record, decided.snapshot.record);
        assert.deepEqual(cleared.workflow, decided.workflow);
        const afterClear = await reviews.get(target.caseId, ownerId);
        assert.equal(afterClear.note, "");
        assert.deepEqual(afterClear.workflowStatus, beforeClear.workflowStatus);
        await service.addAccess({ caseId: target.caseId, userId: viewerId, role: "viewer" }, ownerId);
        await assert.rejects(
          reviews.save(
            { ...clear, expectedRevision: 4, requestId: randomUUID(), note: "Viewer edit" },
            viewerId,
          ),
          hasCode("NOT_FOUND"),
        );
        await afterClear.workflowStatus.sections.reduce(async (previous, section) => {
          await previous;
          const current = await reviews.get(target.caseId, ownerId);
          await reviews.confirmSection(
            {
              ...target,
              expectedRevision: current.revision,
              requestId: randomUUID(),
              reference: section.reference,
            },
            ownerId,
          );
        }, Promise.resolve());
        const ready = await reviews.get(target.caseId, ownerId);
        await reviews.approve(target.caseId, ownerId, ready.revision);
        const approvedNote = await reviews.get(target.caseId, ownerId);
        assert.equal(approvedNote.readOnly, true);
        await assert.rejects(
          reviews.save(
            { ...clear, expectedRevision: ready.revision, requestId: randomUUID(), note: "Locked edit" },
            ownerId,
          ),
          hasCode("PRECONDITION_FAILED"),
        );
      },
    );

    await t.test(
      "ownership is checked before object storage and reads do not create a workspace",
      async () => {
        const reads = storage.reads;
        const writes = storage.writes;
        await assert.rejects(reviews.get(item.caseId, otherId), hasCode("NOT_FOUND"));
        await assert.rejects(reviews.save(first, otherId), hasCode("NOT_FOUND"));
        assert.equal(storage.reads, reads);
        assert.equal(storage.writes, writes);
        const baseline = await reviews.get(item.caseId, ownerId);
        assert.equal(baseline.revision, 0);
        assert.equal(baseline.snapshot, null);
        assert.deepEqual(baseline.lesionIds, ["lesion-1", "lesion-2"]);
        const heads = await database.db.select().from(caseReviews).where(eq(caseReviews.caseId, item.caseId));
        assert.equal(heads.length, 0);
      },
    );

    await t.test(
      "shared reviewers can save and approve, viewers can only read, and export stays owner-only",
      async () => {
        const target = await create();
        await service.addAccess({ caseId: target.caseId, userId: reviewerId, role: "reviewer" }, ownerId);
        await service.addAccess({ caseId: target.caseId, userId: viewerId, role: "viewer" }, ownerId);
        const reviewerWorkspace = await reviews.get(target.caseId, reviewerId);
        const viewerWorkspace = await reviews.get(target.caseId, viewerId);
        assert.equal(reviewerWorkspace.readOnly, false);
        assert.equal(viewerWorkspace.readOnly, true);
        const command = { ...target, expectedRevision: 0, requestId: randomUUID(), operations: [] };
        const reads = storage.reads;
        const writes = storage.writes;
        await assert.rejects(reviews.save(command, viewerId), hasCode("NOT_FOUND"));
        await assert.rejects(reviews.approve(target.caseId, viewerId, 0), hasCode("NOT_FOUND"));
        assert.equal(storage.reads, reads);
        assert.equal(storage.writes, writes);
        await reviews.save(command, reviewerId);
        // A viewer cannot replay another reviewer's successful request ID.
        await assert.rejects(reviews.save(command, viewerId), hasCode("NOT_FOUND"));
        const [stored] = await database.db
          .select()
          .from(reviewRevisions)
          .where(eq(reviewRevisions.caseId, target.caseId));
        assert.ok(stored);
        assert.equal(stored.actorId, reviewerId);
        await assert.rejects(
          database.db
            .insert(reviewRevisions)
            .values({ ...stored, revision: 2, requestId: randomUUID(), actorId: viewerId }),
        );
        const identity = async () => {
          const current = await reviews.get(target.caseId, reviewerId);

          return { ...target, expectedRevision: current.revision, requestId: randomUUID() };
        };
        const current = await reviews.get(target.caseId, reviewerId);
        await current.workflowStatus.fields
          .filter((field) => field.decisionRequired && !field.resolved)
          .reduce(async (previous, field) => {
            await previous;
            await assert.rejects(
              reviews.decideField(
                { ...(await identity()), reference: field.reference, note: "Viewer cannot decide" },
                viewerId,
              ),
              hasCode("NOT_FOUND"),
            );
            await reviews.decideField(
              { ...(await identity()), reference: field.reference, note: "Checked shared case" },
              reviewerId,
            );
          }, Promise.resolve());
        await current.workflowStatus.sections.reduce(async (previous, section) => {
          await previous;
          await assert.rejects(
            reviews.confirmSection({ ...(await identity()), reference: section.reference }, viewerId),
            hasCode("NOT_FOUND"),
          );
          await reviews.confirmSection({ ...(await identity()), reference: section.reference }, reviewerId);
        }, Promise.resolve());
        const ready = await reviews.get(target.caseId, reviewerId);
        await reviews.approve(target.caseId, reviewerId, ready.revision);
        await assert.rejects(reviews.approve(target.caseId, viewerId, ready.revision), hasCode("NOT_FOUND"));
        const viewerApproved = await reviews.get(target.caseId, viewerId);
        assert.equal(viewerApproved.approvedRevision, ready.revision);
        const [approved] = await database.db.select().from(cases).where(eq(cases.id, target.caseId));
        assert.equal(approved?.approvedBy, reviewerId);
        await assert.rejects(service.sendToRedcap(target.caseId, reviewerId), hasCode("NOT_FOUND"));
        await assert.rejects(service.sendToRedcap(target.caseId, viewerId), hasCode("NOT_FOUND"));
        await assert.rejects(service.reopen(target.caseId, viewerId), hasCode("NOT_FOUND"));
        await service.reopen(target.caseId, reviewerId);
        const events = await database.db
          .select()
          .from(caseAuditEvents)
          .where(eq(caseAuditEvents.caseId, target.caseId));
        assert.deepEqual(
          events.map((event) => [event.kind, event.actorId]),
          [
            ["approved", reviewerId],
            ["reopened", reviewerId],
          ],
        );
        const reopened = await reviews.get(target.caseId, reviewerId);
        assert.equal(reopened.readOnly, false);
      },
    );

    const saved = await reviews.save(first, ownerId);
    await t.test(
      "corrections, explicit clears and zero values survive reload without changing the proposal",
      async () => {
        assert.equal(saved.snapshot.revision, 1);
        const freshService = new ReviewService(storage, database);
        const loaded = await freshService.get(item.caseId, ownerId);
        assert.equal(loaded.revision, 1);
        assert.equal(loaded.record.lesions[0]?.lesion_y_mm, 9);
        assert.equal(loaded.record.lesions[0].hist_type_sur, null);
        assert.equal(loaded.record.lesions[1]?.lesion_x_mm, 0);
        assert.equal(loaded.proposal.record.lesions[0]?.lesion_y_mm, 8);
        assert.ok(
          loaded.issues.some(
            (issue) => issue.reference.scope === "lesion" && issue.reference.field === "hist_type_sur",
          ),
        );
        assert.deepEqual(await reviews.save(first, ownerId), saved);
        await assert.rejects(
          reviews.save(
            {
              ...first,
              operations: [{ kind: "update_lesion", lesionId: "lesion-1", changes: { lesion_y_mm: 10 } }],
            },
            ownerId,
          ),
          hasCode("CONFLICT"),
        );
      },
    );

    await t.test("concurrent saves have one winner; stale saves and wrong baselines fail", async () => {
      let writes = 0;
      let release: (() => void) | undefined;
      const bothWritten = new Promise<void>((resolve) => {
        release = resolve;
      });
      storage.afterWrite = async () => {
        writes++;
        if (writes === 2) release?.();
        await bothWritten;
      };
      const results = await Promise.allSettled([
        reviews.save(
          request(1, [{ kind: "update_lesion", lesionId: "lesion-1", changes: { lesion_y_mm: 10 } }]),
          ownerId,
        ),
        reviews.save(
          request(1, [{ kind: "update_lesion", lesionId: "lesion-1", changes: { lesion_y_mm: 11 } }]),
          ownerId,
        ),
      ]);
      storage.afterWrite = undefined;
      assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
      const failure = results.find((result) => result.status === "rejected");
      assert.ok(failure?.status === "rejected" && hasCode("CONFLICT")(failure.reason));
      assert.equal(await revision(), 2);
      assert.equal(await revisionCount(), 2);
      assert.deepEqual(
        await reviews.save(first, ownerId),
        saved,
        "A lost-response retry returns its original revision even after a later save",
      );
      await assert.rejects(
        reviews.save(request(1, [{ kind: "delete_lesion", lesionId: "lesion-1" }]), ownerId),
        hasCode("CONFLICT"),
      );
      await assert.rejects(
        reviews.save(
          {
            ...request(2, [{ kind: "delete_lesion", lesionId: "lesion-1" }]),
            mappingIdentity: "mapping/wrong.json",
          },
          ownerId,
        ),
        hasCode("CONFLICT"),
      );
    });

    await t.test("concurrent identical retries commit exactly once", async () => {
      const retry = request(2, [
        { kind: "update_lesion", lesionId: "lesion-2", changes: { gleason_prim_perc: 90 } },
      ]);
      let writes = 0;
      let release: (() => void) | undefined;
      const bothWritten = new Promise<void>((resolve) => {
        release = resolve;
      });
      storage.afterWrite = async () => {
        writes++;
        if (writes === 2) release?.();
        await bothWritten;
      };
      const results = await Promise.all([reviews.save(retry, ownerId), reviews.save(retry, ownerId)]);
      storage.afterWrite = undefined;
      assert.deepEqual(results[0], results[1]);
      assert.equal(await revision(), 3);
      const loaded = await reviews.get(item.caseId, ownerId);
      assert.ok(
        loaded.issues.some((issue) => issue.message.includes("Gleason percentages cannot exceed 100")),
        "Cross-field inconsistencies remain editable drafts",
      );
    });

    await t.test(
      "storage and pointer failures preserve the current revision and request ID remains retryable",
      async () => {
        const retry = request(3, [
          { kind: "update_lesion", lesionId: "lesion-2", changes: { gleason_prim_perc: 80 } },
        ]);
        storage.failWrite = true;
        await assert.rejects(reviews.save(retry, ownerId), /storage failure/);
        storage.failWrite = false;
        assert.equal(await revision(), 3);
        await database.db.execute(
          sql`CREATE FUNCTION app.reject_test_review_pointer() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Synthetic pointer failure'; END $$`,
        );
        await database.db.execute(
          sql`CREATE TRIGGER reject_test_review_pointer BEFORE UPDATE ON app.case_reviews FOR EACH ROW EXECUTE FUNCTION app.reject_test_review_pointer()`,
        );
        try {
          await assert.rejects(reviews.save(retry, ownerId));
        } finally {
          await database.db.execute(sql`DROP TRIGGER reject_test_review_pointer ON app.case_reviews`);
          await database.db.execute(sql`DROP FUNCTION app.reject_test_review_pointer()`);
        }
        assert.equal(await revision(), 3);
        assert.equal(await revisionCount(), 3);
        const retried = await reviews.save(retry, ownerId);
        assert.equal(retried.snapshot.revision, 4);
      },
    );

    await t.test(
      "lesion removal/insertion preserve surviving identities and retire removed IDs",
      async () => {
        const lesion = fixture().lesions[0];
        assert.ok(lesion);
        const edited = await reviews.save(
          request(4, [
            { kind: "delete_lesion", lesionId: "lesion-1" },
            { kind: "add_lesion", lesionId: "new-lesion", lesion },
            { kind: "update_lesion", lesionId: "lesion-2", changes: { lesion_y_mm: 7 } },
          ]),
          ownerId,
        );
        assert.deepEqual(edited.snapshot.lesionIds, ["lesion-2", "new-lesion"]);
        assert.deepEqual(edited.retiredLesionIds, ["lesion-1"]);
        const loaded = await reviews.get(item.caseId, ownerId);
        assert.deepEqual(loaded.lesionIds, ["lesion-2", "new-lesion"]);
        assert.equal(loaded.record.lesions[0]?.lesion_y_mm, 7);
        await assert.rejects(
          reviews.save(request(5, [{ kind: "add_lesion", lesionId: "lesion-1", lesion }]), ownerId),
          hasCode("BAD_REQUEST"),
        );
      },
    );

    await t.test(
      "database history and pointer cannot be rewritten or detached; legacy approval cannot ignore corrections",
      async () => {
        await assert.rejects(service.approve(item.caseId, ownerId), hasCode("PRECONDITION_FAILED"));
        await assert.rejects(
          database.db
            .update(cases)
            .set({ approvedAt: sql`now()`, approvedBy: ownerId })
            .where(eq(cases.id, item.caseId)),
        );
        await assert.rejects(
          database.db
            .update(reviewRevisions)
            .set({ artifactKey: "replacement" })
            .where(eq(reviewRevisions.caseId, item.caseId)),
        );
        await assert.rejects(
          database.db.delete(reviewRevisions).where(eq(reviewRevisions.caseId, item.caseId)),
        );
        await assert.rejects(database.db.delete(caseReviews).where(eq(caseReviews.caseId, item.caseId)));
        await assert.rejects(
          database.db
            .update(caseReviews)
            .set({ currentRevision: 1 })
            .where(eq(caseReviews.caseId, item.caseId)),
        );
        const reviewedCase = await service.findById(item.caseId, ownerId);
        assert.equal(reviewedCase.status, "in_review");
      },
    );

    await t.test(
      "approval winning during storage I/O rejects the save and preserves the legacy approved case",
      async () => {
        const race = await create();
        storage.afterWrite = async () => {
          await service.approve(race.caseId, ownerId);
        };
        try {
          await assert.rejects(
            reviews.save(
              {
                ...race,
                expectedRevision: 0,
                requestId: randomUUID(),
                operations: [{ kind: "update_lesion", lesionId: "lesion-1", changes: { lesion_x_mm: 13 } }],
              },
              ownerId,
            ),
            hasCode("PRECONDITION_FAILED"),
          );
        } finally {
          storage.afterWrite = undefined;
        }
        const approved = await reviews.get(race.caseId, ownerId);
        assert.equal(approved.revision, 0);
        assert.equal(approved.readOnly, true);
        await service.reopen(race.caseId, ownerId);
        const reopened = await reviews.get(race.caseId, ownerId);
        assert.equal(reopened.readOnly, false);
      },
    );

    await (["absent", "outside draft bounds"] as const).reduce(async (previous, parentData) => {
      await previous;
      await t.test(
        `parent data ${parentData} permits initial save, lesion approval and lesion-only export`,
        async () => {
          const record = fixture();
          if (parentData === "absent") {
            for (const field of Object.keys(record.surgery) as (keyof SurgeryRecord["surgery"])[])
              record.surgery[field] = null;
          } else {
            record.surgery.surgery_date = "2999-01-01";
            record.surgery.node_no_surgery = 999;
            record.surgery.node_positive_no_surgery = 998;
            record.surgery.histol_post_surg_specify = "x".repeat(1001);
            record.surgery.surgery_text = "x".repeat(20_001);
          }
          const legacy = await create(record);
          const legacyDraft = await reviews.get(legacy.caseId, ownerId);
          assert.deepEqual(legacyDraft.record.surgery, record.surgery);
          assert.deepEqual(legacyDraft.issues, []);
          assert.ok(legacyDraft.workflowStatus.fields.every((field) => field.reference.scope !== "surgery"));
          assert.ok(
            legacyDraft.workflowStatus.sections.every((section) => section.reference.scope !== "surgery"),
          );
          const saved = await reviews.save(
            { ...legacy, expectedRevision: 0, requestId: randomUUID(), operations: [] },
            ownerId,
          );
          assert.deepEqual(saved.snapshot.record.surgery, record.surgery);
          const revision = await legacyDraft.workflowStatus.sections.reduce(async (previous, section) => {
            const expectedRevision = await previous;
            const confirmed = await reviews.confirmSection(
              {
                ...legacy,
                expectedRevision,
                requestId: randomUUID(),
                reference: section.reference,
              },
              ownerId,
            );

            return confirmed.snapshot.revision;
          }, Promise.resolve(saved.snapshot.revision));
          await reviews.approve(legacy.caseId, ownerId, revision);
          const exported = await service.sendToRedcap(legacy.caseId, ownerId);
          assert.equal(exported.status, "exported");
          assert.ok(redcap.data !== undefined);
          const rows = z.array(z.record(z.string(), z.string())).parse(JSON.parse(redcap.data));
          assert.deepEqual(rows[0], {
            record_id: redcap.attemptId,
            redcap_repeat_instrument: "",
            redcap_repeat_instance: "",
          });
          assert.equal(rows.length, 3);
          assert.equal(rows[1]?.["lesion_x_mm"], "12");
          assert.ok(rows.slice(1).every((row) => row["surgery_c61_resected_lesion_complete"] === "2"));
          for (const row of rows) {
            assert.equal("surgery_c61_complete" in row, false);
            assert.ok(Object.keys(record.surgery).every((field) => !(field in row)));
          }
        },
      );
    }, Promise.resolve());

    await t.test(
      "field decisions and section confirmations bind to content, survive no-ops, and never revive after restore",
      async () => {
        const target = await create();
        const identity = async () => {
          const workspace = await reviews.get(target.caseId, ownerId);

          return { ...target, expectedRevision: workspace.revision, requestId: randomUUID() };
        };
        const decide = async (reference: ReviewFieldRef, note: string | null = null) =>
          reviews.decideField({ ...(await identity()), reference, note }, ownerId);
        const confirm = async (reference: ReviewSectionRef) =>
          reviews.confirmSection({ ...(await identity()), reference }, ownerId);
        const edit = async (operations: ReviewSave["operations"]) =>
          reviews.save({ ...(await identity()), operations }, ownerId);
        const section: ReviewSectionRef = { scope: "lesion", lesionId: "lesion-1" };
        const histology: ReviewFieldRef = { scope: "lesion", lesionId: "lesion-1", field: "hist_type_sur" };
        const dimension: ReviewFieldRef = { scope: "lesion", lesionId: "lesion-1", field: "lesion_x_mm" };
        const otherDimension: ReviewFieldRef = {
          scope: "lesion",
          lesionId: "lesion-2",
          field: "lesion_x_mm",
        };
        const initial = await edit([
          { kind: "update_lesion", lesionId: "lesion-1", changes: { lesion_x_mm: 13 } },
        ]);
        assert.ok(initial.baseline);
        await assert.rejects(confirm(section), hasCode("PRECONDITION_FAILED"));
        await assert.rejects(decide(dimension), hasCode("BAD_REQUEST"));
        await decide(histology);
        await decide(dimension, "Lesion dimension corrected from the report");
        const confirmationRequest = { ...(await identity()), reference: section };
        const confirmed = await reviews.confirmSection(confirmationRequest, ownerId);
        assert.deepEqual(await reviews.confirmSection(confirmationRequest, ownerId), confirmed);
        const queue = await service.reviewQueue(ownerId);
        const queued = queue.find((entry) => entry.id === target.caseId);
        assert.ok(queued?.review);
        const confirmedView = await reviews.get(target.caseId, ownerId);
        assert.equal(queued.review.revision, confirmed.snapshot.revision);
        assert.equal(queued.review.unresolvedFieldCount, 0);
        assert.equal(
          queued.review.unconfirmedSectionCount,
          confirmedView.workflowStatus.sections.filter((section) => !section.confirmed).length,
        );
        assert.equal(
          queued.review.unresolvedMarkCount,
          confirmedView.marks.filter((mark) => mark.status !== "assigned" && mark.status !== "dismissed")
            .length,
        );
        assert.equal(queued.review.blockingIssueCount, 0);
        await assert.rejects(reviews.revokeSection(confirmationRequest, ownerId), hasCode("CONFLICT"));
        await assert.rejects(
          reviews.confirmSection({ ...confirmationRequest, requestId: randomUUID() }, ownerId),
          hasCode("CONFLICT"),
        );
        const confirmedId = confirmed.workflow.confirmations[0]?.id;
        assert.notEqual(confirmedId, undefined);
        const noOp = await edit([
          { kind: "update_lesion", lesionId: "lesion-1", changes: { hist_type_sur: "2" } },
        ]);
        assert.ok(
          noOp.workflow.confirmations.some(
            (entry) => entry.id === confirmedId && entry.invalidatedAtRevision === null,
          ),
        );
        const unrelated = await edit([
          { kind: "update_lesion", lesionId: "lesion-2", changes: { lesion_x_mm: 14 } },
        ]);
        assert.ok(
          unrelated.workflow.confirmations.some(
            (entry) => entry.id === confirmedId && entry.invalidatedAtRevision === null,
          ),
        );
        await assert.rejects(decide(otherDimension), hasCode("BAD_REQUEST"));
        const manual = await decide(otherDimension, "Checked against source");
        assert.equal(manual.workflow.decisions.at(-1)?.action, "correct");
        await edit([{ kind: "update_lesion", lesionId: "lesion-1", changes: { hist_type_sur: "1" } }]);
        const restored = await edit([
          { kind: "update_lesion", lesionId: "lesion-1", changes: { hist_type_sur: "2" } },
        ]);
        assert.ok(
          restored.workflow.confirmations.some(
            (entry) => entry.id === confirmedId && entry.invalidation === "changed",
          ),
        );
        assert.equal(
          restored.workflow.decisions.filter(
            (entry) =>
              entry.reference.scope === "lesion" &&
              entry.reference.lesionId === "lesion-1" &&
              ["hist_type_sur", "lesion_x_mm"].includes(entry.reference.field) &&
              entry.invalidatedAtRevision === null,
          ).length,
          0,
        );
        await assert.rejects(confirm(section), hasCode("PRECONDITION_FAILED"));
        await edit([{ kind: "update_lesion", lesionId: "lesion-1", changes: { hist_type_sur: null } }]);
        await assert.rejects(
          decide(histology, "A note cannot replace required histology"),
          hasCode("PRECONDITION_FAILED"),
        );
        await edit([{ kind: "update_lesion", lesionId: "lesion-1", changes: { hist_type_sur: "2" } }]);
        await decide(histology);
        await decide(dimension, "Lesion dimension corrected from the report");
        await confirm(section);
        const revoked = await reviews.revokeSection({ ...(await identity()), reference: section }, ownerId);
        assert.equal(revoked.workflow.confirmations.at(-1)?.invalidation, "revoked");
        const view = await reviews.get(target.caseId, ownerId);
        assert.equal(
          view.workflowStatus.sections.find(
            (section) => section.reference.scope === "lesion" && section.reference.lesionId === "lesion-1",
          )?.confirmed,
          false,
        );
        const unauthorized = await identity();
        const reads = storage.reads;
        await assert.rejects(
          reviews.decideField({ ...unauthorized, reference: histology, note: null }, otherId),
          hasCode("NOT_FOUND"),
        );
        await assert.rejects(
          reviews.confirmSection({ ...unauthorized, reference: section }, otherId),
          hasCode("NOT_FOUND"),
        );
        await assert.rejects(
          reviews.revokeSection({ ...unauthorized, reference: section }, otherId),
          hasCode("NOT_FOUND"),
        );
        assert.equal(storage.reads, reads);
        await assert.rejects(service.approve(target.caseId, ownerId), hasCode("PRECONDITION_FAILED"));

        const replacement = fixture();
        const replacementLesion = replacement.lesions[0];
        assert.ok(replacementLesion);
        replacementLesion.lesion_x_mm = 99;
        storage.put(target.mappingIdentity, { record: replacement });
        const pinned = await reviews.get(target.caseId, ownerId);
        assert.equal(pinned.proposal.record.lesions[0]?.lesion_x_mm, 12);
        assert.equal(pinned.proposal.record.lesions.length, 2);
        const afterOverwrite = await edit([
          { kind: "update_lesion", lesionId: "lesion-2", changes: { lesion_x_mm: 15 } },
        ]);
        assert.deepEqual(afterOverwrite.baseline, initial.baseline);
      },
    );

    await t.test(
      "dependent Gleason decisions reopen when a percentage changes, while an empty lesion collection needs explicit confirmation",
      async () => {
        const target = await create();
        let revision = 0;
        const next = () => ({ ...target, expectedRevision: revision, requestId: randomUUID() });
        const saved = await reviews.save(
          {
            ...next(),
            operations: [{ kind: "update_lesion", lesionId: "lesion-1", changes: { lesion_x_mm: 12 } }],
          },
          ownerId,
        );
        revision = saved.snapshot.revision;
        const acceptGleason = async (
          field: "gleason_prim_grade" | "gleason_prim_perc" | "gleason_sec_grade",
        ) => {
          const result = await reviews.decideField(
            { ...next(), reference: { scope: "lesion", lesionId: "lesion-1", field }, note: null },
            ownerId,
          );
          revision = result.snapshot.revision;
        };
        await acceptGleason("gleason_prim_grade");
        await acceptGleason("gleason_prim_perc");
        await acceptGleason("gleason_sec_grade");
        const confirmed = await reviews.confirmSection(
          { ...next(), reference: { scope: "lesion", lesionId: "lesion-1" } },
          ownerId,
        );
        revision = confirmed.snapshot.revision;
        const changed = await reviews.save(
          {
            ...next(),
            operations: [{ kind: "update_lesion", lesionId: "lesion-1", changes: { gleason_sec_perc: 10 } }],
          },
          ownerId,
        );
        revision = changed.snapshot.revision;
        assert.equal(
          changed.workflow.decisions.filter((entry) => entry.invalidatedAtRevision === null).length,
          0,
        );
        assert.equal(changed.workflow.confirmations[0]?.invalidation, "changed");
        const empty = await reviews.save(
          {
            ...next(),
            operations: [
              { kind: "delete_lesion", lesionId: "lesion-1" },
              { kind: "delete_lesion", lesionId: "lesion-2" },
            ],
          },
          ownerId,
        );
        revision = empty.snapshot.revision;
        const before = await reviews.get(target.caseId, ownerId);
        const collection = before.workflowStatus.sections.find(
          (section) => section.reference.scope === "collection",
        );
        assert.equal(collection?.confirmed, false);
        await reviews.decideField(
          {
            ...next(),
            reference: { scope: "collection", collection: "lesions" },
            note: "Reviewed report; no focal lesions to record",
          },
          ownerId,
        );
        revision++;
        const complete = await reviews.confirmSection(
          { ...next(), reference: { scope: "collection", collection: "lesions" } },
          ownerId,
        );
        assert.equal(complete.workflow.confirmations.at(-1)?.reference.scope, "collection");
      },
    );

    await t.test(
      "a decision racing with an edit cannot acknowledge the stale value; decision retries commit once",
      async () => {
        const target = await create();
        await reviews.save(
          {
            ...target,
            expectedRevision: 0,
            requestId: randomUUID(),
            operations: [{ kind: "update_lesion", lesionId: "lesion-1", changes: { lesion_x_mm: 12 } }],
          },
          ownerId,
        );
        const stale = {
          ...target,
          expectedRevision: 1,
          requestId: randomUUID(),
          reference: { scope: "lesion" as const, lesionId: "lesion-1", field: "lesion_x_mm" as const },
          note: null,
        };
        storage.afterWrite = async () => {
          storage.afterWrite = undefined;
          await reviews.save(
            {
              ...target,
              expectedRevision: 1,
              requestId: randomUUID(),
              operations: [{ kind: "update_lesion", lesionId: "lesion-1", changes: { lesion_x_mm: 13 } }],
            },
            ownerId,
          );
        };
        try {
          await assert.rejects(reviews.decideField(stale, ownerId), hasCode("CONFLICT"));
        } finally {
          storage.afterWrite = undefined;
        }
        const current = await reviews.get(target.caseId, ownerId);
        assert.equal(current.workflow.decisions.length, 0);
        assert.equal(current.revision, 2);
        const retry = {
          ...stale,
          requestId: randomUUID(),
          expectedRevision: 2,
          note: "Verified corrected lesion dimension",
        };
        let written = 0;
        let release: (() => void) | undefined;
        const gate = new Promise<void>((resolve) => {
          release = resolve;
        });
        storage.afterWrite = async () => {
          written++;
          if (written === 2) release?.();
          await gate;
        };
        try {
          const results = await Promise.all([
            reviews.decideField(retry, ownerId),
            reviews.decideField(retry, ownerId),
          ]);
          assert.deepEqual(results[0], results[1]);
          assert.equal(results[0].workflow.decisions.length, 1);
          assert.equal(results[0].snapshot.revision, 3);
        } finally {
          storage.afterWrite = undefined;
        }
      },
    );

    await t.test(
      "mark reassignment preserves independent contributions; approval/display/export pin exactly the corrected revision",
      async () => {
        const target = await create();
        const initial = await reviews.get(target.caseId, ownerId);
        const evidence = mappingEvidenceFixture(initial.record, initial.lesionIds);
        const source = evidence.marks[0];
        assert.ok(source);
        source.regions = ["pza_mid_rs"];
        source.focus = { sectors: [{ id: "mid_PZa_R", share: 1, coverage: 0.5 }], marked: ["mid_PZa_R"] };
        evidence.marks.push({ ...structuredClone(source), id: "mark-2" });
        storage.put(target.mappingIdentity, { record: initial.record, diagnostics: { review: evidence } });
        const identity = async () => {
          const current = await reviews.get(target.caseId, ownerId);

          return { ...target, expectedRevision: current.revision, requestId: randomUUID() };
        };
        await reviews.save(
          {
            ...(await identity()),
            operations: [{ kind: "update_lesion", lesionId: "lesion-1", changes: { lesion_x_mm: 13 } }],
          },
          ownerId,
        );
        await assert.rejects(reviews.approve(target.caseId, ownerId, 1), hasCode("PRECONDITION_FAILED"));
        await reviews.assignMark(
          {
            ...(await identity()),
            markId: source.id,
            lesionId: "lesion-1",
            note: "First mark matches left lesion",
          },
          ownerId,
        );
        await reviews.assignMark(
          { ...(await identity()), markId: "mark-2", lesionId: "lesion-1", note: "Second independent mark" },
          ownerId,
        );
        const shared = await reviews.get(target.caseId, ownerId);
        assert.equal(shared.record.lesions[0]?.sur_prostate_regions.includes("pza_mid_rs"), true);
        await reviews.dismissMark(
          { ...(await identity()), markId: source.id, note: "Dismiss one mark only" },
          ownerId,
        );
        const remaining = await reviews.get(target.caseId, ownerId);
        assert.equal(remaining.record.lesions[0]?.sur_prostate_regions.includes("pza_mid_rs"), true);
        await reviews.assignMark(
          {
            ...(await identity()),
            markId: "mark-2",
            lesionId: "lesion-2",
            note: "Reassign to the right lesion",
          },
          ownerId,
        );
        const moved = await reviews.get(target.caseId, ownerId);
        assert.equal(moved.record.lesions[0]?.sur_prostate_regions.includes("pza_mid_rs"), false);
        assert.equal(moved.record.lesions[0].sur_prostate_regions.includes("pzpl_base_ls"), true);
        assert.equal(moved.record.lesions[1]?.sur_prostate_regions.includes("pza_mid_rs"), true);
        await assert.rejects(
          reviews.assignMark(
            { ...(await identity()), markId: "unknown", lesionId: "lesion-2", note: "Invalid source" },
            ownerId,
          ),
          hasCode("BAD_REQUEST"),
        );
        const complete = async () => {
          const current = await reviews.get(target.caseId, ownerId);
          await current.workflowStatus.fields
            .filter((field) => field.decisionRequired && !field.resolved)
            .reduce(async (previous, field) => {
              await previous;
              await reviews.decideField(
                {
                  ...(await identity()),
                  reference: field.reference,
                  note: "Checked source and corrected values",
                },
                ownerId,
              );
            }, Promise.resolve());
          const ready = await reviews.get(target.caseId, ownerId);
          await ready.workflowStatus.sections
            .filter((section) => !section.confirmed)
            .reduce(async (previous, section) => {
              await previous;
              await reviews.confirmSection({ ...(await identity()), reference: section.reference }, ownerId);
            }, Promise.resolve());
        };
        await complete();
        const confirmed = await reviews.get(target.caseId, ownerId);
        await reviews.assignMark(
          {
            ...(await identity()),
            markId: "mark-2",
            lesionId: "lesion-2",
            note: "Same sectors; corrected source interpretation",
          },
          ownerId,
        );
        const rebound = await reviews.get(target.caseId, ownerId);
        assert.deepEqual(rebound.record, confirmed.record);
        assert.ok(rebound.workflowStatus.sections.some((section) => !section.confirmed));
        await complete();
        const ready = await reviews.get(target.caseId, ownerId);
        await assert.rejects(reviews.approve(target.caseId, otherId, ready.revision), hasCode("NOT_FOUND"));
        await assert.rejects(
          reviews.approve(target.caseId, ownerId, ready.revision - 1),
          hasCode("CONFLICT"),
        );
        await reviews.approve(target.caseId, ownerId, ready.revision);
        await reviews.approve(target.caseId, ownerId, ready.revision);
        const approved = await reviews.get(target.caseId, ownerId);
        assert.equal(approved.approvedRevision, ready.revision);
        assert.deepEqual(approved.record, ready.record);
        await assert.rejects(
          reviews.save(
            {
              ...(await identity()),
              operations: [{ kind: "update_lesion", lesionId: "lesion-1", changes: { lesion_x_mm: 14 } }],
            },
            ownerId,
          ),
          hasCode("PRECONDITION_FAILED"),
        );
        await service.reopen(target.caseId, ownerId);
        const reopened = await reviews.get(target.caseId, ownerId);
        assert.equal(reopened.approvedRevision, null);
        await reviews.approve(target.caseId, ownerId, ready.revision);
        const overwritten = fixture();
        const overwrittenLesion = overwritten.lesions[0];
        assert.ok(overwrittenLesion);
        overwrittenLesion.lesion_x_mm = 77;
        storage.put(target.mappingIdentity, { record: overwritten });
        const final = await reviews.get(target.caseId, ownerId);
        assert.deepEqual(final.record, ready.record);
        await assert.rejects(
          database.db.execute(
            sql`update app.cases set export_started_at = now(), export_attempt_id = gen_random_uuid() where id = ${target.caseId}`,
          ),
          (error: unknown) =>
            error instanceof Error &&
            ((error.cause as Error | undefined)?.message ?? error.message).includes(
              "approved review revision",
            ),
        );
        const exported = await service.sendToRedcap(target.caseId, ownerId);
        assert.equal(exported.status, "exported");
        assert.deepEqual(redcap.record, ready.record);
        assert.notEqual(redcap.attemptId, undefined);
        if (redcap.attemptId === undefined) throw new Error("Missing fake export attempt");
        const [row] = await database.db.select().from(cases).where(eq(cases.id, target.caseId));
        assert.equal(
          row?.exportPayloadHash,
          prepareRedcapSubmission(ready.record, redcap.attemptId).payloadHash,
        );
        await assert.rejects(service.reopen(target.caseId, ownerId), hasCode("CONFLICT"));
      },
    );

    await t.test(
      "corrupt artifacts fail closed rather than falling back to the original mapping",
      async () => {
        const [head] = await database.db
          .select()
          .from(reviewRevisions)
          .where(eq(reviewRevisions.caseId, item.caseId))
          .orderBy(sql`${reviewRevisions.revision} desc`);
        assert.ok(head);
        storage.objects.set(head.artifactKey, {
          raw: JSON.stringify({ invalid: true }),
          versionId: head.artifactVersionId,
        });
        await assert.rejects(reviews.get(item.caseId, ownerId));
      },
    );
  } finally {
    await database.close();
  }
});
