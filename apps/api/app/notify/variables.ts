import { Decimal } from 'decimal.js'
import { DateTime } from 'luxon'
import type { QueryClientContract } from '@adonisjs/lucid/types/database'
import env from '#start/env'
import { CAMPOS_EMPRESA, verEmpresa } from '#portal/empresa'
import { EMPRESA_PRINCIPAL, urlLogoEmpresa } from '#core/empresas'
import type { CanalNotificacion } from '#shared/eventos'
import { empresaDelEvento } from '#notify/configuracion'
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

/**
 * `{{empresa.*}}` (`contratos/multiempresa.md`, "Marca"): la empresa del servicio o de la factura
 * del evento (`empresaDelEvento`; sin ella, la principal). Campos de siempre (`verEmpresa` de
 * `#portal/empresa`: `nombre`, `nit`, `direccion`, `telefono`, `telefono_alterno`, `whatsapp`,
 * `correo`, `horario`, `instrucciones_pago`; con la empresa 1 sin guardar, los valores por defecto
 * del entorno) y los de multiempresa:
 *
 * - `id`, `nombre_comercial` (= `nombre`), `razon_social`, `direccion_fiscal` (= `direccion`),
 *   `municipio`, `departamento`, `sitio_web`;
 * - `logo_url`: URL absoluta del logo (`NOTIFY_API_URL` + `/api/v1/empresas/:id/logo?v=…`); vacía
 *   sin logo o sin `NOTIFY_API_URL`;
 * - `soporte.telefono`, `soporte.whatsapp`, `soporte.correo`, `soporte.horario` y `soporte.texto`
 *   (lo que haya, en una línea: "Tel. 2222-0000 · WhatsApp 5555-0000 · ayuda@isp.gt");
 * - `portal_url` (`NOTIFY_PORTAL_URL`).
 *
 * Los campos vacíos van como `''` para que las secciones Mustache (`{{#empresa.telefono}}`) no se
 * muestren.
 */
export async function variablesEmpresa(cliente: QueryClientContract, empresaId?: number): Promise<Variables> {
    const id = empresaId ?? EMPRESA_PRINCIPAL
    const empresa = await verEmpresa(cliente, id)
    const variables: Variables = {}
    for (const campo of CAMPOS_EMPRESA) variables[campo] = empresa[campo] ?? ''
    const fila = (await cliente
        .from('core.empresas')
        .where('id', id)
        .select('razon_social', 'municipio', 'departamento', 'sitio_web', 'logo_etag', 'version')
        .first()) as {
        razon_social: string | null
        municipio: string | null
        departamento: string | null
        sitio_web: string | null
        logo_etag: string | null
        version: number
    } | null
    const guardada = fila !== null && Number(fila.version) > 0
    const base = (env.get('NOTIFY_API_URL') ?? '').replace(/\/+$/, '')
    const logo = guardada ? urlLogoEmpresa(id, fila.logo_etag) : null

    variables.id = fila ? id : EMPRESA_PRINCIPAL
    variables.nombre_comercial = variables.nombre
    variables.direccion_fiscal = variables.direccion
    variables.razon_social = (guardada && fila.razon_social) || ''
    variables.municipio = (guardada && fila.municipio) || ''
    variables.departamento = (guardada && fila.departamento) || ''
    variables.sitio_web = (guardada && fila.sitio_web) || ''
    variables.logo_url = logo && base ? `${base}${logo}` : ''
    variables.soporte = soporte(empresa)
    variables.portal_url = env.get('NOTIFY_PORTAL_URL') ?? ''
    return variables
}

function soporte(empresa: {
    telefono: string | null
    whatsapp: string | null
    correo: string | null
    horario: string | null
}) {
    const partes = [
        empresa.telefono ? `Tel. ${empresa.telefono}` : null,
        empresa.whatsapp ? `WhatsApp ${empresa.whatsapp}` : null,
        empresa.correo || null,
        empresa.horario || null,
    ].filter(Boolean)
    return {
        telefono: empresa.telefono ?? '',
        whatsapp: empresa.whatsapp ?? '',
        correo: empresa.correo ?? '',
        horario: empresa.horario ?? '',
        texto: partes.join(' · '),
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

/**
 * Cobro repartido (multiempresa, `contratos/eventos.md`): un cobro de caja que cubrió facturas de
 * varias empresas se divide en un pago por empresa y cada uno emite su `pago.registrado` con el
 * mismo `cobro_id`. Cada aviso es el de su empresa (su marca, su bot); estas variables dejan que
 * la plantilla diga que es parte de un cobro mayor:
 *
 * - `id`, `monto`, `monto_q`: el cobro completo (lo que el cliente entregó en caja).
 * - `partes`: cuántos pagos (empresas) tiene el cobro.
 * - `repartido`: true si son 2 o más (para `{{#cobro.repartido}}…{{/cobro.repartido}}`).
 * - `otras_empresas`: nombres de las demás empresas del cobro, separados por coma.
 */
export async function variablesCobro(
    cliente: QueryClientContract,
    cobroId: number,
    empresaId: number | null,
): Promise<Variables | null> {
    const cobro = (await cliente
        .from('billing.cobros')
        .where('id', cobroId)
        .select('id', 'monto')
        .first()) as {
        id: number
        monto: string
    } | null
    if (!cobro) return null
    const partes = (await cliente
        .from('billing.pagos as p')
        .join('core.empresas as e', 'e.id', 'p.empresa_id')
        .where('p.cobro_id', cobroId)
        .orderBy('p.empresa_id', 'asc')
        .select('p.empresa_id', 'e.nombre_comercial')) as Array<{
        empresa_id: number
        nombre_comercial: string
    }>
    const otras = partes.filter((x) => Number(x.empresa_id) !== empresaId).map((x) => x.nombre_comercial)
    return {
        id: Number(cobro.id),
        monto: monto(cobro.monto),
        monto_q: quetzales(cobro.monto),
        partes: partes.length,
        repartido: partes.length > 1,
        otras_empresas: [...new Set(otras)].join(', '),
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
        empresa: await variablesEmpresa(cliente, (await empresaDelEvento(cliente, payload)) ?? undefined),
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
        const cobroId = entero(payload.cobro_id)
        if (cobroId) {
            const cobro = await variablesCobro(cliente, cobroId, await empresaDelEvento(cliente, payload))
            if (cobro) variables.cobro = cobro
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
