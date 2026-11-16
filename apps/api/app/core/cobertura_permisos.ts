import type { QueryClientContract } from '@adonisjs/lucid/types/database'
import { Problema, type ErrorCampo } from '#shared/errores'
import type { ContextoAccion } from '#shared/contexto'
import { TIPOS_ALCANCE, type Alcance, type AlcancesToken, type TipoAlcance } from '#core/acl'
import { alcanceEmpresasDeUsuario, empresasAsignadas } from '#core/alcance_empresas'

/**
 * Cobertura de permisos: nadie reparte lo que no tiene. Evita escaladas del tipo "tengo
 * `tokens.crear` → me hago un token de un admin" o "tengo `usuarios.editar` → me doy el rol admin".
 *
 * Lo que tiene el actor = sus permisos con su alcance de rol (router/zona/caja) y, si actúa con un
 * token de API (`ctx.tokenApiId`), recortados por los alcances de ese token; las empresas son las de
 * su usuario (`core.usuarios.alcance_global` / `core.usuarios_empresas`).
 *
 * Se compara con lo que tendría el destino:
 * - un token (`exigirCoberturaToken`): permisos del usuario dueño ∩ `alcances.permisos`, con su
 *   alcance de rol y las restricciones `routers`/`zonas`/`cajas`, más las empresas del dueño;
 *   403 `token_excede_permisos`.
 * - un usuario (`exigirCoberturaUsuario`): sus roles con su alcance y sus empresas;
 *   403 `rol_excede_permisos`.
 * - permisos que se agregan a un rol (`exigirPermisosGlobales`): el rol puede asignarse sin
 *   alcance, así que el actor debe tener cada uno sin alcance; 403 `rol_excede_permisos`.
 *
 * La comparación es conservadora: si no se puede probar que el actor cubre al destino, se rechaza.
 * Un admin global (todos los permisos sin alcance y `alcance_global`) cubre todo. El sistema
 * (consola, seeds, workers) no se comprueba.
 */

export const CODIGO_TOKEN_EXCEDE = 'token_excede_permisos'
export const CODIGO_ROL_EXCEDE = 'rol_excede_permisos'

export class TokenExcedePermisos extends Problema {
    constructor(detalle: string, errores?: ErrorCampo[]) {
        super(403, CODIGO_TOKEN_EXCEDE, 'El token excede tus permisos', detalle, errores)
    }
}

export class RolExcedePermisos extends Problema {
    constructor(detalle: string, errores?: ErrorCampo[]) {
        super(403, CODIGO_ROL_EXCEDE, 'La asignación excede tus permisos', detalle, errores)
    }
}

type Codigo = typeof CODIGO_TOKEN_EXCEDE | typeof CODIGO_ROL_EXCEDE
type AlcanceRol = Alcance['rol']
type Restricciones = Partial<Record<TipoAlcance, number[]>>
/** permiso → alcance de rol con el que se tiene (null = sin alcance) */
export type Grants = Map<string, AlcanceRol>

function excede(codigo: Codigo, detalle: string, errores?: ErrorCampo[]): Problema {
    return codigo === CODIGO_TOKEN_EXCEDE
        ? new TokenExcedePermisos(detalle, errores)
        : new RolExcedePermisos(detalle, errores)
}

const CLAVES_TOKEN: Record<TipoAlcance, 'routers' | 'zonas' | 'cajas'> = {
    router: 'routers',
    zona: 'zonas',
    caja: 'cajas',
}

/** permiso → alcance de rol con el que lo tiene el usuario (null = global). */
export async function grantsDeUsuario(cliente: QueryClientContract, usuarioId: number): Promise<Grants> {
    const filas = (await cliente
        .from('core.usuarios_roles as ur')
        .join('core.roles_permisos as rp', 'rp.role_id', 'ur.role_id')
        .join('core.permisos as p', 'p.id', 'rp.permiso_id')
        .where('ur.usuario_id', usuarioId)
        .select('p.nombre', 'ur.alcance_tipo', 'ur.alcance_id')) as Array<{
        nombre: string
        alcance_tipo: TipoAlcance | null
        alcance_id: number | null
    }>
    const mapa: Grants = new Map()
    for (const fila of filas) {
        if (mapa.get(fila.nombre) === null) continue
        if (fila.alcance_tipo === null || fila.alcance_id === null) {
            mapa.set(fila.nombre, null)
            continue
        }
        const rol = mapa.get(fila.nombre) ?? { router: [], zona: [], caja: [] }
        rol[fila.alcance_tipo].push(Number(fila.alcance_id))
        mapa.set(fila.nombre, rol)
    }
    return mapa
}

function restriccionesDe(alcances: AlcancesToken | null | undefined): Restricciones {
    const r: Restricciones = {}
    if (!alcances) return r
    for (const tipo of TIPOS_ALCANCE) {
        const ids = alcances[CLAVES_TOKEN[tipo]]
        if (ids) r[tipo] = ids.map(Number)
    }
    return r
}

