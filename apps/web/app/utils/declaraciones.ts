import type { Problem, Schema } from '@argosisp/contracts'

/**
 * Declaraciones de IVA (SAT-2237) y de pequeño contribuyente (SAT-2046) (A3, fase 7 PR B; contrato
 * fiscal §21 PR B): etiquetas de impuestos, estados y secciones de los totales, qué acciones admite
 * cada versión y los problemas con qué hacer. Los montos vienen de la API: aquí no se calcula nada.
 */

type Declaracion = Schema<'Declaracion'>
type BadgeColor = 'primary' | 'secondary' | 'success' | 'info' | 'warning' | 'error' | 'neutral'

export type ImpuestoDeclarable = 'iva_mensual' | 'pc_mensual'
export type EstadoDeclaracion = Declaracion['estado']
export type SeccionRenglon = Schema<'RenglonDeclaracion'>['seccion']

export const IMPUESTOS_DECLARABLES: Record<ImpuestoDeclarable, { etiqueta: string, formulario: string, icono: string }> = {
    iva_mensual: { etiqueta: 'IVA mensual', formulario: 'SAT-2237', icono: 'i-lucide-percent' },
    pc_mensual: { etiqueta: 'Pequeño contribuyente', formulario: 'SAT-2046', icono: 'i-lucide-store' },
}

export const IMPUESTOS_DECLARABLES_ORDEN = Object.keys(IMPUESTOS_DECLARABLES) as ImpuestoDeclarable[]

export function esImpuestoDeclarable(valor: unknown): valor is ImpuestoDeclarable {
    return valor === 'iva_mensual' || valor === 'pc_mensual'
}

/** Etiqueta del impuesto de una declaración (los demás llegan en la PR C). */
export function etiquetaImpuestoDeclaracion(impuesto: Declaracion['impuesto']): string {
    return esImpuestoDeclarable(impuesto) ? IMPUESTOS_DECLARABLES[impuesto].etiqueta : impuesto.replace(/_/g, ' ')
}

export const ESTADOS_DECLARACION: Record<EstadoDeclaracion, { etiqueta: string, color: BadgeColor, icono: string, ayuda: string }> = {
    borrador: { etiqueta: 'Borrador', color: 'info', icono: 'i-lucide-file-pen-line', ayuda: 'Calculada desde los libros; todavía sin liquidar.' },
    revisada: { etiqueta: 'Revisada', color: 'warning', icono: 'i-lucide-file-check', ayuda: 'Liquidada y con los impuestos del mes bloqueados; falta registrar que se presentó.' },
    presentada: { etiqueta: 'Presentada', color: 'success', icono: 'i-lucide-circle-check', ayuda: 'Se registró su presentación en la SAT.' },
    sustituida: { etiqueta: 'Sustituida', color: 'neutral', icono: 'i-lucide-history', ayuda: 'Una versión posterior la reemplaza.' },
}

export const ESTADOS_DECLARACION_ORDEN = Object.keys(ESTADOS_DECLARACION) as EstadoDeclaracion[]

export const SECCIONES_RENGLON: Record<SeccionRenglon, { etiqueta: string, columnaIva: string, icono: string }> = {
    ventas: { etiqueta: 'Ventas', columnaIva: 'IVA (débito)', icono: 'i-lucide-receipt-text' },
    compras: { etiqueta: 'Compras', columnaIva: 'Crédito fiscal', icono: 'i-lucide-shopping-cart' },
    retenciones: { etiqueta: 'Retenciones', columnaIva: 'Retenido', icono: 'i-lucide-scissors' },
}

/** `AAAA-MM` de la declaración. */
export function periodoDeclaracion(d: Pick<Declaracion, 'periodo_desde'>): string {
    return d.periodo_desde.slice(0, 7)
}

export interface FilaTotal {
    clave: string
    etiqueta: string
    ayuda?: string
    destacado?: boolean
}

export interface SeccionTotales {
    id: string
    titulo: string
    filas: FilaTotal[]
}

