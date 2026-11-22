import type { BadgeProps } from '@nuxt/ui'
import type { Schema } from '@argosisp/contracts'
import { ACEPTA_FOTOS, TIPOS_SUBIBLES } from '~/utils/fotos'

/** Comprobante de depósito (tarea 5): esquema del formulario, archivo y presentación de estados. */

export type MetodoComprobante = Schema<'PortalComprobante'>['metodo']
type EstadoComprobante = Schema<'PortalComprobante'>['estado']
type Color = NonNullable<BadgeProps['color']>

export const METODOS_COMPROBANTE: { label: string, value: MetodoComprobante, descripcion: string }[] = [
    { label: 'Depósito en agencia', value: 'deposito', descripcion: 'Boleta del banco' },
    { label: 'Transferencia', value: 'transferencia', descripcion: 'Desde tu banca en línea o app' },
    { label: 'ACH', value: 'ach', descripcion: 'Transferencia entre bancos' },
    { label: 'Remesa', value: 'remesa', descripcion: 'Pago desde el extranjero' },
]

export const NOMBRE_METODO: Record<MetodoComprobante, string> = {
    deposito: 'Depósito',
    transferencia: 'Transferencia',
    ach: 'ACH',
    remesa: 'Remesa',
}

export const ESTADOS_COMPROBANTE: Record<EstadoComprobante, { etiqueta: string, color: Color, icono: string }> = {
    pendiente: { etiqueta: 'En revisión', color: 'warning', icono: 'i-lucide-hourglass' },
    aprobado: { etiqueta: 'Aprobado', color: 'success', icono: 'i-lucide-circle-check' },
    rechazado: { etiqueta: 'Rechazado', color: 'error', icono: 'i-lucide-circle-x' },
}

/** Igual que `DATOS_POR_METODO` de A3: el banco de origen solo se pide en transferencia y ACH. */
export function pideBancoOrigen(metodo: MetodoComprobante | undefined): boolean {
    return metodo === 'transferencia' || metodo === 'ach'
}

/**
 * Mismo límite que `RegistrarComprobante` (la API decide por el contenido). Tipos: los de Iris
 * (JPEG, PNG y PDF); cualquier otra foto se convierte a JPEG antes con `prepararArchivo` (`utils/fotos`).
 */
export const TAMANO_MAXIMO_ARCHIVO = 5 * 1024 * 1024
export const TIPOS_ARCHIVO = TIPOS_SUBIBLES
/** `accept` del selector: JPEG, PNG y PDF (en iOS la galería entrega la foto HEIC ya en JPEG). */
export const ACEPTA_ARCHIVO = ACEPTA_FOTOS

/** "2.4 MB", "830 KB". */
export function tamanoLegible(bytes: number): string {
    if (bytes >= 1024 * 1024) {
        return `${(bytes / 1024 / 1024).toFixed(1)} MB`
    }
    return `${Math.max(1, Math.round(bytes / 1024))} KB`
}

/** Mensaje si el archivo no sirve, o `null`. Por tipo declarado: la API lo vuelve a revisar por contenido. */
export function problemaArchivo(archivo: File): string | null {
    if (!(TIPOS_ARCHIVO as readonly string[]).includes(archivo.type)) {
        return 'Sube una foto (JPG o PNG) o un PDF del comprobante.'
    }
    if (archivo.size > TAMANO_MAXIMO_ARCHIVO) {
        return `El archivo pesa ${tamanoLegible(archivo.size)}; el máximo es 5 MB.`
    }
    return null
}

/** Estado inicial del formulario: campos vacíos (`UForm` los marca al enviar). */
export interface FormularioComprobante {
    metodo: MetodoComprobante | undefined
    cuenta_bancaria_id: number | undefined
    banco_origen_id: number | undefined
    referencia: string
    monto: string
    fecha_deposito: string
    archivo: File | undefined
}

/** Hoy en Guatemala (YYYY-MM-DD), para el máximo del campo fecha. */
export function hoyGuatemala(ahora = new Date()): string {
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: ZONA_HORARIA,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).format(ahora)
}

/** Campos del cuerpo multipart (el archivo va aparte). Sin banco de origen si el método no lo pide. */
export function camposComprobante(datos: DatosComprobante, servicioId?: number) {
    return {
        metodo: datos.metodo,
        cuenta_bancaria_id: datos.cuenta_bancaria_id,
        ...(pideBancoOrigen(datos.metodo) && datos.banco_origen_id ? { banco_origen_id: datos.banco_origen_id } : {}),
        referencia: datos.referencia.trim(),
        monto: datos.monto.trim(),
        fecha_deposito: datos.fecha_deposito,
        ...(servicioId ? { servicio_id: servicioId } : {}),
    }
}

/**
 * Ruta de la página para subir el comprobante desde `/cuenta`: con el servicio y la empresa del
 * grupo (sus cuentas de destino) y vuelta a «Pagar».
 */
export function rutaComprobante(servicioId?: number, empresaId?: number): string {
    const query = new URLSearchParams()
    if (servicioId !== undefined) {
        query.set('servicio', String(servicioId))
    }
    if (empresaId !== undefined) {
        query.set('empresa', String(empresaId))
    }
    query.set('volver', '/cuenta?seccion=pagar')
    return `/comprobante?${query.toString()}`
}
