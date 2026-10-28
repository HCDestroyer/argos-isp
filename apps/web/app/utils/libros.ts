import type { Problem, Schema, paths } from '@argosisp/contracts'
import type { BadgeProps } from '@nuxt/ui'
import { z } from 'zod'

/**
 * Libros legales con folio (A3, fase 6 PR D, contrato fiscal §7 y §20). Diario, Mayor, Compras y
 * Ventas: la vista previa (`GET /libros/<libro>`) es un «Borrador sin folio» de cualquier rango; la
 * emisión oficial (`POST /libros/:libro/emitir`) toma meses completos, cerrados y bajo el bloqueo
 * global o duro, y gasta folios de un rango habilitado (`POST /libros/habilitaciones`). Una emisión
 * cuyo rango se cruza con otra anterior del mismo libro es una reimpresión (folios nuevos y la marca).
 */

export type LibroHabilitable = Schema<'HabilitacionLibro'>['libro']
export type LibroEmitible = NonNullable<paths['/api/v1/libros/{libro}/emitir']['post']['parameters']['path']>['libro']
export type FoliosLibro = Schema<'FoliosLibro'>
export type HabilitacionLibro = Schema<'HabilitacionLibro'>
export type EmisionLibro = Schema<'EmisionLibro'>
export type FormatoEmision = EmisionLibro['formato']
export type FormatoVistaPrevia = 'csv' | 'xlsx' | 'pdf'

type OperacionVista<L extends LibroEmitible> = paths[`/api/v1/libros/${L}`]['get']
export type ReporteLibro<L extends LibroEmitible> = OperacionVista<L>['responses'][200]['content']['application/json']
export type ReporteLibroCualquiera = ReporteLibro<LibroEmitible>
export type QueryVistaPrevia = Omit<NonNullable<OperacionVista<'diario'>['parameters']['query']>, 'formato'>
export type CuerpoEmitir = paths['/api/v1/libros/{libro}/emitir']['post']['requestBody']['content']['application/json']
export type CuerpoHabilitar = paths['/api/v1/libros/habilitaciones']['post']['requestBody']['content']['application/json']
export type FiltrosLibros = Omit<NonNullable<paths['/api/v1/libros/emisiones']['get']['parameters']['query']>, 'cursor'>

type Color = NonNullable<BadgeProps['color']>

export const LIBROS: Record<LibroHabilitable, { etiqueta: string, legal: string, descripcion: string, icono: string }> = {
    diario: { etiqueta: 'Diario', legal: 'Libro Diario', descripcion: 'Cada partida con sus movimientos y su total, en orden cronológico.', icono: 'i-lucide-book-open' },
    mayor: { etiqueta: 'Mayor', legal: 'Libro Mayor', descripcion: 'Por cuenta: saldo inicial, movimientos con su saldo y saldo final.', icono: 'i-lucide-library' },
    ventas: { etiqueta: 'Ventas', legal: 'Libro de Ventas y Servicios Prestados', descripcion: 'DTE certificados y, sin FEL, facturas y notas de crédito del mes.', icono: 'i-lucide-receipt-text' },
    compras: { etiqueta: 'Compras', legal: 'Libro de Compras y Servicios Recibidos', descripcion: 'Compras por mes del IVA y anulaciones en el mes de su reverso.', icono: 'i-lucide-shopping-cart' },
    inventarios: { etiqueta: 'Inventarios', legal: 'Libro de Inventarios', descripcion: 'Se puede habilitar; la emisión desde el panel no está disponible.', icono: 'i-lucide-boxes' },
    estados_financieros: { etiqueta: 'Estados financieros', legal: 'Libro de Estados Financieros', descripcion: 'Se puede habilitar; la emisión desde el panel no está disponible.', icono: 'i-lucide-scale' },
}

/** Los que la API ya emite (404 para los demás). */
export const LIBROS_EMITIBLES: readonly LibroEmitible[] = ['diario', 'mayor', 'ventas', 'compras']
/** Los que se habilitan (`fiscal.libros_habilitados`), en el orden de la API. */
export const LIBROS_HABILITABLES: readonly LibroHabilitable[] = ['diario', 'mayor', 'inventarios', 'estados_financieros', 'compras', 'ventas']

