import db from '@adonisjs/lucid/services/db'
import { DomainAction, type Transaccion } from '#shared/domain_action'
import { reclasificarIva } from '#billing/fel_facturas'
import ConfirmarEmision from '#billing/actions/confirmar_emision'
import { configuracionFel, credencialesFel, proveedorFel } from '#fiscal/fel/configuracion'
import {
    ERROR_AVISO_SIN_CUBRIR,
    ERROR_DOCUMENTO_ANULADO,
    TOPE_REINTENTOS,
    dteParaEnviar,
    esperaReintento,
    fechaGt,
    huboEnvio,
    registrarIntento,
    verDte,
    type DteFila,
} from '#fiscal/fel/dte'
import type { ResultadoCertificacion } from '#fiscal/fel/proveedor'

/**
 * `fel.certificar_dte`: envía un DTE `pendiente`, `error_temporal` o `contingencia` (ya sin
 * contingencia activa) al certificador y aplica la respuesta (contrato §8.2). La llama el worker
 * `fiscal:worker` (cola `fel`, con lock), un DTE por transacción.
 *
 * - Toma el DTE con `FOR NO KEY UPDATE SKIP LOCKED`: dos workers nunca envían el mismo. Mientras
 *   habla con el certificador el DTE está `enviando` (dentro de esta transacción) y el intento ya
 *   quedó en `fiscal.dte_intentos` por una conexión aparte. Si el proceso cae, el reintento ve ese
 *   intento y **consulta primero** por `identificador`: si ya estaba certificado, lo toma; nunca
 *   certifica dos veces.
 * - `certificado`: guarda autorización, serie, número y XML; si la factura estaba `por_certificar`
 *   la emite (`facturas.confirmar_emision`, asiento con la fecha de certificación); si era un aviso
 *   de cobro, reclasifica su IVA `2.1.11 / 2.1.02` (§10.1). Evento `dte.certificado`.
 * - `rechazado` (definitivo): la factura sigue como estaba con el error visible; se corrige el dato y
 *   `POST /dte/:id/reintentar` crea un DTE nuevo. Evento `dte.rechazado`.
 * - `error_temporal`: reintento a los 1, 5, 15 y 60 minutos y luego cada hora; agotado el tope,
 *   `dte.rechazado` con `definitivo: false` (se reintenta a mano).
 * - Antes de enviar: un aviso que dejó de estar cubierto (pago anulado) o un documento anulado no se
 *   envía: el DTE queda `rechazado` local (`aviso_sin_cubrir`, `documento_anulado`).
 */

export interface EntradaCertificarDte {
    dte_id: number
}

export interface ResultadoCertificarDte {
    dte_id: number
    estado: DteFila['estado'] | null
    omitido: string | null
}

export default class CertificarDte extends DomainAction<EntradaCertificarDte, ResultadoCertificarDte> {
    readonly nombre = 'fel.certificar_dte'

    protected async handle(input: EntradaCertificarDte, t: Transaccion): Promise<ResultadoCertificarDte> {
        t.fijarEntidad('dte', input.dte_id)
        const { rows: tomado } = (await t.trx.rawQuery(
            'SELECT id FROM fiscal.dte WHERE id = ? FOR NO KEY UPDATE SKIP LOCKED',
            [input.dte_id],
        )) as { rows: unknown[] }
        if (tomado.length === 0) return { dte_id: input.dte_id, estado: null, omitido: 'en_proceso' }
        const dte = await verDte(input.dte_id, t.trx)
        t.fijarEmpresa(dte.empresa_id)
        if (!['pendiente', 'error_temporal', 'contingencia'].includes(dte.estado)) {
            return { dte_id: dte.id, estado: dte.estado, omitido: dte.estado }
        }
        const config = await configuracionFel(dte.empresa_id, t.trx)
        if (dte.estado === 'contingencia' && config.contingencia_activa) {
            return { dte_id: dte.id, estado: dte.estado, omitido: 'contingencia_activa' }
        }

        const local = await this.validarDocumento(t, dte)
        if (local) return this.rechazar(t, dte, local, true, false)

        const proveedor = proveedorFel(dte.proveedor)
        const cred = await credencialesFel(dte.empresa_id, dte.proveedor, dte.ambiente, t.trx)
        if (!proveedor || !cred) {
            await registrarIntento(t.trx, dte.id, 'validar', 'fel_no_configurada', {})
            return this.errorTemporal(t, dte, 'fel_no_configurada: faltan proveedor o credenciales')
        }

        const inicio = Date.now()
        let resultado: ResultadoCertificacion | null = null
        if (await huboEnvio(t.trx, dte.id, 'certificar')) {
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
                consulta.encontrado === true
                    ? 'encontrado'
                    : consulta.encontrado === false
                      ? 'no_encontrado'
                      : 'error',
                consulta.respuesta,
                Date.now() - inicio,
            )
            if (consulta.encontrado === null) return this.errorTemporal(t, dte, `consulta: ${consulta.error}`)
            if (consulta.encontrado) {
                resultado = {
                    resultado: 'certificado',
                    autorizacion: consulta.autorizacion,
                    serie: consulta.serie,
                    numero: consulta.numero,
                    fecha: consulta.fecha,
                    xml: consulta.xml ?? '',
                    pdf: null,
                    respuesta: consulta.respuesta,
                }
            }
        }
        if (!resultado) {
            // el intento queda registrado antes de enviar, fuera de esta transacción
            await registrarIntento(db.connection(), dte.id, 'certificar', 'enviando', {})
            const envio = await dteParaEnviar(t.trx, dte)
            resultado = await proveedor.certificar(envio, cred, dte.ambiente).catch((error) => ({
                resultado: 'error_temporal' as const,
                error: (error as Error).message,
                respuesta: {},
            }))
            await registrarIntento(
                t.trx,
                dte.id,
                'certificar',
                resultado.resultado,
                resultado.respuesta,
                Date.now() - inicio,
            )
        }

