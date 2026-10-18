#!/usr/bin/env bash
# Instalador de ArgosIsp para Ubuntu y Debian (A6, distribución). Un solo comando:
#
#   curl -fsSL https://github.com/HCDestroyer/argos-isp/releases/latest/download/instalar.sh | sudo bash
#
# Verifica requisitos, instala Docker si falta, pregunta el dominio y el correo del administrador,
# genera todas las contraseñas y claves, escribe /opt/argosisp/.env (600), descarga el paquete de la
# versión (docker-compose de producción y configuración), instala el comando `argosisp` y levanta.
# Nunca compila: las imágenes vienen ya hechas de ghcr.io. Runbook: docs/runbooks/instalacion.md.
#
# Opciones (sin ellas pregunta lo que falte):
#   --dominio D       dominio base: el panel queda en panel.D, la API en api.D y el portal en portal.D
#   --correo C        correo del administrador (usuario inicial del panel y avisos de Let's Encrypt)
#   --version X.Y.Z   versión a instalar (por defecto, la última del canal estable)
#   --dir RUTA        carpeta de la instalación (/opt/argosisp)
#   --si              no preguntar nada (requiere --dominio y --correo)
#
# Variables para pruebas o servidores sin internet: ARGOSISP_FUENTE (carpeta con `estable` y los
# paquetes de empaquetar.sh), ARGOSISP_SIN_DESCARGA=1 (imágenes ya cargadas), ARGOSISP_TLS=interno
# (certificados de la CA interna de Caddy en lugar de Let's Encrypt), ARGOSISP_REPO, ARGOSISP_REGISTRO.
set -Eeuo pipefail

REPO="${ARGOSISP_REPO:-HCDestroyer/argos-isp}"
REGISTRO="${ARGOSISP_REGISTRO:-ghcr.io/hcdestroyer}"
FUENTE="${ARGOSISP_FUENTE:-}"
DIR="${ARGOSISP_DIR:-/opt/argosisp}"
DOMINIO=""
CORREO=""
VERSION=""
SI=false
RAM_MINIMA_MB=1900
DISCO_MINIMO_GB=10
DOCKER_MINIMO=25
COMPOSE_MINIMO=2.24

log() { printf '\033[1m==>\033[0m %s\n' "$*" >&2; }
aviso() { printf '\033[33maviso:\033[0m %s\n' "$*" >&2; }
morir() { printf '\033[31merror:\033[0m %s\n' "$*" >&2; exit 1; }

while [ $# -gt 0 ]; do
    case "$1" in
        --dominio) DOMINIO="${2:-}"; shift 2 ;;
        --correo) CORREO="${2:-}"; shift 2 ;;
        --version) VERSION="${2#v}"; shift 2 ;;
        --dir) DIR="${2:-}"; shift 2 ;;
        --si) SI=true; shift ;;
        -h | --help) sed -n '2,22p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
        *) morir "opción desconocida: $1 (--help)" ;;
    esac
done

preguntar() {
    local texto="$1" valor=""
    $SI && morir "falta $texto (con --si van --dominio y --correo)"
    { : < /dev/tty; } 2> /dev/null || morir "falta $texto y no hay terminal para preguntarlo (usa --dominio y --correo)"
    printf '%s: ' "$texto" > /dev/tty
    read -r valor < /dev/tty || true
    printf '%s' "$valor"
}

# Texto aleatorio de letras y números (sin pipes que corten a medias con pipefail)
aleatorio() {
    local n="${1:-32}" s
    s="$(head -c 96 /dev/urandom | base64 -w0 | tr -dc 'A-Za-z0-9')"
    printf '%s' "${s:0:$n}"
}

version_mayor_igual() { [ "$(printf '%s\n%s\n' "$2" "$1" | sort -V | head -n1)" = "$2" ]; }

# ---------------------------------------------------------------------------
# 1. Requisitos
# ---------------------------------------------------------------------------
[ "$(id -u)" = 0 ] || morir "corre el instalador como root (sudo bash instalar.sh)"
[ -r /etc/os-release ] || morir "no encuentro /etc/os-release: solo Ubuntu y Debian"
# shellcheck disable=SC1091
. /etc/os-release
case "${ID:-}" in
    ubuntu | debian) ;;
    *) case " ${ID_LIKE:-} " in *" debian "*) aviso "distribución $ID (derivada de Debian): sin soporte oficial" ;; *) morir "solo Ubuntu y Debian (este es ${ID:-desconocido})" ;; esac ;;
