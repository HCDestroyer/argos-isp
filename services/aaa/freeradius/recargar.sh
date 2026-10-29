#!/bin/bash
# ArgosIsp · recarga de clientes de FreeRADIUS por evento (A2, contratos/conexion-routers.md §6.4).
#
# Entrypoint del contenedor de FreeRADIUS en lugar de /docker-entrypoint.sh, con los mismos
# argumentos (p. ej. `-l stdout`). Corre `freeradius -f "$@"` como hijo y escucha el FIFO
# clients.d/.recargar que escribe `aaa` (src/clientes/recarga.ts) cuando regenera clients.d por
# `router.conexion_registrada` / `_rotada` / `_eliminada`. FreeRADIUS 3.2 lee los clientes solo al
# arrancar (un HUP no los relee), así que por cada aviso:
#   1. valida la configuración con `freeradius -C` (con los clientes nuevos);
#   2. si es válida, para radiusd (TERM) y lo vuelve a levantar (~1 s sin RADIUS; el router reintenta);
#      si no, lo deja como estaba y lo dice en el log.
# Varios avisos seguidos se juntan en una recarga. Es por evento: no sondea ni usa TTL.
# Si el FIFO no existe todavía (aaa no arrancó), espera a que aparezca sin bloquear a radiusd.
set -uo pipefail

CLIENTES_DIR="${RADIUS_CLIENTES_DIR:-/etc/freeradius/clients.d}"
FIFO="$CLIENTES_DIR/.recargar"
JUNTAR_S="${RADIUS_RECARGA_JUNTAR_S:-1}"

log() { printf '%s recargar: %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" >&2; }

ARGS=("$@")
HIJO=0

levantar() {
    freeradius -f "${ARGS[@]}" &
    HIJO=$!
    log "radiusd levantado (pid $HIJO)"
}

parar() {
    [ "$HIJO" -gt 0 ] || return 0
    kill -TERM "$HIJO" 2> /dev/null || true
    wait "$HIJO" 2> /dev/null || true
    HIJO=0
}

terminar() {
    log "señal recibida: cerrando"
    parar
    exit 0
}
trap terminar TERM INT

recargar() {
    local motivo="$1" salida
    if ! salida="$(freeradius -C 2>&1)"; then
        log "configuración inválida tras regenerar clients.d ($motivo); sigue la anterior"
        printf '%s\n' "$salida" | tail -n 5 >&2
        return 0
    fi
    log "recargando clientes ($motivo)"
    parar
    levantar
}

levantar

while true; do
    # radiusd terminó por su cuenta: el contenedor termina (el compose lo reinicia).
    if ! kill -0 "$HIJO" 2> /dev/null; then
        wait "$HIJO"
        codigo=$?
        log "radiusd terminó (código $codigo)"
        exit "$codigo"
    fi
    if [ ! -p "$FIFO" ]; then
        # Sin FIFO no hay avisos que esperar; se mira de nuevo en un rato sin tocar a radiusd.
        sleep 2 & wait $!
        continue
    fi
    # Lectura y escritura: abrirlo no bloquea y siempre hay un lector mientras este script vive, así
    # que un aviso escrito mientras radiusd arranca no se pierde.
    exec 3<> "$FIFO"
    while kill -0 "$HIJO" 2> /dev/null; do
        if read -r -t 5 linea <&3; then
            # Junta los avisos que lleguen en JUNTAR_S (una regeneración puede mandar varios).
            while read -r -t "$JUNTAR_S" otra <&3; do linea="$otra"; done
            recargar "${linea#* }"
        fi
    done
    exec 3<&-
done
