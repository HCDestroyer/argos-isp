import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * A3 · decisiones del PM (19 oct).
 *
 * 1. **Una factura de valor 0 nunca se genera.** Lo que antes era una factura de Q0 (mes gratis,
 *    descuento del 100 %, cargo único sin costo, canje) es una **bonificación**:
 *    `billing.bonificaciones` (solo inserción), con servicio o cliente, periodo, concepto, bruto, base
 *    sin IVA, motivo del catálogo de su empresa (obligatorio) y origen. Su único asiento es el interno
 *    `5.1.01 Descuentos / ingreso` por la base (origen nuevo `bonificacion`), sin CxC, IVA ni DTE.
 *    `clave_unica` comparte espacio con la de `billing.facturas` (trigger en las dos tablas): el
 *    periodo bonificado queda ocupado y el cron no lo vuelve a facturar. `facturas_total_positivo`
 *    (NOT VALID) impide una factura nueva con total 0 (salvo la importación histórica «sin cargo»). El motivo «Canje de lealtad» se agrega al
 *    catálogo de cada empresa (los canjes de mes gratis y de descuento lo usan).
 *    `lealtad.canjes.bonificacion_id`: el canje aplicado a una bonificación (en lugar de a una factura).
 * 3. `billing.facturas_lineas.adicional_periodo`: periodo que cobra la línea de un adicional (el de la
 *    factura o, en un primer periodo prorrateado, el periodo del alta). La línea es única por
 *    asignación y periodo dentro de la factura.
 * 5. `5.1.03 Premios y promociones` con `categoria_fiscal = deducible` (valor nuevo del catálogo).
 */
