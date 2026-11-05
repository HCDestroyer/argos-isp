import db from '@adonisjs/lucid/services/db'
import type { QueryClientContract } from '@adonisjs/lucid/types/database'
import type { Transaccion } from '#shared/domain_action'
import RevocarTokenIris from '#core/actions/revocar_token_iris'
import { cifrar, descifrar } from '#shared/cifrado'
import {
    PLAZO_CONFIRMAR_CANJE_IRIS_MS,
    TABLA_CONECTOR_IRIS,
    guardarConectorIris,
    type FilaConectorIris,
    type JuegoPendienteIris,
    type MotivoDesconexionIris,
} from '#integraciones/iris/configuracion'

/** Revoca un token de la integración Iris si sigue vigente (repetirlo no hace nada). */
export async function revocarTokenIrisSiVigente(t: Transaccion, tokenId: number): Promise<boolean> {
    const fila = (await t.trx.from('core.tokens_api').where('id', tokenId).select('revocado_en').first()) as {
        revocado_en: Date | null
    } | null
    if (!fila || fila.revocado_en) return false
    await new RevocarTokenIris().execute({ id: tokenId }, t.ctx, { trx: t.trx })
    return true
}

/**
 * Contrato Iris 0.6.3: deja el conector canjeado sin credenciales vivas. Revoca el `atk_` del canje
 * (si sigue vigente), apaga el conector, borra los secretos (el `iris_pat_` de Iris y los dos
 * secretos de webhooks) y marca `desconectado_en` con su motivo. Conserva la URL, el receptor, el
 * `conector_id`, `token_argos_id` y el contrato informado: el historial queda en la fila, en
 * `audit.cambios` (secretos como `***`) y en `core.tokens_api`. La fila ya viene bloqueada
 * (`bloquearConectorIris`). Volver a conectar es otro canje.
 */
export async function desconectarConectorIris(
    t: Transaccion,
    antes: FilaConectorIris,
    motivo: MotivoDesconexionIris,
): Promise<FilaConectorIris> {
    if (antes.token_argos_id) await revocarTokenIrisSiVigente(t, Number(antes.token_argos_id))
    t.anotarAuditoria({ motivo_desconexion: motivo, atk_id: antes.token_argos_id })
    return guardarConectorIris(t, antes, {
        activo: false,
        token_cifrado: null,
        webhook_salida_secreto_cifrado: null,
        webhook_entrada_secreto_cifrado: null,
        desconectado_en: t.trx.knexRawQuery('now()'),
        motivo_desconexion: motivo,
    })
}

/** Columnas del juego pendiente vacías (descartar o aplicar una reconexión). */
export const SIN_PENDIENTE_IRIS = {
    pendiente_token_argos_id: null,
    pendiente_canjeado_en: null,
    pendiente_secreto_cifrado: null,
} as const

export function cifrarPendienteIris(juego: JuegoPendienteIris): string {
    return cifrar(JSON.stringify(juego))
}

/**
 * Reconexión (0.6.3): descarta el canje pendiente (Iris lo revocó, venció sin uso o lo reemplaza
 * otro canje). Revoca su `atk_` y vacía las columnas `pendiente_*`; el conector en uso no cambia.
 */
export async function descartarPendienteIris(
    t: Transaccion,
    antes: FilaConectorIris,
    motivo: 'revocado_por_iris' | 'canje_sin_uso' | 'reemplazado',
): Promise<FilaConectorIris> {
    if (!antes.pendiente_token_argos_id) return antes
    await revocarTokenIrisSiVigente(t, Number(antes.pendiente_token_argos_id))
    t.anotarAuditoria({ reconexion_descartada: motivo, atk_id: antes.pendiente_token_argos_id })
    return guardarConectorIris(t, antes, { ...SIN_PENDIENTE_IRIS })
}

/**
 * Confirma el canje cuyo `atk_` es `atkId` en su primera llamada autenticada (0.6.3):
 *
 * - **Reconexión pendiente** (`pendiente_token_argos_id = atkId`): aplica el juego pendiente
 *   (`url_base`, `iris_pat_`, receptor de Iris y su secreto, secreto del receptor de Argos,
 *   `contrato`, `receptor_argos`), pasa a `token_argos_id` el `atk_` nuevo, revoca el anterior y
 *   marca el canje confirmado. `activo` no cambia: la integración no se corta.
 * - **Canje directo sin confirmar** (`token_argos_id = atkId`): marca `canje_confirmado_en`.
 *
 * `cuando`: la hora del primer uso (`ultimo_uso`; el guard pasa now()). null si no tocaba nada.
 */
