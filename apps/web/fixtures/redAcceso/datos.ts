import type { Schema } from '@argosisp/contracts'

/**
 * Red de acceso sembrada (`contratos/red-acceso.md`, A1), con los mismos valores por defecto que la
 * API. Se guardan las filas; las vistas (`puertos`, `vlans` del puerto, `puerto_pon`, `vlan`,
 * `perfil`, `local_address`, `servicios`) se calculan en `rutas.ts` como lo hace la API.
 *
 * - OLT Centro con dos puertos PON.
 * - RB-Centro (router 1): VLAN 101 en el puerto 0/1/1 con el servidor «PPPoE Centro» (administrado,
 *   red 100.64.10.0/24 con gateway 100.64.10.1): un solo servidor, el alta lo autoelige.
 * - CCR-Mixco (router 2): VLAN 201 y 202 en el puerto 0/1/2 (adoptadas) con un servidor cada una
 *   sobre la red 100.64.20.0/23: dos candidatos, el alta pide elegir (422 `servidor_pppoe_requerido`).
 * - «Detectar en el router» (lector de A2): en el RB-Centro trae una VLAN y un servidor nuevos y
 *   una diferencia de MTU; en los demás, lo que Argos ya tiene. Sin API o caído: 502.
 */

export type FilaOlt = Omit<Schema<'Olt'>, 'puertos'>
export type FilaPuertoPon = Omit<Schema<'PuertoPon'>, 'vlans'>
export type FilaVlan = Omit<Schema<'Vlan'>, 'puerto_pon'>
export type FilaServidorPppoe = Omit<Schema<'ServidorPppoe'>, 'vlan' | 'perfil' | 'local_address' | 'local_address_derivado' | 'servicios'>

export interface RedAccesoFixtures {
    olts: FilaOlt[]
    puertosPon: FilaPuertoPon[]
    vlans: FilaVlan[]
    servidoresPppoe: FilaServidorPppoe[]
    /** Lo que «lee» el router en `descubrir`; sin entrada, lo mismo que Argos tiene registrado. */
    descubrimientos: Record<number, Schema<'DescubrimientoRedAcceso'>>
    /** Cambios hechos a mano en el router desde la vista previa de «Tomar control» (`<entidad>:<id>`): cambian la huella. */
    cambiosEnRouter: Record<string, number>
}

const creado = '2026-10-20T15:00:00.000Z'
const meta = { version: 1, created_at: creado, updated_at: creado }

/** Valores por defecto de un servidor PPPoE (los de la API y RouterOS). */
export const SERVIDOR_POR_DEFECTO = {
    perfil_base: 'default',
    max_mtu: 1480,
    max_mru: 1480,
    mrru: null,
    autenticacion: ['pap', 'chap', 'mschap1', 'mschap2'],
    keepalive_timeout: 10,
    una_sesion_por_host: true,
    max_sesiones: null,
} satisfies Partial<FilaServidorPppoe>

