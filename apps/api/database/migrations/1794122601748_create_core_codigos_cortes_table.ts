import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Códigos de corte (`contratos/corte-identificacion.md` §4, decisiones del PM P4 y P5): uno por
 * suspensión de un servicio en un router con `corte_identificacion = 'codigo'`. El router lo pone en
 * la URL de `/corte` (`/ip proxy access`, `action-data`) y el portal resuelve código → servicio sin
 * depender de la IP de origen.
 *
 * - `codigo`: 13 caracteres base32 (Crockford), 65 bits aleatorios; nunca el id ni algo secuencial.
 * - `cerrado_en`: cuando el servicio deja de estar suspendido. Sigue resolviendo 30 minutos más
 *   (`PORTAL_CODIGO_CORTE_GRACIA_MIN`) para que la página muestre «ya tienes servicio».
 * - A lo sumo un código abierto por servicio (índice único parcial): una suspensión repetida o un
 *   evento duplicado reutiliza el abierto.
 */
export default class extends BaseSchema {
    async up() {
        this.schema.raw(`
            CREATE TABLE core.codigos_corte (
                id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                servicio_id bigint NOT NULL REFERENCES core.servicios (id),
                empresa_id bigint NOT NULL REFERENCES core.empresas (id),
                router_id bigint REFERENCES network.routers (id),
                codigo text NOT NULL UNIQUE CHECK (codigo ~ '^[0-9A-HJKMNP-TV-Z]{13}$'),
                creado_en timestamptz NOT NULL DEFAULT now(),
                cerrado_en timestamptz
            );
            CREATE UNIQUE INDEX codigos_corte_abierto ON core.codigos_corte (servicio_id) WHERE cerrado_en IS NULL;
            CREATE INDEX codigos_corte_servicio ON core.codigos_corte (servicio_id, creado_en DESC);
        `)
    }

    async down() {
        this.schema.raw(`DROP TABLE IF EXISTS core.codigos_corte;`)
    }
}
