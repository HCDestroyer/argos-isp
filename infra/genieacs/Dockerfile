# GenieACS de laboratorio (A6, equipos del cliente). No hay imagen oficial: se instala el paquete npm
# oficial como dice la guía de instalación (https://docs.genieacs.com/en/latest/installation-guide.html).
# Un solo contenedor corre cwmp (7547, a donde llegan los equipos), nbi (7557, lo usa Argos), fs (7567)
# y ui (3000). La usan el perfil lab de Argos y el despliegue aparte de este directorio
# (docker-compose.yml + README.md), donde el NBI y la UI solo se publican por el proxy con HTTPS.
FROM node:22.11.0-bookworm-slim
RUN npm install -g genieacs@1.2.16 && npm cache clean --force \
    && useradd --system --no-create-home --user-group genieacs \
    && mkdir -p /opt/genieacs/ext && chown genieacs:genieacs /opt/genieacs/ext
COPY arrancar.sh /usr/local/bin/arrancar-genieacs
USER genieacs
ENV GENIEACS_EXT_DIR=/opt/genieacs/ext
EXPOSE 7547 7557 7567 3000
CMD ["/bin/bash", "/usr/local/bin/arrancar-genieacs"]
