import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import { fechaCalendario, fechaCorta, quetzales } from '#notify/formato'
import { nombreImpuesto, periodoLegible } from '#notify/calendario_fiscal'

/**
 * Variables `alerta.*` de los avisos internos que no son de red ni de FEL: bloqueos del libro y
 * cierres contables (A3, fase 6), libros emitidos, declaraciones calculadas y presentadas (fase 7)
 * y sorteos (lealtad fase 3). Solo arman texto; leen lo mínimo de la base para los nombres. Las
 * reglas de quién recibe cada aviso y su incidente están en `actions/registrar_alerta.ts`.
 */

type Payload = Record<string, unknown>

function texto(valor: unknown): string {
    return valor === undefined || valor === null ? '' : String(valor)
}

function entero(valor: unknown): number | null {
    const n = Number(valor)
    return valor !== null && valor !== '' && Number.isInteger(n) && n > 0 ? n : null
}

/** `dd/MM/yyyy` de un `YYYY-MM-DD` (o '' si no hay). */
function fechaLocal(valor: unknown): string {
    if (valor instanceof Date) return fechaCorta(fechaCalendario(valor))
    const t = texto(valor)
    if (!t) return ''
    const fecha = fechaCalendario(t)
    return fecha.isValid ? fechaCorta(fecha) : t
}

function montoQ(valor: unknown): string {
    const t = texto(valor)
    return t ? quetzales(t) : ''
}

// ── Libro contable ───────────────────────────────────────────────────────────────────────────

/** Qué impide cada tipo de bloqueo (`#ledger/bloqueos`, `TIPOS_BLOQUEO`). */
const TIPOS_BLOQUEO_TEXTO: Record<string, string> = {
    global: 'bloqueo general del libro',
    ventas: 'bloqueo de ventas',
    compras: 'bloqueo de compras',
    impuestos: 'bloqueo de impuestos',
    duro: 'cierre definitivo (bloqueo duro)',
}

export function tipoBloqueoTexto(tipo: unknown): string {
    return TIPOS_BLOQUEO_TEXTO[texto(tipo)] ?? (texto(tipo) || 'bloqueo del libro')
}

/** Tipo de incidente de `libro.proceso_bloqueado` (lo abre `RegistrarAlerta`, lo cierra `VigilarCrons`). */
export const TIPO_PROCESO_BLOQUEADO = 'libro_proceso'

/** Procesos que emiten `libro.proceso_bloqueado` (crons de A3) y qué documentos detienen. */
export const PROCESOS_BLOQUEABLES: Record<string, { descripcion: string; documentos: string }> = {
    'facturas.generar': { descripcion: 'La generación de facturas', documentos: 'servicios' },
    'facturas.vencer_pendientes': {
        descripcion: 'El vencimiento de facturas y la mora',
        documentos: 'facturas',
    },
}

export function descripcionProceso(proceso: unknown): string {
    return PROCESOS_BLOQUEABLES[texto(proceso)]?.descripcion ?? `El proceso ${texto(proceso) || '?'}`
}

/** `libro.proceso_bloqueado`: qué proceso, qué bloqueo y cuántos documentos quedaron pendientes. */
export function variablesProcesoBloqueado(p: Payload): Record<string, unknown> {
    const proceso = texto(p.proceso)
    const ejemplos = Array.isArray(p.ejemplos) ? p.ejemplos.map(texto).filter(Boolean) : []
    const documentos = Number(p.documentos ?? 0) || 0
    return {
        proceso,
        descripcion: descripcionProceso(proceso),
        tipo: texto(p.tipo),
        tipo_texto: tipoBloqueoTexto(p.tipo),
        hasta: fechaLocal(p.hasta),
        fecha: fechaLocal(p.fecha),
        documentos,
        que_documentos: PROCESOS_BLOQUEABLES[proceso]?.documentos ?? 'documentos',
        ejemplos: ejemplos.join(', '),
        mas_ejemplos: documentos > ejemplos.length,
    }
}

