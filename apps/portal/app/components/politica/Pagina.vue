<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'

/**
 * Marco común de las políticas públicas: título, versión y vigencia, aviso si no se pudo leer la
 * empresa (el texto se muestra igual, con «la empresa» en lugar del nombre, para no dejar la URL
 * vacía ante el revisor), el contenido y enlaces a las otras dos políticas.
 */
const props = defineProps<{
    titulo: string
    actual: EnlacePolitica['to']
    problema: Problem | null
}>()

const emit = defineEmits<{
    reintentar: []
}>()

const otras = computed(() => POLITICAS.filter(politica => politica.to !== props.actual))
</script>

<template>
    <article
        class="flex flex-col gap-6"
        data-testid="politica"
    >
        <header class="flex flex-col gap-1">
            <h1 class="text-2xl font-semibold text-highlighted">
                {{ titulo }}
            </h1>
            <p
                class="text-xs text-muted"
                data-testid="politica-version"
            >
                Versión {{ VERSION_POLITICAS }} · Vigente desde el {{ VIGENCIA_POLITICAS }}
            </p>
        </header>

        <UAlert
            v-if="problema"
            color="warning"
            variant="subtle"
            icon="i-lucide-cloud-off"
            title="No pudimos cargar los datos de la empresa"
            :description="`${mensajeProblema(problema)} El texto aplica igual; los datos de contacto están en la página de contacto.`"
            :actions="[{ label: 'Reintentar', icon: 'i-lucide-refresh-cw', color: 'warning', variant: 'outline', onClick: () => emit('reintentar') }]"
        />

        <slot />

        <nav
            aria-label="Otras políticas"
            class="flex flex-col gap-2 border-t border-default pt-4"
        >
            <p class="text-sm font-medium text-highlighted">
                Otras políticas
            </p>
            <div class="flex flex-col gap-2 sm:flex-row">
                <UButton
                    v-for="politica in otras"
                    :key="politica.to"
                    :to="politica.to"
                    :label="politica.label"
                    color="neutral"
                    variant="outline"
                    trailing-icon="i-lucide-chevron-right"
                    class="justify-between sm:justify-center"
                />
            </div>
        </nav>
    </article>
</template>