const subconjunto = (a: number[], b: number[]) => a.every((x) => b.includes(x))

/** Tipos con algún grant en un alcance de rol con restricción. */
function tiposConGrant(rol: Exclude<AlcanceRol, null>): TipoAlcance[] {
    return TIPOS_ALCANCE.filter((tipo) => rol[tipo].length > 0)
}

/**
 * ¿Todo recurso que permite el destino (rol `destRol` + token `destTok`) lo permite también el rol
 * del actor? Mismas reglas que `permite` de `#core/acl`.
 */
function rolCubre(actorRol: AlcanceRol, destRol: AlcanceRol, destTok: Restricciones): boolean {
    if (actorRol === null) return true
    // 1) el rol del destino está contenido tipo por tipo en el del actor
    if (destRol !== null && TIPOS_ALCANCE.every((tipo) => subconjunto(destRol[tipo], actorRol[tipo]))) {
        return true
    }
    // 2) el token del destino se restringe, en cada tipo con grant del actor, a ids del actor
    return tiposConGrant(actorRol).every(
        (tipo) => destTok[tipo] !== undefined && subconjunto(destTok[tipo]!, actorRol[tipo]),
    )
}

/** ¿Las restricciones del token del actor también las cumple el destino? */
function tokenCubre(actorTok: Restricciones, destRol: AlcanceRol, destTok: Restricciones): boolean {
    for (const tipo of TIPOS_ALCANCE) {
        const ids = actorTok[tipo]
        if (!ids) continue
        if (destTok[tipo] !== undefined && subconjunto(destTok[tipo]!, ids)) continue
        // el rol del destino solo tiene grants de este tipo y dentro de los ids del actor
        if (destRol !== null) {
            const tipos = tiposConGrant(destRol)
            if (tipos.length === 1 && tipos[0] === tipo && subconjunto(destRol[tipo], ids)) continue
        }
        return false
    }
    return true
}

/** Lo que tiene el actor de una acción, tomado antes de cambiar nada. */
export interface ActorCobertura {
    usuarioId: number
    grants: Grants
    /** `alcances.permisos` del token con el que actúa (null = sin recorte) */
    permisosToken: Set<string> | null
    restricciones: Restricciones
}

/**
 * Lo que tiene el actor, o null para el sistema (no se comprueba). Tómalo antes de cambiar roles:
 * si el actor se edita a sí mismo, cuenta lo que tenía.
 */
export async function coberturaDelActor(
    cliente: QueryClientContract,
    ctx: ContextoAccion,
    codigo: Codigo,
): Promise<ActorCobertura | null> {
    const { actor } = ctx
    if (actor.tipo === 'sistema') return null
    if (actor.tipo === 'cliente' || actor.id === null) {
        throw excede(codigo, 'Solo un usuario del panel o un token de API administra accesos')
    }
    let alcances: AlcancesToken | null = null
    if (actor.tipo === 'token') {
        const fila = ctx.tokenApiId
            ? ((await cliente
                  .from('core.tokens_api')
                  .where('id', ctx.tokenApiId)
                  .select('usuario_id', 'alcances')
                  .first()) as { usuario_id: number; alcances: AlcancesToken | null } | null)
            : null
        if (!fila || Number(fila.usuario_id) !== actor.id) {
            throw excede(codigo, 'No se pudo identificar el token de API con el que actúas')
        }
        alcances = fila.alcances ?? {}
    }
    return {
        usuarioId: actor.id,
        grants: await grantsDeUsuario(cliente, actor.id),
        permisosToken: alcances?.permisos ? new Set(alcances.permisos) : null,
        restricciones: restriccionesDe(alcances),
    }
}

/** Errores por cada permiso del destino que el actor no cubre. */
function permisosNoCubiertos(
    actor: ActorCobertura,
    destino: Grants,
    destTok: Restricciones,
    codigo: Codigo,
    campos: { permiso: string; alcance: string },
    sujeto: string,
): ErrorCampo[] {
    const errores: ErrorCampo[] = []
    for (const [permiso, destRol] of [...destino.entries()].sort(([a], [b]) => a.localeCompare(b))) {
        const actorRol = actor.grants.get(permiso)
        if (actorRol === undefined || (actor.permisosToken && !actor.permisosToken.has(permiso))) {
            errores.push({ field: campos.permiso, rule: codigo, message: `No tienes el permiso ${permiso}` })
            continue
        }
        if (!rolCubre(actorRol, destRol, destTok) || !tokenCubre(actor.restricciones, destRol, destTok)) {
            errores.push({
                field: campos.alcance,
                rule: codigo,
                message: `El permiso ${permiso} ${sujeto} llega a routers, zonas o cajas fuera de tu alcance`,
            })
        }
    }
    return errores
}

