import type { HttpContext } from '@adonisjs/core/http'
import db from '@adonisjs/lucid/services/db'
import logger from '@adonisjs/core/services/logger'
import { NoEncontrado, Problema, ReglaNegocio, ValidacionFallida } from '#shared/errores'
import { ESTADOS_PENDIENTES } from '#billing/facturas'
import { proveedorConfigurado } from '#billing/pasarelas/pasarela'
import { verCobroPasarela, type CobroPasarelaVista } from '#billing/pasarelas/cobros'
import type { EstadoCobroProveedor } from '#billing/pasarelas/pasarela'
import { exigirSesionPortal, SesionPortalRequerida, tokenDeLaPeticion } from '#portal/acceso/sesion'
import { resolverServicio, saldoCobrable } from '#portal/consultas'
import { titularDeLaPeticion } from '#portal/comprobantes'

/**
 * "Pagar en línea" desde el portal (semana 2). El cobro lo crea `CrearCobroPasarela` de A3 (canal
 * `portal`, actor sistema) y el pago llega por el webhook firmado de la pasarela, que registra el
 * pago y reactiva el servicio: el portal **no aplica pagos**. Aquí solo vive:
 *
 * - `pagadorDeLaPeticion`: quién paga (IP de origen o sesión del portal, como el comprobante).
 * - `facturasAPagar`: qué se cobra. Por defecto las facturas **vencidas** con saldo del servicio
 *   (lo que `/corte` muestra como vencido); si no hay vencidas, todo lo pendiente del servicio.
 *   Con `facturas` concretas (solo con sesión), deben ser del cliente (404 si no).
 * - **Multiempresa:** un cobro en línea es de una sola empresa (NIT). Las facturas elegidas deben
 *   ser de una misma empresa (422 `pago_de_varias_empresas` si no); el portal lo revisa antes de
 *   llamar a A3, que igual lo vuelve a revisar.
 * - `urlRetornoPortal`: adonde la pasarela devuelve al cliente (`/corte?pago={cobro_id}`; el
 *   proveedor agrega `estado=pagado|fallido`). El portal lo muestra, pero la verdad es el webhook.
 * - `cobroParaCliente`: la vista sin datos internos (sin cliente, comisión ni proveedor).
 * - `cobroDeLaPeticion`: `GET /portal/pagos/en-linea/:id` solo responde si el cobro es del cliente
 *   de la sesión o del servicio de la IP de origen (404 si no).
 */

/** Espejo del schema `PortalPagoEnLinea`. */
export interface PagoEnLineaPortal {
    id: number
    estado: EstadoCobroProveedor
    monto: string
    url_pago: string | null
    expira_en: Date | null
    pagado_en: Date | null
}

export function cobroParaCliente(cobro: CobroPasarelaVista): PagoEnLineaPortal {
    return {
        id: Number(cobro.id),
        estado: cobro.estado,
        monto: cobro.monto,
        // Pagado, fallido o expirado: no se vuelve a la página del proveedor.
        url_pago: cobro.estado === 'pendiente' ? cobro.url_pago : null,
        expira_en: cobro.expira_en,
        pagado_en: cobro.pagado_en,
    }
}

/**
 * `url_retorno` de `CrearCobroPasarela`: `<PORTAL_URL_PUBLICA>/corte?pago={cobro_id}` (A3 reemplaza
 * `{cobro_id}` y valida el origen contra `PASARELA_RETORNO_ORIGENES`). Sin `PORTAL_URL_PUBLICA`, la
 * de `NOTIFY_PORTAL_URL`; sin ninguna, null: el cliente vuelve con "Atrás" (el portal deja la URL en
 * `/corte?pago=<id>` antes de salir).
 */
export function urlRetornoPortal(entorno: NodeJS.ProcessEnv = process.env): string | null {
    const texto = (entorno.PORTAL_URL_PUBLICA || entorno.NOTIFY_PORTAL_URL || '').trim()
    if (!texto) return null
    let base: URL
    try {
        base = new URL(texto)
    } catch {
        return null
    }
    return `${base.origin}${base.pathname.replace(/\/+$/, '')}/corte?pago={cobro_id}`
}

