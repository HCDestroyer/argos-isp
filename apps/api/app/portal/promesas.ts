import { DateTime } from 'luxon'
import type { HttpContext } from '@adonisjs/core/http'
import db from '@adonisjs/lucid/services/db'
import { Conflicto, NoEncontrado, Problema, ReglaNegocio } from '#shared/errores'
import { CERO, aTexto, dec } from '#ledger/dinero'
import { ZONA_NEGOCIO, hoyGuatemala } from '#ledger/fechas'
import { configuracionDeServicio, leerServicio } from '#billing/configuracion'
import type { ReglaEvaluada, ResultadoEvaluacion } from '#billing/promesas'
import { limitesPromesa, type LimitesPromesa } from '#billing/simulador_promesas'
import type { ResultadoCrearPromesa } from '#billing/actions/crear_promesa_pago'
import { resolverServicio, type EstadoServicio } from '#portal/consultas'
import { exigirSesionPortal } from '#portal/acceso/sesion'

/**
 * Promesas de pago desde el portal (tarea 4). El portal **no evalúa** promesas: la decisión es
 * siempre de `CrearPromesaPago` (A3) con canal `portal`. Aquí solo vive:
 *
 * - `servicioDeLaPeticion`: qué servicio pide la promesa (IP de origen o sesión del portal).
 * - `condicionesPromesa`: los límites que se muestran **antes** de enviar (plazo y fecha máximos,
 *   monto máximo, abono inicial, deuda máxima, cupo), de `limitesPromesa()` de A3: la misma
 *   evaluación que `CrearPromesaPago`, sin reglas copiadas aquí.
 * - `promesaParaCliente`: la respuesta sin datos internos, con el motivo en palabras del cliente
 *   (nunca el código de la regla).
 */

/**
 * Servicio de la promesa. Con `servicioId` exige la sesión del portal y que el servicio sea del
 * cliente de la sesión (404 si no). Sin `servicioId`, identifica por la IP de origen (como
 * `quien-soy`); si la IP no corresponde a ningún servicio, 422 `no_identificado`.
 */
export async function servicioDeLaPeticion(
    ctx: HttpContext,
    ip: string,
    servicioId: number | undefined,
): Promise<number> {
    if (servicioId !== undefined) {
        const sesion = await exigirSesionPortal(ctx)
        const fila = await db
            .from('core.servicios')
            .where('id', servicioId)
            .where('cliente_id', sesion.clienteId)
            .select('id')
            .first()
        if (!fila) throw new NoEncontrado('Ese servicio no es de tu cuenta')
        return Number(fila.id)
    }
    const porIp = await resolverServicio(db.connection(), ip)
    if (!porIp) throw new NoIdentificado()
    return porIp
}

export class NoIdentificado extends ReglaNegocio {
    constructor() {
        super(
            'No pudimos identificar tu servicio desde esta conexión. Entra con tu código o comunícate con nosotros.',
            'no_identificado',
        )
    }
}

/** Fecha calendario de Guatemala → instante de vencimiento: las 23:59:59 de ese día. */
export function venceAlFinalDelDia(fecha: string): Date {
    return DateTime.fromISO(fecha, { zone: ZONA_NEGOCIO }).endOf('day').set({ millisecond: 0 }).toJSDate()
}

/*
|--------------------------------------------------------------------------
| Condiciones antes de enviar
|--------------------------------------------------------------------------
*/

/** Espejo del schema `PortalCondicionesPromesa` (`app/portal/esquemas.ts`). */
export interface CondicionesPromesa {
    disponible: boolean
    motivo: string | null
    promesa_abierta: { estado: 'activa' | 'pendiente_aprobacion'; vence_en: Date; monto: string } | null
    fecha_minima: string | null
    fecha_maxima: string | null
    plazo_max_dias: number | null
    monto_maximo: string | null
    monto_sugerido: string | null
    abono_inicial: { porcentaje: number; requerido: string; abonado: string; faltante: string } | null
    deuda_maxima: { maximo: string; vencida: string; faltante: string } | null
    pago_previo: string | null
    requiere_aprobacion: boolean
}

const NO_DISPONIBLE = (motivo: string, extra: Partial<CondicionesPromesa> = {}): CondicionesPromesa => ({
    disponible: false,
    motivo,
    promesa_abierta: null,
    fecha_minima: null,
    fecha_maxima: null,
    plazo_max_dias: null,
    monto_maximo: null,
    monto_sugerido: null,
    abono_inicial: null,
    deuda_maxima: null,
    pago_previo: null,
    requiere_aprobacion: false,
    ...extra,
})