/** `libro.checks_verificados` con anomalías. */
export function variablesChecks(p: Payload): Record<string, unknown> {
    const anomalias = anomaliasDe(p)
    const tipos: Record<string, string> = {
        mensual: 'cierre mensual',
        impuestos: 'cierre de impuestos',
        anual: 'cierre anual',
    }
    return {
        tipo: texto(p.tipo),
        tipo_texto: tipos[texto(p.tipo)] ?? texto(p.tipo),
        periodo: texto(p.periodo),
        anomalias: anomalias.join(', '),
        cantidad: anomalias.length,
        varias: anomalias.length > 1,
    }
}

/** Claves en anomalía, únicas y ordenadas (para la clave del incidente). */
export function anomaliasDe(p: Payload): string[] {
    const lista = Array.isArray(p.anomalias) ? p.anomalias.map(texto).filter(Boolean) : []
    return [...new Set(lista)].sort()
}

/** `ejercicio.cerrado` y `ejercicio.reabierto`. */
export function variablesEjercicio(p: Payload): Record<string, unknown> {
    const resultado = texto(p.resultado)
    return {
        cierre_id: texto(p.cierre_id),
        anio: texto(p.anio),
        resultado_q: montoQ(resultado),
        perdida: resultado.startsWith('-'),
        isr_q: montoQ(p.isr),
        reserva_legal_q: montoQ(p.reserva_legal),
        motivo: texto(p.motivo),
    }
}

const LIBROS: Record<string, string> = {
    diario: 'Libro diario',
    mayor: 'Libro mayor',
    compras: 'Libro de compras',
    ventas: 'Libro de ventas',
}

/** `libro.emitido`: libro, periodo, folios, formato y huella del archivo. */
export function variablesLibroEmitido(p: Payload): Record<string, unknown> {
    return {
        emision_id: texto(p.emision_id),
        libro: LIBROS[texto(p.libro)] ?? (texto(p.libro) || 'Libro'),
        periodo: periodoLegible(texto(p.desde).slice(0, 10), texto(p.hasta).slice(0, 10)),
        folio_inicial: texto(p.folio_inicial),
        folio_final: texto(p.folio_final),
        formato: texto(p.formato).toUpperCase(),
        sha256: texto(p.sha256),
        reimpresion: entero(p.reimpresion_de) !== null,
        reimpresion_de: texto(p.reimpresion_de),
    }
}

/** `libro.bloqueo_cambiado`: tipo, nuevo `hasta` (null = sin bloqueo) y el anterior. */
export function variablesBloqueo(p: Payload): Record<string, unknown> {
    const hasta = fechaLocal(p.hasta)
    const anterior = fechaLocal(p.anterior)
    return {
        tipo: texto(p.tipo),
        tipo_texto: tipoBloqueoTexto(p.tipo),
        hasta,
        anterior,
        quitado: !hasta,
        es_duro: texto(p.tipo) === 'duro',
    }
}

// ── Declaraciones ────────────────────────────────────────────────────────────────────────────

/** `declaracion.calculada` y `declaracion.presentada` (formulario y fecha de la presentación). */
export async function variablesDeclaracion(
    trx: TransactionClientContract,
    evento: string,
    p: Payload,
): Promise<Record<string, unknown>> {
    const base = {
        declaracion_id: texto(p.declaracion_id),
        impuesto: nombreImpuesto(p.impuesto),
        periodo: periodoLegible(p.periodo_desde, p.periodo_hasta),
        version: texto(p.version),
        vence: fechaLocal(p.vence_en),
        monto_q: quetzales(texto(p.monto) || '0'),
        rectificativa: Number(p.version ?? 1) > 1,
    }
    if (evento !== 'declaracion.presentada') return base
    const id = entero(p.declaracion_id)
    const fila = id
        ? ((await trx
              .from('fiscal.declaraciones')
              .where('id', id)
              .select('numero_formulario', 'fecha_presentacion')
              .first()) as {
              numero_formulario: string | null
              fecha_presentacion: Date | string | null
          } | null)
        : null
    return {
        ...base,
        formulario: texto(fila?.numero_formulario),
        presentada_el: fechaLocal(fila?.fecha_presentacion ?? null),
    }
}

