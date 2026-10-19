import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * A3 · programa de lealtad, fase 2 (canjes; `contratos/lealtad.md` §3 y §5):
 *
 *  - `lealtad.premios`: catálogo por programa (y empresa), con `version`; se desactivan, no se borran.
 *    `mes_gratis` = descuento del 100 % de la línea del plan. `existencias` null = sin límite.
 *  - `lealtad.canjes`: el canje y su estado (`reservado`, `aplicado`, `revertido`, `rechazado`), que
 *    cambia solo por acción. Los puntos salen con un movimiento `canje` (origen `canje`) y vuelven con
 *    `reverso`; el canje no guarda saldo.
 *
 * Sin datos previos: nacen vacías.
 */
export default class extends BaseSchema {
    async up() {
        this.schema.raw(`
            CREATE TABLE lealtad.premios (
                id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                empresa_id bigint NOT NULL REFERENCES core.empresas (id),
                programa_id bigint NOT NULL REFERENCES lealtad.programas (id),
                tipo text NOT NULL CHECK (tipo IN ('descuento_factura', 'mes_gratis', 'mejora_plan', 'bien', 'boletos')),
                nombre text NOT NULL CHECK (length(btrim(nombre)) > 0),
                costo_puntos integer NOT NULL CHECK (costo_puntos > 0),
                descuento_tipo text CHECK (descuento_tipo IN ('monto', 'porcentaje')),
                descuento_valor numeric(14, 2) CHECK (descuento_valor > 0),
                tope numeric(14, 2) CHECK (tope > 0),
                plan_destino_id bigint REFERENCES network.planes (id),
                dias integer CHECK (dias BETWEEN 1 AND 366),
                costo_unitario numeric(14, 2) CHECK (costo_unitario >= 0),
                existencias integer CHECK (existencias >= 0),
                en_portal boolean NOT NULL DEFAULT false,
                activo boolean NOT NULL DEFAULT true,
                version integer NOT NULL DEFAULT 1,
                created_at timestamptz NOT NULL DEFAULT now(),
                updated_at timestamptz NOT NULL DEFAULT now(),
                CHECK (tipo <> 'descuento_factura' OR (descuento_tipo IS NOT NULL AND descuento_valor IS NOT NULL)),
                CHECK (descuento_tipo <> 'porcentaje' OR descuento_valor <= 100),
                CHECK (tipo <> 'mejora_plan' OR (plan_destino_id IS NOT NULL AND dias IS NOT NULL))
            );
            CREATE INDEX premios_programa ON lealtad.premios (programa_id, id);
            CREATE INDEX premios_empresa ON lealtad.premios (empresa_id, id DESC);
            CREATE TRIGGER premios_empresa BEFORE INSERT OR UPDATE OF empresa_id, programa_id ON lealtad.premios
                FOR EACH ROW EXECUTE FUNCTION lealtad.validar_empresa_regla();

            CREATE TABLE lealtad.canjes (
                id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                empresa_id bigint NOT NULL REFERENCES core.empresas (id),
                programa_id bigint NOT NULL REFERENCES lealtad.programas (id),
                cliente_id bigint NOT NULL REFERENCES core.clientes (id),
                servicio_id bigint NOT NULL REFERENCES core.servicios (id),
                premio_id bigint NOT NULL REFERENCES lealtad.premios (id),
                tipo text NOT NULL CHECK (tipo IN ('descuento_factura', 'mes_gratis', 'mejora_plan', 'bien', 'boletos')),
                puntos integer NOT NULL CHECK (puntos > 0),
                estado text NOT NULL DEFAULT 'reservado'
                    CHECK (estado IN ('reservado', 'aplicado', 'revertido', 'rechazado')),
                descuento numeric(14, 2) CHECK (descuento >= 0),
                factura_id bigint REFERENCES billing.facturas (id),
                nota_credito_id bigint REFERENCES billing.notas_credito (id),
                plan_temporal_id bigint REFERENCES core.servicios_planes_temporales (id),
                movimiento_id bigint REFERENCES lealtad.movimientos (id),
                canal text NOT NULL CHECK (canal IN ('panel', 'portal')),
                aplicado_en timestamptz,
                revertido_en timestamptz,
                motivo text,
                creado_por bigint REFERENCES core.usuarios (id),
                version integer NOT NULL DEFAULT 1,
                created_at timestamptz NOT NULL DEFAULT now(),
                updated_at timestamptz NOT NULL DEFAULT now(),
                CHECK (estado <> 'aplicado' OR aplicado_en IS NOT NULL),
                CHECK ((estado = 'revertido') = (revertido_en IS NOT NULL)),
                CHECK (estado <> 'revertido' OR length(btrim(coalesce(motivo, ''))) > 0)
            );
            CREATE INDEX canjes_cliente ON lealtad.canjes (empresa_id, cliente_id, id DESC);
            CREATE INDEX canjes_servicio ON lealtad.canjes (servicio_id, estado);
            CREATE INDEX canjes_empresa ON lealtad.canjes (empresa_id, id DESC);
            CREATE TRIGGER canjes_empresa BEFORE INSERT OR UPDATE OF empresa_id, programa_id ON lealtad.canjes
                FOR EACH ROW EXECUTE FUNCTION lealtad.validar_empresa_regla();

            DO $do$
            BEGIN
                IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'argosisp_app') THEN
                    GRANT SELECT, INSERT, UPDATE ON lealtad.premios, lealtad.canjes TO argosisp_app;
                    REVOKE DELETE, TRUNCATE ON lealtad.premios, lealtad.canjes FROM argosisp_app;
                    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA lealtad TO argosisp_app;
                END IF;
            END
            $do$;
        `)
    }

    async down() {
        this.schema.raw(`
            DROP TABLE IF EXISTS lealtad.canjes;
            DROP TABLE IF EXISTS lealtad.premios;
        `)
    }
}
