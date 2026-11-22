<script setup lang="ts">
/**
 * Hasta 3 fotos o PDF de 10 MB para un ticket (contrato Iris 0.14.2 §11.6). Iris solo acepta JPEG,
 * PNG y PDF: cada foto de otro tipo (HEIC del iPhone, WebP…) o de más de 10 MB se convierte a JPEG
 * en el navegador al elegirla (`prepararArchivo`); la que no se puede leer no se adjunta y se pide
 * otra. El tipo real lo revisa la API por el contenido; aquí solo se avisa antes de enviar.
 */
const archivos = defineModel<File[]>({ default: () => [] })
/** Mientras se convierte una foto: el formulario no se envía. */
const preparando = defineModel<boolean>('preparando', { default: false })

const errorFoto = ref<string | null>(null)
const error = computed(() => errorFoto.value ?? errorAdjuntos(archivos.value))

/** Solo cuenta la última elección (el cliente puede elegir otra foto a mitad de la conversión). */
let eleccion = 0

/** `UFileUpload` agrega los nuevos al final: se preparan solo esos, los que ya estaban quedan igual. */
async function elegir(lista: File[] | null | undefined) {
    const anteriores = archivos.value
    const todos = lista ?? []
    const nuevos = todos.filter(archivo => !anteriores.includes(archivo))
    const quedan = todos.filter(archivo => anteriores.includes(archivo))
    eleccion += 1
    const turno = eleccion
    if (nuevos.length === 0) {
        archivos.value = quedan
        return
    }
    errorFoto.value = null
    preparando.value = true
    const resultados = await Promise.all(nuevos.map(archivo => prepararArchivo(archivo, ADJUNTO_TAMANO_MAXIMO)))
    if (turno !== eleccion) {
        return
    }
    preparando.value = false
    const fallido = resultados.find(resultado => !resultado.ok)
    if (fallido && !fallido.ok) {
        errorFoto.value = fallido.error
    }
    archivos.value = [
        ...quedan,
        ...resultados.flatMap(resultado => resultado.ok ? [resultado.archivo] : []),
    ]
}

function quitar(indice: number) {
    errorFoto.value = null
    archivos.value = archivos.value.filter((_, i) => i !== indice)
}

defineExpose({ error })
</script>

<template>
    <UFormField
        label="Fotos o PDF (opcional)"
        :help="`Hasta ${ADJUNTOS_MAXIMO} archivos de 10 MB.`"
        :error="error ?? undefined"
    >
        <UFileUpload
            :model-value="archivos"
            multiple
            :accept="ADJUNTO_ACEPTA"
            :dropzone="false"
            :interactive="false"
            class="w-full"
            data-testid="soporte-adjuntos"
            @update:model-value="elegir"
        >
            <template #default="{ open: abrir }">
                <div class="flex flex-col gap-2">
                    <ul
                        v-if="archivos.length > 0"
                        class="flex flex-col gap-2"
                    >
                        <li
                            v-for="(archivo, indice) in archivos"
                            :key="`${archivo.name}-${indice}`"
                            class="flex items-center gap-3 rounded-lg border border-default p-2"
                        >
                            <UIcon
                                :name="archivo.type === 'application/pdf' ? 'i-lucide-file-text' : 'i-lucide-image'"
                                class="size-5 shrink-0 text-muted"
                            />
                            <span class="min-w-0 flex-1 truncate text-sm">{{ archivo.name }}</span>
                            <span class="shrink-0 text-xs text-muted">{{ tamanoArchivo(archivo.size) }}</span>
                            <UButton
                                icon="i-lucide-x"
                                color="neutral"
                                variant="ghost"
                                :aria-label="`Quitar ${archivo.name}`"
                                @click="quitar(indice)"
                            />
                        </li>
                    </ul>
                    <p
                        v-if="preparando"
                        class="flex items-center gap-2 text-sm text-muted"
                        aria-live="polite"
                        data-testid="soporte-adjuntos-preparando"
                    >
                        <UIcon
                            name="i-lucide-loader-circle"
                            class="size-4 shrink-0 animate-spin"
                        />
                        Preparando la foto…
                    </p>
                    <UButton
                        v-else-if="archivos.length < ADJUNTOS_MAXIMO"
                        label="Adjuntar foto o PDF"
                        icon="i-lucide-paperclip"
                        color="neutral"
                        variant="outline"
                        class="self-start"
                        @click="abrir()"
                    />
                </div>
            </template>
        </UFileUpload>
    </UFormField>
</template>
