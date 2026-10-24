import db from '@adonisjs/lucid/services/db'
import { DateTime } from 'luxon'
import { NoEncontrado } from '#shared/errores'
import { paginar, type OpcionesPaginacion, type Pagina } from '#shared/paginacion'
import { hoyGuatemala } from '#ledger/fechas'
import { programaActivo, type ProgramaVista } from '#lealtad/programas'
import { lotesVivos, saldoPuntos, type OrigenMovimiento, type TipoMovimiento } from '#lealtad/puntos'
import type { TipoPremio, TipoDescuento } from '#lealtad/premios'
import type { EstadoCanje } from '#lealtad/canjes'
import { marcasDeEmpresas, marcaDeEmpresa, type MarcaEmpresa } from '#portal/marca'

/**
 * Puntos de lealtad en el portal (contrato `lealtad.md` §12). Lecturas de `lealtad.*` (A3) para el
 * cliente de la sesión, solo de las empresas cuyo programa activo tiene `visible_portal` (el panel
 * lo enciende). Nada de esto sale por la IP.
 *
 * - No muestra el `motivo` de un ajuste ni valores contables (Q diferidos, asientos): son internos.
 * - `canjeable` y `faltan` de un premio son para pintar la tarjeta; quien decide es la acción
 *   `lealtad.canjear` de A3 (saldo, mínimo, existencias, interruptores del portal).
 */

/** Movimientos que se muestran por empresa (el historial completo está en el panel). */
export const MOVIMIENTOS_PORTAL = 20

export interface ProgramaPortal {
    nombre: string
    terminos: string
    minimo_canje: number
    vencimiento_meses: number | null
    aviso_vencimiento_dias: number
    canje_portal: boolean
}

export interface MovimientoPortal {
    id: number
    tipo: TipoMovimiento
    origen_tipo: OrigenMovimiento
    puntos: number
    servicio_id: number | null
    vence_en: string | null
    created_at: string
}

export interface PuntosEmpresaPortal {
    empresa: MarcaEmpresa
    programa: ProgramaPortal
    saldo: number
    por_vencer: number
    proximo_vencimiento: string | null
    vencen_pronto: Array<{ puntos: number; vence_en: string }>
    movimientos: MovimientoPortal[]
}

export type MotivoNoCanjeable =
    'canje_desactivado' | 'puntos_insuficientes' | 'agotado' | 'no_disponible_en_portal'

export interface PremioPortal {
    id: number
    empresa_id: number
    tipo: TipoPremio
    nombre: string
    costo_puntos: number
    descuento_tipo: TipoDescuento | null
    descuento_valor: string | null
    tope: string | null
    dias: number | null
    plan_destino: string | null
    agotado: boolean
    canjeable: boolean
    motivo_no_canjeable: MotivoNoCanjeable | null
    /** puntos que le faltan al cliente (0 si le alcanzan): el mayor entre costo y mínimo, menos el saldo */
    faltan: number
}

export interface CanjePortal {
    id: number
    empresa_id: number
    servicio_id: number
    premio_nombre: string
    tipo: TipoPremio
    puntos: number
    estado: EstadoCanje
    descuento: string | null
    aplicado_en: string | null
    created_at: string
}

/** Tipos que el portal no canjea hoy: `bien` espera al contador, `boletos` llega con los sorteos. */
const NO_CANJEABLES_EN_PORTAL: readonly TipoPremio[] = ['bien', 'boletos']

/** Empresas del cliente: las de sus servicios y las de sus movimientos de puntos. */
async function empresasDelCliente(clienteId: number): Promise<number[]> {
    const filas = (await db
        .from('core.servicios')
        .where('cliente_id', clienteId)
        .select(db.raw('coalesce(empresa_id, 1)::int as empresa_id'))
        .union((q) =>
            q.from('lealtad.movimientos').where('cliente_id', clienteId).select('empresa_id'),
        )) as Array<{
        empresa_id: number
    }>
    return [...new Set(filas.map((f) => Number(f.empresa_id)))].sort((a, b) => a - b)
}

