import type { Problem, Schema } from '@argosisp/contracts'

/**
 * Declaraciones de IVA (SAT-2237) y de pequeño contribuyente (SAT-2046) (A3, fase 7 PR B; contrato
 * fiscal §21 PR B): etiquetas de impuestos, estados y secciones de los totales, qué acciones admite
 * cada versión y los problemas con qué hacer. Los montos vienen de la API: aquí no se calcula nada.
 */

type Declaracion = Schema<'Declaracion'>
type BadgeColor = 'primary' | 'secondary' | 'success' | 'info' | 'warning' | 'error' | 'neutral'

export type ImpuestoDeclarable = Declaracion['impuesto']
export type EstadoDeclaracion = Declaracion['estado']
export type SeccionRenglon = Schema<'RenglonDeclaracion'>['seccion']
export type SeccionCalculo = Schema<'RenglonCalculo'>['seccion']
export type PeriodicidadDeclaracion = 'mensual' | 'trimestral' | 'anual'

export const IMPUESTOS_DECLARABLES: Record<ImpuestoDeclarable, { etiqueta: string, formulario: string | null, icono: string, periodicidad: PeriodicidadDeclaracion }> = {
    iva_mensual: { etiqueta: 'IVA mensual', formulario: 'SAT-2237', icono: 'i-lucide-percent', periodicidad: 'mensual' },
    pc_mensual: { etiqueta: 'Pequeño contribuyente', formulario: 'SAT-2046', icono: 'i-lucide-store', periodicidad: 'mensual' },
    isr_opcional_mensual: { etiqueta: 'ISR opcional mensual', formulario: 'SAT-1311', icono: 'i-lucide-landmark', periodicidad: 'mensual' },
    isr_trimestral: { etiqueta: 'ISR trimestral', formulario: 'SAT-1361', icono: 'i-lucide-landmark', periodicidad: 'trimestral' },
    iso_trimestral: { etiqueta: 'ISO trimestral', formulario: 'SAT-1608', icono: 'i-lucide-hand-heart', periodicidad: 'trimestral' },
    isr_anual: { etiqueta: 'ISR anual', formulario: 'SAT-1411', icono: 'i-lucide-calendar-range', periodicidad: 'anual' },
    retenciones_iva: { etiqueta: 'Retenciones de IVA', formulario: 'SAT-2340', icono: 'i-lucide-scissors', periodicidad: 'mensual' },
    retenciones_isr: { etiqueta: 'Retenciones de ISR', formulario: null, icono: 'i-lucide-scissors', periodicidad: 'mensual' },
}

export const IMPUESTOS_DECLARABLES_ORDEN = Object.keys(IMPUESTOS_DECLARABLES) as ImpuestoDeclarable[]

export function esImpuestoDeclarable(valor: unknown): valor is ImpuestoDeclarable {
    return typeof valor === 'string' && valor in IMPUESTOS_DECLARABLES
}

/** Etiqueta del impuesto de una declaración. */
export function etiquetaImpuestoDeclaracion(impuesto: Declaracion['impuesto']): string {
    return IMPUESTOS_DECLARABLES[impuesto].etiqueta
}

/** Formulario del impuesto, o «por confirmar con contador» (retenciones de ISR). */
export function formularioImpuesto(impuesto: ImpuestoDeclarable): string {
    return IMPUESTOS_DECLARABLES[impuesto].formulario ?? 'formulario por confirmar'
}

