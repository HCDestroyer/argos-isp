import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Conexión de un router a Argos por WireGuard (`contratos/conexion-routers.md`). Una fila por
 * router, creada al generar su primer script de conexión (`routers.generar_script`).
 *
 * - `ip_tunel`: la /32 del router dentro de `ARGOSISP_WG_RED`, única y estable mientras el router
 *   exista (rotar la conexión no la cambia).
 * - `public_key`: la clave pública WireGuard del router (la privada nunca sale del equipo). null
 *   hasta que el router se registra o alguien la pega a mano; rotar la borra.
 * - `token_hash`/`token_vence`/`token_usado_en`: token de registro de un solo uso (sha256), 24 h.
 * - `api_password_pendiente`: clave del usuario `argosisp-api` del último script (cifrado v1). Pasa
 *   a `network.routers.api_password` cuando el router se registra con ese script: hasta entonces
 *   el router sigue con su clave anterior y la API no pierde el acceso.
 * - `ultimo_handshake`: lo informa el servicio `wireguard` (telemetría); el primer handshake
 *   después del registro pasa `estado` a `conectado`.
 */
export default class extends BaseSchema {
    async up() {
        this.schema.raw(`
            CREATE TABLE network.routers_conexion (
                router_id bigint PRIMARY KEY REFERENCES network.routers (id) ON DELETE CASCADE,
                ip_tunel inet NOT NULL,
                public_key text,
                estado text NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'conectado')),
                ultimo_handshake timestamptz,
                registrado_en timestamptz,
                token_hash text,
                token_vence timestamptz,
                token_usado_en timestamptz,
                api_password_pendiente text,
                version integer NOT NULL DEFAULT 1,
                created_at timestamptz NOT NULL DEFAULT now(),
                updated_at timestamptz NOT NULL DEFAULT now(),
                CONSTRAINT routers_conexion_ip_tunel_unica UNIQUE (ip_tunel),
                CONSTRAINT routers_conexion_public_key_unica UNIQUE (public_key),
                CONSTRAINT routers_conexion_token_unico UNIQUE (token_hash),
                CONSTRAINT routers_conexion_ip_host CHECK (family(ip_tunel) = 4 AND masklen(ip_tunel) = 32),
                CONSTRAINT routers_conexion_conectado_con_clave CHECK (estado = 'pendiente' OR public_key IS NOT NULL)
            );
        `)
    }

    async down() {
        this.schema.raw('DROP TABLE IF EXISTS network.routers_conexion')
    }
}
