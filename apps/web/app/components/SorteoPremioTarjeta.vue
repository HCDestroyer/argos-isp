<script setup lang="ts">
/**
 * Un premio del sorteo: imagen (o el icono de su tipo), tipo, valor de libre competencia, cuántos
 * hay, el ISR y cómo se entrega. La imagen es un archivo subido que la API sirve con la sesión
 * (`GET .../premios/:posicion/imagen`): se pide como `Blob` y se muestra con una URL de objeto que se
 * libera al salir. Si no carga se muestra el icono, nunca un hueco roto.
 */
const props = withDefaults(defineProps<{
    sorteoId: number
    premio: PremioSorteo
    /** Nombre del premio del catálogo (tipo servicio), si se conoce. */
    catalogo?: string | null
    /** Botón «Subir imagen» (`sorteos.gestionar`, solo en borrador). */
    puedeSubirImagen?: boolean
}>(), {
    catalogo: null,
    puedeSubirImagen: false,
})

const emit = defineEmits<{
    subirImagen: [premio: PremioSorteo]
}>()

const { puede } = usePermisos()
const tipo = computed(() => TIPOS_PREMIO_SORTEO[props.premio.tipo])
const isr = computed(() => isrPremio(props.premio))
const url = ref<string | null>(null)

function liberar() {
    if (url.value) {
        URL.revokeObjectURL(url.value)
        url.value = null
    }
}

async function cargarImagen() {
    liberar()
    if (!puede('sorteos.ver') || (!props.premio.imagen_archivo_id && !props.premio.imagen_url)) {
        return
    }
    const resultado = await useSorteos().imagenPremio(props.sorteoId, props.premio.posicion)
    if (resultado.ok) {
        url.value = URL.createObjectURL(resultado.data)
    }
}

watch(() => [props.sorteoId, props.premio.posicion, props.premio.imagen_archivo_id, props.premio.imagen_url], () => void cargarImagen())
onMounted(cargarImagen)
onBeforeUnmount(liberar)
</script>

<template>
    <article
        class="flex flex-col overflow-hidden rounded-lg border border-default bg-default"
        :aria-label="`Premio ${premio.posicion}: ${premio.nombre}`"
        :data-premio="premio.posicion"
    >
        <div class="relative aspect-[8/5] w-full bg-elevated">
            <img
                v-if="url"
                :src="url"
                :alt="premio.nombre"
                class="size-full object-cover"
                data-prueba="premio-imagen"
                @error="liberar"
            >
            <div
                v-else
                class="flex size-full items-center justify-center text-dimmed"
                data-prueba="premio-sin-imagen"
            >
                <UIcon
                    :name="tipo.icono"
                    class="size-10"
                />
            </div>
            <UBadge
                :label="`${premio.posicion}.º`"
                color="neutral"
                variant="solid"
                class="absolute left-2 top-2"
            />
        </div>
        <div class="flex flex-1 flex-col gap-2 p-3">
            <div class="flex items-start justify-between gap-2">
                <h4 class="text-sm font-semibold text-highlighted">
                    {{ premio.nombre }}
                </h4>
                <UBadge
                    :label="tipo.etiqueta"
                    :icon="tipo.icono"
                    color="neutral"
                    variant="subtle"
                    size="sm"
                    class="shrink-0"
                    data-prueba="premio-tipo"
                />
            </div>
            <p class="text-sm tabular-nums text-highlighted">
                {{ formatearQuetzales(premio.valor) }}
                <span
                    v-if="premio.cantidad > 1"
                    class="text-muted"
                >× {{ premio.cantidad }}</span>
            </p>
            <p
                v-if="catalogo"
                class="text-xs text-muted"
            >
                Del catálogo: {{ catalogo }}
            </p>
            <p class="text-xs text-muted">
                {{ premio.retiene_isr ? `ISR ${formatearPorcentaje(premio.isr_pct)} %: ${formatearQuetzales(isr)}${premio.tipo === 'efectivo' ? ' (se retiene)' : ' (lo asume la empresa)'}` : 'Sin ISR' }}
            </p>
            <p class="mt-auto text-xs text-muted">
                {{ tipo.entrega }}
            </p>
            <UButton
                v-if="puedeSubirImagen"
                :label="premio.imagen_archivo_id ? 'Cambiar imagen' : 'Subir imagen'"
                icon="i-lucide-image-up"
                color="neutral"
                variant="outline"
                size="sm"
                class="self-start"
                :aria-label="`${premio.imagen_archivo_id ? 'Cambiar' : 'Subir'} la imagen del premio ${premio.posicion}`"
                data-prueba="subir-imagen-premio"
                @click="emit('subirImagen', premio)"
            />
        </div>
    </article>
</template>
