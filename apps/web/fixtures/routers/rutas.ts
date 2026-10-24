import type { Problem, Schema } from '@argosisp/contracts'
import type { RutasFixture } from '~/utils/fetchFixtures'
import { bd } from '../bd'
import { ahora, conPermiso, cuerpoObjeto, datosInvalidos, empresasDeLista, idDe, noEncontrado, paginar, registrarAccion, versionCambiada } from '../comun'
import { rateLimitServicio, velocidadDePlan } from '../planes/velocidad'
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

const API_URL = /^https?:\/\/[^\s/]+(:\d{1,5})?\/?$/

/** Como `camposConexionApi` (A1): los cinco campos de conexión, opcionales y nulables. */
function erroresConexion(cuerpo: Record<string, unknown>): NonNullable<Problem['errors']> {
    const errores: NonNullable<Problem['errors']> = []
    const texto = (campo: string, maximo: number, patron?: RegExp, mensaje = 'Formato inválido') => {
        const valor = cuerpo[campo]
        if (valor === undefined || valor === null) {
            return
        }
        if (typeof valor !== 'string' || valor.trim().length < 1 || valor.trim().length > maximo) {
            errores.push({ field: campo, message: `Debe tener entre 1 y ${maximo} caracteres`, rule: 'maxLength' })
            return
        }
        if (patron && !patron.test(valor.trim())) {
            errores.push({ field: campo, message: mensaje, rule: 'regex' })
        }
    }
    texto('api_url', 300, API_URL, 'Debe ser https://host o https://host:puerto')
    texto('api_ca', 20_000, /^-----BEGIN CERTIFICATE-----/, 'Debe ser un certificado PEM')
    texto('dhcp_servidor', 100)
    texto('interfaz_clientes', 100)
    if (cuerpo.api_tls_verificar !== undefined && typeof cuerpo.api_tls_verificar !== 'boolean') {
        errores.push({ field: 'api_tls_verificar', message: 'Debe ser verdadero o falso', rule: 'boolean' })
    }
    return errores
}

function capacidadValida(valor: unknown): boolean {
    return valor === null || valor === undefined || (typeof valor === 'number' && Number.isInteger(valor) && valor >= 1 && valor <= 100_000_000)
}

export const rutasRouters: RutasFixture = {
    'GET /api/v1/routers': conPermiso('routers.ver', (solicitud) => {
        const activo = solicitud.query.get('activo')
        // Multiempresa (A1): sin empresa sugerida, sugeridos para la empresa o con servicios de ella.
        const empresas = empresasDeLista(solicitud)
        const filas = bd.routers
            .filter(router => activo === null || String(router.activo) === activo)
            .filter(router => empresas === null || router.empresa_sugerida_id === null || empresas.includes(router.empresa_sugerida_id)
                || bd.servicios.some(s => s.router_id === router.id && empresas.includes(s.empresa_id)))
        return { status: 200, cuerpo: paginar(filas, solicitud) }
    }),

    'GET /api/v1/routers/:id': conPermiso('routers.ver', (solicitud) => {
        const router = bd.routers.find(r => r.id === idDe(solicitud))
        return router ? { status: 200, cuerpo: router } : noEncontrado('el router')
    }),

    /** Como `EditarRouter` (A1): ya no cambia el modo de colas; sí la capacidad y la conexión. 409 por versión. */
    'PUT /api/v1/routers/:id': conPermiso('routers.editar', (solicitud) => {
        const router = bd.routers.find(r => r.id === idDe(solicitud))
        if (!router) {
            return noEncontrado('el router')
        }
        const cuerpo = cuerpoObjeto(solicitud)
        if (cuerpo.version !== router.version) {
            return versionCambiada()
        }
        const errores: NonNullable<Problem['errors']> = (['capacidad_bajada_kbps', 'capacidad_subida_kbps'] as const)
            .filter(campo => !capacidadValida(cuerpo[campo]))
            .map(campo => ({ field: campo, message: 'Debe ser un entero entre 1 y 100000000', rule: 'range' }))
        errores.push(...erroresConexion(cuerpo))
        if (errores.length) {
            return datosInvalidos(errores)
        }
        const capacidad = (campo: 'capacidad_bajada_kbps' | 'capacidad_subida_kbps') => (campo in cuerpo ? (cuerpo[campo] as number | null) : router[campo] ?? null)
        const conexion = <K extends 'api_url' | 'api_tls_verificar' | 'dhcp_servidor' | 'interfaz_clientes'>(campo: K): Schema<'Router'>[K] => {
            const valor = campo in cuerpo ? cuerpo[campo] : router[campo]
            return (typeof valor === 'string' ? valor.trim() : valor) as Schema<'Router'>[K]
        }
        Object.assign(router, {
            capacidad_bajada_kbps: capacidad('capacidad_bajada_kbps'),
            capacidad_subida_kbps: capacidad('capacidad_subida_kbps'),
            api_url: conexion('api_url'),
            api_tls_verificar: conexion('api_tls_verificar'),
            // Como la API (fila 57 de a4.md): el PEM nunca sale; solo si hay CA cargada.
            tiene_api_ca: 'api_ca' in cuerpo ? typeof cuerpo.api_ca === 'string' : router.tiene_api_ca,
            api_ca: ('api_ca' in cuerpo ? typeof cuerpo.api_ca === 'string' : router.tiene_api_ca) ? '***' : null,
            dhcp_servidor: conexion('dhcp_servidor'),
            interfaz_clientes: conexion('interfaz_clientes'),
            // Multiempresa (A1): `empresa_sugerida_id` (null la quita); sin el campo, se conserva.
            empresa_sugerida_id: 'empresa_sugerida_id' in cuerpo ? (cuerpo.empresa_sugerida_id as number | null) : router.empresa_sugerida_id,
            version: router.version + 1,
            updated_at: ahora(),
        })
        // Como la API: la CA se audita como `***`.
        registrarAccion(solicitud, 'routers.editar', { tipo: 'router', id: router.id }, typeof cuerpo.api_ca === 'string' ? { ...cuerpo, api_ca: '***' } : cuerpo)
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
