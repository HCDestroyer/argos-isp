#!/usr/bin/env bash
# Corre uno o varios comandos de RouterOS en el MikroTik por SSH y guarda la salida.
#
#   sudo -E LAB_ROUTER_SSH=admin@<router> scripts/laboratorio/ros.sh <prueba> <nombre> '<comando>' ['<comando>'...]
#   p. ej.  sudo -E scripts/laboratorio/ros.sh 02-pppoe router-conexion '/ppp active print detail' '/radius monitor 0 once'
#
# Guarda en $LAB_SALIDA/<prueba>/<nombre>.txt. Sin LAB_ROUTER_SSH dice qué pegar y dónde.
source "$(dirname "$0")/comun.sh"

[ $# -ge 3 ] || fallar "uso: $0 <prueba> <nombre> '<comando RouterOS>' ['<comando>'...]"
P="$1" NOMBRE="$2"
shift 2
for c in "$@"; do ros "$P" "$NOMBRE" "$c"; done
