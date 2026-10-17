<script setup lang="ts">
/**
 * Tarjetas grandes con icono para los accesos rápidos (`accesosRapidos` en `utils/accesos.ts` decide
 * cuáles). Las que navegan son enlaces; las que abren algo en la página emiten `accion`.
 * Dos columnas en el teléfono (áreas táctiles amplias), tres desde `sm`.
 */
const props = withDefaults(defineProps<{
    accesos: AccesoRapido[]
    titulo?: string
    /** `data-testid` propios por acceso (los de `/corte` conservan los de siempre). */
    testids?: Partial<Record<IdAcceso, string>>
}>(), {
    titulo: 'Accesos rápidos',
    testids: () => ({}),
})

const emit = defineEmits<{
    accion: [accion: NonNullable<AccesoRapido['accion']>]
}>()

const idTitulo = useId()
</script>

<template>
    <section
        :aria-labelledby="idTitulo"
        data-testid="accesos-rapidos"
    >
        <h2
            :id="idTitulo"
            class="sr-only"
        >
            {{ props.titulo }}
        </h2>
        <ul class="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <li
                v-for="acceso in props.accesos"
                :key="acceso.id"
            >
                <UButton
                    :to="acceso.to"
                    :external="acceso.externo"
                    color="neutral"
                    variant="outline"
                    block
                    class="surface-card h-full"
                    :ui="{ base: 'flex-col items-start justify-start gap-2 p-3 text-start ring-0' }"
                    :data-testid="props.testids[acceso.id] ?? `acceso-${acceso.id}`"
                    @click="acceso.accion ? emit('accion', acceso.accion) : undefined"
                >
                    <span class="flex size-10 items-center justify-center rounded-lg bg-primary/10">
                        <UIcon
                            :name="acceso.icono"
                            class="size-6 text-primary"
                            aria-hidden="true"
                        />
                    </span>
                    <span class="flex flex-col gap-0.5">
                        <span class="text-sm font-semibold text-highlighted">{{ acceso.titulo }}</span>
                        <span class="text-xs font-normal text-muted">{{ acceso.descripcion }}</span>
                    </span>
                </UButton>
            </li>
        </ul>
    </section>
</template>
