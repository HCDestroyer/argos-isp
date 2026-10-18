import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * A3 · hallazgo H4 del auditor: diarios y numeración guardada (contrato de localización fiscal
 * §10.7). `ledger.asientos` no se toca: el número vive en tablas aparte.
 *
 *  - `ledger.diarios` (configuración por empresa, con `version`): `VEN`, `COB`, `COM`, `IMP`,
 *    `CIE`, `VAR`, `CAJ-<caja>` y `BAN-<cuenta bancaria>`.
 *  - `ledger.secuencias` (`empresa_id`, `diario_id`, `anio`, `ultimo`): la única tabla de
 *    numeración que se actualiza, y solo de uno en uno (`ultimo = ultimo + 1`, por trigger).
 *  - `ledger.asientos_numeros` (`asiento_id` PK, `diario_id`, `anio`, `numero`; único
 *    `diario_id, anio, numero`): solo inserción, en la transacción del asiento.
 *  - `ledger.asientos_partidas` (`asiento_id` PK, `empresa_id`, `anio`, `partida`, `cierre_id`;
 *    único `empresa_id, anio, partida`): solo inserción, al cerrar el mes.
 *  - Lo existente se numera aquí con una sola inserción por tabla: números en orden `(fecha, id)`
 *    por diario y año; partidas de los meses ya cerrados en orden `(fecha, numero, id)`.
 */
