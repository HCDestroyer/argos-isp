#!/bin/sh
# Filas por tabla de un dump de pg_dump (formato custom), leídas del propio dump: cada tabla es un
# bloque COPY ... FROM stdin; con una fila por línea y termina en "\.". Salida: "<schema.tabla>\t<filas>",
# ordenada. Incluye las tablas vacías (pg_dump emite su COPY igual).
#
#   conteos_dump.sh <archivo.dump>
set -eu
[ $# -eq 1 ] || { echo "uso: conteos_dump.sh <archivo.dump>" >&2; exit 2; }

pg_restore --data-only --file=- "$1" | awk '
    !dentro && /^COPY / { tabla = $2; gsub(/"/, "", tabla); filas = 0; dentro = 1; next }
    dentro && $0 == "\\." { print tabla "\t" filas; dentro = 0; next }
    dentro { filas++ }
' | LC_ALL=C sort