export function redAccesoInicial(): RedAccesoFixtures {
    return {
        olts: [
            { id: 1, nombre: 'OLT Centro', marca: 'Huawei', modelo: 'MA5800-X2', empresa_id: null, descripcion: null, activo: true, ...meta },
        ],
        puertosPon: [
            { id: 1, olt_id: 1, identificador: '0/1/1', descripcion: 'Zona 1', ...meta },
            { id: 2, olt_id: 1, identificador: '0/1/2', descripcion: 'Mixco', ...meta },
            { id: 3, olt_id: 1, identificador: '0/1/3', descripcion: null, ...meta },
        ],
        vlans: [
            { id: 1, router_id: 1, empresa_id: null, interfaz_padre: 'sfp-sfpplus1', vlan_id: 101, nombre: 'vlan101', puerto_pon_id: 1, mtu: null, estado: 'administrado', ros_id: '*1A', comment: 'argosisp:vlan:1', descripcion: null, ...meta },
            { id: 2, router_id: 2, empresa_id: null, interfaz_padre: 'sfp1', vlan_id: 201, nombre: 'vlan201', puerto_pon_id: 2, mtu: null, estado: 'adoptado', ros_id: '*2B', comment: null, descripcion: null, ...meta },
            { id: 3, router_id: 2, empresa_id: null, interfaz_padre: 'sfp1', vlan_id: 202, nombre: 'vlan202', puerto_pon_id: 2, mtu: null, estado: 'adoptado', ros_id: '*2C', comment: null, descripcion: null, ...meta },
        ],
        servidoresPppoe: [
            { id: 1, router_id: 1, empresa_id: null, nombre: 'PPPoE Centro', vlan_id: 1, interfaz: 'vlan101', service_name: 'PPPoE Centro', red_ipv4_id: 1, ipv6_pool_enlace_id: null, ipv6_pool_delegacion_id: null, ...SERVIDOR_POR_DEFECTO, estado: 'administrado', ros_id: '*9', comment: 'argosisp:pppoe:1', activo: true, descripcion: null, ...meta },
            { id: 2, router_id: 2, empresa_id: null, nombre: 'fibra-201', vlan_id: 2, interfaz: 'vlan201', service_name: 'fibra-201', red_ipv4_id: 3, ipv6_pool_enlace_id: null, ipv6_pool_delegacion_id: null, ...SERVIDOR_POR_DEFECTO, perfil_base: 'pppoe-mixco', max_mtu: 1492, max_mru: 1492, estado: 'adoptado', ros_id: '*3D', comment: null, activo: true, descripcion: null, ...meta },
            { id: 3, router_id: 2, empresa_id: null, nombre: 'fibra-202', vlan_id: 3, interfaz: 'vlan202', service_name: 'fibra-202', red_ipv4_id: 3, ipv6_pool_enlace_id: null, ipv6_pool_delegacion_id: null, ...SERVIDOR_POR_DEFECTO, perfil_base: 'pppoe-mixco', max_mtu: 1492, max_mru: 1492, estado: 'adoptado', ros_id: '*3E', comment: null, activo: true, descripcion: null, ...meta },
        ],
        cambiosEnRouter: {},
        descubrimientos: {
            1: {
                router_id: 1,
                leido_en: '2026-11-05T15:30:00.000Z',
                interfaces: [
                    { nombre: 'ether1', tipo: 'ether', deshabilitada: false },
                    { nombre: 'sfp-sfpplus1', tipo: 'ether', deshabilitada: false },
                    { nombre: 'vlan101', tipo: 'vlan', deshabilitada: false },
                    { nombre: 'vlan150', tipo: 'vlan', deshabilitada: false },
                ],
                vlans: [
                    { ros_id: '*1A', nombre: 'vlan101', interfaz_padre: 'sfp-sfpplus1', vlan_id: 101, mtu: 1500, deshabilitada: false, comment: 'argosisp:vlan:1', argos: { estado: 'administrado', id: 1, diferencias: [] } },
                    { ros_id: '*1F', nombre: 'vlan150', interfaz_padre: 'sfp-sfpplus1', vlan_id: 150, mtu: 1500, deshabilitada: false, comment: 'clientes edificio', argos: { estado: 'nuevo', id: null, diferencias: [] } },
                ],
                servidores_pppoe: [
                    { ros_id: '*9', service_name: 'PPPoE Centro', interfaz: 'vlan101', perfil: 'argosisp-pppoe-1', max_mtu: 1492, max_mru: 1480, mrru: null, autenticacion: ['pap', 'chap', 'mschap1', 'mschap2'], keepalive_timeout: 10, una_sesion_por_host: true, max_sesiones: null, deshabilitado: false, comment: 'argosisp:pppoe:1', red_ipv4_sugerida_id: 1, argos: { estado: 'administrado', id: 1, diferencias: [{ campo: 'max_mtu', argos: 1480, router: 1492 }] } },
                    { ros_id: '*C', service_name: 'edificio-150', interfaz: 'vlan150', perfil: 'perfil-150', max_mtu: 1480, max_mru: 1480, mrru: null, autenticacion: ['chap', 'mschap2'], keepalive_timeout: 30, una_sesion_por_host: true, max_sesiones: null, deshabilitado: false, comment: null, red_ipv4_sugerida_id: 1, argos: { estado: 'nuevo', id: null, diferencias: [] } },
                ],
                perfiles: [
                    { ros_id: '*0', nombre: 'default', local_address: null, remote_address: null, comment: null },
                    { ros_id: '*7', nombre: 'argosisp-pppoe-1', local_address: '100.64.10.1', remote_address: null, comment: 'argosisp:perfil-pppoe:1' },
                    { ros_id: '*8', nombre: 'perfil-150', local_address: '100.64.10.1', remote_address: 'pool-edificio', comment: null },
                ],
                pools_ipv4: [{ ros_id: '*2', nombre: 'pool-edificio', rangos: '100.64.11.10-100.64.11.250' }],
                pools_ipv6: [],
                sin_router: [],
            },
        },
    }
}

/** Primera IP utilizable de un CIDR (en /31 y /32 la dirección de red): el gateway derivado. */
export function primeraIpUtilizable(cidr: string): string {
    const [base = '0.0.0.0', largo = '32'] = cidr.split('/')
    const tamano = 2 ** (32 - Number(largo))
    const inicio = Math.floor(base.split('.').reduce((n, o) => n * 256 + Number(o), 0) / tamano) * tamano
    const n = Number(largo) >= 31 ? inicio : inicio + 1
    return [24, 16, 8, 0].map(bits => Math.floor(n / 2 ** bits) % 256).join('.')
}

/**
 * Como la API tras sembrar: cada PPPoE de un router con servidores queda en uno de ellos y su
 * `local_address` es el gateway efectivo de la red de su IPv4 (o el de su servidor): el gateway o,
 * sin él, la primera IP utilizable (`local_address_derivado`). Los demás, null.
 */
export function sembrarServidoresServicios(servicios: Schema<'Servicio'>[], red: RedAccesoFixtures, redes: Schema<'RedIpv4'>[]): void {
    for (const servicio of servicios) {
        const candidatos = red.servidoresPppoe.filter(s => s.router_id === servicio.router_id)
        const pppoe = (servicio.tipo_conexion ?? 'pppoe') === 'pppoe'
        const servidor = pppoe && candidatos.length ? candidatos[servicio.id % candidatos.length] : undefined
        servicio.servidor_pppoe_id = servidor?.id ?? null
        const deSuRed = redes.find(r => r.router_id === servicio.router_id && servicio.ipv4 && r.cidr.split('.').slice(0, 3).join('.') === servicio.ipv4.split('.').slice(0, 3).join('.'))
            ?? redes.find(r => r.id === servidor?.red_ipv4_id)
        servicio.local_address = pppoe && deSuRed ? (deSuRed.gateway ?? primeraIpUtilizable(deSuRed.cidr)) : null
        servicio.local_address_derivado = pppoe && Boolean(deSuRed) && !deSuRed?.gateway
    }
}
