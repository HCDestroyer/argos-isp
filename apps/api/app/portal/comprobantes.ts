import { readFile } from 'node:fs/promises'
import type { HttpContext } from '@adonisjs/core/http'
import db from '@adonisjs/lucid/services/db'
import { Conflicto, NoEncontrado, Problema, ValidacionFallida, type ErrorCampo } from '#shared/errores'
import type { Pagina, OpcionesPaginacion } from '#shared/paginacion'
import { listarBancos } from '#billing/cuentas_bancarias'
import { listarComprobantes, type ComprobanteVista } from '#billing/comprobantes'
import { exigirSesionPortal } from '#portal/acceso/sesion'
import { servicioDeLaPeticion } from '#portal/promesas'
import type { ArchivoComprobante } from '#billing/actions/registrar_comprobante'
import { TAMANO_MAXIMO_COMPROBANTE } from '#billing/comprobantes_archivos'

/**
 * Comprobantes de depósito desde el portal (tarea 5). La acción es `RegistrarComprobante` de A3
 * (canal `portal`, actor sistema); aquí solo se identifica al cliente, se lee el archivo del
 * multipart, se traducen los errores a palabras del cliente y se arma la vista sin datos internos.
 *
 * - Identificación igual que la promesa: sin `servicio_id`, por la IP de origen (`/corte`); con
 *   `servicio_id`, por la sesión del portal y el servicio debe ser del cliente (404 si no).
 * - La lista (`GET /portal/comprobantes`) es de solo lectura y siempre filtrada por el cliente de
 *   la sesión, con `listarComprobantes({ cliente_id })` de A3.
 */

/** Espejo del schema `PortalComprobante`. */
export interface ComprobantePortal {
    id: number
    servicio_id: number | null
    metodo: ComprobanteVista['metodo']
    cuenta_destino: string
    banco_origen: string | null
    referencia: string
    monto: string
    fecha_deposito: string
    archivo_tipo: ComprobanteVista['archivo_tipo']
    archivo_nombre: string | null
    estado: ComprobanteVista['estado']
    motivo_rechazo: string | null
    created_at: Date
    verificado_en: Date | null
}

export function comprobanteParaCliente(c: ComprobanteVista): ComprobantePortal {
    return {
        id: Number(c.id),
        servicio_id: c.servicio_id === null ? null : Number(c.servicio_id),
        metodo: c.metodo,
        cuenta_destino: c.cuenta_bancaria_nombre,
        banco_origen: c.banco_origen_nombre,
        referencia: c.referencia,
        monto: c.monto,
        fecha_deposito: c.fecha_deposito,
        archivo_tipo: c.archivo_tipo,
        archivo_nombre: c.archivo_nombre,
        estado: c.estado,
        motivo_rechazo: c.motivo_rechazo,
        created_at: c.created_at,
        verificado_en: c.verificado_en,
    }
}

export async function comprobantesPortal(
    clienteId: number,
    opciones: OpcionesPaginacion,
): Promise<Pagina<ComprobantePortal>> {
    const pagina = await listarComprobantes({ ...opciones, cliente_id: clienteId })
    return { data: pagina.data.map(comprobanteParaCliente), nextCursor: pagina.nextCursor }
}

/** Catálogo público de bancos de origen (transferencia y ACH): solo id y nombre de los activos. */
export async function bancosPortal(): Promise<{ id: number; nombre: string }[]> {
    const bancos = await listarBancos()
    return bancos.map((b) => ({ id: Number(b.id), nombre: b.nombre }))
}

/** Cliente y servicio del comprobante: por la sesión (con `servicio_id`) o por la IP de origen. */
export async function titularDeLaPeticion(
    ctx: HttpContext,
    ip: string,
    servicioId: number | undefined,
): Promise<{ clienteId: number; servicioId: number }> {
    if (servicioId !== undefined) {
        const sesion = await exigirSesionPortal(ctx)
        const propio = await db
            .from('core.servicios')
            .where('id', servicioId)
            .where('cliente_id', sesion.clienteId)
            .select('id')
            .first()
        if (!propio) throw new NoEncontrado('Ese servicio no es de tu cuenta')
        return { clienteId: sesion.clienteId, servicioId }
    }
    const servicio = await servicioDeLaPeticion(ctx, ip, undefined)
    const fila = await db.from('core.servicios').where('id', servicio).select('cliente_id').firstOrFail()
    return { clienteId: Number(fila.cliente_id), servicioId: servicio }
}

