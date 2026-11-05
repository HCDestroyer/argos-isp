import { BaseSchema } from '@adonisjs/lucid/schema'
import type { QueryClientContract } from '@adonisjs/lucid/types/database'

/**
 * Contrato Iris 0.6.0 §1.1 y §7 (pagos y atención): el usuario técnico «Iris» suma los permisos de
 * comprobantes, promesas y verificación de identidad en instalaciones que ya estaban conectadas.
 *
 * Igual que la migración de 0.5.0 (`1793413723808_alter_permisos_iris_recibir_traslado`):
 * `GenerarTokenIris` y el canje completan el rol `integracion_iris` solo al emitir un token nuevo,
 * y cada token guarda su propio `alcances.permisos`. Esta migración:
 *
 * 1. crea en `core.permisos` los que aún no existen (el seed de ACL corre después de las
 *    migraciones y solo actualiza su descripción);
 * 2. los suma al rol `integracion_iris`, si existe;
 * 3. los suma a `alcances.permisos` de los tokens no revocados del usuario Iris que recortan
 *    permisos (un token sin `alcances.permisos` ya hereda el rol).
 *
 * Idempotente: solo toca lo que falta, y cada cambio deja su diff en `audit.cambios` (actor
 * `sistema`). Nunca quita permisos: el `down` no revierte nada.
 */
const PERMISOS: Array<[string, string]> = [
    ['cuentas_bancarias.ver', 'Ver las cuentas bancarias propias (destino de depósitos y transferencias)'],
    [
        'comprobantes.registrar',
        'Registrar un comprobante de depósito para revisión de caja (contrato Iris 0.6.0 §7.2)',
    ],
    ['comprobantes.ver', 'Ver comprobantes de depósito y su archivo'],
    [
        'comprobantes.reconexion_temporal',
        'Pedir la reconexión temporal de un servicio cortado mientras caja revisa su comprobante (contrato Iris 0.6.0 §7.3)',
    ],
    ['promesas.ver', 'Ver promesas de pago'],
    ['promesas.crear', 'Crear promesas de pago'],
    [
        'clientes.verificar_identidad',
        'Verificar la identidad de un cliente (documento, nombre o código) sin ver el dato (contrato Iris 0.6.0 §7.5)',
    ],
]
const ROL_IRIS = 'integracion_iris'
const EMAIL_IRIS = 'iris@integraciones.argosisp.local'
const REQUEST_ID = 'migracion:1793862211681_alter_permisos_iris_060'

export default class extends BaseSchema {
    async up() {
        this.defer(async (db) => {
            const nombres = PERMISOS.map(([nombre]) => nombre)
            for (const [nombre, descripcion] of PERMISOS) {
                await db.rawQuery(
                    `INSERT INTO core.permisos (nombre, descripcion) VALUES (?, ?) ON CONFLICT (nombre) DO NOTHING`,
                    [nombre, descripcion],
                )
            }

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
                const faltan = nombres.filter((n) => !antes.includes(n))
                if (faltan.length > 0) {
                    await db.rawQuery(
                        `INSERT INTO core.roles_permisos (role_id, permiso_id)
                         SELECT ?, id FROM core.permisos WHERE nombre = ANY(?::text[])
                         ON CONFLICT DO NOTHING`,
                        [rol.id, faltan],
                    )
                    await this.auditar(
                        db,
                        'rol',
                        Number(rol.id),
                        'permisos',
                        antes.toSorted(),
                        [...antes, ...faltan].toSorted(),
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
                .whereRaw(`NOT (t.alcances -> 'permisos') @> to_jsonb(?::text[])`, [nombres])
                .select('t.id', 't.alcances')
                .orderBy('t.id')) as Array<{
                id: number
                alcances: { permisos: string[] } & Record<string, unknown>
            }>
            for (const token of tokens) {
                const faltan = nombres.filter((n) => !token.alcances.permisos.includes(n))
                const permisos = [...token.alcances.permisos, ...faltan]
                await db.rawQuery(
                    `UPDATE core.tokens_api
                        SET alcances = jsonb_set(alcances, '{permisos}', to_jsonb(?::text[])),
                            updated_at = now()
                      WHERE id = ?`,
                    [permisos, token.id],
                )
                // Mismo campo que `CrearTokenApi` (`alcances`, el objeto completo)
                await this.auditar(db, 'token_api', Number(token.id), 'alcances', token.alcances, {
                    ...token.alcances,
                    permisos,
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
