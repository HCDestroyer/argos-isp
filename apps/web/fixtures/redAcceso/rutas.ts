import type { Problem, Schema } from '@argosisp/contracts'
import type { RespuestaFixture, RutasFixture, SolicitudFixture } from '~/utils/fetchFixtures'
import { bd, siguienteId } from '../bd'
import { ahora, conIdempotencia, conPermiso, cuerpoObjeto, datosInvalidos, idDe, noEncontrado, paginar, problemaTipado, registrarAccion, versionCambiada } from '../comun'
import { efectiva } from '../routers/estrategias'
import { SERVIDOR_POR_DEFECTO, type FilaOlt, type FilaPuertoPon, type FilaServidorPppoe, type FilaVlan } from './datos'

/**
 * Red de acceso como la API de A1 (`contratos/red-acceso.md` §4): mismas reglas (máximo 2 VLAN por
 * puerto, un servidor por VLAN e interfaz, red con gateway, adoptado de solo lectura en lo de
 * RouterOS), mismos códigos de error y las vistas calculadas. También el modo único por router
 * (`control-velocidad.md` §11): vista previa y «Unificar».
 */

type Errores = NonNullable<Problem['errors']>
type Servicio = Schema<'Servicio'>

const INTERFAZ = /^[A-Za-z0-9._-]{1,64}$/
const PON = /^\d{1,3}(\/\d{1,3}){1,3}$/
const AUTENTICACIONES = ['pap', 'chap', 'mschap1', 'mschap2'] as const

const ra = () => bd.redAcceso

/* Vistas */

export function vistaPuerto(puerto: FilaPuertoPon): Schema<'PuertoPon'> {
    return { ...puerto, vlans: ra().vlans.filter(v => v.puerto_pon_id === puerto.id).length }
}

export function vistaOlt(olt: FilaOlt): Schema<'Olt'> {
    return { ...olt, puertos: ra().puertosPon.filter(p => p.olt_id === olt.id).map(vistaPuerto) }
}

export function vistaVlan(vlan: FilaVlan): Schema<'Vlan'> {
    const puerto = ra().puertosPon.find(p => p.id === vlan.puerto_pon_id)
    const olt = puerto ? ra().olts.find(o => o.id === puerto.olt_id) : undefined
    return { ...vlan, puerto_pon: puerto && olt ? { id: puerto.id, identificador: puerto.identificador, olt_id: olt.id, olt_nombre: olt.nombre } : null }
}

/** `localAddressServidor`: el gateway de su red IPv4 (nunca el del perfil `default`). */
export function localAddressServidor(servidor: Pick<FilaServidorPppoe, 'red_ipv4_id'>): string | null {
    return bd.redesIpv4.find(r => r.id === servidor.red_ipv4_id)?.gateway ?? null
}

export function vistaServidor(servidor: FilaServidorPppoe): Schema<'ServidorPppoe'> {
    const vlan = ra().vlans.find(v => v.id === servidor.vlan_id)
    return {
        ...servidor,
        vlan: vlan ? { id: vlan.id, nombre: vlan.nombre, vlan_id: vlan.vlan_id } : null,
        perfil: servidor.estado === 'administrado' ? `argosisp-pppoe-${servidor.id}` : servidor.perfil_base,
        local_address: localAddressServidor(servidor),
        servicios: bd.servicios.filter(s => s.servidor_pppoe_id === servidor.id && s.estado !== 'retirado').length,
    }
}

function vistaRedAcceso(routerId: number): Schema<'RedAccesoRouter'> {
    const vlans = ra().vlans.filter(v => v.router_id === routerId)
    const puertos = ra().puertosPon.filter(p => vlans.some(v => v.puerto_pon_id === p.id))
    return {
        router_id: routerId,
        vlans: vlans.map(vistaVlan),
        servidores_pppoe: ra().servidoresPppoe.filter(s => s.router_id === routerId).map(vistaServidor),
        olts: ra().olts
            .filter(o => puertos.some(p => p.olt_id === o.id))
            .map(o => ({ id: o.id, nombre: o.nombre, puertos: puertos.filter(p => p.olt_id === o.id).map(p => ({ id: p.id, identificador: p.identificador })) })),
        servicios_sin_servidor: bd.servicios.filter(s => s.router_id === routerId && (s.tipo_conexion ?? 'pppoe') === 'pppoe' && s.estado !== 'retirado' && !s.servidor_pppoe_id).length,
    }
}

/* Servicio → servidor (§3) */

/** Red del router que contiene la IPv4 (por prefijo /24 o /23, suficiente para los fixtures). */
function redDeIp(routerId: number, ipv4: string | null | undefined): number | null {
    if (!ipv4) {
        return null
    }
    const aNumero = (ip: string) => ip.split('.').reduce((n, o) => n * 256 + Number(o), 0)
    const red = bd.redesIpv4.find((r) => {
        if (r.router_id !== routerId) {
            return false
        }
        const [base, bits] = r.cidr.split('/')
        const mascara = 2 ** (32 - Number(bits))
        return Math.floor(aNumero(ipv4) / mascara) === Math.floor(aNumero(base ?? '') / mascara)
    })
    return red?.id ?? null
}

/**
 * `resolverServidorServicio` de A1: solo PPPoE; el elegido debe ser del router y estar activo; sin
 * elegir, uno → ese, ninguno → null, varios → 422 `servidor_pppoe_requerido`.
 */
