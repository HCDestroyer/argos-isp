# FreeRADIUS 3.2 de producción de ArgosIsp (A6, distribución), multi-arquitectura (amd64 y arm64).
#
# La imagen oficial freeradius/freeradius-server se publica solo para amd64, en todas sus etiquetas,
# y un Raspberry Pi (arm64) no la puede correr. Esta es la misma receta con la que FreeRADIUS arma
# esa imagen (scripts/docker/dists/ubuntu22/Dockerfile del propio release): Ubuntu 22.04, los .deb
# del empaquetado de FreeRADIUS (debian/ del tarball) compilados aquí, el usuario freerad 101:101,
# /etc/freeradius (y /etc/raddb) y el mismo docker-entrypoint.sh. Configuración, rutas y comandos
# iguales a los de la oficial: el compose de producción monta mods-enabled, sites-enabled,
# clients.conf y clients.d en los mismos lugares.
#
# Fuente: el tarball firmado del release en freeradius.org, verificado con su sha256 (fijo aquí).
# Para subir de versión: FREERADIUS_VERSION y FREERADIUS_SHA256 (sha256sum del .tar.gz).
#
# Desarrollo y laboratorio (infra/docker-compose.yml) siguen con la imagen oficial.
ARG UBUNTU=ubuntu:22.04

FROM ${UBUNTU} AS build
ARG DEBIAN_FRONTEND=noninteractive
ARG FREERADIUS_VERSION=3.2.10
ARG FREERADIUS_SHA256=40e0cdfdcceb22cf0acb79bc29cf7c32995466a61fda09445ce5220608a55afd

RUN apt-get update \
 && apt-get install -y devscripts equivs quilt gcc ca-certificates curl

WORKDIR /usr/local/src/repositories
RUN curl -fsSL --retry 3 -o freeradius.tar.gz \
        "https://www.freeradius.org/ftp/pub/freeradius/freeradius-server-${FREERADIUS_VERSION}.tar.gz" \
 && echo "${FREERADIUS_SHA256}  freeradius.tar.gz" | sha256sum -c - \
 && tar -xzf freeradius.tar.gz \
 && rm freeradius.tar.gz \
 && mv "freeradius-server-${FREERADIUS_VERSION}" freeradius-server

WORKDIR /usr/local/src/repositories/freeradius-server
# Dependencias de compilación del empaquetado de FreeRADIUS (igual que su Dockerfile)
RUN touch -t 202001010000 debian/control \
 && debian/rules debian/control \
 && echo 'y' | mk-build-deps -irt'apt-get -yV' debian/control
RUN debian/rules debian/control \
 && dpkg-buildpackage --jobs=auto -b -uc

FROM ${UBUNTU}
ARG DEBIAN_FRONTEND=noninteractive

COPY --from=build /usr/local/src/repositories/*.deb /tmp/

RUN ln -fs /usr/share/zoneinfo/Etc/UTC /etc/localtime

ARG freerad_uid=101
ARG freerad_gid=101

RUN groupadd -g ${freerad_gid} -r freerad \
 && useradd -u ${freerad_uid} -g freerad -r -M -d /etc/freeradius -s /usr/sbin/nologin freerad \
 && apt-get update \
 && apt-get install -y tzdata \
 && apt-get install -y /tmp/*.deb \
 && apt-get clean \
 && rm -r /var/lib/apt/lists/* /tmp/*.deb \
 && ln -s /etc/freeradius /etc/raddb

WORKDIR /
COPY --from=build /usr/local/src/repositories/freeradius-server/scripts/docker/etc/docker-entrypoint.sh.deb /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

# Sin USER, como la oficial: arranca como root (clients.d es el volumen de `permisos`, solo para el
# uid 1000) y el resto lo decide el radiusd.conf del paquete, igual que con la oficial.
EXPOSE 1812/udp 1813/udp
ENTRYPOINT ["/docker-entrypoint.sh"]
CMD ["freeradius"]

# Versión de la imagen (imagenes.yml y el job distribucion del CI): al final, no invalida la caché.
ARG ARGOSISP_VERSION=desarrollo
ARG ARGOSISP_COMMIT=
ARG ARGOSISP_COMPILADA=
ENV ARGOSISP_VERSION=$ARGOSISP_VERSION \
    ARGOSISP_COMMIT=$ARGOSISP_COMMIT \
    ARGOSISP_COMPILADA=$ARGOSISP_COMPILADA
