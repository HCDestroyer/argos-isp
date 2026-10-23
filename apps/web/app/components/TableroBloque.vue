<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'

/**
 * Tarjeta de un bloque del tablero fiscal. Con `error` muestra el problema del bloque y «Reintentar»
 * (recarga el tablero), nunca cifras; con `no_aplica`, atenuada con su motivo; con `ok`, el contenido.
 */
const props = withDefaults(defineProps<{
    nombre: NombreBloqueTablero
    bloque: { estado: 'ok' | 'error' | 'no_aplica', motivo: string | null, error: Problem | null }
    reintentar: () => void
    reintentando?: boolean
}>(), {
    reintentando: false,
})

const info = computed(() => BLOQUES_TABLERO[props.nombre])
const problema = computed(() => (props.bloque.error ? problemaDeclaracionLegible(props.bloque.error) : null))
</script>

<template>
    <UCard
        :data-bloque="nombre"
        :data-estado="bloque.estado"
        :class="bloque.estado === 'no_aplica' ? 'bg-elevated/50' : ''"
        :ui="{
            header: 'px-4 py-3 sm:px-4',
            body: 'px-4 py-3 sm:px-4',
        }"
    >
        <template #header>
            <div class="flex items-center justify-between gap-2">
                <h3 class="flex items-center gap-2 text-sm font-semibold text-highlighted">
                    <UIcon
                        :name="info.icono"
                        class="size-4 shrink-0 text-muted"
                    />
                    {{ info.titulo }}
                </h3>
                <UBadge
                    v-if="bloque.estado === 'no_aplica'"
                    color="neutral"
                    variant="subtle"
                    label="No aplica"
                />
                <UBadge
                    v-else-if="bloque.estado === 'error'"
                    color="error"
                    variant="subtle"
                    icon="i-lucide-circle-alert"
                    label="Sin datos"
                />
                <slot name="insignia" />
            </div>
        </template>

        <ProblemaAlerta
            v-if="bloque.estado === 'error' && problema"
            :problema="problema"
            :reintentar="reintentar"
            :reintentando="reintentando"
            data-prueba="bloque-error"
        />
        <p
            v-else-if="bloque.estado === 'no_aplica'"
            class="text-sm text-muted"
            data-prueba="bloque-motivo"
        >
            {{ motivoNoAplicaTablero(bloque.motivo) }}
        </p>
        <slot v-else />
    </UCard>
</template>