export function resolverServidorServicio(entrada: { routerId: number, tipo: string, servidorId?: number | null, ipv4?: string | null, redIpv4Id?: number | null }): { servidor: FilaServidorPppoe | null } | RespuestaFixture {
    if (entrada.tipo !== 'pppoe') {
        return entrada.servidorId
            ? problemaTipado(422, 'servidor_pppoe', 'Regla de negocio', 'Solo un servicio PPPoE tiene servidor PPPoE', [{ field: 'servidor_pppoe_id', rule: 'servidor_pppoe', message: 'Solo un servicio PPPoE tiene servidor PPPoE' }])
            : { servidor: null }
    }
    if (entrada.servidorId) {
        const elegido = ra().servidoresPppoe.find(s => s.id === entrada.servidorId)
        if (!elegido || elegido.router_id !== entrada.routerId) {
            const mensaje = elegido ? 'El servidor PPPoE no es del router del servicio' : 'El servidor PPPoE no existe'
            return problemaTipado(422, 'servidor_pppoe', 'Regla de negocio', mensaje, [{ field: 'servidor_pppoe_id', rule: 'servidor_pppoe', message: mensaje }])
        }
        if (!elegido.activo) {
            const mensaje = `El servidor PPPoE «${elegido.nombre}» está inactivo`
            return problemaTipado(422, 'servidor_inactivo', 'Regla de negocio', mensaje, [{ field: 'servidor_pppoe_id', rule: 'servidor_inactivo', message: mensaje }])
        }
        return { servidor: elegido }
    }
    const candidatos = ra().servidoresPppoe.filter(s => s.router_id === entrada.routerId && s.activo)
    if (!candidatos.length) {
        return { servidor: null }
    }
    const redId = entrada.redIpv4Id ?? redDeIp(entrada.routerId, entrada.ipv4)
    const deLaRed = redId ? candidatos.filter(c => c.red_ipv4_id === redId) : []
    const opciones = deLaRed.length ? deLaRed : candidatos
    if (opciones.length > 1) {
        return problemaTipado(422, 'servidor_pppoe_requerido', 'Regla de negocio', `El router tiene ${opciones.length} servidores PPPoE (${opciones.map(c => `${c.id} «${c.nombre}»`).join(', ')}): elige uno en servidor_pppoe_id`, [
            { field: 'servidor_pppoe_id', rule: 'servidor_pppoe_requerido', message: 'Elige el servidor PPPoE del servicio' },
        ])
    }
    return { servidor: opciones[0] ?? null }
}

/** `localAddressServicio`: gateway de la red de su IPv4 o, sin ella, el de su servidor. */
export function localAddressServicio(servicio: Pick<Servicio, 'router_id' | 'ipv4' | 'servidor_pppoe_id'>): string | null {
    const red = redDeIp(servicio.router_id, servicio.ipv4)
    const gateway = bd.redesIpv4.find(r => r.id === red)?.gateway ?? null
    if (gateway) {
        return gateway
    }
    const servidor = ra().servidoresPppoe.find(s => s.id === servicio.servidor_pppoe_id)
    return servidor ? localAddressServidor(servidor) : null
}

/* Validaciones */

function texto(valor: unknown): string | null {
    return typeof valor === 'string' && valor.trim() ? valor.trim() : null
}

function enteroEn(cuerpo: Record<string, unknown>, campo: string, min: number, max: number, errores: Errores, nulable = true): void {
    const valor = cuerpo[campo]
    if (valor === undefined || (nulable && valor === null)) {
        return
    }
    if (typeof valor !== 'number' || !Number.isInteger(valor) || valor < min || valor > max) {
        errores.push({ field: campo, rule: 'range', message: `Debe ser un entero entre ${min} y ${max}` })
    }
}

function filaDe<T extends { id: number }>(filas: T[], solicitud: SolicitudFixture): T | undefined {
    const id = idDe(solicitud)
    return filas.find(f => f.id === id)
}

const conflicto = (codigo: string, detalle: string, campo?: string): RespuestaFixture =>
    problemaTipado(409, codigo, 'Conflicto', detalle, campo ? [{ field: campo, rule: codigo, message: detalle }] : undefined)

const regla = (codigo: string, detalle: string, campo: string): RespuestaFixture =>
    problemaTipado(422, codigo, 'Regla de negocio', detalle, [{ field: campo, rule: codigo, message: detalle }])

/** VLAN: formato, `vlan_duplicada`, `nombre_interfaz_duplicado`, `puerto_pon_lleno`. */
function revisarVlan(routerId: number, datos: Omit<FilaVlan, 'id' | 'version' | 'created_at' | 'updated_at'>, propia: number | null, errores: Errores): RespuestaFixture | null {
    if (!INTERFAZ.test(datos.interfaz_padre)) {
        errores.push({ field: 'interfaz_padre', rule: 'regex', message: 'Nombre de interfaz de RouterOS sin espacios' })
    }
    if (!Number.isInteger(datos.vlan_id) || datos.vlan_id < 1 || datos.vlan_id > 4094) {
        errores.push({ field: 'vlan_id', rule: 'range', message: 'Debe ser un entero entre 1 y 4094' })
    }
    if (!INTERFAZ.test(datos.nombre)) {
        errores.push({ field: 'nombre', rule: 'regex', message: 'Nombre de interfaz de RouterOS sin espacios' })
    }
    if (errores.length) {
        return datosInvalidos(errores)
    }
    const otras = ra().vlans.filter(v => v.router_id === routerId && v.id !== propia)
    if (otras.some(v => v.interfaz_padre === datos.interfaz_padre && v.vlan_id === datos.vlan_id)) {
        return conflicto('vlan_duplicada', `La VLAN ${datos.vlan_id} ya existe en ${datos.interfaz_padre}`, 'vlan_id')
    }
    if (otras.some(v => v.nombre.toLowerCase() === datos.nombre.toLowerCase())) {
        return conflicto('nombre_interfaz_duplicado', `Ya hay una interfaz «${datos.nombre}» en el router`, 'nombre')
    }
    if (datos.puerto_pon_id !== null) {
        if (!ra().puertosPon.some(p => p.id === datos.puerto_pon_id)) {
            return regla('puerto_pon', 'El puerto PON no existe', 'puerto_pon_id')
        }
        if (ra().vlans.filter(v => v.puerto_pon_id === datos.puerto_pon_id && v.id !== propia).length >= 2) {
            return regla('puerto_pon_lleno', 'Máximo 2 VLAN por puerto PON', 'puerto_pon_id')
        }
    }
    return null
}

