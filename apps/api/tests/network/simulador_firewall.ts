import { isIPv4, isIPv6 } from 'node:net'
import type { ObjetoRouterOS } from '#network/routeros/cliente'
import type { RouterOSFalso } from '#network/routeros/falso'

/**
 * Recorrido de un paquete NUEVO por las tablas de un `RouterOSFalso`, como lo haría RouterOS 7:
 * primero `nat` (cadena `dstnat`), después `filter` (cadena `forward`), con `jump`, `return`, address-
 * lists (IP, CIDR o FQDN resuelto por `dns`) y listas de interfaces. Sirve para reproducir en pruebas
 * qué le pasa a cada consulta del cliente suspendido (DNS, HTTP de la sonda, HTTPS, DoT) con las reglas
 * que Argos dejó en el router. Una propiedad de coincidencia que no conoce hace fallar la prueba.
 */

export interface Paquete {
    familia: 4 | 6
    src: string
    dst: string
    protocol: 'tcp' | 'udp' | 'icmp' | 'icmpv6'
    dport?: number
    /** Interfaz de entrada (p. ej. `<pppoe-cliente>`) */
    interfaz?: string
    /** Listas de interfaces de la interfaz (el perfil PPP `suspendido` la mete en `suspendidos`) */
    listasInterfaz?: string[]
    /** Address-lists dinámicas (las que pone el perfil PPP o `Mikrotik-Address-List`) */
    listasDinamicas?: string[]
}

export interface Recorrido {
    /** Destino tras el dst-nat (null si no hubo NAT) */
    nat: { dst: string; dport: number | undefined; regla: string } | null
    /** Veredicto del filtro de forward */
    filtro: { accion: 'accept' | 'drop' | 'reject'; rechazo?: string; regla: string | null }
}

const IGNORADAS = new Set([
    '.id',
    'chain',
    'comment',
    'disabled',
    'dynamic',
    'invalid',
    'action',
    'jump-target',
    'to-addresses',
    'to-address',
    'to-ports',
    'reject-with',
    'log',
    'log-prefix',
    'bytes',
    'packets',
    'passthrough',
])

function aBig(ip: string): { bits: number; valor: bigint } {
    if (isIPv4(ip)) {
        return { bits: 32, valor: ip.split('.').reduce((a, o) => (a << 8n) | BigInt(Number(o)), 0n) }
    }
    const [cabeza, cola] = ip.includes('::') ? ip.split('::') : [ip, '']
    const izq = cabeza ? cabeza.split(':') : []
    const der = cola ? cola.split(':') : []
    const grupos = [...izq, ...Array(8 - izq.length - der.length).fill('0'), ...der]
    return { bits: 128, valor: grupos.reduce((a, g) => (a << 16n) | BigInt(Number.parseInt(g, 16)), 0n) }
}

export function enRed(ip: string, red: string): boolean {
    const [base, largo] = red.split('/')
    if (!base || (!isIPv4(base) && !isIPv6(base))) return false
    if (isIPv4(ip) !== isIPv4(base)) return false
    const a = aBig(ip)
    const b = aBig(base)
    const n = largo === undefined ? a.bits : Number(largo)
    const desplazar = BigInt(a.bits - n)
    return a.valor >> desplazar === b.valor >> desplazar
}

export class SimuladorFirewall {
    constructor(
        private readonly router: RouterOSFalso,
        /** FQDN de las address-lists → IPs (lo que resuelve el router) */
        private readonly dns: Record<string, string[]> = {},
    ) {}

