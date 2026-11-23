<script setup lang="ts">
import type { DropdownMenuItem } from '@nuxt/ui'

/**
 * Menú «⋯» de una fila en las listas de Finanzas (sistema visual: menú en cada fila, agrupado y con
 * lo destructivo al final). Sin acciones no se pinta.
 */
const props = defineProps<{
    acciones: AccionFila[]
    /** Nombre de la fila, para el `aria-label` («Más acciones: Compra 12»). */
    nombre: string
}>()

/**
 * Una acción que abre una ventana (por ejemplo «Castigar…») no debe recibir de vuelta el foco del
 * menú al cerrarse: el botón ⋯ se lo quitaría a la ventana y borraría lo que se empieza a escribir
 * (pasaba en el teléfono con el buscador de cliente). Al cerrar con Esc o fuera, el foco sí vuelve.
 */
let accionElegida = false

const items = computed<DropdownMenuItem[][]>(() => agruparAcciones(props.acciones, accion => ({
    label: accion.etiqueta,
    icon: accion.icono,
    to: accion.to,
    color: accion.color,
    onSelect: accion.alElegir
        ? () => {
                accionElegida = true
                accion.alElegir?.()
            }
        : undefined,
})))

function alCerrarFoco(evento: Event) {
    if (accionElegida) {
        evento.preventDefault()
        accionElegida = false
    }
}
</script>

<template>
    <UDropdownMenu
        v-if="acciones.length"
        :items="items"
        :content="{ align: 'end', onCloseAutoFocus: alCerrarFoco }"
    >
        <UButton
            icon="i-lucide-ellipsis"
            color="neutral"
            variant="ghost"
            size="sm"
            :aria-label="`Más acciones: ${nombre}`"
            data-prueba="menu-fila"
        />
    </UDropdownMenu>
</template>
