<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'

/**
 * Vista previa del archivo de un comprobante (foto JPG/PNG/WebP o PDF). El archivo se pide con el
 * token (`GET /comprobantes/:id/archivo` como `Blob`) y se muestra con una URL de objeto que se
 * libera al salir. Con error muestra el Problem y "Reintentar", nunca una imagen vacía.
 */
const props = defineProps<{
    comprobante: Comprobante
}>()

const url = ref<string | null>(null)
const cargando = ref(false)
const problema = ref<Problem | null>(null)
const pdf = computed(() => esPdf(props.comprobante))

function liberar() {
    if (url.value) {
        URL.revokeObjectURL(url.value)
        url.value = null
    }
}

async function cargar() {
    cargando.value = true
    problema.value = null
    const resultado = await useComprobantes().archivo(props.comprobante.id)
    cargando.value = false
    liberar()
    if (!resultado.ok) {
        problema.value = resultado.problema
        return
    }
    // El `Blob` trae el `Content-Type` de la respuesta; si el navegador no lo puso, se usa el del comprobante.
    const blob = resultado.data.type ? resultado.data : new Blob([resultado.data], { type: props.comprobante.archivo_tipo })
    url.value = URL.createObjectURL(blob)
}

watch(() => props.comprobante.id, cargar)
onMounted(cargar)
onBeforeUnmount(liberar)
</script>

<template>
    <div class="flex flex-col gap-2">
        <div class="flex flex-wrap items-center justify-between gap-2">
            <p class="min-w-0 truncate text-xs text-muted">
                <UIcon
                    :name="pdf ? 'i-lucide-file-text' : 'i-lucide-image'"
                    class="mr-1 size-3.5 align-[-2px]"
                />
                {{ comprobante.archivo_nombre ?? (pdf ? 'Documento PDF' : 'Foto') }} · {{ formatearTamano(comprobante.archivo_tamano) }}
            </p>
            <UButton
                v-if="url"
                :to="url"
                target="_blank"
                label="Abrir en otra pestaña"
                icon="i-lucide-external-link"
                color="neutral"
                variant="ghost"
                size="xs"
            />
        </div>

        <ProblemaAlerta
            v-if="problema"
            :problema="problema"
            :reintentar="cargar"
            :reintentando="cargando"
        />

        <USkeleton
            v-else-if="cargando || !url"
            class="aspect-[4/3] w-full"
        />

        <iframe
            v-else-if="pdf"
            :src="url"
            :title="`Comprobante #${comprobante.id} (PDF)`"
            class="h-[28rem] w-full rounded-md border border-default bg-elevated lg:h-[36rem]"
            data-prueba="comprobante-pdf"
        />

        <div
            v-else
            class="flex justify-center rounded-md border border-default bg-elevated p-2"
        >
            <img
                :src="url"
                :alt="`Foto del comprobante #${comprobante.id}, referencia ${comprobante.referencia}`"
                class="max-h-[36rem] w-auto max-w-full rounded object-contain"
                data-prueba="comprobante-imagen"
            >
        </div>
    </div>
</template>
