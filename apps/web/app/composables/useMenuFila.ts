import type { ContextMenuItem } from '@nuxt/ui'

/**
 * Acción de una fila de lista (sistema visual Argos): la misma definición sirve para los iconos de
 * la columna de acciones (con tooltip) y para el menú contextual (clic derecho en la fila). Las
 * acciones sin permiso no se definen: el que llama filtra con `puede()`.
 */
export interface AccionFila {
    etiqueta: string
    icono: string
    to?: string
    alElegir?: () => void
    color?: ContextMenuItem['color']
    /** Solo en el menú contextual (no como icono en la fila). */
    soloMenu?: boolean
    /** Grupo del menú contextual («Ver», «Cobro», «Servicio»…), con su etiqueta y separador. */
    grupo?: string
}

/**
 * Items del menú agrupados: un grupo por `grupo` (en el orden en que aparecen), con su etiqueta, y
 * lo destructivo (`color: 'error'`) siempre al final y separado.
 */
export function agruparAcciones(acciones: AccionFila[], aItem: (accion: AccionFila) => ContextMenuItem): ContextMenuItem[][] {
    const grupos = new Map<string, AccionFila[]>()
    const destructivas: AccionFila[] = []
    for (const accion of acciones) {
        if (accion.color === 'error') {
            destructivas.push(accion)
            continue
        }
        const clave = accion.grupo ?? ''
        grupos.set(clave, [...(grupos.get(clave) ?? []), accion])
    }
    const resultado: ContextMenuItem[][] = [...grupos].map(([grupo, lista]) => [
        ...(grupo ? [{ type: 'label' as const, label: grupo }] : []),
        ...lista.map(aItem),
    ])
    if (destructivas.length) {
        resultado.push(destructivas.map(aItem))
    }
    return resultado
}

/**
 * Menú contextual de las filas de un `UTable`: `alContextmenu` va en `@contextmenu` de la tabla y
 * `items` en el `UContextMenu` que la envuelve (patrón de Nuxt UI).
 */
export function useMenuFila<T>(accionesDe: (fila: T) => AccionFila[]) {
    const items = ref<ContextMenuItem[][]>([])

    function aItem(accion: AccionFila): ContextMenuItem {
        return {
            label: accion.etiqueta,
            icon: accion.icono,
            to: accion.to,
            color: accion.color,
            onSelect: accion.alElegir,
        }
    }

    function alContextmenu(_evento: Event, fila: { original: T }) {
        items.value = agruparAcciones(accionesDe(fila.original), aItem)
    }

    return { items, alContextmenu, accionesDe }
}