/** Servidor: VLAN e interfaz únicas, red del router con gateway, pools IPv6 del router. */
function revisarServidor(routerId: number, datos: FilaServidorPppoe, propia: number | null): RespuestaFixture | null {
    const otros = ra().servidoresPppoe.filter(s => s.router_id === routerId && s.id !== propia)
    if (otros.some(s => s.nombre.toLowerCase() === datos.nombre.toLowerCase())) {
        return conflicto('servidor_duplicado', `Ya hay un servidor «${datos.nombre}» en el router`, 'nombre')
    }
    if (datos.vlan_id !== null) {
        const vlan = ra().vlans.find(v => v.id === datos.vlan_id)
        if (!vlan || vlan.router_id !== routerId) {
            return regla('vlan_router', 'La VLAN no es de este router', 'vlan_id')
        }
        if (otros.some(s => s.vlan_id === datos.vlan_id)) {
            return conflicto('vlan_con_servidor', `La VLAN ${vlan.vlan_id} ya tiene servidor PPPoE: uno por VLAN`, 'vlan_id')
        }
    }
    if (otros.some(s => s.interfaz === datos.interfaz)) {
        return conflicto('interfaz_con_servidor', `La interfaz ${datos.interfaz} ya tiene servidor PPPoE`, 'interfaz')
    }
    if (datos.estado === 'administrado' && datos.red_ipv4_id === null) {
        return regla('red_requerida', 'Un servidor administrado necesita su red IPv4: su gateway es el local-address', 'red_ipv4_id')
    }
    if (datos.red_ipv4_id !== null) {
        const red = bd.redesIpv4.find(r => r.id === datos.red_ipv4_id)
        if (!red || red.router_id !== routerId) {
            return regla('red_router', 'La red IPv4 no es de este router', 'red_ipv4_id')
        }
        if (!red.gateway) {
            return regla('red_sin_gateway', `La red ${red.cidr} no tiene gateway: defínelo en la red IPv4 (es el local-address del PPPoE)`, 'red_ipv4_id')
        }
    }
    for (const [campo, tipo] of [['ipv6_pool_enlace_id', 'enlace'], ['ipv6_pool_delegacion_id', 'delegacion']] as const) {
        const id = datos[campo]
        if (id === null) {
            continue
        }
        const pool = bd.ipv6Pools.find(p => p.id === id)
        const bloque = bd.ipv6Bloques.find(b => b.id === pool?.bloque_id)
        if (!pool || pool.tipo !== tipo || bloque?.router_id !== routerId) {
            return regla('pool_ipv6', `Debe ser un pool de ${tipo === 'enlace' ? 'enlace' : 'delegación'} de un bloque de este router`, campo)
        }
    }
    return null
}

/** Campos de RouterOS que un adoptado no deja cambiar (§1). */
const RUTEROS_VLAN = ['interfaz_padre', 'vlan_id', 'nombre', 'mtu'] as const
const RUTEROS_SERVIDOR = ['vlan_id', 'interfaz', 'service_name', 'perfil_base', 'max_mtu', 'max_mru', 'mrru', 'autenticacion', 'keepalive_timeout', 'una_sesion_por_host', 'max_sesiones'] as const

function soloLectura(cuerpo: Record<string, unknown>, campos: readonly string[], actual: Record<string, unknown>): RespuestaFixture | null {
    const cambiado = campos.find(c => c in cuerpo && JSON.stringify(cuerpo[c]) !== JSON.stringify(actual[c]))
    return cambiado ? regla('adoptado_solo_lectura', 'Se adoptó del router: Argos no cambia lo de RouterOS', cambiado) : null
}

function routerDe(solicitud: SolicitudFixture): number | null {
    const id = idDe(solicitud)
    return bd.routers.some(r => r.id === id) ? id : null
}

function servidorDeCuerpo(cuerpo: Record<string, unknown>, base: FilaServidorPppoe | null, routerId: number): FilaServidorPppoe | Errores {
    const errores: Errores = []
    const nombre = 'nombre' in cuerpo ? texto(cuerpo.nombre) : (base?.nombre ?? null)
    if (!nombre || nombre.length > 64) {
        errores.push({ field: 'nombre', rule: 'required', message: 'El nombre es obligatorio (máximo 64)' })
    }
    enteroEn(cuerpo, 'max_mtu', 576, 9000, errores, false)
    enteroEn(cuerpo, 'max_mru', 576, 9000, errores, false)
    enteroEn(cuerpo, 'mrru', 1500, 65535, errores)
    enteroEn(cuerpo, 'keepalive_timeout', 0, 3600, errores, false)
    enteroEn(cuerpo, 'max_sesiones', 1, 100000, errores)
    const autenticacion = Array.isArray(cuerpo.autenticacion)
        ? cuerpo.autenticacion.filter((a): a is typeof AUTENTICACIONES[number] => AUTENTICACIONES.includes(a as typeof AUTENTICACIONES[number]))
        : (base?.autenticacion ?? [...SERVIDOR_POR_DEFECTO.autenticacion])
    if (!autenticacion.length) {
        errores.push({ field: 'autenticacion', rule: 'minLength', message: 'Elige al menos un método' })
    }
    const vlanId = 'vlan_id' in cuerpo ? (typeof cuerpo.vlan_id === 'number' ? cuerpo.vlan_id : null) : (base?.vlan_id ?? null)
    const vlan = ra().vlans.find(v => v.id === vlanId)
    const interfaz = vlan ? vlan.nombre : ('interfaz' in cuerpo ? texto(cuerpo.interfaz) : (base?.interfaz ?? null))
    if (!interfaz || !INTERFAZ.test(interfaz)) {
        errores.push({ field: vlanId ? 'vlan_id' : 'interfaz', rule: 'required', message: 'Elige la VLAN o la interfaz del servidor' })
    }
    if (errores.length || !nombre || !interfaz) {
        return errores
    }
    const numero = (campo: keyof FilaServidorPppoe, defecto: number | null): number | null => (campo in cuerpo ? (typeof cuerpo[campo] === 'number' ? cuerpo[campo] : null) : ((base?.[campo] as number | null | undefined) ?? defecto))
    const momento = ahora()
    return {
        id: base?.id ?? siguienteId(ra().servidoresPppoe),
        router_id: routerId,
        empresa_id: 'empresa_id' in cuerpo ? (typeof cuerpo.empresa_id === 'number' ? cuerpo.empresa_id : null) : (base?.empresa_id ?? null),
        nombre,
        vlan_id: vlan?.id ?? null,
        interfaz,
        service_name: texto(cuerpo.service_name) ?? base?.service_name ?? nombre,
        red_ipv4_id: numero('red_ipv4_id', null),
        ipv6_pool_enlace_id: numero('ipv6_pool_enlace_id', null),
        ipv6_pool_delegacion_id: numero('ipv6_pool_delegacion_id', null),
        perfil_base: texto(cuerpo.perfil_base) ?? base?.perfil_base ?? SERVIDOR_POR_DEFECTO.perfil_base,
        max_mtu: numero('max_mtu', SERVIDOR_POR_DEFECTO.max_mtu) ?? SERVIDOR_POR_DEFECTO.max_mtu,
        max_mru: numero('max_mru', SERVIDOR_POR_DEFECTO.max_mru) ?? SERVIDOR_POR_DEFECTO.max_mru,
        mrru: numero('mrru', null),
        autenticacion,
        keepalive_timeout: numero('keepalive_timeout', SERVIDOR_POR_DEFECTO.keepalive_timeout) ?? SERVIDOR_POR_DEFECTO.keepalive_timeout,
        una_sesion_por_host: typeof cuerpo.una_sesion_por_host === 'boolean' ? cuerpo.una_sesion_por_host : (base?.una_sesion_por_host ?? true),
        max_sesiones: numero('max_sesiones', null),
        estado: base?.estado ?? 'administrado',
        ros_id: base?.ros_id ?? null,
        comment: base?.comment ?? null,
        activo: typeof cuerpo.activo === 'boolean' ? cuerpo.activo : (base?.activo ?? true),
        descripcion: 'descripcion' in cuerpo ? texto(cuerpo.descripcion) : (base?.descripcion ?? null),
        version: base ? base.version + 1 : 1,
        created_at: base?.created_at ?? momento,
        updated_at: momento,
    }
}

