import type { Schema, paths } from '@argosisp/contracts'
import Decimal from 'decimal.js'
import { z } from 'zod'

/**
 * Proveedores de cobro y liquidaciones (A3, fase 4 §10.3 y §18 del contrato de localización
 * fiscal): etiquetas, espejos de los validadores (`crearProveedorCobroValidator`,
 * `liquidarCobrosValidator`) y las sumas que el panel muestra antes de enviar. El backend recalcula
 * y es quien decide (422 `liquidacion_descuadrada`).
 */

type Proveedor = Schema<'ProveedorCobro'>
type PagoPendiente = Schema<'PagoPorLiquidar'>
export type MetodoProveedor = Proveedor['metodo']
type CuerpoProveedor = paths['/api/v1/cobros/proveedores']['post']['requestBody']['content']['application/json']
type CuerpoEdicionProveedor = paths['/api/v1/cobros/proveedores/{id}']['put']['requestBody']['content']['application/json']
type CuerpoLiquidacion = paths['/api/v1/cobros/liquidaciones']['post']['requestBody']['content']['application/json']

export const METODOS_PROVEEDOR: Record<MetodoProveedor, { etiqueta: string, icono: string, descripcion: string }> = {
    pasarela: { etiqueta: 'Pasarela', icono: 'i-lucide-credit-card', descripcion: 'Pagos en línea con tarjeta' },
    agente: { etiqueta: 'Agente', icono: 'i-lucide-store', descripcion: 'Agentes bancarios y puntos de pago' },
    debito: { etiqueta: 'Débito automático', icono: 'i-lucide-repeat', descripcion: 'Cargos recurrentes a la cuenta del cliente' },
}

const MONTO = /^\d{1,12}(\.\d{1,2})?$/
const MONTO_SIGNO = /^-?\d{1,12}(\.\d{1,2})?$/
const FECHA = /^\d{4}-\d{2}-\d{2}$/

/** `''` o un monto con hasta 2 decimales sin comas. */
function montoTexto(mensaje = 'Escribe un monto con hasta 2 decimales, sin comas (ej. 150.00)') {
    return z.string().trim().regex(MONTO, mensaje)
}

/**
 * Espejo de `crearProveedorCobroValidator` y `CrearProveedorCobro`: nombre de 2 a 80, el nombre de
 * la pasarela solo con `pasarela` (hasta 60), fecha de corte hoy o futura (vacía = hoy) y el banco
 * donde liquida obligatorio (`cuenta_id` de 1.1.02.NN). Al editar, la fecha actual se puede dejar
 * como está aunque ya pasó (`EditarProveedorCobro`: cambiarla con pagos es 409 `proveedor_con_pagos`).
 */
export function esquemaProveedorCobro(hoy: string, desdeActual: string | null = null) {
    return z.object({
        metodo: z.enum(['pasarela', 'agente', 'debito']),
        pasarela: z.string().trim().max(60, 'Máximo 60 caracteres'),
        nombre: z.string().trim().min(2, 'El nombre lleva al menos 2 caracteres').max(80, 'Máximo 80 caracteres'),
        desde: z.string()
            .trim()
            .refine(valor => valor === '' || FECHA.test(valor), 'Elige una fecha válida (día, mes y año)')
            .refine(valor => valor === '' || valor >= hoy || valor === desdeActual, 'La fecha de corte no puede ser anterior a hoy'),
        cuenta_id: z.number({ message: 'Elige el banco donde liquida' }).int().positive().nullable()
            .refine(valor => valor !== null, 'Elige el banco donde liquida'),
        activo: z.boolean(),
    })
}

export type EntradaProveedorCobro = z.input<ReturnType<typeof esquemaProveedorCobro>>
export type SalidaProveedorCobro = z.output<ReturnType<typeof esquemaProveedorCobro>>

export function entradaProveedorVacia(): EntradaProveedorCobro {
    return { metodo: 'pasarela', pasarela: '', nombre: '', desde: '', cuenta_id: null, activo: true }
}

export function entradaDeProveedor(proveedor: Proveedor): EntradaProveedorCobro {
    return {
        metodo: proveedor.metodo,
        pasarela: proveedor.metodo === 'pasarela' ? proveedor.codigo : '',
        nombre: proveedor.nombre,
        desde: proveedor.desde,
        cuenta_id: proveedor.cuenta_liquidacion_id,
        activo: proveedor.activo,
    }
}

/** Cuerpo de `POST /cobros/proveedores`: `pasarela` solo con ese método (si no, 422 `no_aplica`). */
export function cuerpoProveedor(datos: SalidaProveedorCobro): CuerpoProveedor {
    const cuerpo: CuerpoProveedor = { metodo: datos.metodo, nombre: datos.nombre, cuenta_id: datos.cuenta_id }
    if (datos.metodo === 'pasarela' && datos.pasarela) {
        cuerpo.pasarela = datos.pasarela
    }
    if (datos.desde) {
        cuerpo.desde = datos.desde
    }
    return cuerpo
}