const CONTACTANOS = 'Comunícate con nosotros para acordar una fecha de pago.'

/**
 * Límites que aplican a una promesa del canal `portal` para el servicio, hoy. Solo lectura y sin
 * reglas propias: salen de `limitesPromesa()` de A3 (la misma evaluación que `CrearPromesaPago`).
 * Aquí solo se traducen al cliente:
 *
 * - plazo y fecha máxima (con `no_exceder_siguiente_facturacion`), monto máximo = deuda pendiente;
 * - `abono_inicial` y `deuda_maxima`, y `pago_previo`: lo que debe pagar antes de que la promesa
 *   pueda aprobarse (el mayor de los dos faltantes). El portal no deja enviar mientras sea > 0;
 * - cupo del periodo agotado o canal cerrado: no disponible, con el motivo.
 *
 * Las reglas de historial (cumplimiento, bloqueo tras incumplida, antigüedad) no se adelantan:
 * las dice el resultado de `CrearPromesaPago`.
 */
export async function condicionesPromesa(
    servicioId: number,
    ahora = new Date(),
): Promise<CondicionesPromesa> {
    const cliente = db.connection()
    const servicio = await leerServicio(cliente, servicioId)
    if (servicio.estado === 'retirado') {
        return NO_DISPONIBLE('Tu servicio está dado de baja.')
    }

    const abierta = (await cliente
        .from('billing.promesas')
        .where('servicio_id', servicioId)
        .whereIn('estado', ['activa', 'pendiente_aprobacion'])
        .orderBy('id', 'desc')
        .select('estado', 'vence_en', 'monto')
        .first()) as CondicionesPromesa['promesa_abierta']
    if (abierta) {
        return NO_DISPONIBLE(
            abierta.estado === 'activa'
                ? 'Ya tienes una promesa de pago activa.'
                : 'Ya tienes una promesa de pago esperando aprobación.',
            { promesa_abierta: { estado: abierta.estado, vence_en: abierta.vence_en, monto: abierta.monto } },
        )
    }

    let limites: LimitesPromesa
    try {
        limites = await limitesPromesa(servicioId, 'portal', ahora, cliente)
    } catch (error) {
        if (error instanceof Problema && error.code === 'E_SIN_PLANTILLA') {
            return NO_DISPONIBLE(`No podemos registrar promesas para tu servicio desde aquí. ${CONTACTANOS}`)
        }
        throw error
    }

    if (!limites.habilitadas || !limites.permitido) {
        return NO_DISPONIBLE(`Las promesas de pago no están disponibles desde esta página. ${CONTACTANOS}`)
    }
    const pendiente = dec(limites.deuda_pendiente)
    if (pendiente.lte(0)) {
        return NO_DISPONIBLE('No tienes saldo pendiente: no necesitas una promesa de pago.')
    }
    if (limites.en_periodo >= limites.max_por_periodo) {
        return NO_DISPONIBLE(`Ya usaste las promesas de pago disponibles para este periodo. ${CONTACTANOS}`)
    }

    const hoy = hoyGuatemala(ahora)
    const fechaMaxima = limites.fecha_maxima < hoy ? hoy : limites.fecha_maxima

    const config = await configuracionDeServicio(cliente, servicio)
    const porcentaje = config?.reglas_promesa.abono_inicial_pct ?? 0
    const requerido = dec(limites.abono_requerido)
    const abonado = dec(limites.abono_pagado)
    const faltaAbono = requerido.minus(abonado)
    const abono: CondicionesPromesa['abono_inicial'] =
        porcentaje > 0
            ? {
                  porcentaje,
                  requerido: aTexto(requerido),
                  abonado: aTexto(abonado),
                  faltante: aTexto(faltaAbono.gt(0) ? faltaAbono : CERO),
              }
            : null

    const vencida = dec(limites.deuda_vencida)
    let deudaMaxima: CondicionesPromesa['deuda_maxima'] = null
    if (limites.deuda_maxima !== null) {
        const exceso = vencida.minus(dec(limites.deuda_maxima))
        deudaMaxima = {
            maximo: aTexto(dec(limites.deuda_maxima)),
            vencida: aTexto(vencida),
            faltante: aTexto(exceso.gt(0) ? exceso : CERO),
        }
    }
    const faltantes = [abono?.faltante, deudaMaxima?.faltante].filter((f): f is string => f !== undefined)
    const previo = faltantes.map(dec).reduce((mayor, f) => (f.gt(mayor) ? f : mayor), CERO)

    return {
        disponible: true,
        motivo: null,
        promesa_abierta: null,
        fecha_minima: hoy,
        fecha_maxima: fechaMaxima,
        plazo_max_dias: limites.plazo_max_dias,
        monto_maximo: aTexto(pendiente),
        monto_sugerido: aTexto(vencida.gt(0) ? vencida : pendiente),
        abono_inicial: abono,
        deuda_maxima: deudaMaxima,
        pago_previo: previo.gt(0) ? aTexto(previo) : null,
        requiere_aprobacion: limites.requiere_aprobacion,
    }
}

