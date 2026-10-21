import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { Readable } from "node:stream";
import { mock, test } from "node:test";
import { setImmediate } from "node:timers/promises";

import {
  GetObjectCommand,
  HeadObjectCommand,
  NotFound,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";

import { ObjectStorageService } from "#storage/service";

void test("only version-pinned images receive short private browser caching", async () => {
  const client = new S3Client({
    region: "eu-central-1",
    credentials: { accessKeyId: "fixture", secretAccessKey: "fixture" },
  });
  const storage = new ObjectStorageService("eu-central-1", "documents", client);
  try {
    const source = new URL(await storage.presignDownload("uploads/source", 300, "version-1"));
    assert.equal(source.searchParams.get("versionId"), "version-1");
    assert.equal(source.searchParams.get("response-cache-control"), "private, max-age=120, must-revalidate");
    const short = new URL(await storage.presignDownload("uploads/source", 60, "version-1"));
    assert.equal(short.searchParams.get("response-cache-control"), "private, max-age=60, must-revalidate");
    const extraction = new URL(await storage.presignDownload("derived/document.json", 300));
    assert.equal(extraction.searchParams.get("response-cache-control"), "private, no-store");
  } finally {
    client.destroy();
  }
});

void test("HEAD returns the exact source version and registered size", async () => {
  const client = new S3Client({ region: "eu-central-1" });
  mock.method(client, "send", async (command: HeadObjectCommand) => {
    await setImmediate();
    assert.ok(command instanceof HeadObjectCommand);
    assert.deepEqual(command.input, { Bucket: "documents", Key: "uploads/source" });

    return { VersionId: "version-1", ContentLength: 12 };
  });
  const storage = new ObjectStorageService("eu-central-1", "documents", client);
  try {
    assert.deepEqual(await storage.head("uploads/source"), { versionId: "version-1", size: 12 });
  } finally {
    client.destroy();
  }
});

void test("HEAD distinguishes missing objects from access failures and invalid versioning", async () => {
  const client = new S3Client({ region: "eu-central-1" });
  const storage = new ObjectStorageService("eu-central-1", "documents", client);
  const send = mock.method(client, "send", async () => {
    await setImmediate();

    return { VersionId: "null", ContentLength: 12 };
  });
  try {
    await assert.rejects(storage.head("source"), /requires an S3 object version/);
    send.mock.mockImplementation(async () => {
      await setImmediate();

      return { ContentLength: 12 };
    });
    await assert.rejects(storage.head("source"), /requires an S3 object version/);
    send.mock.mockImplementation(async () => {
      await setImmediate();
      throw new NotFound({ $metadata: { httpStatusCode: 404 }, message: "Missing" });
    });
    assert.equal(await storage.head("source"), undefined);
    send.mock.mockImplementation(async () => {
      await setImmediate();
      throw new Error("AccessDenied");
    });
    await assert.rejects(storage.head("source"), /AccessDenied/);
  } finally {
    client.destroy();
  }
});

void test("mapping reads abort both a stalled request and a stalled response body", async () => {
  await Promise.all(
    [false, true].map(async (bodyStarted) => {
      const server = createServer((_request, response) => {
        if (bodyStarted) {
          response.writeHead(200, { "Content-Type": "application/json" });
          response.write('{"record":');
        }
      });
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      const address = server.address();
      assert.ok(address !== null && typeof address !== "string");
      const client = new S3Client({
        region: "eu-central-1",
        endpoint: `http://127.0.0.1:${address.port}`,
        forcePathStyle: true,
        credentials: { accessKeyId: "fixture", secretAccessKey: "fixture" },
        maxAttempts: 1,
        requestHandler: { requestTimeout: 25, throwOnRequestTimeout: true },
      });
      try {
        const storage = new ObjectStorageService("eu-central-1", "fixture", client);
        await assert.rejects(
          storage.readJson("mapping.json", AbortSignal.timeout(100)),
          /abort|timed? ?out/i,
        );
      } finally {
        client.destroy();
        server.closeAllConnections();
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    }),
  );
});

void test("review artifacts use conditional immutable writes and pin their version and byte checksum", async () => {
  const client = new S3Client({ region: "eu-central-1" });
  const storage = new ObjectStorageService("eu-central-1", "documents", client);
  const value = { clinical: "Synthetic Czech text: ložisko", revision: 1 };
  const raw = JSON.stringify(value);
  const checksum = createHash("sha256").update(raw).digest();
  let version: string | undefined = "v1";
  let expectedReadVersion: string | undefined = "v1";
  mock.method(client, "send", async (command: PutObjectCommand | GetObjectCommand) => {
    await setImmediate();
    if (command instanceof PutObjectCommand) {
      assert.equal(command.input.Key, "reviews/test/1/unique.json");
      assert.equal(command.input.IfNoneMatch, "*");
      assert.equal(command.input.Body, raw);
      assert.equal(command.input.ChecksumSHA256, checksum.toString("base64"));
      assert.equal(command.input.CacheControl, "private, no-store");

      return { VersionId: version };
    }
    assert.ok(command instanceof GetObjectCommand);
    assert.equal(command.input.VersionId, expectedReadVersion);

    return {
      VersionId: version,
      Body: Object.assign(Readable.from([raw]), {
        transformToString: async () => {
          await setImmediate();

          return raw;
        },
      }),
    };
  });
  try {
    const identity = await storage.writeJson("reviews/test/1/unique.json", value);
    assert.deepEqual(identity, { versionId: "v1", sha256: checksum.toString("hex") });
    assert.deepEqual(await storage.readJson("reviews/test/1/unique.json", undefined, identity), value);
    await assert.rejects(
      storage.readJson("reviews/test/1/unique.json", undefined, { ...identity, sha256: "0".repeat(64) }),
      /checksum mismatch/,
    );
    expectedReadVersion = undefined;
    assert.deepEqual(await storage.readVersionedJson("reviews/test/1/unique.json"), { value, identity });
    version = "null";
    await assert.rejects(
      storage.readVersionedJson("reviews/test/1/unique.json"),
      /requires? an S3 object version/,
    );
    await assert.rejects(
      storage.writeJson("reviews/test/1/unique.json", value),
      /requires? an S3 object version/,
    );
    version = undefined;
    await assert.rejects(
      storage.writeJson("reviews/test/1/unique.json", value),
      /requires? an S3 object version/,
    );
  } finally {
    client.destroy();
  }
});

void test("example images are written by the API with their filename metadata", async () => {
  const client = new S3Client({ region: "eu-central-1" });
  const storage = new ObjectStorageService("eu-central-1", "documents", client);
  const body = new Uint8Array([0xff, 0xd8, 0xff]);
  mock.method(client, "send", async (command: PutObjectCommand) => {
    await setImmediate();
    assert.ok(command instanceof PutObjectCommand);
    assert.deepEqual(command.input, {
      Bucket: "documents",
      Key: "uploads/sample/source",
      Body: body,
      ContentType: "image/jpeg",
      Metadata: { "filename-base64url": Buffer.from("scan-0005.jpg").toString("base64url") },
      IfNoneMatch: "*",
    });

    return { VersionId: "sample-version" };
  });
  try {
    await storage.writeSample("uploads/sample/source", body, "scan-0005.jpg");
  } finally {
    client.destroy();
  }
});
