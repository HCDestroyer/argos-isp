import type { Schema } from '@argosisp/contracts'

export type ObjetoVistaPrevia = Schema<'VistaPreviaControl'>['crear'][number]
export type MenuVistaPrevia = Schema<'VistaPreviaControl'>['menus'][number]
export type OperacionVistaPrevia = 'crear' | 'actualizar' | 'borrar'

/** Qué guarda ArgosIsp en cada menú de RouterOS que toca el cambio de modo. */
const DESCRIPCION_MENU: Record<string, string> = {
    '/queue/type': 'Tipos de cola PCQ por plan',
    '/queue/tree': 'Árbol de colas (global y por plan)',
    '/queue/simple': 'Colas simples (padres por plan y WISP)',
    '/ip/firewall/mangle': 'Marcas de tráfico IPv4 por plan',
    '/ipv6/firewall/mangle': 'Marcas de tráfico IPv6 por plan',
    '/ip/firewall/address-list': 'Listas IPv4 de cada servicio',
    '/ipv6/firewall/address-list': 'Listas IPv6 de cada servicio',
    '/ppp/profile': 'Perfiles PPP',
}

/** Descripción del menú, o `null` si la API trae uno que el panel no conoce (se muestra solo la ruta). */
export function descripcionMenu(ruta: string): string | null {
    return DESCRIPCION_MENU[ruta] ?? null
}

export const OPERACIONES_VISTA_PREVIA: Record<OperacionVistaPrevia, { etiqueta: string, color: 'success' | 'warning' | 'error', icono: string }> = {
    crear: { etiqueta: 'Se crea', color: 'success', icono: 'i-lucide-plus' },
    actualizar: { etiqueta: 'Se actualiza', color: 'warning', icono: 'i-lucide-pencil' },
    borrar: { etiqueta: 'Se borra', color: 'error', icono: 'i-lucide-trash-2' },
}

/** Total de objetos de cada operación, sumando los menús que reporta la API. */
export function totalesVistaPrevia(menus: MenuVistaPrevia[]): Record<OperacionVistaPrevia, number> {
    return menus.reduce(
        (total, menu) => ({ crear: total.crear + menu.crear, actualizar: total.actualizar + menu.actualizar, borrar: total.borrar + menu.borrar }),
        { crear: 0, actualizar: 0, borrar: 0 },
    )
}

/** Objetos agrupados por menú, en el orden en que llegan (el del worker). */
export function agruparPorMenu(objetos: ObjetoVistaPrevia[]): { ruta: string, objetos: ObjetoVistaPrevia[] }[] {
    const grupos = new Map<string, ObjetoVistaPrevia[]>()
    for (const objeto of objetos) {
        grupos.set(objeto.ruta, [...(grupos.get(objeto.ruta) ?? []), objeto])
    }
    return [...grupos].map(([ruta, lista]) => ({ ruta, objetos: lista }))
}
