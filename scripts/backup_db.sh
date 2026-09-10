#!/usr/bin/env bash
# JobSwipe — back up the self-hosted Supabase Postgres and Storage files.
#
# Writes one timestamped set under $BACKUP_DIR/<UTC timestamp>/:
#   db.dump      pg_dump (custom format, compressed) of the `postgres` DB —
#                app tables + auth.* + storage.* metadata. The `_supabase`
#                DB (Logflare analytics) is deliberately skipped: regenerable.
#   roles.sql    pg_dumpall --roles-only. Not needed when restoring into the
#                same Supabase image (roles are pre-provisioned) but required
#                for a plain Postgres target.
#   storage.tgz  Supabase Storage object files (avatars, resumes). The DB only
#                holds their metadata in storage.objects.
#   SHA256SUMS
#
# Then verifies db.dump is readable (pg_restore --list) and prunes sets older
# than RETENTION_DAYS. Optional off-box copy: set BACKUP_RCLONE_REMOTE (e.g.
# "gcs:jobswipe-backups") with rclone configured on the host.
#
# Restore/verify with scripts/restore_drill.sh. Run from cron, e.g.:
#   0 3 * * * /home/ivan/jobswipe/scripts/backup_db.sh >> /home/ivan/backups/jobswipe/backup.log 2>&1
set -euo pipefail

DB_CONTAINER="${DB_CONTAINER:-supabase-db}"
STORAGE_CONTAINER="${STORAGE_CONTAINER:-supabase-storage}"
STORAGE_PATH_IN_CONTAINER="${STORAGE_PATH_IN_CONTAINER:-/var/lib/storage}"
BACKUP_DIR="${BACKUP_DIR:-$HOME/backups/jobswipe}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"
BACKUP_RCLONE_REMOTE="${BACKUP_RCLONE_REMOTE:-}"

ts="$(date -u +%Y%m%dT%H%M%SZ)"
out="$BACKUP_DIR/$ts"
log() { printf '%s %s\n' "$(date -u +%FT%TZ)" "$*"; }
fail() { log "ERROR: $*"; exit 1; }

docker inspect "$DB_CONTAINER" >/dev/null 2>&1 || fail "container $DB_CONTAINER not found"
mkdir -p "$out"
log "backup -> $out"

# 1. Database. Custom format keeps the dump full-fidelity (owners, grants);
#    the drill decides what to drop at restore time.
docker exec "$DB_CONTAINER" pg_dump -U postgres -d postgres -Fc > "$out/db.dump"
docker exec "$DB_CONTAINER" pg_dumpall -U postgres --roles-only > "$out/roles.sql"
log "db.dump $(du -h "$out/db.dump" | cut -f1), roles.sql $(du -h "$out/roles.sql" | cut -f1)"

# 2. Storage files, read through a helper container that shares the storage
#    container's volumes so host file permissions never get in the way.
docker inspect "$STORAGE_CONTAINER" >/dev/null 2>&1 || fail "container $STORAGE_CONTAINER not found"
docker run --rm --volumes-from "$STORAGE_CONTAINER":ro alpine:3.20 \
  tar czf - -C "$STORAGE_PATH_IN_CONTAINER" . > "$out/storage.tgz"
log "storage.tgz $(du -h "$out/storage.tgz" | cut -f1) ($(tar tzf "$out/storage.tgz" | grep -vc '/$') files)"

# 3. Integrity: the dump must be parseable, and record checksums.
docker exec -i "$DB_CONTAINER" pg_restore --list < "$out/db.dump" > /dev/null \
  || fail "db.dump failed pg_restore --list (corrupt dump)"
( cd "$out" && sha256sum db.dump roles.sql storage.tgz > SHA256SUMS )
log "verified; SHA256SUMS written"

# 4. Optional off-box copy.
if [ -n "$BACKUP_RCLONE_REMOTE" ]; then
  command -v rclone >/dev/null || fail "BACKUP_RCLONE_REMOTE set but rclone not installed"
  rclone copy "$out" "$BACKUP_RCLONE_REMOTE/$ts" && log "copied to $BACKUP_RCLONE_REMOTE/$ts"
fi

# 5. Retention (only our own timestamped dirs).
find "$BACKUP_DIR" -mindepth 1 -maxdepth 1 -type d -name '20*T*Z' -mtime +"$RETENTION_DAYS" \
  -exec rm -rf {} + 2>/dev/null || true
log "done ($(ls -1d "$BACKUP_DIR"/20*T*Z 2>/dev/null | wc -l) sets retained, ${RETENTION_DAYS}d retention)"
