import { BaseSchema } from '@adonisjs/lucid/schema'
import type { QueryClientContract } from '@adonisjs/lucid/types/database'

/**
 * Contrato Iris 0.14.3 §3 en instalaciones ya conectadas: el usuario técnico «Iris» gana
 * `facturas.leer_origen_iris` (`GET /facturas/origen-iris`, la lectura con la que Iris valida el número
 * de factura al conciliar un «cobro por confirmar»). Solo ese token lo tiene (ningún rol base salvo
 * `admin`, que tiene todo).
 *
 * Igual que `1795255090881_create_permisos_iris_0120_s_table`: crea el permiso si falta (el seed de ACL
 * corre después), lo suma al rol `integracion_iris` y a los `alcances.permisos` de los tokens vigentes
 * del usuario Iris que recortan permisos. Cada cambio deja su diff en `audit.cambios` (actor
 * `sistema`). Idempotente. Sin reverso: un administrador pudo cambiarlos después.
 */
const AGREGAR: Record<string, string> = {
    'facturas.leer_origen_iris':
        'Leer una factura de origen Iris por su número o su DTE, sin pagos ni datos del cliente (solo el token de Iris, contrato Iris 0.14.3 §3)',
}
const ROL_IRIS = 'integracion_iris'
const EMAIL_IRIS = 'iris@integraciones.argosisp.local'
const REQUEST_ID = 'migracion:1795329374595_permisos_iris_0143'

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
                const despues = [...new Set([...antes, ...Object.keys(AGREGAR)])]
                if (despues.toSorted().join() !== antes.toSorted().join()) {
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
                const despues = [...new Set([...antes, ...Object.keys(AGREGAR)])]
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
