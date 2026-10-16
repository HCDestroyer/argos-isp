import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Conexión del router para la API REST de RouterOS (pedido de A2, `contratos/routeros.md`):
 *
 * - `api_url`: `https://host:puerto` explícito; null = `https://<host>`.
 * - `api_tls_verificar`: verificar el certificado del router (por defecto true).
 * - `api_ca`: CA en PEM para routers con certificado propio (se audita como `***`).
 * - `dhcp_servidor`: `server` del lease de `dhcp_fija`; null = `ROUTEROS_DHCP_SERVIDOR` (o `all`).
 * - `interfaz_clientes`: interfaz del ARP estático del amarre IP-MAC; null = `ROUTEROS_INTERFAZ_CLIENTES`.
 */
export default class extends BaseSchema {
    async up() {
        this.schema.raw(`
            ALTER TABLE network.routers
                ADD COLUMN api_url text
                    CONSTRAINT routers_api_url_formato CHECK (api_url ~ '^https{0,1}://[^\\s/]+(:[0-9]{1,5}){0,1}/{0,1}$'),
                ADD COLUMN api_tls_verificar boolean NOT NULL DEFAULT true,
                ADD COLUMN api_ca text
                    CONSTRAINT routers_api_ca_pem CHECK (api_ca LIKE '-----BEGIN CERTIFICATE-----%'),
                ADD COLUMN dhcp_servidor text
                    CONSTRAINT routers_dhcp_servidor_largo CHECK (length(dhcp_servidor) BETWEEN 1 AND 100),
                ADD COLUMN interfaz_clientes text
                    CONSTRAINT routers_interfaz_clientes_largo CHECK (length(interfaz_clientes) BETWEEN 1 AND 100);
        `)
    }

    async down() {
        this.schema.raw(`
            ALTER TABLE network.routers
                DROP COLUMN IF EXISTS api_url,
                DROP COLUMN IF EXISTS api_tls_verificar,
                DROP COLUMN IF EXISTS api_ca,
                DROP COLUMN IF EXISTS dhcp_servidor,
                DROP COLUMN IF EXISTS interfaz_clientes;
        `)
    }
}
