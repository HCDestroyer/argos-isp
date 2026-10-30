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

interface Cobertura {
    monto: Decimal
    facturas: Schema<'FacturaCubierta'>[]
}

/**
 * Como `coberturaDeServicio` (A3): las facturas `vencida` con saldo del servicio, la más antigua
 * primero (mora y cargos incluidos). Es lo que cubre una promesa creada ahora.
 */
export function coberturaDeServicio(servicioId: number): Cobertura {
    const filas = bd.facturas
        .filter(f => f.servicio_id === servicioId && f.estado === 'vencida' && new Decimal(f.total).gt(f.pagado))
        .sort((a, b) => a.vence_en.localeCompare(b.vence_en) || a.id - b.id)
    let monto = new Decimal(0)
    const facturas = filas.map((f) => {
        const saldo = new Decimal(f.total).minus(f.pagado)
        monto = monto.plus(saldo)
        return { factura_id: f.id, tipo: f.tipo ?? 'servicio', periodo: f.periodo, vence_en: f.vence_en, monto: saldo.toFixed(2) }
    })
    return { monto, facturas }
}

/**
 * Como `abonoDeServicio` (A3, decisión del líder 29 oct): pagos vigentes aplicados a facturas del
 * servicio después de que vencieron (`vencida_en`), desde el inicio de la mora actual (el
 * vencimiento más antiguo de las vencidas con saldo). Sin mora actual, cero.
 */
export function abonoDeServicio(servicioId: number): Decimal {
    const desde = bd.facturas
        .filter(f => f.servicio_id === servicioId && f.estado === 'vencida' && new Decimal(f.total).gt(f.pagado))
        .map(f => f.vencida_en ?? f.emitida_en)
        .sort()[0]
    if (!desde) {
        return new Decimal(0)
    }
    const desdeMs = Date.parse(desde)
    let abonado = new Decimal(0)
    for (const pago of bd.pagos) {
        if (pago.estado !== 'registrado') {
            continue
        }
        const momento = Date.parse(pago.created_at)
        for (const aplicacion of pago.aplicaciones) {
            const factura = bd.facturas.find(f => f.id === aplicacion.factura_id)
            if (factura?.servicio_id === servicioId && factura.vencida_en && momento >= Date.parse(factura.vencida_en) && momento >= desdeMs) {
                abonado = abonado.plus(aplicacion.monto)
            }
        }
    }
    return abonado
}

function plural(n: number, uno: string, varios: string): string {
    return `${n} ${n === 1 ? uno : varios}`
}

/**
 * Como `simularPromesa` de A3 (`#billing/simulador_promesas`): todas las reglas en el orden de
 * `contratos/promesas.md`, sin detenerse, con `aplica: false` en las que la plantilla no exige.
 * `resultado`/`regla` son la primera que falla, o `requiere_aprobacion`, o aprobada. Sin monto
 * pedido: la promesa cubre todo lo vencido (`monto` y `facturas` = la cobertura).
 */
