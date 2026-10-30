import type { Problem, Schema } from '@argosisp/contracts'
import type { RespuestaFixture, RutasFixture } from '~/utils/fetchFixtures'
import { bd } from '../bd'
import { ahora, conPermiso, cuerpoObjeto, datosInvalidos, empresasDeLista, idDe, noEncontrado, paginar, problemaTipado, registrarAccion, versionCambiada } from '../comun'
import { rateLimitServicio, velocidadDePlan } from '../planes/velocidad'
import { ENTREGA_SIN_CALCULAR, OCUPACION_SIN_CALCULAR, SIN_CONTACTO, SIN_UNION } from './datos'
import { extremoApi, routerDuplicado, rutasDuplicados } from './duplicados'
import { vistaBloque, vistaPool, vistaRed } from './pools'
import { vistaPreviaControl } from './vistaPrevia'
import { estrategiaDeControl } from './estrategiasDatos'

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
/** `MENSAJE_NAS_IP_REQUERIDA` de A1 (`apps/api/app/network/validators.ts`). */
const MENSAJE_NAS_IP_REQUERIDA = 'La IP del NAS es obligatoria en un router con RADIUS: es la IP con la que el router habla con RADIUS y a la '
    + 'que se envían los CoA. Si el router no usa RADIUS (solo IP estática o DHCP fija), elige el modo «api»'
const MAXIMO_SERVICIOS_LISTADOS = 50

/**
 * Como `exigirSinPppoe` (A1): 422 `servicios_pppoe_en_router` al pasar a `api` un router con
 * servicios `pppoe` no retirados; un `errors[]` por servicio (hasta 50) y el total en `detail`.
 */
function serviciosPppoe(routerId: number): RespuestaFixture | null {
    const servicios = bd.servicios
        .filter(s => s.router_id === routerId && (s.tipo_conexion ?? 'pppoe') === 'pppoe' && s.estado !== 'retirado')
        .sort((a, b) => a.id - b.id)
    if (!servicios.length) {
        return null
    }
    const total = servicios.length
    return problemaTipado(
        422,
        'servicios_pppoe_en_router',
        'Regla de negocio',
        `El router tiene ${total} ${total === 1 ? 'servicio PPPoE' : 'servicios PPPoE'} sin retirar, y PPPoE necesita RADIUS. `
        + 'Pásalos a IP estática o DHCP fija, muévelos a un router con RADIUS o retíralos antes de cambiar el router a «api»',
        servicios.slice(0, MAXIMO_SERVICIOS_LISTADOS).map(s => ({
            field: `servicios.${s.id}`,
            rule: 'pppoe_requiere_radius',
            message: `Servicio ${s.id} (PPPoE${s.user_ppp ? ` ${s.user_ppp}` : ''}, ${s.estado})`,
        })),
    )
}

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

/**
 * En los fixtures no se parsea X.509: un PEM con esta marca hace de certificado que no es una CA
 * (el de `argosisp-api` pegado en lugar del de `argos-ca`). Mensaje igual a `MENSAJE_PROPOSITO` de A1.
 */
