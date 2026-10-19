import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * A3 · nota de crédito con saldo a favor (decisión del PM, lealtad §15.2): una nota sobre una factura
 * pagada (o por más de su saldo) acredita la venta y el IVA completos; lo que excede el saldo de la
 * factura queda como crédito del cliente en Anticipos.
 *
 * - `billing.notas_credito.a_favor`: la parte de la nota que fue a Anticipos (0 en las de siempre).
 * - `billing.notas_credito_aplicaciones`: cómo se aplicó ese saldo a facturas posteriores
 *   (`aplicarAnticipos`, después de los pagos y los saldos iniciales). Solo inserción.
 */
export default class extends BaseSchema {
    async up() {
        this.schema.raw(`
            ALTER TABLE billing.notas_credito
                ADD COLUMN a_favor numeric(14, 2) NOT NULL DEFAULT 0,
                ADD CONSTRAINT notas_credito_a_favor CHECK (a_favor >= 0 AND a_favor <= monto);

            CREATE TABLE billing.notas_credito_aplicaciones (
                id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                nota_credito_id bigint NOT NULL REFERENCES billing.notas_credito (id),
                factura_id bigint NOT NULL REFERENCES billing.facturas (id),
                monto numeric(14, 2) NOT NULL CHECK (monto > 0),
                created_at timestamptz NOT NULL DEFAULT now()
            );
            CREATE INDEX notas_credito_aplicaciones_nota ON billing.notas_credito_aplicaciones (nota_credito_id);
            CREATE INDEX notas_credito_aplicaciones_factura ON billing.notas_credito_aplicaciones (factura_id);

            -- de la misma empresa y cliente, y nunca más que el saldo a favor de la nota
            CREATE FUNCTION billing.validar_aplicacion_nota() RETURNS trigger LANGUAGE plpgsql AS $$
            DECLARE
                n billing.notas_credito%ROWTYPE;
                f billing.facturas%ROWTYPE;
                usado numeric;
            BEGIN
                -- advisory lock por nota (la app no tiene UPDATE sobre notas_credito, FOR UPDATE no sirve)
                PERFORM pg_advisory_xact_lock(5106, (NEW.nota_credito_id % 2147483647)::int);
                SELECT * INTO n FROM billing.notas_credito WHERE id = NEW.nota_credito_id;
                SELECT * INTO f FROM billing.facturas WHERE id = NEW.factura_id;
                IF n.empresa_id <> f.empresa_id OR n.cliente_id <> f.cliente_id THEN
                    RAISE EXCEPTION 'El saldo a favor de la nota % es de otra empresa o cliente', n.id USING ERRCODE = '23514';
                END IF;
                SELECT coalesce(sum(monto), 0) INTO usado FROM billing.notas_credito_aplicaciones
                 WHERE nota_credito_id = NEW.nota_credito_id;
                IF usado + NEW.monto > n.a_favor THEN
                    RAISE EXCEPTION 'La nota % no tiene saldo a favor suficiente', n.id USING ERRCODE = '23514';
                END IF;
                RETURN NEW;
            END $$;
            CREATE TRIGGER notas_credito_aplicaciones_validar BEFORE INSERT ON billing.notas_credito_aplicaciones
                FOR EACH ROW EXECUTE FUNCTION billing.validar_aplicacion_nota();
            CREATE TRIGGER notas_credito_aplicaciones_inmutable BEFORE UPDATE OR DELETE ON billing.notas_credito_aplicaciones
                FOR EACH ROW EXECUTE FUNCTION audit.rechazar_modificacion();
            CREATE TRIGGER notas_credito_aplicaciones_sin_truncate BEFORE TRUNCATE ON billing.notas_credito_aplicaciones
                FOR EACH STATEMENT EXECUTE FUNCTION audit.rechazar_modificacion();

            DO $do$
            BEGIN
                IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'argosisp_app') THEN
                    GRANT SELECT, INSERT ON billing.notas_credito_aplicaciones TO argosisp_app;
                    REVOKE UPDATE, DELETE, TRUNCATE ON billing.notas_credito_aplicaciones FROM argosisp_app;
                    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA billing TO argosisp_app;
                END IF;
            END
            $do$;
        `)
    }

    async down() {
        this.schema.raw(`
            DROP TABLE IF EXISTS billing.notas_credito_aplicaciones;
            DROP FUNCTION IF EXISTS billing.validar_aplicacion_nota();
            ALTER TABLE billing.notas_credito DROP CONSTRAINT IF EXISTS notas_credito_a_favor, DROP COLUMN IF EXISTS a_favor;
        `)
    }
}
