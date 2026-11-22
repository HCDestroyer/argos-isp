<script setup lang="ts">
import type { BadgeProps } from '@nuxt/ui'

/**
 * Fila de lista del sistema visual: pastilla de icono, título y subtítulo gris, monto en negrita a
 * la derecha y el estado como pastilla tintada con icono (color + icono + texto). `acciones` lleva
 * el menú de tres puntos o el botón de detalle; lo de abajo (notas) va en el slot por defecto.
 *
 * Con `interactiva`, tocar la fila emite `abrir` (el detalle en un drawer); el botón de detalle de
 * `acciones` es la forma accesible con teclado, así que la fila no se vuelve un botón (lleva
 * botones adentro).
 */
const props = withDefaults(defineProps<{
    titulo: string
    subtitulo?: string
    icono?: string
    iniciales?: string
    tono?: TonoPastilla
    monto?: string
    /** Texto pequeño bajo el monto (p. ej. «Saldo Q 25.00»). */
    detalleMonto?: string
    estado?: { etiqueta: string, color: BadgeProps['color'], icono?: string }
    /** `data-testid` del badge de estado (las pruebas lo leen). */
    testidEstado?: string
    interactiva?: boolean
}>(), {
    subtitulo: undefined,
    icono: 'i-lucide-file-text',
    iniciales: undefined,
    tono: 'primary',
    monto: undefined,
    detalleMonto: undefined,
    estado: undefined,
    testidEstado: undefined,
    interactiva: false,
})

const emit = defineEmits<{
    abrir: []
}>()

/** Solo un toque en la fila (no en sus botones o enlaces) abre el detalle. */
function tocar(evento: MouseEvent) {
    if (!props.interactiva) {
        return
    }
    const destino = evento.target as HTMLElement | null
    if (destino?.closest('a, button, [role="menuitem"]')) {
        return
    }
    emit('abrir')
}
</script>

<template>
    <li
        class="ax-fila ax-grilla"
        :data-interactiva="props.interactiva ? 'true' : undefined"
        @click="tocar"
    >
        <PortalPastilla
            class="ax-a-ico"
            :icono="props.iniciales ? undefined : props.icono"
            :iniciales="props.iniciales"
            :tono="props.tono"
        />
        <div class="ax-a-txt">
            <p class="font-medium break-words text-highlighted">
                {{ props.titulo }}
            </p>
            <p
                v-if="props.subtitulo || $slots.subtitulo"
                class="text-xs break-words text-muted"
            >
                <slot name="subtitulo">
                    {{ props.subtitulo }}
                </slot>
            </p>
        </div>
        <div
            v-if="props.monto !== undefined || props.detalleMonto"
            class="ax-a-monto"
        >
            <p
                v-if="props.monto !== undefined"
                class="font-semibold whitespace-nowrap tabular-nums text-highlighted"
            >
                {{ props.monto }}
            </p>
            <p
                v-if="props.detalleMonto"
                class="text-xs whitespace-nowrap tabular-nums text-muted"
            >
                {{ props.detalleMonto }}
            </p>
        </div>
        <div
            v-if="props.estado"
            class="ax-a-est"
        >
            <UBadge
                :label="props.estado.etiqueta"
                :color="props.estado.color"
                :icon="props.estado.icono"
                variant="subtle"
                :data-testid="props.testidEstado"
            />
        </div>
        <div
            v-if="$slots.acciones"
            class="ax-a-act flex items-center gap-1"
        >
            <slot name="acciones" />
        </div>
        <div
            v-if="$slots.default"
            class="ax-a-extra flex flex-col gap-2"
        >
            <slot />
        </div>
    </li>
</template>
