<script setup lang="ts">
import type { Schema } from '@argosisp/contracts'

/**
 * Estado en línea y último contacto de un router (`en_linea`, `ultimo_contacto`): "Desconocido"
 * mientras ninguna fuente periódica lo mide; la fecha exacta en Guatemala va en el título.
 */
const props = withDefaults(defineProps<{
    router: Pick<Schema<'Router'>, 'id' | 'en_linea' | 'ultimo_contacto'>
    compacto?: boolean
}>(), { compacto: false })

const estado = computed(() => ESTADOS_ROUTER[estadoContactoRouter(props.router)])
const ultimo = computed(() => textoUltimoContacto(props.router))
const exacto = computed(() => props.router.ultimo_contacto ? formatearFechaHora(props.router.ultimo_contacto) : undefined)
</script>

<template>
    <div
        class="flex flex-wrap items-center gap-x-2 gap-y-0.5"
        :data-prueba="`contacto-${router.id}`"
    >
        <UBadge
            :label="estado.etiqueta"
            :icon="estado.icono"
            :color="estado.color"
            variant="subtle"
            size="sm"
            :data-prueba="`en-linea-${router.id}`"
        />
        <span
            class="text-xs text-muted"
            :title="exacto"
            :data-prueba="`ultimo-contacto-${router.id}`"
        >{{ compacto ? ultimo : `Último contacto: ${ultimo}` }}</span>
    </div>
</template>