export function esLibroEmitible(valor: unknown): valor is LibroEmitible {
    return typeof valor === 'string' && (LIBROS_EMITIBLES as readonly string[]).includes(valor)
}

export function esLibroHabilitable(valor: unknown): valor is LibroHabilitable {
    return typeof valor === 'string' && (LIBROS_HABILITABLES as readonly string[]).includes(valor)
}

export const FORMATOS_EMISION: Record<FormatoEmision, { etiqueta: string, descripcion: string, icono: string }> = {
    pdf: { etiqueta: 'PDF', descripcion: 'Carta horizontal, un folio por página, «Van» y «Vienen».', icono: 'i-lucide-file-text' },
    xlsx: { etiqueta: 'Excel', descripcion: 'Las mismas filas, cada una con el folio de su página; gasta los mismos folios.', icono: 'i-lucide-file-spreadsheet' },
}

/* Filas: la columna `fila` distingue movimientos de totales y saldos (Diario y Mayor). */

export type TipoFilaLibro = 'movimiento' | 'total' | 'saldo_inicial' | 'saldo_final'

/** `movimiento` si la fila no trae `fila` (Ventas y Compras: todas son movimientos). */
export function tipoFila(fila: Record<string, unknown>): TipoFilaLibro {
    const valor = fila.fila
    return valor === 'total' || valor === 'saldo_inicial' || valor === 'saldo_final' ? valor : 'movimiento'
}

/** Las filas que no son movimiento van en negrita (totales de partida, saldos inicial y final). */
export function esFilaResumen(fila: Record<string, unknown>): boolean {
    return tipoFila(fila) !== 'movimiento'
}

/** Columnas que se pintan: `fila` es interna (solo decide la negrita). */
export function columnasLibro(columnas: readonly Schema<'ColumnaReporte'>[]): Schema<'ColumnaReporte'>[] {
    return columnas.filter(c => c.clave !== 'fila')
}

/* Meses: la emisión toma meses completos. */

const MES = /^\d{4}-(0[1-9]|1[0-2])$/
const FECHA = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/

/** `2026-09` → `2026-09-01`. */
export function primerDiaMes(mes: string): string {
    return `${mes.slice(0, 7)}-01`
}

/** `2026-09` → `2026-09-30`. */
export function ultimoDiaMes(mes: string): string {
    return finDePeriodo(primerDiaMes(mes))
}

/** Los últimos `cantidad` meses (`AAAA-MM`) hasta el de `hoy`, del más reciente al más viejo. */
export function mesesRecientes(hoy: string, cantidad = 36): string[] {
    return periodosRecientes(hoy, cantidad).map(p => p.slice(0, 7))
}

/** `desde`–`hasta` de una emisión como texto: «septiembre 2026» o «julio 2026 a septiembre 2026». */
export function periodoEmision(desde: string, hasta: string): string {
    const inicio = etiquetaPeriodo(desde.slice(0, 7))
    const fin = etiquetaPeriodo(hasta.slice(0, 7))
    return inicio === fin ? inicio : `${inicio} a ${fin}`
}

/** «Folio 9» o «Folios 9 a 13». */
export function rangoFolios(inicial: number, final: number): string {
    return inicial === final ? `Folio ${inicial}` : `Folios ${inicial} a ${final}`
}

/** Folio con el que debe empezar la siguiente habilitación: el siguiente al último habilitado. */
export function folioDesdePropuesto(folios: readonly FoliosLibro[], libro: LibroHabilitable): number | null {
    const actual = folios.find(f => f.libro === libro)
    return actual?.ultimo_habilitado === null || actual?.ultimo_habilitado === undefined ? null : actual.ultimo_habilitado + 1
}

/** Cómo va un libro: sin habilitación, agotado, pocos (≤ 10) o con folios. */
export function estadoFolios(folios: FoliosLibro): { etiqueta: string, color: Color } {
    if (folios.siguiente === null && folios.ultimo_habilitado === null) {
        return { etiqueta: 'Sin habilitación', color: 'neutral' }
    }
    if (folios.disponibles === 0) {
        return { etiqueta: 'Folios agotados', color: 'error' }
    }
    if (folios.disponibles <= 10) {
        return { etiqueta: `Quedan ${folios.disponibles}`, color: 'warning' }
    }
    return { etiqueta: `${folios.disponibles} disponibles`, color: 'success' }
}

