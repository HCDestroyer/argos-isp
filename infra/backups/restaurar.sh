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
#   --comprobantes ARCH   tar de los comprobantes (por defecto el de la misma marca junto al dump:
#                         <base>-<marca>.comprobantes.tar.gz[.age]). Siempre se verifica si existe.
#   --comprobantes-dir D  además deja los archivos en D (en el compose: /comprobantes). D debe estar
#                         vacía, o con --reemplazar se vacía antes
#
# Variables: PGHOST, PGPORT, PGUSER, PGPASSWORD (superusuario: crea la base y asigna dueños),
#   DB_OWNER_USER (dueño de la base nueva, argosisp_owner), BACKUP_AGE_IDENTITY (archivo con la clave
#   privada de age, solo para .age).
#
# Verificación: las filas de cada tabla en la base restaurada deben ser exactamente las del dump
# (conteos_dump.sh). Comprobantes: la cantidad de archivos del tar debe ser la de su .conteo (y la de D
# después de copiarlos) y cada billing.comprobantes.archivo de la base restaurada debe estar en el tar.
# Cualquier diferencia termina con código 1.
set -eu

uso() { sed -n '2,24p' "$0" | sed 's/^# \{0,1\}//'; exit 2; }
log() { printf '%s restaurar: %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }

[ $# -ge 1 ] || uso
ARCHIVO="$1"; shift
BASE="argosisp_restaurada"
REEMPLAZAR=false
MIGRAR=""
COMPARAR=""
TAR=""
TAR_DESTINO=""
while [ $# -gt 0 ]; do
    case "$1" in
        --base) BASE="$2"; shift 2 ;;
        --reemplazar) REEMPLAZAR=true; shift ;;
        --migrar) MIGRAR="$2"; shift 2 ;;
        --comparar-con) COMPARAR="$2"; shift 2 ;;
        --comprobantes) TAR="$2"; shift 2 ;;
        --comprobantes-dir) TAR_DESTINO="$2"; shift 2 ;;
        -h | --help) uso ;;
        *) echo "opción desconocida: $1" >&2; uso ;;
    esac
done
DUENO="${DB_OWNER_USER:-argosisp_owner}"
AQUI="$(cd "$(dirname "$0")" && pwd)"
[ -f "$ARCHIVO" ] || { log "no existe $ARCHIVO"; exit 2; }
if [ -z "$TAR" ]; then
    prefijo="${ARCHIVO%.age}"
    prefijo="${prefijo%.dump}"
    for candidato in "$prefijo.comprobantes.tar.gz" "$prefijo.comprobantes.tar.gz.age"; do
        [ -f "$candidato" ] && TAR="$candidato"
    done
fi
[ -z "$TAR" ] || [ -f "$TAR" ] || { log "no existe $TAR"; exit 2; }
if [ -n "$TAR_DESTINO" ] && [ -z "$TAR" ]; then
    log "--comprobantes-dir sin tar de comprobantes junto a $ARCHIVO (usa --comprobantes)"
    exit 2
fi
# Antes de tocar la base: el destino de los comprobantes debe estar vacío o --reemplazar
if [ -n "$TAR_DESTINO" ] && [ -d "$TAR_DESTINO" ] && [ -n "$(ls -A "$TAR_DESTINO")" ] && ! $REEMPLAZAR; then
    log "$TAR_DESTINO no está vacía (usa --reemplazar)"
    exit 1
fi

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
psql_admin() { psql -X -v ON_ERROR_STOP=1 --no-password -At -d postgres "$@"; }

