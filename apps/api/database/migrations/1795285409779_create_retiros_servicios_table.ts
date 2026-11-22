import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Retiro de un servicio (decisión del PM 17): qué se decidió sobre el equipo en comodato. De fábrica
 * `recuperar_equipo = true` (Iris recibe la orden de retiro y los equipos quedan «por recuperar»);
 * `equipo_entregado` (la casilla «el equipo ya se entregó») o el ajuste global `retiro.orden_iris`
 * apagado lo dejan en false. Una fila por retiro; solo se inserta.
 */
export default class extends BaseSchema {
    async up() {
        this.schema.raw(`
            CREATE TABLE core.servicios_retiros (
                id bigserial PRIMARY KEY,
                servicio_id bigint NOT NULL REFERENCES core.servicios (id),
                empresa_id bigint NOT NULL REFERENCES core.empresas (id),
                motivo text NOT NULL,
                equipo_entregado boolean NOT NULL DEFAULT false,
                recuperar_equipo boolean NOT NULL,
                creado_por bigint REFERENCES core.usuarios (id),
                created_at timestamptz NOT NULL DEFAULT now()
            );
            CREATE INDEX servicios_retiros_servicio ON core.servicios_retiros (servicio_id, id DESC);
        `)
    }

    async down() {
        this.schema.raw('DROP TABLE IF EXISTS core.servicios_retiros')
    }
}
