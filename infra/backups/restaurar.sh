#!/bin/sh
# Restaura un respaldo de respaldar.sh en una base NUEVA y comprueba que quedó completo (tarea 9).
#
#   restaurar.sh <archivo.dump | archivo.dump.age> [opciones]
#
#   --base NOMBRE         base destino (por defecto argosisp_restaurada). Debe no existir...
#   --reemplazar          ...o se borra antes (DROP DATABASE ... WITH (FORCE)). Para el entorno limpio
#                         de un desastre: --base argosisp --reemplazar
#   --migrar 'CMD'        después de verificar, corre CMD con DB_DATABASE=<base> exportada para poner
#                         las migraciones al día con el código actual. En el servidor:
#                         --migrar 'docker compose -f infra/docker-compose.yml run --rm -e DB_DATABASE="$DB_DATABASE" migrate'
#   --comparar-con BASE   además compara las filas por tabla con otra base viva (p. ej. la de origen
#                         cuando está quieta, para probar el ciclo completo)
#
# Variables: PGHOST, PGPORT, PGUSER, PGPASSWORD (superusuario: crea la base y asigna dueños),
#   DB_OWNER_USER (dueño de la base nueva, argosisp_owner), BACKUP_AGE_IDENTITY (archivo con la clave
#   privada de age, solo para .age).
#
# Verificación: las filas de cada tabla en la base restaurada deben ser exactamente las del dump
# (conteos_dump.sh). Cualquier diferencia termina con código 1 y la lista de tablas.
set -eu

uso() { sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//'; exit 2; }
log() { printf '%s restaurar: %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }

[ $# -ge 1 ] || uso
ARCHIVO="$1"; shift
BASE="argosisp_restaurada"
REEMPLAZAR=false
MIGRAR=""
COMPARAR=""
while [ $# -gt 0 ]; do
    case "$1" in
        --base) BASE="$2"; shift 2 ;;
        --reemplazar) REEMPLAZAR=true; shift ;;
        --migrar) MIGRAR="$2"; shift 2 ;;
        --comparar-con) COMPARAR="$2"; shift 2 ;;
        -h | --help) uso ;;
        *) echo "opción desconocida: $1" >&2; uso ;;
    esac
done
DUENO="${DB_OWNER_USER:-argosisp_owner}"
AQUI="$(cd "$(dirname "$0")" && pwd)"
[ -f "$ARCHIVO" ] || { log "no existe $ARCHIVO"; exit 2; }

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
psql_admin() { psql -X -v ON_ERROR_STOP=1 --no-password -At -d postgres "$@"; }

# 1. Integridad del archivo
if [ -f "$ARCHIVO.sha256" ]; then
    (cd "$(dirname "$ARCHIVO")" && sha256sum -c "$(basename "$ARCHIVO").sha256" > /dev/null) ||
        { log "la suma sha256 no coincide: archivo dañado"; exit 1; }
    log "sha256 correcto"
fi

DUMP="$ARCHIVO"
case "$ARCHIVO" in
    *.age)
        : "${BACKUP_AGE_IDENTITY:?Falta BACKUP_AGE_IDENTITY (clave privada de age) para descifrar}"
        DUMP="$TMP/respaldo.dump"
        age -d -i "$BACKUP_AGE_IDENTITY" -o "$DUMP" "$ARCHIVO"
        log "descifrado"
        ;;
esac
pg_restore --list "$DUMP" > /dev/null

# 2. Filas esperadas según el propio dump
"$AQUI/conteos_dump.sh" "$DUMP" > "$TMP/esperado"
log "el dump trae $(wc -l < "$TMP/esperado") tablas y $(awk -F '\t' '{ s += $2 } END { print s + 0 }' "$TMP/esperado") filas"

# 3. Base nueva con el dueño y la zona de la base original
for rol in "$DUENO" argosisp_app; do
    [ "$(psql_admin -c "SELECT 1 FROM pg_roles WHERE rolname = '$rol'")" = 1 ] ||
        { log "falta el rol $rol: corre infra/postgres/usuarios.sh en este servidor"; exit 1; }
done
if [ "$(psql_admin -c "SELECT 1 FROM pg_database WHERE datname = '$BASE'")" = 1 ]; then
    $REEMPLAZAR || { log "la base $BASE ya existe (usa --reemplazar o --base otro_nombre)"; exit 1; }
    log "borrando $BASE"
    psql_admin -c "DROP DATABASE \"$BASE\" WITH (FORCE)" > /dev/null
fi
psql_admin -c "CREATE DATABASE \"$BASE\" OWNER \"$DUENO\"" > /dev/null
psql_admin -c "ALTER DATABASE \"$BASE\" SET timezone TO 'UTC'" > /dev/null
psql_admin -d "$BASE" -c "REVOKE CREATE ON SCHEMA public FROM PUBLIC" > /dev/null

# 4. Restauración (dueños y permisos del dump; los roles ya existen)
log "pg_restore en $BASE"
pg_restore --exit-on-error --no-password --dbname="$BASE" "$DUMP"

# 5. Conteo de filas de cada tabla
conteos_base() {
    psql -X -v ON_ERROR_STOP=1 --no-password -At -F "$(printf '\t')" -d "$1" <<'SQL' | LC_ALL=C sort
SELECT n.nspname || '.' || c.relname,
       (xpath('/row/c/text()',
              query_to_xml(format('SELECT count(*) AS c FROM %I.%I', n.nspname, c.relname), false, true, '')))[1]::text
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE c.relkind = 'r'
   AND n.nspname NOT IN ('pg_catalog', 'information_schema')
   AND n.nspname NOT LIKE 'pg_toast%'
SQL
}
conteos_base "$BASE" > "$TMP/restaurado"
if ! diff "$TMP/esperado" "$TMP/restaurado" > "$TMP/diferencias"; then
    log "las filas restauradas no coinciden con el dump (< dump, > base):"
    cat "$TMP/diferencias"
    exit 1
fi
log "filas por tabla iguales al dump ($(wc -l < "$TMP/restaurado") tablas)"

if [ -n "$COMPARAR" ]; then
    conteos_base "$COMPARAR" > "$TMP/origen"
    if ! diff "$TMP/origen" "$TMP/restaurado" > "$TMP/diferencias"; then
        log "diferencias con $COMPARAR (< origen, > restaurada):"
        cat "$TMP/diferencias"
        exit 1
    fi
    log "filas por tabla iguales a $COMPARAR"
fi

# 6. Migraciones al día con el código actual
if [ -n "$MIGRAR" ]; then
    log "migraciones: $MIGRAR"
    DB_DATABASE="$BASE" sh -c "$MIGRAR"
fi
log "listo: $BASE"