/**
 * Archivo del campo `archivo` del multipart. Sin archivo devuelve contenido vacío: la acción
 * responde 422 `archivo` `required` junto con el resto de errores del formulario. El tipo lo decide
 * la acción por el contenido (firma de los primeros bytes), nunca por la extensión ni por el
 * `Content-Type` que manda el navegador.
 *
 * Antes de leerlo a memoria se rechaza aquí (422 en `archivo`) lo que la acción rechazaría igual:
 * más de 5 MB (`TAMANO_MAXIMO_COMPROBANTE` de A3; el bodyparser acepta hasta 20 MB) o más de un
 * archivo en el campo.
 */
export async function archivoDeLaPeticion(ctx: HttpContext): Promise<ArchivoComprobante> {
    const archivos = ctx.request.files('archivo')
    if (archivos.length > 1) {
        throw errorComprobanteParaCliente(
            new ValidacionFallida([{ field: 'archivo', rule: 'unico', message: 'Más de un archivo' }]),
        )
    }
    const archivo = archivos[0]
    if (!archivo?.tmpPath) return { contenido: new Uint8Array(), nombre: null }
    if (archivo.size > TAMANO_MAXIMO_COMPROBANTE) {
        throw errorComprobanteParaCliente(
            new ValidacionFallida([
                {
                    field: 'archivo',
                    rule: 'tamano',
                    message: `El archivo pesa ${(archivo.size / 1024 / 1024).toFixed(1)} MB; el máximo es 5 MB`,
                },
            ]),
        )
    }
    return { contenido: await readFile(archivo.tmpPath), nombre: archivo.clientName }
}

const CAMPOS_FORMULARIO = new Set([
    'metodo',
    'cuenta_bancaria_id',
    'banco_origen_id',
    'referencia',
    'monto',
    'fecha_deposito',
    'archivo',
    'nota',
])

/** Texto para el cliente por campo y regla de `RegistrarComprobante` (sin ids internos). */
function mensajeCampo(error: ErrorCampo): string {
    const regla = error.rule ?? ''
    switch (error.field) {
        case 'archivo':
            if (regla === 'tamano') return `${error.message}. Toma la foto con menor resolución o recórtala.`
            if (regla === 'tipo') return 'Sube una foto (JPG, PNG o WebP) o un PDF del comprobante.'
            if (regla === 'unico') return 'Sube un solo archivo: la foto o el PDF del comprobante.'
            return 'Adjunta la foto o el PDF del comprobante.'
        case 'cuenta_bancaria_id':
            if (regla === 'required') return 'Elige la cuenta a la que depositaste.'
            return 'Esa cuenta ya no recibe depósitos. Elige otra de la lista.'
        case 'banco_origen_id':
            if (regla === 'required') return 'Elige el banco desde el que transferiste.'
            if (regla === 'no_aplica') return 'El banco de origen solo se pide en transferencias y ACH.'
            return 'Elige un banco de la lista.'
        case 'referencia':
            return 'Escribe el número de referencia o de boleta.'
        case 'monto':
            return 'Escribe el monto depositado con hasta 2 decimales, sin la Q.'
        case 'fecha_deposito':
            if (regla === 'fecha_futura') return 'La fecha del depósito no puede ser posterior a hoy.'
            return 'Elige la fecha del depósito.'
        case 'metodo':
            return 'Elige cómo pagaste.'
        default:
            return error.message
    }
}

const CONTACTANOS = 'Si el problema sigue, comunícate con nosotros.'

/**
 * Errores de `RegistrarComprobante` en palabras del cliente. El 409 de A3 nombra el pago o el
 * comprobante que ya tiene la referencia (ids internos, quizá de otro cliente): aquí no se dicen.
 * Un 422 de `cliente_id`/`servicio_id` no debería pasar (se identifica antes); si pasa, se
 * responde sin el detalle técnico.
 */
export function errorComprobanteParaCliente(error: unknown): unknown {
    if (!(error instanceof Problema)) return error
    if (error.code === 'E_REFERENCIA_DUPLICADA') {
        return new Conflicto(
            'Ya recibimos un pago o comprobante con esa referencia para esa cuenta. Si ya lo enviaste, ' +
                'espera la revisión; si no, revisa el número de la boleta.',
            'referencia_duplicada',
            'Referencia duplicada',
        )
    }
    if (error instanceof ValidacionFallida) {
        const errores = (error.errores ?? []).filter((e) => CAMPOS_FORMULARIO.has(e.field))
        if (errores.length === 0) {
            return new ValidacionFallida([], `No pudimos registrar tu comprobante. ${CONTACTANOS}`)
        }
        return new ValidacionFallida(
            errores.map((e) => ({ ...e, message: mensajeCampo(e) })),
            'Revisa los datos del comprobante',
        )
    }
    return error
}
