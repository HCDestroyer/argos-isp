import { Decimal } from 'decimal.js'
import { DateTime } from 'luxon'
import type { QueryClientContract } from '@adonisjs/lucid/types/database'
import env from '#start/env'
import type { CanalNotificacion } from '#shared/eventos'
import {
    diasEntre,
    fechaCalendario,
    fechaCorta,
    fechaHora,
    isoFecha,
    mesAnio,
    monto,
    quetzales,
} from '#notify/formato'

/**
 * Arma las variables Mustache de una notificación a partir del evento y de la base de datos.
 * La lista completa de variables está en `app/notify/README.md`.
 */

type Payload = Record<string, unknown>
export type Variables = Record<string, unknown>

export interface Destinatario {
    clienteId: number
    nombre: string
    email: string | null
    canalPreferido: CanalNotificacion
    telegramChatId: string | null
}

function entero(valor: unknown): number | null {
    if (typeof valor === 'number' && Number.isInteger(valor) && valor > 0) return valor
    if (typeof valor === 'string' && /^\d+$/.test(valor)) return Number(valor)
    return null
}

function texto(valor: unknown): string | null {
    return typeof valor === 'string' ? valor : null
}

/**
 * Cliente al que va dirigido el evento: `cliente_id` del payload o, si no viene, el dueño del
 * servicio, del pago, de la promesa o del comprobante.
 */
export async function resolverCliente(
    cliente: QueryClientContract,
    payload: Payload,
): Promise<number | null> {
    const directo = entero(payload.cliente_id)
    if (directo) return directo

    const servicioId = entero(payload.servicio_id)
    if (servicioId) {
        const fila = await cliente.from('core.servicios').where('id', servicioId).select('cliente_id').first()
        if (fila) return fila.cliente_id as number
    }
    const pagoId = entero(payload.pago_id)
    if (pagoId) {
        const fila = await cliente.from('billing.pagos').where('id', pagoId).select('cliente_id').first()
        if (fila) return fila.cliente_id as number
    }
    const promesaId = entero(payload.promesa_id)
    if (promesaId) {
        const fila = await cliente
            .from('billing.promesas')
            .where('id', promesaId)
            .select('cliente_id')
            .first()
        if (fila) return fila.cliente_id as number
    }
    const comprobanteId = entero(payload.comprobante_id)
    if (comprobanteId) {
        const fila = await cliente
            .from('billing.comprobantes')
            .where('id', comprobanteId)
            .select('cliente_id')
            .first()
        if (fila) return fila.cliente_id as number
    }
    return null
}

export async function cargarDestinatario(
    cliente: QueryClientContract,
    clienteId: number,
): Promise<Destinatario | null> {
    const fila = await cliente
        .from('core.clientes')
        .where('id', clienteId)
        .select('id', 'nombre', 'email', 'canal_preferido', 'telegram_chat_id')
        .first()
    if (!fila) return null
    return {
        clienteId: fila.id,
        nombre: fila.nombre,
        email: fila.email || null,
        canalPreferido: fila.canal_preferido,
        telegramChatId: fila.telegram_chat_id || null,
    }
}

export function variablesEmpresa(): Variables {
    return {
        nombre: env.get('NOTIFY_EMPRESA_NOMBRE') ?? 'ArgosIsp',
        telefono: env.get('NOTIFY_EMPRESA_TELEFONO') ?? '',
        portal_url: env.get('NOTIFY_PORTAL_URL') ?? '',
    }
}

/** Variables de una factura: del payload, completadas con la fila de `billing.facturas` si existe. */
export async function variablesFactura(
    cliente: QueryClientContract,
    facturaId: number,
    payload: Payload,
    ahora: DateTime,
): Promise<Variables> {
    const fila = await cliente
        .from('billing.facturas')
        .where('id', facturaId)
        .select(
            'id',
            'total',
            'pagado',
            'estado',
            'fel_serie',
            'fel_numero',
            cliente.raw('periodo::text as periodo'),
            cliente.raw('vence_en::text as vence_en'),
        )
        .first()

    const total = new Decimal(fila?.total ?? texto(payload.total) ?? 0)
    const pagado = new Decimal(fila?.pagado ?? 0)
    const saldo = Decimal.max(total.minus(pagado), 0)
    const venceTexto = fila?.vence_en ?? texto(payload.vence)
    const vence = venceTexto ? fechaCalendario(venceTexto) : null
    const dias = vence ? diasEntre(ahora, vence) : null
    const periodo = fila?.periodo ? fechaCalendario(fila.periodo) : null

    return {
        id: facturaId,
        numero:
            fila?.fel_serie && fila?.fel_numero ? `${fila.fel_serie}-${fila.fel_numero}` : String(facturaId),
        estado: fila?.estado ?? null,
        total: monto(total),
        total_q: quetzales(total),
        saldo: monto(saldo),
        saldo_q: quetzales(saldo),
        vence: vence ? fechaCorta(vence) : '',
        vence_iso: vence ? isoFecha(vence) : '',
        periodo: periodo ? mesAnio(periodo) : '',
        dias_para_vencer: dias !== null ? Math.max(dias, 0) : null,
        dias_vencida: dias !== null ? Math.max(-dias, 0) : null,
        vence_hoy: dias === 0,
        vencida: dias !== null && dias < 0,
        vence_relativo: dias === null ? '' : venceRelativo(dias),
    }
}

