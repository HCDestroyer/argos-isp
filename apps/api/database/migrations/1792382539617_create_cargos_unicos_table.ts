import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * A3 · cargos únicos con factura manual (decisión del PM): instalación, equipo, visita técnica…
 *
 * - `billing.conceptos_cargo`: catálogo por empresa con la cuenta de ingreso (código de `ledger.cuentas`) y
 *   el tratamiento de IVA (`gravable`). Sembrado con instalación, equipo, visita técnica y otro,
 *   todos a `4.1.03 Otros ingresos` (el seed no tiene cuentas más finas: confirmar con el contador).
 * - `billing.motivos_sin_costo`: catálogo por empresa de motivos de una factura en Q0 (promoción,
 *   cortesía, garantía, compensación por falla, convenio). Se desactivan, no se borran.
 * - Ambos con `version`; un trigger los siembra para cada empresa nueva.
 * - `billing.facturas.motivo_sin_costo_id` / `motivo_sin_costo_texto`: el motivo de una factura en
 *   Q0 (obligatorio en ella).
 * - `billing.facturas_lineas.cuenta_codigo`: la cuenta de ingreso de la línea cuando viene de un concepto
 *   (null = la de su tipo, como hasta hoy).
 */
export default class extends BaseSchema {
    async up() {
        this.schema.raw(`
            CREATE TABLE billing.conceptos_cargo (
                id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                empresa_id bigint NOT NULL REFERENCES core.empresas (id),
                nombre text NOT NULL CHECK (length(btrim(nombre)) > 0),
                tipo text NOT NULL DEFAULT 'otro' CHECK (tipo IN ('producto', 'otro')),
                -- cuenta de ingreso por código (como el resto del módulo): las cuentas se siembran
                -- después de migrar; la acción valida que exista, sea imputable y de ingreso
                cuenta_codigo text NOT NULL,
                gravable boolean NOT NULL DEFAULT true,
                activo boolean NOT NULL DEFAULT true,
                version integer NOT NULL DEFAULT 1,
                created_at timestamptz NOT NULL DEFAULT now(),
                updated_at timestamptz NOT NULL DEFAULT now(),
                CONSTRAINT conceptos_cargo_nombre UNIQUE (empresa_id, nombre)
            );

            CREATE TABLE billing.motivos_sin_costo (
                id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                empresa_id bigint NOT NULL REFERENCES core.empresas (id),
                nombre text NOT NULL CHECK (length(btrim(nombre)) > 0),
                activo boolean NOT NULL DEFAULT true,
                version integer NOT NULL DEFAULT 1,
                created_at timestamptz NOT NULL DEFAULT now(),
                updated_at timestamptz NOT NULL DEFAULT now(),
                CONSTRAINT motivos_sin_costo_nombre UNIQUE (empresa_id, nombre)
            );

            CREATE FUNCTION billing.sembrar_catalogos_cargo(empresa bigint) RETURNS void LANGUAGE plpgsql AS $$
            BEGIN
                INSERT INTO billing.conceptos_cargo (empresa_id, nombre, tipo, cuenta_codigo)
                VALUES (empresa, 'Instalación', 'otro', '4.1.03'), (empresa, 'Equipo', 'producto', '4.1.03'),
                       (empresa, 'Visita técnica', 'otro', '4.1.03'), (empresa, 'Otro', 'otro', '4.1.03')
                ON CONFLICT (empresa_id, nombre) DO NOTHING;
                INSERT INTO billing.motivos_sin_costo (empresa_id, nombre)
                VALUES (empresa, 'Promoción'), (empresa, 'Cortesía'), (empresa, 'Garantía'),
                       (empresa, 'Compensación por falla'), (empresa, 'Convenio')
                ON CONFLICT (empresa_id, nombre) DO NOTHING;
            END $$;

            CREATE FUNCTION billing.sembrar_catalogos_cargo_empresa() RETURNS trigger LANGUAGE plpgsql AS $$
            BEGIN
                PERFORM billing.sembrar_catalogos_cargo(NEW.id);
                RETURN NEW;
            END $$;
            CREATE TRIGGER empresas_catalogos_cargo AFTER INSERT ON core.empresas
                FOR EACH ROW EXECUTE FUNCTION billing.sembrar_catalogos_cargo_empresa();

            SELECT billing.sembrar_catalogos_cargo(id) FROM core.empresas ORDER BY id;

            ALTER TABLE billing.facturas
                ADD COLUMN motivo_sin_costo_id bigint REFERENCES billing.motivos_sin_costo (id),
                ADD COLUMN motivo_sin_costo_texto text,
                ADD CONSTRAINT facturas_motivo_sin_costo
                    CHECK (motivo_sin_costo_id IS NULL OR (total = 0 AND length(btrim(coalesce(motivo_sin_costo_texto, ''))) > 0));
            ALTER TABLE billing.facturas_lineas ADD COLUMN cuenta_codigo text;

            DO $do$
            BEGIN
                IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'argosisp_app') THEN
                    GRANT SELECT, INSERT, UPDATE ON billing.conceptos_cargo, billing.motivos_sin_costo TO argosisp_app;
                    REVOKE DELETE, TRUNCATE ON billing.conceptos_cargo, billing.motivos_sin_costo FROM argosisp_app;
                    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA billing TO argosisp_app;
                END IF;
            END
            $do$;
        `)
    }

    async down() {
        this.schema.raw(`
            ALTER TABLE billing.facturas_lineas DROP COLUMN IF EXISTS cuenta_codigo;
            ALTER TABLE billing.facturas
                DROP CONSTRAINT IF EXISTS facturas_motivo_sin_costo,
                DROP COLUMN IF EXISTS motivo_sin_costo_texto,
                DROP COLUMN IF EXISTS motivo_sin_costo_id;
            DROP TRIGGER IF EXISTS empresas_catalogos_cargo ON core.empresas;
            DROP FUNCTION IF EXISTS billing.sembrar_catalogos_cargo_empresa();
            DROP FUNCTION IF EXISTS billing.sembrar_catalogos_cargo(bigint);
            DROP TABLE IF EXISTS billing.motivos_sin_costo;
            DROP TABLE IF EXISTS billing.conceptos_cargo;
        `)
    }
}
