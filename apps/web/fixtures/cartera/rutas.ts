/**
 * Rutas de la fase 4 · cartera (A3, §10.9): estimación de incobrables y castigo. Como la API tras la
 * decisión g (§18), la factura castigada pasa a estado `castigada` con `pagado` igual a lo cobrado
 * (lo castigado está en el castigo); se usa primero la estimación disponible y luego el gasto.
 */
import type { Schema } from '@argosisp/contracts'
import Decimal from 'decimal.js'
import type { RespuestaFixture, RutasFixture, SolicitudFixture } from '~/utils/fetchFixtures'
import { bd, siguienteId } from '../bd'
import { conflicto, hoy, invalido, regla422 } from '../cobros/rutas'
import { ahora, conIdempotencia, conPermiso, cuerpoObjeto, deLaEmpresa, empresaActivaDe, paginar, registrarAccion, usuariosPorToken } from '../comun'

/** `reserva_incobrables_max`: 3 % de los saldos deudores (inv. A.2). */
const PORCENTAJE = new Decimal('0.03')

function usuarioDe(solicitud: SolicitudFixture): number | null {
    return solicitud.token ? usuariosPorToken[solicitud.token]?.id ?? null : null
}

function saldo(factura: Schema<'Factura'>): Decimal {
    return new Decimal(factura.total).minus(factura.pagado)
}

/** Estimación disponible en 1.1.12: lo provisionado menos lo usado en castigos. */
function estimacionDisponible(empresaId: number): Decimal {
    const provisto = bd.provisiones.filter(p => p.empresa_id === empresaId).reduce((s, p) => s.plus(p.monto), new Decimal(0))
    const usado = bd.castigos.filter(c => c.empresa_id === empresaId).reduce((s, c) => s.plus(c.estimacion), new Decimal(0))
    return provisto.minus(usado)
}

function provisionar(solicitud: SolicitudFixture): RespuestaFixture {
    const cuerpo = cuerpoObjeto(solicitud)
    const anio = cuerpo.anio
    if (typeof anio !== 'number' || !Number.isInteger(anio) || anio < 2000 || anio > 2100) {
        return invalido([{ field: 'anio', message: 'Año de 2000 a 2100', rule: 'range' }])
    }
    const hoyGt = hoy()
    const fecha = typeof cuerpo.fecha === 'string' && cuerpo.fecha ? cuerpo.fecha : (String(anio) === hoyGt.slice(0, 4) ? hoyGt : `${anio}-12-31`)
    if (fecha > hoyGt) {
        return invalido([{ field: 'fecha', message: 'El corte no puede ser futuro', rule: 'futuro' }])
    }
    const empresaId = typeof cuerpo.empresa_id === 'number' ? cuerpo.empresa_id : (empresaActivaDe(solicitud) ?? 1)
    // H12: un corte anterior al de la última estimación es 422 `provision_fuera_de_orden`.
    const ultima = bd.provisiones.filter(p => p.empresa_id === empresaId).sort((a, b) => b.fecha.localeCompare(a.fecha))[0]
    if (ultima && fecha < ultima.fecha) {
        return regla422('provision_fuera_de_orden', 'Estimación fuera de orden', `El corte ${fecha} es anterior al de la última estimación (${ultima.fecha})`, [{ field: 'fecha', message: `Corte posterior a ${ultima.fecha}`, rule: 'provision_fuera_de_orden' }])
    }
    const base = bd.facturas
        .filter(f => (f.empresa_id ?? 1) === empresaId && ['emitida', 'parcial', 'vencida'].includes(f.estado) && f.emitida_en.slice(0, 10) <= fecha)
        .reduce((s, f) => s.plus(saldo(f)), new Decimal(0))
    const tope = base.times(PORCENTAJE).toDecimalPlaces(2)
    const anterior = estimacionDisponible(empresaId)
    const monto = Decimal.max(tope.minus(anterior), 0)
    const provision: Schema<'ProvisionCartera'> = {
        id: siguienteId(bd.provisiones),
        empresa_id: empresaId,
        anio,
        fecha,
        base: base.toFixed(2),
        porcentaje: '3.000000',
        tope: tope.toFixed(2),
        saldo_anterior: anterior.toFixed(2),
        monto: monto.toFixed(2),
        asiento_id: monto.isZero() ? null : siguienteId(bd.asientos),
        registrado_por: usuarioDe(solicitud),
        created_at: ahora(),
    }
    bd.provisiones.push(provision)
    registrarAccion(solicitud, 'cartera.provisionar', { tipo: 'provision_cartera', id: provision.id }, cuerpo)
    return { status: 201, cuerpo: provision }
}