/** "vence hoy", "vence mañana", "vence en 3 días", "venció ayer", "venció hace 5 días" */
export function venceRelativo(dias: number): string {
    if (dias === 0) return 'vence hoy'
    if (dias === 1) return 'vence mañana'
    if (dias > 1) return `vence en ${dias} días`
    if (dias === -1) return 'venció ayer'
    return `venció hace ${-dias} días`
}

async function variablesServicio(
    cliente: QueryClientContract,
    servicioId: number,
): Promise<Variables | null> {
    const fila = await cliente
        .from('core.servicios as s')
        .leftJoin('network.planes as p', 'p.id', 's.plan_id')
        .where('s.id', servicioId)
        .select('s.id', 's.user_ppp', 's.estado', 's.direccion', 'p.nombre as plan')
        .first()
    if (!fila) return null
    return {
        id: fila.id,
        usuario: fila.user_ppp,
        estado: fila.estado,
        direccion: fila.direccion ?? '',
        plan: fila.plan ?? '',
    }
}

function variablesEstado(payload: Payload): Variables {
    const a = texto(payload.a)
    return {
        de: texto(payload.de) ?? '',
        a: a ?? '',
        motivo: texto(payload.motivo) ?? '',
        es_activo: a === 'activo',
        es_limitado: a === 'limitado',
        es_suspendido: a === 'suspendido',
        es_retirado: a === 'retirado',
    }
}

async function variablesPagador(cliente: QueryClientContract, pagadorId: number): Promise<Variables> {
    const fila = await cliente.from('core.clientes').where('id', pagadorId).select('id', 'nombre').first()
    return { id: pagadorId, nombre: fila?.nombre ?? '' }
}

function numeroFactura(fila: { id: number; fel_serie: string | null; fel_numero: string | null }): string {
    return fila.fel_serie && fila.fel_numero ? `${fila.fel_serie}-${fila.fel_numero}` : String(fila.id)
}

/**
 * Lo que un pago aplicó a las facturas de un cliente (pago de terceros): `facturas_cliente`
 * (números separados por coma), `varias_facturas`, `monto_cliente` y `monto_cliente_q`.
 */
async function aplicadoAlCliente(
    cliente: QueryClientContract,
    pagoId: number,
    clienteId: number,
): Promise<Variables> {
    const filas = (await cliente
        .from('billing.pagos_aplicaciones as a')
        .join('billing.facturas as f', 'f.id', 'a.factura_id')
        .where('a.pago_id', pagoId)
        .where('f.cliente_id', clienteId)
        .orderBy('a.id', 'asc')
        .select('f.id', 'f.fel_serie', 'f.fel_numero', 'a.monto')) as Array<{
        id: number
        fel_serie: string | null
        fel_numero: string | null
        monto: string
    }>
    const numeros = [...new Set(filas.map(numeroFactura))]
    const total = filas.reduce((suma, f) => suma.plus(f.monto), new Decimal(0))
    return {
        facturas_cliente: numeros.join(', '),
        varias_facturas: numeros.length > 1,
        monto_cliente: filas.length > 0 ? monto(total) : '',
        monto_cliente_q: filas.length > 0 ? quetzales(total) : '',
    }
}

