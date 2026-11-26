import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Primero se cobra y después se certifica (decisión del PM, 25-nov-2026;
 * `contratos/fel-establecimientos.md` §5 y lote 3): las plantillas y las excepciones de servicio con
 * `certificar_al = emitir` pasan a `pagar`, cada una con su diff en `audit.cambios` (actor sistema).
 *
 * Las facturas ya emitidas no se tocan (son documentos: guardan el `certificar_al` con que nacieron).
 * El valor `emitir` sigue admitido por la base: las acciones lo rechazan (422
 * `certificar_al_obsoleto`), pero las filas anteriores y las pruebas del auditor
 * (`tests/contabilidad`, que insertan plantillas directo) lo conservan con su comportamiento de
 * siempre. `down` no revierte: no se sabe cuáles eran `emitir` sin leer la auditoría.
 */
export default class extends BaseSchema {
    async up() {
        this.schema.raw(`
            WITH cambiadas AS (
                UPDATE billing.plantillas_facturacion
                   SET certificar_al = 'pagar', version = version + 1, updated_at = now()
                 WHERE certificar_al = 'emitir'
             RETURNING id
            )
            INSERT INTO audit.cambios (entidad_tipo, entidad_id, campo, antes, despues, actor_tipo, request_id)
            SELECT 'plantilla_facturacion', id, 'certificar_al', '"emitir"'::jsonb, '"pagar"'::jsonb, 'sistema',
                   'migracion:certificar_al_emitir_a_pagar'
              FROM cambiadas;

            WITH cambiadas AS (
                UPDATE core.servicios_excepciones
                   SET valor = '"pagar"'::jsonb
                 WHERE campo = 'certificar_al' AND valor #>> '{}' = 'emitir'
             RETURNING servicio_id
            )
            INSERT INTO audit.cambios (entidad_tipo, entidad_id, campo, antes, despues, actor_tipo, request_id)
            SELECT 'servicio', servicio_id, 'excepciones.certificar_al', '"emitir"'::jsonb, '"pagar"'::jsonb,
                   'sistema', 'migracion:certificar_al_emitir_a_pagar'
              FROM cambiadas;
        `)
    }

    async down() {}
}
