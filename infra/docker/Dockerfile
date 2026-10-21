FROM docker.io/library/node:22-bookworm-slim@sha256:43ac6c60b8f89723f746e8a92ce91abd5017e627ce1ddfe4238355d3a30b772c AS app
WORKDIR /app
ARG RDS_CA_SHA256=56a0cae044b6cc433971d964347401692a92ea0294e392753a3ebdaee54d8b84
RUN node --input-type=module <<'JS'
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
const response = await fetch('https://truststore.pki.rds.amazonaws.com/eu-central-1/eu-central-1-bundle.pem');
assert.ok(response.ok, 'AWS RDS CA download failed');
const certificate = Buffer.from(await response.arrayBuffer());
assert.equal(createHash('sha256').update(certificate).digest('hex'), process.env.RDS_CA_SHA256);
await mkdir('/etc/prostapaper/certs', { recursive: true });
await writeFile('/etc/prostapaper/certs/rds-eu-central-1.pem', certificate);
JS
COPY packages/db/dist/seed.mjs ./
COPY packages/db/migrations/ ./migrations/
USER node
ENV MIGRATIONS_DIR=/app/migrations
COPY apps/api/dist/server.mjs apps/api/dist/server.mjs.map apps/api/dist/seed-users.mjs ./
COPY apps/api/dist/sample-cases/ ./sample-cases/
COPY apps/web/dist/ ./public/
EXPOSE 3000
CMD ["node", "--enable-source-maps", "server.mjs"]
