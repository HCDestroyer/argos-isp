import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Pools editables (`contratos/pools.md`): nombre y DNS de las redes IPv4, rango asignable dentro
 * de la red (fuera de él las IPs quedan reservadas), y nombre y proveedor de los bloques IPv6.
 *
 * No hay restricción de un bloque o pool por router: un router admite varios bloques (p. ej. dos
 * /32 de proveedores distintos) y varios pools de enlace y de delegación; lo único prohibido es
 * que se traslapen.
 */
export default class extends BaseSchema {
    async up() {
        this.schema.raw(`
            ALTER TABLE network.redes_ipv4
                ADD COLUMN nombre text,
                ADD COLUMN rango_inicio inet CHECK (rango_inicio IS NULL OR (family(rango_inicio) = 4 AND masklen(rango_inicio) = 32)),
                ADD COLUMN rango_fin inet CHECK (rango_fin IS NULL OR (family(rango_fin) = 4 AND masklen(rango_fin) = 32)),
                ADD COLUMN dns_primario inet CHECK (dns_primario IS NULL OR family(dns_primario) = 4),
                ADD COLUMN dns_secundario inet CHECK (dns_secundario IS NULL OR family(dns_secundario) = 4),
                ADD CONSTRAINT redes_ipv4_rango CHECK (
                    (rango_inicio IS NULL) = (rango_fin IS NULL)
                    AND (rango_inicio IS NULL OR (
                        rango_inicio <= rango_fin AND cidr >>= rango_inicio AND cidr >>= rango_fin
                    ))
                );

            ALTER TABLE network.ipv6_bloques
                ADD COLUMN nombre text,
                ADD COLUMN proveedor text;

            ALTER TABLE network.ipv6_pools
                ADD COLUMN nombre text;
        `)
    }

    async down() {
        this.schema.raw(`
            ALTER TABLE network.ipv6_pools DROP COLUMN nombre;
            ALTER TABLE network.ipv6_bloques DROP COLUMN nombre, DROP COLUMN proveedor;
            ALTER TABLE network.redes_ipv4
                DROP CONSTRAINT redes_ipv4_rango,
                DROP COLUMN nombre,
                DROP COLUMN rango_inicio,
                DROP COLUMN rango_fin,
                DROP COLUMN dns_primario,
                DROP COLUMN dns_secundario;
        `)
    }
}
