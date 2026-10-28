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
# Nodo portal remoto (solo el portal y su proxy; habla únicamente con la API central por HTTPS):
#   --rol portal --central https://api.<dominio> --token <token de `argosisp nodo-portal crear`>
#   El portal del nodo queda en portal.D (o ARGOSISP_DOMINIO_PORTAL). Sin --version instala la del
#   central. Sin Postgres, Redis, migraciones ni workers.
#
# Variables para pruebas o servidores sin internet: ARGOSISP_FUENTE (carpeta con `estable` y los
# paquetes de empaquetar.sh), ARGOSISP_SIN_DESCARGA=1 (imágenes ya cargadas), ARGOSISP_TLS=interno
# (certificados de la CA interna de Caddy en lugar de Let's Encrypt), ARGOSISP_REPO, ARGOSISP_REGISTRO,
# ARGOSISP_API_PORTAL=si|no (API del portal; por defecto si, no con menos de 3 GB de RAM),
# ARGOSISP_HTTP_PORT y ARGOSISP_HTTPS_PORT (puertos del proxy), ARGOSISP_PROXIES_CONFIABLES (IP o
# CIDR del proxy de delante, p. ej. Nginx Proxy Manager: docs/runbooks/detras-de-proxy.md), y para un nodo portal de prueba
# ARGOSISP_NODO_CENTRAL_DIRECCION (host:puerto al que se conecta) y ARGOSISP_NODO_CENTRAL_TLS=inseguro.
set -Eeuo pipefail

# Todo el instalador va dentro de main(), que se llama en la última línea. Con
# `curl … | sudo bash`, bash lee el script de stdin a medida que lo ejecuta: un hijo que lea stdin
# (`docker compose exec`, apt-get…) se tragaba el resto y la instalación terminaba sin mostrar la
# clave ni escribir credenciales-iniciales.txt. Así bash lee la función completa antes de correr
# nada. Además, cada comando que podría leer stdin va con < /dev/null; las preguntas leen /dev/tty.
main() {

REPO="${ARGOSISP_REPO:-HCDestroyer/argos-isp}"
REGISTRO="${ARGOSISP_REGISTRO:-ghcr.io/hcdestroyer}"
FUENTE="${ARGOSISP_FUENTE:-}"
DIR="${ARGOSISP_DIR:-/opt/argosisp}"
DOMINIO=""
CORREO=""
VERSION=""
SI=false
ROL=completo
CENTRAL=""
TOKEN=""
RAM_MINIMA_MB=1900
HTTP_PORT="${ARGOSISP_HTTP_PORT:-80}"
HTTPS_PORT="${ARGOSISP_HTTPS_PORT:-443}"
PROXIES="${ARGOSISP_PROXIES_CONFIABLES:-}"
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
        --rol) ROL="${2:-}"; shift 2 ;;
        --central) CENTRAL="${2:-}"; shift 2 ;;
        --token) TOKEN="${2:-}"; shift 2 ;;
        -h | --help) sed -n '2,/^set -E/{/^#/p}' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
        *) morir "opción desconocida: $1 (--help)" ;;
    esac
done

case "$ROL" in
    completo) [ -z "$CENTRAL$TOKEN" ] || morir "--central y --token son solo para --rol portal" ;;
    portal)
        [ -n "$CENTRAL" ] || morir "--rol portal requiere --central https://api.<dominio>"
        [ -n "$TOKEN" ] || morir "--rol portal requiere --token (argosisp nodo-portal crear <nombre> en el servidor principal)"
        [[ "$CENTRAL" =~ ^https://([a-z0-9.-]+)(:([0-9]+))?/?$ ]] || morir "--central debe ser https://<host>[:puerto] (es '$CENTRAL')"
        CENTRAL_HOST="${BASH_REMATCH[1]}"
        CENTRAL_PUERTO="${BASH_REMATCH[3]:-443}"
        CENTRAL="https://$CENTRAL_HOST$([ "$CENTRAL_PUERTO" = 443 ] || echo ":$CENTRAL_PUERTO")"
        [[ "$TOKEN" =~ ^[A-Za-z0-9._~-]{16,512}$ ]] || morir "token inválido"
        RAM_MINIMA_MB=900
        ;;
    *) morir "--rol debe ser completo o portal (es '$ROL')" ;;
esac

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
# Se lee en un subshell: /etc/os-release define VERSION y pisaría la versión de ArgosIsp.
# shellcheck disable=SC1091
read -r ID ID_LIKE UBUNTU_CODENAME VERSION_CODENAME < <(
    . /etc/os-release
    printf '%s %s %s %s\n' "${ID:--}" "$(echo "${ID_LIKE:--}" | tr ' ' ',')" "${UBUNTU_CODENAME:--}" "${VERSION_CODENAME:--}"
)
ID_LIKE="${ID_LIKE//,/ }"
for v in ID ID_LIKE UBUNTU_CODENAME VERSION_CODENAME; do [ "${!v}" != - ] || printf -v "$v" ''; done
case "${ID:-}" in
    ubuntu | debian) ;;
    *) case " ${ID_LIKE:-} " in *" debian "*) aviso "distribución $ID (derivada de Debian): sin soporte oficial" ;; *) morir "solo Ubuntu y Debian (este es ${ID:-desconocido})" ;; esac ;;
