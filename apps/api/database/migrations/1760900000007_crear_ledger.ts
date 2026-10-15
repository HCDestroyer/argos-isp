import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Schema `ledger`: libro de doble partida inmutable, cajas, bancos, egresos y cierres.
 *
 * Restricciones en base de datos:
 *  - Cada movimiento lleva exactamente uno de debe/haber > 0 (CHECK).
 *  - Constraint triggers DEFERRABLE INITIALLY DEFERRED: al hacer COMMIT, cada asiento tocado
 *    debe tener al menos 2 movimientos y sum(debe) = sum(haber).
 *  - `asientos` y `movimientos` rechazan UPDATE, DELETE y TRUNCATE.
 */
export default class extends BaseSchema {
    async up() {
        this.schema.raw(`
            CREATE TABLE ledger.cuentas (
                id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                codigo text NOT NULL UNIQUE,
                nombre text NOT NULL,
                tipo text NOT NULL CHECK (tipo IN ('activo', 'pasivo', 'ingreso', 'gasto')),
                padre_id bigint REFERENCES ledger.cuentas (id),
                activa boolean NOT NULL DEFAULT true,
                version integer NOT NULL DEFAULT 1,
                created_at timestamptz NOT NULL DEFAULT now(),
                updated_at timestamptz NOT NULL DEFAULT now()
            );
            CREATE INDEX cuentas_padre ON ledger.cuentas (padre_id);

            CREATE TABLE ledger.asientos (
                id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                fecha date NOT NULL,
                descripcion text NOT NULL,
                origen_tipo text NOT NULL CHECK (origen_tipo IN (
                    'factura', 'pago', 'mora', 'nota_credito', 'egreso', 'cierre_caja', 'ajuste'
                )),
                origen_id bigint,
                periodo_cerrado boolean NOT NULL DEFAULT false,
                created_by bigint REFERENCES core.usuarios (id),
                created_at timestamptz NOT NULL DEFAULT now()
            );
            CREATE INDEX asientos_origen ON ledger.asientos (origen_tipo, origen_id);
            CREATE INDEX asientos_fecha ON ledger.asientos (fecha);

            CREATE TABLE ledger.movimientos (
                id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                asiento_id bigint NOT NULL REFERENCES ledger.asientos (id),
                cuenta_id bigint NOT NULL REFERENCES ledger.cuentas (id),
                debe numeric(14, 2) NOT NULL DEFAULT 0,
                haber numeric(14, 2) NOT NULL DEFAULT 0,
                -- auxiliar de cuentas por cobrar: el saldo del cliente es la suma de sus movimientos
                cliente_id bigint REFERENCES core.clientes (id),
                created_at timestamptz NOT NULL DEFAULT now(),
                CONSTRAINT movimientos_un_lado CHECK (
                    debe >= 0 AND haber >= 0 AND ((debe > 0) <> (haber > 0))
                )
            );
            CREATE INDEX movimientos_asiento ON ledger.movimientos (asiento_id);
            CREATE INDEX movimientos_cuenta_cliente ON ledger.movimientos (cuenta_id, cliente_id);
            CREATE INDEX movimientos_cliente ON ledger.movimientos (cliente_id) WHERE cliente_id IS NOT NULL;

            -- Verifica el cuadre del asiento al final de la transacción.
            CREATE OR REPLACE FUNCTION ledger.verificar_cuadre() RETURNS trigger
            LANGUAGE plpgsql AS $fn$
            DECLARE
                v_asiento bigint;
                v_cantidad integer;
                v_debe numeric;
                v_haber numeric;
            BEGIN
                IF TG_TABLE_NAME = 'asientos' THEN
                    v_asiento := NEW.id;
                ELSE
                    v_asiento := NEW.asiento_id;
                END IF;

                SELECT count(*), coalesce(sum(debe), 0), coalesce(sum(haber), 0)
                  INTO v_cantidad, v_debe, v_haber
                  FROM ledger.movimientos
                 WHERE asiento_id = v_asiento;

                IF v_cantidad < 2 THEN
                    RAISE EXCEPTION 'Asiento % descuadrado: tiene % movimiento(s), se requieren al menos 2',
                        v_asiento, v_cantidad
                        USING ERRCODE = 'check_violation', CONSTRAINT = 'asiento_cuadrado';
                END IF;

                IF v_debe <> v_haber THEN
                    RAISE EXCEPTION 'Asiento % descuadrado: debe % <> haber %', v_asiento, v_debe, v_haber
                        USING ERRCODE = 'check_violation', CONSTRAINT = 'asiento_cuadrado';
                END IF;

                RETURN NULL;
            END
            $fn$;

            CREATE CONSTRAINT TRIGGER asientos_cuadre
                AFTER INSERT ON ledger.asientos
                DEFERRABLE INITIALLY DEFERRED
                FOR EACH ROW EXECUTE FUNCTION ledger.verificar_cuadre();

            CREATE CONSTRAINT TRIGGER movimientos_cuadre
                AFTER INSERT ON ledger.movimientos
                DEFERRABLE INITIALLY DEFERRED
                FOR EACH ROW EXECUTE FUNCTION ledger.verificar_cuadre();

            CREATE TRIGGER asientos_inmutable
                BEFORE UPDATE OR DELETE ON ledger.asientos
                FOR EACH ROW EXECUTE FUNCTION audit.rechazar_modificacion();
            CREATE TRIGGER asientos_sin_truncate
                BEFORE TRUNCATE ON ledger.asientos
                FOR EACH STATEMENT EXECUTE FUNCTION audit.rechazar_modificacion();
            CREATE TRIGGER movimientos_inmutable
                BEFORE UPDATE OR DELETE ON ledger.movimientos
                FOR EACH ROW EXECUTE FUNCTION audit.rechazar_modificacion();
            CREATE TRIGGER movimientos_sin_truncate
                BEFORE TRUNCATE ON ledger.movimientos
                FOR EACH STATEMENT EXECUTE FUNCTION audit.rechazar_modificacion();

            CREATE TABLE ledger.cajas (
                id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                nombre text NOT NULL UNIQUE,
                cajero_id bigint REFERENCES core.usuarios (id),
                cuenta_id bigint NOT NULL REFERENCES ledger.cuentas (id),
                activa boolean NOT NULL DEFAULT true,
                version integer NOT NULL DEFAULT 1,
                created_at timestamptz NOT NULL DEFAULT now(),
                updated_at timestamptz NOT NULL DEFAULT now()
            );

            CREATE TABLE ledger.cajas_turnos (
                id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                caja_id bigint NOT NULL REFERENCES ledger.cajas (id),
                abierto_en timestamptz NOT NULL DEFAULT now(),
                fondo_inicial numeric(14, 2) NOT NULL DEFAULT 0 CHECK (fondo_inicial >= 0),
                cerrado_en timestamptz,
                esperado numeric(14, 2),
                contado numeric(14, 2),
                diferencia numeric(14, 2),
                motivo text,
                version integer NOT NULL DEFAULT 1,
                created_at timestamptz NOT NULL DEFAULT now(),
                updated_at timestamptz NOT NULL DEFAULT now(),
                CHECK (cerrado_en IS NULL OR cerrado_en >= abierto_en)
            );
            -- un solo turno abierto por caja
            CREATE UNIQUE INDEX cajas_turnos_abierto ON ledger.cajas_turnos (caja_id) WHERE cerrado_en IS NULL;

            CREATE TABLE ledger.bancos (
                id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                nombre text NOT NULL,
                cuenta_id bigint NOT NULL REFERENCES ledger.cuentas (id),
                numero_mascarado text,
                version integer NOT NULL DEFAULT 1,
                created_at timestamptz NOT NULL DEFAULT now(),
                updated_at timestamptz NOT NULL DEFAULT now()
            );

            CREATE TABLE ledger.egresos_categorias (
                id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                nombre text NOT NULL UNIQUE,
                created_at timestamptz NOT NULL DEFAULT now(),
                updated_at timestamptz NOT NULL DEFAULT now()
            );

            CREATE TABLE ledger.egresos (
                id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                fecha date NOT NULL,
                categoria_id bigint NOT NULL REFERENCES ledger.egresos_categorias (id),
                proveedor text,
                monto numeric(14, 2) NOT NULL CHECK (monto > 0),
                forma_pago text NOT NULL,
                comprobante text,
                asiento_id bigint REFERENCES ledger.asientos (id),
                version integer NOT NULL DEFAULT 1,
                created_at timestamptz NOT NULL DEFAULT now(),
                updated_at timestamptz NOT NULL DEFAULT now()
            );
            CREATE INDEX egresos_fecha ON ledger.egresos (fecha);

            CREATE TABLE ledger.cierres_mensuales (
                id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                -- primer día del mes cerrado
                periodo date NOT NULL UNIQUE CHECK (extract(day FROM periodo) = 1),
                cerrado_en timestamptz NOT NULL DEFAULT now(),
                cerrado_por bigint REFERENCES core.usuarios (id),
                created_at timestamptz NOT NULL DEFAULT now()
            );
        `)
    }

    async down() {
        this.schema.raw(`
            DROP TABLE IF EXISTS ledger.cierres_mensuales;
            DROP TABLE IF EXISTS ledger.egresos;
            DROP TABLE IF EXISTS ledger.egresos_categorias;
            DROP TABLE IF EXISTS ledger.bancos;
            DROP TABLE IF EXISTS ledger.cajas_turnos;
            DROP TABLE IF EXISTS ledger.cajas;
            DROP TABLE IF EXISTS ledger.movimientos;
            DROP TABLE IF EXISTS ledger.asientos;
            DROP FUNCTION IF EXISTS ledger.verificar_cuadre();
            DROP TABLE IF EXISTS ledger.cuentas;
        `)
    }
}
