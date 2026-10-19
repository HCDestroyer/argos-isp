<script setup lang="ts">
import type { BadgeProps } from '@nuxt/ui'

/**
 * Insignia "Seguridad" de Horus: siempre icono + texto + color (`ESTADOS_SEGURIDAD`), con los
 * hallazgos abiertos si se conocen y la marca "Dato de hace X" cuando viene del último dato conocido.
 */
const props = withDefaults(defineProps<{
    estado: string | null
    hallazgosAbiertos?: number | null
    /** Texto de `marcaDatoViejo()`, o `null` si el dato es fresco. */
    marca?: string | null
    size?: BadgeProps['size']
}>(), {
    hallazgosAbiertos: null,
    marca: null,
    size: 'md',
})

const presentacion = computed(() => ESTADOS_SEGURIDAD[estadoSeguridad(props.estado)])
const etiqueta = computed(() => {
    const base = `Seguridad: ${presentacion.value.etiqueta}`
    const n = props.hallazgosAbiertos
    if (!n) {
        return base
    }
    return `${base} · ${n} ${n === 1 ? 'hallazgo abierto' : 'hallazgos abiertos'}`
})
</script>

<template>
    <span
        class="inline-flex flex-wrap items-center gap-1.5"
        data-prueba="seguridad-horus"
        :data-estado="estadoSeguridad(estado)"
    >
        <UBadge
            :label="etiqueta"
            :icon="presentacion.icono"
            :color="presentacion.color"
            variant="subtle"
            :size="size"
        />
        <UBadge
            v-if="marca"
            :label="marca"
            icon="i-lucide-history"
            color="neutral"
            variant="outline"
            :size="size"
            data-prueba="seguridad-dato-viejo"
        />
    </span>
</template>