esac
case "$(uname -m)" in
    x86_64 | amd64 | aarch64 | arm64) ;;
    *) morir "arquitectura $(uname -m) sin imágenes (solo amd64 y arm64)" ;;
esac
ram_mb=$(($(awk '/^MemTotal:/ {print $2}' /proc/meminfo) / 1024))
[ "$ram_mb" -ge "$RAM_MINIMA_MB" ] || morir "hacen falta $([ "$ROL" = portal ] && echo '1 GB' || echo '2 GB') de RAM (hay ${ram_mb} MB)"
[ "$ROL" = portal ] || [ "$ram_mb" -ge 3800 ] || aviso "con ${ram_mb} MB de RAM funciona, pero se recomiendan 4 GB"
# API del portal (servicio api-portal): si por defecto; no con menos de 3 GB (MemTotal < 2900 MB:
# el kernel reserva parte). ARGOSISP_API_PORTAL=si|no en el entorno lo fuerza.
API_PORTAL="${ARGOSISP_API_PORTAL:-}"
[ "$ROL" = completo ] || API_PORTAL=no
if [ -z "$API_PORTAL" ]; then
    API_PORTAL=si
    if [ "$ram_mb" -lt 2900 ]; then
        API_PORTAL=no
        aviso "con ${ram_mb} MB de RAM (menos de 3 GB) la API del portal (api-portal) queda apagada: ARGOSISP_API_PORTAL=no"
    fi
fi
case "$API_PORTAL" in si | no) ;; *) morir "ARGOSISP_API_PORTAL debe ser si o no (es '$API_PORTAL')" ;; esac
# Proxies de confianza (Caddy: trusted_proxies static): IP o CIDR separados por espacio o coma. Se
# validan aquí porque una entrada mala impide que Caddy arranque.
proxies_ok=""
for p in ${PROXIES//,/ }; do
    [[ "$p" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}(/([0-9]|[12][0-9]|3[0-2]))?$ ||
        "$p" =~ ^[0-9A-Fa-f]*:[0-9A-Fa-f:.]*(/([0-9]|[1-9][0-9]|1[01][0-9]|12[0-8]))?$ ]] ||
        morir "ARGOSISP_PROXIES_CONFIABLES: '$p' no es una IP ni un CIDR (separa con espacios o comas)"
    proxies_ok="${proxies_ok:+$proxies_ok }$p"
done
PROXIES="$proxies_ok"
[ -z "$PROXIES" ] || [ "${ARGOSISP_TLS:-}" = interno ] ||
    aviso "con un proxy delante (ARGOSISP_PROXIES_CONFIABLES) los retos de Let's Encrypt los recibe el proxy, no Caddy: usa ARGOSISP_TLS=interno (el certificado público lo pone el proxy)"
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
    apt-get update -qq < /dev/null
    # shellcheck disable=SC2086
    apt-get install -y -qq $faltan < /dev/null > /dev/null
fi

for puerto in "$HTTP_PORT" "$HTTPS_PORT"; do
    if ss -Hltn "sport = :$puerto" | grep -q .; then
        morir "el puerto TCP $puerto ya está en uso (ArgosIsp lo necesita para el panel, la API y el portal). Si ya hay un proxy en 80 y 443 (Nginx Proxy Manager…): ARGOSISP_HTTP_PORT=8080 ARGOSISP_HTTPS_PORT=8443, docs/runbooks/detras-de-proxy.md"
    fi
