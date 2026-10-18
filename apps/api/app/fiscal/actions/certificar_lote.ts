import { DomainAction, type Transaccion } from '#shared/domain_action'
import { Problema, ValidacionFallida } from '#shared/errores'
import { exigirAccesoEmpresa } from '#shared/empresa_activa'
import { resolverEmpresaActiva } from '#core/empresas'
import SolicitarCertificacion, { type ResultadoSolicitud } from '#fiscal/actions/solicitar_certificacion'

/**
 * `fel.certificar_lote` (`POST /fel/lotes { facturas[] | desde, hasta }`, permiso
 * `fel.certificar`): pide la certificación de varias facturas a la vez (modo `opcional`, o lo que
 * quedó sin certificar). Cada una se pide como `POST /facturas/:id/certificar`, en su propio
 * savepoint: una que falla (receptor, FEL no configurada…) queda en `errores` con su `type` y las
 * demás siguen. Con `desde`/`hasta`: las facturas vivas de la empresa emitidas en ese rango que aún
 * no tienen DTE (hasta 500).
 */

export interface EntradaCertificarLote {
    empresa_id?: number | null
    facturas?: number[]
    desde?: string
    hasta?: string
}

export interface ResultadoLote {
    solicitadas: ResultadoSolicitud[]
    errores: Array<{ factura_id: number; tipo: string; detalle: string }>
}

export default class CertificarLote extends DomainAction<EntradaCertificarLote, ResultadoLote> {
    readonly nombre = 'fel.certificar_lote'

    protected async handle(input: EntradaCertificarLote, t: Transaccion): Promise<ResultadoLote> {
        const empresaId = input.empresa_id ?? (await resolverEmpresaActiva(t.ctx, t.trx))
        exigirAccesoEmpresa(t.ctx, empresaId)
        t.fijarEmpresa(empresaId)
        let ids = input.facturas ?? []
        if (ids.length === 0) {
            if (!input.desde || !input.hasta) {
                throw new ValidacionFallida([
                    {
                        field: 'facturas',
                        message: 'Indica las facturas o el rango desde/hasta',
                        rule: 'required',
                    },
                ])
            }
            const filas = (await t.trx
                .from('billing.facturas as f')
                .where('f.empresa_id', empresaId)
                .whereNot('f.estado', 'anulada')
                .whereRaw(
                    `(f.emitida_en AT TIME ZONE 'America/Guatemala')::date BETWEEN ?::date AND ?::date`,
                    [input.desde, input.hasta],
                )
                .whereNotExists((q) =>
                    q
                        .from('fiscal.dte as d')
                        .whereRaw('d.documento_id = f.id')
                        .whereRaw(
                            `d.documento_tipo = CASE WHEN f.tipo = 'mora' THEN 'nota_debito' ELSE 'factura' END`,
                        )
                        .whereNot('d.estado', 'rechazado'),
                )
                .orderBy('f.id')
                .limit(500)
                .select('f.id')) as Array<{ id: number }>
            ids = filas.map((f) => Number(f.id))
        }
        const salida: ResultadoLote = { solicitadas: [], errores: [] }
        for (const facturaId of [...new Set(ids)]) {
            try {
                salida.solicitadas.push(
                    await new SolicitarCertificacion().execute({ factura_id: facturaId }, t.ctx, {
                        trx: t.trx,
                    }),
                )
            } catch (error) {
                if (!(error instanceof Problema)) throw error
                salida.errores.push({
                    factura_id: facturaId,
                    tipo: error.tipo.split(':').at(-1) ?? error.tipo,
                    detalle: error.detalle ?? error.message,
                })
            }
        }
        return salida
    }
}
