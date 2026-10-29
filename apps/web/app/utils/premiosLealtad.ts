import type { BadgeProps } from '@nuxt/ui'
import type { Schema, paths } from '@argosisp/contracts'
import Decimal from 'decimal.js'
import * as z from 'zod'

type Premio = Schema<'PremioLealtad'>
type Canje = Schema<'CanjeLealtad'>
export type TipoPremio = Premio['tipo']
type DatosPremio = paths['/api/v1/lealtad/premios']['post']['requestBody']['content']['application/json']
type CambiosPremio = paths['/api/v1/lealtad/premios/{id}']['put']['requestBody']['content']['application/json']

const MONTO = /^\d{1,12}(\.\d{1,2})?$/
const MENSAJE_MONTO = 'Monto con hasta 2 decimales, sin comas'

/** Catálogo de premios (A3, `contratos/lealtad.md`): qué entrega cada tipo. */
export const TIPOS_PREMIO: Record<TipoPremio, { etiqueta: string, icono: string, descripcion: string }> = {
    descuento_factura: { etiqueta: 'Descuento en factura', icono: 'i-lucide-percent', descripcion: 'Un monto o porcentaje de la próxima factura (o de una emitida, con nota de crédito)' },
    mes_gratis: { etiqueta: 'Mes gratis', icono: 'i-lucide-calendar-heart', descripcion: 'El próximo periodo queda bonificado' },
    mejora_plan: { etiqueta: 'Mejora de plan', icono: 'i-lucide-rocket', descripcion: 'Un plan mejor por unos días (plan temporal)' },
    bien: { etiqueta: 'Bien físico', icono: 'i-lucide-gift', descripcion: 'Un artículo que se entrega en oficina' },
    boletos: { etiqueta: 'Boletos de sorteo', icono: 'i-lucide-ticket', descripcion: 'Participaciones en un sorteo que admite canjes' },
}

export const ESTADOS_CANJE: Record<Canje['estado'], { etiqueta: string, color: BadgeProps['color'] }> = {
    reservado: { etiqueta: 'Reservado', color: 'info' },
    aplicado: { etiqueta: 'Aplicado', color: 'success' },
    revertido: { etiqueta: 'Revertido', color: 'neutral' },
    rechazado: { etiqueta: 'Rechazado', color: 'error' },
}

const montoOpcional = z.string().trim().refine(v => v === '' || MONTO.test(v), MENSAJE_MONTO)
const enteroNulable = (min: number, max: number) => z.number().int('Solo enteros').min(min, `Entre ${min} y ${max}`).max(max, `Entre ${min} y ${max}`).nullable()

/**
 * Espejo de `crearPremioValidator` / `editarPremioValidator` y de `camposDelTipo` (A3): los campos
 * que pide cada tipo (descuento: tipo y valor ≤ 100 si es %; mejora: plan y días; boletos: sorteo y
 * cantidad). La API vacía los que el tipo no usa y valida el sorteo y el plan.
 */
export const esquemaPremio = z.object({
    tipo: z.enum(['descuento_factura', 'mes_gratis', 'mejora_plan', 'bien', 'boletos']),
    nombre: z.string().trim().min(1, 'Escribe el nombre').max(120, 'Máximo 120 caracteres'),
    costo_puntos: z.number({ message: 'Escribe los puntos' }).int('Puntos enteros').min(1, 'Al menos 1 punto').max(10_000_000, 'Máximo 10 000 000'),
    descuento_tipo: z.enum(['monto', 'porcentaje']),
    descuento_valor: montoOpcional,
    tope: montoOpcional,
    plan_destino_id: z.number().int().min(1).nullable(),
    dias: enteroNulable(1, 366),
    costo_unitario: montoOpcional,
    existencias: z.number().int('Solo enteros').min(0, 'No puede ser negativo').nullable(),
    sorteo_id: z.number().int().min(1).nullable(),
    boletos: enteroNulable(1, 1000),
    en_portal: z.boolean(),
    activo: z.boolean(),
}).superRefine((d, ctx) => {
    const falta = (campo: string, mensaje: string) => ctx.addIssue({ code: 'custom', path: [campo], message: mensaje })
    if (d.tipo === 'descuento_factura') {
        if (!d.descuento_valor) {
            falta('descuento_valor', 'Obligatorio en un descuento')
        }
        else if (d.descuento_tipo === 'porcentaje' && MONTO.test(d.descuento_valor) && new Decimal(d.descuento_valor).gt(100)) {
            falta('descuento_valor', 'Un porcentaje no pasa de 100')
        }
    }
    if (d.tipo === 'mejora_plan') {
        if (d.plan_destino_id === null) {
            falta('plan_destino_id', 'Obligatorio en una mejora de plan')
        }
        if (d.dias === null) {
            falta('dias', 'Obligatorio en una mejora de plan')
        }
    }
    if (d.tipo === 'boletos') {
        if (d.sorteo_id === null) {
            falta('sorteo_id', 'Obligatorio en un premio de boletos')
        }
        if (d.boletos === null) {
            falta('boletos', 'Obligatorio en un premio de boletos')
        }
    }
})