// ── Sorteos ──────────────────────────────────────────────────────────────────────────────────

async function sorteo(trx: TransactionClientContract, id: number | null) {
    if (!id) return null
    return (await trx
        .from('lealtad.sorteos')
        .where('id', id)
        .select('nombre', 'fecha_sorteo', 'lugar')
        .first()) as { nombre: string; fecha_sorteo: Date | null; lugar: string | null } | null
}

async function nombreCliente(trx: TransactionClientContract, clienteId: unknown): Promise<string> {
    const id = entero(clienteId)
    if (!id) return ''
    const fila = (await trx.from('core.clientes').where('id', id).select('nombre').first()) as {
        nombre: string
    } | null
    return fila ? `${fila.nombre} (#${id})` : `#${id}`
}

/** Variables de las alertas internas de sorteos (nombre del sorteo y del cliente, si aplica). */
export async function variablesSorteoInterno(
    trx: TransactionClientContract,
    evento: string,
    p: Payload,
    instante: (valor: Date | string | null) => string,
): Promise<Record<string, unknown>> {
    const fila = await sorteo(trx, entero(p.sorteo_id))
    const ganadores = Array.isArray(p.ganadores) ? (p.ganadores as Array<Record<string, unknown>>) : []
    const fecha = texto(p.fecha_sorteo) || (fila?.fecha_sorteo ?? null)
    return {
        sorteo_id: texto(p.sorteo_id),
        nombre: fila?.nombre ?? `#${texto(p.sorteo_id)}`,
        fecha_sorteo: fecha ? instante(fecha) : '',
        lugar: texto(fila?.lugar),
        participantes: texto(p.participantes),
        boletos: texto(p.boletos),
        lista_hash: texto(p.lista_hash),
        bases_hash: texto(p.bases_hash),
        acta_hash: texto(p.acta_hash),
        titulares: ganadores.filter((g) => g.tipo !== 'suplente').length,
        suplentes: ganadores.filter((g) => g.tipo === 'suplente').length,
        cliente: evento === 'sorteo.ejecutado' ? '' : await nombreCliente(trx, p.cliente_id),
        posicion: texto(p.posicion),
        premio_posicion: texto(p.premio_posicion),
        hay_suplente: entero(p.suplente_id) !== null,
        motivo: texto(p.motivo),
    }
}

// ── Pasarela ─────────────────────────────────────────────────────────────────────────────────

/** Motivos de contracargo de la pasarela (`reason` de Recurrente, el de Stripe) en español. */
const MOTIVOS_DISPUTA: Record<string, string> = {
    fraudulent: 'el titular dice que no reconoce el cargo (fraude)',
    duplicate: 'cargo duplicado',
    product_not_received: 'servicio no recibido',
    product_unacceptable: 'servicio no aceptable',
    subscription_canceled: 'suscripción cancelada',
    credit_not_processed: 'reembolso no procesado',
    unrecognized: 'cargo no reconocido',
    general: 'motivo general',
}

const PROVEEDORES: Record<string, string> = { recurrente: 'Recurrente', falsa: 'pasarela de prueba' }

/** `pago.disputa_abierta`: pago, cobro, monto, proveedor y motivo legible. */
export function variablesDisputa(p: Payload): Record<string, unknown> {
    const motivo = texto(p.motivo)
    return {
        pago_id: texto(p.pago_id),
        cobro_id: texto(p.cobro_id),
        monto_q: montoQ(p.monto),
        proveedor: PROVEEDORES[texto(p.proveedor)] ?? texto(p.proveedor),
        motivo,
        motivo_texto: motivo ? (MOTIVOS_DISPUTA[motivo] ?? motivo) : '',
    }
}