/* Unificar (control-velocidad §11) */

function excepcionesDelRouter(routerId: number) {
    return bd.implementacionesPlan.filter(i => i.router_id === routerId && i.estrategia_velocidad !== null)
}

/* Inventario del router (A2) */

function inventarioDe(routerId: number): Schema<'DescubrimientoRedAcceso'> | RespuestaFixture {
    const router = bd.routers.find(r => r.id === routerId)
    if (!router?.api_usuario || !router.tiene_api_password) {
        return problemaTipado(502, 'router_no_responde', 'El router no responde', 'El router no tiene usuario y clave de la API REST: complétalos en «Conexión»')
    }
    if (bd.routersSinRespuesta.includes(routerId)) {
        return problemaTipado(502, 'router_no_responde', 'El router no responde', 'El router no respondió a la API REST (timeout de 10 s): revisa el túnel o la dirección de la API')
    }
    const sembrado = ra().descubrimientos[routerId]
    if (sembrado) {
        return sembrado
    }
    // Sin semilla: el router tiene exactamente lo que Argos registró (administrado o adoptado).
    const vlans = ra().vlans.filter(v => v.router_id === routerId)
    const servidores = ra().servidoresPppoe.filter(s => s.router_id === routerId)
    const leido: Schema<'DescubrimientoRedAcceso'> = {
        router_id: routerId,
        leido_en: ahora(),
        interfaces: [...new Set(vlans.map(v => v.interfaz_padre))].map(nombre => ({ nombre, tipo: 'ether', deshabilitada: false }))
            .concat(vlans.map(v => ({ nombre: v.nombre, tipo: 'vlan', deshabilitada: false }))),
        vlans: vlans.map(v => ({ ros_id: v.ros_id ?? `*V${v.id}`, nombre: v.nombre, interfaz_padre: v.interfaz_padre, vlan_id: v.vlan_id, mtu: v.mtu, deshabilitada: false, comment: v.comment, argos: { estado: v.estado, id: v.id, diferencias: [] } })),
        servidores_pppoe: servidores.map(s => ({ ros_id: s.ros_id ?? `*S${s.id}`, service_name: s.service_name, interfaz: s.interfaz, perfil: s.estado === 'administrado' ? `argosisp-pppoe-${s.id}` : s.perfil_base, max_mtu: s.max_mtu, max_mru: s.max_mru, mrru: s.mrru, autenticacion: [...s.autenticacion], keepalive_timeout: s.keepalive_timeout, una_sesion_por_host: s.una_sesion_por_host, max_sesiones: s.max_sesiones, deshabilitado: !s.activo, comment: s.comment, red_ipv4_sugerida_id: s.red_ipv4_id, argos: { estado: s.estado, id: s.id, diferencias: [] } })),
        perfiles: [{ ros_id: '*0', nombre: 'default', local_address: null, remote_address: null, comment: null }],
        pools_ipv4: [],
        pools_ipv6: [],
        sin_router: [],
    }
    return leido
}

