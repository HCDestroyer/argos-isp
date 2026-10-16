import type { Problem, Schema } from '@argosisp/contracts'

type Servicio = Schema<'Servicio'>
type Sesion = Schema<'Sesion'>
type Accion = Schema<'AccionAuditoria'>

/**
 * Pantalla "Migración de router" (piloto, semana 3): lo que el operador vigila mientras un router
 * pasa al nuevo `aaa`. Todo se calcula con listas reales de la API; si una lista no se pudo leer
 * completa, el número que depende de ella no se muestra.
 */

/** Estado de un número de la pantalla: nunca se muestra el valor salvo en `ok`. */
export type LecturaMigracion<T>
    = | { estado: 'sin_permiso', permiso: string }
        | { estado: 'cargando' }
        | { estado: 'error', problema: Problem }
        | { estado: 'incompleta' }
        | { estado: 'ok', valor: T }

/** Páginas como máximo por lista (200 filas cada una). Más que eso no se cuenta: se pide un resumen a la API. */
export const MAXIMO_PAGINAS = 25

/** Lee todas las páginas de una lista con cursor, hasta `maximo`. `completa: false` si quedaron más. */
export async function leerTodas<T>(
    pedir: (cursor?: string) => Promise<Resultado<Pagina<T>>>,
    maximo = MAXIMO_PAGINAS,
): Promise<Resultado<{ filas: T[], completa: boolean }>> {
    const filas: T[] = []
    let cursor: string | undefined
    for (let pagina = 0; pagina < maximo; pagina++) {
        const resultado = await pedir(cursor)
        if (!resultado.ok) {
            return resultado
        }
        filas.push(...resultado.data.data)
        if (!resultado.data.nextCursor) {
            return { ok: true, data: { filas, completa: true } }
        }
        cursor = resultado.data.nextCursor
    }
    return { ok: true, data: { filas, completa: false } }
}

/** `2026-10-16T08:30` en hora de Guatemala (UTC−6, sin horario de verano) → instante UTC, o `null`. */
export function instanteGuatemala(local: string): string | null {
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(local)) {
        return null
    }
    const fecha = new Date(`${local}:00-06:00`)
    return Number.isNaN(fecha.getTime()) ? null : fecha.toISOString()
}

/** Servicios que cuentan para la migración: los no retirados del router. */
export function serviciosVigentes(servicios: Servicio[]): Servicio[] {
    return servicios.filter(servicio => servicio.estado !== 'retirado')
}

/** Solo PPPoE pasa por RADIUS y tiene sesión; WISP se controla por la API REST de RouterOS. */
export function esPppoe(servicio: Servicio): boolean {
    return (servicio.tipo_conexion ?? 'pppoe') === 'pppoe'
}

/** Ids de servicio con al menos una sesión abierta. */
export function conSesionActiva(activas: Sesion[]): Set<number> {
    return new Set(activas.filter(sesion => sesion.fin === null).flatMap(sesion => (sesion.servicio_id === null ? [] : [sesion.servicio_id])))
}

/**
 * Servicios PPPoE sin ninguna sesión viva en algún momento desde `desde`: ni abierta, ni cerrada
 * después de `desde`. Son los que todavía no se conectaron a través del nuevo `aaa`.
 */
export function sinSesionDesde(servicios: Servicio[], sesiones: Sesion[], desde: string): Servicio[] {
    const limite = new Date(desde).getTime()
    const vistos = new Set(sesiones
        .filter(sesion => sesion.fin === null || new Date(sesion.fin).getTime() >= limite)
        .map(sesion => sesion.servicio_id))
    return servicios.filter(servicio => esPppoe(servicio) && !vistos.has(servicio.id))
}

/** Acciones de red que la bitácora audita y que interesan al migrar: aplicar en RouterOS y desconectar. */
export const ACCIONES_RED = ['routeros.aplicar_servicio', 'routeros.reconciliar', 'routeros.cambiar_control', 'servicios.desconectar', 'sesiones.desconectar'] as const

/** Errores de esas acciones que tocan el router (por su id) o alguno de sus servicios, más reciente primero. */
export function erroresDelRouter(acciones: Accion[], routerId: number, servicioIds: ReadonlySet<number>): Accion[] {
    return acciones
        .filter(accion => accion.resultado === 'error')
        .filter(accion => (accion.entidad_tipo === 'router' && accion.entidad_id === routerId)
            || (accion.entidad_tipo === 'servicio' && accion.entidad_id !== null && servicioIds.has(accion.entidad_id)))
        .sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id - a.id)
}
