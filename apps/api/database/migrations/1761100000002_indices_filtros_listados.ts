import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Índices de los filtros avanzados (A1, día 3):
 * - `GET /clientes?estado_servicio=&router_id=&plan_id=`: servicios por cliente y estado.
 * - `con_deuda_vencida` / `con_promesa_activa`: parciales sobre `billing` (solo lectura de A1;
 *   `facturas_servicio_estado` ya cubre el filtro por servicio).
 * - `GET /bitacora/acciones?canal=` paginado por id; `cliente_id` usa `acciones_entidad`.
 */
export default class extends BaseSchema {
    async up() {
        this.schema.raw(`
            CREATE INDEX servicios_cliente_estado ON core.servicios (cliente_id, estado);
            CREATE INDEX facturas_cliente_vencida ON billing.facturas (cliente_id) WHERE estado = 'vencida';
            CREATE INDEX promesas_cliente_activa ON billing.promesas (cliente_id) WHERE estado = 'activa';
            CREATE INDEX acciones_canal ON audit.acciones (canal, id);
        `)
    }

    async down() {
        this.schema.raw(`
            DROP INDEX IF EXISTS audit.acciones_canal;
            DROP INDEX IF EXISTS billing.promesas_cliente_activa;
            DROP INDEX IF EXISTS billing.facturas_cliente_vencida;
            DROP INDEX IF EXISTS core.servicios_cliente_estado;
        `)
    }
}
