#!/bin/sh
# Respaldo de la base de ArgosIsp (tarea 9). Una ejecución = un respaldo.
#
#   respaldar.sh                 # usa las variables de abajo
#
# Lo corre el servicio `backup` del compose (programar.sh, una vez al día) y se puede correr a mano:
#   docker compose -f infra/docker-compose.yml exec backup respaldar.sh
#
# Produce en BACKUP_DIR:
#   <base>-<AAAAMMDDTHHMMSSZ>.dump[.age]   pg_dump formato custom (comprimido), cifrado si hay destinatarios
#   ...dump[.age].sha256                   suma para verificar la copia
#   ...dump.conteos                        filas por tabla según el propio dump (restaurar.sh las compara)
#
# Variables:
#   PGHOST, PGPORT, PGUSER, PGPASSWORD   conexión (superusuario o el dueño de la base)
#   BACKUP_BASE            base a respaldar (argosisp)
#   BACKUP_DIR             directorio destino; móntalo en un disco externo o NFS (/backups)
#   BACKUP_RETENCION_DIAS  borra respaldos con más días que esto, local y remoto (14)
#   BACKUP_AGE_RECIPIENTS  claves públicas de age separadas por espacio (vacío = sin cifrar)
#   BACKUP_RCLONE_DESTINO  destino de rclone (p. ej. s3:argosisp-respaldos/prod); vacío = solo local.
#                          La configuración del remoto va en RCLONE_CONFIG_* o rclone.conf montado.
set -eu

BASE="${BACKUP_BASE:-argosisp}"
DIR="${BACKUP_DIR:-/backups}"
RETENCION="${BACKUP_RETENCION_DIAS:-14}"
RECIPIENTES="${BACKUP_AGE_RECIPIENTS:-}"
REMOTO="${BACKUP_RCLONE_DESTINO:-}"

log() { printf '%s respaldar: %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }

case "$RETENCION" in
    '' | *[!0-9]*) log "BACKUP_RETENCION_DIAS debe ser un número de días"; exit 2 ;;
esac
mkdir -p "$DIR"

marca="$(date -u +%Y%m%dT%H%M%SZ)"
nombre="$BASE-$marca.dump"
parcial="$DIR/.$nombre.parcial"
trap 'rm -f "$parcial"' EXIT

log "pg_dump de $BASE"
pg_dump --format=custom --compress=6 --no-password --dbname="$BASE" --file="$parcial"
# El archivo debe poder leerse antes de darlo por bueno.
pg_restore --list "$parcial" > /dev/null

# Filas por tabla tal como quedaron en el dump (los COPY de cada tabla, una fila por línea).
"$(dirname "$0")/conteos_dump.sh" "$parcial" > "$DIR/$nombre.conteos"

final="$DIR/$nombre"
if [ -n "$RECIPIENTES" ]; then
    final="$final.age"
    args=""
    for r in $RECIPIENTES; do args="$args -r $r"; done
    # shellcheck disable=SC2086
    age $args -o "$final" "$parcial"
    rm -f "$parcial"
else
    mv "$parcial" "$final"
fi
(cd "$DIR" && sha256sum "$(basename "$final")" > "$(basename "$final").sha256")
log "listo $(basename "$final") ($(du -h "$final" | cut -f1), $(wc -l < "$DIR/$nombre.conteos") tablas)"

# Retención local: respaldos, sumas y conteos más viejos que RETENCION días.
find "$DIR" -maxdepth 1 -type f -name "$BASE-*.dump*" -mtime "+$RETENCION" -print -delete |
    sed 's/^/retención: borrado /'

if [ -n "$REMOTO" ]; then
    log "copiando a $REMOTO"
    rclone copy "$final" "$REMOTO"
    rclone copy "$final.sha256" "$REMOTO"
    rclone copy "$DIR/$nombre.conteos" "$REMOTO"
    rclone delete "$REMOTO" --min-age "${RETENCION}d" --include "$BASE-*.dump*"
fi
