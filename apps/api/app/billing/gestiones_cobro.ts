import db from '@adonisjs/lucid/services/db'
import type { QueryClientContract } from '@adonisjs/lucid/types/database'
import { NoEncontrado } from '#shared/errores'
import { filtrarPorEmpresa } from '#shared/empresa_activa'
import { paginar, type OpcionesPaginacion, type Pagina } from '#shared/paginacion'

/**
 * Gestiones de cobro (decisión del PM 8, contrato Iris 0.13.0): lectura y catálogos. Las acciones
 * están en `actions/registrar_gestion_cobro.ts` y `actions/adjuntar_gestion_cobro.ts`.
 *
 * Son solo informativas: ninguna gestión cambia el estado del servicio, de sus facturas ni de sus
 * promesas (una `promete_pagar` no crea promesa: para eso está `POST /promesas`). Sirven de evidencia
 * en el castigo de cartera (`ledger.castigos`).
 */

export const TIPOS_GESTION = ['llamada', 'mensaje', 'visita', 'promesa', 'carta'] as const
export type TipoGestion = (typeof TIPOS_GESTION)[number]

export const RESULTADOS_GESTION = [
    'contesto',
    'no_contesto',
    'numero_equivocado',
    'promete_pagar',
    'rechaza',
    'pago_informado',
    'visita_sin_contacto',
] as const
export type ResultadoGestion = (typeof RESULTADOS_GESTION)[number]

export const ORIGENES_GESTION = ['conversacion', 'orden', 'llamada', 'panel'] as const
export type OrigenGestion = (typeof ORIGENES_GESTION)[number]

/** Solo de Argos: Iris nunca manda una carta ni el origen `panel`. */
export const TIPOS_SOLO_ARGOS: readonly TipoGestion[] = ['carta']
export const ORIGENES_SOLO_ARGOS: readonly OrigenGestion[] = ['panel']

/** Nota corta del panel. */
export const NOTA_GESTION_MAXIMO = 280

/** Ventana de `ocurrido_en` (contrato 0.13.0): hasta 7 días atrás y 5 minutos adelante. */
export const GESTION_DIAS_ATRAS = 7
export const GESTION_MINUTOS_ADELANTE = 5

