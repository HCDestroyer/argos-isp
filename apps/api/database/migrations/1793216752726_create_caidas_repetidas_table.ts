import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Caídas repetidas de un servicio (pedido A6 de Iris, `contratos/eventos.md`): una fila por cada
 * `servicio.caidas_repetidas` emitido. Sirve para emitirlo a lo sumo una vez por ventana (la
 * detección mira la última fila del servicio) y como historial. Solo se inserta, nunca se edita;
 * la escribe `detectarCaidasRepetidas` (`app/network/sesiones/caidas.ts`) en la misma transacción
 * que cierra la sesión.
 */
export default class extends BaseSchema {
    async up() {
        this.schema.raw(`
            CREATE TABLE network.caidas_repetidas (
                id bigserial PRIMARY KEY,
                servicio_id bigint NOT NULL REFERENCES core.servicios (id),
                empresa_id bigint NOT NULL REFERENCES core.empresas (id),
                sesion_id bigint NOT NULL REFERENCES network.sesiones (id),
                desde timestamptz NOT NULL,
                hasta timestamptz NOT NULL,
                sesiones integer NOT NULL CHECK (sesiones > 0),
                umbral integer NOT NULL CHECK (umbral > 0),
                ventana_minutos integer NOT NULL CHECK (ventana_minutos > 0),
                causas jsonb NOT NULL DEFAULT '{}'::jsonb,
                created_at timestamptz NOT NULL DEFAULT now(),
                CONSTRAINT caidas_repetidas_rango CHECK (desde <= hasta)
            );
            CREATE INDEX caidas_repetidas_servicio_hasta ON network.caidas_repetidas (servicio_id, hasta DESC);
        `)
    }

    async down() {
        this.schema.raw('DROP TABLE IF EXISTS network.caidas_repetidas')
    }
}