export const MARCA_PEM_NO_CA = 'NOESCA'
export const PEM_NO_CA = `-----BEGIN CERTIFICATE-----\nMIIB${MARCA_PEM_NO_CA}servicio\n-----END CERTIFICATE-----`
const MENSAJE_PROPOSITO_CA = 'El certificado que Argos usa para verificar no es una CA, o el del router no tiene el uso tls-server. '
    + 'Revisa: (1) en la CA del router (api_ca) va el certificado de la CA (argos-ca), no el del servicio '
    + '(argosisp-api); (2) el certificado de www-ssl debe tener key-usage=...,tls-server y estar firmado con '
    + 'ca=argos-ca (/certificate add ... key-usage=digital-signature,key-encipherment,tls-server, luego '
    + '/certificate sign argosisp-api ca=argos-ca)'

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
    // La API lee `basicConstraints`: el certificado del servicio (no CA) es 422 en `api_ca` (A1).
    if (typeof cuerpo.api_ca === 'string' && cuerpo.api_ca.includes(MARCA_PEM_NO_CA) && !errores.some(e => e.field === 'api_ca')) {
        errores.push({ field: 'api_ca', rule: 'ca', message: MENSAJE_PROPOSITO_CA })
    }
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
    // Antes de `/routers/:id`: la primera ruta que coincide responde.
    ...rutasDuplicados,

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
        if (cuerpo.quitar_api_password === true && typeof cuerpo.api_password === 'string' && cuerpo.api_password !== '') {
            errores.push({ field: 'api_password', message: 'Quita la clave o escribe una nueva, no las dos cosas', rule: 'quitar' })
        }
        if (cuerpo.quitar_radius_secret === true && typeof cuerpo.radius_secret === 'string' && cuerpo.radius_secret !== '') {
            errores.push({ field: 'radius_secret', message: 'Quita el secreto o escribe uno nuevo, no las dos cosas', rule: 'quitar' })
        }
        if (typeof cuerpo.zona_id === 'number' && !bd.zonas.some(z => z.id === cuerpo.zona_id)) {
            errores.push({ field: 'zona_id', message: `La zona ${cuerpo.zona_id} no existe`, rule: 'exists' })
        }
        if (cuerpo.activo !== undefined && typeof cuerpo.activo !== 'boolean') {
            errores.push({ field: 'activo', message: 'Debe ser verdadero o falso', rule: 'boolean' })
        }
        // Como `EditarRouter` (A1): `nas_ip: null` la quita; un router que queda en `radius` la exige.
        const modo = cuerpo.modo_seguridad === 'radius' || cuerpo.modo_seguridad === 'api' ? cuerpo.modo_seguridad : router.modo_seguridad
        const nasDespues = 'nas_ip' in cuerpo ? (typeof cuerpo.nas_ip === 'string' ? cuerpo.nas_ip.trim() : null) : router.nas_ip
        if (typeof nasDespues === 'string' && !IPV4.test(nasDespues)) {
            errores.push({ field: 'nas_ip', message: 'La IP del NAS debe ser una IPv4, por ejemplo 10.0.0.1', rule: 'ipAddress' })
        }
        else if (modo === 'radius' && !nasDespues) {
            errores.push({ field: 'nas_ip', message: MENSAJE_NAS_IP_REQUERIDA, rule: 'required' })
        }
        if (errores.length) {
            return datosInvalidos(errores)
        }
        if (modo === 'api' && router.modo_seguridad !== 'api') {
            const conPppoe = serviciosPppoe(router.id)
            if (conPppoe) {
                return conPppoe
            }
        }
        // Como `exigirSinDuplicado` (A1): solo lo que cambia (API, nas_ip) o reactivar, que revisa todo.
        const despues = {
            id: router.id,
            host: typeof cuerpo.host === 'string' ? cuerpo.host.trim() : router.host,
            api_url: 'api_url' in cuerpo ? (typeof cuerpo.api_url === 'string' && cuerpo.api_url.trim() ? cuerpo.api_url.trim() : null) : router.api_url ?? null,
            nas_ip: nasDespues,
            serial: router.serial ?? null,
        }
        const activo = typeof cuerpo.activo === 'boolean' ? cuerpo.activo : router.activo
        const reactiva = activo && !router.activo
        if (reactiva && router.unido_a_id) {
            return problemaTipado(422, 'router_unido', 'Regla de negocio', `El router está unido al router ${router.unido_a_id}: es el mismo equipo y no se reactiva`)
        }
        const duplicado = routerDuplicado(despues, { api: activo && (reactiva || extremoApi(despues) !== extremoApi(router)), nas_ip: despues.nas_ip !== router.nas_ip, serial: reactiva })
        if (duplicado) {
            return duplicado
        }
        const capacidad = (campo: 'capacidad_bajada_kbps' | 'capacidad_subida_kbps') => (campo in cuerpo ? (cuerpo[campo] as number | null) : router[campo] ?? null)
        const conexion = <K extends 'api_url' | 'api_tls_verificar' | 'dhcp_servidor' | 'interfaz_clientes'>(campo: K): Schema<'Router'>[K] => {
            const valor = campo in cuerpo ? cuerpo[campo] : router[campo]
            return (typeof valor === 'string' ? valor.trim() : valor) as Schema<'Router'>[K]
        }
        // Datos generales, como `editarRouterValidator`: sin el campo se conserva. Los secretos nunca
        // vuelven: solo `tiene_api_password` / `tiene_radius_secret`.
        const texto = (campo: 'nombre' | 'host'): string => (typeof cuerpo[campo] === 'string' ? (cuerpo[campo] as string).trim() : router[campo])
        Object.assign(router, {
            nombre: texto('nombre'),
            host: texto('host'),
            nas_ip: nasDespues,
            modo_seguridad: modo,
            api_usuario: 'api_usuario' in cuerpo ? (cuerpo.api_usuario as string | null) : router.api_usuario,
            // Vacío o null no cambia; `quitar_*` la borra a propósito.
            tiene_api_password: cuerpo.quitar_api_password === true ? false : (typeof cuerpo.api_password === 'string' && cuerpo.api_password !== '') || router.tiene_api_password,
            tiene_radius_secret: cuerpo.quitar_radius_secret === true ? false : (typeof cuerpo.radius_secret === 'string' && cuerpo.radius_secret !== '') || router.tiene_radius_secret,
            zona_id: 'zona_id' in cuerpo ? (cuerpo.zona_id as number | null) : (router.zona_id ?? null),
            // Desactivar / activar (`contratos/eliminar.md`: lo que tiene historial se desactiva).
            activo: typeof cuerpo.activo === 'boolean' ? cuerpo.activo : router.activo,
            capacidad_bajada_kbps: capacidad('capacidad_bajada_kbps'),
            capacidad_subida_kbps: capacidad('capacidad_subida_kbps'),
            api_url: conexion('api_url'),
            api_tls_verificar: conexion('api_tls_verificar'),
            // Como la API (fila 57 de a4.md): el PEM nunca sale; solo si hay CA cargada.
            tiene_api_ca: 'api_ca' in cuerpo ? typeof cuerpo.api_ca === 'string' : router.tiene_api_ca,
            dhcp_servidor: conexion('dhcp_servidor'),
            interfaz_clientes: conexion('interfaz_clientes'),
            // Multiempresa (A1): `empresa_sugerida_id` (null la quita); sin el campo, se conserva.
            empresa_sugerida_id: 'empresa_sugerida_id' in cuerpo ? (cuerpo.empresa_sugerida_id as number | null) : router.empresa_sugerida_id,
            version: router.version + 1,
            updated_at: ahora(),
        })
        // Como la API: la CA se audita como `***`.
        const auditado = { ...cuerpo, ...(typeof cuerpo.api_ca === 'string' ? { api_ca: '***' } : {}), ...('api_password' in cuerpo ? { api_password: '***' } : {}), ...('radius_secret' in cuerpo ? { radius_secret: '***' } : {}) }
        registrarAccion(solicitud, 'routers.editar', { tipo: 'router', id: router.id }, auditado)
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
            // El atajo escribe también la estrategia equivalente (§6).
            estrategia_velocidad: estrategiaDeControl(cuerpo.control_velocidad),
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
            ? { status: 200, cuerpo: bd.redesIpv4.filter(red => red.router_id === id).map(vistaRed) }
            : noEncontrado('el router')
    }),

    'GET /api/v1/routers/:id/ipv6-bloques': conPermiso('ipv6.ver', (solicitud) => {
        const id = idDe(solicitud)
        return existeRouter(id)
            ? { status: 200, cuerpo: bd.ipv6Bloques.filter(bloque => bloque.router_id === id).map(vistaBloque) }
            : noEncontrado('el router')
    }),

    /**
     * Como `CrearRouter` (A1): nombre y host obligatorios; la IP del NAS solo con `radius` (con `api`
     * es opcional y queda null); NAS único; secretos sin devolverse. Como la API, un plan global está
     * disponible en todos los routers: el router nuevo los ofrece desde el alta.
     */
    'POST /api/v1/routers': conPermiso('routers.crear', (solicitud) => {
        const cuerpo = cuerpoObjeto(solicitud)
        const nombre = typeof cuerpo.nombre === 'string' ? cuerpo.nombre.trim() : ''
        const host = typeof cuerpo.host === 'string' ? cuerpo.host.trim() : ''
        const modo = cuerpo.modo_seguridad === 'api' ? 'api' : 'radius'
        const nas = typeof cuerpo.nas_ip === 'string' && cuerpo.nas_ip.trim() ? cuerpo.nas_ip.trim() : null
        const errores = [
            ...(nombre.length < 2 ? [{ field: 'nombre', message: 'El nombre debe tener al menos 2 caracteres', rule: 'minLength' }] : []),
            ...(!host ? [{ field: 'host', message: 'El host es obligatorio', rule: 'required' }] : []),
            ...(nas !== null && !IPV4.test(nas) ? [{ field: 'nas_ip', message: 'La IP del NAS debe ser una IPv4, por ejemplo 10.0.0.1', rule: 'ipAddress' }] : []),
            ...(nas === null && modo === 'radius' ? [{ field: 'nas_ip', message: MENSAJE_NAS_IP_REQUERIDA, rule: 'required' }] : []),
        ]
        if (errores.length) {
            return datosInvalidos(errores)
        }
        // 409 `router_duplicado` (A1): la misma API que un router activo o la misma nas_ip que cualquiera.
        const apiUrl = typeof cuerpo.api_url === 'string' && cuerpo.api_url.trim() ? cuerpo.api_url.trim() : null
        const duplicado = routerDuplicado({ host, api_url: apiUrl, nas_ip: nas, serial: null }, { api: cuerpo.activo !== false, nas_ip: true, serial: false })
        if (duplicado) {
            return duplicado
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
            modo_seguridad: modo,
            control_velocidad: control,
            // Como `CrearRouter` (A2): la estrategia del atajo; sin versión hasta que la API responda.
            estrategia_velocidad: estrategiaDeControl(control),
            routeros_version: null,
            capacidad_bajada_kbps: null,
            capacidad_subida_kbps: null,
            modo_velocidad: control === 'arbol_pcq' ? 'pcq' : 'simple',
            activo: cuerpo.activo !== false,
            api_url: apiUrl,
            api_tls_verificar: cuerpo.api_tls_verificar !== false,
            // Como la API: el PEM nunca sale; `***` solo si se cargó una CA.
            tiene_api_ca: typeof cuerpo.api_ca === 'string' && cuerpo.api_ca.length > 0,
            dhcp_servidor: null,
            interfaz_clientes: null,
            empresa_sugerida_id: null,
            zona_id: typeof cuerpo.zona_id === 'number' ? cuerpo.zona_id : null,
            ...SIN_CONTACTO,
            // Sin serial hasta que el sondeo lo lea; sin unión.
            serial: null,
            ...SIN_UNION,
            version: 1,
            created_at: creado,
            updated_at: creado,
        }
        bd.routers.push(router)
        bd.planesPorRouter[router.id] = bd.planes.filter(p => p.global && p.activo).map(p => p.id)
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
        const opcional = (campo: string): string | null => (typeof cuerpo[campo] === 'string' && (cuerpo[campo] as string).trim() !== '' ? (cuerpo[campo] as string).trim() : null)
        const red: Schema<'RedIpv4'> = {
            id: Math.max(0, ...bd.redesIpv4.map(r => r.id)) + 1,
            router_id: id,
            nombre: opcional('nombre'),
            cidr,
            gateway: opcional('gateway'),
            tipo: cuerpo.tipo === 'estatico' ? 'estatico' : 'pool',
            rango_inicio: opcional('rango_inicio'),
            rango_fin: opcional('rango_fin'),
            dns_primario: opcional('dns_primario'),
            dns_secundario: opcional('dns_secundario'),
            ocupacion: OCUPACION_SIN_CALCULAR,
            version: 1,
            created_at: ahora(),
            updated_at: ahora(),
        }
        bd.redesIpv4.push(red)
        registrarAccion(solicitud, 'redes.crear', { tipo: 'red_ipv4', id: red.id }, cuerpo)
        return { status: 201, cuerpo: vistaRed(red) }
    }),

    'POST /api/v1/routers/:id/ipv6-bloques': conPermiso('ipv6.crear', (solicitud) => {
        const id = idDe(solicitud)
        if (!existeRouter(id) || id === null) {
            return noEncontrado('el router')
        }
        const cuerpo = cuerpoObjeto(solicitud)
        const prefijo = String(cuerpo.prefijo ?? '').trim()
        if (!CIDR_V6.test(prefijo)) {
            return datosInvalidos([{ field: 'prefijo', message: 'El prefijo debe estar en notación CIDR', rule: 'regex' }])
        }
        if (bd.ipv6Bloques.some(b => b.prefijo === prefijo)) {
            return datosInvalidos([{ field: 'prefijo', message: `El bloque ${prefijo} se solapa con otro`, rule: 'solapamiento' }])
        }
        const texto = (campo: string): string | null => (typeof cuerpo[campo] === 'string' && (cuerpo[campo] as string).trim() !== '' ? (cuerpo[campo] as string).trim() : null)
        const bloque: Schema<'Ipv6Bloque'> = { id: Math.max(0, ...bd.ipv6Bloques.map(b => b.id)) + 1, router_id: id, nombre: texto('nombre'), proveedor: texto('proveedor'), prefijo, espacio: { pools: 0, porcentaje_en_pools: 0 }, version: 1, created_at: ahora(), updated_at: ahora() }
        bd.ipv6Bloques.push(bloque)
        registrarAccion(solicitud, 'ipv6.crear', { tipo: 'ipv6_bloque', id: bloque.id }, cuerpo)
        return { status: 201, cuerpo: vistaBloque(bloque) }
    }),

    'GET /api/v1/ipv6-bloques/:id/pools': conPermiso('ipv6.ver', (solicitud) => {
        const id = idDe(solicitud)
        return bd.ipv6Bloques.some(b => b.id === id)
            ? { status: 200, cuerpo: bd.ipv6Pools.filter(p => p.bloque_id === id).map(vistaPool) }
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
        const pool: Schema<'Ipv6Pool'> = {
            id: Math.max(0, ...bd.ipv6Pools.map(p => p.id)) + 1,
            bloque_id: bloque.id,
            router_id: bloque.router_id,
            nombre: typeof cuerpo.nombre === 'string' && cuerpo.nombre.trim() ? cuerpo.nombre.trim() : null,
            prefijo,
            tipo,
            tamano_entrega: tamano,
            nombre_en_router: typeof cuerpo.nombre_en_router === 'string' && cuerpo.nombre_en_router ? cuerpo.nombre_en_router : null,
            ocupacion: OCUPACION_SIN_CALCULAR,
            entrega: ENTREGA_SIN_CALCULAR,
            version: 1,
            created_at: ahora(),
            updated_at: ahora(),
        }
        bd.ipv6Pools.push(pool)
        registrarAccion(solicitud, 'ipv6.crear', { tipo: 'ipv6_pool', id: pool.id }, cuerpo)
        return { status: 201, cuerpo: vistaPool(pool) }
    }),
}
