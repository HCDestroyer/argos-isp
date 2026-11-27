import type { Schema } from '@argosisp/contracts'
import Decimal from 'decimal.js'
import { z } from 'zod'

/**
 * Cajas y efectivo (tablero PlanCajas, plan de contabilidad §5.7, lotes B1 y B9): el efectivo
 * está solo en cuatro lugares (cajas de cobros, custodia, caja chica y en camino al banco) y se
 * mueve solo por cuatro caminos (entrega, depósito, reposición y gasto). Espejos de los
 * validadores de `ledger/validators` y la lista «De dónde a dónde» del camino del efectivo.
 */

type Entrega = Schema<'EntregaCaja'>
type DepositoApi = Schema<'Deposito'>
type EgresoApi = Schema<'Egreso'>
type Reposicion = Schema<'ReposicionCaja'>

const MONTO = /^\d{1,12}(\.\d{1,2})?$/
const FECHA = /^\d{4}-\d{2}-\d{2}$/

/** Una caja chica es una caja de gastos (`tipo = gastos`); sin tipo, de cobros (antes de B1). */
export function esCajaChica(caja: Pick<Schema<'Caja'>, 'tipo'>): boolean {
    return caja.tipo === 'gastos'
}

/** Número del documento como lo dice el tablero: `E-031`, `D-015`, `G-118`, `R-006`. */
export function numeroMovimiento(prefijo: 'E' | 'D' | 'G' | 'R', id: number): string {
    return `${prefijo}-${String(id).padStart(3, '0')}`
}

export type TipoMovimiento = 'entrega' | 'deposito' | 'gasto' | 'reposicion'

export const TIPOS_MOVIMIENTO: Record<TipoMovimiento, { etiqueta: string, icono: string }> = {
    entrega: { etiqueta: 'Entrega', icono: 'i-lucide-banknote' },
    deposito: { etiqueta: 'Depósito', icono: 'i-lucide-landmark' },
    gasto: { etiqueta: 'Gasto', icono: 'i-lucide-receipt' },
    reposicion: { etiqueta: 'Reposición', icono: 'i-lucide-refresh-cw' },
}

export interface EstadoMovimiento {
    etiqueta: string
    color: 'success' | 'warning' | 'info' | 'error' | 'neutral'
    icono: string
}

export interface MovimientoEfectivo {
    clave: string
    numero: string
    tipo: TipoMovimiento
    /** «Caja Central (Karla Ruiz) → Marta Gómez». */
    trayecto: string
    /** Instante (ISO) o día (`YYYY-MM-DD`) para ordenar y mostrar. */
    cuando: string
    detalle: string | null
    monto: string
    estado: EstadoMovimiento
    /** La acción que le toca a quien mira: recibir su entrega o depositar lo que recibió. */
    accion: 'recibir' | 'depositar' | null
    entregaId: number | null
}

export function estadoEntrega(entrega: Pick<Entrega, 'estado'>): EstadoMovimiento {
    if (entrega.estado === 'por_recibir') {
        return { etiqueta: 'Por recibir', color: 'warning', icono: 'i-lucide-clock' }
    }
    if (entrega.estado === 'rechazada') {
        return { etiqueta: 'No recibida', color: 'error', icono: 'i-lucide-circle-x' }
    }
    return { etiqueta: 'Recibida', color: 'success', icono: 'i-lucide-check' }
}

export function estadoDeposito(deposito: Pick<DepositoApi, 'estado'>): EstadoMovimiento {
    return deposito.estado === 'acreditado'
        ? { etiqueta: 'Confirmado por el banco', color: 'success', icono: 'i-lucide-check' }
        : { etiqueta: 'En camino', color: 'info', icono: 'i-lucide-clock' }
}

/** Gasto de caja chica: sin su comprobante no se puede reponer (422 `gastos_sin_comprobante`). */
export function estadoGasto(gasto: Pick<EgresoApi, 'estado' | 'con_comprobante' | 'reposicion_id'>): EstadoMovimiento {
    if (gasto.estado === 'anulado') {
        return { etiqueta: 'Anulado', color: 'neutral', icono: 'i-lucide-ban' }
    }
    if (gasto.con_comprobante === false) {
        return { etiqueta: 'Sin comprobante', color: 'warning', icono: 'i-lucide-triangle-alert' }
    }
    return { etiqueta: gasto.reposicion_id ? 'Repuesto' : 'Con comprobante', color: 'success', icono: 'i-lucide-check' }
}

/** Quién tiene el turno de una caja: «Caja Central (Karla Ruiz)». */
function conPersona(lugar: string, persona: string | null | undefined): string {
    return persona ? `${lugar} (${persona})` : lugar
}

