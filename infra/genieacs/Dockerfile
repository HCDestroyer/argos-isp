# GenieACS de laboratorio (A6, equipos del cliente). No hay imagen oficial: se instala el paquete npm
# oficial como dice la guía de instalación (https://docs.genieacs.com/en/latest/installation-guide.html).
# Un solo contenedor corre cwmp (7547, a donde llegan los equipos), nbi (7557, lo usa Argos), fs (7567)
# y ui (3000). En producción, mejor la instalación con systemd de la guía en el servidor del ACS.
FROM node:22.11.0-bookworm-slim
RUN npm install -g genieacs@1.2.16 && npm cache clean --force \
    && useradd --system --no-create-home --user-group genieacs \
    && mkdir -p /opt/genieacs/ext && chown genieacs:genieacs /opt/genieacs/ext
COPY arrancar.sh /usr/local/bin/arrancar-genieacs
USER genieacs
ENV GENIEACS_EXT_DIR=/opt/genieacs/ext
EXPOSE 7547 7557 7567 3000
CMD ["/bin/sh", "/usr/local/bin/arrancar-genieacs"]