/** Secciones de los totales del IVA: débitos, créditos, retenciones, impuesto determinado y liquidación. */
const SECCIONES_IVA: SeccionTotales[] = [
    {
        id: 'debitos',
        titulo: 'Débitos',
        filas: [
            { clave: 'base_ventas', etiqueta: 'Base de ventas' },
            { clave: 'debito', etiqueta: 'IVA de ventas (débito)', ayuda: 'Del libro de ventas del mes' },
            { clave: 'total_ventas', etiqueta: 'Total de ventas' },
        ],
    },
    {
        id: 'creditos',
        titulo: 'Créditos',
        filas: [
            { clave: 'base_compras', etiqueta: 'Base de compras' },
            { clave: 'credito', etiqueta: 'IVA de compras (crédito)', ayuda: 'Del libro de compras del mes del IVA' },
            { clave: 'remanente_credito_anterior', etiqueta: 'Remanente de crédito del mes anterior' },
        ],
    },
    {
        id: 'retenciones',
        titulo: 'Retenciones',
        filas: [
            { clave: 'retenciones', etiqueta: 'Retenciones de IVA recibidas', ayuda: 'Constancias del mes del pago' },
            { clave: 'remanente_retenciones_anterior', etiqueta: 'Remanente de retenciones del mes anterior' },
        ],
    },
    {
        id: 'determinado',
        titulo: 'Impuesto determinado',
        filas: [
            { clave: 'impuesto_determinado', etiqueta: 'Débito − crédito − retenciones', destacado: true },
        ],
    },
    {
        id: 'liquidacion',
        titulo: 'Liquidación y remanentes',
        filas: [
            { clave: 'credito_usado', etiqueta: 'Crédito usado' },
            { clave: 'retenciones_usadas', etiqueta: 'Retenciones usadas' },
            { clave: 'a_pagar', etiqueta: 'IVA a pagar', destacado: true },
            { clave: 'remanente_credito', etiqueta: 'Remanente de crédito para el mes siguiente' },
            { clave: 'remanente_retenciones', etiqueta: 'Remanente de retenciones para el mes siguiente' },
        ],
    },
]

/** Secciones del pequeño contribuyente: ventas, impuesto (porcentaje sobre ventas), retenciones y liquidación. */
const SECCIONES_PC: SeccionTotales[] = [
    {
        id: 'ventas',
        titulo: 'Ventas',
        filas: [
            { clave: 'ventas', etiqueta: 'Ventas del mes (libro de ventas)' },
            { clave: 'base', etiqueta: 'Base del impuesto' },
            { clave: 'iva_en_ventas', etiqueta: 'IVA separado en las ventas', ayuda: 'Debe ser cero: el pequeño contribuyente factura sin separar IVA' },
        ],
    },
    {
        id: 'determinado',
        titulo: 'Impuesto determinado',
        filas: [
            { clave: 'impuesto', etiqueta: 'Impuesto sobre ventas', destacado: true },
        ],
    },
    {
        id: 'retenciones',
        titulo: 'Retenciones',
        filas: [
            { clave: 'retenciones', etiqueta: 'Retenciones recibidas' },
            { clave: 'remanente_retenciones_anterior', etiqueta: 'Remanente del mes anterior' },
            { clave: 'retenciones_usadas', etiqueta: 'Retenciones usadas' },
        ],
    },
    {
        id: 'liquidacion',
        titulo: 'Liquidación',
        filas: [
            { clave: 'a_pagar', etiqueta: 'Impuesto a pagar', destacado: true },
            { clave: 'remanente_retenciones', etiqueta: 'Remanente de retenciones para el mes siguiente' },
        ],
    },
]

export function seccionesTotales(impuesto: Declaracion['impuesto']): SeccionTotales[] {
    return impuesto === 'pc_mensual' ? SECCIONES_PC : SECCIONES_IVA
}

/** Monto de un total, o `null` si la API no lo trae (se muestra «—», nunca un cero inventado). */
export function totalDe(d: Pick<Declaracion, 'totales'>, clave: string): string | null {
    const valor = d.totales[clave]
    return typeof valor === 'string' ? valor : null
}

/** Tasa del pequeño contribuyente que usó el borrador (`parametros`, `impuesto:IVA_PC`), o `null`. */
export function tasaPequenoContribuyente(d: Pick<Declaracion, 'parametros'>): string | null {
    const valor = d.parametros.find(p => p.clave === 'impuesto:IVA_PC')?.valor
    return typeof valor === 'string' || typeof valor === 'number' ? String(valor) : null
}

/** La versión vigente del periodo (la de mayor número) entre las del mismo impuesto y mes. */
export function versionVigente<T extends Pick<Declaracion, 'version'>>(versiones: readonly T[]): T | null {
    return [...versiones].sort((a, b) => b.version - a.version)[0] ?? null
}

