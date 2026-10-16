import type { Schema } from '@argosisp/contracts'
import Decimal from 'decimal.js'
import type { RutasFixture } from '~/utils/fetchFixtures'
import { bd } from '../bd'
import { conPermiso, cuerpoObjeto, datosInvalidos } from '../comun'
import { fechaGuatemala } from '../libro/datos'

type Simulacion = Schema<'SimulacionPromesa'>
type ReglaSimulada = Schema<'ReglaSimulada'>
type Canal = Simulacion['canal']

const CANALES: readonly Canal[] = ['portal', 'ia', 'operador', 'supervisor']
const MONTO = /^\d{1,12}(\.\d{1,2})?$/
const DIA_MS = 86_400_000

function esCanal(valor: unknown): valor is Canal {
    return typeof valor === 'string' && (CANALES as readonly string[]).includes(valor)
}

function q(monto: Decimal.Value): string {
    return `Q${new Decimal(monto).toFixed(2)}`
}

function primerDiaSiguienteMes(hoy: string): string {
    const [anio = 0, mes = 0] = hoy.split('-').map(Number)
    return mes === 12 ? `${anio + 1}-01-01` : `${anio}-${String(mes + 1).padStart(2, '0')}-01`
}

/**
 * Como `simularPromesa` de A3 (`#billing/simulador_promesas`): todas las reglas en el orden de
 * `contratos/promesas.md`, sin detenerse, con `aplica: false` en las que la plantilla no exige.
 * `resultado`/`regla` son la primera que falla, o `requiere_aprobacion`, o aprobada.
 */
