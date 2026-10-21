-- The uploader now says which scan is the report and which the schema, so a document has its kind
-- from registration on and routing can pick the reader before extraction runs.
ALTER TABLE "app"."documents" DROP CONSTRAINT "documents_kind_extracted";