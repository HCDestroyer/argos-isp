import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Cargos de las promociones de velocidad con `precio` (decisión del PM, 22 nov): la factura cobra el
 * precio normal y suma la diferencia proporcional por los días de cada tramo dentro de cada periodo.
 * Una fila por tramo y periodo cobrado; la clave única `(tramo_id, periodo)` evita el doble cobro
 * cuando lo que falta de un tramo se cobra en la factura siguiente. Solo inserción.
 */
export default class extends BaseSchema {
    async up() {
        this.schema.raw(`
            CREATE TABLE billing.promociones_cargos (
                id bigserial PRIMARY KEY,
                empresa_id bigint NOT NULL REFERENCES core.empresas (id),
                servicio_id bigint NOT NULL REFERENCES core.servicios (id),
                promocion_id bigint NOT NULL REFERENCES core.promociones_velocidad (id),
                tramo_id bigint NOT NULL REFERENCES core.promociones_velocidad_tramos (id),
                periodo date NOT NULL,
                dias integer NOT NULL CHECK (dias > 0),
                factura_id bigint NOT NULL REFERENCES billing.facturas (id),
                created_at timestamptz NOT NULL DEFAULT now(),
                CONSTRAINT promociones_cargos_unico UNIQUE (tramo_id, periodo)
            );
            CREATE INDEX promociones_cargos_servicio ON billing.promociones_cargos (servicio_id, periodo);
            CREATE INDEX promociones_cargos_factura ON billing.promociones_cargos (factura_id);
            CREATE TRIGGER promociones_cargos_inmutable BEFORE UPDATE OR DELETE ON billing.promociones_cargos
                FOR EACH ROW EXECUTE FUNCTION audit.rechazar_modificacion();
            CREATE TRIGGER promociones_cargos_sin_truncate BEFORE TRUNCATE ON billing.promociones_cargos
                FOR EACH STATEMENT EXECUTE FUNCTION audit.rechazar_modificacion();

            DO $do$
            BEGIN
                IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'argosisp_app') THEN
                    GRANT SELECT, INSERT ON billing.promociones_cargos TO argosisp_app;
                    REVOKE UPDATE, DELETE, TRUNCATE ON billing.promociones_cargos FROM argosisp_app;
                    EXECUTE format('GRANT USAGE, SELECT ON SEQUENCE %s TO argosisp_app',
                                   pg_get_serial_sequence('billing.promociones_cargos', 'id'));
                END IF;
            END
            $do$;
        `)
    }

    async down() {
        this.schema.raw(`DROP TABLE IF EXISTS billing.promociones_cargos`)
    }
}