export function simularPromesa(servicio: Schema<'Servicio'>, canal: Canal, vence: Date, montoPedido: Decimal | null): Simulacion {
    const plantilla = bd.plantillas.find(p => p.id === servicio.plantilla_facturacion_id)
    const reglas = plantilla?.reglas_promesa
    const delCanal = reglas?.canales[canal]
    const hoy = fechaGuatemala(new Date().toISOString())
    const dia = fechaGuatemala(vence.toISOString())
    const pendientes = bd.facturas.filter(f => f.servicio_id === servicio.id && (f.estado === 'emitida' || f.estado === 'vencida' || f.estado === 'parcial'))
    const pendiente = pendientes.reduce((s, f) => s.plus(f.total).minus(f.pagado), new Decimal(0))
    const vencidas = pendientes.filter(f => f.estado === 'vencida' || fechaGuatemala(f.vence_en) < hoy)
    const vencida = vencidas.reduce((s, f) => s.plus(f.total).minus(f.pagado), new Decimal(0))
    const monto = montoPedido ?? pendiente
    const dias = Math.round((Date.parse(dia) - Date.parse(hoy)) / DIA_MS)
    const plazoMax = delCanal?.plazo_max_dias ?? reglas?.plazo_max_dias ?? 0
    const siguiente = primerDiaSiguienteMes(hoy)
    const maximo = delCanal?.max_por_periodo ?? reglas?.max_por_periodo ?? 0
    const enPeriodo = bd.promesas.filter(p => p.servicio_id === servicio.id && ['activa', 'cumplida', 'incumplida', 'pendiente_aprobacion'].includes(p.estado)
        && new Date(p.created_at).getTime() >= Date.now() - 30 * DIA_MS).length
    const deudaMaxima = delCanal?.deuda_maxima ?? reglas?.deuda_maxima ?? null
    const abonoPct = reglas?.abono_inicial_pct ?? 0
    const origen = (deCanal: unknown) => (deCanal !== null && deCanal !== undefined ? canal : 'general')

    const lista: ReglaSimulada[] = [
        { regla: 'habilitadas', ok: reglas?.habilitadas ?? false, aplica: true, valor: null, limite: true, origen: 'general', detalle: reglas?.habilitadas ? 'La plantilla admite promesas' : 'La plantilla no admite promesas' },
        { regla: 'canal_permitido', ok: delCanal?.permitido ?? false, aplica: true, valor: canal, limite: true, origen: canal, detalle: delCanal?.permitido ? `El canal ${canal} puede crear promesas` : `El canal ${canal} no puede crear promesas` },
        { regla: 'sin_deuda', ok: pendiente.gt(0), aplica: true, valor: pendiente.toFixed(2), limite: null, origen: 'general', detalle: pendiente.gt(0) ? `El servicio debe ${q(pendiente)}` : 'El servicio no tiene deuda' },
        { regla: 'plazo_max_dias', ok: dias <= plazoMax, aplica: true, valor: dias, limite: plazoMax, origen: origen(delCanal?.plazo_max_dias), detalle: `Vence en ${dias} ${dias === 1 ? 'día' : 'días'} (máximo ${plazoMax})` },
        { regla: 'no_exceder_siguiente_facturacion', ok: !reglas?.no_exceder_siguiente_facturacion || dia < siguiente, aplica: reglas?.no_exceder_siguiente_facturacion ?? false, valor: dia, limite: siguiente, origen: 'general', detalle: `Vence (${dia}) antes de la siguiente facturación (${siguiente})` },
        { regla: 'deuda_maxima', ok: deudaMaxima === null || monto.lte(deudaMaxima), aplica: deudaMaxima !== null, valor: deudaMaxima === null ? null : monto.toFixed(2), limite: deudaMaxima, origen: origen(delCanal?.deuda_maxima), detalle: deudaMaxima === null ? 'Sin deuda máxima para prometer' : `Promete ${q(monto)} (máximo ${q(deudaMaxima)})` },
        { regla: 'abono_inicial_pct', ok: abonoPct === 0, aplica: abonoPct > 0, valor: null, limite: abonoPct, origen: 'general', detalle: abonoPct === 0 ? 'No se exige abono inicial' : `Debe abonar el ${abonoPct} % antes de prometer` },
        { regla: 'antiguedad_minima_dias', ok: true, aplica: (reglas?.antiguedad_minima_dias ?? 0) > 0, valor: null, limite: reglas?.antiguedad_minima_dias ?? 0, origen: 'general', detalle: (reglas?.antiguedad_minima_dias ?? 0) > 0 ? 'Cumple la antigüedad mínima' : 'No se exige antigüedad mínima' },
        { regla: 'cumplimiento_minimo_pct', ok: true, aplica: (reglas?.cumplimiento_minimo_pct ?? null) !== null, valor: null, limite: reglas?.cumplimiento_minimo_pct ?? null, origen: 'general', detalle: 'No se exige cumplimiento mínimo' },
        { regla: 'bloqueo_tras_incumplida_dias', ok: true, aplica: false, valor: null, limite: reglas?.bloqueo_tras_incumplida_dias ?? 0, origen: 'general', detalle: 'No tiene promesas incumplidas' },
        { regla: 'max_por_periodo', ok: enPeriodo < maximo, aplica: true, valor: enPeriodo, limite: maximo, origen: origen(delCanal?.max_por_periodo), detalle: `Lleva ${enPeriodo} ${enPeriodo === 1 ? 'promesa' : 'promesas'} en el periodo (máximo ${maximo})` },
    ]
    if (delCanal?.requiere_aprobacion) {
        lista.push({ regla: 'requiere_aprobacion', ok: true, aplica: true, valor: canal, limite: true, origen: canal, detalle: `Las promesas del canal ${canal} requieren aprobación de un supervisor` })
    }
    const falla = lista.find(r => r.aplica && !r.ok)
    const pendienteAprobacion = !falla && delCanal?.requiere_aprobacion
    const resultado: Simulacion['resultado'] = falla ? 'rechazada' : pendienteAprobacion ? 'pendiente_aprobacion' : 'aprobada'
    const regla = falla?.regla ?? (pendienteAprobacion ? 'requiere_aprobacion' : null)
    const motivo = falla?.detalle ?? (pendienteAprobacion ? `Las promesas del canal ${canal} requieren aprobación de un supervisor` : 'Cumple todas las reglas de la plantilla')
    const abierta = bd.promesas.some(p => p.servicio_id === servicio.id && (p.estado === 'activa' || p.estado === 'pendiente_aprobacion'))
    const validaciones: Simulacion['validaciones'] = [
        { campo: 'monto', ok: monto.gt(0), regla: 'monto', detalle: `Monto ${q(monto)}` },
        { campo: 'monto', ok: monto.lte(pendiente) || pendiente.isZero(), regla: 'monto_maximo', detalle: monto.lte(pendiente) ? `No supera la deuda pendiente (${q(pendiente)})` : `Supera la deuda pendiente (${q(pendiente)})` },
        { campo: 'vence_en', ok: vence.getTime() > Date.now(), regla: 'futuro', detalle: `Vence el ${dia} (en ${dias} días)` },
        { campo: 'servicio_id', ok: !abierta, regla: 'promesa_abierta', detalle: abierta ? 'Ya tiene una promesa activa o pendiente' : 'No tiene otra promesa activa o pendiente' },
    ]
    const fechaMaxima = new Date(Date.parse(hoy) + plazoMax * DIA_MS).toISOString().slice(0, 10)
    return {
        servicio_id: servicio.id,
        cliente_id: servicio.cliente_id,
        canal,
        vence_en: vence.toISOString(),
        monto: monto.toFixed(2),
        evaluada_en: new Date().toISOString(),
        resultado,
        regla,
        motivo,
        resultado_creacion: validaciones.every(v => v.ok) ? resultado : 'error',
        reglas: lista,
        validaciones,
        deuda: { pendiente: pendiente.toFixed(2), vencida: vencida.toFixed(2), pagado_pendientes: '0.00', facturas_vencidas: vencidas.length },
        historial: { ventana: reglas?.historial_ventana ?? 6, resueltas: 0, cumplidas: 0, cumplimiento_pct: null },
        siguiente_facturacion: siguiente,
        limites: {
            habilitadas: reglas?.habilitadas ?? false,
            permitido: delCanal?.permitido ?? false,
            requiere_aprobacion: delCanal?.requiere_aprobacion ?? false,
            plazo_max_dias: plazoMax,
            fecha_maxima: fechaMaxima,
            siguiente_facturacion: siguiente,
            deuda_pendiente: pendiente.toFixed(2),
            deuda_vencida: vencida.toFixed(2),
            deuda_maxima: deudaMaxima,
            abono_requerido: pendiente.times(abonoPct).div(100).toFixed(2),
            abono_pagado: '0.00',
            max_por_periodo: maximo,
            en_periodo: enPeriodo,
        },
        suspension_manual: servicio.suspension_manual ?? false,
    }
}