/** Hay pasarela configurada (`PASARELA_PROVEEDOR`, o la falsa fuera de producción). */
export function pagoEnLineaDisponible(): boolean {
    return proveedorConfigurado() !== null
}

export interface EntradaIniciarPago {
    servicio_id?: number
    facturas?: number[]
}

/**
 * Cliente y servicio que pagan. Con `facturas` y sin `servicio_id` basta la sesión del portal (las
 * facturas concretas solo se ven en `/cuenta`); el resto, igual que el comprobante.
 */
export async function pagadorDeLaPeticion(
    ctx: HttpContext,
    ip: string,
    entrada: EntradaIniciarPago,
): Promise<{ clienteId: number; servicioId: number | null; porSesion: boolean }> {
    if (entrada.facturas && entrada.facturas.length > 0 && entrada.servicio_id === undefined) {
        const sesion = await exigirSesionPortal(ctx)
        return { clienteId: sesion.clienteId, servicioId: null, porSesion: true }
    }
    return titularDeLaPeticion(ctx, ip, entrada.servicio_id)
}

/**
 * ids de las facturas a cobrar, la más antigua primero: solo las pendientes de A3
 * (`ESTADOS_PENDIENTES`); una castigada o acreditada nunca se cobra en línea (`saldoCobrable`).
 * 422 `sin_deuda` si no hay ninguna.
 */
export async function facturasAPagar(
    ctx: HttpContext,
    pagador: { clienteId: number; servicioId: number | null },
    pedidas: number[] | undefined,
): Promise<number[]> {
    if (pedidas && pedidas.length > 0) {
        const unicas = [...new Set(pedidas)]
        // Facturas concretas: siempre con la sesión del cliente dueño.
        const sesion = await exigirSesionPortal(ctx)
        if (sesion.clienteId !== pagador.clienteId) throw new NoEncontrado('Esa factura no es de tu cuenta')
        const filas = (await db
            .from('billing.facturas')
            .whereIn('id', unicas)
            .select('id', 'cliente_id', 'empresa_id', 'estado', 'total', 'pagado')) as Array<{
            id: number
            cliente_id: number
            empresa_id: number
            estado: string
            total: string
            pagado: string
        }>
        const ajenas = unicas.filter(
            (id) => !filas.some((f) => Number(f.id) === id && Number(f.cliente_id) === pagador.clienteId),
        )
        if (ajenas.length > 0) throw new NoEncontrado('Esa factura no es de tu cuenta')
        const sinSaldo = unicas
            .map((id, i) => ({ id, i, fila: filas.find((f) => Number(f.id) === id)! }))
            .filter(({ fila }) => saldoCobrable(fila).lte(0))
        if (sinSaldo.length > 0) {
            throw new ValidacionFallida(
                sinSaldo.map(({ i }) => ({
                    field: `facturas.${i}`,
                    message: 'Esa factura ya no tiene saldo pendiente',
                    rule: 'factura_pendiente',
                })),
                'Revisa las facturas que elegiste',
            )
        }
        exigirUnaEmpresa(filas)
        return unicas
    }

    if (pagador.servicioId === null) throw new SinDeuda()
    const filas = (await db
        .from('billing.facturas')
        .where('servicio_id', pagador.servicioId)
        .whereIn('estado', [...ESTADOS_PENDIENTES])
        .whereRaw('total > pagado')
        .orderBy('vence_en', 'asc')
        .orderBy('id', 'asc')
        .select(
            'id',
            'empresa_id',
            db.raw(
                `(estado = 'vencida' OR vence_en < (now() AT TIME ZONE 'America/Guatemala')::date) AS vencida`,
            ),
        )) as Array<{ id: number; empresa_id: number; vencida: boolean }>
    const vencidas = filas.filter((f) => f.vencida)
    const elegidas = vencidas.length > 0 ? vencidas : filas
    if (elegidas.length === 0) throw new SinDeuda()
    // Un servicio que cambió de empresa solo lo hace sin saldo: sus pendientes son de una sola.
    exigirUnaEmpresa(elegidas)
    return elegidas.map((f) => Number(f.id))
}

