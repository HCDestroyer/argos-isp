import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Plan v3, lote T1 (`contratos/tipos-servicio.md` §2): tipo de servicio de planes y servicios.
 *
 * - `network.planes.tipo_servicio` (`internet` por defecto, `cable`, `iptv`, `mixto`) y
 *   `componentes text[]` (el mismo tipo en los simples; dos o tres en `mixto`); `precio_cable` y
 *   `precio_iptv` solo en `mixto`, para desglosar la factura; `bajada_kbps` y `subida_kbps`
 *   anulables solo en `cable`. `planes.tipo` (residencial, empresarial, dedicado) es comercial y no
 *   cambia.
 * - `core.servicios.tipo_servicio` (siempre igual al del plan, lo exige un trigger), `puntos`
 *   (televisores o decodificadores, informativo) y `router_id` anulable con CHECK: obligatorio en
 *   todo tipo salvo `cable`.
 * - Todo lo existente queda `internet` con `componentes = {internet}`: los DEFAULT lo llenan sin
 *   reescribir nada más.
 *
 * Cambiar el tipo de un plan con servicios lo hace la acción `planes.editar`, que pasa cada servicio al
 * tipo nuevo y emite su `servicio.config_cambiada`. Los triggers y CHECK lanzan `check_violation` (23514), que la API responde como 422.
 */
export default class extends BaseSchema {
    async up() {
        this.schema.raw(`
            -- los componentes de un plan: simples = [tipo]; mixto = dos o tres distintos
            CREATE OR REPLACE FUNCTION network.componentes_del_plan_validos(tipo text, componentes text[])
            RETURNS boolean
            LANGUAGE sql IMMUTABLE AS $$
                SELECT CASE
                    WHEN tipo = 'mixto' THEN
                        componentes <@ ARRAY['internet', 'cable', 'iptv']::text[]
                        AND cardinality(componentes) BETWEEN 2 AND 3
                        AND cardinality(componentes) = cardinality(ARRAY(SELECT DISTINCT unnest(componentes)))
                    ELSE componentes = ARRAY[tipo]::text[]
                END
            $$;

            ALTER TABLE network.planes
                ADD COLUMN tipo_servicio text NOT NULL DEFAULT 'internet',
                ADD COLUMN componentes text[] NOT NULL DEFAULT ARRAY['internet']::text[],
                ADD COLUMN precio_cable numeric(14,2),
                ADD COLUMN precio_iptv numeric(14,2),
                ALTER COLUMN bajada_kbps DROP NOT NULL,
                ALTER COLUMN subida_kbps DROP NOT NULL,
                ADD CONSTRAINT planes_tipo_servicio_check
                    CHECK (tipo_servicio IN ('internet', 'cable', 'iptv', 'mixto')),
                ADD CONSTRAINT planes_componentes_por_tipo
                    CHECK (network.componentes_del_plan_validos(tipo_servicio, componentes)),
                ADD CONSTRAINT planes_precio_cable_check CHECK (precio_cable >= 0),
                ADD CONSTRAINT planes_precio_iptv_check CHECK (precio_iptv >= 0),
                ADD CONSTRAINT planes_desglose_solo_mixto
                    CHECK (tipo_servicio = 'mixto' OR (precio_cable IS NULL AND precio_iptv IS NULL)),
                -- con internet la línea de internet es el resto y debe quedar con precio; sin internet
                -- (cable + IPTV) el desglose puede cubrir todo
                ADD CONSTRAINT planes_desglose_dentro_del_precio
                    CHECK (
                        tipo_servicio <> 'mixto'
                        OR (
                            CASE WHEN 'internet' = ANY(componentes)
                                THEN coalesce(precio_cable, 0) + coalesce(precio_iptv, 0) < precio
                                ELSE coalesce(precio_cable, 0) + coalesce(precio_iptv, 0) <= precio
                            END
                        )
                    ),
                ADD CONSTRAINT planes_velocidad_por_tipo
                    CHECK (tipo_servicio = 'cable' OR (bajada_kbps IS NOT NULL AND subida_kbps IS NOT NULL));
            CREATE INDEX planes_tipo_servicio ON network.planes (tipo_servicio);

            ALTER TABLE core.servicios
                ADD COLUMN tipo_servicio text NOT NULL DEFAULT 'internet',
                ADD COLUMN puntos smallint,
                ALTER COLUMN router_id DROP NOT NULL,
                ADD CONSTRAINT servicios_tipo_servicio_check
                    CHECK (tipo_servicio IN ('internet', 'cable', 'iptv', 'mixto')),
                ADD CONSTRAINT servicios_puntos_check CHECK (puntos >= 0),
                ADD CONSTRAINT servicios_router_por_tipo
                    CHECK (tipo_servicio = 'cable' OR router_id IS NOT NULL);
            CREATE INDEX servicios_tipo_servicio ON core.servicios (tipo_servicio);

            -- el tipo del servicio es el de su plan (también el temporal: plan_id pasa a ser el temporal)
            CREATE OR REPLACE FUNCTION core.servicios_tipo_del_plan() RETURNS trigger
            LANGUAGE plpgsql AS $$
            DECLARE
                tipo_plan text;
            BEGIN
                SELECT tipo_servicio INTO tipo_plan FROM network.planes WHERE id = NEW.plan_id;
                IF tipo_plan IS DISTINCT FROM NEW.tipo_servicio THEN
                    RAISE EXCEPTION 'El tipo de servicio (%) no coincide con el del plan (%)',
                        NEW.tipo_servicio, tipo_plan
                        USING ERRCODE = '23514', CONSTRAINT = 'servicios_tipo_del_plan';
                END IF;
                RETURN NEW;
            END $$;
            CREATE TRIGGER servicios_tipo_del_plan
                BEFORE INSERT OR UPDATE OF tipo_servicio, plan_id ON core.servicios
                FOR EACH ROW EXECUTE FUNCTION core.servicios_tipo_del_plan();
        `)
    }

