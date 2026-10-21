import { createHash } from "node:crypto";
import { addAbortSignal, Readable } from "node:stream";

import {
  GetObjectCommand,
  HeadObjectCommand,
  NotFound,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { createPresignedPost, type PresignedPost } from "@aws-sdk/s3-presigned-post";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

export interface UploadTicket {
  key: string;
  contentType: string;
  size: number;
  metadata: Record<string, string>;
  ttlSeconds: number;
}

export interface StoredObjectIdentity {
  versionId: string;
  sha256: string;
}

export class ObjectStorageService {
  constructor(
    region: string,
    private readonly bucket: string,
    private readonly client = new S3Client({
      region,
      requestHandler: { requestTimeout: 15_000, throwOnRequestTimeout: true },
    }),
  ) {}

  get bucketName(): string {
    return this.bucket;
  }

  async head(key: string): Promise<{ versionId: string; size: number } | undefined> {
    try {
      const object = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      if (object.VersionId === undefined || object.VersionId === "null") {
        throw new Error("Document upload requires an S3 object version");
      }
      if (object.ContentLength === undefined) throw new Error("Document upload requires a known size");

      return { versionId: object.VersionId, size: object.ContentLength };
    } catch (error) {
      if (error instanceof NotFound) return undefined;
      throw error;
    }
  }

  async readJson(key: string, signal?: AbortSignal, identity?: StoredObjectIdentity): Promise<unknown> {
    const object = await this.readObject(key, signal, identity?.versionId);
    if (identity !== undefined && createHash("sha256").update(object.raw).digest("hex") !== identity.sha256) {
      throw new Error("Stored artifact checksum mismatch");
    }

    return JSON.parse(object.raw);
  }

  async readVersionedJson(key: string): Promise<{ value: unknown; identity: StoredObjectIdentity }> {
    const object = await this.readObject(key);
    if (object.versionId === undefined || object.versionId === "null" || object.versionId.trim() === "") {
      throw new Error("Review baselines require an S3 object version");
    }

    return {
      value: JSON.parse(object.raw),
      identity: {
        versionId: object.versionId,
        sha256: createHash("sha256").update(object.raw).digest("hex"),
      },
    };
  }

  private async readObject(key: string, signal?: AbortSignal, versionId?: string) {
    let deadline = AbortSignal.timeout(15_000);
    if (signal !== undefined) deadline = AbortSignal.any([deadline, signal]);
    deadline.throwIfAborted();
    const object = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key, VersionId: versionId }),
      { abortSignal: deadline },
    );
    if (!(object.Body instanceof Readable)) throw new Error("Object has no Node response stream");
    // Bound body consumption as well as request headers.
    addAbortSignal(deadline, object.Body);
    const raw = await object.Body.transformToString();
    deadline.throwIfAborted();

    return { raw, versionId: object.VersionId };
  }

  async writeSample(key: string, body: Uint8Array, filename: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: "image/jpeg",
        Metadata: { "filename-base64url": Buffer.from(filename).toString("base64url") },
        IfNoneMatch: "*",
      }),
      { abortSignal: AbortSignal.timeout(15_000) },
    );
  }

  async writeJson(key: string, value: unknown): Promise<StoredObjectIdentity> {
    const body = JSON.stringify(value);
    const checksum = createHash("sha256").update(body).digest();
    const result = await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: "application/json",
        CacheControl: "private, no-store",
        IfNoneMatch: "*",
        ChecksumSHA256: checksum.toString("base64"),
      }),
      { abortSignal: AbortSignal.timeout(15_000) },
    );
    if (result.VersionId === undefined || result.VersionId === "null") {
      throw new Error("Review artifacts require an S3 object version");
    }

    return { versionId: result.VersionId, sha256: checksum.toString("hex") };
  }

  async presignDownload(key: string, ttlSeconds: number, versionId?: string): Promise<string> {
    let cacheControl = "private, no-store";
    if (versionId !== undefined) {
      cacheControl = `private, max-age=${Math.min(120, ttlSeconds)}, must-revalidate`;
    }

    return getSignedUrl(
      this.client,
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
        VersionId: versionId,
        ResponseCacheControl: cacheControl,
      }),
      { expiresIn: ttlSeconds },
    );
  }

  async presignUpload({
    key,
    contentType,
    size,
    metadata,
    ttlSeconds,
  }: UploadTicket): Promise<PresignedPost> {
    return createPresignedPost(this.client, {
      Bucket: this.bucket,
      Key: key,
      Expires: ttlSeconds,
      Fields: {
        "Content-Type": contentType,
        ...Object.fromEntries(Object.entries(metadata).map(([name, value]) => [`x-amz-meta-${name}`, value])),
        success_action_status: "204",
      },
      Conditions: [
        ["eq", "$Content-Type", contentType],
        ["content-length-range", size, size],
        ["eq", "$success_action_status", "204"],
      ],
    });
  }
}