function castigar(solicitud: SolicitudFixture): RespuestaFixture {
    const cuerpo = cuerpoObjeto(solicitud)
    const ids = Array.isArray(cuerpo.facturas) ? cuerpo.facturas.filter((f): f is number => typeof f === 'number') : []
    if (!ids.length) {
        return invalido([{ field: 'facturas', message: 'El campo facturas debe tener al menos 1 elemento', rule: 'minLength' }])
    }
    if (typeof cuerpo.motivo !== 'string' || !cuerpo.motivo) {
        return invalido([{ field: 'motivo', message: 'El campo motivo es obligatorio', rule: 'required' }])
    }
    if (typeof cuerpo.evidencia !== 'string' || !cuerpo.evidencia) {
        return invalido([{ field: 'evidencia', message: 'El campo evidencia es obligatorio', rule: 'required' }])
    }
    const motivo = cuerpo.motivo.trim()
    const evidencia = cuerpo.evidencia.trim()
    if (motivo.length < 3 || evidencia.length < 3) {
        return regla422('castigo_sin_evidencia', 'Castigo sin evidencia', 'El castigo exige motivo y la evidencia de la gestión de cobro (LAT art. 21.20)', [
            ...(motivo.length < 3 ? [{ field: 'motivo', message: 'Motivo obligatorio', rule: 'castigo_sin_evidencia' }] : []),
            ...(evidencia.length < 3 ? [{ field: 'evidencia', message: 'Evidencia de la gestión de cobro obligatoria', rule: 'castigo_sin_evidencia' }] : []),
        ])
    }
    const facturas: Schema<'Factura'>[] = []
    for (const [indice, id] of ids.entries()) {
        const factura = bd.facturas.find(f => f.id === id)
        if (!factura) {
            return invalido([{ field: `facturas.${indice}`, message: `La factura ${id} no existe`, rule: 'exists' }])
        }
        if (!['emitida', 'parcial', 'vencida'].includes(factura.estado) || !saldo(factura).gt(0)) {
            return conflicto('factura_sin_saldo', 'Factura sin saldo', `La factura ${id} está ${factura.estado} y no tiene saldo que castigar`, [{ field: `facturas.${indice}`, message: `La factura ${id} no tiene saldo`, rule: 'factura_sin_saldo' }])
        }
        facturas.push(factura)
    }
    const [primera] = facturas
    if (!primera) {
        return invalido([])
    }
    if (facturas.some(f => f.cliente_id !== primera.cliente_id || (f.empresa_id ?? 1) !== (primera.empresa_id ?? 1))) {
        return invalido([{ field: 'facturas', message: 'Un castigo es de un solo cliente y una sola empresa', rule: 'un_cliente' }])
    }
    const empresaId = primera.empresa_id ?? 1
    const monto = facturas.reduce((s, f) => s.plus(saldo(f)), new Decimal(0))
    const estimacion = Decimal.min(Decimal.max(estimacionDisponible(empresaId), 0), monto)
    const momento = ahora()
    const castigo: Schema<'CastigoCartera'> = {
        id: siguienteId(bd.castigos),
        empresa_id: empresaId,
        cliente_id: primera.cliente_id,
        cliente_nombre: bd.clientes.find(c => c.id === primera.cliente_id)?.nombre ?? '',
        fecha: hoy(),
        motivo,
        evidencia,
        monto: monto.toFixed(2),
        iva: '0.00',
        estimacion: estimacion.toFixed(2),
        gasto: monto.minus(estimacion).toFixed(2),
        asiento_id: siguienteId(bd.asientos),
        registrado_por: usuarioDe(solicitud),
        created_at: momento,
        facturas: facturas.map(f => ({ factura_id: f.id, monto: saldo(f).toFixed(2), iva: '0.00' })),
    }
    bd.castigos.push(castigo)
    for (const factura of facturas) {
        Object.assign(factura, { estado: 'castigada', version: factura.version + 1, updated_at: momento })
    }
    registrarAccion(solicitud, 'cartera.castigar', { tipo: 'castigo', id: castigo.id }, cuerpo)
    return { status: 201, cuerpo: castigo }
}

export const rutasCartera: RutasFixture = {
    'GET /api/v1/cartera/provisiones': conPermiso('reportes.ver', solicitud => ({ status: 200, cuerpo: paginar(deLaEmpresa(bd.provisiones, solicitud).sort((a, b) => b.id - a.id), solicitud) })),
    'POST /api/v1/cartera/provisionar': conPermiso('cartera.provisionar', conIdempotencia(provisionar)),
    'GET /api/v1/cartera/castigos': conPermiso('reportes.ver', solicitud => ({ status: 200, cuerpo: paginar(deLaEmpresa(bd.castigos, solicitud).sort((a, b) => b.id - a.id), solicitud) })),
    'POST /api/v1/cartera/castigos': conPermiso('cartera.castigar', conIdempotencia(castigar)),
}