export default class extends BaseSchema {
    async up() {
        this.schema.raw(`
            CREATE TABLE ledger.diarios (
                id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                empresa_id bigint NOT NULL REFERENCES core.empresas (id),
                codigo text NOT NULL,
                nombre text NOT NULL,
                tipo text NOT NULL CHECK (tipo IN ('ventas', 'cobros', 'caja', 'banco', 'compras', 'impuestos', 'cierre', 'varios')),
                cuenta_por_defecto bigint REFERENCES ledger.cuentas (id),
                caja_id bigint REFERENCES ledger.cajas (id),
                cuenta_bancaria_id bigint REFERENCES billing.cuentas_bancarias (id),
                activo boolean NOT NULL DEFAULT true,
                version integer NOT NULL DEFAULT 1,
                created_at timestamptz NOT NULL DEFAULT now(),
                updated_at timestamptz NOT NULL DEFAULT now(),
                CONSTRAINT diarios_codigo UNIQUE (empresa_id, codigo),
                CHECK ((tipo = 'caja') = (caja_id IS NOT NULL)),
                CHECK ((tipo = 'banco') = (cuenta_bancaria_id IS NOT NULL))
            );

            CREATE TABLE ledger.secuencias (
                empresa_id bigint NOT NULL REFERENCES core.empresas (id),
                diario_id bigint NOT NULL REFERENCES ledger.diarios (id),
                anio integer NOT NULL CHECK (anio BETWEEN 2000 AND 2999),
                ultimo integer NOT NULL DEFAULT 0 CHECK (ultimo >= 0),
                PRIMARY KEY (diario_id, anio)
            );

            CREATE TABLE ledger.asientos_numeros (
                asiento_id bigint PRIMARY KEY REFERENCES ledger.asientos (id),
                diario_id bigint NOT NULL REFERENCES ledger.diarios (id),
                anio integer NOT NULL,
                numero integer NOT NULL CHECK (numero > 0),
                created_at timestamptz NOT NULL DEFAULT now(),
                CONSTRAINT asientos_numeros_unico UNIQUE (diario_id, anio, numero)
            );

            CREATE TABLE ledger.asientos_partidas (
                asiento_id bigint PRIMARY KEY REFERENCES ledger.asientos (id),
                empresa_id bigint NOT NULL REFERENCES core.empresas (id),
                anio integer NOT NULL,
                partida integer NOT NULL CHECK (partida > 0),
                cierre_id bigint NOT NULL REFERENCES ledger.cierres_mensuales (id),
                created_at timestamptz NOT NULL DEFAULT now(),
                CONSTRAINT asientos_partidas_unica UNIQUE (empresa_id, anio, partida)
            );

            -- la secuencia solo avanza de uno en uno; nunca se borra ni cambia de diario o año
            CREATE OR REPLACE FUNCTION ledger.proteger_secuencia() RETURNS trigger
            LANGUAGE plpgsql AS $fn$
            BEGIN
                IF TG_OP = 'DELETE' THEN
                    RAISE EXCEPTION 'La secuencia del diario % (%) no se puede borrar', OLD.diario_id, OLD.anio
                        USING ERRCODE = 'insufficient_privilege';
                END IF;
                IF NEW.empresa_id IS DISTINCT FROM OLD.empresa_id OR NEW.diario_id IS DISTINCT FROM OLD.diario_id
                   OR NEW.anio IS DISTINCT FROM OLD.anio OR NEW.ultimo IS DISTINCT FROM OLD.ultimo + 1 THEN
                    RAISE EXCEPTION 'La secuencia del diario % (%) solo avanza de uno en uno', OLD.diario_id, OLD.anio
                        USING ERRCODE = 'insufficient_privilege';
                END IF;
                RETURN NEW;
            END
            $fn$;
            CREATE TRIGGER secuencias_avance BEFORE UPDATE OR DELETE ON ledger.secuencias
                FOR EACH ROW EXECUTE FUNCTION ledger.proteger_secuencia();
            CREATE TRIGGER secuencias_sin_truncate BEFORE TRUNCATE ON ledger.secuencias
                FOR EACH STATEMENT EXECUTE FUNCTION audit.rechazar_modificacion();

            -- número y partida: misma empresa que el asiento y año de su fecha
            CREATE OR REPLACE FUNCTION ledger.validar_numero_asiento() RETURNS trigger
            LANGUAGE plpgsql AS $fn$
            DECLARE
                v_asiento ledger.asientos%ROWTYPE;
                v_empresa bigint;
            BEGIN
                SELECT * INTO v_asiento FROM ledger.asientos WHERE id = NEW.asiento_id;
                IF TG_TABLE_NAME = 'asientos_numeros' THEN
                    SELECT empresa_id INTO v_empresa FROM ledger.diarios WHERE id = NEW.diario_id;
                ELSE
                    v_empresa := NEW.empresa_id;
                    IF NOT ledger.periodo_cerrado(v_asiento.fecha, v_asiento.empresa_id) THEN
                        RAISE EXCEPTION 'La partida del asiento % se asigna al cerrar su mes', NEW.asiento_id
                            USING ERRCODE = 'check_violation';
                    END IF;
                END IF;
                IF v_empresa IS DISTINCT FROM v_asiento.empresa_id THEN
                    RAISE EXCEPTION 'El asiento % es de la empresa %, no de la %', NEW.asiento_id, v_asiento.empresa_id, v_empresa
                        USING ERRCODE = 'check_violation';
                END IF;
                IF NEW.anio <> extract(year FROM v_asiento.fecha)::integer THEN
                    RAISE EXCEPTION 'El asiento % es del año %, no del %', NEW.asiento_id,
                        extract(year FROM v_asiento.fecha), NEW.anio
                        USING ERRCODE = 'check_violation';
                END IF;
                RETURN NEW;
            END
            $fn$;
            CREATE TRIGGER asientos_numeros_validar BEFORE INSERT ON ledger.asientos_numeros
                FOR EACH ROW EXECUTE FUNCTION ledger.validar_numero_asiento();
            CREATE TRIGGER asientos_partidas_validar BEFORE INSERT ON ledger.asientos_partidas
                FOR EACH ROW EXECUTE FUNCTION ledger.validar_numero_asiento();

            CREATE TRIGGER asientos_numeros_inmutable BEFORE UPDATE OR DELETE ON ledger.asientos_numeros
                FOR EACH ROW EXECUTE FUNCTION audit.rechazar_modificacion();
            CREATE TRIGGER asientos_numeros_sin_truncate BEFORE TRUNCATE ON ledger.asientos_numeros
                FOR EACH STATEMENT EXECUTE FUNCTION audit.rechazar_modificacion();
            CREATE TRIGGER asientos_partidas_inmutable BEFORE UPDATE OR DELETE ON ledger.asientos_partidas
                FOR EACH ROW EXECUTE FUNCTION audit.rechazar_modificacion();
            CREATE TRIGGER asientos_partidas_sin_truncate BEFORE TRUNCATE ON ledger.asientos_partidas
                FOR EACH STATEMENT EXECUTE FUNCTION audit.rechazar_modificacion();

            /*
            | Lo existente
            */
            INSERT INTO ledger.diarios (empresa_id, codigo, nombre, tipo)
            SELECT e.id, b.codigo, b.nombre, b.tipo
              FROM core.empresas e
             CROSS JOIN (VALUES ('VEN', 'Ventas', 'ventas'), ('COB', 'Cobros', 'cobros'),
                                ('COM', 'Compras y egresos', 'compras'), ('IMP', 'Impuestos', 'impuestos'),
                                ('CIE', 'Cierre', 'cierre'), ('VAR', 'Varios', 'varios')) AS b (codigo, nombre, tipo)
             ORDER BY e.id, b.codigo;
            INSERT INTO ledger.diarios (empresa_id, codigo, nombre, tipo, cuenta_por_defecto, caja_id)
            SELECT c.empresa_id, 'CAJ-' || c.id, 'Caja · ' || c.nombre, 'caja', c.cuenta_id, c.id
              FROM ledger.cajas c ORDER BY c.id;
            INSERT INTO ledger.diarios (empresa_id, codigo, nombre, tipo, cuenta_por_defecto, cuenta_bancaria_id)
            SELECT b.empresa_id, 'BAN-' || b.id, 'Banco · ' || b.alias, 'banco', b.cuenta_id, b.id
              FROM billing.cuentas_bancarias b ORDER BY b.id;

            -- diario de cada asiento con la misma regla que app/ledger/diarios.ts
            CREATE TEMP TABLE diario_asiento ON COMMIT DROP AS
            SELECT a.id AS asiento_id, a.empresa_id, a.fecha,
                   extract(year FROM a.fecha)::integer AS anio,
                   d.id AS diario_id
              FROM ledger.asientos a
              CROSS JOIN LATERAL (
                  SELECT CASE
                      WHEN a.origen_tipo IN ('factura', 'mora', 'nota_credito') THEN 'VEN'
                      WHEN a.origen_tipo = 'ajuste' THEN 'VAR'
                      ELSE coalesce(
                          (SELECT 'CAJ-' || c.id FROM ledger.movimientos m JOIN ledger.cajas c ON c.cuenta_id = m.cuenta_id
                            WHERE m.asiento_id = a.id AND c.empresa_id = a.empresa_id ORDER BY c.id LIMIT 1),
                          (SELECT 'BAN-' || b.id FROM ledger.movimientos m
                             JOIN billing.cuentas_bancarias b ON b.cuenta_id = m.cuenta_id
                            WHERE m.asiento_id = a.id AND b.empresa_id = a.empresa_id ORDER BY b.id LIMIT 1),
                          CASE a.origen_tipo WHEN 'pago' THEN 'COB' WHEN 'egreso' THEN 'COM' ELSE 'VAR' END)
                  END AS codigo
              ) x
              JOIN ledger.diarios d ON d.empresa_id = a.empresa_id AND d.codigo = x.codigo;

            INSERT INTO ledger.asientos_numeros (asiento_id, diario_id, anio, numero)
            SELECT asiento_id, diario_id, anio,
                   row_number() OVER (PARTITION BY diario_id, anio ORDER BY fecha, asiento_id)
              FROM diario_asiento
             ORDER BY diario_id, anio, fecha, asiento_id;

            INSERT INTO ledger.secuencias (empresa_id, diario_id, anio, ultimo)
            SELECT d.empresa_id, n.diario_id, n.anio, max(n.numero)
              FROM ledger.asientos_numeros n JOIN ledger.diarios d ON d.id = n.diario_id
             GROUP BY d.empresa_id, n.diario_id, n.anio;

            INSERT INTO ledger.asientos_partidas (asiento_id, empresa_id, anio, partida, cierre_id)
            SELECT a.id, a.empresa_id, extract(year FROM a.fecha)::integer,
                   row_number() OVER (PARTITION BY a.empresa_id, extract(year FROM a.fecha)
                                      ORDER BY a.fecha, n.numero, a.id),
                   c.id
              FROM ledger.asientos a
              JOIN ledger.asientos_numeros n ON n.asiento_id = a.id
              JOIN ledger.cierres_mensuales c
                ON c.empresa_id = a.empresa_id AND c.periodo = date_trunc('month', a.fecha)::date
               AND NOT EXISTS (SELECT 1 FROM ledger.reaperturas_mensuales r WHERE r.cierre_id = c.id);

            DO $do$
            BEGIN
                IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'argosisp_app') THEN
                    GRANT SELECT, INSERT, UPDATE ON ledger.diarios TO argosisp_app;
                    REVOKE DELETE, TRUNCATE ON ledger.diarios FROM argosisp_app;
                    GRANT SELECT, INSERT ON ledger.secuencias, ledger.asientos_numeros, ledger.asientos_partidas
                        TO argosisp_app;
                    REVOKE UPDATE, DELETE, TRUNCATE
                        ON ledger.secuencias, ledger.asientos_numeros, ledger.asientos_partidas FROM argosisp_app;
                    GRANT UPDATE (ultimo) ON ledger.secuencias TO argosisp_app;
                END IF;
            END
            $do$;
        `)
    }

    async down() {
        this.schema.raw(`
            DROP TABLE IF EXISTS ledger.asientos_partidas;
            DROP TABLE IF EXISTS ledger.asientos_numeros;
            DROP TABLE IF EXISTS ledger.secuencias;
            DROP TABLE IF EXISTS ledger.diarios;
            DROP FUNCTION IF EXISTS ledger.validar_numero_asiento();
            DROP FUNCTION IF EXISTS ledger.proteger_secuencia();
        `)
    }
}
