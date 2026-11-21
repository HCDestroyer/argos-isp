import { randomUUID } from 'node:crypto'
import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Decisión del PM (21 nov): «al emitir automáticamente debe tomar el total según el servicio y no
 * hacer cálculos según el día». Apaga `prorrateo` en **todas** las plantillas de facturación que lo
 * tenían (la opción queda en la plantilla por si alguien la quiere encender a propósito; las nuevas
 * nacen apagadas desde `CrearPlantilla`).
 *
 * Regla 9 de CLAUDE.md: nada de un `UPDATE` masivo sin auditoría. Cada plantilla cambiada sube su
 * `version` (el panel que la tenga abierta recibe 409 al guardar) y deja, en esta misma transacción:
 *
 * - `audit.acciones`: `plantillas.editar`, actor `sistema`, canal `interno`, entidad
 *   `plantilla_facturacion`, entrada con el campo, el motivo y `origen: migracion`, mismo `request_id`.
 * - `audit.cambios`: `prorrateo` de `true` a `false`.
 *
 * Sin tablas nuevas (no hace falta `GRANT`). Irreversible: `down` no vuelve a encender el prorrateo
 * (se enciende a mano, plantilla por plantilla, con su auditoría).
 */
const MOTIVO = 'Decisión del PM: la factura cobra el precio completo del servicio, sin prorrateo'

export default class extends BaseSchema {
    async up() {
        this.defer(async (db) => {
            const requestId = `migracion-plantillas-sin-prorrateo-${randomUUID()}`
            const { rows: cambiadas } = (await db.rawQuery(
                `UPDATE billing.plantillas_facturacion
                    SET prorrateo = false, version = version + 1, updated_at = now()
                  WHERE prorrateo
              RETURNING id, version`,
            )) as { rows: Array<{ id: number; version: number }> }
            for (const p of cambiadas) {
                await db.table('audit.acciones').insert({
                    empresa_id: null,
                    actor_tipo: 'sistema',
                    actor_id: null,
                    canal: 'interno',
                    accion: 'plantillas.editar',
                    entidad_tipo: 'plantilla_facturacion',
                    entidad_id: p.id,
                    entrada: JSON.stringify({
                        id: p.id,
                        prorrateo: false,
                        motivo: MOTIVO,
                        origen: 'migracion',
                    }),
                    resultado: 'ok',
                    request_id: requestId,
                })
                await db.table('audit.cambios').insert({
                    entidad_tipo: 'plantilla_facturacion',
                    entidad_id: p.id,
                    campo: 'prorrateo',
                    antes: JSON.stringify(true),
                    despues: JSON.stringify(false),
                    actor_tipo: 'sistema',
                    actor_id: null,
                    request_id: requestId,
                })
            }
        })
    }

    async down() {
        // irreversible a propósito: ver el comentario de la clase
    }
}
