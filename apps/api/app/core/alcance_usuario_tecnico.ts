import type { QueryClientContract } from '@adonisjs/lucid/types/database'
import { ReglaNegocio, type ErrorCampo } from '#shared/errores'

/**
 * Usuarios técnicos que solo pueden tener alcance por empresas (o global), nunca por zona ni
 * router (decisión del líder, contrato Iris 0.3.1 §1). Con un alcance de red, `listarServicios`
 * filtra los servicios aunque se pida `?empresas=todas`, y un cliente con servicios fuera de ese
 * alcance aparecería en Iris sin servicios: una lista completa y vacía tiene que significar «sin
 * servicios».
 *
 * Sin imports de las acciones de usuarios a propósito: lo usan `reemplazarAsignaciones` y
 * `CrearTokenApi`, que a su vez usa `asegurarUsuarioTecnico`.
 *
 * El usuario técnico de Horus no está aquí: su contrato (`contratos/horus.md` §1.4) permite tokens
 * con `routers`/`zonas`. Sumarlo es agregar su correo a esta lista (y cambiar ese contrato).
 */

export const EMAIL_USUARIO_IRIS = 'iris@integraciones.argosisp.local'

const SOLO_EMPRESAS: Record<string, string> = {
    [EMAIL_USUARIO_IRIS]: 'Iris',
}

export const CODIGO_SOLO_EMPRESAS = 'usuario_tecnico_solo_empresas'

/** Nombre del usuario técnico (`Iris`) si el usuario solo admite alcance por empresas; si no, null. */
export async function usuarioSoloEmpresas(
    cliente: QueryClientContract,
    usuarioId: number,
): Promise<string | null> {
    const fila = (await cliente.from('core.usuarios').where('id', usuarioId).select('email').first()) as {
        email: string
    } | null
    if (!fila) return null
    return SOLO_EMPRESAS[fila.email.toLowerCase()] ?? null
}

/** 422 `usuario_tecnico_solo_empresas` con un error por campo. */
export function rechazarAlcanceDeRed(nombre: string, errores: ErrorCampo[]): never {
    throw new ReglaNegocio(
        `El usuario técnico ${nombre} solo puede tener alcance por empresas (o global), nunca por zona ni router`,
        CODIGO_SOLO_EMPRESAS,
        errores,
    )
}

/** Tipos de alcance de rol que restringen la red (`caja` no toca servicios ni clientes). */
export function esAlcanceDeRed(tipo: string | null | undefined): boolean {
    return tipo === 'router' || tipo === 'zona'
}

/**
 * Revisa las asignaciones de rol que ya tiene el usuario (p. ej. al cambiarle el correo a uno de
 * usuario técnico). 422 si alguna tiene alcance de red.
 */
export async function exigirRolesSinAlcanceDeRed(cliente: QueryClientContract, usuarioId: number) {
    const nombre = await usuarioSoloEmpresas(cliente, usuarioId)
    if (!nombre) return
    const filas = (await cliente
        .from('core.usuarios_roles')
        .where('usuario_id', usuarioId)
        .whereIn('alcance_tipo', ['router', 'zona'])
        .select('alcance_tipo')) as Array<{ alcance_tipo: string }>
    if (filas.length === 0) return
    rechazarAlcanceDeRed(nombre, [
        {
            field: 'roles',
            rule: CODIGO_SOLO_EMPRESAS,
            message: 'Quita primero los roles con alcance por zona o router',
        },
    ])
}
