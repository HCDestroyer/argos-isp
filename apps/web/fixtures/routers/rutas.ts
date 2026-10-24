import type { Problem, Schema } from '@argosisp/contracts'
import type { RutasFixture } from '~/utils/fetchFixtures'
import { bd } from '../bd'
import { ahora, conPermiso, cuerpoObjeto, datosInvalidos, empresasDeLista, idDe, noEncontrado, paginar, registrarAccion, versionCambiada } from '../comun'
import { rateLimitServicio, velocidadDePlan } from '../planes/velocidad'
import { SIN_CONTACTO } from './datos'
import { vistaPreviaControl } from './vistaPrevia'

function existeRouter(id: number | null): boolean {
    return bd.routers.some(router => router.id === id)
}

/** `PlanEfectivo` como `GET /routers/:id/planes`: el plan en el router y su rate-limit. */
export function efectivo(plan: Schema<'Plan'>, routerId: number): Schema<'PlanEfectivo'> {
    const velocidad = velocidadDePlan(plan)
    const implementacion = bd.implementacionesPlan.find(i => i.plan_id === plan.id && i.router_id === routerId) ?? null
    return {
        ...plan,
        router_id: routerId,
        implementacion,
        rate_limit: implementacion?.rate_limit_override ?? rateLimitServicio(velocidad, 'activo'),
        rate_limit_limitado: rateLimitServicio(velocidad, 'limitado'),
        profile_ppp: implementacion?.profile_ppp ?? 'default',
        pool_ipv4: implementacion?.pool_ipv4 ?? null,
        pool_ipv6_enlace: implementacion?.pool_ipv6_enlace ?? null,
        pool_ipv6_delegacion: implementacion?.pool_ipv6_delegacion ?? null,
        local_address: implementacion?.local_address ?? null,
        no_crear_reglas: implementacion?.no_crear_reglas ?? false,
    }
}