done
[ "$ROL" = portal ] || for puerto in 1812 1813; do
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
    apt-get update -qq < /dev/null
    apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin < /dev/null > /dev/null
    systemctl enable --now docker < /dev/null > /dev/null 2>&1 || true
fi
docker info > /dev/null 2>&1 || morir "Docker está instalado pero no responde (systemctl status docker)"
docker_version="$(docker version --format '{{.Server.Version}}')"
version_mayor_igual "$docker_version" "$DOCKER_MINIMO" || morir "hace falta Docker $DOCKER_MINIMO o más nuevo (hay $docker_version)"
compose_version="$(docker compose version --short 2> /dev/null || true)"
[ -n "$compose_version" ] || morir "falta el plugin docker compose (apt-get install docker-compose-plugin)"
version_mayor_igual "${compose_version#v}" "$COMPOSE_MINIMO" || morir "hace falta docker compose $COMPOSE_MINIMO o más nuevo (hay $compose_version)"

# Raspberry Pi: ¿la base quedaría en una tarjeta SD (mmcblk)? Los volúmenes (Postgres, Redis) viven
# en el directorio de datos de Docker y los respaldos en $DIR. Solo avisa: no bloquea.
en_tarjeta_sd() {
    local ruta="$1" majmin fuente
    majmin="$(findmnt -no MAJ:MIN -T "$ruta" 2> /dev/null | head -n1 | tr -d '[:space:]')"
    if [ -n "$majmin" ] && [ -e "/sys/dev/block/$majmin" ]; then
        case "$(readlink -f "/sys/dev/block/$majmin")" in */mmcblk*) return 0 ;; esac
    fi
    fuente="$(findmnt -no SOURCE -T "$ruta" 2> /dev/null | head -n1)"
    case "$fuente" in /dev/mmcblk*) return 0 ;; esac
    return 1
}
docker_root="$(docker info --format '{{.DockerRootDir}}' 2> /dev/null || echo /var/lib/docker)"
for ruta in "$docker_root" "$DIR"; do
    if en_tarjeta_sd "$ruta"; then
        aviso "$ruta está en una tarjeta SD (mmcblk): la base de datos y los respaldos la desgastan y se corrompen con un corte de luz. Usa un SSD (NVMe en el Pi 5, USB 3 en el Pi 4), de preferencia arrancando desde él (docs/runbooks/instalacion.md, \"Raspberry Pi\")"
    fi
done
[ "$(uname -m)" != aarch64 ] || [ "$ROL" = portal ] || [ "$ram_mb" -ge 7000 ] ||
    aviso "Raspberry Pi o arm64 con ${ram_mb} MB: se recomiendan 8 GB$([ "$API_PORTAL" = no ] && echo '; api-portal queda apagado por la regla de RAM')"

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
# Versión del central, con el token del nodo (vacía si no se puede leer)
version_central() {
    local conectar=()
    [ -z "${ARGOSISP_NODO_CENTRAL_DIRECCION:-}" ] || conectar=(--connect-to "$CENTRAL_HOST:$CENTRAL_PUERTO:${ARGOSISP_NODO_CENTRAL_DIRECCION}")
    [ "${ARGOSISP_NODO_CENTRAL_TLS:-}" = inseguro ] && conectar+=(-k)
    curl -fsS --retry 2 --max-time 15 "${conectar[@]}" -H "X-Argos-Nodo-Token: $TOKEN" "$CENTRAL/api/v1/version" 2> /dev/null |
        jq -r '.version // empty' 2> /dev/null || true
}

if [ "$ROL" = portal ]; then
    # El nodo nunca queda más nuevo que el central
    central_v="$(version_central)"
    if [ -z "$VERSION" ]; then
        [ -n "$central_v" ] || morir "no pude leer la versión de $CENTRAL con el token (GET /api/v1/version): revisa la URL y el token"
        VERSION="$central_v"
    elif [ -z "$central_v" ]; then
        aviso "no pude leer la versión del central: instalo $VERSION; revisa después con argosisp estado"
    elif [ "$(printf '%s\n%s\n' "$central_v" "$VERSION" | sort -V | tail -n1)" != "$central_v" ]; then
        morir "$VERSION es más nueva que la del central ($central_v): instala $central_v"
    fi