export async function confirmarCanjeIris(
    t: Transaccion,
    antes: FilaConectorIris,
    atkId: number,
    cuando: Date | null,
): Promise<'reconectado' | 'confirmado' | null> {
    const instante = cuando ?? t.trx.knexRawQuery('now()')
    if (antes.pendiente_token_argos_id && Number(antes.pendiente_token_argos_id) === atkId) {
        const juego = JSON.parse(descifrar(antes.pendiente_secreto_cifrado!)) as JuegoPendienteIris
        if (antes.token_argos_id) await revocarTokenIrisSiVigente(t, Number(antes.token_argos_id))
        t.anotarAuditoria({ reconexion: true, atk_id: atkId, atk_anterior_id: antes.token_argos_id })
        await guardarConectorIris(t, antes, {
            url_base: juego.url_base,
            token_cifrado: cifrar(juego.token),
            webhook_salida_url: juego.webhook_salida_url,
            webhook_salida_secreto_cifrado: cifrar(juego.webhook_salida_secreto),
            webhook_entrada_secreto_cifrado: cifrar(juego.webhook_entrada_secreto),
            contrato: juego.contrato,
            receptor_argos: juego.receptor_argos,
            token_argos_id: atkId,
            conectado_por_enlace_en: antes.pendiente_canjeado_en,
            canje_confirmado_en: instante,
            desconectado_en: null,
            motivo_desconexion: null,
            ...SIN_PENDIENTE_IRIS,
        })
        return 'reconectado'
    }
    if (
        Number(antes.token_argos_id) === atkId &&
        antes.conectado_por_enlace_en &&
        !antes.canje_confirmado_en &&
        !antes.desconectado_en
    ) {
        await guardarConectorIris(t, antes, { canje_confirmado_en: instante })
        return 'confirmado'
    }
    return null
}

/**
 * Para el guard (primer uso de un token): ¿es el `atk_` de un canje por confirmar? Una consulta
 * barata, solo en la primera petición de cada token.
 */
export async function esCanjeIrisPorConfirmar(atkId: number): Promise<boolean> {
    const fila = await db
        .from(TABLA_CONECTOR_IRIS)
        .where('id', 1)
        .where((q) =>
            q
                .where('pendiente_token_argos_id', atkId)
                .orWhere((r) =>
                    r
                        .where('token_argos_id', atkId)
                        .whereNotNull('conectado_por_enlace_en')
                        .whereNull('canje_confirmado_en')
                        .whereNull('desconectado_en'),
                ),
        )
        .select('id')
        .first()
    return Boolean(fila)
}

/**
 * Para el cron `iris_canjes_sin_uso` (0.6.3): si hay algo que hacer. El canje directo sin confirmar
 * o la reconexión pendiente cuyo `atk_` ya se usó (el guard no alcanzó a confirmarlo), o que lleva
 * `PLAZO_CONFIRMAR_CANJE_IRIS_MS` sin uso. Así el cron solo llama a la acción, y solo deja
 * auditoría, cuando cambia algo.
 */
export async function canjeIrisPorRevisar(ahora: Date, cliente: QueryClientContract = db.connection()) {
    const limite = new Date(ahora.getTime() - PLAZO_CONFIRMAR_CANJE_IRIS_MS)
    const fila = await cliente
        .from(`${TABLA_CONECTOR_IRIS} as c`)
        .leftJoin('core.tokens_api as t', 't.id', 'c.token_argos_id')
        .leftJoin('core.tokens_api as p', 'p.id', 'c.pendiente_token_argos_id')
        .where('c.id', 1)
        .where((q) =>
            q
                .where((d) =>
                    d
                        .whereNotNull('c.conectado_por_enlace_en')
                        .whereNotNull('c.token_argos_id')
                        .whereNull('c.canje_confirmado_en')
                        .whereNull('c.desconectado_en')
                        .where((u) =>
                            u.whereNotNull('t.ultimo_uso').orWhere('c.conectado_por_enlace_en', '<=', limite),
                        ),
                )
                .orWhere((r) =>
                    r
                        .whereNotNull('c.pendiente_token_argos_id')
                        .where((u) =>
                            u.whereNotNull('p.ultimo_uso').orWhere('c.pendiente_canjeado_en', '<=', limite),
                        ),
                ),
        )
        .select('c.id')
        .first()
    return Boolean(fila)
}
