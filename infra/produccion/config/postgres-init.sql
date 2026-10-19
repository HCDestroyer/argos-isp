-- Producción (infra/produccion): se ejecuta una sola vez, al crear el volumen de Postgres.
-- A diferencia de infra/postgres/init.sql no crea la base de pruebas argosisp_test.
-- Los schemas los crean las migraciones; los usuarios, 20-usuarios.sh (infra/postgres/usuarios.sh).

-- Todo en UTC en base de datos (America/Guatemala solo al mostrar).
SELECT format('ALTER DATABASE %I SET timezone TO %L', current_database(), 'UTC')
\gexec
