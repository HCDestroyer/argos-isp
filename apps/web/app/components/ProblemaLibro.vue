<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'

/**
 * Error de los libros legales con su título claro y qué hacer: por cada mes abierto, cerrarlo; sin
 * bloqueo, bloquear el libro; sin folios, registrar la habilitación; con la cadena rota, revisar la
 * integridad. Cada paso lleva a su pantalla solo si el usuario tiene el permiso de esa acción.
 */
const props = withDefaults(defineProps<{
    problema: Problem
    /** El libro del error: «Registrar habilitación» abre el formulario de ese libro. */
    libro?: LibroHabilitable
    reintentar?: () => void
    reintentando?: boolean
}>(), {
    libro: undefined,
    reintentar: undefined,
    reintentando: false,
})

const { puede } = usePermisos()

const legible = computed(() => problemaLibroLegible(props.problema))
const pasos = computed(() => pasosProblemaLibro(props.problema, props.libro))
</script>

<template>
    <div class="flex flex-col gap-2">
        <ProblemaAlerta
            :problema="legible"
            :reintentar="reintentar"
            :reintentando="reintentando"
        />
        <ol
            v-if="pasos.length"
            class="flex flex-col gap-2 rounded-lg border border-default p-3"
            aria-label="Qué hacer"
            data-prueba="pasos-libro"
        >
            <li
                v-for="(paso, indice) in pasos"
                :key="indice"
                class="flex flex-col gap-2 text-sm sm:flex-row sm:items-center sm:justify-between"
                data-prueba="paso-libro"
            >
                <span class="flex gap-2 text-default">
                    <span class="font-semibold tabular-nums text-muted">{{ indice + 1 }}.</span>
                    <span>{{ paso.texto }}</span>
                </span>
                <UButton
                    v-if="paso.accion && puede(paso.accion.permiso)"
                    :to="paso.accion.ruta"
                    :label="paso.accion.etiqueta"
                    trailing-icon="i-lucide-arrow-right"
                    color="neutral"
                    variant="outline"
                    size="xs"
                    class="shrink-0 self-start sm:self-auto"
                    data-prueba="paso-accion"
                />
            </li>
        </ol>
    </div>
</template>
