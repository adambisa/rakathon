import { relations, type SQL, sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  foreignKey,
  index,
  integer,
  pgSchema,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

import type { CaseStatus, DocumentKind, DocumentStatus } from "@prostapaper/contracts";

import { user } from "#auth-schema";

export const application = pgSchema("app");
const time = (name: string) => timestamp(name, { withTimezone: true });
const ordered = (later: SQL, earlier: SQL) =>
  sql`${later} is null or (${earlier} is not null and ${later} >= ${earlier})`;
const optionalNonblank = (value: SQL) => sql`${value} is null or ${value} ~ '[^[:space:]]'`;

export const cases = application.table(
  "cases",
  {
    id: uuid().primaryKey(),
    name: text().notNull(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    createdAt: time("created_at").notNull().defaultNow(),
    updatedAt: time("updated_at").notNull().defaultNow(),
    submittedAt: time("submitted_at"),
    mappingStartedAt: time("mapping_started_at"),
    mappedAt: time("mapped_at"),
    mappingResultKey: text("mapping_result_key"),
    reviewStartedAt: time("review_started_at"),
    approvedAt: time("approved_at"),
    approvedBy: text("approved_by").references(() => user.id, { onDelete: "restrict" }),
    exportStartedAt: time("export_started_at"),
    exportReviewRevision: integer("export_review_revision"),
    exportedAt: time("exported_at"),
    redcapRecordId: text("redcap_record_id"),
    exportAttemptId: uuid("export_attempt_id"),
    exportPayloadHash: text("export_payload_hash"),
    exportUnconfirmed: boolean("export_unconfirmed").notNull().default(false),
    status: text().$type<CaseStatus>().notNull().generatedAlwaysAs(sql`case
    when exported_at is not null then 'exported'
    when export_started_at is not null then 'exporting'
    when approved_at is not null then 'approved'
    when review_started_at is not null then 'in_review'
    when mapped_at is not null then 'ready_for_review'
    when mapping_started_at is not null then 'mapping'
    when submitted_at is not null then 'queued'
    else 'draft' end`),
  },
  (t) => [
    check("cases_name", sql`length(${t.name}) between 1 and 255 and ${t.name} ~ '[^[:space:]]'`),
    check("cases_updated_order", ordered(sql`${t.updatedAt}`, sql`${t.createdAt}`)),
    check("cases_submitted_order", ordered(sql`${t.submittedAt}`, sql`${t.createdAt}`)),
    check("cases_mapping_order", ordered(sql`${t.mappingStartedAt}`, sql`${t.submittedAt}`)),
    check("cases_mapped_order", ordered(sql`${t.mappedAt}`, sql`${t.mappingStartedAt}`)),
    check("cases_review_order", ordered(sql`${t.reviewStartedAt}`, sql`${t.mappedAt}`)),
    check("cases_approval_order", ordered(sql`${t.approvedAt}`, sql`${t.reviewStartedAt}`)),
    check("cases_export_start_order", ordered(sql`${t.exportStartedAt}`, sql`${t.approvedAt}`)),
    check("cases_exported_order", ordered(sql`${t.exportedAt}`, sql`${t.exportStartedAt}`)),
    check("cases_mapping_result_nonblank", optionalNonblank(sql`${t.mappingResultKey}`)),
    check("cases_mapped_result", sql`${t.mappedAt} is null or ${t.mappingResultKey} is not null`),
    check("cases_approval_pair", sql`(${t.approvedAt} is null) = (${t.approvedBy} is null)`),

    check("cases_redcap_id_nonblank", optionalNonblank(sql`${t.redcapRecordId}`)),
    check("cases_export_receipt", sql`(${t.exportedAt} is null) = (${t.redcapRecordId} is null)`),
    check(
      "cases_export_unconfirmed",
      sql`not ${t.exportUnconfirmed} or (${t.exportStartedAt} is not null and ${t.exportedAt} is null)`,
    ),
    check(
      "cases_export_hash",
      sql`${t.exportPayloadHash} is null or ${t.exportPayloadHash} ~ '^[a-f0-9]{64}$'`,
    ),
    unique("cases_redcap_record").on(t.redcapRecordId),
    index("cases_owner_created").on(t.ownerId, t.createdAt.desc(), t.id.desc()),
  ],
);

export const caseMembers = application.table(
  "case_members",
  {
    caseId: uuid("case_id")
      .notNull()
      .references(() => cases.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    role: text().$type<"reviewer" | "viewer">().notNull(),
    grantedBy: text("granted_by")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    createdAt: time("created_at").notNull().defaultNow(),
  },
  (t) => [
    unique("case_members_case_user").on(t.caseId, t.userId),
    index("case_members_user").on(t.userId, t.caseId),
    check("case_members_role", sql`${t.role} in ('reviewer', 'viewer')`),
  ],
);

export const caseAuditEvents = application.table(
  "case_audit_events",
  {
    id: uuid().primaryKey().defaultRandom(),
    caseId: uuid("case_id")
      .notNull()
      .references(() => cases.id, { onDelete: "restrict" }),
    actorId: text("actor_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    attemptId: uuid("attempt_id"),
    kind: text()
      .notNull()
      .$type<
        | "approved"
        | "reopened"
        | "export_started"
        | "export_prepared"
        | "export_confirmed"
        | "exported"
        | "export_preflight_failed"
        | "export_unconfirmed"
      >(),
    payloadHash: text("payload_hash"),
    redcapRecordId: text("redcap_record_id"),
    createdAt: time("created_at").notNull().defaultNow(),
  },
  (t) => [
    check(
      "case_audit_kind",
      sql`${t.kind} in ('approved', 'reopened', 'export_started', 'export_prepared', 'export_confirmed', 'exported', 'export_preflight_failed', 'export_unconfirmed')`,
    ),
    check("case_audit_hash", sql`${t.payloadHash} is null or ${t.payloadHash} ~ '^[a-f0-9]{64}$'`),
    index("case_audit_case").on(t.caseId, t.createdAt),
  ],
);

// The append-only revision row is also the metadata-only save audit and idempotency receipt.
export const reviewRevisions = application.table(
  "review_revisions",
  {
    caseId: uuid("case_id")
      .notNull()
      .references(() => cases.id, { onDelete: "restrict" }),
    revision: integer().notNull(),
    requestId: uuid("request_id").notNull(),
    requestHash: text("request_hash").notNull(),
    artifactKey: text("artifact_key").notNull(),
    artifactVersionId: text("artifact_version_id").notNull(),
    artifactHash: text("artifact_hash").notNull(),
    actorId: text("actor_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    createdAt: time("created_at").notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.caseId, t.revision] }),
    unique("review_revisions_request").on(t.caseId, t.requestId),
    unique("review_revisions_artifact").on(t.artifactKey),
    check("review_revision_positive", sql`${t.revision} > 0`),
    check("review_request_hash", sql`${t.requestHash} ~ '^[a-f0-9]{64}$'`),
    check("review_artifact_hash", sql`${t.artifactHash} ~ '^[a-f0-9]{64}$'`),
    check("review_artifact_key", sql`${t.artifactKey} ~ '[^[:space:]]'`),
    check(
      "review_artifact_version",
      sql`${t.artifactVersionId} ~ '[^[:space:]]' and ${t.artifactVersionId} <> 'null'`,
    ),
  ],
);

export const caseReviews = application.table(
  "case_reviews",
  {
    caseId: uuid("case_id")
      .primaryKey()
      .references(() => cases.id, { onDelete: "restrict" }),
    currentRevision: integer("current_revision").notNull(),
    approvedRevision: integer("approved_revision"),
    blockingIssueCount: integer("blocking_issue_count").notNull().default(0),
    unresolvedFieldCount: integer("unresolved_field_count").notNull().default(0),
    unresolvedMarkCount: integer("unresolved_mark_count").notNull().default(0),
    unconfirmedSectionCount: integer("unconfirmed_section_count").notNull().default(0),
  },
  (t) => [
    foreignKey({
      columns: [t.caseId, t.currentRevision],
      foreignColumns: [reviewRevisions.caseId, reviewRevisions.revision],
    }),
    foreignKey({
      columns: [t.caseId, t.approvedRevision],
      foreignColumns: [reviewRevisions.caseId, reviewRevisions.revision],
    }),
    check(
      "review_approval_current",
      sql`${t.approvedRevision} is null or ${t.approvedRevision} = ${t.currentRevision}`,
    ),
  ],
);

export const documents = application.table(
  "documents",
  {
    id: uuid().primaryKey(),
    caseId: uuid("case_id")
      .notNull()
      .references(() => cases.id, { onDelete: "restrict" }),
    uploadedBy: text("uploaded_by")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    filename: text().notNull(),
    sizeBytes: bigint("size_bytes", { mode: "number" }),
    contentType: text("content_type").notNull(),
    storageBucket: text("storage_bucket").notNull(),
    storageKey: text("storage_key").notNull(),
    sourceVersionId: text("source_version_id"),
    kind: text().$type<DocumentKind>().notNull(),
    uploadedAt: time("uploaded_at"),
    extractionStartedAt: time("extraction_started_at"),
    extractedAt: time("extracted_at"),
    extractionResultKey: text("extraction_result_key"),
    createdAt: time("created_at").notNull().defaultNow(),
    updatedAt: time("updated_at").notNull().defaultNow(),
    status: text().$type<DocumentStatus>().notNull().generatedAlwaysAs(sql`case
    when extracted_at is not null then 'extracted'
    when extraction_started_at is not null then 'extracting'
    when uploaded_at is not null then 'uploaded'
    else 'awaiting_upload' end`),
  },
  (t) => [
    check(
      "documents_filename",
      sql`length(${t.filename}) between 1 and 255 and ${t.filename} ~ '[^[:space:]]'`,
    ),
    check("documents_size", sql`${t.sizeBytes} is null or ${t.sizeBytes} > 0`),
    check("documents_content_type", sql`${t.contentType} = 'image/jpeg'`),
    check("documents_storage_bucket", sql`${t.storageBucket} ~ '[^[:space:]]'`),
    check("documents_storage_key", sql`${t.storageKey} ~ '[^[:space:]]'`),
    check("documents_kind", sql`${t.kind} in ('text_description', 'sector_map')`),
    check("documents_source_version", optionalNonblank(sql`${t.sourceVersionId}`)),
    check("documents_uploaded_version", sql`${t.uploadedAt} is null or ${t.sourceVersionId} is not null`),
    check("documents_extraction_result_nonblank", optionalNonblank(sql`${t.extractionResultKey}`)),
    check(
      "documents_extracted_result",
      sql`${t.extractedAt} is null or ${t.extractionResultKey} is not null`,
    ),
    check("documents_updated_order", ordered(sql`${t.updatedAt}`, sql`${t.createdAt}`)),
    check("documents_uploaded_order", ordered(sql`${t.uploadedAt}`, sql`${t.createdAt}`)),
    check("documents_extraction_order", ordered(sql`${t.extractionStartedAt}`, sql`${t.uploadedAt}`)),
    check("documents_extracted_order", ordered(sql`${t.extractedAt}`, sql`${t.extractionStartedAt}`)),
    unique("documents_storage_identity").on(t.storageBucket, t.storageKey),
    unique("documents_case_kind").on(t.caseId, t.kind),
    index("documents_case").on(t.caseId),
    index("documents_uploader").on(t.uploadedBy),
  ],
);

export const casesRelations = relations(cases, ({ one, many }) => ({
  owner: one(user, { fields: [cases.ownerId], references: [user.id], relationName: "caseOwner" }),
  approver: one(user, { fields: [cases.approvedBy], references: [user.id], relationName: "caseApprover" }),
  documents: many(documents),
  members: many(caseMembers),
}));
export const caseMembersRelations = relations(caseMembers, ({ one }) => ({
  case: one(cases, { fields: [caseMembers.caseId], references: [cases.id] }),
  user: one(user, { fields: [caseMembers.userId], references: [user.id] }),
}));
export const documentsRelations = relations(documents, ({ one }) => ({
  case: one(cases, { fields: [documents.caseId], references: [cases.id] }),
  uploader: one(user, { fields: [documents.uploadedBy], references: [user.id] }),
}));
export const userRelations = relations(user, ({ many }) => ({
  cases: many(cases, { relationName: "caseOwner" }),
  approvals: many(cases, { relationName: "caseApprover" }),
  documents: many(documents),
}));