export function simularPromesa(servicio: Schema<'Servicio'>, canal: Canal, vence: Date): Simulacion {
    const plantilla = bd.plantillas.find(p => p.id === servicio.plantilla_facturacion_id)
    const reglas = plantilla?.reglas_promesa
    const delCanal = reglas?.canales[canal]
    const hoy = fechaGuatemala(new Date().toISOString())
    const dia = fechaGuatemala(vence.toISOString())
    const pendientes = bd.facturas.filter(f => f.servicio_id === servicio.id && (f.estado === 'emitida' || f.estado === 'vencida' || f.estado === 'parcial'))
    const pendiente = pendientes.reduce((s, f) => s.plus(f.total).minus(f.pagado), new Decimal(0))
    const pagadoPendientes = pendientes.reduce((s, f) => s.plus(f.pagado), new Decimal(0))
    const vencidas = pendientes.filter(f => f.estado === 'vencida')
    const vencida = vencidas.reduce((s, f) => s.plus(f.total).minus(f.pagado), new Decimal(0))
    const cobertura = coberturaDeServicio(servicio.id)
    const abonado = abonoDeServicio(servicio.id)
    const dias = Math.round((Date.parse(dia) - Date.parse(hoy)) / DIA_MS)
    const plazoMax = delCanal?.plazo_max_dias ?? reglas?.plazo_max_dias ?? 0
    const siguiente = primerDiaSiguienteMes(hoy)
    const maximo = delCanal?.max_por_periodo ?? reglas?.max_por_periodo ?? 0
    const enPeriodo = bd.promesas.filter(p => p.servicio_id === servicio.id && ['activa', 'cumplida', 'incumplida', 'pendiente_aprobacion'].includes(p.estado)
        && new Date(p.created_at).getTime() >= Date.now() - 30 * DIA_MS).length
    const deudaMaxima = delCanal?.deuda_maxima ?? reglas?.deuda_maxima ?? null
    const abonoPct = reglas?.abono_inicial_pct ?? 0
    // Base del abono: lo vencido antes de los abonos (lo vencido hoy + lo ya abonado).
    const base = cobertura.monto.plus(abonado)
    const requerido = base.times(abonoPct).div(100).toDecimalPlaces(2)
    const conDeuda = cobertura.monto.gt(0)
    const origen = (deCanal: unknown) => (deCanal !== null && deCanal !== undefined ? canal : 'general')

    const lista: ReglaSimulada[] = [
        { regla: 'habilitadas', ok: reglas?.habilitadas ?? false, aplica: true, valor: null, limite: true, origen: 'general', detalle: reglas?.habilitadas ? 'La plantilla admite promesas' : 'La plantilla no admite promesas' },
        { regla: 'canal_permitido', ok: delCanal?.permitido ?? false, aplica: true, valor: canal, limite: true, origen: canal, detalle: delCanal?.permitido ? `El canal ${canal} puede crear promesas` : `El canal ${canal} no puede crear promesas` },
        { regla: 'sin_deuda', ok: conDeuda, aplica: true, valor: cobertura.monto.toFixed(2), limite: null, origen: 'general', detalle: conDeuda ? `La promesa cubre ${q(cobertura.monto)} vencidos en ${plural(cobertura.facturas.length, 'factura', 'facturas')}` : 'El servicio no tiene facturas vencidas: no hace falta promesa' },
        { regla: 'plazo_max_dias', ok: dias <= plazoMax, aplica: true, valor: dias, limite: plazoMax, origen: origen(delCanal?.plazo_max_dias), detalle: `Vence en ${plural(dias, 'día', 'días')} (máximo ${plazoMax})` },
        { regla: 'no_exceder_siguiente_facturacion', ok: !reglas?.no_exceder_siguiente_facturacion || dia < siguiente, aplica: reglas?.no_exceder_siguiente_facturacion ?? false, valor: dia, limite: siguiente, origen: 'general', detalle: `Vence (${dia}) antes de la siguiente facturación (${siguiente})` },
        { regla: 'deuda_maxima', ok: deudaMaxima === null || vencida.lte(deudaMaxima), aplica: deudaMaxima !== null, valor: deudaMaxima === null ? null : vencida.toFixed(2), limite: deudaMaxima, origen: origen(delCanal?.deuda_maxima), detalle: deudaMaxima === null ? 'Sin deuda máxima para prometer' : `Deuda vencida ${q(vencida)} (máximo ${q(deudaMaxima)})` },
        abonoPct > 0
            ? { regla: 'abono_inicial_pct', ok: abonado.gte(requerido), aplica: true, valor: abonado.toFixed(2), limite: requerido.toFixed(2), origen: 'general', detalle: abonado.gte(requerido) ? `Abonó ${q(abonado)} (${abonoPct}% de ${q(base)} vencidos = ${q(requerido)})` : `Debe abonar el ${abonoPct}% de la deuda vencida (${q(requerido)} de ${q(base)}) antes de prometer; lleva ${q(abonado)}` }
            : { regla: 'abono_inicial_pct', ok: true, aplica: false, valor: null, limite: 0, origen: 'general', detalle: 'No se exige abono inicial' },
        { regla: 'antiguedad_minima_dias', ok: true, aplica: (reglas?.antiguedad_minima_dias ?? 0) > 0, valor: null, limite: reglas?.antiguedad_minima_dias ?? 0, origen: 'general', detalle: (reglas?.antiguedad_minima_dias ?? 0) > 0 ? 'Cumple la antigüedad mínima' : 'No se exige antigüedad mínima' },
        { regla: 'cumplimiento_minimo_pct', ok: true, aplica: (reglas?.cumplimiento_minimo_pct ?? null) !== null, valor: null, limite: reglas?.cumplimiento_minimo_pct ?? null, origen: 'general', detalle: 'No se exige cumplimiento mínimo' },
        { regla: 'bloqueo_tras_incumplida_dias', ok: true, aplica: false, valor: null, limite: reglas?.bloqueo_tras_incumplida_dias ?? 0, origen: 'general', detalle: 'No tiene promesas incumplidas' },
        { regla: 'max_por_periodo', ok: enPeriodo < maximo, aplica: true, valor: enPeriodo, limite: maximo, origen: origen(delCanal?.max_por_periodo), detalle: `Lleva ${plural(enPeriodo, 'promesa', 'promesas')} en el periodo (máximo ${maximo})` },
    ]
    if (delCanal?.requiere_aprobacion) {
        lista.push({ regla: 'requiere_aprobacion', ok: true, aplica: true, valor: canal, limite: true, origen: canal, detalle: `Las promesas del canal ${canal} requieren aprobación de un supervisor` })
    }
    const falla = lista.find(r => r.aplica && !r.ok)
    const pendienteAprobacion = !falla && delCanal?.requiere_aprobacion
    const resultado: Simulacion['resultado'] = falla ? 'rechazada' : pendienteAprobacion ? 'pendiente_aprobacion' : 'aprobada'
    const regla = falla?.regla ?? (pendienteAprobacion ? 'requiere_aprobacion' : null)
    const motivo = falla?.detalle ?? (pendienteAprobacion ? `Las promesas del canal ${canal} requieren aprobación de un supervisor` : 'Cumple todas las reglas de promesa de la plantilla')
    const abierta = bd.promesas.find(p => p.servicio_id === servicio.id && (p.estado === 'activa' || p.estado === 'pendiente_aprobacion'))
    // Desde el 29 oct no hay validaciones de `monto` (nadie lo escribe).
    const validaciones: Simulacion['validaciones'] = [
        { campo: 'vence_en', ok: vence.getTime() > Date.now(), regla: 'futuro', detalle: vence.getTime() > Date.now() ? `Vence el ${dia} (en ${dias} días)` : 'La promesa debe vencer en el futuro' },
        { campo: 'servicio_id', ok: !abierta, regla: 'promesa_abierta', detalle: abierta ? `Ya tiene la promesa ${abierta.id} ${abierta.estado === 'activa' ? 'activa' : 'pendiente de aprobación'}` : 'No tiene otra promesa activa o pendiente' },
    ]
    // Como `limitesDe`: el plazo del canal y, si la plantilla lo pide, antes de la siguiente facturación.
    let fechaMaxima = new Date(Date.parse(hoy) + plazoMax * DIA_MS).toISOString().slice(0, 10)
    if (reglas?.no_exceder_siguiente_facturacion) {
        const antes = new Date(Date.parse(siguiente) - DIA_MS).toISOString().slice(0, 10)
        if (antes < fechaMaxima) {
            fechaMaxima = antes
        }
    }
    return {
        servicio_id: servicio.id,
        cliente_id: servicio.cliente_id,
        canal,
        vence_en: vence.toISOString(),
        monto: cobertura.monto.toFixed(2),
        facturas: cobertura.facturas,
        evaluada_en: new Date().toISOString(),
        resultado,
        regla,
        motivo,
        resultado_creacion: validaciones.every(v => v.ok) ? resultado : 'error',
        reglas: lista,
        validaciones,
        deuda: { pendiente: pendiente.toFixed(2), vencida: vencida.toFixed(2), pagado_pendientes: pagadoPendientes.toFixed(2), facturas_vencidas: vencidas.filter(f => (f.tipo ?? 'servicio') === 'servicio').length },
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
            abono_requerido: requerido.toFixed(2),
            abono_pagado: abonado.toFixed(2),
            max_por_periodo: maximo,
            en_periodo: enPeriodo,
            monto_promesa: cobertura.monto.toFixed(2),
            facturas: cobertura.facturas,
        },
        suspension_manual: servicio.suspension_manual ?? false,
    }
}