esac
case "$(uname -m)" in
    x86_64 | amd64 | aarch64 | arm64) ;;
    *) morir "arquitectura $(uname -m) sin imágenes (solo amd64 y arm64)" ;;
esac
ram_mb=$(($(awk '/^MemTotal:/ {print $2}' /proc/meminfo) / 1024))
[ "$ram_mb" -ge "$RAM_MINIMA_MB" ] || morir "hacen falta 2 GB de RAM (hay ${ram_mb} MB)"
[ "$ram_mb" -ge 3800 ] || aviso "con ${ram_mb} MB de RAM funciona, pero se recomiendan 4 GB"
mkdir -p "$DIR"
disco_gb=$(($(df -Pk "$DIR" | awk 'NR==2 {print $4}') / 1024 / 1024))
[ "$disco_gb" -ge "$DISCO_MINIMO_GB" ] || morir "hacen falta ${DISCO_MINIMO_GB} GB libres en $DIR (hay ${disco_gb} GB)"
[ ! -f "$DIR/.env" ] || morir "ArgosIsp ya está instalado en $DIR. Para actualizar: argosisp actualizar"

log "instalando paquetes base (curl, jq, ca-certificates)"
export DEBIAN_FRONTEND=noninteractive
faltan=""
for p in curl jq ca-certificates tar gzip util-linux iproute2; do
    dpkg -s "$p" > /dev/null 2>&1 || faltan="$faltan $p"
done
if [ -n "$faltan" ]; then
    apt-get update -qq
    # shellcheck disable=SC2086
    apt-get install -y -qq $faltan > /dev/null
fi

for puerto in 80 443; do
    if ss -Hltn "sport = :$puerto" | grep -q .; then
        morir "el puerto TCP $puerto ya está en uso (ArgosIsp lo necesita para el panel, la API y el portal)"
    fi
done
for puerto in 1812 1813; do
    if ss -Hlun "sport = :$puerto" | grep -q .; then
        morir "el puerto UDP $puerto ya está en uso (RADIUS)"
    fi
done

# ---------------------------------------------------------------------------
# 2. Docker
# ---------------------------------------------------------------------------
if ! command -v docker > /dev/null; then
    log "instalando Docker desde el repositorio oficial (download.docker.com)"
    repo_id="$ID"
    case " ${ID_LIKE:-} " in *" ubuntu "*) repo_id=ubuntu ;; esac
    [ "$repo_id" = ubuntu ] || [ "$repo_id" = debian ] || repo_id=debian
    codename="${UBUNTU_CODENAME:-${VERSION_CODENAME:-}}"
    [ -n "$codename" ] || morir "no pude saber la versión de la distribución (VERSION_CODENAME)"
    install -m 0755 -d /etc/apt/keyrings
    curl -fsSL "https://download.docker.com/linux/$repo_id/gpg" -o /etc/apt/keyrings/docker.asc
    chmod a+r /etc/apt/keyrings/docker.asc
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/$repo_id $codename stable" \
        > /etc/apt/sources.list.d/docker.list
    apt-get update -qq
    apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin > /dev/null
    systemctl enable --now docker > /dev/null 2>&1 || true
fi
docker info > /dev/null 2>&1 || morir "Docker está instalado pero no responde (systemctl status docker)"
docker_version="$(docker version --format '{{.Server.Version}}')"
version_mayor_igual "$docker_version" "$DOCKER_MINIMO" || morir "hace falta Docker $DOCKER_MINIMO o más nuevo (hay $docker_version)"
compose_version="$(docker compose version --short 2> /dev/null || true)"
[ -n "$compose_version" ] || morir "falta el plugin docker compose (apt-get install docker-compose-plugin)"
version_mayor_igual "${compose_version#v}" "$COMPOSE_MINIMO" || morir "hace falta docker compose $COMPOSE_MINIMO o más nuevo (hay $compose_version)"

