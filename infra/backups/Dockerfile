# Servicio `backup` del compose: pg_dump diario con retención, cifrado (age) y copia remota
# (rclone) opcionales. Mismas herramientas de cliente que el servidor (postgres:16.15).
FROM postgres:16.15-alpine
# Usuario sin privilegios con el uid de `node` en las imágenes de Node: lee y restaura los
# comprobantes (dueño 1000, sin acceso para otros) y escribe en /backups (dueño 1000; el servicio
# `permisos` del compose de producción lo deja así). El compose de desarrollo lo corre como root.
RUN apk add --no-cache age rclone \
    && addgroup -g 1000 respaldo \
    && adduser -D -H -u 1000 -G respaldo -h /home/respaldo respaldo \
    && mkdir -p /home/respaldo /backups \
    && chown respaldo:respaldo /home/respaldo /backups
COPY --chmod=0755 infra/backups/respaldar.sh infra/backups/restaurar.sh infra/backups/conteos_dump.sh infra/backups/programar.sh /usr/local/bin/
ENV BACKUP_DIR=/backups \
    HOME=/home/respaldo
VOLUME ["/backups"]
# Versión de la imagen (workflow imagenes.yml); al final para no invalidar la caché.
ARG ARGOSISP_VERSION=desarrollo
ARG ARGOSISP_COMMIT=
ARG ARGOSISP_COMPILADA=
ENV ARGOSISP_VERSION=$ARGOSISP_VERSION \
    ARGOSISP_COMMIT=$ARGOSISP_COMMIT \
    ARGOSISP_COMPILADA=$ARGOSISP_COMPILADA
USER respaldo
# Sin el entrypoint de la imagen de Postgres: este contenedor no corre un servidor.
ENTRYPOINT []
CMD ["programar.sh"]
