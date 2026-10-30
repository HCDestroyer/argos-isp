import db from '@adonisjs/lucid/services/db'
import type { QueryClientContract } from '@adonisjs/lucid/types/database'
import { NoEncontrado } from '#shared/errores'
import { paginar, type OpcionesPaginacion, type Pagina } from '#shared/paginacion'
import { filtrarPorEmpresa } from '#shared/empresa_activa'
import {
    claseDeFila,
    costoQos,
    validarPerfil,
    type AdvertenciaQos,
    type ClaseQos,
    type CostoQos,
    type PerfilQosRouter,
} from '#network/qos'
import {
    conQos,
    estrategiaEfectiva,
    estrategiasDeFila,
    leerExcepcion,
    TIPOS_CONEXION,
} from '#network/estrategia_velocidad'

/**
 * Lecturas de QoS por clases (`contratos/qos.md`): perfiles, clases, el perfil efectivo de un router
 * y el uso (costo) de un perfil en los routers.
 */

export interface ClaseQosVista extends ClaseQos {
    perfil_id: number
    version: number
    created_at: string
    updated_at: string
}

export interface UsoRouterQos extends CostoQos {
    router_id: number
    nombre: string
}

export interface PerfilQosVista {
    id: number
    empresa_id: number | null
    nombre: string
    descripcion: string | null
    predeterminado: boolean
    clases: ClaseQosVista[]
    advertencias: AdvertenciaQos[]
    version: number
    created_at: string
    updated_at: string
}

const COLUMNAS_CLASE = [
    'id',
    'perfil_id',
    'nombre',
    'orden',
    'prioridad',
    'garantizado_pct',
    'tope_pct',
    'es_resto',
    'reglas',
    'bytes_minimo',
    'reclasifica_de',
    'activa',
    'version',
    'created_at',
    'updated_at',
]

function claseVista(f: Record<string, unknown>): ClaseQosVista {
    return {
        ...claseDeFila(f),
        perfil_id: Number(f.perfil_id),
        version: Number(f.version),
        created_at: f.created_at as string,
        updated_at: f.updated_at as string,
    }
}

export async function clasesDePerfil(
    perfilId: number,
    cliente: QueryClientContract = db.connection(),
): Promise<ClaseQosVista[]> {
    const filas = (await cliente
        .from('network.qos_clases')
        .where('perfil_id', perfilId)
        .select(COLUMNAS_CLASE)
        .orderBy([
            { column: 'activa', order: 'desc' },
            { column: 'orden', order: 'asc' },
            { column: 'id', order: 'asc' },
        ])) as Array<Record<string, unknown>>
    return filas.map(claseVista)
}

export async function verClase(
    id: number,
    cliente: QueryClientContract = db.connection(),
): Promise<ClaseQosVista> {
    const fila = (await cliente
        .from('network.qos_clases')
        .where('id', id)
        .select(COLUMNAS_CLASE)
        .first()) as Record<string, unknown> | null
    if (!fila) throw new NoEncontrado(`La clase de QoS ${id} no existe`)
    return claseVista(fila)
}

interface FilaPerfil {
    id: number
    empresa_id: number | null
    nombre: string
    descripcion: string | null
    predeterminado: boolean
    version: number
    created_at: string
    updated_at: string
}

const COLUMNAS_PERFIL = [
    'id',
    'empresa_id',
    'nombre',
    'descripcion',
    'predeterminado',
    'version',
    'created_at',
    'updated_at',
]

async function conClases(f: FilaPerfil, cliente: QueryClientContract): Promise<PerfilQosVista> {
    const clases = await clasesDePerfil(Number(f.id), cliente)
    return {
        id: Number(f.id),
        empresa_id: f.empresa_id === null ? null : Number(f.empresa_id),
        nombre: f.nombre,
        descripcion: f.descripcion,
        predeterminado: f.predeterminado,
        clases,
        advertencias: validarPerfil(clases).advertencias,
        version: Number(f.version),
        created_at: f.created_at,
        updated_at: f.updated_at,
    }
}

export async function verPerfil(
    id: number,
    cliente: QueryClientContract = db.connection(),
): Promise<PerfilQosVista> {
    const fila = (await cliente
        .from('network.qos_perfiles')
        .where('id', id)
        .select(COLUMNAS_PERFIL)
        .first()) as FilaPerfil | null
    if (!fila) throw new NoEncontrado(`El perfil de QoS ${id} no existe`)
    return conClases(fila, cliente)
}

/** Comunes y de las empresas del filtro (`empresasDeLaLista`; null = todos). */
export async function listarPerfiles(
    opciones: OpcionesPaginacion,
    empresas: number[] | null,
): Promise<Pagina<PerfilQosVista>> {
    const consulta = db.from('network.qos_perfiles').select(COLUMNAS_PERFIL)
    filtrarPorEmpresa(consulta, empresas, (q, ids) =>
        q.where((w) => w.whereNull('empresa_id').orWhereIn('empresa_id', ids)),
    )
    const pagina = await paginar<FilaPerfil>(consulta, opciones, { direccion: 'asc' })
    const data: PerfilQosVista[] = []
    for (const f of pagina.data) data.push(await conClases(f, db.connection()))
    return { data, nextCursor: pagina.nextCursor }
}

