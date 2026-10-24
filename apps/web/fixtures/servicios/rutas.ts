import type { Problem, Schema } from '@argosisp/contracts'
import Decimal from 'decimal.js'
import type { ManejadorFixture, RutasFixture, SolicitudFixture } from '~/utils/fetchFixtures'
import { ipEnCidr, ipv4ANumero } from '~/utils/red'
import { bd, siguienteId } from '../bd'
import {
    ahora,
    conIdempotencia,
    conPermiso,
    cuerpoObjeto,
    datosInvalidos,
    empresaActivaDe,
    empresasDeLista,
    idDe,
    noEncontrado,
    normalizar,
    numeroQuery,
    paginar,
    problemaTipado,
    registrarAccion,
    usuariosPorToken,
    versionCambiada,
} from '../comun'
import { nuevaSesion } from '../sesiones/datos'
import { asignarIncluidos, aplicarBloqueoPorEstado, bajaPorRetiro, bloqueoCambioEmpresa, reconciliarIncluidos } from '../adicionales/rutas'
import { advertenciasServicio, TIPOS_PLAN } from '../planes/tipos'
import { planTemporalDe } from './planesTemporales'

type Servicio = Schema<'Servicio'>
type Errores = NonNullable<Problem['errors']>

function numeroAIp(numero: number): string {
    return [24, 16, 8, 0].map(desplazamiento => Math.floor(numero / 2 ** desplazamiento) % 256).join('.')
}

/**
 * Siguiente IP libre de las redes estáticas del router (salta red, gateway y broadcast); con
 * `redId` (`red_ipv4_id`), solo de esa red.
 */
function ipLibre(routerId: number, redId?: number): string | null {
    const usadas = new Set(bd.servicios.map(s => s.ipv4).filter(Boolean))
    for (const red of bd.redesIpv4.filter(r => r.router_id === routerId && (redId === undefined ? r.tipo === 'estatico' : r.id === redId))) {
        const [base = '', prefijo = '32'] = red.cidr.split('/')
        const inicio = ipv4ANumero(base) ?? 0
        const tamano = 2 ** (32 - Number(prefijo))
        for (let numero = inicio + 2; numero < inicio + tamano - 1; numero++) {
            const ip = numeroAIp(numero)
            if (!usadas.has(ip) && ip !== red.gateway) {
                return ip
            }
        }
    }
    return null
}

/** Nombres que la vista `Servicio` de la API trae con subconsultas (día 3). */
export function nombresDe(clienteId: number, planId: number, routerId: number): Pick<Servicio, 'cliente_nombre' | 'plan_nombre' | 'plan_tipo' | 'router_nombre' | 'zona_nombre'> {
    const cliente = bd.clientes.find(c => c.id === clienteId)
    const plan = bd.planes.find(p => p.id === planId)
    return {
        cliente_nombre: cliente?.nombre ?? '',
        plan_nombre: plan?.nombre ?? '',
        // Tipo del plan (A1, solo lectura): sigue al plan si se cambia ahí.
        plan_tipo: plan?.tipo ?? 'residencial',
        router_nombre: bd.routers.find(r => r.id === routerId)?.nombre ?? '',
        zona_nombre: bd.zonas.find(z => z.id === cliente?.zona_id)?.nombre ?? null,
    }
}

/** El servicio como lo devuelve la API: con los nombres al día (un cliente renombrado, por ejemplo). */
function vista(servicio: Servicio): Servicio {
    return { ...servicio, ...nombresDe(servicio.cliente_id, servicio.plan_id, servicio.router_id), plan_temporal: planTemporalDe(servicio.id) }
}

function texto(valor: unknown): string | null {
    return typeof valor === 'string' && valor.trim() ? valor.trim() : null
}

