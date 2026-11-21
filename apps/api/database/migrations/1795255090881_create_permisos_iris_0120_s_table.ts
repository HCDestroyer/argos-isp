import { BaseSchema } from '@adonisjs/lucid/schema'
import type { QueryClientContract } from '@adonisjs/lucid/types/database'

/**
 * Contrato Iris 0.12.0 §3.10 (A48) en instalaciones ya conectadas: el usuario técnico «Iris» gana
 * `servicios.cambiar_equipo` (cambio de equipo y «no se pudo recuperar») e `inventario.ver_unidad` (leer
 * una unidad sin costos), y **pierde** `inventario.declarar_perdida_comodato`: la pérdida la declara una
 * persona en Argos (`inventario.cobrar_equipo`), nunca Iris (§10.7 d).
 *
 * Igual que `1793413723808_alter_permisos_iris_recibir_traslado`: crea los permisos si faltan (el seed de
 * ACL corre después), ajusta el rol `integracion_iris` y los `alcances.permisos` de los tokens vigentes
 * del usuario Iris que recortan permisos. Cada cambio deja su diff en `audit.cambios` (actor `sistema`).
 * Idempotente. Sin reverso: un administrador pudo cambiarlos después.
 */
const AGREGAR: Record<string, string> = {
    'servicios.cambiar_equipo':
        'Cambiar el equipo en comodato de un servicio y registrar intentos de recuperación',
    'inventario.ver_unidad':
        'Ver una unidad (serie, MAC, modelo, estado e historial) sin costos ni proveedor',
}
const QUITAR = 'inventario.declarar_perdida_comodato'
const ROL_IRIS = 'integracion_iris'
const EMAIL_IRIS = 'iris@integraciones.argosisp.local'
const REQUEST_ID = 'migracion:1795255090881_permisos_iris_0120'

export default class extends BaseSchema {
    async up() {
        this.defer(async (db) => {
            for (const [nombre, descripcion] of Object.entries(AGREGAR)) {
                await db.rawQuery(
                    `INSERT INTO core.permisos (nombre, descripcion) VALUES (?, ?) ON CONFLICT (nombre) DO NOTHING`,
                    [nombre, descripcion],
                )
            }

            const rol = (await db.from('core.roles').where('nombre', ROL_IRIS).select('id').first()) as {
                id: number
            } | null
            if (rol) {
                const antes = (
                    (await db
                        .from('core.roles_permisos as rp')
                        .join('core.permisos as p', 'p.id', 'rp.permiso_id')
                        .where('rp.role_id', rol.id)
                        .select('p.nombre')) as Array<{ nombre: string }>
                ).map((f) => f.nombre)
                const despues = [...new Set([...antes.filter((p) => p !== QUITAR), ...Object.keys(AGREGAR)])]
                if (despues.toSorted().join() !== antes.toSorted().join()) {
                    await db.rawQuery(
                        `DELETE FROM core.roles_permisos
                          WHERE role_id = ? AND permiso_id = (SELECT id FROM core.permisos WHERE nombre = ?)`,
                        [rol.id, QUITAR],
                    )
                    for (const nombre of Object.keys(AGREGAR)) {
                        await db.rawQuery(
                            `INSERT INTO core.roles_permisos (role_id, permiso_id)
                             SELECT ?, id FROM core.permisos WHERE nombre = ?
                             ON CONFLICT DO NOTHING`,
                            [rol.id, nombre],
                        )
                    }
                    await this.auditar(
                        db,
                        'rol',
                        Number(rol.id),
                        'permisos',
                        antes.toSorted(),
                        despues.toSorted(),
                    )
                }
            }

            const tokens = (await db
                .from('core.tokens_api as t')
                .join('core.usuarios as u', 'u.id', 't.usuario_id')
                .whereRaw('lower(u.email) = ?', [EMAIL_IRIS])
                .whereNull('t.revocado_en')
                .whereRaw(`jsonb_typeof(t.alcances -> 'permisos') = 'array'`)
                .select('t.id', 't.alcances')
                .orderBy('t.id')) as Array<{
                id: number
                alcances: { permisos: string[] } & Record<string, unknown>
            }>
            for (const token of tokens) {
                const antes = token.alcances.permisos
                const despues = [...new Set([...antes.filter((p) => p !== QUITAR), ...Object.keys(AGREGAR)])]
                if (despues.toSorted().join() === antes.toSorted().join()) continue
                await db.rawQuery(
                    `UPDATE core.tokens_api
                        SET alcances = jsonb_set(alcances, '{permisos}', ?::jsonb), updated_at = now()
                      WHERE id = ?`,
                    [JSON.stringify(despues), token.id],
                )
                await this.auditar(db, 'token_api', Number(token.id), 'alcances', token.alcances, {
                    ...token.alcances,
                    permisos: despues,
                })
            }
        })
    }

    private async auditar(
        db: QueryClientContract,
        entidadTipo: string,
        entidadId: number,
        campo: string,
        antes: unknown,
        despues: unknown,
    ) {
        await db.rawQuery(
            `INSERT INTO audit.cambios (entidad_tipo, entidad_id, campo, antes, despues, actor_tipo, request_id)
             VALUES (?, ?, ?, ?::jsonb, ?::jsonb, 'sistema', ?)`,
            [entidadTipo, entidadId, campo, JSON.stringify(antes), JSON.stringify(despues), REQUEST_ID],
        )
    }

    async down() {
        // Sin reverso: ver el comentario de arriba.
    }
}