/*
|--------------------------------------------------------------------------
| Resultado para el cliente
|--------------------------------------------------------------------------
*/

/** Espejo del schema `PortalPromesaSolicitada` (`app/portal/esquemas.ts`). */
export interface PromesaSolicitada {
    id: number
    resultado: ResultadoEvaluacion['resultado']
    vence_en: Date
    monto: string
    motivo: string
    /** rechazada por una regla que se cumple cambiando la fecha (ofrecer "Cambiar fecha o monto") */
    corregible: boolean
    /** estado del servicio tras la promesa (solo si quedó aprobada) */
    servicio_estado: EstadoServicio | null
}

/**
 * Reglas de la evaluación que el cliente puede cumplir cambiando la fecha o el monto de la misma
 * solicitud. El resto (cupo del periodo, historial, antigüedad, deuda máxima, abono, canal) no
 * cambia con otra fecha u otro monto: el portal ofrece el contacto en lugar de "Cambiar".
 * El monto mayor que la deuda no llega aquí: es un 422 del formulario.
 */
const REGLAS_CORREGIBLES = new Set(['plazo_max_dias', 'no_exceder_siguiente_facturacion'])

export function esCorregible(evaluacion: ResultadoEvaluacion): boolean {
    return evaluacion.resultado === 'rechazada' && REGLAS_CORREGIBLES.has(evaluacion.regla ?? '')
}

const MESES = [
    'enero',
    'febrero',
    'marzo',
    'abril',
    'mayo',
    'junio',
    'julio',
    'agosto',
    'septiembre',
    'octubre',
    'noviembre',
    'diciembre',
]

/** `2026-11-01` → `1 de noviembre`. */
export function fechaLegible(fecha: string): string {
    const partes = /^(\d{4})-(\d{2})-(\d{2})/.exec(fecha)
    if (!partes) return fecha
    return `${Number(partes[3])} de ${MESES[Number(partes[2]) - 1]}`
}

const quetzales = (valor: unknown) => `Q${aTexto(dec(String(valor ?? '0')))}`

/**
 * Regla que decidió el resultado: la evaluación de A3 se detiene en la primera que falla (o en
 * `requiere_aprobacion`), así que es la **última** de `reglas` y su `limite` es el que se aplicó
 * (contrato de A3). Si no coincide con `regla` (evaluación completa del simulador), se busca por nombre.
 */
export function reglaDecisiva(evaluacion: ResultadoEvaluacion): ReglaEvaluada | undefined {
    const ultima = evaluacion.reglas.at(-1)
    if (ultima && ultima.regla === evaluacion.regla) return ultima
    return evaluacion.reglas.find((r) => r.regla === evaluacion.regla)
}

const esNumero = (valor: unknown): valor is number => typeof valor === 'number' && Number.isFinite(valor)
const esMonto = (valor: unknown) => typeof valor === 'string' && /^\d+(\.\d+)?$/.test(valor)
const enMinuscula = (texto: string) => `${texto.charAt(0).toLowerCase()}${texto.slice(1)}`

/**
 * Motivo en palabras del cliente a partir de `resultado_evaluacion`: la regla y su `limite`
 * (`reglaDecisiva`). Sin límite, el texto general de la regla. Si la regla es desconocida, el
 * `motivo` de A3 (ya es texto legible, nunca el código).
 */