/**
 * Los cuatro caminos del efectivo en una sola lista, del más reciente al más viejo. `usuarioId`
 * decide la acción de cada fila: recibir una entrega dirigida a ti o depositar lo que recibiste.
 */
export function movimientosEfectivo(
    datos: { entregas: readonly Entrega[], depositos: readonly DepositoApi[], gastos: readonly EgresoApi[], reposiciones: readonly Reposicion[] },
    usuarioId: number | null,
): MovimientoEfectivo[] {
    const filas: MovimientoEfectivo[] = [
        ...datos.entregas.map(e => ({
            clave: `e-${e.id}`,
            numero: numeroMovimiento('E', e.id),
            tipo: 'entrega' as const,
            trayecto: `${conPersona(e.caja_nombre, e.entregado_por_nombre)} → ${e.autoentrega ? 'su custodia' : (e.recibe_nombre ?? 'quien recibe')}`,
            cuando: e.recibido_en ?? e.created_at,
            detalle: e.autoentrega ? '«Lo deposito yo»' : null,
            monto: e.monto,
            estado: estadoEntrega(e),
            accion: e.recibe_id === usuarioId ? (e.estado === 'por_recibir' ? 'recibir' as const : e.estado === 'recibida' ? 'depositar' as const : null) : null,
            entregaId: e.id,
        })),
        ...datos.depositos.map(d => ({
            clave: `d-${d.id}`,
            numero: numeroMovimiento('D', d.id),
            tipo: 'deposito' as const,
            trayecto: `${d.origen === 'custodia' ? (d.custodio_nombre ?? 'Custodia') : (d.caja_nombre ?? 'Caja')} → ${d.cuenta_nombre}`,
            cuando: d.created_at,
            detalle: `boleta ${d.boleta}`,
            monto: d.monto,
            estado: estadoDeposito(d),
            accion: null,
            entregaId: null,
        })),
        ...datos.gastos.map(g => ({
            clave: `g-${g.id}`,
            numero: numeroMovimiento('G', g.id),
            tipo: 'gasto' as const,
            trayecto: `${g.caja_nombre ?? 'Caja chica'} → ${g.descripcion ?? g.categoria_nombre}`,
            cuando: g.created_at,
            detalle: g.con_comprobante === false ? 'sin comprobante' : 'con comprobante',
            monto: g.monto,
            estado: estadoGasto(g),
            accion: null,
            entregaId: null,
        })),
        ...datos.reposiciones.map(r => ({
            clave: `r-${r.id}`,
            numero: numeroMovimiento('R', r.id),
            tipo: 'reposicion' as const,
            trayecto: `${r.origen === 'custodia' ? `Custodia de ${r.custodio_nombre ?? 'quien repuso'}` : `Banco${r.referencia ? ` (${r.referencia})` : ''}`} → ${r.caja_nombre}`,
            cuando: r.created_at,
            detalle: `${r.gastos} ${r.gastos === 1 ? 'comprobante' : 'comprobantes'}`,
            monto: r.monto,
            estado: { etiqueta: 'Hecha', color: 'success' as const, icono: 'i-lucide-check' },
            accion: null,
            entregaId: null,
        })),
    ]
    return filas.sort((a, b) => b.cuando.localeCompare(a.cuando))
}

/** Suma de montos (strings decimales de la API) con `decimal.js`. */
export function sumaMontos(montos: readonly string[]): Decimal {
    return montos.reduce((suma, monto) => suma.plus(monto), new Decimal(0))
}

function montoMayorQueCero(mensaje: string) {
    return z.string()
        .trim()
        .regex(MONTO, mensaje)
        .refine(valor => !MONTO.test(valor) || new Decimal(valor).gt(0), 'El monto debe ser mayor que cero')
}

/**
 * Espejo de `gastoCajaChicaValidator` y `RegistrarGastoCajaChica`: categoría del enum, monto > 0
 * sin tope por gasto (decisión del PM) pero no mayor que el efectivo de la caja (422
 * `efectivo_insuficiente`), en qué se gastó (2 a 500) y el comprobante obligatorio.
 */
export function esquemaGastoCajaChica(efectivo: Decimal | null) {
    return z.object({
        monto: montoMayorQueCero('Escribe un monto con hasta 2 decimales, sin comas (ej. 150.00)')
            .refine(valor => !MONTO.test(valor) || efectivo === null || new Decimal(valor).lte(efectivo), `No alcanza: en la caja chica hay ${efectivo ? formatearQuetzales(efectivo) : ''}`),
        categoria: z.enum(['energia', 'transito', 'nomina', 'vehiculos', 'alquileres', 'otros'], { message: 'Elige el tipo de gasto' }),
        descripcion: z.string().trim().min(2, 'Escribe en qué se gastó').max(500, 'Máximo 500 caracteres'),
        con_factura: z.boolean(),
        archivo: z.custom<File | null>(valor => typeof File !== 'undefined' && valor instanceof File, 'Sube la foto del ticket, la factura o el recibo firmado'),
    })
}

