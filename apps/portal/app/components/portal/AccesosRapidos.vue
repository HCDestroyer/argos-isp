<script setup lang="ts">
/**
 * Tarjetas grandes con icono para los accesos rápidos (`accesosRapidos` en `utils/accesos.ts` decide
 * cuáles). Las que navegan son enlaces; las que abren algo en la página emiten `accion`.
 * Dos columnas en el teléfono (icono y título en una fila), tres desde `sm` (con la descripción). Tarjetas del sistema visual
 * (`ax-tarjeta`, suben 1 px al pasar el puntero) con la pastilla de icono tintada.
 *
 * `forma="lista"` (página de corte, tablero `Portal`): botones de pastilla apilados a lo ancho, con
 * el icono y el título; la descripción queda para el lector de pantalla.
 */
const props = withDefaults(defineProps<{
    accesos: AccesoRapido[]
    titulo?: string
    /** `data-testid` propios por acceso (los de `/corte` conservan los de siempre). */
    testids?: Partial<Record<IdAcceso, string>>
    forma?: 'tarjetas' | 'lista'
}>(), {
    titulo: 'Accesos rápidos',
    testids: () => ({}),
    forma: 'tarjetas',
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
        <ul
            v-if="props.forma === 'lista'"
            class="flex flex-col gap-2.5"
        >
            <li
                v-for="acceso in props.accesos"
                :key="acceso.id"
            >
                <UButton
                    :to="acceso.to"
                    :external="acceso.externo"
                    :icon="acceso.icono"
                    color="neutral"
                    variant="outline"
                    size="xl"
                    block
                    class="bg-(--ax-tarjeta)"
                    :data-testid="props.testids[acceso.id] ?? `acceso-${acceso.id}`"
                    @click="acceso.accion ? emit('accion', acceso.accion) : undefined"
                >
                    <span class="font-semibold">{{ acceso.titulo }}</span>
                    <span class="sr-only">. {{ acceso.descripcion }}</span>
                </UButton>
            </li>
        </ul>
        <ul
            v-else
            class="grid grid-cols-2 gap-2 sm:grid-cols-3"
        >
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
                    :ui="{ base: 'flex-row items-center justify-start gap-2.5 p-3 text-start ring-0 hover:bg-(--ax-tarjeta) active:bg-(--ax-tarjeta) sm:flex-col sm:items-start sm:p-3.5' }"
                    :data-testid="props.testids[acceso.id] ?? `acceso-${acceso.id}`"
                    @click="acceso.accion ? emit('accion', acceso.accion) : undefined"
                >
                    <PortalPastilla
                        :icono="acceso.icono"
                        class="max-sm:size-8"
                    />
                    <!-- Teléfono: solo el título (la pantalla es corta); la descripción, para el lector de pantalla. -->
                    <span class="flex min-w-0 flex-col gap-0.5">
                        <span class="text-sm font-semibold text-highlighted">{{ acceso.titulo }}</span>
                        <span class="text-xs font-normal text-muted max-sm:sr-only">{{ acceso.descripcion }}</span>
                    </span>
                </UButton>
            </li>
        </ul>
    </section>
</template>
