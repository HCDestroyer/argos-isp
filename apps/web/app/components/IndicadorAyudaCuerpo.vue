<script setup lang="ts">
/**
 * Cuerpo de la ayuda «¿Qué es esto?» de un indicador (tablero PlanIndicadorAyuda): siempre las
 * mismas cuatro partes y, abajo, a dónde seguir y el manual. Lo comparten la ventana pequeña del
 * escritorio y la hoja del teléfono.
 */
const props = defineProps<{
    clave: ClaveIndicador
}>()

const emit = defineEmits<{
    cerrar: []
}>()

const route = useRoute()
const config = useRuntimeConfig()
const { puedeAbrir } = usePermisos()

const ayuda = computed<AyudaIndicador>(() => AYUDA_INDICADORES[props.clave])
const accion = computed(() => (ayuda.value.accion && puedeAbrir(ayuda.value.accion.to) ? ayuda.value.accion : null))
const manual = computed(() => {
    const clave = claveAyudaDeRuta(route.matched)
    return clave ? urlAyuda(String(config.public.docsUrl), clave) : null
})

const PARTES = [
    { campo: 'queEs', titulo: 'Qué es' },
    { campo: 'comoSeCalcula', titulo: 'Cómo se calcula' },
    { campo: 'queHacer', titulo: 'Qué hacer' },
] as const
</script>

<template>
    <div
        class="flex w-full flex-col gap-3"
        :data-ayuda-indicador="clave"
    >
        <div class="flex items-center gap-3 max-sm:hidden">
            <span class="pastilla-icono pastilla-tono tono-marca size-8 shrink-0 rounded-full">
                <UIcon
                    name="i-lucide-circle-help"
                    class="size-4"
                />
            </span>
            <span class="min-w-0 flex-1 truncate text-base font-semibold text-highlighted">{{ ayuda.titulo }}</span>
            <UButton
                icon="i-lucide-x"
                color="neutral"
                variant="ghost"
                size="xs"
                aria-label="Cerrar la ayuda"
                @click="emit('cerrar')"
            />
        </div>
        <section
            v-for="parte in PARTES"
            :key="parte.campo"
            class="flex flex-col gap-0.5"
        >
            <h3 class="text-[0.6875rem] font-bold tracking-[0.08em] text-muted uppercase">
                {{ parte.titulo }}
            </h3>
            <p class="text-sm text-default">
                {{ ayuda[parte.campo] }}
            </p>
        </section>
        <p class="border-t border-(--ax-borde) pt-3 text-xs text-muted">
            Nombre contable: <strong class="font-semibold text-default">{{ ayuda.nombreContable }}</strong>
        </p>
        <div
            v-if="accion || manual"
            class="flex flex-wrap items-center justify-between gap-2"
        >
            <UButton
                v-if="accion"
                :label="accion.etiqueta"
                :to="accion.to"
                color="primary"
                variant="link"
                size="sm"
                class="px-0"
                data-prueba="ayuda-indicador-accion"
                @click="emit('cerrar')"
            />
            <UButton
                v-if="manual"
                label="Abrir el manual"
                :to="manual"
                target="_blank"
                color="neutral"
                variant="link"
                size="sm"
                class="px-0"
                data-prueba="ayuda-indicador-manual"
            />
        </div>
    </div>
</template>