export const rutasRedAcceso: RutasFixture = {
    'GET /api/v1/olts': conPermiso('red_acceso.ver', solicitud => ({ status: 200, cuerpo: paginar(ra().olts.map(vistaOlt), solicitud) })),

    'POST /api/v1/olts': conPermiso('olts.crear', (solicitud) => {
        const cuerpo = cuerpoObjeto(solicitud)
        const nombre = texto(cuerpo.nombre)
        if (!nombre) {
            return datosInvalidos([{ field: 'nombre', rule: 'required', message: 'El nombre es obligatorio' }])
        }
        if (ra().olts.some(o => o.nombre.toLowerCase() === nombre.toLowerCase())) {
            return conflicto('olt_duplicada', `Ya hay una OLT «${nombre}»`, 'nombre')
        }
        const momento = ahora()
        const olt: FilaOlt = { id: siguienteId(ra().olts), nombre, marca: texto(cuerpo.marca), modelo: texto(cuerpo.modelo), empresa_id: typeof cuerpo.empresa_id === 'number' ? cuerpo.empresa_id : null, descripcion: texto(cuerpo.descripcion), activo: true, version: 1, created_at: momento, updated_at: momento }
        ra().olts.push(olt)
        registrarAccion(solicitud, 'olts.crear', { tipo: 'olt', id: olt.id }, cuerpo)
        return { status: 201, cuerpo: vistaOlt(olt) }
    }),

    'GET /api/v1/olts/:id': conPermiso('red_acceso.ver', (solicitud) => {
        const olt = filaDe(ra().olts, solicitud)
        return olt ? { status: 200, cuerpo: vistaOlt(olt) } : noEncontrado('la OLT')
    }),

    'PUT /api/v1/olts/:id': conPermiso('olts.editar', (solicitud) => {
        const olt = filaDe(ra().olts, solicitud)
        if (!olt) {
            return noEncontrado('la OLT')
        }
        const cuerpo = cuerpoObjeto(solicitud)
        if (cuerpo.version !== olt.version) {
            return versionCambiada()
        }
        const nombre = 'nombre' in cuerpo ? texto(cuerpo.nombre) : olt.nombre
        if (!nombre) {
            return datosInvalidos([{ field: 'nombre', rule: 'required', message: 'El nombre es obligatorio' }])
        }
        if (ra().olts.some(o => o.id !== olt.id && o.nombre.toLowerCase() === nombre.toLowerCase())) {
            return conflicto('olt_duplicada', `Ya hay una OLT «${nombre}»`, 'nombre')
        }
        Object.assign(olt, {
            nombre,
            marca: 'marca' in cuerpo ? texto(cuerpo.marca) : olt.marca,
            modelo: 'modelo' in cuerpo ? texto(cuerpo.modelo) : olt.modelo,
            descripcion: 'descripcion' in cuerpo ? texto(cuerpo.descripcion) : olt.descripcion,
            activo: typeof cuerpo.activo === 'boolean' ? cuerpo.activo : olt.activo,
            version: olt.version + 1,
            updated_at: ahora(),
        })
        registrarAccion(solicitud, 'olts.editar', { tipo: 'olt', id: olt.id }, cuerpo)
        return { status: 200, cuerpo: vistaOlt(olt) }
    }),

    'DELETE /api/v1/olts/:id': conPermiso('olts.eliminar', (solicitud) => {
        const olt = filaDe(ra().olts, solicitud)
        if (!olt) {
            return noEncontrado('la OLT')
        }
        const puertos = ra().puertosPon.filter(p => p.olt_id === olt.id).map(p => p.id)
        if (ra().vlans.some(v => v.puerto_pon_id !== null && puertos.includes(v.puerto_pon_id))) {
            return conflicto('olt_con_vlans', 'Algún puerto de la OLT tiene VLAN asignadas: quítalas antes')
        }
        bd.redAcceso.olts = ra().olts.filter(o => o.id !== olt.id)
        bd.redAcceso.puertosPon = ra().puertosPon.filter(p => p.olt_id !== olt.id)
        registrarAccion(solicitud, 'olts.eliminar', { tipo: 'olt', id: olt.id }, {})
        return { status: 204, cuerpo: undefined }
    }),

    'POST /api/v1/olts/:id/puertos-pon': conPermiso('olts.editar', (solicitud) => {
        const olt = filaDe(ra().olts, solicitud)
        if (!olt) {
            return noEncontrado('la OLT')
        }
        const cuerpo = cuerpoObjeto(solicitud)
        const identificador = texto(cuerpo.identificador)
        if (!identificador || !PON.test(identificador)) {
            return datosInvalidos([{ field: 'identificador', rule: 'regex', message: 'marco/slot/puerto, p. ej. 0/1/3' }])
        }
        if (ra().puertosPon.some(p => p.olt_id === olt.id && p.identificador === identificador)) {
            return conflicto('puerto_duplicado', `El puerto ${identificador} ya existe en ${olt.nombre}`, 'identificador')
        }
        const momento = ahora()
        const puerto: FilaPuertoPon = { id: siguienteId(ra().puertosPon), olt_id: olt.id, identificador, descripcion: texto(cuerpo.descripcion), version: 1, created_at: momento, updated_at: momento }
        ra().puertosPon.push(puerto)
        registrarAccion(solicitud, 'olts.editar', { tipo: 'olt', id: olt.id }, cuerpo)
        return { status: 201, cuerpo: vistaPuerto(puerto) }
    }),

    'PUT /api/v1/puertos-pon/:id': conPermiso('olts.editar', (solicitud) => {
        const puerto = filaDe(ra().puertosPon, solicitud)
        if (!puerto) {
            return noEncontrado('el puerto PON')
        }
        const cuerpo = cuerpoObjeto(solicitud)
        if (cuerpo.version !== puerto.version) {
            return versionCambiada()
        }
        const identificador = 'identificador' in cuerpo ? texto(cuerpo.identificador) : puerto.identificador
        if (!identificador || !PON.test(identificador)) {
            return datosInvalidos([{ field: 'identificador', rule: 'regex', message: 'marco/slot/puerto, p. ej. 0/1/3' }])
        }
        Object.assign(puerto, { identificador, descripcion: 'descripcion' in cuerpo ? texto(cuerpo.descripcion) : puerto.descripcion, version: puerto.version + 1, updated_at: ahora() })
        return { status: 200, cuerpo: vistaPuerto(puerto) }
    }),

    'DELETE /api/v1/puertos-pon/:id': conPermiso('olts.editar', (solicitud) => {
        const puerto = filaDe(ra().puertosPon, solicitud)
        if (!puerto) {
            return noEncontrado('el puerto PON')
        }
        if (ra().vlans.some(v => v.puerto_pon_id === puerto.id)) {
            return conflicto('puerto_con_vlans', 'El puerto tiene VLAN asignadas: quítalas antes')
        }
        bd.redAcceso.puertosPon = ra().puertosPon.filter(p => p.id !== puerto.id)
        return { status: 204, cuerpo: undefined }
    }),

    'GET /api/v1/routers/:id/red-acceso': conPermiso('red_acceso.ver', (solicitud) => {
        const routerId = routerDe(solicitud)
        return routerId ? { status: 200, cuerpo: vistaRedAcceso(routerId) } : noEncontrado('el router')
    }),

    'GET /api/v1/routers/:id/vlans': conPermiso('red_acceso.ver', (solicitud) => {
        const routerId = routerDe(solicitud)
        return routerId ? { status: 200, cuerpo: ra().vlans.filter(v => v.router_id === routerId).map(vistaVlan) } : noEncontrado('el router')
    }),

    'POST /api/v1/routers/:id/vlans': conPermiso('vlans.crear', (solicitud) => {
        const routerId = routerDe(solicitud)
        if (!routerId) {
            return noEncontrado('el router')
        }
        const cuerpo = cuerpoObjeto(solicitud)
        const vlanId = typeof cuerpo.vlan_id === 'number' ? cuerpo.vlan_id : Number.NaN
        const momento = ahora()
        const datos = {
            router_id: routerId,
            empresa_id: typeof cuerpo.empresa_id === 'number' ? cuerpo.empresa_id : null,
            interfaz_padre: texto(cuerpo.interfaz_padre) ?? '',
            vlan_id: vlanId,
            nombre: texto(cuerpo.nombre) ?? `vlan${vlanId}`,
            puerto_pon_id: typeof cuerpo.puerto_pon_id === 'number' ? cuerpo.puerto_pon_id : null,
            mtu: typeof cuerpo.mtu === 'number' ? cuerpo.mtu : null,
            estado: 'administrado' as const,
            ros_id: null,
            comment: null,
            descripcion: texto(cuerpo.descripcion),
        }
        const errores: Errores = []
        enteroEn(cuerpo, 'mtu', 576, 9216, errores)
        const error = revisarVlan(routerId, datos, null, errores)
        if (error) {
            return error
        }
        const id = siguienteId(ra().vlans)
        const vlan: FilaVlan = { ...datos, id, comment: `argosisp:vlan:${id}`, version: 1, created_at: momento, updated_at: momento }
        ra().vlans.push(vlan)
        registrarAccion(solicitud, 'vlans.crear', { tipo: 'vlan', id }, cuerpo)
        return { status: 201, cuerpo: vistaVlan(vlan) }
    }),

    'GET /api/v1/vlans/:id': conPermiso('red_acceso.ver', (solicitud) => {
        const vlan = filaDe(ra().vlans, solicitud)
        return vlan ? { status: 200, cuerpo: vistaVlan(vlan) } : noEncontrado('la VLAN')
    }),

    'PUT /api/v1/vlans/:id': conPermiso('vlans.editar', (solicitud) => {
        const vlan = filaDe(ra().vlans, solicitud)
        if (!vlan) {
            return noEncontrado('la VLAN')
        }
        const cuerpo = cuerpoObjeto(solicitud)
        if (cuerpo.version !== vlan.version) {
            return versionCambiada()
        }
        if (vlan.estado === 'adoptado') {
            const error = soloLectura(cuerpo, RUTEROS_VLAN, vlan)
            if (error) {
                return error
            }
        }
        const datos = {
            ...vlan,
            interfaz_padre: texto(cuerpo.interfaz_padre) ?? vlan.interfaz_padre,
            vlan_id: typeof cuerpo.vlan_id === 'number' ? cuerpo.vlan_id : vlan.vlan_id,
            nombre: texto(cuerpo.nombre) ?? vlan.nombre,
            puerto_pon_id: 'puerto_pon_id' in cuerpo ? (typeof cuerpo.puerto_pon_id === 'number' ? cuerpo.puerto_pon_id : null) : vlan.puerto_pon_id,
            mtu: 'mtu' in cuerpo ? (typeof cuerpo.mtu === 'number' ? cuerpo.mtu : null) : vlan.mtu,
            descripcion: 'descripcion' in cuerpo ? texto(cuerpo.descripcion) : vlan.descripcion,
        }
        const errores: Errores = []
        enteroEn(cuerpo, 'mtu', 576, 9216, errores)
        const error = revisarVlan(vlan.router_id, datos, vlan.id, errores)
        if (error) {
            return error
        }
        Object.assign(vlan, datos, { version: vlan.version + 1, updated_at: ahora() })
        // Renombrar la VLAN renombra la interfaz de su servidor.
        for (const servidor of ra().servidoresPppoe.filter(s => s.vlan_id === vlan.id)) {
            servidor.interfaz = vlan.nombre
        }
        registrarAccion(solicitud, 'vlans.editar', { tipo: 'vlan', id: vlan.id }, cuerpo)
        return { status: 200, cuerpo: vistaVlan(vlan) }
    }),

    'DELETE /api/v1/vlans/:id': conPermiso('vlans.eliminar', (solicitud) => {
        const vlan = filaDe(ra().vlans, solicitud)
        if (!vlan) {
            return noEncontrado('la VLAN')
        }
        if (ra().servidoresPppoe.some(s => s.vlan_id === vlan.id)) {
            return conflicto('vlan_con_servidor', `La VLAN ${vlan.vlan_id} tiene servidor PPPoE: bórralo antes`)
        }
        bd.redAcceso.vlans = ra().vlans.filter(v => v.id !== vlan.id)
        registrarAccion(solicitud, 'vlans.eliminar', { tipo: 'vlan', id: vlan.id }, {})
        return { status: 204, cuerpo: undefined }
    }),

    'GET /api/v1/routers/:id/servidores-pppoe': conPermiso('red_acceso.ver', (solicitud) => {
        const routerId = routerDe(solicitud)
        return routerId ? { status: 200, cuerpo: ra().servidoresPppoe.filter(s => s.router_id === routerId).map(vistaServidor) } : noEncontrado('el router')
    }),

    'POST /api/v1/routers/:id/servidores-pppoe': conPermiso('servidores_pppoe.crear', (solicitud) => {
        const routerId = routerDe(solicitud)
        if (!routerId) {
            return noEncontrado('el router')
        }
        const cuerpo = cuerpoObjeto(solicitud)
        const servidor = servidorDeCuerpo(cuerpo, null, routerId)
        if (Array.isArray(servidor)) {
            return datosInvalidos(servidor)
        }
        const error = revisarServidor(routerId, servidor, null)
        if (error) {
            return error
        }
        servidor.comment = `argosisp:pppoe:${servidor.id}`
        ra().servidoresPppoe.push(servidor)
        registrarAccion(solicitud, 'servidores_pppoe.crear', { tipo: 'servidor_pppoe', id: servidor.id }, cuerpo)
        return { status: 201, cuerpo: vistaServidor(servidor) }
    }),

    'GET /api/v1/servidores-pppoe/:id': conPermiso('red_acceso.ver', (solicitud) => {
        const servidor = filaDe(ra().servidoresPppoe, solicitud)
        return servidor ? { status: 200, cuerpo: vistaServidor(servidor) } : noEncontrado('el servidor PPPoE')
    }),

    'PUT /api/v1/servidores-pppoe/:id': conPermiso('servidores_pppoe.editar', (solicitud) => {
        const actual = filaDe(ra().servidoresPppoe, solicitud)
        if (!actual) {
            return noEncontrado('el servidor PPPoE')
        }
        const cuerpo = cuerpoObjeto(solicitud)
        if (cuerpo.version !== actual.version) {
            return versionCambiada()
        }
        if (actual.estado === 'adoptado') {
            const error = soloLectura(cuerpo, RUTEROS_SERVIDOR, actual)
            if (error) {
                return error
            }
        }
        const servidor = servidorDeCuerpo(cuerpo, actual, actual.router_id)
        if (Array.isArray(servidor)) {
            return datosInvalidos(servidor)
        }
        const error = revisarServidor(actual.router_id, servidor, actual.id)
        if (error) {
            return error
        }
        Object.assign(actual, servidor)
        for (const servicio of bd.servicios.filter(s => s.servidor_pppoe_id === actual.id)) {
            servicio.local_address = localAddressServicio(servicio)
        }
        registrarAccion(solicitud, 'servidores_pppoe.editar', { tipo: 'servidor_pppoe', id: actual.id }, cuerpo)
        return { status: 200, cuerpo: vistaServidor(actual) }
    }),

    'DELETE /api/v1/servidores-pppoe/:id': conPermiso('servidores_pppoe.eliminar', (solicitud) => {
        const servidor = filaDe(ra().servidoresPppoe, solicitud)
        if (!servidor) {
            return noEncontrado('el servidor PPPoE')
        }
        const servicios = bd.servicios.filter(s => s.servidor_pppoe_id === servidor.id && s.estado !== 'retirado').length
        if (servicios) {
            return conflicto('servidor_con_servicios', `El servidor tiene ${servicios} ${servicios === 1 ? 'servicio' : 'servicios'}: muévelos a otro servidor antes`)
        }
        bd.redAcceso.servidoresPppoe = ra().servidoresPppoe.filter(s => s.id !== servidor.id)
        registrarAccion(solicitud, 'servidores_pppoe.eliminar', { tipo: 'servidor_pppoe', id: servidor.id }, {})
        return { status: 204, cuerpo: undefined }
    }),

    /**
     * Como `leerInventarioAcceso` de A2: sin credenciales de la API o con el router caído, 502
     * `router_no_responde`; si no, lo que «lee» del router (en el RB-Centro hay una VLAN y un servidor
     * nuevos y una diferencia de MTU; en los demás, lo mismo que Argos tiene registrado).
     */
    'GET /api/v1/routers/:id/red-acceso/descubrir': conPermiso('red_acceso.descubrir', (solicitud) => {
        const routerId = routerDe(solicitud)
        if (!routerId) {
            return noEncontrado('el router')
        }
        const leido = inventarioDe(routerId)
        return 'status' in leido ? leido : { status: 200, cuerpo: leido }
    }),

    /** Relee el inventario: toma los valores de RouterOS por `ros_id` y crea las filas `adoptado`. */
    'POST /api/v1/routers/:id/red-acceso/adoptar': conPermiso('red_acceso.adoptar', conIdempotencia((solicitud) => {
        const routerId = routerDe(solicitud)
        if (!routerId) {
            return noEncontrado('el router')
        }
        const leido = inventarioDe(routerId)
        if ('status' in leido) {
            return leido
        }
        const cuerpo = cuerpoObjeto(solicitud)
        const pedidasVlans = (Array.isArray(cuerpo.vlans) ? cuerpo.vlans : []) as Record<string, unknown>[]
        const pedidosServidores = (Array.isArray(cuerpo.servidores_pppoe) ? cuerpo.servidores_pppoe : []) as Record<string, unknown>[]
        const momento = ahora()
        const resultado: Schema<'ResultadoAdopcion'> = { vlans: [], servidores_pppoe: [] }
        const adoptarVlan = (rosId: string, pedido: Record<string, unknown>): FilaVlan | RespuestaFixture => {
            const leida = leido.vlans.find(v => v.ros_id === rosId)
            if (!leida) {
                return conflicto('inventario_cambio', `El router ya no tiene la VLAN ${rosId}: vuelve a detectar`)
            }
            const ya = ra().vlans.find(v => v.router_id === routerId && v.ros_id === rosId)
            if (ya) {
                return ya
            }
            const id = siguienteId(ra().vlans)
            const fila: FilaVlan = { id, router_id: routerId, empresa_id: typeof pedido.empresa_id === 'number' ? pedido.empresa_id : null, interfaz_padre: leida.interfaz_padre, vlan_id: leida.vlan_id, nombre: leida.nombre, puerto_pon_id: typeof pedido.puerto_pon_id === 'number' ? pedido.puerto_pon_id : null, mtu: leida.mtu, estado: 'adoptado', ros_id: rosId, comment: leida.comment, descripcion: texto(pedido.descripcion), version: 1, created_at: momento, updated_at: momento }
            ra().vlans.push(fila)
            leida.argos = { estado: 'adoptado', id, diferencias: [] }
            return fila
        }
        for (const pedida of pedidasVlans) {
            const rosId = texto(pedida.ros_id) ?? ''
            if (ra().vlans.some(v => v.router_id === routerId && v.ros_id === rosId)) {
                return conflicto('ya_registrado', `La VLAN ${rosId} ya está registrada en Argos`)
            }
            const fila = adoptarVlan(rosId, pedida)
            if ('status' in fila) {
                return fila
            }
            resultado.vlans.push(vistaVlan(fila))
        }
        for (const pedido of pedidosServidores) {
            const rosId = texto(pedido.ros_id) ?? ''
            const leido2 = leido.servidores_pppoe.find(s => s.ros_id === rosId)
            if (!leido2) {
                return conflicto('inventario_cambio', `El router ya no tiene el servidor ${rosId}: vuelve a detectar`)
            }
            if (ra().servidoresPppoe.some(s => s.router_id === routerId && s.ros_id === rosId)) {
                return conflicto('ya_registrado', `El servidor ${leido2.service_name} ya está registrado en Argos`)
            }
            // La VLAN del servidor que aún no está en Argos se adopta sola con él.
            const vlanLeida = leido.vlans.find(v => v.nombre === leido2.interfaz)
            let vlan = vlanLeida ? ra().vlans.find(v => v.router_id === routerId && v.ros_id === vlanLeida.ros_id) : undefined
            if (vlanLeida && !vlan) {
                const fila = adoptarVlan(vlanLeida.ros_id, {})
                if ('status' in fila) {
                    return fila
                }
                vlan = fila
                resultado.vlans.push(vistaVlan(fila))
            }
            const id = siguienteId(ra().servidoresPppoe)
            const fila: FilaServidorPppoe = {
                id,
                router_id: routerId,
                empresa_id: typeof pedido.empresa_id === 'number' ? pedido.empresa_id : null,
                nombre: texto(pedido.nombre) ?? leido2.service_name,
                vlan_id: vlan?.id ?? null,
                interfaz: leido2.interfaz,
                service_name: leido2.service_name,
                red_ipv4_id: typeof pedido.red_ipv4_id === 'number' ? pedido.red_ipv4_id : null,
                ipv6_pool_enlace_id: typeof pedido.ipv6_pool_enlace_id === 'number' ? pedido.ipv6_pool_enlace_id : null,
                ipv6_pool_delegacion_id: typeof pedido.ipv6_pool_delegacion_id === 'number' ? pedido.ipv6_pool_delegacion_id : null,
                perfil_base: leido2.perfil,
                max_mtu: leido2.max_mtu ?? SERVIDOR_POR_DEFECTO.max_mtu,
                max_mru: leido2.max_mru ?? SERVIDOR_POR_DEFECTO.max_mru,
                mrru: leido2.mrru,
                autenticacion: leido2.autenticacion.filter((a): a is typeof AUTENTICACIONES[number] => AUTENTICACIONES.includes(a as typeof AUTENTICACIONES[number])),
                keepalive_timeout: leido2.keepalive_timeout ?? SERVIDOR_POR_DEFECTO.keepalive_timeout,
                una_sesion_por_host: leido2.una_sesion_por_host,
                max_sesiones: leido2.max_sesiones,
                estado: 'adoptado',
                ros_id: rosId,
                comment: leido2.comment,
                activo: !leido2.deshabilitado,
                descripcion: texto(pedido.descripcion),
                version: 1,
                created_at: momento,
                updated_at: momento,
            }
            const error = revisarServidor(routerId, fila, null)
            if (error) {
                return error
            }
            ra().servidoresPppoe.push(fila)
            leido2.argos = { estado: 'adoptado', id, diferencias: [] }
            resultado.servidores_pppoe.push(vistaServidor(fila))
        }
        registrarAccion(solicitud, 'red_acceso.adoptar', { tipo: 'router', id: routerId }, cuerpo)
        return { status: 200, cuerpo: resultado }
    })),

    'GET /api/v1/routers/:id/vista-previa-unificar-velocidad': conPermiso('routers.ver', (solicitud) => {
        const router = bd.routers.find(r => r.id === idDe(solicitud))
        if (!router) {
            return noEncontrado('el router')
        }
        const reconectar = solicitud.query.get('reconectar') === 'true'
        const excepciones = excepcionesDelRouter(router.id)
        const sesiones = (planId: number) => bd.sesiones.filter(s => s.fin === null && bd.servicios.some(x => x.id === s.servicio_id && x.router_id === router.id && x.plan_id === planId)).length
        const serviciosDe = (planId: number) => bd.servicios.filter(s => s.router_id === router.id && s.plan_id === planId && s.estado !== 'retirado').length
        const abiertas = excepciones.reduce((total, e) => total + sesiones(e.plan_id), 0)
        const vista: Schema<'VistaPreviaUnificarVelocidad'> = {
            router_id: router.id,
            router_version: router.version,
            planes: excepciones.map((e) => {
                const excepcion = e.estrategia_velocidad ?? {}
                // Estrategia efectiva hoy del plan (router capa por capa sobrescrito por la excepción).
                const de = {
                    pppoe: efectiva(router.estrategia_velocidad, excepcion, 'pppoe'),
                    ip_estatica: efectiva(router.estrategia_velocidad, excepcion, 'ip_estatica'),
                    dhcp_fija: efectiva(router.estrategia_velocidad, excepcion, 'dhcp_fija'),
                }
                const capas = (['aplicacion', 'padre', 'tipo_cola', 'extras'] as const).filter(capa => Object.values(excepcion).some(p => p && p[capa] !== undefined && p[capa] !== null))
                return { plan_id: e.plan_id, nombre: bd.planes.find(p => p.id === e.plan_id)?.nombre ?? `Plan ${e.plan_id}`, implementacion_id: e.id, version: e.version, excepcion, capas, de, a: structuredClone(router.estrategia_velocidad), servicios: serviciosDe(e.plan_id), sesiones_abiertas: sesiones(e.plan_id) }
            }),
            vista_previa: {
                router_id: router.id,
                valida: true,
                errores: [],
                advertencias: [],
                de: structuredClone(router.estrategia_velocidad),
                a: structuredClone(router.estrategia_velocidad),
                planes: excepciones.map(e => ({ plan_id: e.plan_id, de: e.estrategia_velocidad, a: null })),
                crear: [],
                actualizar: excepciones.map(e => ({ ruta: '/ppp/profile', clave: `plan-${e.plan_id}`, nombre: `plan-${e.plan_id}` })),
                borrar: [],
                menus: excepciones.length ? [{ ruta: '/ppp/profile', crear: 0, actualizar: excepciones.length, borrar: 0 }] : [],
                servicios: excepciones.reduce((total, e) => total + serviciosDe(e.plan_id), 0),
                lotes: Math.max(1, Math.ceil(excepciones.reduce((total, e) => total + serviciosDe(e.plan_id), 0) / 50)),
                sesiones_coa: 0,
                sesiones_conservan: reconectar ? 0 : abiertas,
                sesiones_a_desconectar: reconectar ? abiertas : 0,
                orden: ['preparar', 'lotes', 'terminar'],
            },
        }
        return { status: 200, cuerpo: vista }
    }),

    'POST /api/v1/routers/:id/unificar-control-velocidad': conPermiso('routers.unificar_control_velocidad', conIdempotencia((solicitud) => {
        const router = bd.routers.find(r => r.id === idDe(solicitud))
        if (!router) {
            return noEncontrado('el router')
        }
        const cuerpo = cuerpoObjeto(solicitud)
        const pedidos = (Array.isArray(cuerpo.planes) ? cuerpo.planes : []).filter((p): p is number => typeof p === 'number')
        const actuales = excepcionesDelRouter(router.id).map(e => e.plan_id).sort((a, b) => a - b)
        const vistos = [...new Set(pedidos)].sort((a, b) => a - b)
        if (JSON.stringify(actuales) !== JSON.stringify(vistos)) {
            return conflicto('excepciones_cambiaron', `Las excepciones del router cambiaron (hoy: ${actuales.join(', ') || 'ninguna'}): vuelve a pedir la vista previa`)
        }
        for (const implementacion of excepcionesDelRouter(router.id)) {
            implementacion.estrategia_velocidad = null
            implementacion.version += 1
            implementacion.updated_at = ahora()
        }
        registrarAccion(solicitud, 'routers.unificar_control_velocidad', { tipo: 'router', id: router.id }, cuerpo)
        const resultado: Schema<'ResultadoUnificarVelocidad'> = { router_id: router.id, planes: actuales }
        return { status: 200, cuerpo: resultado }
    })),
}
