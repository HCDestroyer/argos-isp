# Servicio `backup` del compose: pg_dump diario con retención, cifrado (age) y copia remota
# (rclone) opcionales. Mismas herramientas de cliente que el servidor (postgres:16.15).
FROM postgres:16.15-alpine
RUN apk add --no-cache age rclone
COPY --chmod=0755 infra/backups/respaldar.sh infra/backups/restaurar.sh infra/backups/conteos_dump.sh infra/backups/programar.sh /usr/local/bin/
ENV BACKUP_DIR=/backups
VOLUME ["/backups"]
# Sin el entrypoint de la imagen de Postgres: este contenedor no corre un servidor.
ENTRYPOINT []
CMD ["programar.sh"]
