/**
 * `GET /panel-financiero` (A3, decisión 4 del PM): ingreso mensual recurrente (MRR) = precio mensual
 * de los servicios activos y limitados con IVA; ARPU = MRR entre esos servicios; bajas del mes =
 * servicios retirados; efectivo solo con `libro.ver`. Con `empresas=todas` agrega `total`. Una falla
 * simulada (`bd.fallas`) del bloque de ingresos llega como bloque `error`, no como 500.
 */
import type { Schema } from '@argosisp/contracts'
import Decimal from 'decimal.js'
import type { RutasFixture } from '~/utils/fetchFixtures'
import { bd } from '../bd'
import { conPermiso, deLaEmpresa, usuariosPorToken } from '../comun'

type Panel = Schema<'PanelFinanciero'>
type Seccion = Panel['empresas'][number]

function mesActual(): string {
    return new Date().toISOString().slice(0, 7)
}

function seccionDe(empresaId: number, nombre: string, conEfectivo: boolean): Seccion {
    const delaEmpresa = bd.servicios.filter(s => s.empresa_id === empresaId)
    const cuentan = delaEmpresa.filter(s => s.estado === 'activo' || s.estado === 'limitado')
    const mrr = cuentan.reduce((suma, s) => suma.plus(s.precio_mensual ?? 0), new Decimal(0))
    const retirados = delaEmpresa.filter(s => s.estado === 'retirado').length
    const suspendidos = delaEmpresa.filter(s => s.estado === 'suspendido').length
    const base = cuentan.length + suspendidos + retirados
    const seccion: Seccion = {
        empresa_id: empresaId,
        empresa: nombre,
        ingresos: {
            estado: 'ok',
            motivo: null,
            error: null,
            datos: {
                servicios: cuentan.length,
                planes: mrr.toFixed(2),
                descuentos: '0.00',
                cargos_recurrentes: '0.00',
                adicionales: '0.00',
                mrr: mrr.toFixed(2),
                arpu: cuentan.length ? mrr.div(cuentan.length).toDecimalPlaces(2).toFixed(2) : null,
            },
        },
        bajas: {
            estado: 'ok',
            motivo: null,
            error: null,
            datos: {
                mes: mesActual(),
                dias_baja: 60,
                bajas: retirados,
                retiros: retirados,
                suspendidos: 0,
                altas: 0,
                vigentes: cuentan.length + suspendidos,
                base,
                tasa: base ? new Decimal(retirados).div(base).times(100).toDecimalPlaces(2).toFixed(2) : null,
            },
        },
    }
    if (conEfectivo) {
        const cuentas = bd.cuentas.filter(c => c.imputable && (c.codigo.startsWith('1.1.01.') || c.codigo.startsWith('1.1.02.')) && (c.empresa_id ?? empresaId) === empresaId)
        seccion.efectivo = {
            estado: 'ok',
            motivo: null,
            error: null,
            datos: { cajas: '0.00', bancos: '0.00', total: '0.00', cuentas: cuentas.map(c => ({ cuenta_id: c.id, codigo: c.codigo, nombre: c.nombre, tipo: c.codigo.startsWith('1.1.01.') ? 'caja' : 'banco', saldo: '0.00' })) },
        }
    }
    return seccion
}

export const rutasPanelFinanciero: RutasFixture = {
    'GET /api/v1/panel-financiero': conPermiso('panel_financiero.ver', (solicitud) => {
        const usuario = solicitud.token ? usuariosPorToken[solicitud.token] : undefined
        const conEfectivo = usuario?.permisos.includes('libro.ver') ?? false
        const todas = solicitud.query.get('empresas') === 'todas'
        const visibles = deLaEmpresa(bd.empresas.map(e => ({ ...e, empresa_id: e.id })), solicitud)
        const secciones = visibles.map(e => seccionDe(e.id, e.nombre_comercial, conEfectivo))
        let total: Panel['total'] = null
        if (todas) {
            const mrr = secciones.reduce((suma, s) => suma.plus(s.ingresos?.datos?.mrr ?? 0), new Decimal(0))
            const servicios = secciones.reduce((n, s) => n + (s.ingresos?.datos?.servicios ?? 0), 0)
            const bajas = secciones.reduce((n, s) => n + (s.bajas?.datos?.bajas ?? 0), 0)
            const base = secciones.reduce((n, s) => n + (s.bajas?.datos?.base ?? 0), 0)
            total = {
                ingresos: { estado: 'ok', motivo: null, error: null, datos: { servicios, planes: mrr.toFixed(2), descuentos: '0.00', cargos_recurrentes: '0.00', adicionales: '0.00', mrr: mrr.toFixed(2), arpu: servicios ? mrr.div(servicios).toDecimalPlaces(2).toFixed(2) : null } },
                bajas: { estado: 'ok', motivo: null, error: null, datos: { mes: mesActual(), dias_baja: 60, bajas, retiros: bajas, suspendidos: 0, altas: 0, vigentes: servicios, base, tasa: base ? new Decimal(bajas).div(base).times(100).toDecimalPlaces(2).toFixed(2) : null } },
            }
        }
        const cuerpo: Panel = { hoy: new Date().toISOString().slice(0, 10), mes: solicitud.query.get('mes') ?? mesActual(), generado_en: new Date().toISOString(), empresas: secciones, total }
        return { status: 200, cuerpo }
    }),
}
