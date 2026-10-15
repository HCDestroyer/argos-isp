import type { Problem, Schema } from '@argosisp/contracts'
import type { RutasFixture, SolicitudFixture } from '~/utils/fetchFixtures'
import { ipEnCidr, ipv4ANumero } from '~/utils/red'
import { bd, siguienteId } from '../bd'
import { nuevaSesion } from '../sesiones/datos'
import {
    ahora,
    conIdempotencia,
    conPermiso,
    cuerpoObjeto,
    datosInvalidos,
    idDe,
    noEncontrado,
    normalizar,
    numeroQuery,
    paginar,
    registrarAccion,
} from '../comun'

type Servicio = Schema<'Servicio'>
type Errores = NonNullable<Problem['errors']>

function numeroAIp(numero: number): string {
    return [24, 16, 8, 0].map(desplazamiento => Math.floor(numero / 2 ** desplazamiento) % 256).join('.')
}

/** Siguiente IP libre de las redes estáticas del router (salta red, gateway y broadcast). */
function ipLibre(routerId: number): string | null {
    const usadas = new Set(bd.servicios.map(s => s.ipv4).filter(Boolean))
    for (const red of bd.redesIpv4.filter(r => r.router_id === routerId && r.tipo === 'estatico')) {
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
export function nombresDe(clienteId: number, planId: number, routerId: number): Pick<Servicio, 'cliente_nombre' | 'plan_nombre' | 'router_nombre' | 'zona_nombre'> {
    const cliente = bd.clientes.find(c => c.id === clienteId)
    return {
        cliente_nombre: cliente?.nombre ?? '',
        plan_nombre: bd.planes.find(p => p.id === planId)?.nombre ?? '',
        router_nombre: bd.routers.find(r => r.id === routerId)?.nombre ?? '',
        zona_nombre: bd.zonas.find(z => z.id === cliente?.zona_id)?.nombre ?? null,
    }
}

/** El servicio como lo devuelve la API: con los nombres al día (un cliente renombrado, por ejemplo). */
function vista(servicio: Servicio): Servicio {
    return { ...servicio, ...nombresDe(servicio.cliente_id, servicio.plan_id, servicio.router_id) }
}

function texto(valor: unknown): string | null {
    return typeof valor === 'string' && valor.trim() ? valor.trim() : null
}

function validarAlta(cuerpo: Record<string, unknown>): Errores {
    const errores: Errores = []
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

function crearServicio(solicitud: SolicitudFixture): Servicio | Errores {
    const cuerpo = cuerpoObjeto(solicitud)
    const errores = validarAlta(cuerpo)
    if (errores.length) {
        return errores
    }
    const routerId = Number(cuerpo.router_id)
    const ipv4 = texto(cuerpo.ipv4) ?? ipLibre(routerId)
    if (!ipv4) {
        return [{ field: 'ipv4', message: 'No quedan IPs libres en las redes del router', rule: 'agotado' }]
    }
    const id = siguienteId(bd.servicios)
    const cliente = bd.clientes.find(c => c.id === cuerpo.cliente_id)
    const plan = bd.planes.find(p => p.id === cuerpo.plan_id)
    const modo = (cuerpo.ipv6_modo as Servicio['ipv6_modo'] | undefined) ?? 'radius_servicio'
    const conV6 = modo === 'radius_servicio' && plan?.dual_stack !== 'v4' && bd.ipv6Bloques.some(b => b.router_id === routerId)
    const momento = ahora()
    return {
        id,
        cliente_id: Number(cuerpo.cliente_id),
        router_id: routerId,
        plan_id: Number(cuerpo.plan_id),
        plantilla_facturacion_id: typeof cuerpo.plantilla_facturacion_id === 'number' ? cuerpo.plantilla_facturacion_id : null,
        estado: 'activo',
        promesa_activa: false,
        user_ppp: texto(cuerpo.user_ppp) ?? `cliente${cliente?.id ?? id}.${id}`,
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
                }
        bd.servicios[indice] = despues
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

export const rutasServicios: RutasFixture = {
    'GET /api/v1/servicios': conPermiso('servicios.ver', (solicitud) => {
        const q = normalizar(solicitud.query.get('q')?.trim())
        const cliente = numeroQuery(solicitud, 'cliente_id')
        const router = numeroQuery(solicitud, 'router_id')
        const plan = numeroQuery(solicitud, 'plan_id')
        const estado = solicitud.query.get('estado')
        const zona = numeroQuery(solicitud, 'zona_id')
        const deuda = solicitud.query.get('con_deuda_vencida')
        const filas = bd.servicios
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
        bd.clavesPpp[resultado.id] = typeof clave === 'string' && clave ? clave : claveGenerada(resultado.id)
        registrarAccion(solicitud, 'servicios.crear', { tipo: 'servicio', id: resultado.id }, { ...entrada, pass_ppp: '***' })
        return { status: 201, cuerpo: resultado }
    })),

    'GET /api/v1/servicios/:id/credenciales': conPermiso('servicios.ver_credenciales', (solicitud) => {
        const servicio = bd.servicios.find(s => s.id === idDe(solicitud))
        if (!servicio) {
            return noEncontrado('el servicio')
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
