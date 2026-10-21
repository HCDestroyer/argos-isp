<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'

/**
 * Sube la imagen de un premio (`POST /lealtad/sorteos/:id/premios/:posicion/imagen`, acción
 * `sorteos.subir_imagen_premio`, permiso `sorteos.gestionar`, solo en borrador). El portal no carga URLs
 * externas, así que la imagen se sube y la sirve la API. Antes de subirla se revisa con las mismas
 * reglas que la API (PNG, JPEG o WebP por su contenido, hasta 1 MB, de 64 a 4096 px por lado) y se
 * muestra la vista previa; con 409 o 422 se ve el error y nada cambia.
 */
const props = defineProps<{
    sorteoId: number
    premio: PremioSorteo | null
}>()

const abierto = defineModel<boolean>('open', { default: false })
const emit = defineEmits<{ hecho: [sorteo: SorteoDetalle] }>()

const archivo = ref<File | null>(null)
const vistaPrevia = ref<string | null>(null)
const errorLocal = ref<string | null>(null)
const problema = ref<Problem | null>(null)
const enviando = ref(false)
const revisando = ref(false)

function limpiarVista() {
    if (vistaPrevia.value) {
        URL.revokeObjectURL(vistaPrevia.value)
    }
    vistaPrevia.value = null
}

watch(abierto, (valor) => {
    if (valor) {
        archivo.value = null
        errorLocal.value = null
        problema.value = null
    }
    else {
        limpiarVista()
    }
})

watch(archivo, async (nuevo) => {
    limpiarVista()
    problema.value = null
    errorLocal.value = null
    if (!nuevo) {
        return
    }
    revisando.value = true
    const error = errorImagenPremio(new Uint8Array(await nuevo.arrayBuffer()))
    revisando.value = false
    if (archivo.value !== nuevo) {
        return
    }
    errorLocal.value = error
    if (!error) {
        vistaPrevia.value = URL.createObjectURL(nuevo)
    }
})

onBeforeUnmount(limpiarVista)

async function enviar() {
    if (!props.premio || !archivo.value || errorLocal.value) {
        return
    }
    enviando.value = true
    problema.value = null
    const resultado = await useSorteos().subirImagenPremio(props.sorteoId, props.premio.posicion, archivo.value)
    enviando.value = false
    if (resultado.ok) {
        abierto.value = false
        emit('hecho', resultado.data)
        return
    }
    const errorCampo = resultado.problema.errors?.find(e => e.field === 'imagen')
    if (errorCampo) {
        errorLocal.value = errorCampo.message
        return
    }
    problema.value = problemaSorteoLegible(resultado.problema)
}
</script>

<template>
    <UModal
        v-model:open="abierto"
        title="Imagen del premio"
        :description="premio ? `${premio.posicion}.º · ${premio.nombre}` : undefined"
        :dismissible="!enviando"
    >
        <template #body>
            <div class="flex flex-col gap-4">
                <div
                    v-if="vistaPrevia"
                    class="aspect-[8/5] w-full overflow-hidden rounded-lg border border-default bg-elevated"
                >
                    <img
                        :src="vistaPrevia"
                        :alt="premio ? `Vista previa: ${premio.nombre}` : 'Vista previa'"
                        class="size-full object-cover"
                        data-prueba="imagen-premio-vista"
                    >
                </div>
                <UFormField
                    label="Archivo"
                    :error="errorLocal ?? undefined"
                >
                    <UFileUpload
                        v-model="archivo"
                        :accept="TIPOS_IMAGEN_PREMIO"
                        label="Elija o arrastre la imagen"
                        description="PNG, JPEG o WebP, hasta 1 MB, de 64 a 4096 px por lado"
                        icon="i-lucide-image-up"
                        class="w-full"
                        data-prueba="imagen-premio-archivo"
                    />
                </UFormField>
                <p class="text-xs text-muted">
                    Se ve en la ficha y en el portal (si el sorteo se anuncia ahí). Al publicar las bases ya no se puede cambiar.
                </p>
                <ProblemaAlerta
                    v-if="problema"
                    :problema="problema"
                    data-prueba="imagen-premio-problema"
                />
            </div>
        </template>
        <template #footer>
            <div class="flex w-full justify-end gap-2">
                <UButton
                    label="Cancelar"
                    color="neutral"
                    variant="ghost"
                    :disabled="enviando"
                    @click="abierto = false"
                />
                <UButton
                    label="Subir imagen"
                    icon="i-lucide-upload"
                    :loading="enviando || revisando"
                    :disabled="!archivo || !!errorLocal"
                    data-prueba="confirmar-imagen-premio"
                    @click="enviar"
                />
            </div>
        </template>
    </UModal>
</template>