export interface AccionesDeclaracion {
    revisar: boolean
    presentar: boolean
    pagar: boolean
    /** Otra versión: un borrador nuevo o, tras revisar, una sustitutiva. */
    recalcular: boolean
    sustitutiva: boolean
}

/** Lo que admite una versión según su estado (los permisos los pone la pantalla). */
export function accionesDeclaracion(d: Pick<Declaracion, 'estado' | 'pago' | 'totales'>): AccionesDeclaracion {
    const liquidada = d.estado === 'revisada' || d.estado === 'presentada'
    const aPagar = Number(d.totales.a_pagar ?? '0') > 0
    return {
        revisar: d.estado === 'borrador',
        presentar: d.estado === 'revisada',
        pagar: liquidada && d.pago === null && aPagar,
        recalcular: d.estado !== 'sustituida',
        sustitutiva: liquidada,
    }
}

const TITULOS: Record<string, string> = {
    declaracion_revisada: 'Esa declaración ya está revisada',
    declaracion_presentada: 'Esa declaración ya está presentada',
    declaracion_desactualizada: 'Los datos cambiaron desde que se calculó',
    declaracion_sustituida: 'Esta versión fue sustituida',
    declaracion_no_revisada: 'Primero hay que revisarla',
    declaracion_pagada: 'Esta versión ya tiene su pago',
    ncre_sin_certificar: 'Hay notas de crédito sin certificar',
    periodo_en_curso: 'El mes todavía no termina',
    checks_pendientes: 'El IVA no cuadra con los libros',
    antes_de_inicio_libros: 'Antes del inicio de los libros',
    obligacion_no_aplica: 'La empresa no tiene esa obligación en el mes',
    impuesto_no_soportado: 'Impuesto todavía no soportado',
    sin_monto_a_pagar: 'No hay impuesto por pagar',
    cuenta_de_otra_empresa: 'La cuenta es de otra empresa',
}

const QUE_HACER: Record<string, string> = {
    declaracion_revisada: 'Para corregirla, calcule una sustitutiva: su revisión liquida solo la diferencia.',
    declaracion_presentada: 'Para corregirla, calcule una sustitutiva: su revisión liquida solo la diferencia.',
    declaracion_desactualizada: 'Calcule otra versión con los datos de hoy y revísela.',
    declaracion_sustituida: 'Abra la versión vigente del periodo.',
    ncre_sin_certificar: 'Certifique las NCRE pendientes o anule las rechazadas y vuelva a revisar.',
    checks_pendientes: 'Revise la lista de verificación de impuestos del mes: corrija la causa o supervise la anomalía con una nota.',
    periodo_en_curso: 'Se revisa y liquida después del último día del mes.',
}

/** Problema con título legible y qué hacer (el `detail` de la API se conserva). */
export function problemaDeclaracionLegible(problema: Problem): Problem {
    const codigo = codigoProblema(problema) ?? problema.errors?.find(e => e.rule && e.rule in TITULOS)?.rule ?? null
    const titulo = codigo ? TITULOS[codigo] : undefined
    if (!titulo) {
        return problemaFiscalLegible(problema)
    }
    const sugerencia = codigo ? QUE_HACER[codigo] : undefined
    const detalle = sugerencia ? `${problema.detail ?? ''} ${sugerencia}`.trim() : problema.detail
    return { ...problema, title: titulo, ...(detalle ? { detail: detalle } : {}) }
}

/** El 409 que pide una sustitutiva al calcular (la última versión ya está revisada o presentada). */
export function pideSustitutiva(problema: Problem | null): boolean {
    const codigo = problema ? codigoProblema(problema) : null
    return codigo === 'declaracion_revisada' || codigo === 'declaracion_presentada'
}

/** Mes anterior a `hoy` (`AAAA-MM`): el que normalmente se declara. */
export function mesPorDeclarar(hoy: string): string {
    const [anio = 0, mes = 0] = hoy.split('-').map(Number)
    return new Date(Date.UTC(anio, mes - 2, 1)).toISOString().slice(0, 7)
}

export const METODOS_PAGO_DECLARACION: Record<'caja' | 'banco' | 'cuenta_bancaria', string> = {
    caja: 'Caja',
    banco: 'Banco del libro',
    cuenta_bancaria: 'Cuenta bancaria propia',
}
