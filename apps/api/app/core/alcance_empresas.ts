import db from '@adonisjs/lucid/services/db'
import type { QueryClientContract } from '@adonisjs/lucid/types/database'
import { listarEmpresas } from '#core/empresas'

/**
 * Alcance de un usuario por empresa (`contratos/multiempresa.md`): `core.usuarios.alcance_global`
 * y `core.usuarios_empresas`. Un token de API es el mismo usuario: hereda su alcance.
 */

export interface AlcanceEmpresas {
    alcanceGlobal: boolean
    /** empresas activas que puede operar, en orden de id (con alcance global: todas las activas) */
    empresas: number[]
    /** para el contexto de las acciones: null = sin restricción (alcance global) */
    permitidas: number[] | null
}

export async function alcanceEmpresasDeUsuario(
    usuarioId: number,
    cliente: QueryClientContract = db.connection(),
): Promise<AlcanceEmpresas> {
    const usuario = (await cliente
        .from('core.usuarios')
        .where('id', usuarioId)
        .select('alcance_global')
        .first()) as { alcance_global: boolean } | null
    if (usuario?.alcance_global) {
        const filas = (await cliente
            .from('core.empresas')
            .where('activa', true)
            .orderBy('id', 'asc')
            .select('id')) as Array<{ id: number }>
        return { alcanceGlobal: true, empresas: filas.map((f) => Number(f.id)), permitidas: null }
    }
    const filas = (await cliente
        .from('core.usuarios_empresas as ue')
        .join('core.empresas as e', 'e.id', 'ue.empresa_id')
        .where('ue.usuario_id', usuarioId)
        .where('e.activa', true)
        .orderBy('e.id', 'asc')
        .select('e.id')) as Array<{ id: number }>
    const empresas = filas.map((f) => Number(f.id))
    return { alcanceGlobal: false, empresas, permitidas: empresas }
}

/** Empresas asignadas explícitamente (`core.usuarios_empresas`) de varios usuarios. */
export async function empresasAsignadas(
    usuarioIds: number[],
    cliente: QueryClientContract = db.connection(),
): Promise<Map<number, number[]>> {
    const mapa = new Map<number, number[]>()
    if (usuarioIds.length === 0) return mapa
    const filas = (await cliente
        .from('core.usuarios_empresas')
        .whereIn('usuario_id', usuarioIds)
        .orderBy(['usuario_id', 'empresa_id'])
        .select('usuario_id', 'empresa_id')) as Array<{ usuario_id: number; empresa_id: number }>
    for (const fila of filas) {
        const lista = mapa.get(Number(fila.usuario_id)) ?? []
        lista.push(Number(fila.empresa_id))
        mapa.set(Number(fila.usuario_id), lista)
    }
    return mapa
}

/** Empresa en `GET /me` (selector): id, nombre comercial, NIT y logo. */
export interface EmpresaResumenVista {
    id: number
    nombre_comercial: string
    nit: string | null
    logo_url: string | null
}

/** Las empresas activas que el usuario puede operar, para el selector del panel. */
export async function empresasDelUsuario(
    alcance: AlcanceEmpresas,
    cliente: QueryClientContract = db.connection(),
): Promise<EmpresaResumenVista[]> {
    const empresas = await listarEmpresas({ ids: alcance.empresas, soloActivas: true }, cliente)
    return empresas.map((e) => ({
        id: e.id,
        nombre_comercial: e.nombre_comercial,
        nit: e.nit,
        logo_url: e.logo_url,
    }))
}
