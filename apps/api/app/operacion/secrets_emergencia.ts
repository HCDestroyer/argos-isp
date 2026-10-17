import type { RegistroAaa } from '#core/aaa'

/**
 * `.rsc` de **secrets PPPoE de emergencia** para un router, para cuando `aaa` (RADIUS) no
 * responde (`docs/runbooks/aaa-caido.md`, paso 3). Con `/ppp aaa use-radius=yes`, RouterOS busca
 * primero en `/ppp secret`: con estos secrets los clientes entran sin RADIUS.
 *
 * Sale de los mismos registros que `aaa` entrega (`RegistroAaa` de A1), así que cada cliente
 * entra como entraría por RADIUS en lo que un secret permite:
 *
 * - `activo` / `limitado`: perfil `argosisp-emergencia-plan-<id>[-limitado]` copiado del perfil
 *   del plan en el router (o `plan-<id>` con reuso > 1 en modo `simple`, o el perfil base) con el
 *   `rate-limit` de `aaa` (`plan.rate_limit` / `rate_limit_limitado`) y, si el plan usa pools,
 *   `remote-address` y los pools IPv6 en el perfil.
 * - `suspendido`: el perfil de corte del router (`suspendido` en `lab.rsc`: rate-limit mínimo y
 *   `address-list=suspendidos`), igual que `Mikrotik-Group = suspendido`.
 * - `retirado`: no se exporta.
 * - IPv4 fija → `remote-address`; /64 de enlace fijo (`radius_servicio`) → `remote-ipv6-prefix`.
 *   El /56 delegado fijo no tiene atributo en `/ppp secret`: con secrets, el cliente recibe uno
 *   del `dhcpv6-pd-pool` del perfil (otro prefijo mientras dure la emergencia).
 *
 * Todo lleva `comment="argosisp-emergencia"`: el archivo empieza borrando los de una importación
 * anterior y el runbook los retira con un `remove [find comment=…]`. Las contraseñas solo van en
 * el texto devuelto (el comando lo escribe en un archivo 0600); el resumen no las lleva.
 */

export const COMENTARIO = 'argosisp-emergencia'

export interface RouterEmergencia {
    id: number
    nombre: string
    nas_ip: string
}

export interface OpcionesRsc {
    /** perfil del que se copian los perfiles de emergencia si el plan no tiene uno en el router */
    perfilBase: string
    /** perfil de corte del router (el que usa `Mikrotik-Group = suspendido`) */
    perfilSuspendido: string
    /** exportar también los suspendidos (por defecto sí: sin secret, un suspendido no entra ni al portal) */
    incluirSuspendidos: boolean
    /** fecha de generación para el encabezado (ISO) */
    generado: string
}

export interface ResumenRsc {
    router_id: number
    router: string
    servicios: number
    por_estado: Record<string, number>
    perfiles: string[]
    omitidos: Array<{ servicio_id: number; user_ppp: string; motivo: string }>
}

/** Contraseña ya descifrada (o el motivo por el que no se pudo). */
export type ClaveServicio = { clave: string } | { error: string }

/** Cadena entre comillas para un script de RouterOS: escapa `\`, `"` y `$`. */
export function cadenaRos(valor: string): string {
    return `"${valor.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\$/g, '\\$')}"`
}

/** Caracteres de control: no se pueden escribir en un `.rsc` de forma segura. */
const tieneControl = (v: string) => [...v].some((c) => c.charCodeAt(0) < 0x20 || c.charCodeAt(0) === 0x7f)