/** IVA y pequeño contribuyente: remanentes, cascada (H34), libros emitidos y checks `iva_*`. */
export function esIvaOPc(impuesto: ImpuestoDeclarable): boolean {
    return impuesto === 'iva_mensual' || impuesto === 'pc_mensual'
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

/** El periodo como lo pide la API para el impuesto: `AAAA-MM`, `AAAA-Tn` o `AAAA`. */
export function periodoDeclaracion(d: Pick<Declaracion, 'periodo_desde' | 'impuesto'>): string {
    const periodicidad = IMPUESTOS_DECLARABLES[d.impuesto].periodicidad
    if (periodicidad === 'anual') {
        return d.periodo_desde.slice(0, 4)
    }
    if (periodicidad === 'trimestral') {
        return `${d.periodo_desde.slice(0, 4)}-T${Math.floor((Number(d.periodo_desde.slice(5, 7)) - 1) / 3) + 1}`
    }
    return d.periodo_desde.slice(0, 7)
}

/** «septiembre 2026», «3.er trimestre 2026» o «año 2025». */
export function etiquetaPeriodoDeclaracion(d: Pick<Declaracion, 'periodo_desde' | 'impuesto'>): string {
    return periodoObligacion({ periodicidad: IMPUESTOS_DECLARABLES[d.impuesto].periodicidad, periodo_desde: d.periodo_desde })
}

/** El periodo que normalmente se declara hoy: el mes, el trimestre o el año anterior. */
export function periodoPorDeclarar(impuesto: ImpuestoDeclarable, hoy: string): string {
    const anio = Number(hoy.slice(0, 4))
    const mes = Number(hoy.slice(5, 7))
    const periodicidad = IMPUESTOS_DECLARABLES[impuesto].periodicidad
    if (periodicidad === 'anual') {
        return String(anio - 1)
    }
    if (periodicidad === 'trimestral') {
        const actual = Math.floor((mes - 1) / 3) + 1
        return actual === 1 ? `${anio - 1}-T4` : `${anio}-T${actual - 1}`
    }
    return mesPorDeclarar(hoy)
}

/** El texto de un `AAAA-MM`, `AAAA-Tn` o `AAAA` (filtros y formularios). */
export function etiquetaPeriodoTexto(periodo: string): string {
    const trimestre = /^(\d{4})-T([1-4])$/.exec(periodo)
    if (trimestre) {
        return `${['1.er', '2.º', '3.er', '4.º'][Number(trimestre[2]) - 1]} trimestre ${trimestre[1]}`
    }
    return /^\d{4}$/.test(periodo) ? `año ${periodo}` : etiquetaPeriodo(periodo)
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

const SECCIONES_ISR_OPCIONAL: SeccionTotales[] = [
    { id: 'base', titulo: 'Base', filas: [
        { clave: 'base', etiqueta: 'Ventas sin IVA del mes', ayuda: 'Del libro de ventas, gravadas y exentas' },
        { clave: 'base_retenida', etiqueta: 'Base retenida', ayuda: 'La que ya tuvo retención definitiva' },
        { clave: 'base_no_retenida', etiqueta: 'Base no retenida' },
    ] },
    { id: 'determinado', titulo: 'Impuesto determinado', filas: [
        { clave: 'isr_art44', etiqueta: 'ISR por la escala (art. 44)' },
        { clave: 'isr_art46', etiqueta: 'Retenciones + 7 % de lo no retenido (art. 46)' },
        { clave: 'isr', etiqueta: 'ISR del mes', destacado: true },
    ] },
    { id: 'liquidacion', titulo: 'Liquidación', filas: [
        { clave: 'retenciones', etiqueta: 'Retenciones de ISR recibidas' },
        { clave: 'retenciones_usadas', etiqueta: 'Retenciones usadas' },
        { clave: 'a_pagar', etiqueta: 'ISR a pagar', destacado: true },
    ] },
]

const FILAS_RENTA: FilaTotal[] = [
    { clave: 'ingresos', etiqueta: 'Ingresos' },
    { clave: 'gastos', etiqueta: 'Gastos' },
    { clave: 'no_deducibles', etiqueta: 'Gastos no deducibles (suman)' },
    { clave: 'ajustes_suma', etiqueta: 'Ajustes fiscales que suman' },
    { clave: 'ajustes_resta', etiqueta: 'Ajustes fiscales que restan' },
    { clave: 'renta_imponible', etiqueta: 'Renta imponible', destacado: true },
]

const SECCIONES_ISR_TRIMESTRAL: SeccionTotales[] = [
    { id: 'renta', titulo: 'Renta imponible', filas: FILAS_RENTA },
    { id: 'determinado', titulo: 'Impuesto determinado', filas: [{ clave: 'isr', etiqueta: 'ISR del trimestre', destacado: true }] },
    { id: 'iso', titulo: 'ISO acreditable', filas: [
        { clave: 'iso_disponible', etiqueta: 'ISO disponible', ayuda: 'De los tres años anteriores, el que vence primero' },
        { clave: 'iso_acreditado', etiqueta: 'ISO acreditado' },
    ] },
    { id: 'liquidacion', titulo: 'Liquidación', filas: [{ clave: 'a_pagar', etiqueta: 'ISR a pagar', destacado: true }] },
]

const SECCIONES_ISO: SeccionTotales[] = [
    { id: 'base', titulo: 'Base del año anterior', filas: [
        { clave: 'activo_neto', etiqueta: 'Activo neto' },
        { clave: 'ingresos_brutos', etiqueta: 'Ingresos brutos' },
        { clave: 'costo_ventas', etiqueta: 'Costo de ventas' },
        { clave: 'base_activo', etiqueta: 'Cuarta parte del activo neto' },
        { clave: 'base_ingresos', etiqueta: 'Cuarta parte de los ingresos brutos' },
        { clave: 'base', etiqueta: 'Base del trimestre', destacado: true },
    ] },
    { id: 'determinado', titulo: 'Impuesto determinado', filas: [{ clave: 'impuesto', etiqueta: 'ISO del trimestre', destacado: true }] },
    { id: 'liquidacion', titulo: 'Liquidación', filas: [{ clave: 'a_pagar', etiqueta: 'ISO a pagar', destacado: true }] },
]

const SECCIONES_ISR_ANUAL: SeccionTotales[] = [
    { id: 'renta', titulo: 'Renta imponible del año', filas: FILAS_RENTA },
    { id: 'determinado', titulo: 'Impuesto determinado', filas: [{ clave: 'isr', etiqueta: 'ISR del año', destacado: true }] },
    { id: 'acreditamientos', titulo: 'Pagos trimestrales e ISO', filas: [
        { clave: 'pagos_trimestrales', etiqueta: 'Pagos trimestrales del año' },
        { clave: 'trimestral_acreditado', etiqueta: 'Pagos trimestrales acreditados' },
        { clave: 'saldo_a_favor', etiqueta: 'Saldo a favor (queda en 1.1.07)' },
        { clave: 'iso_disponible', etiqueta: 'ISO disponible' },
        { clave: 'iso_acreditado', etiqueta: 'ISO acreditado' },
        { clave: 'iso_por_vencer', etiqueta: 'ISO que vence este año sin acreditar', ayuda: 'Pasa a gasto (5.3.03) en el cierre anual' },
    ] },
    { id: 'liquidacion', titulo: 'Liquidación', filas: [{ clave: 'a_pagar', etiqueta: 'ISR a pagar', destacado: true }] },
]

const SECCIONES_RETENCIONES: SeccionTotales[] = [
    { id: 'retenciones', titulo: 'Retenciones hechas en las compras', filas: [
        { clave: 'base', etiqueta: 'Base de las retenciones' },
        { clave: 'retenido', etiqueta: 'Retenido en el mes' },
    ] },
    { id: 'liquidacion', titulo: 'Liquidación', filas: [{ clave: 'a_pagar', etiqueta: 'A enterar a la SAT', destacado: true }] },
]

export function seccionesTotales(impuesto: Declaracion['impuesto']): SeccionTotales[] {
    switch (impuesto) {
        case 'pc_mensual':
            return SECCIONES_PC
        case 'iva_mensual':
            return SECCIONES_IVA
        case 'isr_opcional_mensual':
            return SECCIONES_ISR_OPCIONAL
        case 'isr_trimestral':
            return SECCIONES_ISR_TRIMESTRAL
        case 'iso_trimestral':
            return SECCIONES_ISO
        case 'isr_anual':
            return SECCIONES_ISR_ANUAL
        default:
            return SECCIONES_RETENCIONES
    }
}

/** El total es un porcentaje y no un monto (`margen_bruto` del ISO). */
export const TOTALES_PORCENTAJE: readonly string[] = ['margen_bruto']

export const SECCIONES_CALCULO: Record<SeccionCalculo, { etiqueta: string, icono: string }> = {
    resultados: { etiqueta: 'Resultados', icono: 'i-lucide-trending-up' },
    ajustes: { etiqueta: 'Ajustes fiscales', icono: 'i-lucide-sliders-horizontal' },
    declaraciones: { etiqueta: 'Pagos trimestrales', icono: 'i-lucide-file-spreadsheet' },
    iso: { etiqueta: 'ISO acreditado', icono: 'i-lucide-hand-heart' },
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
    /** Anular el pago vigente (reverso) para registrar otro. */
    anularPago: boolean
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
        anularPago: d.pago !== null,
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
    cascada_bloqueada: 'Un mes posterior no se puede rectificar',
    regla_no_soportada: 'El sistema todavía no calcula esa regla',
    parametro_sin_confirmar: 'Falta un valor que debe confirmar el contador',
    periodo: 'El periodo no tiene el formato del impuesto',
    declaracion_sin_pago: 'Esta versión no tiene un pago vigente',
    ajuste_anulado: 'Ese ajuste ya está anulado',
    ejercicio_cerrado: 'El ejercicio está cerrado',
    iso_sin_saldo: 'El ISO acreditado supera el disponible',
    isr_de_declaracion: 'El ISR sale de la declaración anual',
    declaracion_sin_revisar: 'La declaración ISR anual no está revisada',
    isr_acreditable: 'Lo acreditado pasa del ISR',
    ejercicio_requisitos: 'El ejercicio todavía no se puede cerrar',
    ejercicio_abierto: 'El ejercicio no está cerrado',
    reapertura_fuera_de_orden: 'Primero hay que reabrir el año siguiente',
}

const QUE_HACER: Record<string, string> = {
    declaracion_revisada: 'Para corregirla, calcule una sustitutiva: su revisión liquida solo la diferencia.',
    declaracion_presentada: 'Para corregirla, calcule una sustitutiva: su revisión liquida solo la diferencia.',
    declaracion_desactualizada: 'Calcule otra versión con los datos de hoy y revísela.',
    declaracion_sustituida: 'Abra la versión vigente del periodo.',
    ncre_sin_certificar: 'Certifique las NCRE pendientes o anule las rechazadas y vuelva a revisar.',
    checks_pendientes: 'Revise la lista de verificación de impuestos del mes: corrija la causa o supervise la anomalía con una nota.',
    periodo_en_curso: 'Se revisa y liquida después del último día del mes.',
    cascada_bloqueada: 'Resuelva la causa en el mes indicado (por ejemplo, certifique sus NCRE) y vuelva a revisar: nada se guardó.',
    regla_no_soportada: 'ArgosIsp no calcula ese criterio: confirme con el contador el valor del parámetro o presente esta declaración fuera del sistema.',
    parametro_sin_confirmar: 'Pida al contador que lo confirme en Configuración → Fiscal → Parámetros.',
    declaracion_sin_pago: 'Ya no tiene pago que anular: puede registrar uno nuevo.',
    ejercicio_cerrado: 'Para cambiar el ISR anual o sus ajustes, reabra el ejercicio en Libro → Ejercicios.',
    isr_de_declaracion: 'No escriba el ISR: el cierre toma el de la declaración ISR anual revisada.',
    declaracion_sin_revisar: 'Revise la declaración ISR anual del año antes de cerrar el ejercicio.',
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

/** Parámetro, su valor y el criterio de un 422 `regla_no_soportada` (`errors[0]` y `detail`), o `null`. */
export function reglaNoSoportadaDe(problema: Problem | null): { parametro: string, valor: string, explicacion: string } | null {
    if (!problema || codigoProblema(problema) !== 'regla_no_soportada') {
        return null
    }
    const error = problema.errors?.[0]
    return { parametro: error?.field ?? 'parámetro', valor: (error?.message ?? '').replace(/^Valor /, ''), explicacion: problema.detail ?? '' }
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

export interface MesCascadaBloqueada {
    periodo: string
    /** `null` = rectificable; si no, el código de la causa (`ncre_sin_certificar`, `checks_pendientes`…). */
    causa: string | null
    mensaje: string
}

/** Los meses de un 409 `cascada_bloqueada`: `field` = AAAA-MM, `rule` = `ok` o el código de la causa. */
export function cascadaBloqueadaDe(problema: Problem | null): MesCascadaBloqueada[] {
    if (!problema || codigoProblema(problema) !== 'cascada_bloqueada') {
        return []
    }
    return (problema.errors ?? []).map(e => ({ periodo: e.field, causa: e.rule === 'ok' ? null : (e.rule ?? 'error'), mensaje: e.message }))
}

/** «noviembre 2026, versión 3 (estaba presentada: hay que presentar la rectificativa)». */
export function textoMesRectificado(mes: Pick<Schema<'DeclaracionRevisada'>['cascada'][number], 'periodo' | 'version' | 'estaba_presentada'>): string {
    return `${etiquetaPeriodo(mes.periodo)}, versión ${mes.version}${mes.estaba_presentada ? ' (estaba presentada: hay que presentar la rectificativa)' : ''}`
}

/** ISR anual y retenciones no tienen asiento de liquidación (lo provisiona el cierre anual o ya están en 2.1.04/2.1.05). */
export function sinAsiento(impuesto: ImpuestoDeclarable): boolean {
    return impuesto === 'isr_anual' || impuesto === 'retenciones_iva' || impuesto === 'retenciones_isr'
}

/** Qué hace revisar según el impuesto (contrato §21 PR C, «Revisión según el impuesto»). */
export function efectoRevision(impuesto: ImpuestoDeclarable, periodo: string): { titulo: string, puntos: string[], resumen: string } {
    if (esIvaOPc(impuesto)) {
        return {
            titulo: 'Revisar registra la liquidación y bloquea los impuestos del mes',
            puntos: [
                'Asiento de liquidación en el diario de impuestos (en una sustitutiva, por la diferencia y con fecha de hoy).',
                `Bloqueo de impuestos hasta el último día de ${periodo}: ningún asiento con impuesto podrá caer en ese mes ni antes.`,
                'Antes verifica que el IVA de los libros cuadre con este borrador y que no haya NCRE sin certificar.',
            ],
            resumen: `Liquidación registrada y los impuestos de ${periodo} bloqueados.`,
        }
    }
    if (impuesto === 'retenciones_iva' || impuesto === 'retenciones_isr') {
        return {
            titulo: 'Revisar bloquea los impuestos del mes (sin asiento)',
            puntos: [
                'Las retenciones ya están en su cuenta por pagar (2.1.04 o 2.1.05): no hay asiento de liquidación.',
                `Bloqueo de impuestos hasta el último día de ${periodo}.`,
                'Antes verifica que las retenciones del libro cuadren con las de las compras (retenciones_cuadradas).',
            ],
            resumen: `Retenciones revisadas y los impuestos de ${periodo} bloqueados.`,
        }
    }
    if (impuesto === 'isr_anual') {
        return {
            titulo: 'Revisar fija el ISR del año (sin asiento)',
            puntos: [
                'El cierre anual provisiona el ISR con estos montos: esta revisión no registra asiento.',
                'Con el ejercicio cerrado ya no se puede recalcular ni revisar (reábralo en Libro → Ejercicios).',
            ],
            resumen: `ISR de ${periodo} revisado: el cierre anual lo tomará de esta declaración.`,
        }
    }
    return {
        titulo: 'Revisar registra la liquidación (sin bloqueo de impuestos)',
        puntos: [
            'Asiento de liquidación con fecha del fin del periodo, o del primer día abierto si ese mes está cerrado; una sustitutiva liquida la diferencia.',
            'No fija el bloqueo de impuestos ni exige checks del mes.',
            ...(impuesto === 'iso_trimestral' ? [] : ['Antes verifica que no haya NCRE sin certificar en el libro de ventas que lee.']),
        ],
        resumen: `Liquidación de ${periodo} registrada.`,
    }
}

/** El total del impuesto determinado de cada impuesto (columna de la lista). */
export const CLAVE_DETERMINADO: Record<ImpuestoDeclarable, string> = {
    iva_mensual: 'impuesto_determinado',
    pc_mensual: 'impuesto',
    isr_opcional_mensual: 'isr',
    isr_trimestral: 'isr',
    iso_trimestral: 'impuesto',
    isr_anual: 'isr',
    retenciones_iva: 'retenido',
    retenciones_isr: 'retenido',
}
