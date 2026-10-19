<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'

/**
 * Subir, cambiar o quitar la imagen de un anuncio (`POST /anuncios/:id/imagen`, multipart). Los
 * mismos límites que la API: PNG, JPEG o WebP, hasta 1 MB y de 64 a 4096 px por lado, con texto
 * alternativo obligatorio. Vista previa local antes de subir; con 409 o 422 el error se ve aquí y
 * nada cambia.
 */
const props = defineProps<{
    anuncio: Anuncio
    /** URL de objeto de la imagen actual. */
    actual: string | null
}>()

const abierto = defineModel<boolean>('open', { default: false })
const emit = defineEmits<{ guardado: [anuncio: Anuncio] }>()

const archivo = ref<File | null>(null)
const alt = ref('')
const vistaPrevia = ref<string | null>(null)
const medidas = ref<{ ancho: number, alto: number } | null>(null)
const errorArchivo = ref<string | null>(null)
const errorAlt = ref<string | null>(null)
const problema = ref<Problem | null>(null)
const enviando = ref(false)

function limpiarVista() {
    if (vistaPrevia.value) {
        URL.revokeObjectURL(vistaPrevia.value)
    }
    vistaPrevia.value = null
    medidas.value = null
}

watch(abierto, (valor) => {
    if (valor) {
        archivo.value = null
        alt.value = props.anuncio.imagen?.alt ?? ''
        errorArchivo.value = null
        errorAlt.value = null
        problema.value = null
    }
    else {
        limpiarVista()
    }
})

/** Las medidas de la imagen elegida (la API rechaza menos de 64 o más de 4096 px por lado). */
function leerMedidas(url: string): Promise<{ ancho: number, alto: number } | null> {
    return new Promise((listo) => {
        const imagen = new Image()
        imagen.onload = () => listo({ ancho: imagen.naturalWidth, alto: imagen.naturalHeight })
        imagen.onerror = () => listo(null)
        imagen.src = url
    })
}

watch(archivo, async (nuevo) => {
    limpiarVista()
    problema.value = null
    errorArchivo.value = nuevo ? errorArchivoImagen(nuevo) : null
    if (!nuevo || errorArchivo.value) {
        return
    }
    const url = URL.createObjectURL(nuevo)
    vistaPrevia.value = url
    const leidas = await leerMedidas(url)
    if (archivo.value !== nuevo) {
        return
    }
    medidas.value = leidas
    errorArchivo.value = leidas ? errorMedidasImagen(leidas.ancho, leidas.alto) : 'No se pudo leer la imagen'
})

onBeforeUnmount(limpiarVista)

async function subir() {
    errorAlt.value = alt.value.trim() ? (alt.value.trim().length > 200 ? 'Máximo 200 caracteres' : null) : 'Describe la imagen para quien no la ve'
    if (!archivo.value || errorArchivo.value || errorAlt.value) {
        return
    }
    await enviar(archivo.value)
}

async function enviar(nuevo: File | null) {
    enviando.value = true
    problema.value = null
    const resultado = await useAnuncios().cambiarImagen(props.anuncio.id, props.anuncio.version, nuevo, alt.value.trim())
    enviando.value = false
    if (resultado.ok) {
        abierto.value = false
        emit('guardado', resultado.data)
        return
    }
    const errores = erroresDeFormulario(resultado.problema)
    const enAlt = errores.find(e => e.name === 'alt')
    const enImagen = errores.find(e => e.name === 'imagen')
    errorAlt.value = enAlt?.message ?? null
    errorArchivo.value = enImagen?.message ?? null
    problema.value = problemaAnuncioLegible(resultado.problema)
}
</script>

<template>
    <UModal
        v-model:open="abierto"
        :title="anuncio.imagen ? 'Cambiar la imagen' : 'Agregar imagen'"
        description="PNG, JPEG o WebP de hasta 1 MB. Recomendado: 1200×600 px (2:1)."
        :dismissible="!enviando"
    >
        <template #body>
            <div class="flex flex-col gap-4">
                <div class="overflow-hidden rounded-lg bg-elevated ring ring-default">
                    <img
                        v-if="vistaPrevia || actual"
                        :src="vistaPrevia ?? actual ?? undefined"
                        :alt="vistaPrevia ? 'Vista previa de la imagen nueva' : (anuncio.imagen?.alt ?? '')"
                        class="aspect-2/1 w-full object-cover"
                        data-prueba="anuncio-imagen-vista"
                    >
                    <div
                        v-else
                        class="flex aspect-2/1 w-full items-center justify-center text-dimmed"
                    >
                        <UIcon
                            name="i-lucide-image-off"
                            class="size-8"
                        />
                    </div>
                </div>
                <p
                    v-if="medidas"
                    class="text-xs text-muted"
                >
                    {{ medidas.ancho }}×{{ medidas.alto }} px · se recorta a 2:1 en el portal.
                </p>

                <UFormField
                    label="Archivo"
                    :error="errorArchivo ?? undefined"
                >
                    <UFileUpload
                        v-model="archivo"
                        accept="image/png,image/jpeg,image/webp"
                        label="Elige o arrastra la imagen"
                        description="PNG, JPEG o WebP, hasta 1 MB"
                        icon="i-lucide-image-up"
                        class="w-full"
                        data-prueba="anuncio-imagen-archivo"
                    />
                </UFormField>
                <UFormField
                    label="Texto alternativo"
                    required
                    help="Qué muestra la imagen, para quien usa un lector de pantalla."
                    :error="errorAlt ?? undefined"
                    :hint="`${alt.length}/200`"
                >
                    <UInput
                        v-model="alt"
                        :maxlength="200"
                        placeholder="Familia viendo una película en la sala"
                        class="w-full"
                        data-prueba="anuncio-imagen-alt"
                    />
                </UFormField>

                <ProblemaAlerta
                    v-if="problema"
                    :problema="problema"
                />
            </div>
        </template>

        <template #footer>
            <div class="flex w-full flex-col-reverse gap-2 sm:flex-row sm:justify-between">
                <UButton
                    v-if="anuncio.imagen"
                    label="Quitar imagen"
                    icon="i-lucide-trash-2"
                    color="error"
                    variant="ghost"
                    :loading="enviando"
                    class="justify-center"
                    data-prueba="anuncio-imagen-quitar"
                    @click="enviar(null)"
                />
                <span v-else />
                <UButton
                    label="Subir imagen"
                    icon="i-lucide-upload"
                    :disabled="!archivo || Boolean(errorArchivo)"
                    :loading="enviando"
                    class="justify-center"
                    data-prueba="anuncio-imagen-subir"
                    @click="subir"
                />
            </div>
        </template>
    </UModal>
</template>
