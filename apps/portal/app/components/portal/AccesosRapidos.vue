<script setup lang="ts">
/**
 * Tarjetas grandes con icono para los accesos rápidos (`accesosRapidos` en `utils/accesos.ts` decide
 * cuáles). Las que navegan son enlaces; las que abren algo en la página emiten `accion`.
 * Dos columnas en el teléfono (áreas táctiles amplias), tres desde `sm`. Tarjetas del sistema visual
 * (`ax-tarjeta`, suben 1 px al pasar el puntero) con la pastilla de icono tintada.
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
                    class="ax-tarjeta ax-tocable h-full"
                    :ui="{ base: 'flex-col items-start justify-start gap-2.5 p-3.5 text-start ring-0 hover:bg-(--ax-tarjeta) active:bg-(--ax-tarjeta)' }"
                    :data-testid="props.testids[acceso.id] ?? `acceso-${acceso.id}`"
                    @click="acceso.accion ? emit('accion', acceso.accion) : undefined"
                >
                    <PortalPastilla :icono="acceso.icono" />
                    <span class="flex flex-col gap-0.5">
                        <span class="text-sm font-semibold text-highlighted">{{ acceso.titulo }}</span>
                        <span class="text-xs font-normal text-muted">{{ acceso.descripcion }}</span>
                    </span>
                </UButton>
            </li>
        </ul>
    </section>
</template>
