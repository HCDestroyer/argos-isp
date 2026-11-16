import type { QueryClientContract } from '@adonisjs/lucid/types/database'
import { Problema, type ErrorCampo } from '#shared/errores'
import type { ContextoAccion } from '#shared/contexto'
import { TIPOS_ALCANCE, type Alcance, type AlcancesToken, type TipoAlcance } from '#core/acl'
import { alcanceEmpresasDeUsuario, empresasAsignadas } from '#core/alcance_empresas'

/**
 * Cobertura de tokens de API: quien crea o revoca un token debe tener, como mínimo, lo que tendría
 * (o tiene) ese token. Evita la escalada "tengo `tokens.crear` → me hago un token de un admin".
 *
 * Lo que tendría el token = permisos del usuario destino ∩ `alcances.permisos`, cada uno con el
 * alcance de rol del destino (router/zona/caja) y las restricciones `routers`/`zonas`/`cajas` del
 * token, más las empresas del destino (`core.usuarios.alcance_global` / `core.usuarios_empresas`).
 *
 * Lo que tiene el actor = sus permisos con su alcance de rol y, si actúa con un token de API
 * (`ctx.tokenApiId`), recortados por los alcances de ese token; las empresas son las del usuario.
 *
 * La comparación es conservadora (si no se puede probar que el actor cubre al token, se rechaza)
 * con 403 `token_excede_permisos`. Un admin global (todos los permisos sin alcance y
 * `alcance_global`) cubre cualquier token. El sistema (consola, seeds) no se comprueba.
 */

export const CODIGO_TOKEN_EXCEDE = 'token_excede_permisos'

export class TokenExcedePermisos extends Problema {
    constructor(detalle: string, errores?: ErrorCampo[]) {
        super(403, CODIGO_TOKEN_EXCEDE, 'El token excede tus permisos', detalle, errores)
    }
}

type AlcanceRol = Alcance['rol']
type Restricciones = Partial<Record<TipoAlcance, number[]>>

const CLAVES_TOKEN: Record<TipoAlcance, 'routers' | 'zonas' | 'cajas'> = {
    router: 'routers',
    zona: 'zonas',
    caja: 'cajas',
}

/** permiso → alcance de rol con el que lo tiene el usuario (null = global). */
async function grantsDeUsuario(
    cliente: QueryClientContract,
    usuarioId: number,
): Promise<Map<string, AlcanceRol>> {
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
    const mapa = new Map<string, AlcanceRol>()
    for (const fila of filas) {
        if (mapa.has(fila.nombre) && mapa.get(fila.nombre) === null) continue
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
    const tiposActor = tiposConGrant(actorRol)
    // 1) el rol del destino está contenido tipo por tipo en el del actor
    if (destRol !== null && TIPOS_ALCANCE.every((tipo) => subconjunto(destRol[tipo], actorRol[tipo]))) {
        return true
    }
    // 2) el token del destino se restringe, en cada tipo con grant del actor, a ids del actor
    return tiposActor.every(
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

interface ActorResuelto {
    usuarioId: number
    alcances: AlcancesToken | null
}

async function resolverActor(
    cliente: QueryClientContract,
    ctx: ContextoAccion,
): Promise<ActorResuelto | null> {
    const { actor } = ctx
    if (actor.tipo === 'sistema') return null
    if (actor.tipo === 'cliente' || actor.id === null) {
        throw new TokenExcedePermisos('Solo un usuario del panel o un token de API administra tokens')
    }
    if (actor.tipo !== 'token') return { usuarioId: actor.id, alcances: null }
    if (!ctx.tokenApiId) {
        throw new TokenExcedePermisos('No se pudo identificar el token de API con el que actúas')
    }
    const fila = (await cliente
        .from('core.tokens_api')
        .where('id', ctx.tokenApiId)
        .select('usuario_id', 'alcances')
        .first()) as { usuario_id: number; alcances: AlcancesToken | null } | null
    if (!fila || Number(fila.usuario_id) !== actor.id) {
        throw new TokenExcedePermisos('No se pudo identificar el token de API con el que actúas')
    }
    return { usuarioId: actor.id, alcances: fila.alcances ?? {} }
}

/**
 * 403 `token_excede_permisos` si el actor no cubre un token del usuario `usuarioId` con
 * `alcances`. `campo` prefija los `errors[].field` (`alcances` al crear, `id` al revocar).
 */
export async function exigirCoberturaToken(
    cliente: QueryClientContract,
    ctx: ContextoAccion,
    usuarioId: number,
    alcances: AlcancesToken | null | undefined,
    opciones: { verbo: 'crear' | 'revocar' },
): Promise<void> {
    const actor = await resolverActor(cliente, ctx)
    if (!actor) return

    const [grantsActor, grantsDestino] = await Promise.all([
        grantsDeUsuario(cliente, actor.usuarioId),
        grantsDeUsuario(cliente, usuarioId),
    ])
    const actorTok = restriccionesDe(actor.alcances)
    const actorPermisos = actor.alcances?.permisos ? new Set(actor.alcances.permisos) : null
    const destTok = restriccionesDe(alcances)
    const destPermisos = alcances?.permisos ? new Set(alcances.permisos) : null

    const errores: ErrorCampo[] = []
    const campoPermisos = opciones.verbo === 'crear' ? 'alcances.permisos' : 'id'
    for (const [permiso, destRol] of [...grantsDestino.entries()].sort(([a], [b]) => a.localeCompare(b))) {
        if (destPermisos && !destPermisos.has(permiso)) continue
        const actorRol = grantsActor.get(permiso)
        if (actorRol === undefined || (actorPermisos && !actorPermisos.has(permiso))) {
            errores.push({
                field: campoPermisos,
                rule: CODIGO_TOKEN_EXCEDE,
                message: `No tienes el permiso ${permiso}`,
            })
            continue
        }
        if (!rolCubre(actorRol, destRol, destTok) || !tokenCubre(actorTok, destRol, destTok)) {
            errores.push({
                field: opciones.verbo === 'crear' ? 'alcances' : 'id',
                rule: CODIGO_TOKEN_EXCEDE,
                message: `El permiso ${permiso} del token llega a routers, zonas o cajas fuera de tu alcance`,
            })
        }
    }

    const [empActor, empDestino] = await Promise.all([
        alcanceEmpresasDeUsuario(actor.usuarioId, cliente),
        alcanceEmpresasDeUsuario(usuarioId, cliente),
    ])
    if (!empActor.alcanceGlobal) {
        if (empDestino.alcanceGlobal) {
            errores.push({
                field: 'usuario_id',
                rule: CODIGO_TOKEN_EXCEDE,
                message: 'El usuario del token tiene alcance global de empresas y tú no',
            })
        } else {
            const asignadas = await empresasAsignadas([actor.usuarioId, usuarioId], cliente)
            const propias = asignadas.get(actor.usuarioId) ?? []
            const fuera = (asignadas.get(usuarioId) ?? []).filter((e) => !propias.includes(e))
            if (fuera.length > 0) {
                errores.push({
                    field: 'usuario_id',
                    rule: CODIGO_TOKEN_EXCEDE,
                    message: `El usuario del token opera empresas fuera de tu alcance: ${fuera.join(', ')}`,
                })
            }
        }
    }

    if (errores.length > 0) {
        throw new TokenExcedePermisos(
            opciones.verbo === 'crear'
                ? 'No puedes crear un token con permisos o alcances que tú no tienes'
                : 'No puedes revocar un token con permisos o alcances que tú no tienes',
            errores,
        )
    }
}