const API_URL = /^https?:\/\/[^\s/]+(:\d{1,5})?\/?$/
const IPV4 = /^((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$/
const CIDR_V4 = /^(\d{1,3}\.){3}\d{1,3}\/([0-9]|[12][0-9]|3[0-2])$/
const CIDR_V6 = /^[0-9a-fA-F:]+\/([0-9]|[1-9][0-9]|1[01][0-9]|12[0-8])$/

/** IPv6 en CIDR a (red, largo) como BigInt, para saber si un pool cae dentro de su bloque. */
function redV6(cidr: string): { red: bigint, largo: number } | null {
    const [direccion = '', largoTexto = ''] = cidr.split('/')
    const [izquierda = '', derecha] = direccion.split('::')
    const partes = (texto: string) => (texto ? texto.split(':') : [])
    const grupos = derecha === undefined
        ? partes(izquierda)
        : [...partes(izquierda), ...Array<string>(8 - partes(izquierda).length - partes(derecha).length).fill('0'), ...partes(derecha)]
    if (grupos.length !== 8) {
        return null
    }
    const valor = grupos.reduce((total, grupo) => (total << 16n) + BigInt(parseInt(grupo || '0', 16)), 0n)
    const largo = Number(largoTexto)
    const mascara = largo === 0 ? 0n : ((1n << BigInt(largo)) - 1n) << BigInt(128 - largo)
    return { red: valor & mascara, largo }
}

function dentroDe(pool: string, bloque: string): boolean {
    const p = redV6(pool)
    const b = redV6(bloque)
    if (!p || !b || p.largo < b.largo) {
        return false
    }
    const mascara = b.largo === 0 ? 0n : ((1n << BigInt(b.largo)) - 1n) << BigInt(128 - b.largo)
    return (p.red & mascara) === b.red
}

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

    /** Como `CrearRouter` (A1): nombre, host y NAS obligatorios; NAS único; secretos sin devolverse. */
    'POST /api/v1/routers': conPermiso('routers.crear', (solicitud) => {
        const cuerpo = cuerpoObjeto(solicitud)
        const nombre = typeof cuerpo.nombre === 'string' ? cuerpo.nombre.trim() : ''
        const host = typeof cuerpo.host === 'string' ? cuerpo.host.trim() : ''
        const nas = typeof cuerpo.nas_ip === 'string' ? cuerpo.nas_ip.trim() : ''
        const errores = [
            ...(nombre.length < 2 ? [{ field: 'nombre', message: 'El nombre debe tener al menos 2 caracteres', rule: 'minLength' }] : []),
            ...(!host ? [{ field: 'host', message: 'El host es obligatorio', rule: 'required' }] : []),
            ...(!IPV4.test(nas) ? [{ field: 'nas_ip', message: 'El NAS debe ser una IPv4', rule: 'ipAddress' }] : []),
            ...(bd.routers.some(r => r.nas_ip === nas) ? [{ field: 'nas_ip', message: 'Ya hay un router con esa IP de NAS', rule: 'unique' }] : []),
        ]
        if (errores.length) {
            return datosInvalidos(errores)
        }
        const control = cuerpo.control_velocidad === 'arbol_pcq' ? 'arbol_pcq' : 'simple'
        const creado = ahora()
        const router: Schema<'Router'> = {
            id: Math.max(0, ...bd.routers.map(r => r.id)) + 1,
            nombre,
            host,
            api_usuario: typeof cuerpo.api_usuario === 'string' ? cuerpo.api_usuario : null,
            tiene_api_password: typeof cuerpo.api_password === 'string' && cuerpo.api_password.length > 0,
            tiene_radius_secret: typeof cuerpo.radius_secret === 'string' && cuerpo.radius_secret.length > 0,
            nas_ip: nas,
            modo_seguridad: cuerpo.modo_seguridad === 'api' ? 'api' : 'radius',
            control_velocidad: control,
            capacidad_bajada_kbps: null,
            capacidad_subida_kbps: null,
            modo_velocidad: control === 'arbol_pcq' ? 'pcq' : 'simple',
            activo: cuerpo.activo !== false,
            api_url: null,
            api_tls_verificar: cuerpo.api_tls_verificar !== false,
            // Como la API: el PEM nunca sale; `***` solo si se cargó una CA.
            tiene_api_ca: typeof cuerpo.api_ca === 'string' && cuerpo.api_ca.length > 0,
            api_ca: typeof cuerpo.api_ca === 'string' && cuerpo.api_ca.length > 0 ? '***' : null,
            dhcp_servidor: null,
            interfaz_clientes: null,
            empresa_sugerida_id: null,
            ...SIN_CONTACTO,
            version: 1,
            created_at: creado,
            updated_at: creado,
        }
        bd.routers.push(router)
        registrarAccion(solicitud, 'routers.crear', { tipo: 'router', id: router.id }, { ...cuerpo, api_password: '***', radius_secret: '***' })
        return { status: 201, cuerpo: router }
    }),

    /** Como `CrearRedIpv4` (A1): CIDR válido y sin solaparse con otra red del sistema. */
    'POST /api/v1/routers/:id/redes-ipv4': conPermiso('redes.crear', (solicitud) => {
        const id = idDe(solicitud)
        if (!existeRouter(id) || id === null) {
            return noEncontrado('el router')
        }
        const cuerpo = cuerpoObjeto(solicitud)
        const cidr = typeof cuerpo.cidr === 'string' ? cuerpo.cidr.trim() : ''
        if (!CIDR_V4.test(cidr)) {
            return datosInvalidos([{ field: 'cidr', message: 'La red debe estar en notación CIDR', rule: 'regex' }])
        }
        if (bd.redesIpv4.some(r => r.cidr === cidr)) {
            return datosInvalidos([{ field: 'cidr', message: `La red ${cidr} se solapa con otra ya registrada`, rule: 'solapamiento' }])
        }
        const red: Schema<'RedIpv4'> = { id: Math.max(0, ...bd.redesIpv4.map(r => r.id)) + 1, router_id: id, cidr, gateway: typeof cuerpo.gateway === 'string' ? cuerpo.gateway : null, tipo: cuerpo.tipo === 'estatico' ? 'estatico' : 'pool', version: 1, created_at: ahora(), updated_at: ahora() }
        bd.redesIpv4.push(red)
        registrarAccion(solicitud, 'redes.crear', { tipo: 'red_ipv4', id: red.id }, cuerpo)
        return { status: 201, cuerpo: red }
    }),

    'POST /api/v1/routers/:id/ipv6-bloques': conPermiso('ipv6.crear', (solicitud) => {
        const id = idDe(solicitud)
        if (!existeRouter(id) || id === null) {
            return noEncontrado('el router')
        }
        const prefijo = String(cuerpoObjeto(solicitud).prefijo ?? '').trim()
        if (!CIDR_V6.test(prefijo)) {
            return datosInvalidos([{ field: 'prefijo', message: 'El prefijo debe estar en notación CIDR', rule: 'regex' }])
        }
        if (bd.ipv6Bloques.some(b => b.prefijo === prefijo)) {
            return datosInvalidos([{ field: 'prefijo', message: `El bloque ${prefijo} se solapa con otro`, rule: 'solapamiento' }])
        }
        const bloque: Schema<'Ipv6Bloque'> = { id: Math.max(0, ...bd.ipv6Bloques.map(b => b.id)) + 1, router_id: id, prefijo, version: 1, created_at: ahora(), updated_at: ahora() }
        bd.ipv6Bloques.push(bloque)
        registrarAccion(solicitud, 'ipv6.crear', { tipo: 'ipv6_bloque', id: bloque.id }, { prefijo })
        return { status: 201, cuerpo: bloque }
    }),

    'GET /api/v1/ipv6-bloques/:id/pools': conPermiso('ipv6.ver', (solicitud) => {
        const id = idDe(solicitud)
        return bd.ipv6Bloques.some(b => b.id === id)
            ? { status: 200, cuerpo: bd.ipv6Pools.filter(p => p.bloque_id === id) }
            : noEncontrado('el bloque')
    }),

    /** Como `CrearIpv6Pool` (A1): CIDR, enlace siempre /64, sin repetir prefijo. */
    'POST /api/v1/ipv6-bloques/:id/pools': conPermiso('ipv6.crear', (solicitud) => {
        const bloque = bd.ipv6Bloques.find(b => b.id === idDe(solicitud))
        if (!bloque) {
            return noEncontrado('el bloque')
        }
        const cuerpo = cuerpoObjeto(solicitud)
        const prefijo = typeof cuerpo.prefijo === 'string' ? cuerpo.prefijo.trim() : ''
        const tipo = cuerpo.tipo === 'enlace' ? 'enlace' : 'delegacion'
        const tamano = cuerpo.tamano_entrega === 64 || cuerpo.tamano_entrega === 48 ? cuerpo.tamano_entrega : 56
        if (!CIDR_V6.test(prefijo)) {
            return datosInvalidos([{ field: 'prefijo', message: 'El prefijo debe estar en notación CIDR', rule: 'regex' }])
        }
        if (!dentroDe(prefijo, bloque.prefijo)) {
            return datosInvalidos([{ field: 'prefijo', message: `El pool ${prefijo} no está dentro del bloque ${bloque.prefijo}`, rule: 'dentro_del_bloque' }])
        }
        if (tipo === 'enlace' && tamano !== 64) {
            return datosInvalidos([{ field: 'tamano_entrega', message: 'Un pool de enlace entrega /64', rule: 'coherencia' }])
        }
        if (bd.ipv6Pools.some(p => p.prefijo === prefijo)) {
            return datosInvalidos([{ field: 'prefijo', message: `El pool ${prefijo} ya existe`, rule: 'solapamiento' }])
        }
        const pool: Schema<'Ipv6Pool'> = { id: Math.max(0, ...bd.ipv6Pools.map(p => p.id)) + 1, bloque_id: bloque.id, prefijo, tipo, tamano_entrega: tamano, nombre_en_router: typeof cuerpo.nombre_en_router === 'string' ? cuerpo.nombre_en_router : null, version: 1, created_at: ahora(), updated_at: ahora() }
        bd.ipv6Pools.push(pool)
        registrarAccion(solicitud, 'ipv6.crear', { tipo: 'ipv6_pool', id: pool.id }, cuerpo)
        return { status: 201, cuerpo: pool }
    }),
}