export default class extends BaseSchema {
    async up() {
        this.schema.raw(`
            -- agrega \`bonificacion\` y conserva los demás orígenes que ya admite la base
            DO $$
            DECLARE
                valores text[];
            BEGIN
                SELECT array_agg(DISTINCT m[1]) INTO valores
                  FROM pg_constraint c, regexp_matches(pg_get_constraintdef(c.oid), '''([a-z_]+)''', 'g') m
                 WHERE c.conname = 'asientos_origen_tipo_check' AND c.conrelid = 'ledger.asientos'::regclass;
                IF NOT 'bonificacion' = ANY (valores) THEN
                    valores := valores || 'bonificacion'::text;
                END IF;
                ALTER TABLE ledger.asientos DROP CONSTRAINT asientos_origen_tipo_check;
                EXECUTE format('ALTER TABLE ledger.asientos ADD CONSTRAINT asientos_origen_tipo_check CHECK (origen_tipo = ANY (%L::text[]))', valores);
            END $$;

            CREATE OR REPLACE FUNCTION billing.sembrar_catalogos_cargo(empresa bigint) RETURNS void LANGUAGE plpgsql AS $$
            BEGIN
                INSERT INTO billing.conceptos_cargo (empresa_id, nombre, tipo, cuenta_codigo)
                VALUES (empresa, 'Instalación', 'otro', '4.1.03'), (empresa, 'Equipo', 'producto', '4.1.03'),
                       (empresa, 'Visita técnica', 'otro', '4.1.03'), (empresa, 'Otro', 'otro', '4.1.03')
                ON CONFLICT (empresa_id, nombre) DO NOTHING;
                INSERT INTO billing.motivos_sin_costo (empresa_id, nombre)
                VALUES (empresa, 'Promoción'), (empresa, 'Cortesía'), (empresa, 'Garantía'),
                       (empresa, 'Compensación por falla'), (empresa, 'Convenio'), (empresa, 'Canje de lealtad')
                ON CONFLICT (empresa_id, nombre) DO NOTHING;
            END $$;
            SELECT billing.sembrar_catalogos_cargo(id) FROM core.empresas ORDER BY id;

            CREATE TABLE billing.bonificaciones (
                id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                empresa_id bigint NOT NULL REFERENCES core.empresas (id),
                cliente_id bigint NOT NULL REFERENCES core.clientes (id),
                servicio_id bigint REFERENCES core.servicios (id),
                periodo date NOT NULL,
                clave_unica text NOT NULL UNIQUE,
                concepto text NOT NULL CHECK (length(btrim(concepto)) > 0),
                origen text NOT NULL CHECK (origen IN ('mes_gratis', 'descuento_100', 'cargo_sin_costo', 'canje')),
                bruto numeric(14, 2) NOT NULL CHECK (bruto > 0),
                base numeric(14, 2) NOT NULL CHECK (base > 0 AND base <= bruto),
                lineas jsonb NOT NULL,
                motivo_id bigint NOT NULL REFERENCES billing.motivos_sin_costo (id),
                motivo_texto text NOT NULL CHECK (length(btrim(motivo_texto)) > 0),
                canje_id bigint REFERENCES lealtad.canjes (id),
                asiento_id bigint NOT NULL UNIQUE REFERENCES ledger.asientos (id),
                reglas_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
                creado_por bigint REFERENCES core.usuarios (id),
                created_at timestamptz NOT NULL DEFAULT now()
            );
            CREATE INDEX bonificaciones_cliente ON billing.bonificaciones (cliente_id, id DESC);
            CREATE INDEX bonificaciones_empresa ON billing.bonificaciones (empresa_id, periodo);
            CREATE TRIGGER bonificaciones_inmutable BEFORE UPDATE OR DELETE ON billing.bonificaciones
                FOR EACH ROW EXECUTE FUNCTION audit.rechazar_modificacion();
            CREATE TRIGGER bonificaciones_sin_truncate BEFORE TRUNCATE ON billing.bonificaciones
                FOR EACH STATEMENT EXECUTE FUNCTION audit.rechazar_modificacion();

            -- el motivo es del catálogo de la empresa de la bonificación
            CREATE FUNCTION billing.validar_bonificacion() RETURNS trigger LANGUAGE plpgsql AS $$
            BEGIN
                IF NOT EXISTS (SELECT 1 FROM billing.motivos_sin_costo m
                                WHERE m.id = NEW.motivo_id AND m.empresa_id = NEW.empresa_id) THEN
                    RAISE EXCEPTION 'El motivo % no es del catálogo de la empresa %', NEW.motivo_id, NEW.empresa_id
                        USING ERRCODE = '23514';
                END IF;
                IF EXISTS (SELECT 1 FROM billing.facturas f WHERE f.clave_unica = NEW.clave_unica) THEN
                    RAISE EXCEPTION 'El periodo % ya tiene factura', NEW.clave_unica USING ERRCODE = '23505';
                END IF;
                RETURN NEW;
            END $$;
            CREATE TRIGGER bonificaciones_validar BEFORE INSERT ON billing.bonificaciones
                FOR EACH ROW EXECUTE FUNCTION billing.validar_bonificacion();

            -- una factura no ocupa un periodo ya bonificado
            CREATE FUNCTION billing.factura_sin_bonificacion() RETURNS trigger LANGUAGE plpgsql AS $$
            BEGIN
                IF EXISTS (SELECT 1 FROM billing.bonificaciones b WHERE b.clave_unica = NEW.clave_unica) THEN
                    RAISE EXCEPTION 'El periodo % ya está bonificado', NEW.clave_unica USING ERRCODE = '23505';
                END IF;
                RETURN NEW;
            END $$;
            CREATE TRIGGER facturas_sin_bonificacion BEFORE INSERT ON billing.facturas
                FOR EACH ROW EXECUTE FUNCTION billing.factura_sin_bonificacion();

            -- ninguna factura nueva en cero (las que ya existían quedan como historia); la importación
            -- histórica (\`facturas.importar_pendiente\`) conserva el periodo «sin cargo» del sistema anterior
            ALTER TABLE billing.facturas ADD CONSTRAINT facturas_total_positivo
                CHECK (total > 0 OR coalesce(reglas_snapshot->>'importada', '') = 'true') NOT VALID;

            ALTER TABLE lealtad.canjes ADD COLUMN bonificacion_id bigint REFERENCES billing.bonificaciones (id);
            ALTER TABLE lealtad.canjes ADD CONSTRAINT canjes_un_documento
                CHECK (factura_id IS NULL OR bonificacion_id IS NULL);

            ALTER TABLE billing.facturas_lineas ADD COLUMN adicional_periodo date;
            ALTER TABLE billing.facturas_lineas ADD CONSTRAINT facturas_lineas_adicional_periodo
                CHECK ((servicio_adicional_id IS NULL) = (adicional_periodo IS NULL)) NOT VALID;
            DROP INDEX IF EXISTS billing.facturas_lineas_adicional_unica;
            CREATE UNIQUE INDEX facturas_lineas_adicional_unica
                ON billing.facturas_lineas (factura_id, servicio_adicional_id, adicional_periodo)
                WHERE servicio_adicional_id IS NOT NULL;

            ALTER TABLE ledger.cuentas DROP CONSTRAINT IF EXISTS cuentas_categoria_fiscal_check;
            ALTER TABLE ledger.cuentas ADD CONSTRAINT cuentas_categoria_fiscal_check CHECK (categoria_fiscal IN (
                'deducible', 'no_deducible', 'limite_parientes', 'limite_exterior', 'limite_viaticos',
                'donacion_ong', 'publicidad', 'depreciacion'));
            -- catálogo de cuentas (no el libro): la cuenta del paquete GT ya instalada
            UPDATE ledger.cuentas SET categoria_fiscal = 'deducible'
             WHERE pais = 'GT' AND codigo = '5.1.03' AND categoria_fiscal IS NULL;

            DO $do$
            BEGIN
                IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'argosisp_app') THEN
                    GRANT SELECT, INSERT ON billing.bonificaciones TO argosisp_app;
                    REVOKE UPDATE, DELETE, TRUNCATE ON billing.bonificaciones FROM argosisp_app;
                    -- el id se reserva antes de su asiento (nextval + OVERRIDING SYSTEM VALUE)
                    EXECUTE format('GRANT USAGE, SELECT ON SEQUENCE %s TO argosisp_app',
                                   pg_get_serial_sequence('billing.bonificaciones', 'id'));
                END IF;
            END
            $do$;
        `)
    }