export const rutasSimulador: RutasFixture = {
    'POST /api/v1/promesas/simular': conPermiso('promesas.ver', (solicitud) => {
        const cuerpo = cuerpoObjeto(solicitud)
        const servicio = bd.servicios.find(s => s.id === cuerpo.servicio_id)
        const errores = []
        if (!servicio) {
            errores.push({ field: 'servicio_id', message: 'El servicio no existe', rule: 'exists' })
        }
        if (cuerpo.monto !== undefined && (typeof cuerpo.monto !== 'string' || !MONTO.test(cuerpo.monto))) {
            errores.push({ field: 'monto', message: 'Monto inválido', rule: 'regex' })
        }
        const vence = typeof cuerpo.vence_en === 'string' ? new Date(cuerpo.vence_en) : null
        if (vence && Number.isNaN(vence.getTime())) {
            errores.push({ field: 'vence_en', message: 'Fecha y hora inválidas', rule: 'date' })
        }
        if (cuerpo.canal !== undefined && !esCanal(cuerpo.canal)) {
            errores.push({ field: 'canal', message: 'Canal inválido', rule: 'enum' })
        }
        if (errores.length || !servicio) {
            return datosInvalidos(errores)
        }
        // Por defecto, el fin de mañana en Guatemala (UTC−6).
        const manana = new Date(Date.parse(`${fechaGuatemala(new Date().toISOString())}T23:59:59.999-06:00`) + DIA_MS)
        const canal = esCanal(cuerpo.canal) ? cuerpo.canal : 'operador'
        const monto = typeof cuerpo.monto === 'string' ? new Decimal(cuerpo.monto) : null
        return { status: 200, cuerpo: simularPromesa(servicio, canal, vence ?? manana, monto) }
    }),
}
