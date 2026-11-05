import db from '@adonisjs/lucid/services/db'
import type { QueryClientContract } from '@adonisjs/lucid/types/database'
import type { Transaccion } from '#shared/domain_action'
import RevocarTokenIris from '#core/actions/revocar_token_iris'
import {
    PLAZO_CONFIRMAR_CANJE_IRIS_MS,
    TABLA_CONECTOR_IRIS,
    guardarConectorIris,
    type FilaConectorIris,
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

/**
 * Para el cron `iris_canjes_sin_uso` (0.6.3): si el último canje sigue pendiente de confirmar y ya
 * hay algo que hacer (su `atk_` se usó, o pasó `PLAZO_CONFIRMAR_CANJE_IRIS_MS` sin uso). Así el cron
 * solo llama a la acción, y solo deja auditoría, cuando cambia algo.
 */
export async function canjeIrisPorRevisar(ahora: Date, cliente: QueryClientContract = db.connection()) {
    const limite = new Date(ahora.getTime() - PLAZO_CONFIRMAR_CANJE_IRIS_MS)
    const fila = await cliente
        .from(`${TABLA_CONECTOR_IRIS} as c`)
        .leftJoin('core.tokens_api as t', 't.id', 'c.token_argos_id')
        .where('c.id', 1)
        .whereNotNull('c.conectado_por_enlace_en')
        .whereNotNull('c.token_argos_id')
        .whereNull('c.canje_confirmado_en')
        .whereNull('c.desconectado_en')
        .where((q) => q.whereNotNull('t.ultimo_uso').orWhere('c.conectado_por_enlace_en', '<=', limite))
        .select('c.id')
        .first()
    return Boolean(fila)
}
