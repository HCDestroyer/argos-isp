#!/usr/bin/env bash
# Llamada a la API de ArgosIsp con el usuario del panel, guardando la respuesta.
#
#   sudo scripts/laboratorio/api.sh <prueba> <nombre> <MÉTODO> <ruta bajo /api/v1> [cuerpo JSON]
#   p. ej.  sudo scripts/laboratorio/api.sh 04-velocidad vista-previa GET '/routers/3/vista-previa-control?a=arbol_pcq'
#
# Guarda la respuesta (JSON con formato) en $LAB_SALIDA/<prueba>/<nombre>.txt.
source "$(dirname "$0")/comun.sh"

[ $# -ge 4 ] || fallar "uso: $0 <prueba> <nombre> <MÉTODO> <ruta> [cuerpo JSON]"
P="$1" NOMBRE="$2"
shift 2
f="$(prueba_dir "$P")/$NOMBRE.txt"
printf '# %s\n# %s %s %s\n' "$(date -u +%FT%TZ)" "$1" "$2" "${3:-}" >> "$f"
if r="$(api "$@")"; then
    jq . <<< "$r" 2> /dev/null | tee -a "$f" || printf '%s\n' "$r" | tee -a "$f"
else
    printf '# falló (ver arriba)\n' >> "$f"
    exit 1
fi