# ---------------------------------------------------------------------------
# 3. Datos mínimos
# ---------------------------------------------------------------------------
[ -n "$DOMINIO" ] || DOMINIO="$(preguntar 'Dominio base (ej. miisp.com.gt; el panel queda en panel.<dominio>)')"
DOMINIO="${DOMINIO,,}"
[[ "$DOMINIO" =~ ^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$ ]] || morir "dominio inválido: '$DOMINIO'"
[ -n "$CORREO" ] || CORREO="$(preguntar 'Correo del administrador')"
[[ "$CORREO" =~ ^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$ ]] || morir "correo inválido: '$CORREO'"
DOMINIO_PANEL="${ARGOSISP_DOMINIO_PANEL:-panel.$DOMINIO}"
DOMINIO_API="${ARGOSISP_DOMINIO_API:-api.$DOMINIO}"
DOMINIO_PORTAL="${ARGOSISP_DOMINIO_PORTAL:-portal.$DOMINIO}"

# ---------------------------------------------------------------------------
# 4. Paquete de la versión
# ---------------------------------------------------------------------------
if [ -z "$VERSION" ]; then
    if [ -n "$FUENTE" ]; then
        VERSION="$(tr -d '[:space:]' < "$FUENTE/estable")"
    else
        VERSION="$(curl -fsSL --retry 3 -H 'Accept: application/vnd.github+json' \
            "https://api.github.com/repos/$REPO/releases/latest" | jq -r '.tag_name // empty')"
        VERSION="${VERSION#v}"
    fi