/** Cuerpo de `PUT /cobros/proveedores/:id`: solo lo que cambió (`desde` solo si se movió). */
export function cuerpoEdicionProveedor(proveedor: Proveedor, datos: SalidaProveedorCobro): CuerpoEdicionProveedor {
    const cuerpo: CuerpoEdicionProveedor = { version: proveedor.version }
    if (datos.nombre !== proveedor.nombre) {
        cuerpo.nombre = datos.nombre
    }
    if (datos.activo !== proveedor.activo) {
        cuerpo.activo = datos.activo
    }
    if (datos.cuenta_id !== proveedor.cuenta_liquidacion_id) {
        cuerpo.cuenta_id = datos.cuenta_id
    }
    if (datos.desde && datos.desde !== proveedor.desde) {
        cuerpo.desde = datos.desde
    }
    return cuerpo
}

/** Σ cobros − Σ contracargos de lo elegido: el bruto que la API espera (en string con 2 decimales). */
export function brutoEsperado(elegidos: readonly Pick<PagoPendiente, 'tipo' | 'monto'>[]): Decimal {
    return elegidos.reduce((suma, p) => (p.tipo === 'contracargo' ? suma.minus(p.monto) : suma.plus(p.monto)), new Decimal(0))
}

/** Neto = bruto − comisión (el bruto lleva signo: solo contracargos lo dejan ≤ 0), o `null` si no son montos. */
export function netoDe(bruto: string, comision: string): Decimal | null {
    if (!MONTO_SIGNO.test(bruto.trim()) || !MONTO.test(comision.trim())) {
        return null
    }
    return new Decimal(bruto.trim()).minus(comision.trim())
}

/**
 * Espejo de `liquidarCobrosValidator`: referencia de 1 a 120, bruto con signo y comisión en string
 * con hasta 2 decimales, al menos un pago o un contracargo (H14: una liquidación de solo
 * contracargos tiene bruto ≤ 0 y debita el banco), fecha no futura (vacía = hoy) y nota hasta 500.
 * El neto no se captura: es bruto − comisión.
 */
export function esquemaLiquidacion(hoy: string) {
    return z.object({
        referencia: z.string().trim().min(1, 'Escribe la referencia de la liquidación (la del reporte del proveedor)').max(120, 'Máximo 120 caracteres'),
        fecha: z.string()
            .trim()
            .refine(valor => valor === '' || FECHA.test(valor), 'Elige una fecha válida (día, mes y año)')
            .refine(valor => valor === '' || valor <= hoy, 'La fecha del depósito no puede ser futura'),
        bruto: z.string().trim().regex(MONTO_SIGNO, 'Escribe un monto con hasta 2 decimales, sin comas (ej. 150.00 o -50.00)'),
        comision: montoTexto(),
        pagos: z.array(z.number().int().positive()),
        contracargos: z.array(z.number().int().positive()),
        cuenta_id: z.number().int().positive().nullable(),
        archivo: z.string().trim().max(200, 'Máximo 200 caracteres'),
        nota: z.string().trim().max(500, 'Máximo 500 caracteres'),
    }).superRefine((datos, ctx) => {
        if (!datos.pagos.length && !datos.contracargos.length) {
            ctx.addIssue({ code: 'custom', path: ['pagos'], message: 'Elige al menos un pago o un contracargo de la liquidación' })
        }
        const neto = netoDe(datos.bruto, datos.comision)
        if (neto?.isNegative() && datos.pagos.length && new Decimal(datos.bruto).gt(0)) {
            ctx.addIssue({ code: 'custom', path: ['comision'], message: 'La comisión no puede ser mayor que el bruto' })
        }
    })
}

export type EntradaLiquidacion = z.input<ReturnType<typeof esquemaLiquidacion>>
export type SalidaLiquidacion = z.output<ReturnType<typeof esquemaLiquidacion>>

/** Cuerpo de `POST /cobros/liquidaciones`; sin banco elegido usa el del proveedor. */
export function cuerpoLiquidacion(proveedorId: number, datos: SalidaLiquidacion, sha256: string | null): CuerpoLiquidacion {
    const bruto = new Decimal(datos.bruto)
    const comision = new Decimal(datos.comision)
    const cuerpo: CuerpoLiquidacion = {
        proveedor_cobro_id: proveedorId,
        referencia: datos.referencia,
        bruto: bruto.toFixed(2),
        comision: comision.toFixed(2),
        neto: bruto.minus(comision).toFixed(2),
        pagos: datos.pagos,
    }
    if (datos.contracargos.length) {
        cuerpo.contracargos = datos.contracargos
    }
    if (datos.fecha) {
        cuerpo.fecha = datos.fecha
    }
    if (datos.cuenta_id !== null) {
        cuerpo.cuenta_id = datos.cuenta_id
    }
    if (datos.archivo) {
        cuerpo.archivo = datos.archivo
    }
    if (sha256) {
        cuerpo.sha256 = sha256
    }
    if (datos.nota) {
        cuerpo.nota = datos.nota
    }
    return cuerpo
}

/** Antigüedad de un pago sin liquidar contra `cobros_liquidar_dias` del proveedor. */
export function antiguedad(dias: number, limite: number): { etiqueta: string, color: 'neutral' | 'warning' | 'error' } {
    const etiqueta = dias === 0 ? 'Hoy' : dias === 1 ? '1 día' : `${dias} días`
    if (dias > limite) {
        return { etiqueta, color: 'error' }
    }
    return { etiqueta, color: dias >= Math.max(limite - 1, 1) ? 'warning' : 'neutral' }
}