fi
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
if [ "$ROL" = portal ]; then
    tls_extra=""
    [ "${ARGOSISP_NODO_CENTRAL_TLS:-}" = inseguro ] && tls_extra=tls_insecure_skip_verify
    cat > "$DIR/.env.nuevo" << EOF
# ArgosIsp · NODO PORTAL. Lo generó instalar.sh el $(date -u +%Y-%m-%dT%H:%M:%SZ).
# Solo root lo lee (600): lleva el token del nodo. Después de editarlo: argosisp levantar
ARGOSISP_ROL=portal
ARGOSISP_PROYECTO=argosisp-portal
# Versión instalada (la cambia \`argosisp actualizar\`, que sigue al central)
ARGOSISP_VERSION=$VERSION
ARGOSISP_REGISTRO=$REGISTRO

# Dominio del portal de este nodo (debe apuntar a este servidor)
DOMINIO_PORTAL=$DOMINIO_PORTAL
PROXY_TLS_GLOBAL="$tls_global"
PORTAL_HSTS_MAX_AGE=300
ARGOSISP_HTTP_PORT=$HTTP_PORT
ARGOSISP_HTTPS_PORT=$HTTPS_PORT

# API central (servidor principal) y token de este nodo (argosisp nodo-portal crear|revocar allá)
NODO_CENTRAL_URL=$CENTRAL
NODO_CENTRAL_HOST=$CENTRAL_HOST
NODO_CENTRAL_DIRECCION=${ARGOSISP_NODO_CENTRAL_DIRECCION:-$CENTRAL_HOST:$CENTRAL_PUERTO}
NODO_CENTRAL_TLS_EXTRA=$tls_extra
NODO_PORTAL_TOKEN=$TOKEN
EOF
else
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

# API del portal: un segundo proceso de la misma API (misma imagen, base y Redis) que atiende
# /api/v1/portal/** para que el tráfico de los clientes no frene el panel. no = todo a "api".
# Después de cambiarlo: argosisp levantar
ARGOSISP_API_PORTAL=$API_PORTAL

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
# Vacía: coa corre en red bridge y el NAT del servidor pone la IP de origen de los CoA (la que el
# router tiene en /radius). Con la IP del servidor aquí el bind falla dentro del contenedor
COA_ORIGEN_IP=

# Correo y Telegram: se configuran en el panel (Configuración → Notificaciones)
MAIL_FROM="ArgosIsp <no-responder@$DOMINIO>"
NOTIFY_EMPRESA_NOMBRE=ArgosIsp
EOF
[ "$HTTP_PORT" = 80 ] || echo "ARGOSISP_HTTP_PORT=$HTTP_PORT" >> "$DIR/.env.nuevo"
[ "$HTTPS_PORT" = 443 ] || echo "ARGOSISP_HTTPS_PORT=$HTTPS_PORT" >> "$DIR/.env.nuevo"
cat >> "$DIR/.env.nuevo" << EOF

# Proxy de delante (Nginx Proxy Manager…): IP o CIDR separados por espacio de los que Caddy acepta
# X-Forwarded-For / X-Real-IP. Vacía = no hay proxy delante. docs/runbooks/detras-de-proxy.md
ARGOSISP_PROXIES_CONFIABLES="$PROXIES"
EOF
fi
mv -f "$DIR/.env.nuevo" "$DIR/.env"
chmod 600 "$DIR/.env"
umask 022

# ---------------------------------------------------------------------------
# 6. Comando argosisp y timer de parches (apagado)
# ---------------------------------------------------------------------------
ln -sfn "$DIR/actual/argosisp" /usr/local/bin/argosisp
if command -v systemctl > /dev/null && [ -d /run/systemd/system ]; then
    install -m 0644 "$DIR/actual/systemd/argosisp-actualizar.service" "$DIR/actual/systemd/argosisp-actualizar.timer" /etc/systemd/system/
    systemctl daemon-reload < /dev/null
fi

# ---------------------------------------------------------------------------
# 7. Imágenes y arranque
# ---------------------------------------------------------------------------
export ARGOSISP_DIR="$DIR"
# Igual que `argosisp` (entorno_compose): perfil y destino de la API del portal
if [ "$API_PORTAL" = si ]; then
    export COMPOSE_PROFILES=api-portal ARGOSISP_API_PORTAL_DESTINO=api-portal
