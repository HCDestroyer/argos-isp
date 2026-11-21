import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Contrato Iris 0.9.0 §12.5 (A37): seguimiento de la bienvenida de un servicio. Una fila por envío
 * de la bienvenida (la de la activación y cada reenvío); los envíos por canal siguen en
 * `notify.envios` con el mismo `origen`. `ultimo_estado` guarda los canales del último
 * `servicio.bienvenida_cambiada` emitido (uno por cambio). Los límites de reenvío (10 min, 3 por día)
 * se cuentan aquí.
 */
export default class extends BaseSchema {
    async up() {
        this.schema.raw(`
            CREATE TABLE notify.bienvenidas (
                id bigserial PRIMARY KEY,
                origen text NOT NULL UNIQUE,
                servicio_id bigint NOT NULL REFERENCES core.servicios (id) ON DELETE CASCADE,
                empresa_id bigint REFERENCES core.empresas (id),
                cliente_id bigint NOT NULL REFERENCES core.clientes (id) ON DELETE CASCADE,
                origen_tipo text CHECK (origen_tipo IN ('iris_orden')),
                origen_id text,
                reenvio boolean NOT NULL DEFAULT false,
                canales text[],
                ultimo_estado jsonb,
                request_id text,
                created_at timestamptz NOT NULL DEFAULT now(),
                updated_at timestamptz NOT NULL DEFAULT now(),
                CHECK ((origen_tipo IS NULL) = (origen_id IS NULL))
            );
            CREATE INDEX bienvenidas_servicio ON notify.bienvenidas (servicio_id, created_at DESC);
        `)
    }

    async down() {
        this.schema.raw('DROP TABLE IF EXISTS notify.bienvenidas')
    }
}