    async down() {
        this.schema.raw(`
            UPDATE ledger.cuentas SET categoria_fiscal = NULL WHERE categoria_fiscal = 'deducible';
            ALTER TABLE ledger.cuentas DROP CONSTRAINT IF EXISTS cuentas_categoria_fiscal_check;
            ALTER TABLE ledger.cuentas ADD CONSTRAINT cuentas_categoria_fiscal_check CHECK (categoria_fiscal IN (
                'no_deducible', 'limite_parientes', 'limite_exterior', 'limite_viaticos',
                'donacion_ong', 'publicidad', 'depreciacion'));
            DROP INDEX IF EXISTS billing.facturas_lineas_adicional_unica;
            ALTER TABLE billing.facturas_lineas DROP CONSTRAINT IF EXISTS facturas_lineas_adicional_periodo;
            ALTER TABLE billing.facturas_lineas DROP COLUMN IF EXISTS adicional_periodo;
            -- con primeros periodos prorrateados (dos líneas de una asignación en una factura) el índice
            -- anterior no se puede recrear: se deja sin él
            DO $$
            BEGIN
                IF NOT EXISTS (SELECT 1 FROM billing.facturas_lineas WHERE servicio_adicional_id IS NOT NULL
                                GROUP BY factura_id, servicio_adicional_id HAVING count(*) > 1) THEN
                    CREATE UNIQUE INDEX facturas_lineas_adicional_unica
                        ON billing.facturas_lineas (factura_id, servicio_adicional_id)
                        WHERE servicio_adicional_id IS NOT NULL;
                END IF;
            END $$;
            ALTER TABLE lealtad.canjes DROP CONSTRAINT IF EXISTS canjes_un_documento;
            ALTER TABLE lealtad.canjes DROP COLUMN IF EXISTS bonificacion_id;
            ALTER TABLE billing.facturas DROP CONSTRAINT IF EXISTS facturas_total_positivo;
            DROP TRIGGER IF EXISTS facturas_sin_bonificacion ON billing.facturas;
            DROP FUNCTION IF EXISTS billing.factura_sin_bonificacion();
            DROP TABLE IF EXISTS billing.bonificaciones;
            DROP FUNCTION IF EXISTS billing.validar_bonificacion();
            -- quita \`bonificacion\` y conserva los demás orígenes que ya admite la base
            DO $$
            DECLARE
                valores text[];
            BEGIN
                SELECT array_agg(DISTINCT m[1]) INTO valores
                  FROM pg_constraint c, regexp_matches(pg_get_constraintdef(c.oid), '''([a-z_]+)''', 'g') m
                 WHERE c.conname = 'asientos_origen_tipo_check' AND c.conrelid = 'ledger.asientos'::regclass;
                valores := array_remove(valores, 'bonificacion');
                ALTER TABLE ledger.asientos DROP CONSTRAINT asientos_origen_tipo_check;
                EXECUTE format('ALTER TABLE ledger.asientos ADD CONSTRAINT asientos_origen_tipo_check CHECK (origen_tipo = ANY (%L::text[])) NOT VALID', valores);
            END $$;
        `)
    }
}