    /**
     * No vuelve a poner NOT NULL en `router_id`, `bajada_kbps` ni `subida_kbps`: podría haber servicios de
     * cable y planes sin velocidad, y el rollback de las pruebas (`--batch=0`) no puede fallar por datos.
     */
    async down() {
        this.schema.raw(`
            DROP TRIGGER IF EXISTS servicios_tipo_del_plan ON core.servicios;
            DROP FUNCTION IF EXISTS core.servicios_tipo_del_plan();
            ALTER TABLE core.servicios
                DROP CONSTRAINT IF EXISTS servicios_router_por_tipo,
                DROP CONSTRAINT IF EXISTS servicios_puntos_check,
                DROP CONSTRAINT IF EXISTS servicios_tipo_servicio_check,
                DROP COLUMN IF EXISTS puntos,
                DROP COLUMN IF EXISTS tipo_servicio;
            ALTER TABLE network.planes
                DROP CONSTRAINT IF EXISTS planes_velocidad_por_tipo,
                DROP CONSTRAINT IF EXISTS planes_desglose_dentro_del_precio,
                DROP CONSTRAINT IF EXISTS planes_desglose_solo_mixto,
                DROP CONSTRAINT IF EXISTS planes_precio_iptv_check,
                DROP CONSTRAINT IF EXISTS planes_precio_cable_check,
                DROP CONSTRAINT IF EXISTS planes_componentes_por_tipo,
                DROP CONSTRAINT IF EXISTS planes_tipo_servicio_check,
                DROP COLUMN IF EXISTS precio_iptv,
                DROP COLUMN IF EXISTS precio_cable,
                DROP COLUMN IF EXISTS componentes,
                DROP COLUMN IF EXISTS tipo_servicio;
            DROP FUNCTION IF EXISTS network.componentes_del_plan_validos(text, text[]);
        `)
    }
}
