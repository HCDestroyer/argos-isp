import db from '@adonisjs/lucid/services/db'
import type { QueryClientContract } from '@adonisjs/lucid/types/database'
import { NoEncontrado } from '#shared/errores'
import { paginar, type OpcionesPaginacion, type Pagina } from '#shared/paginacion'

/** Espejo del schema `NodoPortal` (nunca el hash). */
export interface NodoPortalVista {
    id: number
    nombre: string
    ultimo_uso: Date | null
    ultima_ip: string | null
    revocado_en: Date | null
    creado_por: number | null
    created_at: Date
}

const COLUMNAS = [
    'id',
    'nombre',
    'ultimo_uso',
    db.raw('host(ultima_ip) as ultima_ip'),
    'revocado_en',
    'creado_por',
    'created_at',
]

function plano(fila: NodoPortalVista): NodoPortalVista {
    return {
        ...fila,
        id: Number(fila.id),
        creado_por: fila.creado_por === null ? null : Number(fila.creado_por),
    }
}

export async function listarNodosPortal(opciones: OpcionesPaginacion): Promise<Pagina<NodoPortalVista>> {
    const pagina = await paginar<NodoPortalVista>(db.from('core.nodos_portal').select(COLUMNAS), opciones)
    return { ...pagina, data: pagina.data.map(plano) }
}

export async function verNodoPortal(
    id: number,
    cliente: QueryClientContract = db.connection(),
): Promise<NodoPortalVista> {
    const fila = (await cliente
        .from('core.nodos_portal')
        .where('id', id)
        .select(COLUMNAS)
        .first()) as NodoPortalVista | null
    if (!fila) throw new NoEncontrado(`El nodo portal ${id} no existe`)
    return plano(fila)
}

/** Id del nodo con ese nombre (rutas del CLI); 404 si no existe. */
export async function idDeNodoPorNombre(nombre: string): Promise<number> {
    const fila = (await db.from('core.nodos_portal').where('nombre', nombre).select('id').first()) as {
        id: number
    } | null
    if (!fila) throw new NoEncontrado(`No hay un nodo portal llamado ${nombre}`)
    return Number(fila.id)
}

/** Forma que lee el CLI (`argosisp nodo-portal listar`). */
export function vistaInterna(nodo: NodoPortalVista) {
    return {
        nombre: nodo.nombre,
        creado_en: nodo.created_at,
        ultimo_uso_en: nodo.ultimo_uso,
        revocado_en: nodo.revocado_en,
    }
}
