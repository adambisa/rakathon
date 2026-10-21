import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mock, test } from "node:test";
import { setImmediate } from "node:timers/promises";

import { sampleDocuments } from "#sample-cases";
import type { TrpcContext } from "#trpc/context";
import { createCaller } from "#trpc/router";

function fixture(isAnonymous: boolean) {
  const caseId = randomUUID();
  const create = mock.fn(async () => {
    await setImmediate();

    return { id: caseId };
  });
  const createSample = mock.fn(async () => {
    await setImmediate();

    return { id: caseId };
  });
  const submit = mock.fn(async () => {
    await setImmediate();

    return { id: caseId };
  });
  const register = mock.fn(async () => {
    await setImmediate();

    return { documentId: randomUUID(), uploaded: false };
  });
  const presign = mock.fn(async () => {
    await setImmediate();

    return { url: "https://storage.invalid" };
  });
  const context = {
    session: { user: { id: "reviewer", isAnonymous } },
    cases: { create, createSample, submit },
    documents: { register, presign },
  } as unknown as TrpcContext;

  return { api: createCaller(context), create, createSample, submit, register, presign, caseId };
}

const registration = () => ({
  caseId: randomUUID(),
  documentId: randomUUID(),
  kind: "text_description" as const,
  file: { filename: "custom.jpg", contentType: "image/jpeg" as const, size: 100 },
});

void test("guests cannot create custom drafts, register files, or obtain upload tickets", async () => {
  const { api, create, register, presign } = fixture(true);
  await assert.rejects(api.case.create({ name: "Custom" }), { code: "FORBIDDEN" });
  await assert.rejects(api.document.register(registration()), { code: "FORBIDDEN" });
  await assert.rejects(api.document.presign({ documentId: randomUUID() }), { code: "FORBIDDEN" });
  assert.equal(create.mock.callCount(), 0);
  assert.equal(register.mock.callCount(), 0);
  assert.equal(presign.mock.callCount(), 0);
});

void test("registered users retain the custom upload flow", async () => {
  const { api, create, register, presign } = fixture(false);
  await api.case.create({ name: "Custom" });
  await api.document.register(registration());
  await api.document.presign({ documentId: randomUUID() });
  assert.equal(create.mock.callCount(), 1);
  assert.equal(register.mock.callCount(), 1);
  assert.equal(presign.mock.callCount(), 1);
});

void test("guests and registered users can submit only allowlisted examples through the sample endpoint", async () => {
  await Promise.all(
    [true, false].map(async (isGuest) => {
      const { api, createSample, submit, caseId } = fixture(isGuest);
      await Promise.all(
        (["0005", "0008", "0012"] as const).map(async (sampleId) => {
          assert.deepEqual(await api.case.createSample({ sampleId }), { id: caseId });
        }),
      );
      assert.deepEqual(
        createSample.mock.calls.map(({ arguments: args }) => args.slice(0, 2)),
        [
          ["0005", "reviewer"],
          ["0008", "reviewer"],
          ["0012", "reviewer"],
        ],
      );
      assert.equal(submit.mock.callCount(), 3);
      for (const call of submit.mock.calls) assert.deepEqual(call.arguments, [caseId, "reviewer"]);
      await assert.rejects(
        // Exercise the runtime boundary that an untyped client can reach.
        api.case.createSample({ sampleId: "../../custom" as "0005" }),
        { code: "BAD_REQUEST" },
      );
      assert.equal(createSample.mock.callCount(), 3);
    }),
  );
});

void test("example documents are bundled JPEGs with a report and matching sector map", async () => {
  await Promise.all(
    (["0005", "0008", "0012"] as const).map(async (sampleId) => {
      const files = await sampleDocuments(sampleId);
      assert.deepEqual(
        files.map(({ kind }) => kind),
        ["text_description", "sector_map"],
      );
      for (const { body, filename } of files) {
        assert.ok(filename.endsWith(`${sampleId}.jpg`));
        assert.ok(body.length > 0);
        assert.equal(body.readUInt16BE(), 0xff_d8);
      }
    }),
  );
});
