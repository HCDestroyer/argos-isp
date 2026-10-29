import type { Problem, Schema } from '@argosisp/contracts'
import type { RespuestaFixture, RutasFixture, SolicitudFixture } from '~/utils/fetchFixtures'
import { contiene, cuantosCaben, prefijoV6, seSolapan, subprefijo, textoPrefijo } from '../../app/utils/ipv6'
import { bd } from '../bd'
import { ahora, conPermiso, cuerpoObjeto, datosInvalidos, idDe, noEncontrado, problemaTipado, registrarAccion } from '../comun'

/**
 * Pools editables, ocupación, migración y vistas previas IPv6, como `contratos/pools.md` (A1):
 * `GET /routers/:id/direccionamiento`, `GET`/`PUT` de redes, bloques y pools, `POST …/migrar` con
 * `simular` y `mover_servicios`, y `POST /ipv6-pools/vista-previa` y `/ipv6-bloques/vista-previa`.
 * La ocupación se calcula con las direcciones de los servicios no retirados de los fixtures.
 */

type RedIpv4 = Schema<'RedIpv4'>
type Bloque = Schema<'Ipv6Bloque'>
type Pool = Schema<'Ipv6Pool'>
type Servicio = Schema<'Servicio'>
type Errores = NonNullable<Problem['errors']>

