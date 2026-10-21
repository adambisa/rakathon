#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
temporary="$(mktemp -d)"
free_port() { node -e 'const s=require("node:net").createServer();s.listen(0,"127.0.0.1",()=>{console.log(s.address().port);s.close()})'; }
app_port="$(free_port)"
# An explicit host port stays stable when the outage test stops and starts db.
export API_ENV_FILE="$temporary/api.env" WEB_PORT="$app_port" DB_LOCAL_PORT="$(free_port)"
export COMPOSE_PROJECT_NAME="prostapaper-test-$$"
export SEED_USER_PASSWORD=container-test-password
export DB_ADMIN_USER=container_admin
export APP_IMAGE="${APP_IMAGE:-prostapaper:test-$$}"
compose() { docker compose --project-name "$COMPOSE_PROJECT_NAME" "$@"; }
cleanup() {
  compose down --volumes --remove-orphans >/dev/null 2>&1 || true
  rm -rf "$temporary"
}
trap cleanup EXIT
cp apps/api/.env.example "$API_ENV_FILE"
printf 'SEED_USER_PASSWORD=%s\n' "$SEED_USER_PASSWORD" >> "$API_ENV_FILE"
address="http://127.0.0.1:$app_port"
printf 'BETTER_AUTH_URL=%s\n' "$address" >> "$API_ENV_FILE"
if [[ "$APP_IMAGE" == *@sha256:* ]]; then compose pull --quiet app; else compose build app; fi
compose up -d --wait --wait-timeout 90 db
compose exec -T db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 -v app_user="$PGUSER" -v app_password="$POSTGRES_PASSWORD"' <<'SQL'
SELECT current_database() AS app_database \gset
CREATE ROLE :"app_user" LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD :'app_password';
REVOKE ALL ON DATABASE :"app_database" FROM PUBLIC;
GRANT ALL PRIVILEGES ON DATABASE :"app_database" TO :"app_user";
SQL
compose up -d --no-build --wait --wait-timeout 90 app
compose run --rm seed-users
curl --fail --silent --max-time 10 "$address/" > "$temporary/index.html"
grep -q '<div id="root"' "$temporary/index.html"
curl --fail --silent --max-time 10 "$address/api/health" >/dev/null
for cookie in '' 'prostapaper.session_token=forged'; do
  [ "$(curl --silent --max-time 10 --output /dev/null --write-out '%{http_code}' -H "Cookie: $cookie" "$address/api/trpc/me")" = 401 ]
done
[ "$(curl --silent --max-time 10 --output /dev/null --write-out '%{http_code}' -X POST \
  -H 'Content-Type: application/json' -H "Origin: $address" \
  -d '{"email":"registered@prostapaper.local","name":"Registered","password":"'"$SEED_USER_PASSWORD"'"}' \
  "$address/api/trpc/auth.signUp")" = 200 ]
curl --fail --silent --max-time 10 --cookie-jar "$temporary/cookies" -X POST \
  -H 'Content-Type: application/json' -H "Origin: $address" \
  -d '{"email":"reviewer@prostapaper.local","password":"'"$SEED_USER_PASSWORD"'"}' \
  "$address/api/trpc/auth.signIn" >/dev/null
grep -q 'prostapaper.session_token' "$temporary/cookies"
curl --fail --silent --max-time 10 --cookie "$temporary/cookies" "$address/api/trpc/me" >/dev/null
for path in /api/not-found /assets/not-found.js; do
  [ "$(curl --silent --max-time 10 --output /dev/null --write-out '%{http_code}' "$address$path")" = 404 ]
done
curl --fail --silent --max-time 10 "$address/dokumenty" > "$temporary/route.html"
cmp "$temporary/index.html" "$temporary/route.html"
curl --fail --silent --head --max-time 10 "$address/" | tr -d '\r' | grep -qi '^cache-control: no-store$'
asset="$(sed -n 's/.*src="\([^"]*\/assets\/[^\"]*\.js\)".*/\1/p' "$temporary/index.html" | head -1)"
[ -n "$asset" ]
curl --fail --silent --head --max-time 10 "$address$asset" | tr -d '\r' | grep -qi '^cache-control: public, max-age=31536000, immutable$'
if [ "${RUN_INTEGRATION_TESTS:-0}" = 1 ]; then
  export NODE_ENV=production INTEGRATION_URL="$address" PGHOST=127.0.0.1
  PGPORT="$(compose port db 5432 | cut -d: -f2)"
  export PGPORT
  pnpm exec turbo run test:integration --filter=@prostapaper/api
fi
echo 'Production image routing, auth, assets and migrations verified.'