/** Programas activos y visibles en el portal de las empresas del cliente, por empresa. */
async function programasVisibles(clienteId: number): Promise<Map<number, ProgramaVista>> {
    const visibles = new Map<number, ProgramaVista>()
    for (const empresaId of await empresasDelCliente(clienteId)) {
        const programa = await programaActivo(empresaId)
        if (programa?.visible_portal) visibles.set(empresaId, programa)
    }
    return visibles
}

function fechaIso(valor: unknown): string {
    return valor instanceof Date ? valor.toISOString() : String(valor)
}

/** `GET /portal/puntos`: una sección por empresa con programa visible; sin ninguno, lista vacía. */
export async function puntosPortal(clienteId: number): Promise<PuntosEmpresaPortal[]> {
    const programas = await programasVisibles(clienteId)
    const marcas = await marcasDeEmpresas([...programas.keys()])
    const hoy = hoyGuatemala()
    const salida: PuntosEmpresaPortal[] = []
    for (const [empresaId, programa] of programas) {
        const saldo = await saldoPuntos(db.connection(), empresaId, clienteId)
        const lotes = await lotesVivos(db.connection(), empresaId, clienteId)
        const limite = DateTime.fromISO(hoy, { zone: 'utc' })
            .plus({ days: programa.aviso_vencimiento_dias })
            .toISODate()!
        const pronto = lotes.filter((l) => l.vence_en !== null && l.vence_en <= limite)
        // un lote por fecha: al cliente le importa cuántos puntos vencen cada día
        const porFecha = new Map<string, number>()
        for (const lote of pronto) {
            porFecha.set(lote.vence_en!, (porFecha.get(lote.vence_en!) ?? 0) + lote.restante)
        }
        const movimientos = (await db
            .from('lealtad.movimientos')
            .where('empresa_id', empresaId)
            .where('cliente_id', clienteId)
            .orderBy('id', 'desc')
            .limit(MOVIMIENTOS_PORTAL)
            .select(
                'id',
                'tipo',
                'origen_tipo',
                'puntos',
                'servicio_id',
                db.raw(`to_char(vence_en, 'YYYY-MM-DD') as vence_en`),
                'created_at',
            )) as Array<Record<string, any>>
        salida.push({
            empresa: marcas.get(empresaId) ?? (await marcaDeEmpresa(empresaId)),
            programa: {
                nombre: programa.nombre,
                terminos: programa.terminos,
                minimo_canje: programa.minimo_canje,
                vencimiento_meses: programa.vencimiento_meses,
                aviso_vencimiento_dias: programa.aviso_vencimiento_dias,
                canje_portal: programa.canje_portal,
            },
            saldo,
            por_vencer: pronto.reduce((s, l) => s + l.restante, 0),
            proximo_vencimiento: lotes.find((l) => l.vence_en !== null)?.vence_en ?? null,
            vencen_pronto: [...porFecha].map(([vence, puntos]) => ({ puntos, vence_en: vence })),
            movimientos: movimientos.map((m) => ({
                id: Number(m.id),
                tipo: m.tipo,
                origen_tipo: m.origen_tipo,
                puntos: Number(m.puntos),
                servicio_id: m.servicio_id === null ? null : Number(m.servicio_id),
                vence_en: m.vence_en,
                created_at: fechaIso(m.created_at),
            })),
        })
    }
    return salida
}

/**
 * `GET /portal/premios`: premios activos con `en_portal` de los programas visibles del cliente, del
 * más barato al más caro, con lo que le falta para cada uno.
 */
