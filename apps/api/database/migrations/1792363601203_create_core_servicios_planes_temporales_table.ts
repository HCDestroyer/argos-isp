import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Plan temporal de un servicio (`contratos/lealtad.md` §3, A1): una mejora de plan con fecha de
 * inicio y fin (premio `mejora_plan` del programa de lealtad o programada a mano).
 *
 * - Mientras está `activo`, `core.servicios.plan_id` ES el plan temporal (plan efectivo para RADIUS,
 *   RouterOS y la facturación) y `plan_original_id` guarda el plan base al que vuelve al terminar.
 * - Un solo plan temporal `programado` o `activo` por servicio (índice parcial único).
 * - `origen` + `origen_id` (el canje de lealtad) es único: repetir el canje no programa dos.
 * - Transiciones solo por acción: `programado → activo → terminado`, `programado|activo → cancelado`.
 *   El cron toma "todo lo pendiente hasta ahora" con los índices parciales de abajo.
 */
export default class extends BaseSchema {
    async up() {
        this.schema.raw(`
            CREATE TABLE core.servicios_planes_temporales (
                id bigserial PRIMARY KEY,
                empresa_id bigint NOT NULL REFERENCES core.empresas (id),
                servicio_id bigint NOT NULL REFERENCES core.servicios (id),
                plan_id bigint NOT NULL REFERENCES network.planes (id),
                plan_original_id bigint NOT NULL REFERENCES network.planes (id),
                inicio timestamptz NOT NULL,
                fin timestamptz NOT NULL,
                origen text NOT NULL DEFAULT 'manual' CHECK (origen IN ('lealtad', 'manual')),
                origen_id bigint,
                estado text NOT NULL DEFAULT 'programado'
                    CHECK (estado IN ('programado', 'activo', 'terminado', 'cancelado')),
                motivo text,
                iniciado_en timestamptz,
                terminado_en timestamptz,
                creado_por bigint REFERENCES core.usuarios (id),
                version integer NOT NULL DEFAULT 1,
                created_at timestamptz NOT NULL DEFAULT now(),
                updated_at timestamptz NOT NULL DEFAULT now(),
                CONSTRAINT planes_temporales_fin_despues CHECK (fin > inicio),
                CONSTRAINT planes_temporales_otro_plan CHECK (plan_id <> plan_original_id)
            );
            CREATE UNIQUE INDEX planes_temporales_uno_vigente
                ON core.servicios_planes_temporales (servicio_id)
                WHERE estado IN ('programado', 'activo');
            CREATE UNIQUE INDEX planes_temporales_origen
                ON core.servicios_planes_temporales (origen, origen_id)
                WHERE origen_id IS NOT NULL;
            CREATE INDEX planes_temporales_por_iniciar
                ON core.servicios_planes_temporales (inicio) WHERE estado = 'programado';
            CREATE INDEX planes_temporales_por_terminar
                ON core.servicios_planes_temporales (fin) WHERE estado = 'activo';
            CREATE INDEX planes_temporales_servicio
                ON core.servicios_planes_temporales (servicio_id, id DESC);
        `)
    }

    async down() {
        this.schema.raw('DROP TABLE IF EXISTS core.servicios_planes_temporales')
    }
}
