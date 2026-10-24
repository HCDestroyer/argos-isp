#!/usr/bin/env bash
# Lado del cliente: corre en una PC Linux (o macOS) conectada detrás del CPE PPPoE. No necesita
# ArgosIsp ni root. Prueba IPv4, IPv6, DNS, la página de corte y lo que el portal ve de esta PC.
#
#   bash cliente.sh <prueba> <portal>            p. ej.  bash cliente.sh 02-pppoe portal.miisp.gt
#   CLIENTE_VELOCIDAD=1 bash cliente.sh ...      además mide velocidad (iperf3 o curl)
#   CLIENTE_IPERF=<ip de un servidor iperf3>     para medir con iperf3 en vez de curl
#
# Deja cliente-<prueba>-<hora>.txt en la carpeta actual; cópialo al servidor, a
# /root/argosisp-lab/salida/<prueba>/ (scp o USB).
set -uo pipefail

P="${1:?uso: bash cliente.sh <prueba> <portal>}"
PORTAL="${2:?falta el host del portal (DOMINIO_PORTAL)}"
F="cliente-$P-$(date -u +%H%M%S).txt"

paso() {
    printf '\n## %s\n$ %s\n' "$(date -u +%FT%TZ)" "$*" | tee -a "$F"
    "$@" 2>&1 | tee -a "$F"
}
tiempo() { # mide cuánto tarda un comando (fallar rápido importa en el corte)
    local t0 t1
    t0="$(date +%s%N)"
    paso "$@"
    t1="$(date +%s%N)"
    printf '# tardó %s ms\n' "$(((t1 - t0) / 1000000))" | tee -a "$F"
}

paso uname -a
paso sh -c 'ip -br addr 2>/dev/null || ifconfig'
paso sh -c 'ip route 2>/dev/null; ip -6 route 2>/dev/null || netstat -rn'
paso sh -c 'cat /etc/resolv.conf 2>/dev/null; resolvectl status 2>/dev/null | head -40'
tiempo ping -c 3 -W 2 1.1.1.1
tiempo ping -6 -c 3 -W 2 2606:4700:4700::1111
tiempo curl -4 -sS -m 5 -o /dev/null -w 'HTTP %{http_code} en %{time_total}s\n' https://example.com/
tiempo curl -6 -sS -m 5 -o /dev/null -w 'HTTP %{http_code} en %{time_total}s\n' https://example.com/
# Página de corte: un suspendido recibe /corte por IPv4 (dst-nat); IPv6 debe fallar al instante (reset).
tiempo curl -4 -sS -m 5 -i http://example.com/
tiempo curl -6 -sS -m 5 -i http://example.com/
# Lo que el portal sabe de esta PC: debe ver la IP real (no la de Docker) e identificar el servicio.
tiempo curl -4 -sS -m 5 "http://$PORTAL/api/v1/portal/quien-soy"
tiempo curl -6 -sS -m 5 "http://$PORTAL/api/v1/portal/quien-soy"
tiempo curl -4 -sS -m 5 "https://$PORTAL/api/v1/portal/quien-soy"
command -v dig > /dev/null && paso dig +short AAAA example.com

if [ "${CLIENTE_VELOCIDAD:-0}" = 1 ]; then
    if [ -n "${CLIENTE_IPERF:-}" ] && command -v iperf3 > /dev/null; then
        paso iperf3 -c "$CLIENTE_IPERF" -t 10 -R # bajada
        paso iperf3 -c "$CLIENTE_IPERF" -t 10 # subida
        paso iperf3 -6 -c "$CLIENTE_IPERF" -t 10 -R
    else
        # 100 MB de un servidor público: velocidad media de bajada en bytes/s.
        paso curl -4 -sS -m 30 -o /dev/null -w 'bajada IPv4: %{speed_download} B/s\n' https://speed.cloudflare.com/__down?bytes=100000000
        paso curl -6 -sS -m 30 -o /dev/null -w 'bajada IPv6: %{speed_download} B/s\n' https://speed.cloudflare.com/__down?bytes=100000000
    fi
fi
printf '\nListo: %s\n' "$F"