export function generarRscEmergencia(
    router: RouterEmergencia,
    registros: RegistroAaa[],
    claveDe: (r: RegistroAaa) => ClaveServicio,
    opciones: OpcionesRsc,
): { rsc: string; resumen: ResumenRsc } {
    const resumen: ResumenRsc = {
        router_id: router.id,
        router: router.nombre,
        servicios: 0,
        por_estado: {},
        perfiles: [],
        omitidos: [],
    }
    const perfiles = new Map<string, PerfilEmergencia>()
    const secrets: string[] = []

    const ordenados = [...registros].sort((a, b) => a.user_ppp.localeCompare(b.user_ppp))
    for (const r of ordenados) {
        if (r.router_id !== router.id || r.estado === 'retirado') continue
        const omitir = (motivo: string) =>
            resumen.omitidos.push({ servicio_id: r.servicio_id, user_ppp: r.user_ppp, motivo })
        if (r.estado === 'suspendido' && !opciones.incluirSuspendidos) {
            omitir('suspendido (--sin-suspendidos)')
            continue
        }
        if (tieneControl(r.user_ppp)) {
            omitir('user_ppp con caracteres de control')
            continue
        }
        const clave = claveDe(r)
        if ('error' in clave) {
            omitir(`no se pudo descifrar la contraseña: ${clave.error}`)
            continue
        }
        if (tieneControl(clave.clave)) {
            omitir('contraseña con caracteres de control')
            continue
        }

        let perfil: string
        if (r.estado === 'suspendido') {
            perfil = opciones.perfilSuspendido
        } else {
            const limitado = r.estado === 'limitado'
            perfil = `${COMENTARIO}-plan-${r.plan.id}${limitado ? '-limitado' : ''}`
            const p = perfiles.get(perfil) ?? {
                r,
                limitado,
                pool: null,
                poolEnlace: null,
                poolDelegacion: null,
            }
            // Los pools son del plan en el router: los da cualquier servicio que los use.
            if (r.ipv4?.modo === 'pool') p.pool ??= r.ipv4.pool
            if (r.ipv6.modo === 'radius_pool') {
                p.poolEnlace ??= r.ipv6.pool_enlace
                p.poolDelegacion ??= r.ipv6.pool_delegacion
            }
            perfiles.set(perfil, p)
        }

        const partes = [
            `add name=${cadenaRos(r.user_ppp)}`,
            `password=${cadenaRos(clave.clave)}`,
            'service=pppoe',
            `profile=${cadenaRos(perfil)}`,
        ]
        if (r.ipv4?.modo === 'estatico') partes.push(`remote-address=${r.ipv4.ip}`)
        if (r.ipv6.modo === 'radius_servicio' && r.ipv6.prefijo_enlace) {
            partes.push(`remote-ipv6-prefix=${r.ipv6.prefijo_enlace}`)
        }
        partes.push(`comment=${cadenaRos(COMENTARIO)}`)
        secrets.push(partes.join(' '))
        resumen.servicios++
        resumen.por_estado[r.estado] = (resumen.por_estado[r.estado] ?? 0) + 1
    }
    resumen.perfiles = [...perfiles.keys()].sort()

    const encontrar = `[find comment=${cadenaRos(COMENTARIO)}]`
    const l: string[] = [
        `# ArgosIsp · secrets PPPoE de EMERGENCIA · router ${router.id} ${router.nombre.replace(/[\r\n]/g, ' ')} (NAS ${router.nas_ip})`,
        `# Generado ${opciones.generado} · ${resumen.servicios} servicios · ${resumen.perfiles.length} perfiles`,
        '# CONTIENE CONTRASEÑAS EN CLARO: no lo guardes en el repositorio ni lo compartas; bórralo al terminar.',
        '# Solo si aaa (RADIUS) no responde: docs/runbooks/aaa-caido.md, paso 3. Sin RADIUS no hay corte',
        '# automático, accounting ni el /56 delegado fijo: es temporal.',
        '# Importar:  /import file-name=<este archivo>',
        `# Retirar:   /ppp secret remove ${encontrar}`,
        `#            /ppp profile remove ${encontrar}`,
        '',
        '# Lo de una importación anterior (secrets antes que perfiles: un perfil en uso no se borra)',
        `/ppp secret remove ${encontrar}`,
        `/ppp profile remove ${encontrar}`,
    ]
    if (perfiles.size > 0) {
        l.push('', '/ppp profile')
        for (const nombre of resumen.perfiles) l.push(lineaPerfil(nombre, perfiles.get(nombre)!, opciones))
    }
    if (secrets.length > 0) l.push('', '/ppp secret', ...secrets)
    return { rsc: l.join('\n') + '\n', resumen }
}

interface PerfilEmergencia {
    /** un registro del plan (perfil, velocidad y modo de control son del plan en el router) */
    r: RegistroAaa
    limitado: boolean
    pool: string | null
    poolEnlace: string | null
    poolDelegacion: string | null
}

/** Perfil de emergencia del plan: copia del perfil del plan en el router con el rate-limit de aaa. */
function lineaPerfil(nombre: string, p: PerfilEmergencia, opciones: OpcionesRsc): string {
    const { r } = p
    // Con reuso > 1 en modo simple, aaa manda `Mikrotik-Group = plan-<id>` (perfil con parent-queue).
    const base =
        r.plan.profile_ppp ??
        (r.control_velocidad === 'simple' && r.plan.reuso > 1 ? `plan-${r.plan.id}` : opciones.perfilBase)
    const partes = [
        `add name=${cadenaRos(nombre)}`,
        `copy-from=${cadenaRos(base)}`,
        `rate-limit=${cadenaRos(p.limitado ? r.plan.rate_limit_limitado : r.plan.rate_limit)}`,
    ]
    if (p.pool) partes.push(`remote-address=${cadenaRos(p.pool)}`)
    if (p.poolEnlace) partes.push(`remote-ipv6-prefix-pool=${cadenaRos(p.poolEnlace)}`)
    if (p.poolDelegacion) partes.push(`dhcpv6-pd-pool=${cadenaRos(p.poolDelegacion)}`)
    partes.push(`comment=${cadenaRos(COMENTARIO)}`)
    return partes.join(' ')
}