export type EntradaGastoCajaChica = z.input<ReturnType<typeof esquemaGastoCajaChica>>

/** Motivo obligatorio (3 letras) cuando lo contado no es lo esperado; `contado` ≥ 0. */
function esquemaConteo(esperado: Decimal | null, etiqueta: string) {
    return z.object({
        contado: z.string().trim().regex(MONTO, 'Escribe un monto con hasta 2 decimales, sin comas (ej. 1180.00)'),
        motivo: z.string().trim().max(500, 'Máximo 500 caracteres'),
    }).superRefine((datos, ctx) => {
        if (esperado && MONTO.test(datos.contado) && !new Decimal(datos.contado).equals(esperado) && datos.motivo.length < 3) {
            ctx.addIssue({ code: 'custom', path: ['motivo'], message: `No es ${etiqueta}: explica la diferencia` })
        }
    })
}

/** Espejo de `contarCajaValidator`: lo contado y el motivo si no cuadra con el libro. */
export function esquemaContarCaja(esperado: Decimal | null) {
    return esquemaConteo(esperado, 'lo que debe haber')
}

/** Espejo de `recibirEntregaValidator`: lo contado y el motivo si no es lo entregado. */
export function esquemaRecibirEntrega(entregado: Decimal | null) {
    return esquemaConteo(entregado, 'lo entregado')
}

export type EntradaConteo = z.input<ReturnType<typeof esquemaContarCaja>>

/**
 * Espejo de `depositarCustodiaValidator`: monto > 0 que no supere tu custodia (422
 * `deposito_excede_custodia`), boleta de 1 a 80, fecha no futura y la cuenta que recibe.
 */
export function esquemaDepositoCustodia(hoy: string, custodia: Decimal | null) {
    return z.object({
        monto: montoMayorQueCero('Escribe un monto con hasta 2 decimales, sin comas (ej. 2050.00)')
            .refine(valor => !MONTO.test(valor) || custodia === null || new Decimal(valor).lte(custodia), `No puede superar lo que tienes en custodia${custodia ? ` (${formatearQuetzales(custodia)})` : ''}`),
        boleta: z.string().trim().min(1, 'Escribe el número de la boleta').max(80, 'Máximo 80 caracteres'),
        fecha: z.string()
            .trim()
            .refine(valor => valor === '' || FECHA.test(valor), 'Elige una fecha válida (día, mes y año)')
            .refine(valor => valor === '' || valor <= hoy, 'La fecha del depósito no puede ser futura'),
        cuenta_id: z.number().int().positive().nullable().refine(valor => valor !== null, 'Elige la cuenta que recibe el depósito'),
    })
}

export type EntradaDepositoCustodia = z.input<ReturnType<typeof esquemaDepositoCustodia>>

/**
 * Espejo de `reponerCajaChicaValidator`: desde tu custodia o desde el banco (una cuenta propia o,
 * sin ella, el banco principal), con la referencia del cheque o retiro (hasta 120).
 */
export const esquemaReponerCajaChica = z.object({
    desde: z.enum(['custodia', 'banco']),
    cuenta_bancaria_id: z.number().int().positive().nullable(),
    referencia: z.string().trim().max(120, 'Máximo 120 caracteres'),
})

export type EntradaReponerCajaChica = z.input<typeof esquemaReponerCajaChica>

/**
 * Cuándo, como lo dice el tablero: «hoy 09:12», «ayer 18:10» o «22 nov». Recibe un instante (ISO,
 * se muestra en hora de Guatemala) o un día (`YYYY-MM-DD`, sin hora).
 */
export function cuandoEfectivo(valor: string, ahora: Date = new Date()): string {
    const hoy = hoyGuatemala(ahora)
    const conHora = valor.length > 10
    const dia = conHora ? fechaGuatemala(valor) : valor
    const hora = conHora ? ` ${formatearHora(valor)}` : ''
    if (dia === hoy) {
        return `hoy${hora}`
    }
    if (dia === sumarDiasFecha(hoy, -1)) {
        return `ayer${hora}`
    }
    return formatearFechaCorta(dia, ahora)
}

/** Días completos desde `desde` (`YYYY-MM-DD`) hasta hoy en Guatemala: la custodia más vieja. */
export function diasDesde(desde: string, ahora: Date = new Date()): number {
    return Math.max(0, Math.round((Date.parse(`${hoyGuatemala(ahora)}T00:00:00Z`) - Date.parse(`${desde}T00:00:00Z`)) / 86_400_000))
}
