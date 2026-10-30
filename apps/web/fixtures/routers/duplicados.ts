/**
 * Routers duplicados y unión (A1, `contratos/routers.md`): `GET /routers/duplicados`,
 * `POST /routers/:id/unir` y el 409 `router_duplicado` del alta y la edición, con las mismas
 * claves (`api`, `nas_ip`, `serial`), errores y avisos que `routers_duplicados.ts` y
 * `unir_routers.ts`.
 */
import type { Problem, Schema } from '@argosisp/contracts'
import type { RespuestaFixture, RutasFixture } from '~/utils/fetchFixtures'
import { bd } from '../bd'
import { ahora, conIdempotencia, conPermiso, cuerpoObjeto, datosInvalidos, idDe, noEncontrado, problemaTipado, registrarAccion, versionCambiada } from '../comun'

type Router = Schema<'Router'>
type Grupo = Schema<'GrupoRoutersDuplicados'>
type Motivo = Grupo['motivos'][number]
type Clave = Grupo['claves'][number]

/** Los primeros servicios no retirados de cada router del grupo (`MAXIMO_SERVICIOS` de A1). */
const MAXIMO_SERVICIOS = 50

/** `host:puerto` de la API REST, como `extremoApi` (A1): `api_url` o `https://<host>`. */
export function extremoApi(router: Pick<Router, 'host' | 'api_url'>): string {
    const host = router.host.trim()
    const url = router.api_url ?? (/^https?:\/\//i.test(host) ? host : `https://${host}`)
    try {
        const u = new URL(url)
        return `${u.hostname.toLowerCase()}:${u.port || (u.protocol === 'http:' ? '80' : '443')}`
    }
    catch {
        return url.toLowerCase()
    }
}

type ConClaves = Pick<Router, 'host' | 'api_url' | 'nas_ip'> & { serial?: string | null }

function clavesDe(router: ConClaves): Clave[] {
    const claves: Clave[] = [{ motivo: 'api', valor: extremoApi(router) }]
    // un router sin RADIUS (modo api) puede no tener nas_ip: no choca por esa clave (como la API)
    if (router.nas_ip) {
        claves.push({ motivo: 'nas_ip', valor: router.nas_ip })
    }
    const serial = router.serial?.trim().toLowerCase()
    if (serial) {
        claves.push({ motivo: 'serial', valor: serial })
    }
    return claves
}

function clavesCompartidas(a: ConClaves, b: ConClaves): Motivo[] {
    const ajenas = clavesDe(b)
    return clavesDe(a).filter(c => ajenas.some(o => o.motivo === c.motivo && o.valor === c.valor)).map(c => c.motivo)
}

function mensaje(motivo: Motivo, otro: Router, valor: string): string {
    const quien = `«${otro.nombre}» (router ${otro.id}${otro.activo ? '' : ', desactivado'})`
    switch (motivo) {
        case 'api': return `Ya está registrado como ${quien}: misma dirección de la API (${valor})`
        case 'nas_ip': return `Ya está registrado como ${quien}: misma nas_ip (${valor})`
        case 'serial': return `Ya está registrado como ${quien}: mismo número de serie del equipo (${otro.serial ?? ''})`
    }
}

/**
 * 409 `router_duplicado` como `exigirRouterUnico` (A1): la `nas_ip` choca con cualquier router
 * (UNIQUE), la API y el serial solo con los activos. `null` si no choca.
 */
export function routerDuplicado(router: ConClaves & { id?: number }, revisar: Record<Motivo, boolean>): RespuestaFixture | null {
    const errores: NonNullable<Problem['errors']> = []
    let primero: Router | null = null
    for (const otro of bd.routers.filter(r => r.id !== router.id)) {
        const ajenas = clavesDe(otro)
        for (const clave of clavesDe(router)) {
            if (!revisar[clave.motivo] || (clave.motivo !== 'nas_ip' && !otro.activo)) {
                continue
            }
            if (!ajenas.some(a => a.motivo === clave.motivo && a.valor === clave.valor)) {
                continue
            }
            primero ??= otro
            errores.push({
                field: clave.motivo === 'api' ? (router.api_url ? 'api_url' : 'host') : clave.motivo,
                rule: 'router_duplicado',
                message: mensaje(clave.motivo, otro, clave.valor),
            })
        }
    }
    if (!primero) {
        return null
    }
    return problemaTipado(409, 'router_duplicado', 'Router duplicado', `Ese MikroTik ya está registrado como «${primero.nombre}». Para usar dos formas de control de velocidad en el mismo router, configúralas por plan en su ficha.`, errores)
}

function noRetirados(routerId: number): Schema<'Servicio'>[] {
    return bd.servicios.filter(s => s.router_id === routerId && s.estado !== 'retirado').sort((a, b) => a.id - b.id)
}

function sesionesAbiertas(routerId: number): Schema<'Sesion'>[] {
    return bd.sesiones.filter(s => s.router_id === routerId && s.fin === null)
}

function routerDeGrupo(router: Router): Grupo['routers'][number] {
    const servicios = noRetirados(router.id)
    return {
        id: router.id,
        nombre: router.nombre,
        host: router.host,
        api_url: router.api_url ?? null,
        nas_ip: router.nas_ip,
        serial: router.serial ?? null,
        control_velocidad: router.control_velocidad ?? 'simple',
        servicios_total: servicios.length,
        sesiones_abiertas: sesionesAbiertas(router.id).length,
        servicios: servicios.slice(0, MAXIMO_SERVICIOS).map(s => ({ id: s.id, cliente_id: s.cliente_id, user_ppp: s.user_ppp ?? null, estado: s.estado, tipo_conexion: s.tipo_conexion ?? 'pppoe' })),
        version: router.version,
    }
}

/** Clausura de las claves compartidas entre routers activos, como `gruposDuplicados` (A1). */
export function gruposDuplicados(routerId?: number): Grupo[] {
    const activos = bd.routers.filter(r => r.activo).sort((a, b) => a.id - b.id)
    const padre = new Map(activos.map(r => [r.id, r.id]))
    const raiz = (id: number): number => {
        let r = id
        while (padre.get(r) !== r) {
            r = padre.get(r) ?? r
        }
        return r
    }
    const porClave = new Map<string, Clave & { ids: number[] }>()
    for (const router of activos) {
        for (const clave of clavesDe(router)) {
            const k = `${clave.motivo}|${clave.valor}`
            const grupo = porClave.get(k) ?? { ...clave, ids: [] }
            grupo.ids.push(router.id)
            porClave.set(k, grupo)
        }
    }
    for (const { ids } of porClave.values()) {
        for (const id of ids.slice(1)) {
            const a = raiz(ids[0] ?? id)
            const b = raiz(id)
            if (a !== b) {
                padre.set(Math.max(a, b), Math.min(a, b))
            }
        }
    }
    const grupos = new Map<number, number[]>()
    for (const router of activos) {
        grupos.set(raiz(router.id), [...(grupos.get(raiz(router.id)) ?? []), router.id])
    }
    const resultado: Grupo[] = []
    for (const ids of grupos.values()) {
        if (ids.length < 2 || (routerId !== undefined && !ids.includes(routerId))) {
            continue
        }
        const claves = [...porClave.values()]
            .filter(c => c.ids.length > 1 && c.ids.some(id => ids.includes(id)))
            .map(({ motivo, valor }) => ({ motivo, valor }))
        resultado.push({
            motivos: [...new Set(claves.map(c => c.motivo))].sort(),
            claves,
            routers: activos.filter(r => ids.includes(r.id)).map(routerDeGrupo),
        })
    }
    return resultado
}

function reglaNegocio(codigo: string, detalle: string): RespuestaFixture {
    return problemaTipado(422, codigo, 'Regla de negocio', detalle)
}

/** Como `unirRouters` (A1): valida, arma la respuesta y, si no es simulación, aplica la unión. */
function unir(id: number, cuerpo: Record<string, unknown>): RespuestaFixture {
    const absorberId = Number(cuerpo.absorber_id)
    if (!Number.isInteger(absorberId) || absorberId < 1) {
        return datosInvalidos([{ field: 'absorber_id', message: 'El campo absorber_id debe ser un número', rule: 'number' }])
    }
    if (typeof cuerpo.version !== 'number') {
        return datosInvalidos([{ field: 'version', message: 'El campo version es obligatorio', rule: 'required' }])
    }
    if (absorberId === id) {
        return datosInvalidos([{ field: 'absorber_id', message: 'Un router no se une consigo mismo', rule: 'distinto' }])
    }
    const queda = bd.routers.find(r => r.id === id)
    const absorbido = bd.routers.find(r => r.id === absorberId)
    if (!queda) {
        return noEncontrado('el router')
    }
    if (!absorbido) {
        return datosInvalidos([{ field: 'absorber_id', message: `El router ${absorberId} no existe`, rule: 'exists' }])
    }
    if (queda.unido_a_id) {
        return reglaNegocio('router_unido', `El router «${queda.nombre}» ya está unido al router ${queda.unido_a_id}: une a ese`)
    }
    if (!queda.activo) {
        return reglaNegocio('router_inactivo', `El router «${queda.nombre}» está desactivado: el que queda debe estar activo`)
    }
    if (absorbido.unido_a_id) {
        return reglaNegocio('router_unido', `El router «${absorbido.nombre}» ya está unido al router ${absorbido.unido_a_id}`)
    }
    if (cuerpo.version !== queda.version) {
        return versionCambiada()
    }
    const simular = cuerpo.simular === true
    const avisos: string[] = []
    const bloqueos: Schema<'UnionRouters'>['bloqueos'] = []
    if ((bd.secretosRadius[queda.id] ?? null) !== (bd.secretosRadius[absorbido.id] ?? null)) {
        const texto = `«${queda.nombre}» y «${absorbido.nombre}» tienen secretos RADIUS distintos. Primero deja el mismo secreto en el MikroTik (/radius) y en Argos (el de «${queda.nombre}», que es el que queda), y después únelos`
        if (!simular) {
            return reglaNegocio('secreto_radius_distinto', texto)
        }
        bloqueos.push('secreto_radius_distinto')
        avisos.push(texto)
    }
    const coincidencias = clavesCompartidas(queda, absorbido)
    if (coincidencias.length === 0) {
        avisos.push(`«${queda.nombre}» y «${absorbido.nombre}» no parecen el mismo equipo (no comparten la dirección de la API, la nas_ip ni el número de serie): únelos solo si es el mismo MikroTik`)
    }
    const controlQueda = queda.control_velocidad ?? 'simple'
    const controlAbsorbido = absorbido.control_velocidad ?? 'simple'
    if (controlQueda !== controlAbsorbido) {
        avisos.push(`«${absorbido.nombre}» usaba el control de velocidad ${controlAbsorbido} y «${queda.nombre}» usa ${controlQueda}: sus servicios quedan con ${controlQueda}. Para usar dos formas de control en el mismo router, configúralas por plan en la ficha de «${queda.nombre}»`)
    }
    const planesAbsorbido = [...(bd.planesPorRouter[absorbido.id] ?? [])].sort((a, b) => a - b)
    const planesQueda = bd.planesPorRouter[queda.id] ?? []
    const planesDescartados = planesAbsorbido.filter(p => planesQueda.includes(p))
    const planesMovidos = planesAbsorbido.filter(p => !planesQueda.includes(p))
    for (const planId of planesDescartados) {
        const nombre = bd.planes.find(p => p.id === planId)?.nombre ?? String(planId)
        avisos.push(`El plan «${nombre}» tiene implementación en los dos routers: queda la de «${queda.nombre}» y se descarta la de «${absorbido.nombre}»`)
    }
    const redes = bd.redesIpv4.filter(r => r.router_id === absorbido.id).map(r => r.id).sort((a, b) => a - b)
    const bloques = bd.ipv6Bloques.filter(b => b.router_id === absorbido.id).map(b => b.id).sort((a, b) => a - b)
    const servicios = noRetirados(absorbido.id)
    const retirados = bd.servicios.filter(s => s.router_id === absorbido.id && s.estado === 'retirado').length
    if (retirados > 0) {
        avisos.push(`${retirados} servicios retirados quedan en el historial de «${absorbido.nombre}» (no se mueven)`)
    }
    const sesiones = sesionesAbiertas(absorbido.id)
    if (sesiones.length > 0) {
        avisos.push(`El MikroTik manda RADIUS con la nas_ip de «${absorbido.nombre}» (${absorbido.nas_ip}): al unir, ese registro queda desactivado y deja de ser cliente de RADIUS. Si el equipo usa esa nas_ip, une al revés (que quede «${absorbido.nombre}») o cambia en el equipo el NAS a ${queda.nas_ip}`)
    }
    const encadenados = bd.routers.filter(r => r.unido_a_id === absorbido.id).map(r => r.id)
    avisos.push(`«${absorbido.nombre}» queda desactivado y unido a «${queda.nombre}» (no se elimina: conserva su historial)`)

    const resultado = (despuesQueda: Router, despuesAbsorbido: Router): Schema<'UnionRouters'> => ({
        router_id: queda.id,
        absorbido_id: absorbido.id,
        simulado: simular,
        coincidencias,
        servicios: servicios.map(s => ({ servicio_id: s.id, user_ppp: s.user_ppp ?? null, estado: s.estado, tipo_conexion: s.tipo_conexion ?? 'pppoe' })),
        redes_ipv4: redes,
        ipv6_bloques: bloques,
        planes_movidos: planesMovidos,
        planes_descartados: planesDescartados,
        sesiones_abiertas: sesiones.length,
        avisos,
        bloqueos,
        reencadenados: encadenados,
        router: despuesQueda,
        absorbido: despuesAbsorbido,
    })

    if (simular) {
        // La simulación revierte todo: los dos routers como quedarían, sin tocar `bd`.
        return { status: 200, cuerpo: resultado(queda, { ...absorbido, activo: false, unido_a_id: queda.id, version: absorbido.activo ? absorbido.version + 1 : absorbido.version }) }
    }

    const instante = ahora()
    bd.planesPorRouter[queda.id] = [...planesQueda, ...planesMovidos]
    bd.planesPorRouter[absorbido.id] = []
    bd.implementacionesPlan = bd.implementacionesPlan
        .filter(i => !(i.router_id === absorbido.id && planesDescartados.includes(i.plan_id)))
        .map(i => (i.router_id === absorbido.id ? { ...i, router_id: queda.id, version: i.version + 1, updated_at: instante } : i))
    for (const red of bd.redesIpv4.filter(r => r.router_id === absorbido.id)) {
        Object.assign(red, { router_id: queda.id, version: red.version + 1, updated_at: instante })
    }
    for (const bloque of bd.ipv6Bloques.filter(b => b.router_id === absorbido.id)) {
        Object.assign(bloque, { router_id: queda.id, version: bloque.version + 1, updated_at: instante })
    }
    // Cada servicio con `servicios.editar` anidada y `motivo: 'union_routers'`: mismas direcciones, sin Disconnect.
    for (const servicio of servicios) {
        Object.assign(servicio, { router_id: queda.id, router_nombre: queda.nombre, version: servicio.version + 1, updated_at: instante })
    }
    for (const sesion of sesiones) {
        sesion.router_id = queda.id
    }
    Object.assign(absorbido, { activo: false, unido_a_id: queda.id, version: absorbido.activo ? absorbido.version + 1 : absorbido.version, updated_at: instante })
    for (const router of bd.routers.filter(r => encadenados.includes(r.id))) {
        router.unido_a_id = queda.id
    }
    return { status: 200, cuerpo: resultado(queda, absorbido) }
}

export const rutasDuplicados: RutasFixture = {
    'GET /api/v1/routers/duplicados': conPermiso('routers.ver', (solicitud) => {
        const valor = solicitud.query.get('router_id')
        const routerId = valor ? Number(valor) : undefined
        if (routerId !== undefined && (!Number.isInteger(routerId) || routerId < 1)) {
            return datosInvalidos([{ field: 'router_id', message: 'El campo router_id debe ser un número positivo', rule: 'positive' }])
        }
        return { status: 200, cuerpo: gruposDuplicados(routerId) }
    }),

    'POST /api/v1/routers/:id/unir': conPermiso('routers.unir', conIdempotencia((solicitud) => {
        const id = idDe(solicitud)
        if (id === null) {
            return noEncontrado('el router')
        }
        const cuerpo = cuerpoObjeto(solicitud)
        const respuesta = unir(id, cuerpo)
        // La simulación no deja auditoría (`simularEnTransaccion`); la unión sí.
        if (respuesta.status === 200 && cuerpo.simular !== true) {
            registrarAccion(solicitud, 'routers.unir', { tipo: 'router', id }, cuerpo)
        }
        return respuesta
    })),
}
