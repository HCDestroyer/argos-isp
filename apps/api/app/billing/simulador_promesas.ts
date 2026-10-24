import { DateTime } from 'luxon'
import db from '@adonisjs/lucid/services/db'
import type { QueryClientContract } from '@adonisjs/lucid/types/database'
import { ReglaNegocio } from '#shared/errores'
import { aTexto, dec } from '#ledger/dinero'
import { ZONA_NEGOCIO, hoyGuatemala } from '#ledger/fechas'
import { configuracionDeServicio, leerServicio } from '#billing/configuracion'
import {
    datosEvaluacion,
    evaluarReglas,
    type DatosEvaluacion,
    type ResultadoEvaluacion,
} from '#billing/promesas'
import {
    normalizarReglasPromesa,
    type CanalPromesa,
    type ReglasPromesaParciales,
} from '#billing/reglas_promesa'
import { diasEntre } from '#billing/periodos'

/**
 * Simulador de promesas (`POST /promesas/simular`, A3 + A4) y límites de una promesa (A5,
 * `/corte`). Solo lectura: no crea promesas, no audita, no cambia el servicio.
 *
 * Usa la MISMA evaluación que `crearPromesaPago` (`datosEvaluacion` + `evaluarReglas`), pero
 * completa: revisa todas las reglas (no se detiene en la primera que falla) y marca con
 * `aplica: false` las que la configuración no exige. `resultado` y `regla` son exactamente los
 * que daría crear la promesa con los mismos datos; `validaciones` son los errores que crear
 * respondería antes de evaluar (monto, vencimiento, promesa abierta).
 */

export interface EntradaSimulacion {
    servicio_id: number
    canal: CanalPromesa
    /** por defecto: el fin de mañana en Guatemala */
    vence_en?: Date
    /** por defecto: la deuda pendiente del servicio */
    monto?: string
    /** instante de referencia (simular otro día); por defecto ahora */
    ahora?: Date
    /**
     * Reglas a probar sin guardarlas (simulador dentro de la plantilla, pedido de A4): se aplican sobre
     * las efectivas del servicio (plantilla + excepciones); las claves que falten quedan como están.
     */
    reglas_promesa?: ReglasPromesaParciales | null
}

export interface Validacion {
    campo: 'monto' | 'vence_en' | 'servicio_id'
    ok: boolean
    regla: string
    detalle: string
}

export interface LimitesPromesa {
    habilitadas: boolean
    permitido: boolean
    requiere_aprobacion: boolean
    plazo_max_dias: number
    /** último día (Guatemala) en que puede vencer: plazo máximo y, si aplica, antes de la siguiente facturación */
    fecha_maxima: string
    siguiente_facturacion: string | null
    deuda_pendiente: string
    deuda_vencida: string
    deuda_maxima: string | null
    abono_requerido: string
    abono_pagado: string
    max_por_periodo: number
    en_periodo: number
}

export interface Simulacion extends ResultadoEvaluacion {
    servicio_id: number
    cliente_id: number
    vence_en: string
    monto: string
    /** lo que respondería crear la promesa: el resultado de las reglas o `error` (ver validaciones) */
    resultado_creacion: ResultadoEvaluacion['resultado'] | 'error'
    validaciones: Validacion[]
    limites: LimitesPromesa
    suspension_manual: boolean
}

/** Fin del día siguiente en Guatemala. */
function mananaFinDelDia(ahora: Date): Date {
    return DateTime.fromJSDate(ahora).setZone(ZONA_NEGOCIO).plus({ days: 1 }).endOf('day').toJSDate()
}

export function limitesDe(datos: DatosEvaluacion): LimitesPromesa {
    const { reglas, canal } = datos
    const delCanal = reglas.canales[canal]
    const plazo = delCanal.plazo_max_dias ?? reglas.plazo_max_dias
    const hoy = hoyGuatemala(datos.ahora)
    let fechaMaxima = DateTime.fromISO(hoy, { zone: 'utc' }).plus({ days: plazo }).toISODate()!
    if (reglas.no_exceder_siguiente_facturacion && datos.siguiente_facturacion) {
        const antes = DateTime.fromISO(datos.siguiente_facturacion, { zone: 'utc' })
            .minus({ days: 1 })
            .toISODate()!
        if (antes < fechaMaxima) fechaMaxima = antes
    }
    const historial = evaluarReglas(datos).historial
    const buen =
        historial.cumplimiento_pct !== null && historial.cumplimiento_pct >= reglas.buen_historial_pct
    const deudaMaxima = delCanal.deuda_maxima ?? reglas.deuda_maxima
    return {
        habilitadas: reglas.habilitadas,
        permitido: delCanal.permitido,
        requiere_aprobacion: delCanal.requiere_aprobacion,
        plazo_max_dias: plazo,
        fecha_maxima: fechaMaxima,
        siguiente_facturacion: datos.siguiente_facturacion,
        deuda_pendiente: aTexto(datos.deuda.pendiente),
        deuda_vencida: aTexto(datos.deuda.vencida),
        deuda_maxima: deudaMaxima === null ? null : aTexto(deudaMaxima),
        abono_requerido: aTexto(datos.deuda.total_pendientes.times(reglas.abono_inicial_pct).div(100)),
        abono_pagado: aTexto(datos.deuda.pagado_pendientes),
        max_por_periodo:
            delCanal.max_por_periodo ??
            (buen ? reglas.max_por_periodo_buen_historial : reglas.max_por_periodo),
        en_periodo: datos.en_periodo,
    }
}

