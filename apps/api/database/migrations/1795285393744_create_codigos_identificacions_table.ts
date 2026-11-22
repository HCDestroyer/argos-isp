import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Código para identificarse en el portal (decisión del PM 19, ficha del servicio «Generar código»):
 * 6 dígitos de un solo uso que el personal le dicta al cliente cuando el portal no lo reconoce.
 * Vale `codigo_corte.vigencia_min` (15 de fábrica, 5 a 60, por empresa o global). Solo se guarda su
 * HMAC; `usado_en` lo consume. Un código nuevo anula el anterior vigente del servicio.
 */
export default class extends BaseSchema {
    async up() {
        this.schema.raw(`
            CREATE TABLE core.codigos_identificacion (
                id bigserial PRIMARY KEY,
                servicio_id bigint NOT NULL REFERENCES core.servicios (id),
                empresa_id bigint NOT NULL REFERENCES core.empresas (id),
                codigo_hash text NOT NULL CHECK (codigo_hash ~ '^[0-9a-f]{64}$'),
                expira_en timestamptz NOT NULL,
                usado_en timestamptz,
                anulado_en timestamptz,
                creado_por bigint REFERENCES core.usuarios (id),
                created_at timestamptz NOT NULL DEFAULT now()
            );
            CREATE INDEX codigos_identificacion_hash
                ON core.codigos_identificacion (codigo_hash) WHERE usado_en IS NULL AND anulado_en IS NULL;
            CREATE INDEX codigos_identificacion_servicio ON core.codigos_identificacion (servicio_id, id DESC);
        `)
    }

    async down() {
        this.schema.raw('DROP TABLE IF EXISTS core.codigos_identificacion')
    }
}
