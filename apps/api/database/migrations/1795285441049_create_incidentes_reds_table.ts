import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Falla general de red (decisión del PM 31, contrato Iris 0.13.0): muchos servicios del mismo
 * router, OLT, puerto PON o zona caen a la vez. Un incidente por alcance abierto (índice parcial);
 * `network.incidentes_red_servicios` guarda los afectados con su empresa (los eventos salen uno por
 * empresa con el mismo `incidente_id`). Abierto a mano: `origen = 'manual'`, `abierto_por` y `motivo`.
 */
export default class extends BaseSchema {
    async up() {
        this.schema.raw(`
            CREATE TABLE network.incidentes_red (
                id bigserial PRIMARY KEY,
                alcance text NOT NULL CHECK (alcance IN ('router', 'olt', 'pon', 'zona')),
                alcance_id bigint NOT NULL,
                estado text NOT NULL DEFAULT 'abierto' CHECK (estado IN ('abierto', 'cerrado')),
                origen text NOT NULL CHECK (origen IN ('automatico', 'manual')),
                motivo text,
                abierto_por bigint REFERENCES core.usuarios (id),
                cerrado_por bigint REFERENCES core.usuarios (id),
                motivo_cierre text,
                desde timestamptz NOT NULL,
                hasta timestamptz,
                base integer NOT NULL DEFAULT 0,
                created_at timestamptz NOT NULL DEFAULT now(),
                updated_at timestamptz NOT NULL DEFAULT now(),
                CONSTRAINT incidentes_red_manual CHECK (origen = 'automatico' OR (motivo IS NOT NULL AND abierto_por IS NOT NULL)),
                CONSTRAINT incidentes_red_cierre CHECK ((estado = 'cerrado') = (hasta IS NOT NULL))
            );
            CREATE UNIQUE INDEX incidentes_red_uno_abierto
                ON network.incidentes_red (alcance, alcance_id) WHERE estado = 'abierto';
            CREATE INDEX incidentes_red_recientes ON network.incidentes_red (id DESC);

            CREATE TABLE network.incidentes_red_servicios (
                incidente_id bigint NOT NULL REFERENCES network.incidentes_red (id),
                servicio_id bigint NOT NULL REFERENCES core.servicios (id),
                empresa_id bigint NOT NULL REFERENCES core.empresas (id),
                agregado_en timestamptz NOT NULL DEFAULT now(),
                PRIMARY KEY (incidente_id, servicio_id)
            );
            CREATE INDEX incidentes_red_servicios_empresa
                ON network.incidentes_red_servicios (incidente_id, empresa_id, servicio_id);
            CREATE INDEX incidentes_red_servicios_servicio ON network.incidentes_red_servicios (servicio_id);
        `)
    }

    async down() {
        this.schema.raw(`
            DROP TABLE IF EXISTS network.incidentes_red_servicios;
            DROP TABLE IF EXISTS network.incidentes_red;
        `)
    }
}
