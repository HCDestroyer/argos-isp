import type { ClienteRouterOS, ContextoRed, ObjetoRouterOS } from '#network/routeros/cliente'
import { diferencias } from '#network/routeros/normalizar'
import {
    estadoRedAcceso,
    MENUS_ACCESO,
    sobrantesAcceso,
    type MenuAcceso,
    type ObjetoAcceso,
    type ServidorArgos,
    type VlanArgos,
} from '#network/routeros/red_acceso'

/**
 * Aplica y reconcilia la red de acceso **administrada** de un router (`contratos/red-acceso.md` §6.3):
 * VLAN, perfil del servidor y servidor PPPoE, identificados por su comment de Argos. Idempotente: lo
 * que ya está igual no se escribe; cada escritura queda en `audit.red`.
 *
 * Orden (nunca corta a un cliente): crear y corregir **VLAN → perfil → servidor**; después borrar los
 * sobrantes **servidor → perfil → VLAN**. Un servidor sobrante con sesiones PPPoE vivas queda como
 * está (con su perfil y su VLAN) y se avisa; se borra en la reconciliación siguiente a que terminen. Lo `adoptado` y lo que no lleva comment de Argos nunca se toca, tampoco `default`.
 */

export interface CambioAcceso {
    ruta: MenuAcceso
    comment: string
    accion: 'creado' | 'actualizado' | 'borrado'
}

export interface DerivaAcceso {
    ruta: MenuAcceso
    comment: string
    accion: 'crear' | 'actualizar' | 'borrar'
    /** Propiedades que difieren (`{ campo: { argos, router } }`) */
    diferencias?: Record<string, { argos: string | null; router: string | null }>
}

export type LecturaAcceso = Map<MenuAcceso, ObjetoRouterOS[]>

export async function leerAcceso(cliente: ClienteRouterOS): Promise<LecturaAcceso> {
    const l: LecturaAcceso = new Map()
    for (const ruta of MENUS_ACCESO) l.set(ruta, await cliente.listar(ruta))
    return l
}

const porComment = (lectura: LecturaAcceso, o: ObjetoAcceso) =>
    (lectura.get(o.ruta) ?? []).filter((x) => x.comment === o.comment && x.dynamic !== 'true')

const puestas = (o: ObjetoAcceso, actual: ObjetoRouterOS) =>
    (o.quitar ?? []).filter((k) => actual[k] !== undefined && actual[k] !== '')

/** Deriva entre Argos y el router (vista previa del reconciliador; no escribe). */
export function derivaAcceso(
    vlans: VlanArgos[],
    servidores: ServidorArgos[],
    lectura: LecturaAcceso,
): { deriva: DerivaAcceso[]; avisos: string[] } {
    const { presentes, avisos } = estadoRedAcceso(vlans, servidores, lectura.get('/ppp/profile') ?? [])
    const deriva: DerivaAcceso[] = []
    for (const o of presentes) {
        const actuales = porComment(lectura, o)
        if (actuales.length === 0) {
            deriva.push({ ruta: o.ruta, comment: o.comment, accion: 'crear' })
            continue
        }
        const dif = diferencias(o.propiedades, actuales[0]!)
        const quitar = puestas(o, actuales[0]!)
        if (Object.keys(dif).length > 0 || quitar.length > 0 || actuales.length > 1) {
            deriva.push({
                ruta: o.ruta,
                comment: o.comment,
                accion: 'actualizar',
                diferencias: Object.fromEntries([
                    ...Object.keys(dif).map((k) => [
                        k,
                        { argos: o.propiedades[k]!, router: actuales[0]![k] ?? null },
                    ]),
                    ...quitar.map((k) => [k, { argos: null, router: actuales[0]![k] ?? null }]),
                ]),
            })
        }
    }
    for (const s of sobrantesAcceso(presentes, lectura)) {
        deriva.push({ ruta: s.ruta, comment: s.objeto.comment ?? '', accion: 'borrar' })
    }
    return { deriva, avisos }
}

export async function aplicarRedAcceso(
    cliente: ClienteRouterOS,
    vlans: VlanArgos[],
    servidores: ServidorArgos[],
    ctx: ContextoRed,
    opciones: { lectura?: LecturaAcceso } = {},
): Promise<{ cambios: CambioAcceso[]; avisos: string[] }> {
    const lectura = opciones.lectura ?? (await leerAcceso(cliente))
    const { presentes, avisos } = estadoRedAcceso(vlans, servidores, lectura.get('/ppp/profile') ?? [])
    const cambios: CambioAcceso[] = []
    for (const o of presentes) {
        const actuales = porComment(lectura, o)
        if (
            actuales.length === 1 &&
            Object.keys(diferencias(o.propiedades, actuales[0]!)).length === 0 &&
            puestas(o, actuales[0]!).length === 0
        ) {
            continue
        }
        const r = await cliente.asegurar(o.ruta, o.comment, o.propiedades, ctx)
        const quitar = puestas(o, r.objeto)
        if (quitar.length > 0) await cliente.desasignar(o.ruta, r.objeto['.id'], quitar, ctx)
        if (r.accion !== 'sin_cambios' || quitar.length > 0 || r.duplicados > 0) {
            cambios.push({
                ruta: o.ruta,
                comment: o.comment,
                accion: r.accion === 'creado' ? 'creado' : 'actualizado',
            })
        }
    }
    // Sobrantes: servidor → perfil → VLAN (MENUS_ACCESO ya va en ese orden). Las sesiones de un
    // servidor son sus interfaces dinámicas `/interface/pppoe-server` (`service` = su service-name).
    const sobrantes = sobrantesAcceso(presentes, lectura)
    const conSesion = new Set<string>()
    if (sobrantes.some((s) => s.ruta === '/interface/pppoe-server/server')) {
        for (const i of await cliente.listar('/interface/pppoe-server')) {
            if (i.service) conSesion.add(i.service)
        }
    }
    const enUso = new Set<string>()
    for (const { ruta, objeto } of sobrantes) {
        if (ruta === '/interface/pppoe-server/server' && conSesion.has(objeto['service-name'] ?? '')) {
            avisos.push(
                `servidor PPPoE ${objeto['service-name']} (${objeto.comment}): tiene sesiones vivas; se borra cuando terminen`,
            )
            enUso.add(objeto['default-profile'] ?? '')
            enUso.add(objeto.interface ?? '')
            continue
        }
        // El perfil o la VLAN de un servidor que se conserva tampoco se borran.
        if ((ruta === '/ppp/profile' || ruta === '/interface/vlan') && enUso.has(objeto.name ?? '')) continue
        await cliente.borrarPorId(ruta, objeto['.id'], ctx)
        cambios.push({ ruta, comment: objeto.comment ?? '', accion: 'borrado' })
    }
    return { cambios, avisos }
}