        if (resultado.resultado === 'rechazado') {
            return this.rechazar(t, dte, resultado.errores.join(' | '), true, true)
        }
        if (resultado.resultado === 'error_temporal') return this.errorTemporal(t, dte, resultado.error)

        await t.trx
            .from('fiscal.dte')
            .where('id', dte.id)
            .update({
                estado: 'certificado',
                autorizacion: resultado.autorizacion,
                serie: resultado.serie,
                numero: resultado.numero,
                certificado_en: resultado.fecha,
                xml: resultado.xml || null,
                pdf: resultado.pdf,
                ultimo_error: null,
                proximo_intento: null,
                intentos: t.trx.knexRawQuery('intentos + 1'),
                version: t.trx.knexRawQuery('version + 1'),
                updated_at: t.trx.knexRawQuery('now()'),
            } as Record<string, unknown>)
        const certificado = await verDte(dte.id, t.trx)
        await this.efectosContables(t, certificado)
        await t.emit('dte.certificado', {
            dte_id: dte.id,
            empresa_id: dte.empresa_id,
            documento_tipo: dte.documento_tipo,
            documento_id: dte.documento_id,
            tipo_dte: dte.tipo_dte,
            autorizacion: resultado.autorizacion,
            serie: resultado.serie,
            numero: resultado.numero,
            contingencia: dte.contingencia,
        })
        return { dte_id: dte.id, estado: 'certificado', omitido: null }
    }

    /** Problema local que impide enviar (null si se puede enviar). */
    private async validarDocumento(t: Transaccion, dte: DteFila): Promise<string | null> {
        if (dte.documento_tipo === 'nota_credito') return null
        const f = (await t.trx
            .from('billing.facturas')
            .where('id', dte.documento_id)
            .select('estado', 'aviso_cobro')
            .first()) as { estado: string; aviso_cobro: boolean } | null
        if (!f || f.estado === 'anulada') return ERROR_DOCUMENTO_ANULADO
        if (f.aviso_cobro && dte.solicitud === 'automatico' && f.estado !== 'pagada') {
            return ERROR_AVISO_SIN_CUBRIR
        }
        return null
    }

    /** Emisión diferida y reclasificación del IVA del aviso (contrato §8.3 y §10.1). */
    private async efectosContables(t: Transaccion, dte: DteFila): Promise<void> {
        if (dte.documento_tipo === 'nota_credito') return
        const f = (await t.trx
            .from('billing.facturas')
            .where('id', dte.documento_id)
            .select('id', 'empresa_id', 'estado', 'aviso_cobro')
            .firstOrFail()) as { id: number; empresa_id: number; estado: string; aviso_cobro: boolean }
        const fecha = fechaGt(dte.certificado_en ?? new Date())
        if (f.estado === 'por_certificar') {
            await new ConfirmarEmision().execute({ factura_id: f.id, fecha }, t.ctx, { trx: t.trx })
        }
        if (f.aviso_cobro) {
            await reclasificarIva(t, { id: f.id, empresa_id: Number(f.empresa_id) }, dte, fecha)
        }
    }

    private async rechazar(
        t: Transaccion,
        dte: DteFila,
        error: string,
        definitivo: boolean,
        contarIntento: boolean,
    ): Promise<ResultadoCertificarDte> {
        await t.trx
            .from('fiscal.dte')
            .where('id', dte.id)
            .update({
                estado: 'rechazado',
                ultimo_error: error.slice(0, 2000),
                definitivo,
                proximo_intento: null,
                intentos: contarIntento ? t.trx.knexRawQuery('intentos + 1') : dte.intentos,
                version: t.trx.knexRawQuery('version + 1'),
                updated_at: t.trx.knexRawQuery('now()'),
            } as Record<string, unknown>)
        await t.emit('dte.rechazado', {
            dte_id: dte.id,
            empresa_id: dte.empresa_id,
            documento_tipo: dte.documento_tipo,
            documento_id: dte.documento_id,
            error: error.slice(0, 500),
            definitivo,
        })
        return { dte_id: dte.id, estado: 'rechazado', omitido: null }
    }

    private async errorTemporal(
        t: Transaccion,
        dte: DteFila,
        error: string,
    ): Promise<ResultadoCertificarDte> {
        const intentos = dte.intentos + 1
        const agotado = intentos >= TOPE_REINTENTOS
        await t.trx
            .from('fiscal.dte')
            .where('id', dte.id)
            .update({
                estado: 'error_temporal',
                ultimo_error: error.slice(0, 2000),
                intentos,
                proximo_intento: agotado
                    ? null
                    : t.trx.knexRawQuery(`now() + make_interval(mins => ?)`, [esperaReintento(intentos)]),
                version: t.trx.knexRawQuery('version + 1'),
                updated_at: t.trx.knexRawQuery('now()'),
            } as Record<string, unknown>)
        if (agotado) {
            await t.emit('dte.rechazado', {
                dte_id: dte.id,
                empresa_id: dte.empresa_id,
                documento_tipo: dte.documento_tipo,
                documento_id: dte.documento_id,
                error: `Se agotaron ${TOPE_REINTENTOS} reintentos: ${error.slice(0, 400)}`,
                definitivo: false,
            })
        }
        return { dte_id: dte.id, estado: 'error_temporal', omitido: null }
    }
}