# 1. Integridad de los archivos
verificar_suma() {
    if [ -f "$1.sha256" ]; then
        (cd "$(dirname "$1")" && sha256sum -c "$(basename "$1").sha256" > /dev/null) ||
            { log "la suma sha256 de $(basename "$1") no coincide: archivo dañado"; exit 1; }
        log "sha256 correcto: $(basename "$1")"
    fi
}
# descifrar <archivo> <destino si es .age>: imprime la ruta legible
descifrar() {
    case "$1" in
        *.age)
            : "${BACKUP_AGE_IDENTITY:?Falta BACKUP_AGE_IDENTITY (clave privada de age) para descifrar}"
            age -d -i "$BACKUP_AGE_IDENTITY" -o "$2" "$1"
            log "descifrado: $(basename "$1")" >&2
            echo "$2"
            ;;
        *) echo "$1" ;;
    esac
}
verificar_suma "$ARCHIVO"
DUMP="$(descifrar "$ARCHIVO" "$TMP/respaldo.dump")"
pg_restore --list "$DUMP" > /dev/null

# Cuenta archivos (no directorios) bajo una carpeta
contar_archivos() { find "$1" -type f | wc -l | tr -d ' '; }

# 1b. Comprobantes: se extraen a una carpeta temporal y se cuentan antes de tocar la base
if [ -n "$TAR" ]; then
    verificar_suma "$TAR"
    TARGZ="$(descifrar "$TAR" "$TMP/comprobantes.tar.gz")"
    mkdir "$TMP/comprobantes"
    tar -xzf "$TARGZ" -C "$TMP/comprobantes" --numeric-owner
    hay="$(contar_archivos "$TMP/comprobantes")"
    conteo="${TAR%.age}"
    conteo="${conteo%.tar.gz}.conteo"
    if [ -f "$conteo" ]; then
        esperado="$(tr -d ' \n' < "$conteo")"
        [ "$hay" = "$esperado" ] ||
            { log "el tar de comprobantes trae $hay archivos y su .conteo dice $esperado"; exit 1; }
        log "comprobantes: $hay archivos, igual a su .conteo"
    else
        log "comprobantes: $hay archivos (sin .conteo para comparar)"
    fi
fi

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

# 5b. Cada comprobante de la base restaurada tiene su archivo en el tar
if [ -n "$TAR" ]; then
    : > "$TMP/rutas"
    if [ "$(psql -X --no-password -At -d "$BASE" -c "SELECT to_regclass('billing.comprobantes') IS NOT NULL")" = t ]; then
        psql -X -v ON_ERROR_STOP=1 --no-password -At -d "$BASE" \
            -c 'SELECT archivo FROM billing.comprobantes ORDER BY id' > "$TMP/rutas"
    fi
    faltan=0
    while IFS= read -r ruta; do
        [ -n "$ruta" ] || continue
        if [ ! -f "$TMP/comprobantes/$ruta" ]; then
            log "falta el archivo del comprobante: $ruta"
            faltan=$((faltan + 1))
        fi
    done < "$TMP/rutas"
    [ "$faltan" -eq 0 ] || { log "$faltan comprobantes de la base sin archivo en el tar"; exit 1; }
    log "los $(grep -c . "$TMP/rutas" || true) comprobantes de la base tienen su archivo"

    if [ -n "$TAR_DESTINO" ]; then
        mkdir -p "$TAR_DESTINO"
        if [ -n "$(ls -A "$TAR_DESTINO")" ]; then
            $REEMPLAZAR || { log "$TAR_DESTINO no está vacía (usa --reemplazar)"; exit 1; }
            log "vaciando $TAR_DESTINO"
            find "$TAR_DESTINO" -mindepth 1 -delete
        fi
        # Copia con dueños y permisos del tar (el usuario node de la imagen de api)
        tar -xzf "$TARGZ" -C "$TAR_DESTINO" --numeric-owner
        copiados="$(contar_archivos "$TAR_DESTINO")"
        [ "$copiados" = "$hay" ] ||
            { log "$TAR_DESTINO tiene $copiados archivos y el tar $hay"; exit 1; }
        log "comprobantes restaurados en $TAR_DESTINO ($copiados archivos)"
    fi
fi

# 6. Migraciones al día con el código actual
if [ -n "$MIGRAR" ]; then
    log "migraciones: $MIGRAR"
    DB_DATABASE="$BASE" sh -c "$MIGRAR"
fi
log "listo: $BASE"