/** Nombre del archivo descargado de una emisión: `libro-diario-2026-09-folios-9-13.pdf`. */
export function nombreArchivoEmision(emision: EmisionLibro): string {
    return `libro-${emision.libro}-${emision.desde.slice(0, 7)}${emision.hasta.slice(0, 7) === emision.desde.slice(0, 7) ? '' : `-a-${emision.hasta.slice(0, 7)}`}-folios-${emision.folio_inicial}-${emision.folio_final}.${emision.formato}`
}

/** Nombre del borrador: `libro-diario-2026-09-01-2026-09-30-borrador.csv`, como el de la API. */
export function nombreBorrador(libro: LibroEmitible, desde: string, hasta: string, formato: FormatoVistaPrevia): string {
    return `libro-${libro}-${desde}-${hasta}-borrador.${formato}`
}

/* Esquemas espejo de los validadores (`#fiscal/validators_libros`). */

const fecha = z.string().trim().regex(FECHA, 'Fecha inválida (AAAA-MM-DD)')

/** Vista previa: cualquier rango; `hasta` no antes de `desde`. */
export const esquemaVistaPrevia = z.object({
    desde: fecha,
    hasta: fecha,
}).refine(d => d.hasta >= d.desde, { path: ['hasta'], message: 'Debe ser igual o posterior a «Desde»' })

/**
 * Emitir (`POST /libros/:libro/emitir`): meses completos, `hasta` no antes de `desde` y no después del
 * mes en curso; el cierre y el bloqueo los revisa la API (422 `periodo_sin_bloqueo`). Gasta folios:
 * la confirmación es obligatoria.
 */
export function esquemaEmitir(hoy: string) {
    const mesActual = hoy.slice(0, 7)
    const mes = z.string().regex(MES, 'Elija un mes')
    return z.object({
        desde: mes,
        hasta: mes,
        formato: z.enum(['pdf', 'xlsx']),
        confirmo: z.boolean(),
    }).superRefine((d, ctx) => {
        if (MES.test(d.desde) && MES.test(d.hasta) && d.hasta < d.desde) {
            ctx.addIssue({ code: 'custom', path: ['hasta'], message: 'Debe ser igual o posterior al mes inicial' })
        }
        if (MES.test(d.hasta) && d.hasta > mesActual) {
            ctx.addIssue({ code: 'custom', path: ['hasta'], message: 'No se emite un mes futuro' })
        }
        if (!d.confirmo) {
            ctx.addIssue({ code: 'custom', path: ['confirmo'], message: 'Confirme que la emisión gasta folios' })
        }
    })
}

/**
 * Habilitar (`POST /libros/habilitaciones`): autorización de 3 a 120, folios enteros positivos con
 * `folio_hasta ≥ folio_desde`, fecha no futura, nota hasta 500. Con habilitaciones previas del libro,
 * `folio_desde` debe ser el siguiente al último habilitado (422 `habilitacion_no_correlativa`).
 */
export function esquemaHabilitar(hoy: string, folios: readonly FoliosLibro[]) {
    const folio = z.number({ message: 'Número de folio' }).int('Folio entero').min(1, 'Desde el folio 1')
    return z.object({
        libro: z.enum(['diario', 'mayor', 'inventarios', 'estados_financieros', 'compras', 'ventas']),
        autorizacion: z.string().trim().min(3, 'Número de la autorización (mínimo 3 caracteres)').max(120, 'Hasta 120 caracteres'),
        folio_desde: folio,
        folio_hasta: folio,
        fecha,
        nota: z.string().trim().max(500, 'Hasta 500 caracteres'),
    }).superRefine((d, ctx) => {
        if (Number.isInteger(d.folio_desde) && Number.isInteger(d.folio_hasta) && d.folio_hasta < d.folio_desde) {
            ctx.addIssue({ code: 'custom', path: ['folio_hasta'], message: 'Debe ser igual o mayor que el folio inicial' })
        }
        if (FECHA.test(d.fecha) && d.fecha > hoy) {
            ctx.addIssue({ code: 'custom', path: ['fecha'], message: 'La fecha de la autorización no puede ser futura' })
        }
        const propuesto = folioDesdePropuesto(folios, d.libro)
        if (propuesto !== null && Number.isInteger(d.folio_desde) && d.folio_desde !== propuesto) {
            ctx.addIssue({ code: 'custom', path: ['folio_desde'], message: `Debe ser ${propuesto}: el siguiente al último habilitado` })
        }
    })
}