fi
[[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || morir "no pude saber qué versión instalar (leí '$VERSION')"
log "instalando ArgosIsp $VERSION en $DIR"

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
paquete="argosisp-$VERSION.tar.gz"
if [ -n "$FUENTE" ]; then
    cp "$FUENTE/$paquete" "$FUENTE/$paquete.sha256" "$tmp/" || morir "no está el paquete de $VERSION en $FUENTE"
else
    base="https://github.com/$REPO/releases/download/v$VERSION"
    curl -fsSL --retry 3 -o "$tmp/$paquete" "$base/$paquete" || morir "no pude descargar $base/$paquete"
    curl -fsSL --retry 3 -o "$tmp/$paquete.sha256" "$base/$paquete.sha256" || morir "no pude descargar la suma del paquete"
fi
(cd "$tmp" && sha256sum -c --quiet "$paquete.sha256") || morir "la suma del paquete no coincide"
tar -xzf "$tmp/$paquete" -C "$tmp"
mkdir -p "$DIR/versiones"
rm -rf "${DIR:?}/versiones/$VERSION"
mv "$tmp/argosisp-$VERSION" "$DIR/versiones/$VERSION"
ln -sfn "versiones/$VERSION" "$DIR/actual"

# ---------------------------------------------------------------------------
# 5. .env con secretos generados (600, solo root)
# ---------------------------------------------------------------------------
mkdir -p "$DIR/respaldos" "$DIR/respaldos-config" "$DIR/estado" "$DIR/registros"
chmod 700 "$DIR/respaldos-config" "$DIR/estado" "$DIR/registros"
admin_password="$(aleatorio 20)"
tls_global="email $CORREO"
[ "${ARGOSISP_TLS:-}" = interno ] && tls_global="local_certs"

umask 077
cat > "$DIR/.env.nuevo" << EOF
# ArgosIsp · configuración de producción. Lo generó instalar.sh el $(date -u +%Y-%m-%dT%H:%M:%SZ).
# Solo root lo lee (600). No lo subas a ningún repositorio. Documentación de cada variable:
# infra/.env.example y docs/runbooks/instalacion.md. Después de editarlo: argosisp levantar

# Versión instalada (la cambia \`argosisp actualizar\`; no la edites a mano)
ARGOSISP_VERSION=$VERSION
ARGOSISP_REGISTRO=$REGISTRO

# Dominios (deben apuntar a este servidor)
DOMINIO_PANEL=$DOMINIO_PANEL
DOMINIO_API=$DOMINIO_API
DOMINIO_PORTAL=$DOMINIO_PORTAL
# Certificados: "email <correo>" = Let's Encrypt con avisos a ese correo
PROXY_TLS_GLOBAL="$tls_global"
# HSTS del portal en segundos: súbelo a 31536000 cuando el certificado funcione
PORTAL_HSTS_MAX_AGE=300

# Administrador inicial del panel (cámbiale la contraseña al entrar)
SEED_ADMIN_EMAIL=$CORREO
SEED_ADMIN_PASSWORD=$admin_password

# Claves de la aplicación (generadas; no las cambies después de instalar)
APP_KEY=$(aleatorio 48)
# Cifra contraseñas PPPoE y secrets RADIUS: sin ella no se pueden leer. Guárdala fuera del servidor.
AAA_PPP_KEY=$(head -c 32 /dev/urandom | base64 -w0)
AAA_INTERNAL_TOKEN=$(aleatorio 48)
RADIUS_LOCAL_SECRET=$(aleatorio 32)
METRICS_TOKEN=$(aleatorio 40)
TELEGRAM_WEBHOOK_SECRET=$(aleatorio 48)

# PostgreSQL: superusuario (respaldos), dueño (migraciones) y usuario de la aplicación
DB_PASSWORD=$(aleatorio 32)
DB_OWNER_USER=argosisp_owner
DB_OWNER_PASSWORD=$(aleatorio 32)
DB_APP_USER=argosisp_api
DB_APP_PASSWORD=$(aleatorio 32)

# Respaldos (infra/backups): carpeta del host (mejor un disco externo o NFS), hora UTC y retención
BACKUP_HOST_DIR=$DIR/respaldos
BACKUP_CONFIG_DIR=$DIR/respaldos-config
BACKUP_HORA=03:13
BACKUP_RETENCION_DIAS=14
# Cifrado con age (claves públicas) y copia remota con rclone: opcionales
BACKUP_AGE_RECIPIENTS=
BACKUP_RCLONE_DESTINO=

# RADIUS: IP del servidor por la que llegan los MikroTik (LAN o túnel WireGuard). 0.0.0.0 = todas
RADIUS_BIND_IP=0.0.0.0
# IP de origen de los CoA (la que el router tiene en /radius)
COA_ORIGEN_IP=

# Correo y Telegram: se configuran en el panel (Configuración → Notificaciones)
MAIL_FROM="ArgosIsp <no-responder@$DOMINIO>"
NOTIFY_EMPRESA_NOMBRE=ArgosIsp
EOF
mv -f "$DIR/.env.nuevo" "$DIR/.env"
chmod 600 "$DIR/.env"
umask 022

# ---------------------------------------------------------------------------
# 6. Comando argosisp y timer de parches (apagado)
# ---------------------------------------------------------------------------
ln -sfn "$DIR/actual/argosisp" /usr/local/bin/argosisp
if command -v systemctl > /dev/null && [ -d /run/systemd/system ]; then
    install -m 0644 "$DIR/actual/systemd/argosisp-actualizar.service" "$DIR/actual/systemd/argosisp-actualizar.timer" /etc/systemd/system/
    systemctl daemon-reload
fi

# ---------------------------------------------------------------------------
# 7. Imágenes y arranque
# ---------------------------------------------------------------------------
export ARGOSISP_DIR="$DIR"
compose=(docker compose -p argosisp --env-file "$DIR/.env" -f "$DIR/actual/docker-compose.yml")
"${compose[@]}" config --quiet || morir "el compose de $VERSION no es válido con el .env generado"
if [ "${ARGOSISP_SIN_DESCARGA:-0}" != 1 ]; then
    log "descargando imágenes de $REGISTRO (versión $VERSION)"
    "${compose[@]}" pull --quiet
fi
"$DIR/actual/argosisp" levantar || morir "ArgosIsp no quedó sano. Revisa: argosisp logs   (el .env queda en $DIR/.env)"

cat > "$DIR/credenciales-iniciales.txt" << EOF
Panel:    https://$DOMINIO_PANEL
Usuario:  $CORREO
Clave:    $admin_password
EOF
chmod 600 "$DIR/credenciales-iniciales.txt"

cat << EOF

ArgosIsp $VERSION instalado.

  Panel:    https://$DOMINIO_PANEL
  API:      https://$DOMINIO_API
  Portal:   https://$DOMINIO_PORTAL   (y /corte por HTTP en este servidor)
  Usuario:  $CORREO
  Clave:    $admin_password   (también en $DIR/credenciales-iniciales.txt; cámbiala al entrar y borra el archivo)

  Los tres dominios deben apuntar a este servidor para que Let's Encrypt emita los certificados.
  Guarda una copia de $DIR/.env fuera del servidor: AAA_PPP_KEY descifra las contraseñas PPPoE.

  argosisp estado        versión y salud
  argosisp actualizar    actualizar (respaldo y reversión automáticos)
  argosisp auto activar  parches automáticos diarios (apagado)

EOF