const IPV4 = /^((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$/
const CIDR_V4 = /^(\d{1,3}\.){3}\d{1,3}\/([0-9]|[12][0-9]|3[0-2])$/

function numeroIpv4(ip: string): number {
    return ip.split('.').reduce((total, octeto) => total * 256 + Number(octeto), 0)
}

function redV4(cidr: string): { inicio: number, fin: number, largo: number } {
    const [ip = '0.0.0.0', largoTexto = '32'] = cidr.split('/')
    const largo = Number(largoTexto)
    const tamano = 2 ** (32 - largo)
    const inicio = Math.floor(numeroIpv4(ip) / tamano) * tamano
    return { inicio, fin: inicio + tamano - 1, largo }
}

/** Dirección utilizable de la red (sin red ni broadcast en /30 o más grandes). */
function utilizable(cidr: string, ip: number): boolean {
    const red = redV4(cidr)
    if (ip < red.inicio || ip > red.fin) {
        return false
    }
    return red.largo >= 31 || (ip !== red.inicio && ip !== red.fin)
}

const vigentes = (): Servicio[] => bd.servicios.filter(s => s.estado !== 'retirado')

function serviciosDeRed(red: RedIpv4): Servicio[] {
    const r = redV4(red.cidr)
    return vigentes().filter((s) => {
        if (!s.ipv4 || !IPV4.test(s.ipv4)) {
            return false
        }
        const ip = numeroIpv4(s.ipv4)
        return ip >= r.inicio && ip <= r.fin
    })
}

function prefijoDeServicio(servicio: Servicio, tipo: Pool['tipo']): string | null {
    return tipo === 'enlace' ? servicio.prefijo_enlace_v6 : servicio.prefijo_delegado_v6
}

function serviciosDePrefijo(cidr: string, tipo: Pool['tipo'] | null): Servicio[] {
    const pool = prefijoV6(cidr)
    if (!pool) {
        return []
    }
    return vigentes().filter(s => (tipo ? [tipo] : (['enlace', 'delegacion'] as const)).some((t) => {
        const propio = prefijoDeServicio(s, t)
        const prefijo = propio ? prefijoV6(propio) : null
        return prefijo !== null && contiene(pool, prefijo)
    }))
}

function porcentaje(asignadas: number, libres: number): number {
    return asignadas + libres === 0 ? 0 : Math.round((asignadas / (asignadas + libres)) * 1000) / 10
}

export function ocupacionRed(red: RedIpv4): Schema<'OcupacionPool'> {
    const r = redV4(red.cidr)
    const total = r.largo >= 31 ? r.fin - r.inicio + 1 : Math.max(0, r.fin - r.inicio - 1)
    const asignadas = serviciosDeRed(red).length
    const rangoInicio = red.rango_inicio ? numeroIpv4(red.rango_inicio) : r.inicio
    const rangoFin = red.rango_fin ? numeroIpv4(red.rango_fin) : r.fin
    let fueraDeRango = 0
    for (let ip = r.inicio; ip <= r.fin && total <= 65_536; ip++) {
        if (utilizable(red.cidr, ip) && (ip < rangoInicio || ip > rangoFin)) {
            fueraDeRango++
        }
    }
    const gateway = red.gateway && IPV4.test(red.gateway) && utilizable(red.cidr, numeroIpv4(red.gateway)) ? 1 : 0
    const reservadas = Math.min(total - asignadas, fueraDeRango + gateway)
    const libres = Math.max(0, total - asignadas - reservadas)
    return { total, asignadas, libres, reservadas, porcentaje: porcentaje(asignadas, libres) }
}

export function ocupacionPool(pool: Pool): Schema<'OcupacionPool'> {
    const prefijo = prefijoV6(pool.prefijo)
    const total = prefijo ? Number(cuantosCaben(prefijo.largo, pool.tamano_entrega)) : 0
    const asignadas = serviciosDePrefijo(pool.prefijo, pool.tipo).length
    const libres = Math.max(0, total - asignadas)
    return { total, asignadas, libres, reservadas: 0, porcentaje: porcentaje(asignadas, libres) }
}

export function entregaPool(datos: { prefijo: string, tipo: Pool['tipo'], tamano_entrega: Pool['tamano_entrega'] }): Schema<'EntregaPoolIpv6'> {
    const prefijo = prefijoV6(datos.prefijo)
    const caben = prefijo ? cuantosCaben(prefijo.largo, datos.tamano_entrega) : 0n
    return {
        atributo_radius: datos.tipo === 'enlace' ? 'Framed-IPv6-Prefix' : 'Delegated-IPv6-Prefix',
        redes_lan_por_cliente: datos.tipo === 'enlace' ? 1 : 2 ** (64 - datos.tamano_entrega),
        clientes_maximos: Number(caben),
        primer_prefijo: prefijo && caben > 0n ? textoPrefijo(subprefijo(prefijo, datos.tamano_entrega, 0n)) : datos.prefijo,
        segundo_prefijo: prefijo && caben > 1n ? textoPrefijo(subprefijo(prefijo, datos.tamano_entrega, 1n)) : null,
        ultimo_prefijo: prefijo && caben > 0n ? textoPrefijo(subprefijo(prefijo, datos.tamano_entrega, caben - 1n)) : datos.prefijo,
    }
}

export function vistaRed(red: RedIpv4): RedIpv4 {
    return { ...red, ocupacion: ocupacionRed(red) }
}

export function vistaPool(pool: Pool): Pool {
    return { ...pool, ocupacion: ocupacionPool(pool), entrega: entregaPool(pool) }
}

export function vistaBloque(bloque: Bloque): Bloque {
    const propio = prefijoV6(bloque.prefijo)
    const pools = bd.ipv6Pools.filter(p => p.bloque_id === bloque.id)
    const parte = pools.reduce((suma, p) => {
        const prefijo = prefijoV6(p.prefijo)
        return propio && prefijo ? suma + 1 / 2 ** (prefijo.largo - propio.largo) : suma
    }, 0)
    return { ...bloque, espacio: { pools: pools.length, porcentaje_en_pools: Math.round(Math.min(1, parte) * 1000) / 10 } }
}

const conflicto = (entidad: string, id: number): RespuestaFixture => problemaTipado(409, 'conflicto_version', 'Conflicto de versión', `${entidad} ${id} cambió en otra sesión; recarga y vuelve a intentar`)
const regla = (codigo: string, detalle: string, errores?: Errores): RespuestaFixture => problemaTipado(422, codigo, 'Regla de negocio', detalle, errores)

function texto(valor: unknown): string | null {
    return typeof valor === 'string' && valor.trim() !== '' ? valor.trim() : null
}

function etiqueta(servicio: Servicio): string {
    return `servicio ${servicio.id}, ${servicio.user_ppp ?? 'sin usuario'}`
}

function sumarSalida(lista: Errores, total: number): string {
    return total > lista.length ? ` (se muestran ${lista.length} de ${total})` : ''
}

/** Totales del router por familia, como `DireccionamientoRouter.ocupacion`. */
function sumaOcupacion(lista: Schema<'OcupacionPool'>[]): Schema<'OcupacionPool'> {
    const suma = lista.reduce((t, o) => ({ total: t.total + o.total, asignadas: t.asignadas + o.asignadas, libres: t.libres + o.libres, reservadas: t.reservadas + o.reservadas, porcentaje: 0 }), { total: 0, asignadas: 0, libres: 0, reservadas: 0, porcentaje: 0 })
    return { ...suma, porcentaje: porcentaje(suma.asignadas, suma.libres) }
}

function direccionamiento(routerId: number): Schema<'DireccionamientoRouter'> {
    const redes = bd.redesIpv4.filter(r => r.router_id === routerId).map(vistaRed)
    const bloques = bd.ipv6Bloques.filter(b => b.router_id === routerId).map(b => ({ ...vistaBloque(b), pools: bd.ipv6Pools.filter(p => p.bloque_id === b.id).map(vistaPool) }))
    const pools = bloques.flatMap(b => b.pools)
    const grupos = new Map<string, Pool[]>()
    for (const p of pools) {
        const clave = `${p.tipo}:${p.tamano_entrega}`
        grupos.set(clave, [...(grupos.get(clave) ?? []), p])
    }
    const ipv4 = sumaOcupacion(redes.map(r => r.ocupacion))
    const enlaces = sumaOcupacion(pools.filter(p => p.tipo === 'enlace').map(p => p.ocupacion))
    const planes = (bd.planesPorRouter[routerId] ?? []).map(id => bd.planes.find(p => p.id === id)).filter((p): p is Schema<'Plan'> => p !== undefined).map((plan) => {
        const delegados = sumaOcupacion(pools.filter(p => p.tipo === 'delegacion' && p.tamano_entrega === plan.tamano_prefijo_delegado).map(p => p.ocupacion))
        const avisos: Schema<'DireccionamientoRouter'>['planes'][number]['avisos'] = []
        if (plan.dual_stack !== 'v6') {
            if (!redes.length) {
                avisos.push({ codigo: 'sin_ipv4', mensaje: 'El router no tiene redes IPv4: los servicios de este plan no recibirán IPv4.' })
            }
            else if (ipv4.libres === 0) {
                avisos.push({ codigo: 'sin_ipv4_libres', mensaje: 'No quedan IPv4 libres en las redes del router.' })
            }
        }
        if (plan.dual_stack !== 'v4') {
            if (!pools.some(p => p.tipo === 'enlace')) {
                avisos.push({ codigo: 'sin_pool_enlace', mensaje: 'Falta un pool IPv6 de enlace (/64) en el router.' })
            }
            if (!pools.some(p => p.tipo === 'delegacion' && p.tamano_entrega === plan.tamano_prefijo_delegado)) {
                avisos.push({ codigo: 'sin_pool_delegacion', mensaje: `Falta un pool de delegación que entregue /${plan.tamano_prefijo_delegado}.` })
            }
        }
        return {
            plan_id: plan.id,
            nombre: plan.nombre,
            dual_stack: plan.dual_stack,
            ipv4: plan.dual_stack === 'v6' ? { origen: 'ninguna' as const, pool: null, libres: null } : { origen: 'redes' as const, pool: null, libres: ipv4.libres },
            ipv6: plan.dual_stack === 'v4'
                ? null
                : { prefijo_enlace: 64 as const, prefijo_delegado: plan.tamano_prefijo_delegado, redes_lan_por_cliente: 2 ** (64 - plan.tamano_prefijo_delegado), enlaces_libres: enlaces.libres, delegados_libres: delegados.libres },
            avisos,
        }
    })
    return {
        router_id: routerId,
        redes_ipv4: redes,
        bloques_ipv6: bloques,
        ocupacion: {
            ipv4,
            ipv6: [...grupos.entries()].map(([clave, lista]) => {
                const [tipo, tamano] = clave.split(':') as [Pool['tipo'], string]
                return { tipo, tamano_entrega: Number(tamano) as Pool['tamano_entrega'], ocupacion: sumaOcupacion(lista.map(ocupacionPool)) }
            }),
        },
        planes,
    }
}

type Direcciones = Schema<'MigracionPools'>['servicios'][number]['antes']

function direccionesDe(servicio: Servicio, routerId: number): Direcciones {
    return { router_id: routerId, ipv4: servicio.ipv4, prefijo_enlace_v6: servicio.prefijo_enlace_v6, prefijo_delegado_v6: servicio.prefijo_delegado_v6 }
}

/** Migrar una red o un bloque (con lo que se mude junto): misma regla que `migrar_pools.ts`. */
function migrar(solicitud: SolicitudFixture, redes: RedIpv4[], bloques: Bloque[], accion: string, entidad: { tipo: string, id: number }): RespuestaFixture {
    const cuerpo = cuerpoObjeto(solicitud)
    const origen = (redes[0] ?? bloques[0])!.router_id
    const destino = typeof cuerpo.router_id === 'number' ? cuerpo.router_id : 0
    const router = bd.routers.find(r => r.id === destino)
    if (!router || destino === origen) {
        return datosInvalidos([{ field: 'router_id', message: destino === origen ? 'Elige un router distinto al actual' : 'El router de destino no existe', rule: 'router' }])
    }
    if (!router.activo) {
        return regla('router_inactivo', `El router ${router.nombre} está inactivo`)
    }
    const afectados = new Map<number, Servicio>()
    for (const red of redes) {
        serviciosDeRed(red).forEach(s => afectados.set(s.id, s))
    }
    for (const bloque of bloques) {
        serviciosDePrefijo(bloque.prefijo, null).forEach(s => afectados.set(s.id, s))
    }
    const lista = [...afectados.values()]
    if (lista.length && cuerpo.mover_servicios !== true) {
        const errores = lista.slice(0, 100).map(s => ({ field: 'mover_servicios', message: `Servicio ${s.id} (${s.user_ppp ?? 'sin usuario'}): ${[s.ipv4, s.prefijo_enlace_v6, s.prefijo_delegado_v6].filter(Boolean).join(', ')}`, rule: 'pool_con_servicios' }))
        return regla('pool_con_servicios', `${lista.length} ${lista.length === 1 ? 'servicio usa' : 'servicios usan'} direcciones de lo que se quiere migrar`, errores)
    }
    const noDisponible = lista.find(s => !(bd.planesPorRouter[destino] ?? []).includes(s.plan_id))
    if (noDisponible) {
        return regla('servicio_no_migrable', `El servicio ${noDisponible.id} (${noDisponible.user_ppp ?? 'sin usuario'}) no puede pasar: su plan no está disponible en ${router.nombre}`)
    }
    const servicios = lista.map(s => ({ servicio_id: s.id, user_ppp: s.user_ppp, antes: direccionesDe(s, s.router_id), despues: direccionesDe(s, destino) }))
    const simulado = cuerpo.simular === true
    if (!simulado) {
        const momento = ahora()
        redes.forEach(r => Object.assign(r, { router_id: destino, version: r.version + 1, updated_at: momento }))
        bloques.forEach((b) => {
            Object.assign(b, { router_id: destino, version: b.version + 1, updated_at: momento })
            bd.ipv6Pools.filter(p => p.bloque_id === b.id).forEach(p => Object.assign(p, { router_id: destino }))
        })
        lista.forEach(s => Object.assign(s, { router_id: destino, version: s.version + 1, updated_at: momento }))
        registrarAccion(solicitud, accion, entidad, cuerpo)
    }
    return {
        status: 200,
        cuerpo: {
            router_origen_id: origen,
            router_destino_id: destino,
            redes_ipv4: redes.map(r => vistaRed(simulado ? r : r)),
            bloques_ipv6: bloques.map(vistaBloque),
            servicios,
            simulado,
        } satisfies Schema<'MigracionPools'>,
    }
}

function vistaPreviaBloque(prefijoTexto: string, tamanoDelegado: Pool['tamano_entrega'], excluirId: number | null): Schema<'VistaPreviaBloqueIpv6'> | null {
    const bloque = prefijoV6(prefijoTexto)
    if (!bloque || bloque.largo >= tamanoDelegado) {
        return null
    }
    const delegacion = subprefijo(bloque, bloque.largo + 1, 1n)
    const clientes = cuantosCaben(delegacion.largo, tamanoDelegado)
    // El enlace /64 justo para los mismos clientes, al inicio del bloque.
    let largoEnlace = 64 - clientes.toString(2).length + 1
    largoEnlace = Math.max(bloque.largo + 1, Math.min(64, largoEnlace))
    const enlace = subprefijo(bloque, largoEnlace, 0n)
    const traslapa = bd.ipv6Bloques.find(b => b.id !== excluirId && (() => {
        const otro = prefijoV6(b.prefijo)
        return otro !== null && seSolapan(otro, bloque)
    })())
    return {
        prefijo: textoPrefijo(bloque),
        tamano_delegado: tamanoDelegado,
        clientes: Number(clientes),
        redes_lan_por_cliente: 2 ** (64 - tamanoDelegado),
        pools_sugeridos: [
            { tipo: 'enlace', prefijo: textoPrefijo(enlace), tamano_entrega: 64, clientes: Number(cuantosCaben(enlace.largo, 64)) },
            { tipo: 'delegacion', prefijo: textoPrefijo(delegacion), tamano_entrega: tamanoDelegado, clientes: Number(clientes) },
        ],
        ejemplos: [0n, 1n].map(i => ({ servicio: Number(i) + 1, prefijo_enlace: textoPrefijo(subprefijo(enlace, 64, i)), prefijo_delegado: textoPrefijo(subprefijo(delegacion, tamanoDelegado, i)) })),
        traslapa_con: traslapa?.prefijo ?? null,
    }
}

function tamano(valor: unknown, porDefecto: Pool['tamano_entrega']): Pool['tamano_entrega'] {
    return valor === 64 || valor === 56 || valor === 48 ? valor : porDefecto
}

export const rutasPools: RutasFixture = {
    'GET /api/v1/routers/:id/direccionamiento': conPermiso('routers.ver', (solicitud) => {
        const id = idDe(solicitud)
        return id !== null && bd.routers.some(r => r.id === id) ? { status: 200, cuerpo: direccionamiento(id) } : noEncontrado('el router')
    }),

    'GET /api/v1/redes-ipv4/:id': conPermiso('redes.ver', (solicitud) => {
        const red = bd.redesIpv4.find(r => r.id === idDe(solicitud))
        return red ? { status: 200, cuerpo: vistaRed(red) } : noEncontrado('la red IPv4')
    }),

    'PUT /api/v1/redes-ipv4/:id': conPermiso('redes.editar', (solicitud) => {
        const red = bd.redesIpv4.find(r => r.id === idDe(solicitud))
        if (!red) {
            return noEncontrado('la red IPv4')
        }
        const cuerpo = cuerpoObjeto(solicitud)
        if (cuerpo.version !== red.version) {
            return conflicto('La red IPv4', red.id)
        }
        const nueva: RedIpv4 = {
            ...red,
            cidr: typeof cuerpo.cidr === 'string' ? cuerpo.cidr.trim() : red.cidr,
            tipo: cuerpo.tipo === 'estatico' || cuerpo.tipo === 'pool' ? cuerpo.tipo : red.tipo,
            nombre: 'nombre' in cuerpo ? texto(cuerpo.nombre) : red.nombre,
            gateway: 'gateway' in cuerpo ? texto(cuerpo.gateway) : red.gateway,
            rango_inicio: 'rango_inicio' in cuerpo ? texto(cuerpo.rango_inicio) : red.rango_inicio,
            rango_fin: 'rango_fin' in cuerpo ? texto(cuerpo.rango_fin) : red.rango_fin,
            dns_primario: 'dns_primario' in cuerpo ? texto(cuerpo.dns_primario) : red.dns_primario,
            dns_secundario: 'dns_secundario' in cuerpo ? texto(cuerpo.dns_secundario) : red.dns_secundario,
        }
        if (!CIDR_V4.test(nueva.cidr)) {
            return datosInvalidos([{ field: 'cidr', message: 'La red debe estar en notación CIDR', rule: 'regex' }])
        }
        if ((nueva.rango_inicio === null) !== (nueva.rango_fin === null)) {
            return datosInvalidos([{ field: 'rango_fin', message: 'El rango lleva inicio y fin, o ninguno', rule: 'rango' }])
        }
        if (bd.redesIpv4.some(r => r.id !== red.id && (() => {
            const a = redV4(r.cidr)
            const b = redV4(nueva.cidr)
            return a.inicio <= b.fin && b.inicio <= a.fin
        })())) {
            return problemaTipado(409, 'red_traslapada', 'Red traslapada', `La red ${nueva.cidr} se traslapa con otra red registrada`)
        }
        const fuera = serviciosDeRed(red).filter((s) => {
            const ip = numeroIpv4(s.ipv4!)
            const enRango = (!nueva.rango_inicio || ip >= numeroIpv4(nueva.rango_inicio)) && (!nueva.rango_fin || ip <= numeroIpv4(nueva.rango_fin))
            return !utilizable(nueva.cidr, ip) || !enRango || s.ipv4 === nueva.gateway
        })
        if (fuera.length) {
            const errores = fuera.slice(0, 100).map(s => ({ field: utilizable(nueva.cidr, numeroIpv4(s.ipv4!)) ? (s.ipv4 === nueva.gateway ? 'gateway' : 'rango_inicio') : 'cidr', message: `${s.ipv4} (${etiqueta(s)}) quedaría fuera de la red`, rule: 'ips_asignadas_fuera' }))
            return regla('ips_asignadas_fuera', `${fuera.length} ${fuera.length === 1 ? 'IP asignada quedaría fuera' : 'IPs asignadas quedarían fuera'}${sumarSalida(errores, fuera.length)}`, errores)
        }
        Object.assign(red, nueva, { version: red.version + 1, updated_at: ahora() })
        registrarAccion(solicitud, 'redes.editar', { tipo: 'red_ipv4', id: red.id }, cuerpo)
        return { status: 200, cuerpo: vistaRed(red) }
    }),

    'POST /api/v1/redes-ipv4/:id/migrar': conPermiso('redes.migrar', (solicitud) => {
        const red = bd.redesIpv4.find(r => r.id === idDe(solicitud))
        if (!red) {
            return noEncontrado('la red IPv4')
        }
        const cuerpo = cuerpoObjeto(solicitud)
        if (cuerpo.version !== red.version) {
            return conflicto('La red IPv4', red.id)
        }
        const ids = Array.isArray(cuerpo.bloques_ipv6) ? cuerpo.bloques_ipv6 : []
        const bloques = bd.ipv6Bloques.filter(b => ids.includes(b.id) && b.router_id === red.router_id)
        return migrar(solicitud, [red], bloques, 'redes.migrar', { tipo: 'red_ipv4', id: red.id })
    }),

    'GET /api/v1/ipv6-bloques/:id': conPermiso('ipv6.ver', (solicitud) => {
        const bloque = bd.ipv6Bloques.find(b => b.id === idDe(solicitud))
        return bloque ? { status: 200, cuerpo: vistaBloque(bloque) } : noEncontrado('el bloque IPv6')
    }),

    'PUT /api/v1/ipv6-bloques/:id': conPermiso('ipv6.editar', (solicitud) => {
        const bloque = bd.ipv6Bloques.find(b => b.id === idDe(solicitud))
        if (!bloque) {
            return noEncontrado('el bloque IPv6')
        }
        const cuerpo = cuerpoObjeto(solicitud)
        if (cuerpo.version !== bloque.version) {
            return conflicto('El bloque IPv6', bloque.id)
        }
        const prefijoTexto = typeof cuerpo.prefijo === 'string' ? cuerpo.prefijo.trim() : bloque.prefijo
        const prefijo = prefijoV6(prefijoTexto)
        if (!prefijo) {
            return datosInvalidos([{ field: 'prefijo', message: 'El prefijo debe estar en notación CIDR', rule: 'regex' }])
        }
        const fuera = bd.ipv6Pools.filter(p => p.bloque_id === bloque.id && !contiene(prefijo, prefijoV6(p.prefijo)!))
        if (fuera.length) {
            return regla('pools_fuera_del_bloque', `${fuera.length} ${fuera.length === 1 ? 'pool quedaría fuera' : 'pools quedarían fuera'} del bloque`, fuera.map(p => ({ field: 'prefijo', message: `Pool ${p.prefijo} quedaría fuera de ${textoPrefijo(prefijo)}`, rule: 'pools_fuera_del_bloque' })))
        }
        Object.assign(bloque, {
            prefijo: textoPrefijo(prefijo),
            nombre: 'nombre' in cuerpo ? texto(cuerpo.nombre) : bloque.nombre,
            proveedor: 'proveedor' in cuerpo ? texto(cuerpo.proveedor) : bloque.proveedor,
            version: bloque.version + 1,
            updated_at: ahora(),
        })
        registrarAccion(solicitud, 'ipv6.editar', { tipo: 'ipv6_bloque', id: bloque.id }, cuerpo)
        return { status: 200, cuerpo: vistaBloque(bloque) }
    }),

    'POST /api/v1/ipv6-bloques/:id/migrar': conPermiso('ipv6.migrar', (solicitud) => {
        const bloque = bd.ipv6Bloques.find(b => b.id === idDe(solicitud))
        if (!bloque) {
            return noEncontrado('el bloque IPv6')
        }
        const cuerpo = cuerpoObjeto(solicitud)
        if (cuerpo.version !== bloque.version) {
            return conflicto('El bloque IPv6', bloque.id)
        }
        const ids = Array.isArray(cuerpo.redes_ipv4) ? cuerpo.redes_ipv4 : []
        const redes = bd.redesIpv4.filter(r => ids.includes(r.id) && r.router_id === bloque.router_id)
        return migrar(solicitud, redes, [bloque], 'ipv6.migrar', { tipo: 'ipv6_bloque', id: bloque.id })
    }),

    'POST /api/v1/ipv6-bloques/vista-previa': conPermiso('ipv6.ver', (solicitud) => {
        const cuerpo = cuerpoObjeto(solicitud)
        const previa = vistaPreviaBloque(String(cuerpo.prefijo ?? ''), tamano(cuerpo.tamano_delegado, 56), null)
        return previa ? { status: 200, cuerpo: previa } : datosInvalidos([{ field: 'prefijo', message: 'El prefijo debe estar en notación CIDR y ser más grande que lo que se delega', rule: 'regex' }])
    }),

    'GET /api/v1/ipv6-pools/:id': conPermiso('ipv6.ver', (solicitud) => {
        const pool = bd.ipv6Pools.find(p => p.id === idDe(solicitud))
        return pool ? { status: 200, cuerpo: vistaPool(pool) } : noEncontrado('el pool IPv6')
    }),

    'PUT /api/v1/ipv6-pools/:id': conPermiso('ipv6.editar', (solicitud) => {
        const pool = bd.ipv6Pools.find(p => p.id === idDe(solicitud))
        if (!pool) {
            return noEncontrado('el pool IPv6')
        }
        const cuerpo = cuerpoObjeto(solicitud)
        if (cuerpo.version !== pool.version) {
            return conflicto('El pool IPv6', pool.id)
        }
        const bloque = bd.ipv6Bloques.find(b => b.id === pool.bloque_id)!
        const prefijoTexto = typeof cuerpo.prefijo === 'string' ? cuerpo.prefijo.trim() : pool.prefijo
        const prefijo = prefijoV6(prefijoTexto)
        const tipo = cuerpo.tipo === 'enlace' || cuerpo.tipo === 'delegacion' ? cuerpo.tipo : pool.tipo
        const entrega = tamano(cuerpo.tamano_entrega, pool.tamano_entrega)
        if (!prefijo) {
            return datosInvalidos([{ field: 'prefijo', message: 'El prefijo debe estar en notación CIDR', rule: 'regex' }])
        }
        if (!contiene(prefijoV6(bloque.prefijo)!, prefijo)) {
            return datosInvalidos([{ field: 'prefijo', message: `El pool ${prefijoTexto} no está dentro del bloque ${bloque.prefijo}`, rule: 'dentro_del_bloque' }])
        }
        if (tipo === 'enlace' && entrega !== 64) {
            return datosInvalidos([{ field: 'tamano_entrega', message: 'Un pool de enlace entrega /64', rule: 'coherencia' }])
        }
        const asignados = serviciosDePrefijo(pool.prefijo, pool.tipo)
        if (asignados.length && (tipo !== pool.tipo || entrega !== pool.tamano_entrega)) {
            return regla('pool_con_asignaciones', `El tipo y el tamaño solo cambian sin prefijos asignados: ${asignados.length} en uso`, asignados.slice(0, 100).map(s => ({ field: 'tipo', message: `${prefijoDeServicio(s, pool.tipo)} (${etiqueta(s)})`, rule: 'pool_con_asignaciones' })))
        }
        const fuera = asignados.filter(s => !contiene(prefijo, prefijoV6(prefijoDeServicio(s, pool.tipo)!)!))
        if (fuera.length) {
            return regla('prefijos_asignados_fuera', `${fuera.length} ${fuera.length === 1 ? 'prefijo asignado quedaría fuera' : 'prefijos asignados quedarían fuera'} del pool`, fuera.slice(0, 100).map(s => ({ field: 'prefijo', message: `${prefijoDeServicio(s, pool.tipo)} (${etiqueta(s)}) quedaría fuera del pool`, rule: 'prefijos_asignados_fuera' })))
        }
        if (bd.ipv6Pools.some(p => p.id !== pool.id && seSolapan(prefijoV6(p.prefijo)!, prefijo))) {
            return problemaTipado(409, 'pool_traslapado', 'Pool traslapado', `El pool ${prefijoTexto} se traslapa con otro pool`)
        }
        Object.assign(pool, {
            prefijo: textoPrefijo(prefijo),
            tipo,
            tamano_entrega: entrega,
            nombre: 'nombre' in cuerpo ? texto(cuerpo.nombre) : pool.nombre,
            nombre_en_router: 'nombre_en_router' in cuerpo ? texto(cuerpo.nombre_en_router) : pool.nombre_en_router,
            version: pool.version + 1,
            updated_at: ahora(),
        })
        registrarAccion(solicitud, 'ipv6.editar', { tipo: 'ipv6_pool', id: pool.id }, cuerpo)
        return { status: 200, cuerpo: vistaPool(pool) }
    }),

    'POST /api/v1/ipv6-pools/vista-previa': conPermiso('ipv6.ver', (solicitud) => {
        const cuerpo = cuerpoObjeto(solicitud)
        const prefijoTexto = String(cuerpo.prefijo ?? '').trim()
        const prefijo = prefijoV6(prefijoTexto)
        const tipo = cuerpo.tipo === 'enlace' ? 'enlace' : 'delegacion'
        const entrega = tipo === 'enlace' ? 64 : tamano(cuerpo.tamano_entrega, 56)
        if (!prefijo || prefijo.largo > entrega) {
            return datosInvalidos([{ field: 'prefijo', message: 'El prefijo debe estar en notación CIDR y no ser más chico que lo que entrega', rule: 'regex' }])
        }
        const traslapa = bd.ipv6Pools.find(p => seSolapan(prefijoV6(p.prefijo)!, prefijo))
        return { status: 200, cuerpo: { prefijo: textoPrefijo(prefijo), tipo, tamano_entrega: entrega, ...entregaPool({ prefijo: prefijoTexto, tipo, tamano_entrega: entrega }), traslapa_con: traslapa?.prefijo ?? null } satisfies Schema<'VistaPreviaPoolIpv6'> }
    }),
}