/** `Idempotency-Key` de Iris: `iris:gestion:<uuid v7>`. */
export const FORMATO_CLAVE_GESTION_IRIS =
    /^iris:gestion:([0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/

export interface GestionCobroVista {
    id: number
    /** alias de `id` para Iris (contrato 0.13.0: `201 { gestion_id }`) */
    gestion_id: number
    empresa_id: number
    cliente_id: number
    servicio_id: number | null
    contacto_id: number | null
    tipo: TipoGestion
    resultado: ResultadoGestion
    ocurrido_en: Date
    origen_tipo: OrigenGestion
    origen_id: string | null
    /** `iris` si la registró Iris; null desde el panel */
    sistema_origen: 'iris' | null
    iris_gestion_id: string | null
    iris_actor: string | null
    nota: string | null
    tiene_adjunto: boolean
    adjunto_tipo: string | null
    registrado_por: number | null
    registrado_por_nombre: string | null
    created_at: Date
}

function consulta(cliente: QueryClientContract) {
    return cliente
        .from('billing.gestiones_cobro as g')
        .leftJoin('core.usuarios as u', 'u.id', 'g.registrado_por')
        .select(
            'g.id',
            'g.id as gestion_id',
            'g.empresa_id',
            'g.cliente_id',
            'g.servicio_id',
            'g.contacto_id',
            'g.tipo',
            'g.resultado',
            'g.ocurrido_en',
            'g.origen_tipo',
            'g.origen_id',
            'g.sistema_origen',
            'g.iris_gestion_id',
            'g.iris_actor',
            'g.nota',
            cliente.raw('(g.adjunto IS NOT NULL) as tiene_adjunto'),
            'g.adjunto_tipo',
            'g.registrado_por',
            'u.nombre as registrado_por_nombre',
            'g.created_at',
        )
}

function normalizar(fila: GestionCobroVista): GestionCobroVista {
    return {
        ...fila,
        id: Number(fila.id),
        gestion_id: Number(fila.gestion_id),
        empresa_id: Number(fila.empresa_id),
        cliente_id: Number(fila.cliente_id),
        servicio_id: fila.servicio_id === null ? null : Number(fila.servicio_id),
        contacto_id: fila.contacto_id === null ? null : Number(fila.contacto_id),
        registrado_por: fila.registrado_por === null ? null : Number(fila.registrado_por),
    }
}

export async function verGestionCobro(
    id: number,
    cliente: QueryClientContract = db.connection(),
): Promise<GestionCobroVista> {
    const fila = (await consulta(cliente).where('g.id', id).first()) as GestionCobroVista | null
    if (!fila) throw new NoEncontrado(`La gestión de cobro ${id} no existe`)
    return normalizar(fila)
}

export interface FiltrosGestiones extends OpcionesPaginacion {
    servicio_id?: number | null
    tipo?: TipoGestion | null
}

/** Gestiones de un cliente, de la más reciente a la más vieja (por id). */
export async function listarGestionesCliente(
    clienteId: number,
    filtros: FiltrosGestiones,
    empresas: number[] | null,
): Promise<Pagina<GestionCobroVista>> {
    const q = consulta(db.connection())
        .where('g.cliente_id', clienteId)
        .if(filtros.servicio_id, (r) => r.where('g.servicio_id', filtros.servicio_id!))
        .if(filtros.tipo, (r) => r.where('g.tipo', filtros.tipo!))
    filtrarPorEmpresa(q, empresas, (r, ids) => r.whereIn('g.empresa_id', ids))
    const pagina = await paginar<GestionCobroVista>(q, filtros, { columna: 'g.id' })
    return { ...pagina, data: pagina.data.map(normalizar) }
}

/** Resumen para el castigo de cartera: lo registrado del cliente en la empresa hasta `hasta`. */
export interface ResumenGestiones {
    cantidad: number
    con_adjunto: number
    ultima: Date | null
    gestiones: Array<
        Pick<GestionCobroVista, 'id' | 'tipo' | 'resultado' | 'ocurrido_en' | 'servicio_id' | 'tiene_adjunto'>
    >
}

export async function resumenGestiones(
    cliente: QueryClientContract,
    clienteId: number,
    empresaId: number,
    hasta: Date | null = null,
): Promise<ResumenGestiones> {
    const filas = (await cliente
        .from('billing.gestiones_cobro')
        .where('cliente_id', clienteId)
        .where('empresa_id', empresaId)
        .if(hasta !== null, (q) => q.where('created_at', '<=', hasta!))
        .orderBy([
            { column: 'ocurrido_en', order: 'desc' },
            { column: 'id', order: 'desc' },
        ])
        .select(
            'id',
            'tipo',
            'resultado',
            'ocurrido_en',
            'servicio_id',
            cliente.raw('(adjunto IS NOT NULL) as tiene_adjunto'),
        )) as ResumenGestiones['gestiones']
    const gestiones = filas.map((f) => ({
        ...f,
        id: Number(f.id),
        servicio_id: f.servicio_id === null ? null : Number(f.servicio_id),
    }))
    return {
        cantidad: gestiones.length,
        con_adjunto: gestiones.filter((g) => g.tiene_adjunto).length,
        ultima: gestiones[0]?.ocurrido_en ?? null,
        gestiones,
    }
}

/** Ruta y tipo del adjunto (para descargarlo). */
export async function adjuntoDeGestion(
    id: number,
): Promise<{ empresa_id: number; adjunto: string; adjunto_tipo: string }> {
    const fila = (await db
        .from('billing.gestiones_cobro')
        .where('id', id)
        .select('empresa_id', 'adjunto', 'adjunto_tipo')
        .first()) as { empresa_id: number; adjunto: string | null; adjunto_tipo: string | null } | null
    if (!fila) throw new NoEncontrado(`La gestión de cobro ${id} no existe`)
    if (!fila.adjunto || !fila.adjunto_tipo) {
        throw new NoEncontrado(`La gestión de cobro ${id} no tiene adjunto`)
    }
    return { empresa_id: Number(fila.empresa_id), adjunto: fila.adjunto, adjunto_tipo: fila.adjunto_tipo }
}
