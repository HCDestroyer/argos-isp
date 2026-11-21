import db from '@adonisjs/lucid/services/db'
import type { QueryClientContract } from '@adonisjs/lucid/types/database'

/**
 * Accesos rápidos del panel por usuario (contrato `.claude/integration/contratos/accesos-rapidos.md`).
 * Ids de sección del panel (`apps/web/app/utils/navegacion.ts`), validados solo contra el patrón: el
 * panel ignora los que no conoce o no puede ver.
 */

export const MAXIMO_ACCESOS = 12
export const PATRON_SECCION = /^[a-z0-9]+(?:[-_.][a-z0-9]+)*$/
export const LARGO_MAXIMO_SECCION = 48

/** Predeterminados por rol base, en orden de prioridad (la unión sigue este orden). */
export const PREDETERMINADOS_POR_ROL: ReadonlyArray<readonly [string, readonly string[]]> = [
    ['admin', ['clientes', 'servicios', 'cobro', 'facturas', 'routers', 'configuracion']],
    ['contabilidad', ['libro', 'facturas', 'pagos', 'declaraciones', 'conciliacion', 'egresos']],
    ['cajero', ['cobro', 'caja', 'clientes', 'comprobantes']],
    ['soporte', ['clientes', 'servicios', 'promesas', 'routers']],
    ['tecnico', ['servicios', 'routers', 'mi-bodega', 'clientes']],
    ['lectura', ['clientes', 'servicios', 'facturas']],
]

export interface AccesosRapidos {
    secciones: string[]
    predeterminados: boolean
    maximo: number
    version: number | null
}

/** Unión de los predeterminados de los roles base del usuario (sin ninguno: los de `lectura`). */
export function predeterminadosDeRoles(roles: readonly string[]): string[] {
    const propios = PREDETERMINADOS_POR_ROL.filter(([rol]) => roles.includes(rol))
    const fuente = propios.length > 0 ? propios : PREDETERMINADOS_POR_ROL.filter(([rol]) => rol === 'lectura')
    const salida: string[] = []
    for (const [, secciones] of fuente) {
        for (const s of secciones) if (!salida.includes(s)) salida.push(s)
    }
    return salida.slice(0, MAXIMO_ACCESOS)
}

export async function rolesDeUsuario(usuarioId: number, cliente?: QueryClientContract): Promise<string[]> {
    const filas = (await (cliente ?? db)
        .from('core.usuarios_roles as ur')
        .join('core.roles as r', 'r.id', 'ur.role_id')
        .where('ur.usuario_id', usuarioId)
        .select('r.nombre')) as Array<{ nombre: string }>
    return filas.map((f) => f.nombre)
}

export interface FilaAccesos {
    usuario_id: number
    secciones: string[] | null
    version: number
}

export async function filaAccesos(
    usuarioId: number,
    cliente?: QueryClientContract,
    bloquear = false,
): Promise<FilaAccesos | null> {
    const q = (cliente ?? db).from('core.accesos_rapidos').where('usuario_id', usuarioId).select('*')
    if (bloquear) q.forUpdate()
    return ((await q.first()) as FilaAccesos | null) ?? null
}

export async function verAccesosRapidos(
    usuarioId: number,
    cliente?: QueryClientContract,
): Promise<AccesosRapidos> {
    const fila = await filaAccesos(usuarioId, cliente)
    if (fila && fila.secciones !== null) {
        return {
            secciones: fila.secciones,
            predeterminados: false,
            maximo: MAXIMO_ACCESOS,
            version: fila.version,
        }
    }
    return {
        secciones: predeterminadosDeRoles(await rolesDeUsuario(usuarioId, cliente)),
        predeterminados: true,
        maximo: MAXIMO_ACCESOS,
        version: null,
    }
}