/** Id del perfil que usa un router: el suyo o el predeterminado (null si no hay ninguno). */
export async function perfilEfectivoId(
    qosPerfilId: number | null,
    cliente: QueryClientContract = db.connection(),
): Promise<number | null> {
    if (qosPerfilId !== null) return qosPerfilId
    const fila = (await cliente
        .from('network.qos_perfiles')
        .where('predeterminado', true)
        .select('id')
        .first()) as { id: number } | null
    return fila ? Number(fila.id) : null
}

/** Perfil del router con sus clases activas (lo usa el dispatcher). */
export async function perfilQosRouter(
    qosPerfilId: number | null,
    cliente: QueryClientContract = db.connection(),
): Promise<PerfilQosRouter | null> {
    const id = await perfilEfectivoId(qosPerfilId, cliente)
    if (id === null) return null
    const filas = (await cliente
        .from('network.qos_clases')
        .where('perfil_id', id)
        .where('activa', true)
        .select(COLUMNAS_CLASE)
        .orderBy('id')) as Array<Record<string, unknown>>
    return { perfil_id: id, clases: filas.map(claseDeFila) }
}

interface FilaRouterQos {
    id: number
    nombre: string
    control_velocidad: string
    estrategia_velocidad: unknown
}

/**
 * Planes del router que priorizan por clases: los implementados o con servicios no retirados cuya
 * estrategia efectiva (algún tipo de conexión) es del árbol con `qos`.
 */
export async function planesConQos(
    routerId: number,
    cliente: QueryClientContract = db.connection(),
    excepciones?: Map<number, unknown>,
): Promise<number> {
    const r = (await cliente
        .from('network.routers')
        .where('id', routerId)
        .select('id', 'nombre', 'control_velocidad', 'estrategia_velocidad')
        .first()) as FilaRouterQos | null
    if (!r) return 0
    const estrategias = estrategiasDeFila(
        r.estrategia_velocidad,
        r.control_velocidad === 'arbol_pcq' ? 'arbol_pcq' : 'simple',
    )
    const filas = (await cliente
        .from('network.planes as p')
        .leftJoin('network.planes_routers as pr', (j) =>
            j.on('pr.plan_id', '=', 'p.id').andOnVal('pr.router_id', '=', routerId),
        )
        .where((q) =>
            q
                .whereNotNull('pr.id')
                .orWhereExists((s) =>
                    s
                        .from('core.servicios as s')
                        .whereRaw('s.plan_id = p.id')
                        .where('s.router_id', routerId)
                        .whereNot('s.estado', 'retirado'),
                ),
        )
        .select('p.id as plan_id', 'pr.estrategia_velocidad')) as Array<{
        plan_id: number
        estrategia_velocidad: unknown
    }>
    return filas.filter((f) => {
        const excepcion = leerExcepcion(
            excepciones?.has(Number(f.plan_id)) ? excepciones.get(Number(f.plan_id)) : f.estrategia_velocidad,
        )
        return TIPOS_CONEXION.some((t) => conQos(estrategiaEfectiva(estrategias, excepcion, t)))
    }).length
}

/** Routers activos cuyo perfil efectivo es `perfilId`. */
async function routersDePerfil(perfilId: number, cliente: QueryClientContract): Promise<FilaRouterQos[]> {
    const perfil = (await cliente
        .from('network.qos_perfiles')
        .where('id', perfilId)
        .select('predeterminado')
        .first()) as { predeterminado: boolean } | null
    if (!perfil) return []
    return (await cliente
        .from('network.routers')
        .where('activo', true)
        .where((q) => {
            q.where('qos_perfil_id', perfilId)
            if (perfil.predeterminado) q.orWhereNull('qos_perfil_id')
        })
        .select('id', 'nombre', 'control_velocidad', 'estrategia_velocidad')
        .orderBy('id')) as FilaRouterQos[]
}

/**
 * Costo del perfil en cada router que lo usa (§3.4). `clases` permite calcularlo con el perfil como
 * quedaría (alta o activación de una clase).
 */
export async function usoPerfil(
    perfilId: number,
    cliente: QueryClientContract = db.connection(),
    clases?: ClaseQos[],
): Promise<UsoRouterQos[]> {
    const lista = clases ?? (await clasesDePerfil(perfilId, cliente))
    const perfil: PerfilQosRouter = { perfil_id: perfilId, clases: lista.filter((c) => c.activa) }
    const salida: UsoRouterQos[] = []
    for (const r of await routersDePerfil(perfilId, cliente)) {
        const planes = await planesConQos(Number(r.id), cliente)
        salida.push({ router_id: Number(r.id), nombre: r.nombre, ...costoQos(perfil, planes) })
    }
    return salida
}

/** Routers a reconciliar cuando cambia el perfil: lo usan y tienen algún plan con `qos`. */
export async function routersAfectados(perfilId: number, cliente: QueryClientContract): Promise<number[]> {
    const salida: number[] = []
    for (const r of await routersDePerfil(perfilId, cliente)) {
        if ((await planesConQos(Number(r.id), cliente)) > 0) salida.push(Number(r.id))
    }
    return salida
}