export async function simularPromesa(
    entrada: EntradaSimulacion,
    cliente: QueryClientContract = db.connection(),
): Promise<Simulacion> {
    const ahora = entrada.ahora ?? new Date()
    const venceEn = entrada.vence_en ?? mananaFinDelDia(ahora)
    const servicio = await leerServicio(cliente, entrada.servicio_id)
    if (servicio.estado === 'retirado') {
        throw new ReglaNegocio('El servicio está retirado', 'servicio_retirado')
    }
    const efectiva = await configuracionDeServicio(cliente, servicio)
    if (!efectiva) throw new ReglaNegocio('El servicio no tiene plantilla de facturación', 'sin_plantilla')
    const config = entrada.reglas_promesa
        ? {
              ...efectiva,
              reglas_promesa: normalizarReglasPromesa(entrada.reglas_promesa, efectiva.reglas_promesa),
          }
        : efectiva

    const datos = await datosEvaluacion(cliente, servicio, config, {
        canal: entrada.canal,
        vence_en: venceEn,
        ahora,
    })
    const evaluacion = evaluarReglas(datos, { completo: true })
    const monto = entrada.monto ? dec(entrada.monto) : datos.deuda.pendiente

    const validaciones: Validacion[] = []
    const montoOk = monto.gt(0) && monto.decimalPlaces() <= 2
    validaciones.push({
        campo: 'monto',
        ok: montoOk,
        regla: 'monto',
        detalle: montoOk ? `Monto Q${aTexto(monto)}` : 'El monto debe ser mayor que 0 con hasta 2 decimales',
    })
    if (montoOk && datos.deuda.pendiente.gt(0)) {
        const ok = monto.lte(datos.deuda.pendiente)
        validaciones.push({
            campo: 'monto',
            ok,
            regla: 'monto_maximo',
            detalle: ok
                ? `No supera la deuda pendiente (Q${aTexto(datos.deuda.pendiente)})`
                : `El monto supera la deuda pendiente del servicio (Q${aTexto(datos.deuda.pendiente)})`,
        })
    }
    const futura = venceEn > ahora
    validaciones.push({
        campo: 'vence_en',
        ok: futura,
        regla: 'futuro',
        detalle: futura
            ? `Vence el ${hoyGuatemala(venceEn)} (en ${diasEntre(hoyGuatemala(ahora), hoyGuatemala(venceEn))} días)`
            : 'La promesa debe vencer en el futuro',
    })
    const abierta = await cliente
        .from('billing.promesas')
        .where('servicio_id', servicio.id)
        .whereIn('estado', ['activa', 'pendiente_aprobacion'])
        .select('id', 'estado')
        .first()
    validaciones.push({
        campo: 'servicio_id',
        ok: !abierta,
        regla: 'promesa_abierta',
        detalle: abierta
            ? `Ya tiene la promesa ${abierta.id} ${abierta.estado === 'activa' ? 'activa' : 'pendiente de aprobación'}`
            : 'No tiene otra promesa activa o pendiente',
    })

    return {
        ...evaluacion,
        servicio_id: servicio.id,
        cliente_id: servicio.cliente_id,
        vence_en: venceEn.toISOString(),
        monto: aTexto(monto),
        resultado_creacion: validaciones.every((v) => v.ok) ? evaluacion.resultado : 'error',
        validaciones,
        limites: limitesDe(datos),
        suspension_manual: servicio.suspension_manual,
    }
}

/**
 * Para el portal (A5): límites de una promesa del servicio por el canal, sin evaluar una fecha
 * ni un monto concretos. Misma fuente que `crearPromesaPago`.
 */
export async function limitesPromesa(
    servicioId: number,
    canal: CanalPromesa,
    ahora: Date = new Date(),
    cliente: QueryClientContract = db.connection(),
): Promise<LimitesPromesa> {
    const servicio = await leerServicio(cliente, servicioId)
    const config = await configuracionDeServicio(cliente, servicio)
    if (!config) throw new ReglaNegocio('El servicio no tiene plantilla de facturación', 'sin_plantilla')
    const datos = await datosEvaluacion(cliente, servicio, config, {
        canal,
        vence_en: mananaFinDelDia(ahora),
        ahora,
    })
    return limitesDe(datos)
}
