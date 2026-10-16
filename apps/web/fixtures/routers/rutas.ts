import type { Schema } from '@argosisp/contracts'
import type { RutasFixture } from '~/utils/fetchFixtures'
import { bd } from '../bd'
import { ahora, conPermiso, cuerpoObjeto, datosInvalidos, idDe, noEncontrado, paginar, registrarAccion, versionCambiada } from '../comun'
import { vistaPreviaControl } from './vistaPrevia'

function existeRouter(id: number | null): boolean {
    return bd.routers.some(router => router.id === id)
}

/** `PlanEfectivo` como `GET /routers/:id/planes`: el plan en el router y su rate-limit. */
function efectivo(plan: Schema<'Plan'>, routerId: number): Schema<'PlanEfectivo'> {
    const velocidad = velocidadDePlan(plan)
    return {
        ...plan,
        router_id: routerId,
        implementacion: null,
        rate_limit: rateLimitServicio(velocidad, 'activo'),
        rate_limit_limitado: rateLimitServicio(velocidad, 'limitado'),
        profile_ppp: 'default',
        pool_ipv4: null,
        pool_ipv6_enlace: null,
        pool_ipv6_delegacion: null,
        local_address: null,
        no_crear_reglas: false,
    }
}

function capacidadValida(valor: unknown): boolean {
    return valor === null || valor === undefined || (typeof valor === 'number' && Number.isInteger(valor) && valor >= 1 && valor <= 100_000_000)
}

export const rutasRouters: RutasFixture = {
    'GET /api/v1/routers': conPermiso('routers.ver', (solicitud) => {
        const activo = solicitud.query.get('activo')
        const filas = bd.routers.filter(router => activo === null || String(router.activo) === activo)
        return { status: 200, cuerpo: paginar(filas, solicitud) }
    }),

    'GET /api/v1/routers/:id': conPermiso('routers.ver', (solicitud) => {
        const router = bd.routers.find(r => r.id === idDe(solicitud))
        return router ? { status: 200, cuerpo: router } : noEncontrado('el router')
    }),

    /** Como `EditarRouter` (A1): ya no cambia el modo de colas; sí la capacidad. 409 por versión. */
    'PUT /api/v1/routers/:id': conPermiso('routers.editar', (solicitud) => {
        const router = bd.routers.find(r => r.id === idDe(solicitud))
        if (!router) {
            return noEncontrado('el router')
        }
        const cuerpo = cuerpoObjeto(solicitud)
        if (cuerpo.version !== router.version) {
            return versionCambiada()
        }
        const errores = (['capacidad_bajada_kbps', 'capacidad_subida_kbps'] as const)
            .filter(campo => !capacidadValida(cuerpo[campo]))
            .map(campo => ({ field: campo, message: 'Debe ser un entero entre 1 y 100000000', rule: 'range' }))
        if (errores.length) {
            return datosInvalidos(errores)
        }
        const capacidad = (campo: 'capacidad_bajada_kbps' | 'capacidad_subida_kbps') => (campo in cuerpo ? (cuerpo[campo] as number | null) : router[campo] ?? null)
        Object.assign(router, {
            capacidad_bajada_kbps: capacidad('capacidad_bajada_kbps'),
            capacidad_subida_kbps: capacidad('capacidad_subida_kbps'),
            version: router.version + 1,
            updated_at: ahora(),
        })
        registrarAccion(solicitud, 'routers.editar', { tipo: 'router', id: router.id }, cuerpo)
        return { status: 200, cuerpo: router }
    }),

    /** Como `vistaPreviaControl` (A2): mismo permiso que la acción, 422 si `a` no es válido, 404 sin router. */
    'GET /api/v1/routers/:id/vista-previa-control': conPermiso('routers.cambiar_control_velocidad', (solicitud) => {
        const router = bd.routers.find(r => r.id === idDe(solicitud))
        if (!router) {
            return noEncontrado('el router')
        }
        const a = solicitud.query.get('a')
        if (a !== 'simple' && a !== 'arbol_pcq') {
            return datosInvalidos([{ field: 'a', message: 'El valor de a no es válido', rule: 'enum' }])
        }
        return { status: 200, cuerpo: vistaPreviaControl(router, a) }
    }),

    /** Como `CambiarControlVelocidad` (A1, solo admin): 409 por versión; `modo_velocidad` derivado. */
    'POST /api/v1/routers/:id/cambiar-control-velocidad': conPermiso('routers.cambiar_control_velocidad', (solicitud) => {
        const router = bd.routers.find(r => r.id === idDe(solicitud))
        if (!router) {
            return noEncontrado('el router')
        }
        const cuerpo = cuerpoObjeto(solicitud)
        if (cuerpo.control_velocidad !== 'simple' && cuerpo.control_velocidad !== 'arbol_pcq') {
            return datosInvalidos([{ field: 'control_velocidad', message: 'Debe ser simple o arbol_pcq', rule: 'enum' }])
        }
        if (cuerpo.version !== router.version) {
            return versionCambiada()
        }
        Object.assign(router, {
            control_velocidad: cuerpo.control_velocidad,
            modo_velocidad: cuerpo.control_velocidad === 'arbol_pcq' ? 'pcq' : 'simple',
            version: router.version + 1,
            updated_at: ahora(),
        })
        registrarAccion(solicitud, 'routers.cambiar_control_velocidad', { tipo: 'router', id: router.id }, cuerpo)
        return { status: 200, cuerpo: router }
    }),

    'GET /api/v1/routers/:id/planes': conPermiso('planes.ver', (solicitud) => {
        const id = idDe(solicitud)
        if (!existeRouter(id) || id === null) {
            return noEncontrado('el router')
        }
        const implementados = bd.planesPorRouter[id] ?? []
        return { status: 200, cuerpo: bd.planes.filter(plan => implementados.includes(plan.id)).map(plan => efectivo(plan, id)) }
    }),

    'GET /api/v1/routers/:id/redes-ipv4': conPermiso('redes.ver', (solicitud) => {
        const id = idDe(solicitud)
        return existeRouter(id)
            ? { status: 200, cuerpo: bd.redesIpv4.filter(red => red.router_id === id) }
            : noEncontrado('el router')
    }),

    'GET /api/v1/routers/:id/ipv6-bloques': conPermiso('ipv6.ver', (solicitud) => {
        const id = idDe(solicitud)
        return existeRouter(id)
            ? { status: 200, cuerpo: bd.ipv6Bloques.filter(bloque => bloque.router_id === id) }
            : noEncontrado('el router')
    }),
}