/** Pago de `billing.pagos` con sus facturas (para `comprobante.aprobado`). */
async function variablesPago(cliente: QueryClientContract, pagoId: number): Promise<Variables | null> {
    const fila = await cliente
        .from('billing.pagos')
        .where('id', pagoId)
        .select('id', 'monto', 'metodo', 'created_at')
        .first()
    if (!fila) return null
    const facturas = (await cliente
        .from('billing.pagos_aplicaciones')
        .where('pago_id', pagoId)
        .orderBy('id', 'asc')
        .select('factura_id')) as Array<{ factura_id: number }>
    return {
        id: fila.id,
        monto: monto(fila.monto),
        monto_q: quetzales(fila.monto),
        metodo: fila.metodo,
        facturas: [...new Set(facturas.map((f) => f.factura_id))].join(', '),
        fecha: fechaHora(fila.created_at),
    }
}

/** Datos del comprobante de depósito: monto, referencia (boleta), fecha del depósito y método. */
async function variablesComprobante(cliente: QueryClientContract, comprobanteId: number): Promise<Variables> {
    const fila = await cliente
        .from('billing.comprobantes')
        .where('id', comprobanteId)
        .select('monto', 'referencia', 'metodo', cliente.raw('fecha_deposito::text as fecha_deposito'))
        .first()
    if (!fila) return {}
    return {
        monto: monto(fila.monto),
        monto_q: quetzales(fila.monto),
        referencia: fila.referencia ?? '',
        metodo: fila.metodo ?? '',
        fecha_deposito: fila.fecha_deposito ? fechaCorta(fechaCalendario(fila.fecha_deposito)) : '',
    }
}

/**
 * Variables completas de un evento para un destinatario. `ahora` se inyecta para que los
 * recordatorios y las pruebas calculen días al vencimiento de forma determinista.
 */
export async function construirVariables(
    cliente: QueryClientContract,
    evento: string,
    payload: Payload,
    destinatario: Destinatario,
    ahora: DateTime = DateTime.utc(),
): Promise<Variables> {
    const variables: Variables = {
        evento,
        empresa: variablesEmpresa(),
        cliente: {
            id: destinatario.clienteId,
            nombre: destinatario.nombre,
            email: destinatario.email ?? '',
        },
    }

    const servicioId = entero(payload.servicio_id)
    if (servicioId) {
        const servicio = await variablesServicio(cliente, servicioId)
        if (servicio) variables.servicio = servicio
    }

    const facturaId = entero(payload.factura_id)
    if (facturaId) variables.factura = await variablesFactura(cliente, facturaId, payload, ahora)

    if (evento.startsWith('pago.')) {
        const facturas = Array.isArray(payload.facturas) ? payload.facturas : []
        variables.pago = {
            id: entero(payload.pago_id),
            monto: monto(texto(payload.monto)),
            monto_q: quetzales(texto(payload.monto)),
            metodo: texto(payload.metodo) ?? '',
            facturas: facturas.join(', '),
            fecha: fechaHora(ahora.toJSDate()),
        }
        const pagadorId = entero(payload.pagador_id) ?? entero(payload.cliente_id)
        if (pagadorId) variables.pagador = await variablesPagador(cliente, pagadorId)
        const pagoId = entero(payload.pago_id)
        if (pagoId && pagadorId && pagadorId !== destinatario.clienteId) {
            Object.assign(
                variables.pago as Variables,
                await aplicadoAlCliente(cliente, pagoId, destinatario.clienteId),
            )
        }
    }

    if (evento.startsWith('promesa.')) {
        const vence = texto(payload.vence)
        variables.promesa = {
            id: entero(payload.promesa_id),
            monto: monto(texto(payload.monto)),
            monto_q: quetzales(texto(payload.monto)),
            vence: vence ? fechaHora(vence) : '',
            vence_iso: vence ?? '',
        }
    }

    if (evento === 'servicio.estado_cambiado') variables.estado = variablesEstado(payload)

    if (evento.startsWith('recordatorio.')) {
        variables.recordatorio = {
            orden: entero(payload.orden),
            dias: typeof payload.dias === 'number' ? payload.dias : null,
        }
    }

    if (evento.startsWith('comprobante.')) {
        const comprobanteId = entero(payload.comprobante_id)
        variables.comprobante = {
            id: comprobanteId,
            motivo: texto(payload.motivo) ?? texto(payload.motivo_rechazo) ?? '',
            ...(comprobanteId ? await variablesComprobante(cliente, comprobanteId) : {}),
        }
        // comprobante.aprobado: el aviso de pago del pagador (avisos_pago.ts), con los datos del pago
        const pagoId = entero(payload.pago_id)
        if (pagoId) {
            const pago = await variablesPago(cliente, pagoId)
            if (pago) variables.pago = pago
        }
    }

    return variables
}
