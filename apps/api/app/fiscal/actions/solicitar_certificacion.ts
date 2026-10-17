import { DomainAction, type Transaccion } from '#shared/domain_action'
import { Conflicto, NoEncontrado } from '#shared/errores'
import { exigirAccesoEmpresa } from '#shared/empresa_activa'
import { aTexto, dec } from '#ledger/dinero'
import { hoyGuatemala } from '#ledger/fechas'
import { valorParametro } from '#fiscal/parametros'
import { configuracionFel, credencialesFel } from '#fiscal/fel/configuracion'
import {
    ERROR_AVISO_SIN_CUBRIR,
    ERROR_RECEPTOR,
    dteVigente,
    insertarDte,
    netoParaDte,
    receptorDe,
    receptorFaltante,
    referenciaA,
    tipoFacturaDte,
    type DteFila,
    type ReceptorFiscal,
} from '#fiscal/fel/dte'
import { FelNoConfigurada, ReceptorRequerido, TipoDteNoPermitido } from '#fiscal/fel/errores'

/**
 * `fel.certificar` (`POST /facturas/:id/certificar`, `POST /fel/lotes`): pide la certificación de
 * una factura (o de una mora con IVA, que sale como NDEB referida a su factura; contrato §8.3).
 * Crea su DTE `pendiente` (o `contingencia`), que el worker `fiscal:worker` envía. Idempotente: si
 * ya tiene un DTE vigente lo devuelve.
 *
 * - A mano (`automatico = false`): 422 `fel_no_configurada` sin FEL, proveedor o credenciales; 422
 *   `receptor_requerido` desde el límite de consumidor final; 422 `tipo_dte_no_permitido` en una mora
 *   sin IVA o cuya factura aún no está certificada.
 * - Automático (avisos de cobro cubiertos: cola `fel` y `pago.registrado`): no lanza por las reglas
 *   de arriba. Un aviso aún no cubierto se omite; un receptor que falta deja el DTE `rechazado`
 *   local (sin enviarse) con `receptor_requerido` y emite `dte.rechazado`: se corrige el NIT del
 *   cliente y se reintenta.
 */

export interface EntradaSolicitarCertificacion {
    factura_id: number
    automatico?: boolean
}

export interface ResultadoSolicitud {
    factura_id: number
    dte: DteFila | null
    creado: boolean
    /** por qué no se creó (automático) */
    motivo: string | null
}

interface FacturaFel {
    id: number
    empresa_id: number
    cliente_id: number
    tipo: 'servicio' | 'mora'
    estado: string
    total: string
    iva: string
    aviso_cobro: boolean
    factura_origen_id: number | null
    reglas_snapshot: { receptor?: ReceptorFiscal | null } | null
}

export default class SolicitarCertificacion extends DomainAction<
    EntradaSolicitarCertificacion,
    ResultadoSolicitud
