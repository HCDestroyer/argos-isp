#!/usr/bin/env bash
# Arma el paquete de instalación de una versión (A6, distribución): lo que `instalar.sh` y
# `argosisp actualizar` descargan de GitHub Releases junto a las imágenes de GHCR.
#
#   infra/produccion/empaquetar.sh <versión> <carpeta-de-salida>
#
# Produce en la carpeta de salida:
#   argosisp-<versión>.tar.gz         carpeta argosisp-<versión>/ con:
#       docker-compose.yml            infra/produccion/docker-compose.produccion.yml
#       argosisp                      CLI (infra/produccion/argosisp)
#       instalar.sh                   instalador (el mismo que se publica suelto)
#       VERSION
#       config/postgres/              10-init.sql (sin base de pruebas) y 20-usuarios.sh
#       config/proxy/Caddyfile        proxy de producción
#       config/freeradius/            mods-enabled, sites-enabled (services/aaa) y clients.conf
#       systemd/                      argosisp-actualizar.service y .timer (parches automáticos)
#   argosisp-<versión>.tar.gz.sha256
#   instalar.sh                       copia suelta para `curl … | sudo bash`
#
# El tar es reproducible (orden, fechas y dueños fijos): el mismo commit da la misma suma.
set -euo pipefail

[ $# -eq 2 ] || { sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//'; exit 2; }
VERSION="$1"
SALIDA="$2"
[[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "versión inválida (MAYOR.MENOR.PARCHE): $VERSION" >&2; exit 2; }

AQUI="$(cd "$(dirname "$0")" && pwd)"
RAIZ="$(cd "$AQUI/../.." && pwd)"
mkdir -p "$SALIDA"
SALIDA="$(cd "$SALIDA" && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

D="$TMP/argosisp-$VERSION"
mkdir -p "$D/config/postgres" "$D/config/proxy" "$D/config/freeradius" "$D/systemd"

install -m 0644 "$AQUI/docker-compose.produccion.yml" "$D/docker-compose.yml"
install -m 0755 "$AQUI/argosisp" "$D/argosisp"
install -m 0755 "$AQUI/instalar.sh" "$D/instalar.sh"
printf '%s\n' "$VERSION" > "$D/VERSION"
install -m 0644 "$AQUI/config/postgres-init.sql" "$D/config/postgres/10-init.sql"
install -m 0755 "$RAIZ/infra/postgres/usuarios.sh" "$D/config/postgres/20-usuarios.sh"
install -m 0644 "$AQUI/config/Caddyfile" "$D/config/proxy/Caddyfile"
install -m 0644 "$AQUI/config/clients.conf" "$D/config/freeradius/clients.conf"
cp -RL "$RAIZ/services/aaa/freeradius/mods-enabled" "$D/config/freeradius/mods-enabled"
cp -RL "$RAIZ/services/aaa/freeradius/sites-enabled" "$D/config/freeradius/sites-enabled"
install -m 0644 "$AQUI/systemd/argosisp-actualizar.service" "$AQUI/systemd/argosisp-actualizar.timer" "$D/systemd/"
chmod -R u=rwX,go=rX "$D"

PAQUETE="argosisp-$VERSION.tar.gz"
tar --sort=name --mtime='@0' --owner=0 --group=0 --numeric-owner -C "$TMP" -cf - "argosisp-$VERSION" |
    gzip -n -9 > "$SALIDA/$PAQUETE"
(cd "$SALIDA" && sha256sum "$PAQUETE" > "$PAQUETE.sha256")
install -m 0755 "$AQUI/instalar.sh" "$SALIDA/instalar.sh"
echo "listo: $SALIDA/$PAQUETE ($(cut -d' ' -f1 "$SALIDA/$PAQUETE.sha256"))"
