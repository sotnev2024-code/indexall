#!/usr/bin/env bash
# Автобекап ИНДЕКСАЛЛ: база Postgres (ежедневно) + uploads (раз в неделю).
#
# Установка на сервере (один раз):
#   mkdir -p /opt/backups && cp /opt/indexall/tools/backup/backup.sh /opt/backups/ \
#     && chmod +x /opt/backups/backup.sh \
#     && (crontab -l 2>/dev/null; echo "20 3 * * * /opt/backups/backup.sh >> /opt/backups/backup.log 2>&1") | crontab -
#
# Проверка вручную: /opt/backups/backup.sh
# Восстановление БД:
#   gunzip -c /opt/backups/db/indexall-ДАТА.sql.gz | docker exec -i indexall-db psql -U postgres indexall
# Восстановление uploads:
#   docker run --rm -v docker_uploads_data:/data -v /opt/backups/uploads:/b alpine \
#     sh -c "cd /data && tar xzf /b/uploads-ДАТА.tar.gz"
set -u

BACKUP_DIR=/opt/backups
DB_CONTAINER=indexall-db
DB_NAME=indexall
DB_USER=postgres
UPLOADS_VOLUME=docker_uploads_data   # docker volume ls | grep uploads — проверить имя
KEEP_DB_DAYS=14                      # сколько дней хранить дампы БД
KEEP_UPLOADS=3                       # сколько недельных архивов uploads хранить
STAMP=$(date +%F)

mkdir -p "$BACKUP_DIR/db" "$BACKUP_DIR/uploads"

echo "[$(date '+%F %T')] Бекап начат"

# ── 1. База данных: каждый запуск ────────────────────────────────
if docker exec "$DB_CONTAINER" pg_dump -U "$DB_USER" "$DB_NAME" | gzip > "$BACKUP_DIR/db/indexall-$STAMP.sql.gz"; then
  echo "  БД: ok ($(du -h "$BACKUP_DIR/db/indexall-$STAMP.sql.gz" | cut -f1))"
else
  echo "  БД: ОШИБКА pg_dump" >&2
fi

# ── 2. Uploads: только по воскресеньям (тяжёлый) ─────────────────
if [ "$(date +%u)" = "7" ] || [ "${FORCE_UPLOADS:-}" = "1" ]; then
  if docker run --rm -v "$UPLOADS_VOLUME":/data:ro -v "$BACKUP_DIR/uploads":/b alpine \
      tar czf "/b/uploads-$STAMP.tar.gz" -C /data .; then
    echo "  uploads: ok ($(du -h "$BACKUP_DIR/uploads/uploads-$STAMP.tar.gz" | cut -f1))"
  else
    echo "  uploads: ОШИБКА tar" >&2
  fi
fi

# ── 3. Ротация ───────────────────────────────────────────────────
find "$BACKUP_DIR/db" -name 'indexall-*.sql.gz' -mtime +"$KEEP_DB_DAYS" -delete
ls -1t "$BACKUP_DIR/uploads"/uploads-*.tar.gz 2>/dev/null | tail -n +$((KEEP_UPLOADS + 1)) | xargs -r rm -f

# ── 4. Страховка от переполнения диска ───────────────────────────
USED=$(df --output=pcent / | tail -1 | tr -dc '0-9')
if [ "${USED:-0}" -ge 90 ]; then
  echo "  ВНИМАНИЕ: диск заполнен на ${USED}% — старые бекапы подрезаны до минимума" >&2
  ls -1t "$BACKUP_DIR/db"/indexall-*.sql.gz 2>/dev/null | tail -n +4 | xargs -r rm -f
  ls -1t "$BACKUP_DIR/uploads"/uploads-*.tar.gz 2>/dev/null | tail -n +2 | xargs -r rm -f
fi

echo "[$(date '+%F %T')] Бекап завершён. Сейчас в хранилище:"
du -sh "$BACKUP_DIR/db" "$BACKUP_DIR/uploads" 2>/dev/null | sed 's/^/  /'