/** 422 `pago_de_varias_empresas`: el pago en línea nunca mezcla empresas (cada NIT cobra lo suyo). */
export class PagoDeVariasEmpresas extends ReglaNegocio {
    constructor() {
        super(
            'Esas facturas son de empresas distintas y cada una se paga por separado. Elige las ' +
                'facturas de una sola empresa (o paga un servicio a la vez).',
            'pago_de_varias_empresas',
        )
    }
}

function exigirUnaEmpresa(facturas: Array<{ empresa_id: number }>): void {
    if (new Set(facturas.map((f) => Number(f.empresa_id))).size > 1) throw new PagoDeVariasEmpresas()
}

export class SinDeuda extends ReglaNegocio {
    constructor() {
        super('No tienes saldo pendiente: no hay nada que pagar.', 'sin_deuda')
    }
}

/** Errores de `CrearCobroPasarela` en palabras del cliente (sin ids internos ni variables de entorno). */
export function errorPagoParaCliente(error: unknown): unknown {
    if (!(error instanceof Problema)) return error
    const noDisponible = () =>
        new Problema(
            503,
            'pasarela_no_configurada',
            'Pago en línea no disponible',
            'El pago en línea no está disponible en este momento. Paga por depósito o en nuestra oficina.',
        )
    if (error.code === 'E_PASARELA_NO_CONFIGURADA') return noDisponible()
    // url_retorno rechazada: PORTAL_URL_PUBLICA fuera de PASARELA_RETORNO_ORIGENES (configuración)
    if (error instanceof ValidacionFallida && error.errores?.some((e) => e.field === 'url_retorno')) {
        logger.error({ errores: error.errores }, 'La pasarela rechazó la URL de retorno del portal')
        return noDisponible()
    }
    if (error.code === 'E_SIN_DEUDA') return new SinDeuda()
    if (error.code === 'E_PAGO_DE_VARIAS_EMPRESAS') return new PagoDeVariasEmpresas()
    if (error instanceof ValidacionFallida) {
        const errores = (error.errores ?? []).filter((e) => e.field.startsWith('facturas.'))
        return new ValidacionFallida(
            errores.map((e) => ({ ...e, message: 'Esa factura ya no tiene saldo pendiente' })),
            'No pudimos preparar tu pago. Recarga la página e intenta de nuevo.',
        )
    }
    return error
}

/**
 * Cobro de `GET /portal/pagos/en-linea/:id`: del cliente de la sesión o del cliente del servicio de
 * la IP de origen. Cualquier otro (o inexistente) responde 404, sin decir si existe.
 */
export async function cobroDeLaPeticion(
    ctx: HttpContext,
    ip: string,
    id: number,
): Promise<PagoEnLineaPortal> {
    const noEncontrado = new NoEncontrado('No encontramos ese pago en línea')
    let cobro: CobroPasarelaVista
    try {
        cobro = await verCobroPasarela(id)
    } catch (error) {
        if (error instanceof NoEncontrado) throw noEncontrado
        throw error
    }
    const clientes = new Set<number>()
    if (tokenDeLaPeticion(ctx)) {
        try {
            const sesion = await exigirSesionPortal(ctx)
            clientes.add(sesion.clienteId)
        } catch (error) {
            if (!(error instanceof SesionPortalRequerida)) throw error
        }
    }
    const servicio = await resolverServicio(db.connection(), ip)
    if (servicio !== null) {
        const fila = await db.from('core.servicios').where('id', servicio).select('cliente_id').first()
        if (fila) clientes.add(Number(fila.cliente_id))
    }
    if (!clientes.has(Number(cobro.cliente_id))) throw noEncontrado
    return cobroParaCliente(cobro)
}
