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
#   <base>-<marca>.comprobantes.tar.gz[.age]  archivos de COMPROBANTES_DIR (tar comprimido, cifrado igual
#                                          que el dump), con su .sha256
#   ...comprobantes.conteo                 cantidad de archivos dentro del tar (restaurar.sh la compara)
#
# Variables:
#   PGHOST, PGPORT, PGUSER, PGPASSWORD   conexión (superusuario o el dueño de la base)
#   BACKUP_BASE            base a respaldar (argosisp)
#   BACKUP_DIR             directorio destino; móntalo en un disco externo o NFS (/backups)
#   BACKUP_RETENCION_DIAS  borra respaldos con más días que esto, local y remoto (14)
#   BACKUP_AGE_RECIPIENTS  claves públicas de age separadas por espacio (vacío = sin cifrar)
#   BACKUP_RCLONE_DESTINO  destino de rclone (p. ej. s3:argosisp-respaldos/prod); vacío = solo local.
#                          La configuración del remoto va en RCLONE_CONFIG_* o rclone.conf montado.
#   COMPROBANTES_DIR       carpeta de los comprobantes de depósito (los archivos no están en Postgres).
#                          Vacía = no se respaldan archivos; con valor, la carpeta debe existir.
#                          El tar se hace DESPUÉS del dump: todo comprobante del dump tiene su archivo.
set -eu

BASE="${BACKUP_BASE:-argosisp}"
DIR="${BACKUP_DIR:-/backups}"
RETENCION="${BACKUP_RETENCION_DIAS:-14}"
RECIPIENTES="${BACKUP_AGE_RECIPIENTS:-}"
REMOTO="${BACKUP_RCLONE_DESTINO:-}"
COMPROBANTES="${COMPROBANTES_DIR:-}"

log() { printf '%s respaldar: %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }

case "$RETENCION" in
    '' | *[!0-9]*) log "BACKUP_RETENCION_DIAS debe ser un número de días"; exit 2 ;;
esac
mkdir -p "$DIR"
if [ -n "$COMPROBANTES" ] && [ ! -d "$COMPROBANTES" ]; then
    log "COMPROBANTES_DIR=$COMPROBANTES no existe (¿falta montar el volumen?)"
    exit 2
fi

# Cifra con age si hay destinatarios: cifrar <origen> <destino>. Borra el origen.
cifrar() {
    args=""
    for r in $RECIPIENTES; do args="$args -r $r"; done
    # shellcheck disable=SC2086
    age $args -o "$2" "$1"
    rm -f "$1"
}

marca="$(date -u +%Y%m%dT%H%M%SZ)"
nombre="$BASE-$marca.dump"
parcial="$DIR/.$nombre.parcial"
tarparcial="$DIR/.$BASE-$marca.comprobantes.tar.gz.parcial"
trap 'rm -f "$parcial" "$tarparcial"' EXIT

log "pg_dump de $BASE"
pg_dump --format=custom --compress=6 --no-password --dbname="$BASE" --file="$parcial"
# El archivo debe poder leerse antes de darlo por bueno.
pg_restore --list "$parcial" > /dev/null

# Filas por tabla tal como quedaron en el dump (los COPY de cada tabla, una fila por línea).
"$(dirname "$0")/conteos_dump.sh" "$parcial" > "$DIR/$nombre.conteos"

final="$DIR/$nombre"
if [ -n "$RECIPIENTES" ]; then
    final="$final.age"
    cifrar "$parcial" "$final"
else
    mv "$parcial" "$final"
fi
(cd "$DIR" && sha256sum "$(basename "$final")" > "$(basename "$final").sha256")
log "listo $(basename "$final") ($(du -h "$final" | cut -f1), $(wc -l < "$DIR/$nombre.conteos") tablas)"

# Archivos de los comprobantes: tar comprimido con dueños numéricos (el usuario node de la imagen de
# api), contado desde el propio tar y cifrado igual que el dump.
tarfinal=""
if [ -n "$COMPROBANTES" ]; then
    tarnombre="$BASE-$marca.comprobantes.tar.gz"
    tar -czf "$tarparcial" -C "$COMPROBANTES" --numeric-owner .
    tar -tzf "$tarparcial" | grep -vc '/$' > "$DIR/$BASE-$marca.comprobantes.conteo" || true
    tarfinal="$DIR/$tarnombre"
    if [ -n "$RECIPIENTES" ]; then
        tarfinal="$tarfinal.age"
        cifrar "$tarparcial" "$tarfinal"
    else
        mv "$tarparcial" "$tarfinal"
    fi
    (cd "$DIR" && sha256sum "$(basename "$tarfinal")" > "$(basename "$tarfinal").sha256")
    log "listo $(basename "$tarfinal") ($(du -h "$tarfinal" | cut -f1), $(cat "$DIR/$BASE-$marca.comprobantes.conteo") archivos)"
fi

# Retención local: respaldos, comprobantes, sumas y conteos más viejos que RETENCION días.
find "$DIR" -maxdepth 1 -type f \( -name "$BASE-*.dump*" -o -name "$BASE-*.comprobantes.*" \) \
    -mtime "+$RETENCION" -print -delete |
    sed 's/^/retención: borrado /'

if [ -n "$REMOTO" ]; then
    log "copiando a $REMOTO"
    rclone copy "$final" "$REMOTO"
    rclone copy "$final.sha256" "$REMOTO"
    rclone copy "$DIR/$nombre.conteos" "$REMOTO"
    if [ -n "$tarfinal" ]; then
        rclone copy "$tarfinal" "$REMOTO"
        rclone copy "$tarfinal.sha256" "$REMOTO"
        rclone copy "$DIR/$BASE-$marca.comprobantes.conteo" "$REMOTO"
    fi
    rclone delete "$REMOTO" --min-age "${RETENCION}d" --include "$BASE-*.dump*" --include "$BASE-*.comprobantes.*"
fi
