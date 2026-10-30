# Servicios `wireguard` (servidor, red del host) y `wireguard-agente` (red de compose) del compose.
# Una sola imagen pequeña: herramientas de WireGuard (wg y wireguard-go para kernels sin el módulo),
# iproute2, iptables (nft y legacy, el que use el host), inotify, curl, jq y redis-cli.
FROM alpine:3.22
RUN apk add --no-cache bash coreutils curl inotify-tools iproute2 iptables iptables-legacy jq redis \
        tini wireguard-go wireguard-tools-wg \
    && rm -f /usr/bin/redis-server /usr/bin/redis-sentinel /usr/bin/redis-benchmark /usr/bin/redis-check-* \
    && mkdir -p /clave /estado \
    && chmod 700 /clave
COPY --chmod=0755 infra/wireguard/servidor.sh infra/wireguard/agente.sh infra/wireguard/salud.sh /usr/local/bin/
VOLUME ["/clave", "/estado"]
# Versión de la imagen (workflow imagenes.yml); al final para no invalidar la caché.
ARG ARGOSISP_VERSION=desarrollo
ARG ARGOSISP_COMMIT=
ARG ARGOSISP_COMPILADA=
ENV ARGOSISP_VERSION=$ARGOSISP_VERSION \
    ARGOSISP_COMMIT=$ARGOSISP_COMMIT \
    ARGOSISP_COMPILADA=$ARGOSISP_COMPILADA
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["servidor.sh"]
