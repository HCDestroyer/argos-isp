<script setup lang="ts">
import type { BadgeProps } from '@nuxt/ui'

/**
 * Estado de la sesión PPPoE (`ESTADOS_SESION`) con el punto "en vivo" de la identidad: en línea
 * lanza un anillo cada vez que llega un dato nuevo (`latido` cambia). Siempre icono + texto.
 */
const props = withDefaults(defineProps<{
    estado: EstadoSesion
    /** Contador de lecturas: cada cambio vuelve a lanzar el anillo del punto. */
    latido?: number
    /** Momento de la última lectura (ISO), para "En vivo · 10:42". */
    leidoEn?: string | null
    size?: BadgeProps['size']
}>(), {
    latido: 0,
    leidoEn: null,
    size: 'md',
})

const presentacion = computed(() => ESTADOS_SESION[props.estado])
const hora = computed(() => (props.leidoEn ? formatearHora(props.leidoEn) : null))
</script>

<template>
    <span
        class="inline-flex flex-wrap items-center gap-x-3 gap-y-1"
        :data-prueba="`sesion-${estado}`"
    >
        <UBadge
            :label="presentacion.etiqueta"
            :icon="presentacion.icono"
            :color="presentacion.color"
            :size="size"
            variant="subtle"
        />
        <span
            v-if="estado === 'en_linea'"
            class="inline-flex items-center gap-1.5 text-xs text-muted"
            data-prueba="en-vivo"
        >
            <span
                class="live-dot"
                :class="latido % 2 ? 'ring-a' : 'ring-b'"
                aria-hidden="true"
            />
            En vivo<template v-if="hora"> · {{ hora }}</template>
        </span>
    </span>
</template>
