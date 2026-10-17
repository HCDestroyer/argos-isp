import db from '@adonisjs/lucid/services/db'
import { DomainAction, type Transaccion } from '#shared/domain_action'
import AnularFactura from '#billing/actions/anular_factura'
import { configuracionFel, credencialesFel, proveedorFel } from '#fiscal/fel/configuracion'
import {
    TOPE_REINTENTOS,
    dteCertificado,
    esperaReintento,
    huboEnvio,
    nitEmisor,
    registrarIntento,
    verDte,
    type DteFila,
} from '#fiscal/fel/dte'
import type { ResultadoAnulacion } from '#fiscal/fel/proveedor'

/**
 * `fel.anular_dte`: envía la anulación de un DTE `anulacion_pendiente` (contrato §8.3; segundo paso
 * de `facturas.anular` sobre una factura certificada). La llama el worker `fiscal:worker`.
 *
 * - Confirmada: el DTE queda `anulado` y se completa la anulación interna de la factura
 *   (`facturas.anular` con `tras_anular_dte`: reverso del asiento y de la reclasificación,
 *   `factura.anulada`, reevaluación del servicio). Evento `dte.anulado`.
 * - Rechazada: el DTE vuelve a `certificado` con el error visible y la factura sigue viva
 *   (`dte.rechazado`, `definitivo: true`).
 * - Error temporal: reintento con la misma espera que la certificación.
 */

export interface EntradaAnularDte {
    dte_id: number
}

export default class AnularDte extends DomainAction<
    EntradaAnularDte,
    { dte_id: number; estado: string | null; omitido: string | null }
> {
    readonly nombre = 'fel.anular_dte'

    protected async handle(input: EntradaAnularDte, t: Transaccion) {
        t.fijarEntidad('dte', input.dte_id)
        const { rows } = (await t.trx.rawQuery(
            'SELECT id FROM fiscal.dte WHERE id = ? FOR NO KEY UPDATE SKIP LOCKED',
            [input.dte_id],
        )) as { rows: unknown[] }
        if (rows.length === 0) return { dte_id: input.dte_id, estado: null, omitido: 'en_proceso' }
        const dte = await verDte(input.dte_id, t.trx)
        t.fijarEmpresa(dte.empresa_id)
        if (dte.estado !== 'anulacion_pendiente') {
            return { dte_id: dte.id, estado: dte.estado, omitido: dte.estado }
        }

        const config = await configuracionFel(dte.empresa_id, t.trx)
        const proveedor = proveedorFel(dte.proveedor)
        const cred = await credencialesFel(dte.empresa_id, dte.proveedor, dte.ambiente, t.trx)
        if (!proveedor || !cred || config.contingencia_activa) {
            return this.reintentar(
                t,
                dte,
                config.contingencia_activa ? 'contingencia activa' : 'fel_no_configurada',
            )
        }
        const motivo = dte.motivo_anulacion ?? 'Anulación'
        const inicio = Date.now()
        // H6: si ya se envió una anulación (la transacción local pudo fallar después de que el
        // certificador anuló), primero se consulta: un DTE anulado allá se completa aquí y nunca
        // vuelve a `certificado`
        const consultarAnulado = async (): Promise<boolean | null> => {
            const consulta = await proveedor
                .consultar(dte.identificador, cred, dte.ambiente)
                .catch((error) => ({
                    encontrado: null as null,
                    error: (error as Error).message,
                    respuesta: {},
                }))
            await registrarIntento(
                t.trx,
                dte.id,
                'consultar',
                consulta.encontrado === true ? (consulta.anulado ? 'anulado' : 'vigente') : 'error',
                consulta.respuesta,
                Date.now() - inicio,
            )
            return consulta.encontrado === true ? consulta.anulado : null
        }
        const yaAnulado: ResultadoAnulacion = {
            resultado: 'anulado',
            fecha: new Date(),
            xml: null,
            respuesta: { consultado: true },
        }
        let resultado: ResultadoAnulacion | null = null
        if ((await huboEnvio(t.trx, dte.id, 'anular')) && (await consultarAnulado()) === true) {
            resultado = yaAnulado
        }
        if (!resultado) {
            await registrarIntento(db.connection(), dte.id, 'anular', 'enviando', {})
            const certificado = { ...dteCertificado(dte), emisor_nit: await nitEmisor(t.trx, dte.empresa_id) }
            resultado = await proveedor.anular(certificado, motivo, cred, dte.ambiente).catch((error) => ({
                resultado: 'error_temporal' as const,
                error: (error as Error).message,
                respuesta: {},
            }))
            await registrarIntento(
                t.trx,
                dte.id,
                'anular',
                resultado.resultado,
                resultado.respuesta,
                Date.now() - inicio,
            )
            // un rechazo puede ser "ya estaba anulado": se confirma con el certificador antes de revertir
            if (resultado.resultado === 'rechazado' && (await consultarAnulado()) === true) {
                resultado = yaAnulado
            }
        }

        if (resultado.resultado === 'error_temporal') return this.reintentar(t, dte, resultado.error)
        if (resultado.resultado === 'rechazado') {
            const error = `Anulación rechazada: ${resultado.errores.join(' | ')}`
            await t.trx
                .from('fiscal.dte')
                .where('id', dte.id)
                .update({
                    estado: 'certificado',
                    ultimo_error: error.slice(0, 2000),
                    proximo_intento: null,
                    version: t.trx.knexRawQuery('version + 1'),
                    updated_at: t.trx.knexRawQuery('now()'),
                } as Record<string, unknown>)
            await t.emit('dte.rechazado', {
                dte_id: dte.id,
                empresa_id: dte.empresa_id,
                documento_tipo: dte.documento_tipo,
                documento_id: dte.documento_id,
                error: error.slice(0, 500),
                definitivo: true,
            })
            return { dte_id: dte.id, estado: 'certificado', omitido: null }
        }

        await t.trx
            .from('fiscal.dte')
            .where('id', dte.id)
            .update({
                estado: 'anulado',
                anulado_en: resultado.fecha,
                ultimo_error: null,
                proximo_intento: null,
                version: t.trx.knexRawQuery('version + 1'),
                updated_at: t.trx.knexRawQuery('now()'),
            } as Record<string, unknown>)
        // la factura o la mora (NDEB, H7) se anula con su asiento y su reclasificación
        if (dte.documento_tipo === 'factura' || dte.documento_tipo === 'nota_debito') {
            await new AnularFactura().execute(
                { factura_id: dte.documento_id, motivo, tras_anular_dte: true },
                t.ctx,
                { trx: t.trx },
            )
        }
        await t.emit('dte.anulado', {
            dte_id: dte.id,
            empresa_id: dte.empresa_id,
            documento_tipo: dte.documento_tipo,
            documento_id: dte.documento_id,
            motivo,
        })
        return { dte_id: dte.id, estado: 'anulado', omitido: null }
    }

    private async reintentar(t: Transaccion, dte: DteFila, error: string) {
        const intentos = dte.intentos + 1
        await t.trx
            .from('fiscal.dte')
            .where('id', dte.id)
            .update({
                ultimo_error: error.slice(0, 2000),
                intentos,
                proximo_intento:
                    intentos >= TOPE_REINTENTOS
                        ? null
                        : t.trx.knexRawQuery(`now() + make_interval(mins => ?)`, [esperaReintento(intentos)]),
                version: t.trx.knexRawQuery('version + 1'),
                updated_at: t.trx.knexRawQuery('now()'),
            } as Record<string, unknown>)
        return { dte_id: dte.id, estado: dte.estado, omitido: null }
    }
}