export type EntradaPremio = z.input<typeof esquemaPremio>
export type SalidaPremio = z.output<typeof esquemaPremio>

export function entradaPremio(premio: Premio | null): EntradaPremio {
    return {
        tipo: premio?.tipo ?? 'descuento_factura',
        nombre: premio?.nombre ?? '',
        costo_puntos: premio?.costo_puntos ?? 500,
        descuento_tipo: premio?.descuento_tipo ?? 'monto',
        descuento_valor: premio?.descuento_valor ?? '',
        tope: premio?.tope ?? '',
        plan_destino_id: premio?.plan_destino_id ?? null,
        dias: premio?.dias ?? null,
        costo_unitario: premio?.costo_unitario ?? '',
        existencias: premio?.existencias ?? null,
        sorteo_id: premio?.sorteo_id ?? null,
        boletos: premio?.boletos ?? null,
        en_portal: premio?.en_portal ?? false,
        activo: premio?.activo ?? true,
    }
}

const dosDecimales = (v: string): string | null => (v ? new Decimal(v).toFixed(2) : null)

/** Solo los campos del tipo; los demás viajan `null`, como los deja `camposDelTipo`. */
function camposDelTipo(d: SalidaPremio) {
    return {
        descuento_tipo: d.tipo === 'descuento_factura' ? d.descuento_tipo : null,
        descuento_valor: d.tipo === 'descuento_factura' ? dosDecimales(d.descuento_valor) : null,
        tope: d.tipo === 'descuento_factura' && d.descuento_tipo === 'porcentaje' ? dosDecimales(d.tope) : null,
        plan_destino_id: d.tipo === 'mejora_plan' ? d.plan_destino_id : null,
        dias: d.tipo === 'mejora_plan' ? d.dias : null,
        costo_unitario: d.tipo === 'bien' ? dosDecimales(d.costo_unitario) : null,
        existencias: d.existencias,
        sorteo_id: d.tipo === 'boletos' ? d.sorteo_id : null,
        boletos: d.tipo === 'boletos' ? d.boletos : null,
    }
}

export function cuerpoPremio(programaId: number, d: SalidaPremio): DatosPremio {
    return { programa_id: programaId, tipo: d.tipo, nombre: d.nombre, costo_puntos: d.costo_puntos, ...camposDelTipo(d), en_portal: d.en_portal, activo: d.activo }
}

/** El tipo no se cambia al editar (la API no lo acepta en el `PUT`). */
export function cambiosPremio(premio: Pick<Premio, 'version'>, d: SalidaPremio): CambiosPremio {
    return { version: premio.version, nombre: d.nombre, costo_puntos: d.costo_puntos, ...camposDelTipo(d), en_portal: d.en_portal, activo: d.activo }
}

/** Qué entrega el premio, en palabras. */
export function resumenPremio(premio: Pick<Premio, 'tipo' | 'descuento_tipo' | 'descuento_valor' | 'tope' | 'dias' | 'boletos' | 'existencias'>): string {
    const partes: string[] = []
    if (premio.tipo === 'descuento_factura' && premio.descuento_valor) {
        partes.push(premio.descuento_tipo === 'porcentaje'
            ? `${premio.descuento_valor} %${premio.tope ? ` (hasta ${formatearQuetzales(premio.tope)})` : ''}`
            : formatearQuetzales(premio.descuento_valor))
    }
    if (premio.tipo === 'mejora_plan' && premio.dias) {
        partes.push(`${premio.dias} ${premio.dias === 1 ? 'día' : 'días'}`)
    }
    if (premio.tipo === 'boletos' && premio.boletos) {
        partes.push(`${premio.boletos} ${premio.boletos === 1 ? 'boleto' : 'boletos'}`)
    }
    if (premio.existencias !== null) {
        partes.push(`${premio.existencias} disponibles`)
    }
    return partes.join(' · ') || TIPOS_PREMIO[premio.tipo].descripcion
}
