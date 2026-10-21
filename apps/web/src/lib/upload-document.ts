import type { DocumentFile, DocumentKind } from "@prostapaper/contracts";

import { documentFilename } from "#lib/document-filename";
import { trpcClient } from "#trpc";

const UPLOAD_TIMEOUT_MS = 120_000;

export interface CaseUpload {
  kind: DocumentKind;
  file: File;
}

export async function submitCase(name: string, uploads: CaseUpload[]): Promise<string> {
  const created = await trpcClient.case.create.mutate({ name });
  await Promise.all(
    uploads.map(async (upload) =>
      uploadDocument(upload, { filename: documentFilename(name, upload.file.name), caseId: created.id }),
    ),
  );
  await trpcClient.case.submit.mutate({ caseId: created.id });

  return created.id;
}

async function uploadDocument(
  { kind, file }: CaseUpload,
  { filename, caseId }: { filename: string; caseId: string },
): Promise<void> {
  const documentId = crypto.randomUUID();
  await trpcClient.document.register.mutate({
    caseId,
    documentId,
    kind,
    file: { filename, contentType: file.type as DocumentFile["contentType"], size: file.size },
  });
  const presignedPost = await trpcClient.document.presign.mutate({ documentId });
  const body = new FormData();
  for (const [field, value] of Object.entries(presignedPost.fields)) body.append(field, value);
  body.append("file", file);
  const response = await fetch(presignedPost.url, {
    method: "POST",
    body,
    credentials: "omit",
    signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`Upload rejected with HTTP ${response.status}`);
}
