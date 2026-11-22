import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * A3 · pausa sin cobro (decisión del PM 16).
 *
 * `billing.pausas_servicio`: un servicio pausado a pedido del cliente. Mientras dura, el servicio está
 * suspendido a mano (`core.servicios.suspension_manual`, sin cambios en `core`) y **no se emiten las
 * facturas de los periodos que empiezan dentro de la pausa** (`desde` ≤ inicio < fin efectivo). La fin
 * efectiva es `terminada_en` (en Guatemala) si terminó antes, o `hasta`. Al llegar `hasta`, el cron
 * `pausas` la termina y reactiva el servicio («todo lo pendiente hasta ahora»).
 *
 * - `dias` ≤ `pausa_tope_dias` de `billing.ajustes_cobro` (90 de fábrica).
 * - Una sola pausa activa por servicio (índice único parcial).
 * - `fin_motivo`: `vencida` (cron), `manual` (`servicios.terminar_pausa`), `reactivado` (alguien quitó
 *   la suspensión por otro camino) o `retirado`.
 */
export default class extends BaseSchema {
    async up() {
        this.schema.raw(`
            CREATE TABLE billing.pausas_servicio (
                id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                empresa_id bigint NOT NULL REFERENCES core.empresas (id),
                servicio_id bigint NOT NULL REFERENCES core.servicios (id),
                cliente_id bigint NOT NULL REFERENCES core.clientes (id),
                desde date NOT NULL,
                hasta date NOT NULL,
                dias integer NOT NULL CHECK (dias BETWEEN 1 AND 365),
                motivo text NOT NULL CHECK (length(btrim(motivo)) BETWEEN 3 AND 500),
                estado text NOT NULL DEFAULT 'activa' CHECK (estado IN ('activa', 'terminada')),
                terminada_en timestamptz,
                fin_motivo text CHECK (fin_motivo IN ('vencida', 'manual', 'reactivado', 'retirado')),
                creada_por bigint REFERENCES core.usuarios (id),
                terminada_por bigint REFERENCES core.usuarios (id),
                version integer NOT NULL DEFAULT 1,
                created_at timestamptz NOT NULL DEFAULT now(),
                updated_at timestamptz NOT NULL DEFAULT now(),
                CONSTRAINT pausas_rango CHECK (hasta = desde + dias),
                CONSTRAINT pausas_fin CHECK (
                    (estado = 'activa' AND terminada_en IS NULL AND fin_motivo IS NULL)
                    OR (estado = 'terminada' AND terminada_en IS NOT NULL AND fin_motivo IS NOT NULL)
                )
            );
            CREATE UNIQUE INDEX pausas_servicio_una_activa ON billing.pausas_servicio (servicio_id)
                WHERE estado = 'activa';
            CREATE INDEX pausas_servicio_vencen ON billing.pausas_servicio (hasta) WHERE estado = 'activa';
            CREATE INDEX pausas_servicio_servicio ON billing.pausas_servicio (servicio_id, desde);
        `)
    }

    async down() {
        this.schema.raw(`DROP TABLE IF EXISTS billing.pausas_servicio;`)
    }
}
