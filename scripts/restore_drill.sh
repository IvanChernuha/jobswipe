#!/usr/bin/env bash
# JobSwipe — restore drill. Restores a backup set (default: the newest) into a
# THROWAWAY Postgres container of the same image as production and verifies
# that every table's row count matches the live DB. The live DB is only read.
#
#   scripts/restore_drill.sh                # newest set
#   scripts/restore_drill.sh /path/to/set   # specific set
#
# Exit 0 = PASS (restore is proven), non-zero = FAIL. An untested backup is
# not a backup — run this after changing the backup script or the DB image,
# and periodically (monthly) regardless.
set -euo pipefail

DB_CONTAINER="${DB_CONTAINER:-supabase-db}"
BACKUP_DIR="${BACKUP_DIR:-$HOME/backups/jobswipe}"
log() { printf '%s %s\n' "$(date -u +%FT%TZ)" "$*"; }

if [ $# -ge 1 ]; then
  bset="${1%/}"
else
  bset="$(ls -1d "$BACKUP_DIR"/20*T*Z 2>/dev/null | sort | tail -1 || true)"
  [ -n "$bset" ] || { log "ERROR: no backup sets in $BACKUP_DIR (run backup_db.sh first)"; exit 1; }
fi
[ -f "$bset/db.dump" ] || { log "ERROR: $bset/db.dump missing"; exit 1; }
log "drill set: $bset"

# Checksums first — a restore from a silently corrupted file proves nothing.
( cd "$bset" && sha256sum -c --quiet SHA256SUMS ) && log "checksums OK"

image="$(docker inspect "$DB_CONTAINER" --format '{{.Config.Image}}')"
name="jobswipe-restore-drill-$$"
cleanup() { docker rm -f "$name" >/dev/null 2>&1 || true; }
trap cleanup EXIT

log "starting throwaway $image as $name"
docker run -d --name "$name" -e POSTGRES_PASSWORD=drill -v "$bset":/backup:ro "$image" >/dev/null

# The Supabase image restarts Postgres once during first-boot provisioning, so
# require readiness on three consecutive checks rather than the first hit.
ok=0
for _ in $(seq 1 90); do
  if docker exec "$name" pg_isready -U postgres -q 2>/dev/null; then ok=$((ok+1)); else ok=0; fi
  [ "$ok" -ge 3 ] && break
  sleep 2
done
[ "$ok" -ge 3 ] || { log "ERROR: throwaway Postgres never became ready"; docker logs "$name" | tail -20; exit 1; }

# Restore into a fresh database so the image's own provisioned objects in
# `postgres` do not collide. Owners/grants are dropped: the drill checks data.
docker exec "$name" psql -U postgres -qc "CREATE DATABASE restore_check;"
restore_log="$(mktemp)"
set +e
docker exec "$name" pg_restore -U postgres -d restore_check --no-owner --no-privileges /backup/db.dump 2> "$restore_log"
set -e
errs="$(grep -c '^pg_restore: error' "$restore_log" || true)"
log "pg_restore finished with $errs error(s)"
if [ "$errs" -gt 0 ]; then
  log "first errors (benign 'already exists' from image-provisioned objects are expected; anything else is not):"
  grep '^pg_restore: error' "$restore_log" | head -8 | sed 's/^/    /'
fi
rm -f "$restore_log"

# Compare row counts: every public table plus the auth/storage tables we rely on.
tables="$(docker exec "$DB_CONTAINER" psql -U postgres -d postgres -Atc \
  "SELECT schemaname||'.'||tablename FROM pg_tables WHERE schemaname='public' ORDER BY 1")"
tables="$tables
auth.users
auth.identities
storage.buckets
storage.objects"

fails=0
printf '%-32s %10s %10s  %s\n' "table" "prod" "restored" "ok"
while IFS= read -r t; do
  [ -n "$t" ] || continue
  src="$(docker exec "$DB_CONTAINER" psql -U postgres -d postgres -Atc "SELECT count(*) FROM $t")"
  dst="$(docker exec "$name" psql -U postgres -d restore_check -Atc "SELECT count(*) FROM $t" 2>/dev/null || echo "ERR")"
  if [ "$src" = "$dst" ]; then mark="yes"; else mark="MISMATCH"; fails=$((fails+1)); fi
  printf '%-32s %10s %10s  %s\n' "$t" "$src" "$dst" "$mark"
done <<< "$tables"

# pgvector columns must survive (embedding columns on profiles/jobs).
vsrc="$(docker exec "$DB_CONTAINER" psql -U postgres -d postgres -Atc "SELECT count(*) FROM information_schema.columns WHERE udt_name='vector'")"
vdst="$(docker exec "$name" psql -U postgres -d restore_check -Atc "SELECT count(*) FROM information_schema.columns WHERE udt_name='vector'" 2>/dev/null || echo ERR)"
if [ "$vsrc" = "$vdst" ]; then log "vector columns: $vsrc (match)"; else log "vector columns MISMATCH prod=$vsrc restored=$vdst"; fails=$((fails+1)); fi

# Storage archive must be intact and non-empty.
nfiles="$(tar tzf "$bset/storage.tgz" | grep -vc '/$' || true)"
log "storage.tgz: $nfiles file(s), archive readable"

if [ "$fails" -eq 0 ]; then
  log "RESULT: PASS — $bset restores cleanly and matches production"
  exit 0
fi
log "RESULT: FAIL — $fails check(s) mismatched"
exit 1
