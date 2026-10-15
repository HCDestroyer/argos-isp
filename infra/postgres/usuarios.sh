#!/bin/sh
# Usuarios de Postgres de ArgosIsp. Lo ejecuta la imagen de Postgres al crear el volumen
# (/docker-entrypoint-initdb.d/20-usuarios.sh) con el superusuario POSTGRES_USER. Es idempotente:
# en un volumen que ya existe se corre a mano para crear o actualizar los usuarios:
#
#   docker compose -f infra/docker-compose.yml exec postgres sh /docker-entrypoint-initdb.d/20-usuarios.sh
#
#   DB_OWNER_USER  dueño de la base y de todo lo que crean las migraciones; lo usa solo el servicio
#                  migrate (migraciones y seed). Sin superusuario ni CREATEROLE.
#   argosisp_app   rol NOLOGIN con los permisos de la aplicación (migración crear_rol_app):
#                  DML en core, network, billing, ledger y notify; en ledger.asientos,
#                  ledger.movimientos y audit.* solo SELECT e INSERT.
#   DB_APP_USER    usuario de api, relay, workers y coa: LOGIN, miembro de argosisp_app, sin
#                  ningún permiso propio.
#
# El superusuario (POSTGRES_USER, contraseña DB_PASSWORD) queda solo para administración y para
# la base de pruebas argosisp_test.
set -eu

DB_OWNER_USER="${DB_OWNER_USER:-argosisp_owner}"
DB_APP_USER="${DB_APP_USER:-argosisp_api}"
: "${DB_OWNER_PASSWORD:?Falta DB_OWNER_PASSWORD}"
: "${DB_APP_PASSWORD:?Falta DB_APP_PASSWORD}"
BASE="${POSTGRES_DB:-argosisp}"

psql -v ON_ERROR_STOP=1 -X -q \
    --username "${POSTGRES_USER:-postgres}" --dbname "$BASE" \
    -v owner="$DB_OWNER_USER" -v owner_pass="$DB_OWNER_PASSWORD" \
    -v app="$DB_APP_USER" -v app_pass="$DB_APP_PASSWORD" \
    -v base="$BASE" <<'SQL'
SELECT format('CREATE ROLE %I', :'owner')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'owner')
\gexec
ALTER ROLE :"owner" WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD :'owner_pass';

SELECT 'CREATE ROLE argosisp_app NOLOGIN'
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'argosisp_app')
\gexec

SELECT format('CREATE ROLE %I', :'app')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'app')
\gexec
ALTER ROLE :"app" WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD :'app_pass';
GRANT argosisp_app TO :"app";

-- El dueño crea los schemas (CREATE en la base) y es dueño de tablas, funciones y secuencias.
ALTER DATABASE :"base" OWNER TO :"owner";
ALTER DATABASE :"base" SET timezone TO 'UTC';
-- Nadie más crea objetos en public (PG 15+ ya lo hace por defecto; explícito por si acaso).
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
SQL

echo "usuarios.sh: dueño ${DB_OWNER_USER}, aplicación ${DB_APP_USER} (miembro de argosisp_app) en ${BASE}"
