import { Comment, Fragment, Text } from 'vue'
import type { VNode } from 'vue'

/**
 * ¿El contenido de un slot pinta algo? Un slot declarado cuyo único botón queda fuera por permiso
 * (`v-if="puede(…)"`) devuelve solo un comentario: así la isla de la acción principal no aparece
 * vacía en el teléfono. Se llama dentro del render (plantilla), nunca en `setup`.
 */
export function hayContenido(nodos: VNode[] | undefined): boolean {
    return (nodos ?? []).some((nodo) => {
        if (nodo.type === Comment) {
            return false
        }
        if (nodo.type === Text) {
            return String(nodo.children ?? '').trim() !== ''
        }
        if (nodo.type === Fragment) {
            return hayContenido(Array.isArray(nodo.children) ? nodo.children as VNode[] : [])
        }
        return true
    })
}
