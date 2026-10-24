#!/usr/bin/env bash
# Prueba 0 · Entorno: versión de ArgosIsp, salud de los servicios, hardware del servidor y la
# configuración RADIUS que no es secreta. Guarda todo en $LAB_SALIDA/00-entorno/.
#
#   sudo scripts/laboratorio/00-entorno.sh
source "$(dirname "$0")/comun.sh"

P=00-entorno
guardar "$P" argosisp-estado argosisp estado
guardar "$P" version "${LAB_CURL[@]}" "$LAB_API/version"
guardar "$P" servidor sh -c 'uname -a; echo; cat /etc/os-release; echo; nproc; free -m; echo; df -h /opt /var/lib/docker; echo; uptime'
guardar "$P" cpu sh -c 'lscpu 2>/dev/null || cat /proc/cpuinfo'
guardar "$P" docker sh -c 'docker version --format "{{.Server.Version}}"; docker compose version'
guardar "$P" contenedores dc ps
# Solo las variables de red y RADIUS; nunca claves ni tokens.
guardar "$P" env-radius sh -c "grep -E '^(ARGOSISP_VERSION|RADIUS_BIND_IP|COA_ORIGEN_IP|AAA_SALUD_NODOS|COA_SUSPENDER_CON_IPV6|AAA_[A-Z_]*_MS|AAA_API_[A-Z_]*|ARGOSISP_API_PORTAL|DOMINIO_[A-Z]*)=' '$ARGOSISP_DIR/.env' || true"
guardar "$P" freeradius-config dc exec -T freeradius radiusd -XC
guardar "$P" freeradius-clientes dc exec -T freeradius sh -c 'ls -l /etc/freeradius/clients.d/; grep -h -E "^client|ipaddr" /etc/freeradius/clients.d/*.conf 2>/dev/null || true'
guardar "$P" aaa-health dc exec -T aaa node -e "fetch('http://127.0.0.1:3100/health').then(r=>r.text()).then(t=>console.log(t))"
guardar "$P" coa-health dc exec -T coa node -e "fetch('http://127.0.0.1:3200/health').then(r=>r.text()).then(t=>console.log(t))"
guardar "$P" rutas-al-router sh -c "ip -br addr; echo; ip route; echo; ip -6 route"

ros "$P" routeros-version '/system resource print'
ros "$P" routeros-routerboard '/system routerboard print'
ros "$P" routeros-radius '/radius print detail without-paging'
ros "$P" routeros-radius-incoming '/radius incoming print'
ros "$P" routeros-ppp-aaa '/ppp aaa print'
ros "$P" routeros-perfiles '/ppp profile print detail without-paging'
ros "$P" routeros-pppoe '/interface pppoe-server server print detail'
ros "$P" routeros-fasttrack '/system script run argosisp-verificar-fasttrack'

ok "entorno guardado en $LAB_SALIDA/$P"