type EvaluacionPromesa = Schema<'EvaluacionPromesa'>
type ReglaEvaluada = Schema<'ReglaEvaluada'>
const NOMBRES_REGLA: readonly ReglaEvaluada['regla'][] = ['habilitadas', 'canal_permitido', 'sin_deuda', 'plazo_max_dias', 'no_exceder_siguiente_facturacion', 'deuda_maxima', 'abono_inicial_pct', 'antiguedad_minima_dias', 'cumplimiento_minimo_pct', 'bloqueo_tras_incumplida_dias', 'max_por_periodo', 'requiere_aprobacion']

function nombreRegla(regla: string): ReglaEvaluada['regla'] {
    const nombre = NOMBRES_REGLA.find(n => n === regla)
    if (!nombre) {
        throw new Error(`Fixture: regla desconocida ${regla}`)
    }
    return nombre
}

const ORIGENES: readonly ReglaEvaluada['origen'][] = ['general', 'portal', 'ia', 'operador', 'supervisor']

function origenRegla(origen: string): ReglaEvaluada['origen'] {
    return ORIGENES.find(o => o === origen) ?? 'general'
}

/**
 * `resultado_evaluacion` de `POST /promesas` como `evaluarPromesa` de A3 (`Schema<'EvaluacionPromesa'>`):
 * la misma evaluación que el simulador, pero solo las reglas que aplican y hasta la que decidió.
 */
export function evaluarPromesa(servicio: Schema<'Servicio'>, canal: Canal, vence: Date): EvaluacionPromesa {
    const simulacion = simularPromesa(servicio, canal, vence)
    const aplicadas = simulacion.reglas.filter(r => r.aplica)
    const falla = aplicadas.findIndex(r => !r.ok)
    const reglas: ReglaEvaluada[] = (falla >= 0 ? aplicadas.slice(0, falla + 1) : aplicadas)
        .map(r => ({ regla: nombreRegla(r.regla), ok: r.ok, valor: r.valor, limite: r.limite, origen: origenRegla(r.origen), detalle: r.detalle }))
    return {
        resultado: simulacion.resultado,
        regla: simulacion.regla === null ? null : nombreRegla(simulacion.regla),
        motivo: simulacion.motivo,
        canal,
        evaluada_en: simulacion.evaluada_en,
        reglas,
        deuda: simulacion.deuda,
        historial: simulacion.historial,
        siguiente_facturacion: simulacion.siguiente_facturacion,
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
        // `monto` es obsoleto (se ignora), pero el validador aún revisa su forma.
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
        return { status: 200, cuerpo: simularPromesa(servicio, canal, vence ?? manana) }
    }),
}
