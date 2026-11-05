import { DomainAction, type Transaccion } from '#shared/domain_action'
import {
    PLAZO_CONFIRMAR_CANJE_IRIS_MS,
    bloquearConectorIris,
    guardarConectorIris,
} from '#integraciones/iris/configuracion'
import { desconectarConectorIris } from '#integraciones/iris/desconexion'

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
 * - Solo los canjes pendientes: los conectores que ya existían antes de 0.6.3 quedaron confirmados
 *   en la migración, y los configurados a mano no tienen canje.
 * - No es un TTL de caché (regla 5): es el vencimiento de una credencial que nadie aceptó, con el
 *   mismo plazo explícito y auditado que el `iris_pat_` que Iris entrega en el canje.
 */
export default class VencerCanjeIris extends DomainAction<EntradaVencerCanjeIris, SalidaVencerCanjeIris> {
    readonly nombre = 'iris.vencer_canje'

    protected async handle(input: EntradaVencerCanjeIris, t: Transaccion): Promise<SalidaVencerCanjeIris> {
        t.fijarEmpresa(null)
        const antes = await bloquearConectorIris(t)
        if (
            !antes ||
            !antes.conectado_por_enlace_en ||
            !antes.token_argos_id ||
            antes.canje_confirmado_en ||
            antes.desconectado_en
        ) {
            return { resultado: 'sin_cambios' }
        }
        t.fijarEntidad('conector_iris', 1)
        const token = (await t.trx
            .from('core.tokens_api')
            .where('id', antes.token_argos_id)
            .select('ultimo_uso')
            .first()) as { ultimo_uso: Date | null } | null
        if (token?.ultimo_uso) {
            await guardarConectorIris(t, antes, { canje_confirmado_en: token.ultimo_uso })
            return { resultado: 'confirmado' }
        }
        const vence = new Date(antes.conectado_por_enlace_en).getTime() + PLAZO_CONFIRMAR_CANJE_IRIS_MS
        if (vence > input.ahora.getTime()) return { resultado: 'pendiente' }
        await desconectarConectorIris(t, antes, 'canje_sin_uso')
        return { resultado: 'desconectado' }
    }
}
