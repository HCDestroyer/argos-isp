<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'

/**
 * Vista previa del archivo de un comprobante (foto JPG/PNG/WebP o PDF). El archivo se pide con el
 * token (`GET /comprobantes/:id/archivo` como `Blob`) y se muestra con una URL de objeto que se
 * libera al salir. Con error muestra el Problem y "Reintentar", nunca una imagen vacía.
 * Visor oscuro con ampliar, girar y descargar a la derecha (tablero OperComprobantes).
 */
const props = defineProps<{
    comprobante: Comprobante
}>()

const url = ref<string | null>(null)
const cargando = ref(false)
const problema = ref<Problem | null>(null)
const pdf = computed(() => esPdf(props.comprobante))
/** Lupa y giro del visor (tablero OperComprobantes): solo cambian cómo se ve, nunca el archivo. */
const ampliado = ref(false)
const giro = ref(0)

function girar() {
    giro.value = (giro.value + 90) % 360
}

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

watch(() => props.comprobante.id, () => {
    ampliado.value = false
    giro.value = 0
    void cargar()
})
onMounted(cargar)
onBeforeUnmount(liberar)
</script>

<template>
    <div
        class="relative flex min-h-56 flex-col overflow-hidden rounded-2xl bg-slate-900 text-white sm:min-h-64"
        data-prueba="visor-comprobante"
    >
        <p class="pointer-events-none absolute start-3 top-3 z-10 max-w-40 text-xs leading-snug text-white/80">
            Compara la referencia, la fecha y el monto con la banca en línea
        </p>

        <div
            v-if="url"
            class="absolute end-3 top-3 z-10 flex flex-col gap-2"
        >
            <UButton
                v-if="!pdf"
                :icon="ampliado ? 'i-lucide-zoom-out' : 'i-lucide-zoom-in'"
                color="neutral"
                variant="soft"
                size="sm"
                class="rounded-lg bg-white/10 text-white hover:bg-white/20"
                :aria-label="ampliado ? 'Reducir la foto' : 'Ampliar la foto'"
                :title="ampliado ? 'Reducir' : 'Ampliar'"
                @click="ampliado = !ampliado"
            />
            <UButton
                v-if="!pdf"
                icon="i-lucide-rotate-cw"
                color="neutral"
                variant="soft"
                size="sm"
                class="rounded-lg bg-white/10 text-white hover:bg-white/20"
                aria-label="Girar la foto"
                title="Girar"
                @click="girar"
            />
            <UButton
                :to="url"
                target="_blank"
                :download="comprobante.archivo_nombre ?? `comprobante-${comprobante.id}`"
                icon="i-lucide-download"
                color="neutral"
                variant="soft"
                size="sm"
                class="rounded-lg bg-white/10 text-white hover:bg-white/20"
                :aria-label="`Descargar ${comprobante.archivo_nombre ?? 'el archivo'} (${formatearTamano(comprobante.archivo_tamano)})`"
                title="Descargar"
            />
        </div>

        <div
            v-if="problema"
            class="m-auto w-full max-w-md p-4 pt-14"
        >
            <ProblemaAlerta
                :problema="problema"
                :reintentar="cargar"
                :reintentando="cargando"
            />
        </div>

        <USkeleton
            v-else-if="cargando || !url"
            class="m-4 mt-14 h-48 flex-1 bg-white/10"
        />

        <iframe
            v-else-if="pdf"
            :src="url"
            :title="`Comprobante #${comprobante.id} (PDF)`"
            class="h-[28rem] w-full bg-white lg:h-[32rem]"
            data-prueba="comprobante-pdf"
        />

        <div
            v-else
            class="flex flex-1 items-center justify-center p-4 pt-16"
            :class="ampliado ? 'overflow-auto' : 'overflow-hidden'"
            data-ampliar
        >
            <img
                :src="url"
                :alt="`Foto del comprobante #${comprobante.id}, referencia ${comprobante.referencia}`"
                class="rounded object-contain shadow-2xl transition-transform"
                :class="ampliado ? 'max-h-none max-w-none' : 'max-h-72 max-w-full lg:max-h-80'"
                :style="{ transform: `rotate(${giro}deg)` }"
                data-prueba="comprobante-imagen"
            >
        </div>
    </div>
</template>
