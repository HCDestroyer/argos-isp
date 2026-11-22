import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * IP pública (decisión del PM 30), de dos formas:
 *
 * - `network.redes_ipv4.publica`: red de IPs públicas. La asignación automática de siempre ya no toma
 *   de ella; solo la usa quien pide una IP pública.
 * - `network.planes.incluye_ip_publica`: planes empresariales que la traen (asignación automática).
 * - `core.adicionales.tipo = 'ip_publica'`: el adicional cobrado del catálogo que la asigna; la
 *   asignación guarda la IP (`ip_publica`) para devolverla a la red al quitarla o retirar el servicio.
 */
export default class extends BaseSchema {
    async up() {
        this.schema.raw(`
            ALTER TABLE network.redes_ipv4 ADD COLUMN publica boolean NOT NULL DEFAULT false;
            ALTER TABLE network.planes ADD COLUMN incluye_ip_publica boolean NOT NULL DEFAULT false;
            ALTER TABLE core.adicionales ADD COLUMN tipo text NOT NULL DEFAULT 'general'
                CHECK (tipo IN ('general', 'ip_publica'));
            ALTER TABLE core.servicios_adicionales ADD COLUMN ip_publica inet
                CHECK (ip_publica IS NULL OR (family(ip_publica) = 4 AND masklen(ip_publica) = 32));
        `)
    }

    async down() {
        this.schema.raw(`
            ALTER TABLE core.servicios_adicionales DROP COLUMN IF EXISTS ip_publica;
            ALTER TABLE core.adicionales DROP COLUMN IF EXISTS tipo;
            ALTER TABLE network.planes DROP COLUMN IF EXISTS incluye_ip_publica;
            ALTER TABLE network.redes_ipv4 DROP COLUMN IF EXISTS publica;
        `)
    }
}