const TIPOS = ['pppoe', 'ip_estatica', 'dhcp_fija'] as const
const PATRON_MAC_FIXTURE = /^([0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}$/

function tipoDe(valor: unknown): Servicio['tipo_conexion'] | null {
    return typeof valor === 'string' && (TIPOS as readonly string[]).includes(valor) ? (valor as Servicio['tipo_conexion']) : null
}

/**
 * Como `validarTipoConexion` (A1): sin PPPoE no hay credenciales ni IPv6 por RADIUS ni plan solo
 * IPv6; `dhcp_fija` y el amarre exigen MAC; el amarre es solo sin PPPoE.
 */
function validarTipo(tipo: Servicio['tipo_conexion'], datos: { modo: string, mac: string | null, amarre: boolean, planV6: boolean, conUsuario: boolean, conClave: boolean }): Errores {
    const errores: Errores = []
    if (tipo !== 'pppoe') {
        if (datos.conUsuario) {
            errores.push({ field: 'user_ppp', message: 'Solo los servicios pppoe tienen user_ppp', rule: 'tipo_conexion' })
        }
        if (datos.conClave) {
            errores.push({ field: 'pass_ppp', message: 'Solo los servicios pppoe tienen pass_ppp', rule: 'tipo_conexion' })
        }
        if (datos.modo === 'radius_servicio' || datos.modo === 'radius_pool') {
            errores.push({ field: 'ipv6_modo', message: 'Sin PPPoE no hay RADIUS: el modo IPv6 debe ser duid, estatico o ninguno', rule: 'tipo_conexion' })
        }
        if (datos.planV6) {
            errores.push({ field: 'tipo_conexion', message: 'Un servicio sin PPPoE necesita IPv4 y el plan es solo IPv6', rule: 'plan' })
        }
    }
    if (datos.mac !== null && !PATRON_MAC_FIXTURE.test(datos.mac)) {
        errores.push({ field: 'mac', message: 'MAC inválida', rule: 'regex' })
    }
    if (tipo === 'dhcp_fija' && !datos.mac) {
        errores.push({ field: 'mac', message: 'dhcp_fija requiere la MAC del equipo', rule: 'required' })
    }
    if (datos.amarre) {
        if (tipo === 'pppoe') {
            errores.push({ field: 'amarre_ip_mac', message: 'El amarre IP-MAC es solo para servicios sin PPPoE', rule: 'tipo_conexion' })
        }
        else if (!datos.mac) {
            errores.push({ field: 'mac', message: 'El amarre IP-MAC requiere la MAC del equipo', rule: 'required' })
        }
    }
    return errores
}

function validarAlta(cuerpo: Record<string, unknown>): Errores {
    const errores: Errores = []
    const tipo = cuerpo.tipo_conexion === undefined ? 'pppoe' : tipoDe(cuerpo.tipo_conexion)
    if (!tipo) {
        errores.push({ field: 'tipo_conexion', message: 'Debe ser pppoe, ip_estatica o dhcp_fija', rule: 'enum' })
    }
    else {
        errores.push(...validarTipo(tipo, {
            modo: typeof cuerpo.ipv6_modo === 'string' ? cuerpo.ipv6_modo : 'radius_servicio',
            mac: texto(cuerpo.mac),
            amarre: cuerpo.amarre_ip_mac === true,
            planV6: bd.planes.find(p => p.id === cuerpo.plan_id)?.dual_stack === 'v6',
            conUsuario: cuerpo.user_ppp !== undefined,
            conClave: cuerpo.pass_ppp !== undefined,
        }))
    }
    const { cliente_id: clienteId, router_id: routerId, plan_id: planId, user_ppp: usuario, ipv4 } = cuerpo
    if (!bd.clientes.some(c => c.id === clienteId)) {
        errores.push({ field: 'cliente_id', message: 'El cliente no existe', rule: 'exists' })
    }
    if (!bd.routers.some(r => r.id === routerId && r.activo)) {
        errores.push({ field: 'router_id', message: 'El router no existe o está inactivo', rule: 'exists' })
    }
    if (!(bd.planesPorRouter[Number(routerId)] ?? []).includes(Number(planId))) {
        errores.push({ field: 'plan_id', message: 'El plan no está implementado en ese router', rule: 'plan_router' })
    }
    if (typeof usuario === 'string' && bd.servicios.some(s => s.user_ppp === usuario)) {
        errores.push({ field: 'user_ppp', message: 'Ese usuario PPP ya existe', rule: 'unique' })
    }
    const redId = cuerpo.red_ipv4_id
    if (redId !== undefined && !bd.redesIpv4.some(r => r.id === redId && r.router_id === routerId)) {
        errores.push({ field: 'red_ipv4_id', message: 'La red no existe o no es del router', rule: 'red_router' })
    }
    // Sin `plantilla_facturacion_id` (técnico sin plantillas.ver): la única plantilla, o 422 si hay varias.
    if (!('plantilla_facturacion_id' in cuerpo) && bd.plantillas.length > 1) {
        errores.push({ field: 'plantilla_facturacion_id', message: 'Hay varias plantillas de facturación: elige una', rule: 'required' })
    }
    if (typeof ipv4 === 'string') {
        if (bd.servicios.some(s => s.ipv4 === ipv4)) {
            errores.push({ field: 'ipv4', message: 'Esa IP ya está asignada a otro servicio', rule: 'unique' })
        }
        else if (!bd.redesIpv4.some(r => r.router_id === routerId && ipEnCidr(ipv4, r.cidr))) {
            errores.push({ field: 'ipv4', message: 'La IP no pertenece a ninguna red del router', rule: 'red' })
        }
    }
    return errores
}

/** Empresa de un servicio nuevo, como `CrearServicio` (A1): explícita > zona > router > activa > 1. */
function empresaDelAlta(solicitud: SolicitudFixture, cuerpo: Record<string, unknown>, routerId: number): number {
    if (typeof cuerpo.empresa_id === 'number') {
        return cuerpo.empresa_id
    }
    const cliente = bd.clientes.find(c => c.id === Number(cuerpo.cliente_id))
    const zona = bd.zonas.find(z => z.id === cliente?.zona_id)?.empresa_sugerida_id
    const router = bd.routers.find(r => r.id === routerId)?.empresa_sugerida_id
    return zona ?? router ?? empresaActivaDe(solicitud) ?? 1
}
function crearServicio(solicitud: SolicitudFixture): Servicio | Errores {
    const cuerpo = cuerpoObjeto(solicitud)
    const errores = validarAlta(cuerpo)
    if (errores.length) {
        return errores
    }
    const routerId = Number(cuerpo.router_id)
    const ipv4 = texto(cuerpo.ipv4) ?? ipLibre(routerId, typeof cuerpo.red_ipv4_id === 'number' ? cuerpo.red_ipv4_id : undefined)
    if (!ipv4) {
        return [{ field: 'ipv4', message: 'No quedan IPs libres en las redes del router', rule: 'agotado' }]
    }
    const id = siguienteId(bd.servicios)
    const cliente = bd.clientes.find(c => c.id === cuerpo.cliente_id)
    const plan = bd.planes.find(p => p.id === cuerpo.plan_id)
    const tipo = tipoDe(cuerpo.tipo_conexion) ?? 'pppoe'
    const modo = (cuerpo.ipv6_modo as Servicio['ipv6_modo'] | undefined) ?? (tipo === 'pppoe' ? 'radius_servicio' : 'ninguno')
    const conV6 = modo === 'radius_servicio' && plan?.dual_stack !== 'v4' && bd.ipv6Bloques.some(b => b.router_id === routerId)
    const momento = ahora()
    return {
        id,
        cliente_id: Number(cuerpo.cliente_id),
        // Multiempresa (A1): explícita > la sugerida de la zona del cliente > la del router > la activa > la 1.
        empresa_id: empresaDelAlta(solicitud, cuerpo, routerId),
        router_id: routerId,
        plan_id: Number(cuerpo.plan_id),
        plantilla_facturacion_id: 'plantilla_facturacion_id' in cuerpo
            ? (typeof cuerpo.plantilla_facturacion_id === 'number' ? cuerpo.plantilla_facturacion_id : null)
            : (bd.plantillas[0]?.id ?? null),
        estado: 'activo',
        promesa_activa: false,
        tipo_conexion: tipo,
        amarre_ip_mac: tipo !== 'pppoe' && cuerpo.amarre_ip_mac === true,
        user_ppp: tipo === 'pppoe' ? (texto(cuerpo.user_ppp) ?? `cliente${cliente?.id ?? id}.${id}`) : null,
        mac: texto(cuerpo.mac),
        direccion: texto(cuerpo.direccion),
        coordenadas: texto(cuerpo.coordenadas),
        fecha_instalacion: texto(cuerpo.fecha_instalacion),
        costo_override: texto(cuerpo.costo_override),
        excluir_firewall: cuerpo.excluir_firewall === true,
        ipv4,
        prefijo_enlace_v6: conV6 ? `2803:d100:1000:${(id * 16).toString(16)}::/64` : null,
        prefijo_delegado_v6: modo === 'estatico'
            ? texto(cuerpo.prefijo_delegado_v6)
            : conV6 ? `2803:d100:10${(40 + id).toString(16)}:${(id * 256).toString(16)}::/${plan?.tamano_prefijo_delegado ?? 56}` : null,
        ipv6_modo: plan?.dual_stack === 'v4' ? 'ninguno' : modo,
        ipv6_duid: texto(cuerpo.ipv6_duid),
        suspension_manual: false,
        suspension_manual_motivo: null,
        ...nombresDe(Number(cuerpo.cliente_id), Number(cuerpo.plan_id), routerId),
        excepciones: typeof cuerpo.excepciones === 'object' && cuerpo.excepciones !== null ? (cuerpo.excepciones as Schema<'ExcepcionesServicio'>) : {},
        plan_temporal: null,
        externo: null,
        version: 1,
        created_at: momento,
        updated_at: momento,
    }
}

/** Contraseña PPPoE determinista para los servicios de los fixtures (la API la genera al dar de alta). */
export function claveGenerada(id: number): string {
    const alfabeto = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'
    let semilla = id * 7919 + 104729
    let clave = ''
    for (let i = 0; i < 12; i++) {
        semilla = (semilla * 48271) % 2147483647
        clave += alfabeto[semilla % alfabeto.length]
    }
    return clave
}

type EstadoServicio = Servicio['estado']

interface ReglaAccion {
    permiso: string
    /** Estados desde los que se permite; fuera de ellos, 422 como `ReglaNegocio`. */
    desde: EstadoServicio[]
    /** Estado al que pasa; `null` = no cambia (desconectar). */
    a: EstadoServicio | null
    /** Motivo del 422 cuando el estado no lo permite. */
    rechazo: (estado: EstadoServicio) => string
}

/**
 * Acciones explícitas del servicio con las mismas reglas que la máquina de estados de A1
 * (`cambiar_estado_servicio.ts`, `retirar_servicio.ts`): desde `retirado` no hay vuelta, y
 * retirar libera IPv4 y prefijos IPv6. Las que hoy responden 501 en la API se pueden simular
 * con `simularFalla('POST /api/v1/servicios/:id/suspender', 501)`.
 */
const REGLAS: Record<string, ReglaAccion> = {
    'suspender': {
        permiso: 'servicios.suspender',
        desde: ['activo', 'limitado'],
        a: 'suspendido',
        rechazo: estado => `El servicio está ${estado}; solo se suspende un servicio activo o limitado`,
    },
    'reactivar': {
        permiso: 'servicios.reactivar',
        desde: ['suspendido'],
        a: 'activo',
        rechazo: estado => `El servicio está ${estado}; solo se reactiva un servicio suspendido`,
    },
    'limitar': {
        permiso: 'servicios.limitar',
        desde: ['activo'],
        a: 'limitado',
        rechazo: estado => `El servicio está ${estado}; solo se limita un servicio activo`,
    },
    'quitar-limite': {
        permiso: 'servicios.quitar_limite',
        desde: ['limitado'],
        a: 'activo',
        rechazo: estado => `El servicio está ${estado}; no tiene límite que quitar`,
    },
    'retirar': {
        permiso: 'servicios.retirar',
        desde: ['activo', 'limitado', 'suspendido'],
        a: 'retirado',
        rechazo: () => 'El servicio ya está retirado',
    },
    'desconectar': {
        permiso: 'servicios.desconectar',
        desde: ['activo', 'limitado', 'suspendido'],
        a: null,
        rechazo: () => 'El servicio está retirado y no tiene sesión',
    },
}

function terminarSesiones(servicioId: number, causa: string): void {
    const momento = ahora()
    for (const sesion of bd.sesiones) {
        if (sesion.servicio_id === servicioId && sesion.fin === null) {
            sesion.fin = momento
            sesion.causa_fin = causa
        }
    }
}

const rutasAcciones: RutasFixture = Object.fromEntries(Object.entries(REGLAS).map(([ruta, regla]) => [
    `POST /api/v1/servicios/:id/${ruta}`,
    conPermiso(regla.permiso, conIdempotencia((solicitud) => {
        const indice = bd.servicios.findIndex(s => s.id === idDe(solicitud))
        const actual = bd.servicios[indice]
        if (!actual) {
            return noEncontrado('el servicio')
        }
        const motivo = texto(cuerpoObjeto(solicitud).motivo)
        if (!motivo || motivo.length < 3) {
            return datosInvalidos([{ field: 'motivo', message: 'El motivo debe tener al menos 3 caracteres', rule: 'minLength' }])
        }
        if (actual.suspension_manual && (ruta === 'limitar' || ruta === 'quitar-limite')) {
            const rechazo: Problem = {
                type: 'urn:argosisp:problema:suspension_manual',
                title: 'Regla de negocio',
                status: 422,
                detail: 'El servicio está suspendido manualmente: reactívalo antes de cambiar su estado',
            }
            return { status: 422, cuerpo: rechazo }
        }
        if (!regla.desde.includes(actual.estado)) {
            const rechazo: Problem = { type: 'urn:argosisp:problema:regla_negocio', title: 'Regla de negocio', status: 422, detail: regla.rechazo(actual.estado) }
            return { status: 422, cuerpo: rechazo }
        }
        const despues: Servicio = regla.a === null
            ? actual
            : {
                    ...actual,
                    estado: regla.a,
                    version: actual.version + 1,
                    updated_at: ahora(),
                    ...(regla.a === 'retirado' ? { ipv4: null, prefijo_enlace_v6: null, prefijo_delegado_v6: null } : {}),
                    // `suspender` pone la marca de suspensión manual; solo `reactivar` la quita.
                    ...(ruta === 'suspender' ? { suspension_manual: true, suspension_manual_motivo: motivo } : {}),
                    ...(ruta === 'reactivar' ? { suspension_manual: false, suspension_manual_motivo: null } : {}),
                }
        bd.servicios[indice] = despues
        // Suspender bloquea sus adicionales y reactivar los desbloquea, en el mismo cambio (A1).
        aplicarBloqueoPorEstado(actual.id, actual.estado, despues.estado, motivo)
        if (regla.a === 'retirado') {
            // Retirar da de baja todos sus adicionales activos con el motivo del retiro (A1).
            bajaPorRetiro(actual.id, motivo)
        }
        // Suspender y limitar van por CoA (la sesión sigue); reactivar va por Disconnect-Request
        // (decisión del PM en lideres.md), igual que desconectar y retirar.
        if (regla.a === null || regla.a === 'retirado' || ruta === 'reactivar') {
            terminarSesiones(actual.id, 'Admin-Reset')
        }
        if (ruta === 'reactivar') {
            // El CPE vuelve a marcar enseguida y RADIUS ya lo autoriza como activo.
            bd.sesiones.push(nuevaSesion(siguienteId(bd.sesiones), despues, ahora()))
        }
        registrarAccion(solicitud, regla.permiso, { tipo: 'servicio', id: actual.id }, { id: actual.id, motivo })
        return { status: 200, cuerpo: vista(despues) }
    })),
]))

/**
 * Como `CambiarEmpresaServicio` (A1): `{ empresa_id, version, motivo }`. 422 `servicio_con_saldo`
 * si le quedan facturas por cobrar, 422 `servicio_retirado`, 403 `empresa_no_permitida` sin acceso a
 * las dos empresas, 409 por versión. Misma empresa: 200 sin cambios.
 */
const cambiarEmpresa: ManejadorFixture = (solicitud) => {
    const indice = bd.servicios.findIndex(s => s.id === idDe(solicitud))
    const actual = bd.servicios[indice]
    if (!actual) {
        return noEncontrado('el servicio')
    }
    const cuerpo = cuerpoObjeto(solicitud)
    if (cuerpo.version !== actual.version) {
        return versionCambiada()
    }
    const motivo = texto(cuerpo.motivo)
    const nueva = bd.empresas.find(e => e.id === cuerpo.empresa_id)
    const errores: NonNullable<Problem['errors']> = []
    if (!motivo || motivo.length < 3) {
        errores.push({ field: 'motivo', message: 'El motivo debe tener al menos 3 caracteres', rule: 'minLength' })
    }
    if (!nueva || !nueva.activa) {
        errores.push({ field: 'empresa_id', message: 'La empresa no existe o está inactiva', rule: 'exists' })
    }
    if (errores.length || !nueva) {
        return datosInvalidos(errores)
    }
    const actor = solicitud.token ? usuariosPorToken[solicitud.token] : undefined
    const sinAcceso = [actual.empresa_id, nueva.id].find(id => !actor?.alcance_global && !(actor?.empresas ?? []).some(e => e.id === id))
    if (sinAcceso !== undefined) {
        return problemaTipado(403, 'empresa_no_permitida', 'Empresa no permitida', `No tienes acceso a la empresa ${sinAcceso}`)
    }
    if (actual.estado === 'retirado') {
        return problemaTipado(422, 'servicio_retirado', 'Regla de negocio', 'El servicio está retirado')
    }
    const saldo = bd.facturas
        .filter(f => f.servicio_id === actual.id && f.estado !== 'pagada' && f.estado !== 'anulada' && f.estado !== 'por_certificar')
        .reduce((total, f) => total.plus(f.total).minus(f.pagado), new Decimal(0))
    if (saldo.gt(0)) {
        return problemaTipado(422, 'servicio_con_saldo', 'Regla de negocio', `El servicio tiene Q ${saldo.toFixed(2)} pendientes: cóbralos o anúlalos antes de cambiar de empresa`)
    }
    if (nueva.id === actual.empresa_id) {
        return { status: 200, cuerpo: vista(actual) }
    }
    // Adicionales (A1): con cortesía o cobrado vigentes no se cambia; los incluidos se rehacen.
    const conAdicionales = bloqueoCambioEmpresa(actual.id)
    if (conAdicionales) {
        return conAdicionales
    }
    const despues: Servicio = { ...actual, empresa_id: nueva.id, version: actual.version + 1, updated_at: ahora() }
    bd.servicios[indice] = despues
    reconciliarIncluidos(despues, 'cambio_empresa')
    registrarAccion(solicitud, 'servicios.cambiar_empresa', { tipo: 'servicio', id: actual.id }, cuerpo)
    return { status: 200, cuerpo: vista(despues) }
}

export const rutasServicios: RutasFixture = {
    'POST /api/v1/servicios/:id/cambiar-empresa': conPermiso('servicios.cambiar_empresa', conIdempotencia(cambiarEmpresa)),
    'GET /api/v1/servicios': conPermiso('servicios.ver', (solicitud) => {
        const q = normalizar(solicitud.query.get('q')?.trim())
        const cliente = numeroQuery(solicitud, 'cliente_id')
        const router = numeroQuery(solicitud, 'router_id')
        const plan = numeroQuery(solicitud, 'plan_id')
        const estado = solicitud.query.get('estado')
        const zona = numeroQuery(solicitud, 'zona_id')
        const deuda = solicitud.query.get('con_deuda_vencida')
        const tipo = solicitud.query.get('tipo_conexion')
        const tipoPlan = solicitud.query.get('tipo')
        if (tipoPlan && !(TIPOS_PLAN as readonly string[]).includes(tipoPlan)) {
            return datosInvalidos([{ field: 'tipo', message: 'Debe ser residencial, empresarial o dedicado', rule: 'enum' }])
        }
        const empresas = empresasDeLista(solicitud)
        const filas = bd.servicios
            .filter(s => empresas === null || empresas.includes(s.empresa_id))
            .filter(s => !tipoPlan || (bd.planes.find(p => p.id === s.plan_id)?.tipo ?? 'residencial') === tipoPlan)
            .filter(s => !tipo || (s.tipo_conexion ?? 'pppoe') === tipo)
            .filter(s => zona === undefined || bd.clientes.find(c => c.id === s.cliente_id)?.zona_id === zona)
            .filter(s => deuda === null || bd.facturas.some(f => f.servicio_id === s.id && f.estado === 'vencida') === (deuda === 'true'))
            .filter(s => cliente === undefined || s.cliente_id === cliente)
            .filter(s => router === undefined || s.router_id === router)
            .filter(s => plan === undefined || s.plan_id === plan)
            .filter(s => !estado || s.estado === estado)
            .filter((s) => {
                if (!q) {
                    return true
                }
                const nombre = bd.clientes.find(c => c.id === s.cliente_id)?.nombre
                return normalizar(s.user_ppp).includes(q) || s.ipv4 === q || normalizar(nombre).includes(q)
            })
            .sort((a, b) => b.id - a.id)
        return { status: 200, cuerpo: paginar(filas.map(vista), solicitud) }
    }),

    'GET /api/v1/servicios/:id': conPermiso('servicios.ver', (solicitud) => {
        const servicio = bd.servicios.find(s => s.id === idDe(solicitud))
        return servicio ? { status: 200, cuerpo: vista(servicio) } : noEncontrado('el servicio')
    }),

    'POST /api/v1/servicios': conPermiso('servicios.crear', conIdempotencia((solicitud) => {
        const resultado = crearServicio(solicitud)
        if (Array.isArray(resultado)) {
            return datosInvalidos(resultado)
        }
        bd.servicios.push(resultado)
        const { pass_ppp: clave, ...entrada } = cuerpoObjeto(solicitud)
        if (resultado.tipo_conexion === 'pppoe') {
            bd.clavesPpp[resultado.id] = typeof clave === 'string' && clave ? clave : claveGenerada(resultado.id)
        }
        registrarAccion(solicitud, 'servicios.crear', { tipo: 'servicio', id: resultado.id }, { ...entrada, pass_ppp: '***' })
        // Adicionales incluidos del plan (A1) y `warnings[]` del tipo de plan (nunca bloquean).
        asignarIncluidos(resultado)
        return { status: 201, cuerpo: { ...resultado, warnings: advertenciasServicio(resultado) } }
    })),

    /**
     * Como `EditarServicio` (A1): 409 por versión; `validarTipoConexion` sobre el resultado; pasar
     * a PPPoE genera credenciales y salir de PPPoE las borra.
     */
    'PUT /api/v1/servicios/:id': conPermiso('servicios.editar', (solicitud) => {
        const indice = bd.servicios.findIndex(s => s.id === idDe(solicitud))
        const actual = bd.servicios[indice]
        if (!actual) {
            return noEncontrado('el servicio')
        }
        const cuerpo = cuerpoObjeto(solicitud)
        if (cuerpo.version !== actual.version) {
            return versionCambiada()
        }
        const tipoAntes = actual.tipo_conexion ?? 'pppoe'
        const tipo = cuerpo.tipo_conexion === undefined ? tipoAntes : tipoDe(cuerpo.tipo_conexion)
        if (!tipo) {
            return datosInvalidos([{ field: 'tipo_conexion', message: 'Debe ser pppoe, ip_estatica o dhcp_fija', rule: 'enum' }])
        }
        const mac = 'mac' in cuerpo ? texto(cuerpo.mac) : actual.mac
        const modo = typeof cuerpo.ipv6_modo === 'string' ? (cuerpo.ipv6_modo as Servicio['ipv6_modo']) : actual.ipv6_modo
        const amarre = tipo !== 'pppoe' && (typeof cuerpo.amarre_ip_mac === 'boolean' ? cuerpo.amarre_ip_mac : (actual.amarre_ip_mac ?? false))
        const planId = typeof cuerpo.plan_id === 'number' ? cuerpo.plan_id : actual.plan_id
        const errores = validarTipo(tipo, {
            modo,
            mac,
            amarre: cuerpo.amarre_ip_mac === true || amarre,
            planV6: bd.planes.find(p => p.id === planId)?.dual_stack === 'v6',
            conUsuario: false,
            conClave: false,
        })
        if (!(bd.planesPorRouter[actual.router_id] ?? []).includes(planId)) {
            errores.push({ field: 'plan_id', message: 'El plan no está implementado en ese router', rule: 'plan_router' })
        }
        if (errores.length) {
            return datosInvalidos(errores)
        }
        const actualizado: Servicio = {
            ...actual,
            plan_id: planId,
            tipo_conexion: tipo,
            amarre_ip_mac: amarre,
            user_ppp: tipo === 'pppoe' ? (actual.user_ppp ?? texto(cuerpo.user_ppp) ?? `cliente${actual.cliente_id}.${actual.id}`) : null,
            mac,
            ipv6_modo: modo,
            ipv6_duid: 'ipv6_duid' in cuerpo ? texto(cuerpo.ipv6_duid) : actual.ipv6_duid,
            direccion: 'direccion' in cuerpo ? texto(cuerpo.direccion) : actual.direccion,
            coordenadas: 'coordenadas' in cuerpo ? texto(cuerpo.coordenadas) : actual.coordenadas,
            fecha_instalacion: 'fecha_instalacion' in cuerpo ? texto(cuerpo.fecha_instalacion) : actual.fecha_instalacion,
            costo_override: 'costo_override' in cuerpo ? texto(cuerpo.costo_override) : actual.costo_override,
            excluir_firewall: typeof cuerpo.excluir_firewall === 'boolean' ? cuerpo.excluir_firewall : actual.excluir_firewall,
            version: actual.version + 1,
            updated_at: ahora(),
        }
        if (tipo === 'pppoe' && tipoAntes !== 'pppoe') {
            bd.clavesPpp[actual.id] = claveGenerada(actual.id)
        }
        if (tipo !== 'pppoe') {
            bd.clavesPpp = Object.fromEntries(Object.entries(bd.clavesPpp).filter(([id]) => Number(id) !== actual.id))
        }
        bd.servicios[indice] = actualizado
        if (actualizado.plan_id !== actual.plan_id) {
            reconciliarIncluidos(actualizado)
        }
        registrarAccion(solicitud, 'servicios.editar', { tipo: 'servicio', id: actual.id }, cuerpo)
        return { status: 200, cuerpo: { ...vista(actualizado), warnings: advertenciasServicio(actualizado) } }
    }),

    'GET /api/v1/servicios/:id/credenciales': conPermiso('servicios.ver_credenciales', (solicitud) => {
        const servicio = bd.servicios.find(s => s.id === idDe(solicitud))
        if (!servicio) {
            return noEncontrado('el servicio')
        }
        if (servicio.user_ppp === null) {
            // Igual que la API: un servicio WISP sin PPPoE no tiene credenciales.
            return { status: 422, cuerpo: { type: 'urn:argosisp:problema:sin_credenciales_ppp', title: 'Regla de negocio', status: 422, detail: 'El servicio no usa PPPoE' } }
        }
        registrarAccion(solicitud, 'servicios.ver_credenciales', { tipo: 'servicio', id: servicio.id }, { id: servicio.id })
        const credenciales: Schema<'CredencialesPpp'> = {
            servicio_id: servicio.id,
            user_ppp: servicio.user_ppp,
            pass_ppp: bd.clavesPpp[servicio.id] ?? claveGenerada(servicio.id),
        }
        return { status: 200, cuerpo: credenciales }
    }),

    ...rutasAcciones,
}