/* Errores con un título que se entiende y qué hacer. */

/** Un paso para resolver un error: el texto y, si aplica, la pantalla donde se hace. */
export interface PasoLibro {
    texto: string
    accion?: { etiqueta: string, ruta: string, permiso: string }
}

const CERRAR_MES = { etiqueta: 'Ir a cierres', ruta: '/libro?tab=cierres', permiso: 'libro.cerrar_periodo' }
const BLOQUEAR = { etiqueta: 'Ir a bloqueos', ruta: '/libro/bloqueos', permiso: 'libro.bloquear' }
const INTEGRIDAD = { etiqueta: 'Ver integridad', ruta: '/libro?tab=integridad', permiso: 'libro.ver' }

const TITULOS: Record<string, string> = {
    periodo_sin_bloqueo: 'El periodo todavía no se puede emitir',
    folios_agotados: 'No hay folios habilitados suficientes',
    integridad_rota: 'La cadena del libro no verifica',
    archivo_alterado: 'El archivo de la emisión fue alterado',
    habilitacion_no_correlativa: 'La habilitación no es correlativa',
    empresa_requerida: 'Elija la empresa',
}

/** El error de la API con un título claro (el detalle de la API se conserva). */
export function problemaLibroLegible(problema: Problem): Problem {
    const codigo = codigoProblema(problema)
    return codigo && Object.hasOwn(TITULOS, codigo) ? { ...problema, title: TITULOS[codigo] ?? problema.title } : problema
}

/**
 * Qué hacer con cada error de los libros: por cada mes abierto, cerrarlo; sin bloqueo, bloquear el
 * libro (global o duro) hasta el fin del rango; sin folios, registrar la habilitación; con la cadena
 * rota, revisar la integridad. Lista vacía si el error no es de los libros. Con `libro`, «Registrar
 * habilitación» abre el formulario de ese libro.
 */
export function pasosProblemaLibro(problema: Problem, libro?: LibroHabilitable): PasoLibro[] {
    const codigo = codigoProblema(problema)
    if (codigo === 'periodo_sin_bloqueo') {
        return (problema.errors ?? []).map((e) => {
            if (e.rule === 'mes_abierto') {
                return { texto: `${e.message}: ciérrelo (con su lista de verificación) en Libro → Cierres.`, accion: CERRAR_MES }
            }
            if (e.rule === 'sin_bloqueo') {
                return { texto: `${e.message}: bloquee el libro (global o duro) hasta el último día del rango.`, accion: BLOQUEAR }
            }
            return { texto: e.message }
        })
    }
    if (codigo === 'folios_agotados') {
        const necesita = (problema.errors ?? []).map(e => e.message).filter(m => m !== 'Sin rango habilitado')
        const ruta = libro ? `/libros/habilitaciones?libro=${libro}&nueva=1` : '/libros/habilitaciones'
        return [{ texto: `${necesita.length ? `${necesita.join(' · ')}. ` : ''}Registre la habilitación de folios del libro (autorización SAT-7121) y vuelva a emitir.`, accion: { etiqueta: 'Registrar habilitación', ruta, permiso: 'libros.habilitar' } }]
    }
    if (codigo === 'integridad_rota') {
        return [{ texto: 'No se emite hasta que la cadena de hash del rango verifique. Revise la integridad del libro y avise al administrador.', accion: INTEGRIDAD }]
    }
    if (codigo === 'archivo_alterado') {
        return [{ texto: 'Su SHA-256 ya no coincide con el registrado al emitir: el archivo no se entrega. Avise al administrador; una reimpresión genera folios nuevos.' }]
    }
    return []
}
