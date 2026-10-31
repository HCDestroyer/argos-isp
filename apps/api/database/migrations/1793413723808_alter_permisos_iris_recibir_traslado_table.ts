import { BaseSchema } from '@adonisjs/lucid/schema'
import type { QueryClientContract } from '@adonisjs/lucid/types/database'

/**
 * Contrato Iris 0.5.0 §1.1 y §3.3: el usuario técnico «Iris» recibe órdenes de traslado
 * (`inventario.recibir_traslado`) en instalaciones que ya estaban conectadas.
 *
 * `GenerarTokenIris` y el canje completan el rol `integracion_iris` con lo que le falte de
 * `PERMISOS_IRIS`, pero solo al emitir un token nuevo, y cada token guarda su propio
 * `alcances.permisos`: el token vigente de un Iris ya conectado seguiría sin el permiso y
 * `POST /inventario/traslados/:id/recibir` le respondería 403. Esta migración:
 *
 * 1. crea el permiso en `core.permisos` si todavía no existe (el seed de ACL corre después de las
 *    migraciones y solo actualiza su descripción);
 * 2. lo suma al rol `integracion_iris`, si existe;
 * 3. lo suma a `alcances.permisos` de los tokens no revocados del usuario Iris que recortan
 *    permisos (un token sin `alcances.permisos` ya hereda el rol).
 *
 * Idempotente: solo toca lo que no lo tiene, y cada cambio deja su diff en `audit.cambios` (actor
 * `sistema`). Nunca quita permisos: el `down` no revierte nada, porque un administrador o un token
 * nuevo pudieron dárselo después y no se distingue.
 */
const PERMISO = 'inventario.recibir_traslado'
const DESCRIPCION =
    'Recibir una orden de traslado (firma digital, firma en papel o aceptación), marcando faltantes'
const ROL_IRIS = 'integracion_iris'
const EMAIL_IRIS = 'iris@integraciones.argosisp.local'
const REQUEST_ID = 'migracion:1793413723808_alter_permisos_iris_recibir_traslado'

export default class extends BaseSchema {
    async up() {
        this.defer(async (db) => {
            await db.rawQuery(
                `INSERT INTO core.permisos (nombre, descripcion) VALUES (?, ?) ON CONFLICT (nombre) DO NOTHING`,
                [PERMISO, DESCRIPCION],
            )

            // 2. Rol `integracion_iris`
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
                if (!antes.includes(PERMISO)) {
                    await db.rawQuery(
                        `INSERT INTO core.roles_permisos (role_id, permiso_id)
                         SELECT ?, id FROM core.permisos WHERE nombre = ?
                         ON CONFLICT DO NOTHING`,
                        [rol.id, PERMISO],
                    )
                    await this.auditar(
                        db,
                        'rol',
                        Number(rol.id),
                        'permisos',
                        antes.toSorted(),
                        [...antes, PERMISO].toSorted(),
                    )
                }
            }

            // 3. Tokens vigentes del usuario Iris que recortan permisos
            const tokens = (await db
                .from('core.tokens_api as t')
                .join('core.usuarios as u', 'u.id', 't.usuario_id')
                .whereRaw('lower(u.email) = ?', [EMAIL_IRIS])
                .whereNull('t.revocado_en')
                .whereRaw(`jsonb_typeof(t.alcances -> 'permisos') = 'array'`)
                .whereRaw(`NOT (t.alcances -> 'permisos') @> to_jsonb(ARRAY[?]::text[])`, [PERMISO])
                .select('t.id', 't.alcances')
                .orderBy('t.id')) as Array<{
                id: number
                alcances: { permisos: string[] } & Record<string, unknown>
            }>
            for (const token of tokens) {
                await db.rawQuery(
                    `UPDATE core.tokens_api
                        SET alcances = jsonb_set(alcances, '{permisos}', (alcances -> 'permisos') || to_jsonb(?::text)),
                            updated_at = now()
                      WHERE id = ?`,
                    [PERMISO, token.id],
                )
                // Mismo campo que `CrearTokenApi` (`alcances`, el objeto completo)
                await this.auditar(db, 'token_api', Number(token.id), 'alcances', token.alcances, {
                    ...token.alcances,
                    permisos: [...token.alcances.permisos, PERMISO],
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
