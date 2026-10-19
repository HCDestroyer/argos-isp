import type { QueryClientContract } from '@adonisjs/lucid/types/database'
import { otorgamientoVigente, saldoPuntos } from '#lealtad/puntos'
import { fechaCalendario, fechaCorta } from '#notify/formato'

/**
 * Avisos al cliente del programa de lealtad (`contratos/lealtad.md` §13 y §16, fase 1). Qué evento
 * avisa y cuál no, con el motivo, está en `app/notify/README.md` ("Avisos de lealtad").
 *
 * - `lealtad.puntos_acumulados`: al cliente que ganó el lote. El crédito del referidor por un
 *   referido (`referido:<id>`) no se avisa aquí: lo cubre `lealtad.referido_calificado`, que ya
 *   dice cuántos puntos ganó (un solo aviso por referido). El bono del referido sí se avisa.
 * - `lealtad.puntos_por_vencer`: al dueño del lote, una vez por lote (A3 emite una vez por lote).
 * - `lealtad.referido_calificado`: al **referidor** (`referidor_id`), no al referido (`cliente_id`).
 */
export const EVENTOS_LEALTAD_CLIENTE = [
    'lealtad.puntos_acumulados',
    'lealtad.puntos_por_vencer',
    'lealtad.referido_calificado',
] as const

type Payload = Record<string, unknown>

function entero(valor: unknown): number | null {
    if (typeof valor === 'number' && Number.isInteger(valor) && valor > 0) return valor
    if (typeof valor === 'string' && /^\d+$/.test(valor)) return Number(valor)
    return null
}

/** Clave del crédito del referidor (`referido:<id>`, o `#2`… si se volvió a ganar); no el bono. */
const CLAVE_REFERIDOR = /^referido:\d+(#\d+)?$/

/**
 * Payload con el que se arma el aviso. `lealtad.referido_calificado` va al referidor: su
 * `cliente_id` pasa a ser `referidor_id` y el referido queda en `referido_cliente_id`.
 */
export function payloadDelAviso(evento: string, payload: Payload): Payload {
    if (evento !== 'lealtad.referido_calificado') return payload
    const referidor = entero(payload.referidor_id)
    if (!referidor) return payload
    return { ...payload, cliente_id: referidor, referido_cliente_id: payload.cliente_id ?? null }
}

/** `true` si otro aviso ya cubre este evento y no se debe programar (ver arriba). */
export async function avisoCubierto(
    cliente: QueryClientContract,
    evento: string,
    payload: Payload,
): Promise<boolean> {
    if (evento !== 'lealtad.puntos_acumulados') return false
    const movimientoId = entero(payload.movimiento_id)
    if (!movimientoId) return false
    const fila = (await cliente
        .from('lealtad.movimientos')
        .where('id', movimientoId)
        .select('clave_unica', 'origen_tipo')
        .first()) as { clave_unica: string; origen_tipo: string } | null
    return fila !== null && fila.origen_tipo === 'referido' && CLAVE_REFERIDOR.test(fila.clave_unica)
}

/** "1 punto", "1,250 puntos" */
export function textoPuntos(puntos: number): string {
    const conComas = String(Math.abs(puntos)).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
    return `${puntos < 0 ? '-' : ''}${conComas} ${Math.abs(puntos) === 1 ? 'punto' : 'puntos'}`
}

async function nombrePrograma(cliente: QueryClientContract, empresaId: number): Promise<string> {
    const fila = (await cliente
        .from('lealtad.programas')
        .where('empresa_id', empresaId)
        .orderBy('activo', 'desc')
        .orderBy('id', 'desc')
        .select('nombre')
        .first()) as { nombre: string } | null
    return fila?.nombre ?? ''
}

/**
 * `{{lealtad.*}}` y, en `lealtad.referido_calificado`, `{{referido.*}}`. Los puntos son enteros;
 * el saldo es el del destinatario en la empresa del evento al programar el aviso.
 */
export async function variablesLealtad(
    cliente: QueryClientContract,
    evento: string,
    payload: Payload,
    clienteId: number,
): Promise<Record<string, unknown>> {
    const empresaId = entero(payload.empresa_id)
    const salida: Record<string, unknown> = {}
    let puntos = typeof payload.puntos === 'number' ? payload.puntos : 0

    if (evento === 'lealtad.referido_calificado') {
        const referidoId = entero(payload.referido_id)
        const referidoCliente = entero(payload.referido_cliente_id)
        // Lo que ganó el referidor (0 si llegó a su tope de referidos o la regla da 0 puntos)
        const otorgado =
            referidoId && empresaId
                ? await otorgamientoVigente(cliente, empresaId, `referido:${referidoId}`)
                : null
        const vigente = otorgado?.vigente ?? null
        puntos = vigente?.cliente_id === clienteId ? vigente.puntos : 0
        const fila = referidoCliente
            ? ((await cliente
                  .from('core.clientes')
                  .where('id', referidoCliente)
                  .select('nombre')
                  .first()) as {
                  nombre: string
              } | null)
            : null
        salida.referido = {
            id: referidoId,
            cliente_id: referidoCliente,
            nombre: fila?.nombre ?? '',
            puntos,
            puntos_texto: puntos > 0 ? textoPuntos(puntos) : '',
        }
    }

    const vence = typeof payload.vence_en === 'string' ? payload.vence_en : null
    const saldo = empresaId ? await saldoPuntos(cliente, empresaId, clienteId) : 0
    salida.lealtad = {
        programa: empresaId ? await nombrePrograma(cliente, empresaId) : '',
        puntos,
        puntos_texto: textoPuntos(puntos),
        vence: vence ? fechaCorta(fechaCalendario(vence)) : '',
        vence_iso: vence ?? '',
        saldo,
        saldo_texto: textoPuntos(saldo),
    }
    return salida
}
