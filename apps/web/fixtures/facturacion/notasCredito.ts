import type { Problem, Schema } from '@argosisp/contracts'
import Decimal from 'decimal.js'
import type { RespuestaFixture, RutasFixture } from '~/utils/fetchFixtures'
import { bd } from '../bd'
import { ahora, conIdempotencia, conPermiso, cuerpoObjeto, datosInvalidos, idDe, noEncontrado, numeroQuery, paginar, registrarAccion, usuariosPorToken } from '../comun'
import { aplicarNotaCredito } from './aplicarNotaCredito'

type NotaCredito = Schema<'NotaCredito'>

const MONTO = /^\d{1,12}(\.\d{1,2})?$/

function conflicto(codigo: string, titulo: string, detalle: string): RespuestaFixture {
    const cuerpo: Problem = { type: `urn:argosisp:problema:${codigo}`, title: titulo, status: 409, detail: detalle }
    return { status: 409, cuerpo }
}

/** Notas de crédito de una factura, para `FacturaDetalle.notas_credito`. */
export function notasDeFactura(facturaId: number): NotaCredito[] {
    return bd.notasCredito.filter(n => n.factura_id === facturaId).sort((a, b) => a.id - b.id)
}

/**
 * Notas de crédito internas (A3, `EmitirNotaCredito`): reducen el saldo de la factura (suman a
 * `pagado` y a `acreditado`) con un asiento `nota_credito` (Debe ingresos e IVA en proporción,
 * Haber CxC) y re-evalúan el servicio. `evaluar` es la misma evaluación que usa el pago.
 */
export function rutasNotasCredito(evaluar: (servicioIds: number[]) => Schema<'ServicioEvaluado'>[], detalle: (factura: Schema<'Factura'>) => Schema<'FacturaDetalle'>): RutasFixture {
    return {
        'POST /api/v1/facturas/:id/notas-credito': conPermiso('facturas.nota_credito', conIdempotencia((solicitud) => {
            const factura = bd.facturas.find(f => f.id === idDe(solicitud))
            if (!factura) {
                return noEncontrado('la factura')
            }
            const cuerpo = cuerpoObjeto(solicitud)
            const errores: NonNullable<Problem['errors']> = []
            const motivo = typeof cuerpo.motivo === 'string' ? cuerpo.motivo.trim() : ''
            if (typeof cuerpo.monto !== 'string' || !MONTO.test(cuerpo.monto) || new Decimal(cuerpo.monto).lte(0)) {
                errores.push({ field: 'monto', message: 'El monto debe ser mayor que cero, con hasta 2 decimales', rule: 'monto' })
            }
            if (motivo.length < 3 || motivo.length > 500) {
                errores.push({ field: 'motivo', message: 'El motivo debe tener entre 3 y 500 caracteres', rule: 'minLength' })
            }
            if (errores.length) {
                return datosInvalidos(errores)
            }
            if (factura.estado === 'anulada') {
                return conflicto('factura_anulada', 'Factura anulada', `La factura ${factura.id} está anulada`)
            }
            const saldo = new Decimal(factura.total).minus(factura.pagado)
            if (saldo.lte(0)) {
                return conflicto('factura_sin_saldo', 'Factura sin saldo', `La factura ${factura.id} no tiene saldo pendiente`)
            }
            const monto = new Decimal(String(cuerpo.monto))
            if (monto.gt(saldo)) {
                return datosInvalidos([{ field: 'monto', message: `El monto excede el saldo de la factura (Q${saldo.toFixed(2)})`, rule: 'monto' }])
            }
            const momento = ahora()
            const usuario = solicitud.token ? usuariosPorToken[solicitud.token] : undefined
            const nota = aplicarNotaCredito(bd, factura, monto, motivo, usuario, momento)
            const servicios = evaluar(factura.servicio_id === null ? [] : [factura.servicio_id])
            registrarAccion(solicitud, 'facturas.nota_credito', { tipo: 'factura', id: factura.id }, { monto: nota.monto, motivo })
            const emitida: Schema<'NotaCreditoEmitida'> = { ...nota, factura: detalle(factura), servicios }
            return { status: 201, cuerpo: emitida }
        })),

        'GET /api/v1/notas-credito': conPermiso('facturas.ver', (solicitud) => {
            const cliente = numeroQuery(solicitud, 'cliente_id')
            const factura = numeroQuery(solicitud, 'factura_id')
            const desde = solicitud.query.get('desde')
            const hasta = solicitud.query.get('hasta')
            const filas = bd.notasCredito
                .filter(n => cliente === undefined || n.cliente_id === cliente)
                .filter(n => factura === undefined || n.factura_id === factura)
                .filter(n => !desde || n.fecha >= desde)
                .filter(n => !hasta || n.fecha <= hasta)
                .sort((a, b) => b.id - a.id)
            return { status: 200, cuerpo: paginar(filas, solicitud) }
        }),

        'GET /api/v1/notas-credito/:id': conPermiso('facturas.ver', (solicitud) => {
            const nota = bd.notasCredito.find(n => n.id === idDe(solicitud))
            return nota ? { status: 200, cuerpo: nota } : noEncontrado('la nota de crédito')
        }),
    }
}
