import db from '@adonisjs/lucid/services/db'
import type { QueryClientContract } from '@adonisjs/lucid/types/database'
import type { Inicio } from '#billing/panel/validators'

/**
 * Pantalla de inicio por rol y por usuario (decisión 2 del PM; `contratos/reportes.md` §6).
 *
 * Orden: la elección del usuario (`billing.inicio_usuarios`) → la de sus roles
 * (`billing.inicio_roles`, o la de fábrica del rol) → día a día. Con varios roles gana el panel
 * financiero si alguno lo tiene. El panel financiero exige `panel_financiero.ver`: sin él, el inicio
 * es siempre «Día a día» (`motivo: sin_permiso`), aunque el rol o el usuario digan otra cosa.
 *
 * De fábrica: `admin` y `dueno` (o `dueño`, rol creado por la instalación) abren el panel financiero;
 * los demás, «Día a día». Vive en `billing` (no en `core`) para no tocar el núcleo (anotado para A1).
 */

export const INICIO_FABRICA: Readonly<Record<string, Inicio>> = {
    admin: 'panel_financiero',
    dueno: 'panel_financiero',
    dueño: 'panel_financiero',
}

export function inicioDeFabrica(rol: string): Inicio {
    return INICIO_FABRICA[rol.toLowerCase()] ?? 'dia_a_dia'
}

export interface InicioResuelto {
    inicio: Inicio
    origen: 'usuario' | 'rol' | 'fabrica'
    /** el rol que decidió (con origen rol o fábrica) */
    rol: string | null
    /** lo que eligió el usuario (null = sigue a su rol) */
    elegido: Inicio | null
    /** `sin_permiso` si el rol o el usuario piden el panel financiero y no tiene `panel_financiero.ver` */
    motivo: 'sin_permiso' | null
    disponibles: Inicio[]
    version: number | null
}

export interface InicioRol {
    role_id: number
    rol: string
    inicio: Inicio
    origen: 'rol' | 'fabrica'
    version: number | null
}

export async function inicioDeRoles(
    c: QueryClientContract = db.connection(),
    ids?: number[],
): Promise<InicioRol[]> {
    const filas = (await c
        .from('core.roles as r')
        .leftJoin('billing.inicio_roles as i', 'i.role_id', 'r.id')
        .if(ids !== undefined, (q) => q.whereIn('r.id', ids!))
        .orderBy('r.nombre', 'asc')
        .select('r.id', 'r.nombre', 'i.inicio', 'i.version')) as Array<{
        id: number
        nombre: string
        inicio: Inicio | null
        version: number | null
    }>
    return filas.map((f) => ({
        role_id: Number(f.id),
        rol: f.nombre,
        inicio: f.inicio ?? inicioDeFabrica(f.nombre),
        origen: f.inicio ? 'rol' : 'fabrica',
        version: f.version === null ? null : Number(f.version),
    }))
}

export async function inicioDeUsuario(
    usuarioId: number,
    permisos: ReadonlySet<string>,
    c: QueryClientContract = db.connection(),
): Promise<InicioResuelto> {
    const puedePanel = permisos.has('panel_financiero.ver')
    const disponibles: Inicio[] = puedePanel ? ['panel_financiero', 'dia_a_dia'] : ['dia_a_dia']
    const propia = (await c.from('billing.inicio_usuarios').where('usuario_id', usuarioId).first()) as {
        inicio: Inicio
        version: number
    } | null
    const roleIds = (
        (await c.from('core.usuarios_roles').where('usuario_id', usuarioId).distinct('role_id')) as Array<{
            role_id: number
        }>
    ).map((f) => Number(f.role_id))
    const roles = roleIds.length > 0 ? await inicioDeRoles(c, roleIds) : []

    let inicio: Inicio
    let origen: InicioResuelto['origen']
    let rol: string | null = null
    if (propia) {
        inicio = propia.inicio
        origen = 'usuario'
    } else {
        const conPanel = roles.find((r) => r.inicio === 'panel_financiero')
        const decide = conPanel ?? roles[0]
        inicio = conPanel ? 'panel_financiero' : 'dia_a_dia'
        origen = decide?.origen ?? 'fabrica'
        rol = decide?.rol ?? null
    }
    let motivo: InicioResuelto['motivo'] = null
    if (inicio === 'panel_financiero' && !puedePanel) {
        inicio = 'dia_a_dia'
        motivo = 'sin_permiso'
    }
    return {
        inicio,
        origen,
        rol,
        elegido: propia?.inicio ?? null,
        motivo,
        disponibles,
        version: propia ? Number(propia.version) : null,
    }
}