/** Errores si el usuario `usuarioId` opera empresas fuera del alcance del actor. */
async function empresasNoCubiertas(
    cliente: QueryClientContract,
    actor: ActorCobertura,
    usuarioId: number,
    codigo: Codigo,
    campo: string,
    sujeto: string,
): Promise<ErrorCampo[]> {
    if (actor.usuarioId === usuarioId) return []
    const [empActor, empDestino] = await Promise.all([
        alcanceEmpresasDeUsuario(actor.usuarioId, cliente),
        alcanceEmpresasDeUsuario(usuarioId, cliente),
    ])
    if (empActor.alcanceGlobal) return []
    if (empDestino.alcanceGlobal) {
        return [{ field: campo, rule: codigo, message: `${sujeto} tiene alcance global de empresas y tú no` }]
    }
    const asignadas = await empresasAsignadas([actor.usuarioId, usuarioId], cliente)
    const propias = asignadas.get(actor.usuarioId) ?? []
    const fuera = (asignadas.get(usuarioId) ?? []).filter((e) => !propias.includes(e))
    if (fuera.length === 0) return []
    return [
        {
            field: campo,
            rule: codigo,
            message: `${sujeto} opera empresas fuera de tu alcance: ${fuera.join(', ')}`,
        },
    ]
}

/**
 * 403 `token_excede_permisos` si el actor no cubre un token del usuario `usuarioId` con
 * `alcances` (al crearlo o al revocar el de otro usuario).
 */
export async function exigirCoberturaToken(
    cliente: QueryClientContract,
    ctx: ContextoAccion,
    usuarioId: number,
    alcances: AlcancesToken | null | undefined,
    opciones: { verbo: 'crear' | 'revocar' },
): Promise<void> {
    const actor = await coberturaDelActor(cliente, ctx, CODIGO_TOKEN_EXCEDE)
    if (!actor) return

    const destino = await grantsDeUsuario(cliente, usuarioId)
    if (alcances?.permisos) {
        const permitidos = new Set(alcances.permisos)
        for (const permiso of [...destino.keys()]) if (!permitidos.has(permiso)) destino.delete(permiso)
    }
    const crear = opciones.verbo === 'crear'
    const errores = [
        ...permisosNoCubiertos(
            actor,
            destino,
            restriccionesDe(alcances),
            CODIGO_TOKEN_EXCEDE,
            { permiso: crear ? 'alcances.permisos' : 'id', alcance: crear ? 'alcances' : 'id' },
            'del token',
        ),
        ...(await empresasNoCubiertas(
            cliente,
            actor,
            usuarioId,
            CODIGO_TOKEN_EXCEDE,
            'usuario_id',
            'El usuario del token',
        )),
    ]
    if (errores.length > 0) {
        throw new TokenExcedePermisos(
            crear
                ? 'No puedes crear un token con permisos o alcances que tú no tienes'
                : 'No puedes revocar un token con permisos o alcances que tú no tienes',
            errores,
        )
    }
}

/**
 * 403 `rol_excede_permisos` si el usuario `usuarioId`, tal como está ahora en la transacción
 * (roles con su alcance y empresas), tiene algo que `actor` no cubre. Se usa antes de editar a un
 * usuario (no se edita a quien tiene más que uno) y después de asignarle roles.
 */
export async function exigirCoberturaUsuario(
    cliente: QueryClientContract,
    actor: ActorCobertura | null,
    usuarioId: number,
    momento: 'editar' | 'asignar',
): Promise<void> {
    if (!actor) return
    const errores = [
        ...permisosNoCubiertos(
            actor,
            await grantsDeUsuario(cliente, usuarioId),
            {},
            CODIGO_ROL_EXCEDE,
            { permiso: 'roles', alcance: 'roles' },
            'de los roles',
        ),
        ...(await empresasNoCubiertas(cliente, actor, usuarioId, CODIGO_ROL_EXCEDE, 'id', 'El usuario')),
    ]
    if (errores.length > 0) {
        throw new RolExcedePermisos(
            momento === 'editar'
                ? 'No puedes editar a un usuario con permisos, alcances o empresas que tú no tienes'
                : 'No puedes asignar roles con permisos o alcances que tú no tienes',
            errores,
        )
    }
}

/**
 * 403 `rol_excede_permisos` si el actor no tiene, sin alcance de router/zona/caja (ni recorte de
 * su token), cada uno de `permisos` que se agregan a un rol. `actor` se toma antes del cambio: si
 * el rol editado es suyo, lo que le agrega no cuenta.
 */
export function exigirPermisosGlobales(actor: ActorCobertura | null, permisos: string[]): void {
    if (!actor || permisos.length === 0) return
    const destino: Grants = new Map(permisos.map((p) => [p, null]))
    const errores = permisosNoCubiertos(
        actor,
        destino,
        {},
        CODIGO_ROL_EXCEDE,
        { permiso: 'permisos', alcance: 'permisos' },
        'del rol',
    )
    if (errores.length > 0) {
        throw new RolExcedePermisos(
            'No puedes dar a un rol permisos que tú no tienes en todo tu alcance',
            errores,
        )
    }
}
