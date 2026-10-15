import type { Problem, Schema } from '@argosisp/contracts'
import type { RutasFixture, SolicitudFixture } from '~/utils/fetchFixtures'
import { ipEnCidr, ipv4ANumero } from '~/utils/red'
import { bd, siguienteId } from '../bd'
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
        version: 1,
        created_at: momento,
        updated_at: momento,
    }
}

export const rutasServicios: RutasFixture = {
    'GET /api/v1/servicios': conPermiso('servicios.ver', (solicitud) => {
        const q = normalizar(solicitud.query.get('q')?.trim())
        const cliente = numeroQuery(solicitud, 'cliente_id')
        const router = numeroQuery(solicitud, 'router_id')
        const plan = numeroQuery(solicitud, 'plan_id')
        const estado = solicitud.query.get('estado')
        const filas = bd.servicios
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
        return { status: 200, cuerpo: paginar(filas, solicitud) }
    }),

    'GET /api/v1/servicios/:id': conPermiso('servicios.ver', (solicitud) => {
        const servicio = bd.servicios.find(s => s.id === idDe(solicitud))
        return servicio ? { status: 200, cuerpo: servicio } : noEncontrado('el servicio')
    }),

    'POST /api/v1/servicios': conPermiso('servicios.crear', conIdempotencia((solicitud) => {
        const resultado = crearServicio(solicitud)
        if (Array.isArray(resultado)) {
            return datosInvalidos(resultado)
        }
        bd.servicios.push(resultado)
        const { pass_ppp: _clave, ...entrada } = cuerpoObjeto(solicitud)
        registrarAccion(solicitud, 'servicios.crear', { tipo: 'servicio', id: resultado.id }, { ...entrada, pass_ppp: '***' })
        return { status: 201, cuerpo: resultado }
    })),
}