> {
    readonly nombre = 'fel.certificar'

    protected async handle(
        input: EntradaSolicitarCertificacion,
        t: Transaccion,
    ): Promise<ResultadoSolicitud> {
        t.fijarEntidad('factura', input.factura_id)
        const factura = (await t.trx
            .from('billing.facturas')
            .where('id', input.factura_id)
            .forUpdate()
            .select(
                'id',
                'empresa_id',
                'cliente_id',
                'tipo',
                'estado',
                'total',
                'iva',
                'aviso_cobro',
                'factura_origen_id',
                'reglas_snapshot',
            )
            .first()) as FacturaFel | null
        if (!factura) throw new NoEncontrado(`La factura ${input.factura_id} no existe`)
        const empresaId = Number(factura.empresa_id)
        exigirAccesoEmpresa(t.ctx, empresaId)
        t.fijarEmpresa(empresaId)
        const omitir = (motivo: string): ResultadoSolicitud => ({
            factura_id: factura.id,
            dte: null,
            creado: false,
            motivo,
        })

        const vigente = await dteVigente(
            t.trx,
            factura.tipo === 'mora' ? 'nota_debito' : 'factura',
            factura.id,
        )
        if (vigente) return { factura_id: factura.id, dte: vigente, creado: false, motivo: 'ya_tiene_dte' }
        if (input.automatico) {
            // un rechazo definitivo (SAT o receptor) espera a que alguien corrija y reintente
            const rechazado = await t.trx
                .from('fiscal.dte')
                .where('documento_tipo', factura.tipo === 'mora' ? 'nota_debito' : 'factura')
                .where('documento_id', factura.id)
                .where('estado', 'rechazado')
                .whereNot('ultimo_error', ERROR_AVISO_SIN_CUBRIR)
                .first()
            if (rechazado) return omitir('rechazado_definitivo')
        }
        if (factura.estado === 'anulada') {
            if (input.automatico) return omitir('anulada')
            throw new Conflicto(`La factura ${factura.id} está anulada`, 'factura_anulada', 'Factura anulada')
        }

        const config = await configuracionFel(empresaId, t.trx)
        if (config.modo === 'desactivada' || !config.proveedor) {
            if (input.automatico) return omitir('fel_desactivada')
            throw new FelNoConfigurada('La FEL de la empresa está desactivada')
        }
        if (
            !input.automatico &&
            !(await credencialesFel(empresaId, config.proveedor, config.ambiente, t.trx))
        ) {
            throw new FelNoConfigurada(
                `No hay credenciales de ${config.proveedor} para el ambiente ${config.ambiente} (PUT /fel/credenciales/${config.ambiente})`,
            )
        }
        if (input.automatico && factura.aviso_cobro && factura.estado !== 'pagada') {
            return omitir('aviso_sin_cubrir')
        }

        const hoy = hoyGuatemala()
        let tipoDte = await tipoFacturaDte(empresaId, hoy, t.trx)
        let referencia = null
        if (factura.tipo === 'mora') {
            const origen = factura.factura_origen_id
                ? await dteVigente(t.trx, 'factura', factura.factura_origen_id)
                : null
            const problema = dec(factura.iva).lte(0)
                ? `La mora ${factura.id} no lleva IVA (mora_con_iva = no): no es un documento fiscal`
                : !origen || origen.estado !== 'certificado'
                  ? `La factura de origen de la mora ${factura.id} aún no está certificada`
                  : null
            if (problema) {
                if (input.automatico) return omitir('mora_sin_ndeb')
                throw new TipoDteNoPermitido(problema)
            }
            tipoDte = 'NDEB'
            referencia = referenciaA(origen!, `Recargo por mora de la factura ${factura.factura_origen_id}`)
        }

        // H5/H11: todo documento con notas internas (aviso o no) se certifica por el neto
        const neto = await netoParaDte(t.trx, factura.id)
        const receptor = await receptorDe(t.trx, factura.cliente_id, factura.reglas_snapshot?.receptor)
        const falta = await receptorFaltante(empresaId, receptor, aTexto(neto.total), hoy, t.trx)
        if (falta && !input.automatico) {
            const limite = await valorParametro<string>(empresaId, 'consumidor_final_limite', hoy, t.trx)
            throw new ReceptorRequerido(aTexto(neto.total), aTexto(dec(limite)))
        }
        const dte = await insertarDte(t.trx, {
            empresa_id: empresaId,
            documento_tipo: factura.tipo === 'mora' ? 'nota_debito' : 'factura',
            documento_id: factura.id,
            tipo_dte: tipoDte,
            proveedor: config.proveedor,
            ambiente: config.ambiente,
            receptor,
            referencia,
            total: aTexto(neto.total),
            iva: aTexto(neto.iva),
            estado: falta ? 'rechazado' : config.contingencia_activa ? 'contingencia' : 'pendiente',
            contingencia: config.contingencia_activa && !falta,
            ultimo_error: falta ? ERROR_RECEPTOR : null,
            definitivo: falta,
            solicitud: input.automatico ? 'automatico' : 'manual',
        })
        if (falta) {
            await t.emit('dte.rechazado', {
                dte_id: dte.id,
                empresa_id: empresaId,
                documento_tipo: dte.documento_tipo,
                documento_id: factura.id,
                error: `${ERROR_RECEPTOR}: el total llega al límite de consumidor final; el cliente necesita NIT, CUI o pasaporte`,
                definitivo: true,
            })
        }
        return { factura_id: factura.id, dte, creado: true, motivo: falta ? ERROR_RECEPTOR : null }
    }
}