export function motivoParaCliente(evaluacion: ResultadoEvaluacion): string {
    if (evaluacion.resultado === 'aprobada') return 'Tu promesa de pago fue aprobada.'
    const regla = reglaDecisiva(evaluacion)
    const limite = regla?.limite
    switch (evaluacion.regla) {
        case 'requiere_aprobacion':
            return 'Un asesor revisará tu solicitud y te avisaremos cuando quede aprobada.'
        case 'habilitadas':
        case 'canal_permitido':
            return `Las promesas de pago no están disponibles desde esta página. ${CONTACTANOS}`
        case 'sin_deuda':
            return 'No tienes saldo pendiente: no necesitas una promesa de pago.'
        case 'plazo_max_dias':
            if (limite === 0) return 'La fecha de pago debe ser hoy.'
            if (limite === 1) return 'La fecha de pago debe ser hoy o mañana.'
            return esNumero(limite)
                ? `La fecha de pago debe estar dentro de los próximos ${limite} días.`
                : 'La fecha de pago está demasiado lejos.'
        case 'no_exceder_siguiente_facturacion':
            return typeof limite === 'string'
                ? `La fecha de pago debe ser antes del ${fechaLegible(limite)}, cuando se emite tu próxima factura.`
                : 'La fecha de pago debe ser antes de tu próxima factura.'
        case 'deuda_maxima':
            return esMonto(limite)
                ? `Para pedir una promesa de pago tu saldo vencido debe ser de ${quetzales(limite)} o menos` +
                      `${esMonto(regla?.valor) ? ` (hoy es ${quetzales(regla?.valor)})` : ''}. Abona la diferencia o ${enMinuscula(CONTACTANOS)}`
                : `Tu saldo vencido es mayor que el permitido para una promesa de pago. Abona una parte o ${enMinuscula(CONTACTANOS)}`
        case 'abono_inicial_pct':
            return `Antes de solicitar la promesa debes abonar ${quetzales(limite)} (llevas ${quetzales(regla?.valor)}).`
        case 'antiguedad_minima_dias':
            return esNumero(limite)
                ? `Las promesas de pago están disponibles cuando tu servicio cumple ${limite} días. ${CONTACTANOS}`
                : `Tu servicio aún es muy reciente para una promesa de pago. ${CONTACTANOS}`
        case 'cumplimiento_minimo_pct':
            return esNumero(limite)
                ? `Para pedir una promesa desde aquí necesitas haber cumplido al menos el ${limite}% de tus promesas anteriores. ${CONTACTANOS}`
                : `Por tu historial de promesas no podemos aprobar una nueva desde aquí. ${CONTACTANOS}`
        case 'bloqueo_tras_incumplida_dias': {
            const desde = /desde el (\d{4}-\d{2}-\d{2})/.exec(regla?.detalle ?? '')?.[1]
            if (desde) {
                return `Tuviste una promesa sin cumplir hace poco. Podrás solicitar otra a partir del ${fechaLegible(desde)}.`
            }
            return esNumero(limite)
                ? `Tuviste una promesa sin cumplir hace poco. Podrás solicitar otra ${limite} días después de esa fecha. ${CONTACTANOS}`
                : `Tuviste una promesa sin cumplir hace poco. ${CONTACTANOS}`
        }
        case 'max_por_periodo':
            if (limite === 1) {
                return `Ya usaste la promesa de pago disponible para este periodo. ${CONTACTANOS}`
            }
            return esNumero(limite) && limite > 1
                ? `Ya usaste las ${limite} promesas de pago disponibles para este periodo. ${CONTACTANOS}`
                : `Ya usaste las promesas de pago disponibles para este periodo. ${CONTACTANOS}`
        default:
            return evaluacion.motivo
    }
}

/** Respuesta del portal: sin `cliente_id`, reglas ni historial. */
export function promesaParaCliente(promesa: ResultadoCrearPromesa): PromesaSolicitada {
    const evaluacion = promesa.resultado_evaluacion as ResultadoEvaluacion
    return {
        id: Number(promesa.id),
        resultado: evaluacion.resultado,
        vence_en: promesa.vence_en,
        monto: promesa.monto,
        motivo: motivoParaCliente(evaluacion),
        corregible: esCorregible(evaluacion),
        servicio_estado: promesa.servicio?.estado ?? null,
    }
}

/**
 * Errores de `CrearPromesaPago` en palabras del cliente: el 409 de A3 nombra ids internos y el 422
 * `sin_plantilla` habla de la configuración. El resto (422 de `monto`/`vence_en`) ya es legible.
 */
export function errorParaCliente(error: unknown): unknown {
    if (!(error instanceof Problema)) return error
    if (error.code === 'E_PROMESA_ABIERTA') {
        return new Conflicto('Ya tienes una promesa de pago en curso.', 'promesa_abierta', 'Promesa abierta')
    }
    if (error.code === 'E_SIN_PLANTILLA') {
        return new ReglaNegocio(
            `No podemos registrar promesas para tu servicio desde aquí. ${CONTACTANOS}`,
            'sin_plantilla',
        )
    }
    if (error.code === 'E_SERVICIO_RETIRADO') {
        return new ReglaNegocio('Tu servicio está dado de baja.', 'servicio_retirado')
    }
    return error
}
