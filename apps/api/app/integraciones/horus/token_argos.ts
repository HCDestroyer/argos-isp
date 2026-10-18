import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import type { ContextoAccion } from '#shared/contexto'
import GenerarTokenHorus from '#core/actions/generar_token_horus'
import RevocarTokenHorus from '#core/actions/revocar_token_horus'

/**
 * Token `atk_` que Argos entrega a Horus en el canje del enlace de conexión (§1.2 y §1.4).
 *
 * Lo emite A1: `GenerarTokenHorus` (usuario técnico `horus@integraciones.argosisp.local`, rol
 * `integracion_horus`, permisos `ip.resolver`, `clientes.ver`, `servicios.ver` y `sso.emitir`) y
 * lo revoca `RevocarTokenHorus`, las dos anidadas en la transacción del canje (auditoría y rollback
 * juntos). La interfaz queda para las pruebas.
 */
export interface EmisorTokenHorus {
    /** Emite el token dentro de `trx`. */
    emitir(trx: TransactionClientContract, ctx: ContextoAccion): Promise<{ token: string; token_id: number }>
    /** Revoca el token de un canje anterior (dentro de `trx`); no falla si ya no existe o está revocado. */
    revocar(trx: TransactionClientContract, ctx: ContextoAccion, tokenId: number): Promise<void>
}

export const emisorA1: EmisorTokenHorus = {
    async emitir(trx, ctx) {
        const salida = await new GenerarTokenHorus().execute(
            { nombre: `Horus Flow (enlace de conexión ${new Date().toISOString().slice(0, 10)})` },
            ctx,
            { trx },
        )
        return { token: salida.token, token_id: Number(salida.datos.id) }
    },
    async revocar(trx, ctx, tokenId) {
        const fila = (await trx
            .from('core.tokens_api')
            .where('id', tokenId)
            .select('revocado_en')
            .first()) as { revocado_en: Date | null } | null
        if (!fila || fila.revocado_en) return
        await new RevocarTokenHorus().execute({ id: tokenId }, ctx, { trx })
    },
}

let emisor: EmisorTokenHorus = emisorA1

export function emisorTokenHorus(): EmisorTokenHorus {
    return emisor
}

/** Reemplaza el emisor (pruebas). Sin argumento vuelve al de A1. */
export function fijarEmisorTokenHorus(nuevo?: EmisorTokenHorus) {
    emisor = nuevo ?? emisorA1
}
