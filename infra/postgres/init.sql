-- Se ejecuta una sola vez, al crear el volumen de Postgres (docker-entrypoint-initdb.d).
-- La base principal (POSTGRES_DB = argosisp) y el usuario los crea la imagen.
-- Los schemas (core, network, billing, ledger, notify, audit) los crean las migraciones de apps/api.

-- Base para las pruebas de integración (Japa) en local; en CI la crea el servicio de GitHub Actions.
SELECT 'CREATE DATABASE argosisp_test OWNER ' || quote_ident(current_user)
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'argosisp_test')
\gexec

-- Todo en UTC en base de datos (America/Guatemala solo al mostrar).
SELECT format('ALTER DATABASE %I SET timezone TO %L', current_database(), 'UTC')
\gexec
ALTER DATABASE argosisp_test SET timezone TO 'UTC';