else
    export COMPOSE_PROFILES='' ARGOSISP_API_PORTAL_DESTINO=api
fi
if [ "$ROL" = portal ]; then
    compose=(docker compose -p argosisp-portal --env-file "$DIR/.env" -f "$DIR/actual/docker-compose.nodo-portal.yml")
else
    compose=(docker compose -p argosisp --env-file "$DIR/.env" -f "$DIR/actual/docker-compose.yml")
fi
"${compose[@]}" config --quiet < /dev/null || morir "el compose de $VERSION no es válido con el .env generado"
if [ "${ARGOSISP_SIN_DESCARGA:-0}" != 1 ]; then
    log "descargando imágenes de $REGISTRO (versión $VERSION)"
    "${compose[@]}" pull --quiet < /dev/null
fi
"$DIR/actual/argosisp" levantar < /dev/null || morir "ArgosIsp no quedó sano. Revisa: argosisp logs   (el .env queda en $DIR/.env)"

if [ "$ROL" = portal ]; then
    cat << EOF

Nodo portal de ArgosIsp $VERSION instalado.

  Portal:   https://$DOMINIO_PORTAL   (y /corte por HTTP en este servidor)
  Central:  $CENTRAL

  El dominio del portal debe apuntar a este servidor. El token está en $DIR/.env (600).
  Actualiza primero el servidor principal y después este nodo: argosisp actualizar
  (el nodo sigue la versión del central y nunca la pasa).

EOF
    exit 0
fi

# URL de entrada: con 443, o detrás de un proxy (publica los dominios en su propio 443), sin puerto;
# con otro puerto HTTPS y sin proxy, con el puerto.
sufijo=""
[ "$HTTPS_PORT" = 443 ] || [ -n "$PROXIES" ] || sufijo=":$HTTPS_PORT"
corte="http://<IP de este servidor>$([ "$HTTP_PORT" = 80 ] || echo ":$HTTP_PORT")/corte"
if [ -n "$PROXIES" ]; then
    nota="  Detrás de un proxy (ARGOSISP_PROXIES_CONFIABLES=$PROXIES): se entra por los dominios del proxy.
  Cada Proxy Host (panel, api y portal) va por https a la IP de este servidor, puerto $HTTPS_PORT, con
  Websockets. El dst-nat de los suspendidos (TCP/80) va a este servidor, puerto $HTTP_PORT, nunca al proxy.
  Paso a paso: docs/runbooks/detras-de-proxy.md"
elif [ "$HTTP_PORT" != 80 ] || [ "$HTTPS_PORT" != 443 ]; then
    nota="  Puertos $HTTP_PORT (HTTP) y $HTTPS_PORT (HTTPS). Let's Encrypt necesita 80 y 443 en este servidor: con
  otros puertos usa ARGOSISP_TLS=interno o un proxy delante (docs/runbooks/detras-de-proxy.md)."
elif [ "${ARGOSISP_TLS:-}" = interno ]; then
    nota="  Certificados de la CA interna de Caddy (ARGOSISP_TLS=interno): el navegador avisa."
else
    nota="  Los tres dominios deben apuntar a este servidor para que Let's Encrypt emita los certificados."
fi

cat > "$DIR/credenciales-iniciales.txt" << EOF
Panel:    https://$DOMINIO_PANEL$sufijo
Usuario:  $CORREO
Clave:    $admin_password
EOF
chmod 600 "$DIR/credenciales-iniciales.txt"

cat << EOF

ArgosIsp $VERSION instalado.

  Panel:    https://$DOMINIO_PANEL$sufijo
  API:      https://$DOMINIO_API$sufijo
  Portal:   https://$DOMINIO_PORTAL$sufijo   (y /corte por HTTP: $corte)
  Usuario:  $CORREO
  Clave:    $admin_password   (también en $DIR/credenciales-iniciales.txt; cámbiala al entrar y borra el archivo)

$nota
  Guarda una copia de $DIR/.env fuera del servidor: AAA_PPP_KEY descifra las contraseñas PPPoE.

  argosisp estado        versión y salud
  argosisp actualizar    actualizar (respaldo y reversión automáticos)
  argosisp auto activar  parches automáticos diarios (apagado)

EOF
}

main "$@"
