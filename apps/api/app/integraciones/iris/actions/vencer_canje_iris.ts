import { DomainAction, type Transaccion } from '#shared/domain_action'
import { PLAZO_CONFIRMAR_CANJE_IRIS_MS, bloquearConectorIris } from '#integraciones/iris/configuracion'
import {
    confirmarCanjeIris,
    descartarPendienteIris,
    desconectarConectorIris,
} from '#integraciones/iris/desconexion'

export interface EntradaVencerCanjeIris {
    /** instante de la corrida (las pruebas lo fijan) */
    ahora: Date
}

export interface SalidaVencerCanjeIris {
    /**
     * `confirmado`: el `atk_` del canje ya se usó; `desconectado`: venció sin uso (token revocado,
     * conector desconectado); `pendiente`: aún dentro del plazo; `sin_cambios`: no hay canje pendiente
     */
    resultado: 'confirmado' | 'desconectado' | 'pendiente' | 'sin_cambios'
    /**
     * reconexión pendiente: `reconectado` (su `atk_` ya se usó: se aplicó), `vencida` (24 h sin uso:
     * se descartó, el conector anterior sigue igual), `pendiente` o null si no hay
     */
    reconexion: 'reconectado' | 'vencida' | 'pendiente' | null
}

/**
 * `iris.vencer_canje` (cron `iris_canjes_sin_uso` del núcleo, contrato Iris 0.6.3): red de
 * seguridad para el `atk_` de un canje que Iris nunca usó (por ejemplo, porque rechazó la respuesta
 * y no llamó a `POST /integraciones/iris/conexion/revocar`).
 *
 * - «Se usó» = cualquier llamada autenticada con ese token (`core.tokens_api.ultimo_uso`, que el
 *   guard escribe en la primera petición): PUT del contrato, una lectura o una escritura. Entonces
 *   marca `canje_confirmado_en` y el conector sigue igual.
 * - Sin uso a las 24 h (`PLAZO_CONFIRMAR_CANJE_IRIS_MS`) del canje: revoca el token y desconecta el
 *   conector (`motivo_desconexion = canje_sin_uso`).
 * - Reconexión pendiente (canje nuevo sobre un conector en uso): si su `atk_` ya se usó y el guard
 *   no alcanzó a confirmarla, la aplica; sin uso a las 24 h la descarta (revoca su `atk_`) y el
 *   conector anterior sigue igual.
 * - Solo los canjes pendientes: los conectores que ya existían antes de 0.6.3 quedaron confirmados
 *   en la migración, y los configurados a mano no tienen canje.
 * - No es un TTL de caché (regla 5): es el vencimiento de una credencial que nadie aceptó, con el
 *   mismo plazo explícito y auditado que el `iris_pat_` que Iris entrega en el canje.
 */
export default class VencerCanjeIris extends DomainAction<EntradaVencerCanjeIris, SalidaVencerCanjeIris> {
    readonly nombre = 'iris.vencer_canje'

    protected async handle(input: EntradaVencerCanjeIris, t: Transaccion): Promise<SalidaVencerCanjeIris> {
        t.fijarEmpresa(null)
        t.fijarEntidad('conector_iris', 1)
        let antes = await bloquearConectorIris(t)
        if (!antes) return { resultado: 'sin_cambios', reconexion: null }

        let reconexion: SalidaVencerCanjeIris['reconexion'] = null
        if (antes.pendiente_token_argos_id) {
            const uso = await ultimoUso(t, Number(antes.pendiente_token_argos_id))
            if (uso) {
                await confirmarCanjeIris(t, antes, Number(antes.pendiente_token_argos_id), uso)
                return { resultado: 'confirmado', reconexion: 'reconectado' }
            }
            const vence = new Date(antes.pendiente_canjeado_en!).getTime() + PLAZO_CONFIRMAR_CANJE_IRIS_MS
            if (vence <= input.ahora.getTime()) {
                antes = await descartarPendienteIris(t, antes, 'canje_sin_uso')
                reconexion = 'vencida'
            } else {
                reconexion = 'pendiente'
            }
        }

        if (
            !antes.conectado_por_enlace_en ||
            !antes.token_argos_id ||
            antes.canje_confirmado_en ||
            antes.desconectado_en
        ) {
            return { resultado: 'sin_cambios', reconexion }
        }
        const uso = await ultimoUso(t, Number(antes.token_argos_id))
        if (uso) {
            await confirmarCanjeIris(t, antes, Number(antes.token_argos_id), uso)
            return { resultado: 'confirmado', reconexion }
        }
        const vence = new Date(antes.conectado_por_enlace_en).getTime() + PLAZO_CONFIRMAR_CANJE_IRIS_MS
        if (vence > input.ahora.getTime()) return { resultado: 'pendiente', reconexion }
        await desconectarConectorIris(t, antes, 'canje_sin_uso')
        return { resultado: 'desconectado', reconexion }
    }
}

async function ultimoUso(t: Transaccion, tokenId: number): Promise<Date | null> {
    const fila = (await t.trx.from('core.tokens_api').where('id', tokenId).select('ultimo_uso').first()) as {
        ultimo_uso: Date | null
    } | null
    return fila?.ultimo_uso ?? null
}