    #tabla(familia: 4 | 6, menu: 'filter' | 'nat' | 'address-list'): ObjetoRouterOS[] {
        const ruta = `/${familia === 4 ? 'ip' : 'ipv6'}/firewall/${menu}` as const
        return this.router.tabla(ruta).filter((o) => o.disabled !== 'true')
    }

    enLista(familia: 4 | 6, ip: string, lista: string, p: Paquete): boolean {
        if (p.familia === familia && p.src === ip && (p.listasDinamicas ?? []).includes(lista)) return true
        return this.#tabla(familia, 'address-list').some((e) => {
            if (e.list !== lista) return false
            const address = e.address ?? ''
            const ips =
                isIPv4(address.split('/')[0]!) || isIPv6(address.split('/')[0]!)
                    ? [address]
                    : (this.dns[address] ?? [])
            return ips.some((red) => enRed(ip, red))
        })
    }

    #coincide(regla: ObjetoRouterOS, p: Paquete, dst: string, dport: number | undefined): boolean {
        for (const [clave, valor] of Object.entries(regla)) {
            if (IGNORADAS.has(clave) || valor === undefined || valor === '') continue
            const negar = valor.startsWith('!')
            const v = negar ? valor.slice(1) : valor
            let ok: boolean
            switch (clave) {
                case 'protocol':
                    ok = p.protocol === v
                    break
                case 'dst-port':
                    ok = dport !== undefined && v.split(',').map(Number).includes(dport)
                    break
                case 'src-address':
                    ok = enRed(p.src, v)
                    break
                case 'dst-address':
                    ok = enRed(dst, v)
                    break
                case 'src-address-list':
                    ok = this.enLista(p.familia, p.src, v, p)
                    break
                case 'dst-address-list':
                    ok = this.enLista(p.familia, dst, v, p)
                    break
                case 'in-interface':
                    ok = p.interfaz === v
                    break
                case 'in-interface-list':
                    ok = (p.listasInterfaz ?? []).includes(v)
                    break
                case 'connection-state':
                    // Paquete nuevo: solo coincide si la regla incluye `new`.
                    ok = v.split(',').includes('new')
                    break
                default:
                    throw new Error(`simulador: propiedad de coincidencia desconocida ${clave}=${valor}`)
            }
            if (negar) ok = !ok
            if (!ok) return false
        }
        return true
    }

    /** Recorre una cadena; devuelve la regla terminal o null (fin de la cadena / return). */
    #cadena(
        tabla: ObjetoRouterOS[],
        chain: string,
        p: Paquete,
        estado: { dst: string; dport: number | undefined },
        profundidad = 0,
    ): ObjetoRouterOS | null {
        if (profundidad > 16) throw new Error('simulador: saltos en bucle')
        for (const regla of tabla.filter((o) => o.chain === chain)) {
            if (!this.#coincide(regla, p, estado.dst, estado.dport)) continue
            switch (regla.action) {
                case 'jump': {
                    const fin = this.#cadena(tabla, regla['jump-target']!, p, estado, profundidad + 1)
                    if (fin) return fin
                    continue
                }
                case 'return':
                    return null
                case 'passthrough':
                case 'log':
                    continue
                default:
                    return regla
            }
        }
        return null
    }

    recorrer(p: Paquete): Recorrido {
        const estado = { dst: p.dst, dport: p.dport }
        let nat: Recorrido['nat'] = null
        const reglaNat = this.#cadena(this.#tabla(p.familia, 'nat'), 'dstnat', p, estado)
        if (reglaNat?.action === 'dst-nat') {
            const destino = (reglaNat['to-addresses'] ?? reglaNat['to-address'] ?? '').replace(
                /\/128$|\/32$/,
                '',
            )
            estado.dst = destino
            if (reglaNat['to-ports']) estado.dport = Number(reglaNat['to-ports'])
            nat = { dst: estado.dst, dport: estado.dport, regla: reglaNat.comment ?? '' }
        } else if (reglaNat && reglaNat.action !== 'accept') {
            throw new Error(`simulador: acción de NAT no soportada ${reglaNat.action}`)
        }
        const regla = this.#cadena(this.#tabla(p.familia, 'filter'), 'forward', p, estado)
        if (!regla) return { nat, filtro: { accion: 'accept', regla: null } }
        const accion = regla.action === 'drop' || regla.action === 'reject' ? regla.action : 'accept'
        return {
            nat,
            filtro: {
                accion,
                ...(accion === 'reject'
                    ? { rechazo: regla['reject-with'] ?? 'icmp-network-unreachable' }
                    : {}),
                regla: regla.comment ?? null,
            },
        }
    }
}
