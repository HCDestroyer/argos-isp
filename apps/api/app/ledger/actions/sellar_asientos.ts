import { DomainAction, type Transaccion } from '#shared/domain_action'
import {
    LOCK_SELLOS,
    asientosCanonicos,
    calcularHash,
    pendientesDeSellar,
    sellarPendientes,
    ultimoSello,
    avisarRuptura,
    sellosEnMesCerrado,
    type RupturaCadena,
} from '#ledger/sellos'

/**
 * `libro.sellar`: el sellador de la cadena de hash (contrato de localización fiscal §10.10).
 *
 * Sella en orden de id los asientos confirmados sin sello de cada empresa (o de `empresa_id`),
 * hasta `limite` por empresa, encadenando con el último sello. Lo llaman el cron `sellar` del
 * worker de billing (cada minuto, con lock) y `cerrarPeriodo` (anidada, antes de cerrar el mes).
 *
 * - Lock por empresa (`pg_advisory_xact_lock(LOCK_SELLOS, empresa)`): con `esperar = false` (el
 *   cron) una empresa que ya se está sellando se omite; con `esperar = true` (el cierre) espera.
 * - Antes de encadenar, recalcula el último sello: si no coincide, emite `libro.integridad_rota`
 *   (una vez por empresa y sello) y sigue sellando, porque la cadena encadena con el hash
 *   guardado y la ruptura queda localizada en ese sello.
 */

export interface EntradaSellarAsientos {
    empresa_id?: number | null
    /** asientos por empresa en esta corrida (por defecto 500) */
    limite?: number
    /** espera el lock de la empresa en lugar de omitirla */
    esperar?: boolean
}

export interface SalidaSellarAsientos {
    empresas: Array<{
        empresa_id: number
        sellados: number
        ultimo_sello: number | null
        ultimo_hash: string | null
    }>
    omitidas: number[]
    rupturas: Array<RupturaCadena & { empresa_id: number }>
}

export default class SellarAsientos extends DomainAction<EntradaSellarAsientos, SalidaSellarAsientos> {
    readonly nombre = 'libro.sellar'

    protected async handle(input: EntradaSellarAsientos, t: Transaccion): Promise<SalidaSellarAsientos> {
        const limite = Math.max(1, Math.min(input.limite ?? 500, 5000))
        if (input.empresa_id) t.fijarEmpresa(input.empresa_id)
        const salida: SalidaSellarAsientos = { empresas: [], omitidas: [], rupturas: [] }
        for (const { empresa_id: empresaId } of await pendientesDeSellar(t.trx, input.empresa_id)) {
            if (input.esperar) {
                await t.trx.rawQuery('SELECT pg_advisory_xact_lock(?, ?)', [LOCK_SELLOS, empresaId])
            } else {
                const { rows } = (await t.trx.rawQuery('SELECT pg_try_advisory_xact_lock(?, ?) AS ok', [
                    LOCK_SELLOS,
                    empresaId,
                ])) as { rows: Array<{ ok: boolean }> }
                if (!rows[0]?.ok) {
                    salida.omitidas.push(empresaId)
                    continue
                }
            }

            const ultimo = await ultimoSello(t.trx, empresaId)
            if (ultimo) {
                const canonico = await asientosCanonicos(t.trx, [ultimo.asiento_id]).then((r) =>
                    r.get(ultimo.asiento_id),
                )
                const obtenido = canonico ? calcularHash(ultimo.hash_anterior, canonico) : ''
                if (obtenido !== ultimo.hash) {
                    const ruptura: RupturaCadena = {
                        sello: ultimo.sello,
                        asiento_id: ultimo.asiento_id,
                        motivo: canonico ? 'hash_distinto' : 'asiento_inexistente',
                        esperado: ultimo.hash,
                        obtenido,
                    }
                    salida.rupturas.push({ empresa_id: empresaId, ...ruptura })
                    await avisarRuptura(t, empresaId, ruptura)
                }
            }

            const nuevos = await sellarPendientes(t.trx, empresaId, limite)
            // un asiento con fecha de un mes ya cerrado no debió existir (H10): se sella igual (la cadena
            // queda completa) y se avisa; la verificación lo reporta como `asiento_en_mes_cerrado`
            const enCerrado = await sellosEnMesCerrado(
                t.trx,
                empresaId,
                nuevos.map((n) => n.sello),
            )
            for (const x of enCerrado) {
                const ruptura: RupturaCadena = {
                    sello: x.sello,
                    asiento_id: x.asiento_id,
                    motivo: 'asiento_en_mes_cerrado',
                    esperado: `sello <= ${x.ultimo_sello} (cierre de ${x.periodo})`,
                    obtenido: String(x.sello),
                }
                salida.rupturas.push({ empresa_id: empresaId, ...ruptura })
                await avisarRuptura(t, empresaId, ruptura)
            }
            const fin = nuevos.at(-1)
            salida.empresas.push({
                empresa_id: empresaId,
                sellados: nuevos.length,
                ultimo_sello: fin?.sello ?? ultimo?.sello ?? null,
                ultimo_hash: fin?.hash ?? ultimo?.hash ?? null,
            })
        }
        return salida
    }
}