export async function premiosPortal(clienteId: number): Promise<PremioPortal[]> {
    const programas = await programasVisibles(clienteId)
    if (programas.size === 0) return []
    const filas = (await db
        .from('lealtad.premios as p')
        .leftJoin('network.planes as pl', 'pl.id', 'p.plan_destino_id')
        .whereIn(
            'p.programa_id',
            [...programas.values()].map((p) => p.id),
        )
        .where('p.activo', true)
        .where('p.en_portal', true)
        .orderBy('p.costo_puntos', 'asc')
        .orderBy('p.id', 'asc')
        .select(
            'p.id',
            'p.empresa_id',
            'p.tipo',
            'p.nombre',
            'p.costo_puntos',
            'p.descuento_tipo',
            'p.descuento_valor',
            'p.tope',
            'p.dias',
            'p.existencias',
            'pl.nombre as plan_destino',
        )) as Array<Record<string, any>>
    const saldos = new Map<number, number>()
    for (const empresaId of programas.keys()) {
        saldos.set(empresaId, await saldoPuntos(db.connection(), empresaId, clienteId))
    }
    return filas.map((f) => {
        const empresaId = Number(f.empresa_id)
        const programa = programas.get(empresaId)!
        const costo = Number(f.costo_puntos)
        const faltan = Math.max(0, Math.max(costo, programa.minimo_canje) - (saldos.get(empresaId) ?? 0))
        const agotado = f.existencias !== null && Number(f.existencias) <= 0
        const motivo: MotivoNoCanjeable | null = !programa.canje_portal
            ? 'canje_desactivado'
            : NO_CANJEABLES_EN_PORTAL.includes(f.tipo)
              ? 'no_disponible_en_portal'
              : agotado
                ? 'agotado'
                : faltan > 0
                  ? 'puntos_insuficientes'
                  : null
        return {
            id: Number(f.id),
            empresa_id: empresaId,
            tipo: f.tipo,
            nombre: f.nombre,
            costo_puntos: costo,
            descuento_tipo: f.descuento_tipo,
            descuento_valor: f.descuento_valor,
            tope: f.tope,
            dias: f.dias === null ? null : Number(f.dias),
            plan_destino: f.plan_destino ?? null,
            agotado,
            canjeable: motivo === null,
            motivo_no_canjeable: motivo,
            faltan,
        }
    })
}

/**
 * Premio que el cliente puede pedir desde el portal: activo, con `en_portal`, de un programa
 * visible suyo y de un tipo que se canjea aquí (no `bien` ni `boletos`). Cualquier otro responde
 * 404, igual que uno inexistente. El portal lo exige por su cuenta, sin depender de que
 * `lealtad.canjear` (A3) bloquee un premio sin `en_portal` cuando el actor es el cliente. Las demás
 * reglas (canje del portal apagado, saldo, existencias) son de la acción.
 */
export async function exigirPremioDelPortal(clienteId: number, premioId: number): Promise<void> {
    const premios = await premiosPortal(clienteId)
    const premio = premios.find((p) => p.id === premioId)
    if (!premio || premio.motivo_no_canjeable === 'no_disponible_en_portal') {
        throw new NoEncontrado('Ese premio no está disponible en el portal')
    }
}

function aCanje(f: Record<string, any>): CanjePortal {
    return {
        id: Number(f.id),
        empresa_id: Number(f.empresa_id),
        servicio_id: Number(f.servicio_id),
        premio_nombre: f.premio_nombre,
        tipo: f.tipo,
        puntos: Number(f.puntos),
        estado: f.estado,
        descuento: f.descuento ?? null,
        aplicado_en: f.aplicado_en ? fechaIso(f.aplicado_en) : null,
        created_at: fechaIso(f.created_at),
    }
}

function consultaCanjes() {
    return db
        .from('lealtad.canjes as c')
        .join('lealtad.premios as p', 'p.id', 'c.premio_id')
        .select(
            'c.id',
            'c.empresa_id',
            'c.servicio_id',
            'p.nombre as premio_nombre',
            'p.tipo',
            'c.puntos',
            'c.estado',
            'c.descuento',
            'c.aplicado_en',
            'c.created_at',
        )
}

/** `GET /portal/canjes`: canjes del cliente de la sesión (panel y portal), del más reciente. */
export async function canjesPortal(
    clienteId: number,
    filtros: OpcionesPaginacion,
): Promise<Pagina<CanjePortal>> {
    const pagina = await paginar(consultaCanjes().where('c.cliente_id', clienteId), filtros, {
        columna: 'c.id',
    })
    return { ...pagina, data: pagina.data.map((f) => aCanje(f as Record<string, any>)) }
}

/** Un canje del cliente (la respuesta de `POST /portal/canjes`). */
export async function canjePortal(clienteId: number, id: number): Promise<CanjePortal> {
    const fila = await consultaCanjes().where('c.id', id).where('c.cliente_id', clienteId).first()
    if (!fila) throw new NoEncontrado('El canje no existe')
    return aCanje(fila)
}
