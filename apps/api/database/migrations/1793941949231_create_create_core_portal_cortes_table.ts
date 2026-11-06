import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Configuración del portal de corte (pedido del PM, 6 nov: «no debería ser variables de .env»). Una
 * sola fila global (`id = 1`): los routers no son de una empresa (un router sirve servicios de varias
 * empresas y su dst-nat de corte es uno solo), así que el destino del NAT y el modo de suspensión son
 * de la instalación. Lo que sí es por empresa (la página a la que va el suspendido) sigue en
 * `core.empresas.url_corte`.
 *
 * - `portal_v4`/`portal_v6`/`portal_puerto`: a dónde manda el dst-nat HTTP de los routers (`to-addresses`,
 *   `to-ports`). `portal_v4` null = se deduce de `PORTAL_URL_PUBLICA` (IP o FQDN resuelto).
 * - `modo_suspension`: `desconectar` (Disconnect al suspender, reconecta con el perfil de corte) o `coa`
 *   (CoA sin reconectar). Lo lee `services/coa`.
 * - `version = 0`: nunca se guardó; la API usa los valores de las variables de entorno de antes
 *   (`ROUTERS_SERVICIO_PORTAL_*`, `COA_SUSPENDER`) como siembra. Desde la primera edición manda esta fila.
 */
export default class extends BaseSchema {
    async up() {
        this.schema.raw(`
            CREATE TABLE core.portal_corte (
                id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
                portal_v4 inet CHECK (portal_v4 IS NULL OR (family(portal_v4) = 4 AND masklen(portal_v4) = 32)),
                portal_v6 inet CHECK (portal_v6 IS NULL OR (family(portal_v6) = 6 AND masklen(portal_v6) = 128)),
                portal_puerto integer NOT NULL DEFAULT 80 CHECK (portal_puerto BETWEEN 1 AND 65535),
                modo_suspension text NOT NULL DEFAULT 'desconectar'
                    CHECK (modo_suspension IN ('desconectar', 'coa')),
                version integer NOT NULL DEFAULT 0,
                updated_by bigint REFERENCES core.usuarios (id),
                created_at timestamptz NOT NULL DEFAULT now(),
                updated_at timestamptz NOT NULL DEFAULT now()
            );
            INSERT INTO core.portal_corte (id) VALUES (1);
        `)
    }

    async down() {
        this.schema.raw(`DROP TABLE IF EXISTS core.portal_corte;`)
    }
}
