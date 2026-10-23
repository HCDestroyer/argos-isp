<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'

/**
 * Tarjeta de un bloque del tablero fiscal o del comparador. Con `error` muestra el problema del bloque y
 * «Reintentar» (recarga la pantalla), nunca cifras; si el error es 422 `bloque_dependiente`, en lugar de
 * la alerta dice de qué bloques depende (atenuada, sin reintento: se arregla el bloque del que depende);
 * con `no_aplica`, atenuada con su motivo; con `ok`, el contenido.
 */
const props = withDefaults(defineProps<{
    /** Clave del bloque (`data-bloque`); con un bloque del tablero, también su título e icono. */
    nombre: string
    titulo?: string
    icono?: string
    /** Nombre legible de cada bloque, para el motivo de un `bloque_dependiente`. */
    etiquetas?: Record<string, string>
    bloque: { estado: 'ok' | 'error' | 'no_aplica', motivo: string | null, error: Problem | null }
    reintentar: () => void
    reintentando?: boolean
}>(), {
    titulo: undefined,
    icono: undefined,
    etiquetas: () => ({}),
    reintentando: false,
})

const info = computed(() => {
    const delTablero = props.nombre in BLOQUES_TABLERO ? BLOQUES_TABLERO[props.nombre as NombreBloqueTablero] : null
    return { titulo: props.titulo ?? delTablero?.titulo ?? props.nombre, icono: props.icono ?? delTablero?.icono ?? 'i-lucide-square' }
})
const dependeDe = computed(() => {
    const error = props.bloque.error
    if (!error || codigoProblema(error) !== 'bloque_dependiente') {
        return null
    }
    return (error.errors ?? []).map(e => props.etiquetas[e.field] ?? e.field)
})
const problema = computed(() => (props.bloque.error && !dependeDe.value ? problemaDeclaracionLegible(props.bloque.error) : null))
</script>

<template>
    <UCard
        :data-bloque="nombre"
        :data-estado="bloque.estado"
        :class="bloque.estado === 'no_aplica' || dependeDe ? 'bg-elevated/50' : ''"
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
                    v-else-if="dependeDe"
                    color="neutral"
                    variant="subtle"
                    icon="i-lucide-link"
                    label="Pendiente"
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

        <p
            v-if="bloque.estado === 'error' && dependeDe"
            class="text-sm text-muted"
            data-prueba="bloque-dependiente"
        >
            No se calcula: depende de {{ dependeDe.join(', ') }}, que no se pudo calcular.
        </p>
        <ProblemaAlerta
            v-else-if="bloque.estado === 'error' && problema"
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
