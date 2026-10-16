import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * A3 · semana 2: resúmenes del dashboard como vistas materializadas que se refrescan **por
 * evento** (grupo `billing` del bus, `ConsumidorResumenes`), nunca por intervalo.
 *
 *  - `resumen_mensual`: facturado (facturas no anuladas por mes de su periodo) y cobrado (pagos
 *    vigentes por mes de Guatemala).
 *  - `resumen_cobros_diarios`: cobrado por día de Guatemala.
 *  - `resumen_servicios`: servicios y clientes por estado.
 *  - `resumen_cartera`: cartera vencida (facturas `vencida`) y pendiente total.
 *  - `resumen_promesas`: promesas por estado.
 *
 * Cada una tiene un índice único para `REFRESH ... CONCURRENTLY` (no bloquea a quien lee). La
 * aplicación no es dueña de las vistas: refresca con `billing.refrescar_resumen(vista)`,
 * SECURITY DEFINER con lista cerrada de vistas. `billing.resumenes_refrescos` guarda cuándo se
 * refrescó cada una y el último evento que lo pidió.
 */
export default class extends BaseSchema {
    async up() {
        this.schema.raw(`
            CREATE MATERIALIZED VIEW billing.resumen_mensual AS
            WITH facturado AS (
                SELECT date_trunc('month', f.periodo)::date AS mes,
                       count(*)::int AS facturas,
                       sum(f.total) AS facturado
                  FROM billing.facturas f
                 WHERE f.estado <> 'anulada'
                 GROUP BY 1
            ), cobrado AS (
                SELECT date_trunc('month', p.created_at AT TIME ZONE 'America/Guatemala')::date AS mes,
                       count(*)::int AS pagos,
                       sum(p.monto) AS cobrado
                  FROM billing.pagos p
                 WHERE p.estado = 'registrado'
                 GROUP BY 1
            )
            SELECT mes,
                   coalesce(f.facturas, 0) AS facturas,
                   coalesce(f.facturado, 0)::numeric(14, 2) AS facturado,
                   coalesce(c.pagos, 0) AS pagos,
                   coalesce(c.cobrado, 0)::numeric(14, 2) AS cobrado
              FROM facturado f
              FULL JOIN cobrado c USING (mes);
            CREATE UNIQUE INDEX resumen_mensual_mes ON billing.resumen_mensual (mes);

            CREATE MATERIALIZED VIEW billing.resumen_cobros_diarios AS
            SELECT (p.created_at AT TIME ZONE 'America/Guatemala')::date AS dia,
                   count(*)::int AS pagos,
                   sum(p.monto)::numeric(14, 2) AS cobrado
              FROM billing.pagos p
             WHERE p.estado = 'registrado'
             GROUP BY 1;
            CREATE UNIQUE INDEX resumen_cobros_diarios_dia ON billing.resumen_cobros_diarios (dia);

            CREATE MATERIALIZED VIEW billing.resumen_servicios AS
            SELECT s.estado,
                   count(*)::int AS servicios,
                   count(DISTINCT s.cliente_id)::int AS clientes
              FROM core.servicios s
             GROUP BY s.estado;
            CREATE UNIQUE INDEX resumen_servicios_estado ON billing.resumen_servicios (estado);

            CREATE MATERIALIZED VIEW billing.resumen_cartera AS
            SELECT 1 AS id,
                   coalesce(sum(f.total - f.pagado) FILTER (WHERE f.estado = 'vencida'), 0)::numeric(14, 2) AS vencida,
                   count(*) FILTER (WHERE f.estado = 'vencida')::int AS facturas_vencidas,
                   count(DISTINCT f.cliente_id) FILTER (WHERE f.estado = 'vencida')::int AS clientes_morosos,
                   coalesce(sum(f.total - f.pagado), 0)::numeric(14, 2) AS pendiente
              FROM billing.facturas f
             WHERE f.estado IN ('emitida', 'parcial', 'vencida');
            CREATE UNIQUE INDEX resumen_cartera_id ON billing.resumen_cartera (id);

            CREATE MATERIALIZED VIEW billing.resumen_promesas AS
            SELECT p.estado,
                   count(*)::int AS promesas,
                   sum(p.monto)::numeric(14, 2) AS monto
              FROM billing.promesas p
             GROUP BY p.estado;
            CREATE UNIQUE INDEX resumen_promesas_estado ON billing.resumen_promesas (estado);

            CREATE TABLE billing.resumenes_refrescos (
                vista text PRIMARY KEY,
                refrescado_en timestamptz NOT NULL DEFAULT now(),
                ultimo_evento_id bigint,
                refrescos integer NOT NULL DEFAULT 0
            );
            INSERT INTO billing.resumenes_refrescos (vista) VALUES
                ('resumen_mensual'), ('resumen_cobros_diarios'), ('resumen_servicios'),
                ('resumen_cartera'), ('resumen_promesas');

            CREATE FUNCTION billing.refrescar_resumen(p_vista text) RETURNS void
            LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $fn$
            BEGIN
                IF p_vista NOT IN ('resumen_mensual', 'resumen_cobros_diarios', 'resumen_servicios',
                                   'resumen_cartera', 'resumen_promesas') THEN
                    RAISE EXCEPTION 'Vista de resumen desconocida: %', p_vista
                        USING ERRCODE = 'invalid_parameter_value';
                END IF;
                EXECUTE format('REFRESH MATERIALIZED VIEW CONCURRENTLY billing.%I', p_vista);
            END
            $fn$;
            REVOKE EXECUTE ON FUNCTION billing.refrescar_resumen(text) FROM PUBLIC;

            DO $do$
            BEGIN
                IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'argosisp_app') THEN
                    GRANT EXECUTE ON FUNCTION billing.refrescar_resumen(text) TO argosisp_app;
                    GRANT SELECT ON billing.resumen_mensual, billing.resumen_cobros_diarios,
                        billing.resumen_servicios, billing.resumen_cartera, billing.resumen_promesas
                        TO argosisp_app;
                    GRANT SELECT, INSERT, UPDATE ON billing.resumenes_refrescos TO argosisp_app;
                END IF;
            END
            $do$;
        `)
    }

    async down() {
        this.schema.raw(`
            DROP FUNCTION IF EXISTS billing.refrescar_resumen(text);
            DROP TABLE IF EXISTS billing.resumenes_refrescos;
            DROP MATERIALIZED VIEW IF EXISTS billing.resumen_promesas;
            DROP MATERIALIZED VIEW IF EXISTS billing.resumen_cartera;
            DROP MATERIALIZED VIEW IF EXISTS billing.resumen_servicios;
            DROP MATERIALIZED VIEW IF EXISTS billing.resumen_cobros_diarios;
            DROP MATERIALIZED VIEW IF EXISTS billing.resumen_mensual;
        `)
    }
}
