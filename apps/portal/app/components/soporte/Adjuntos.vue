<script setup lang="ts">
/**
 * Hasta 3 fotos o PDF de 10 MB para un ticket (contrato Iris 0.9.0 §11.6). El tipo real lo revisa la
 * API por el contenido; aquí solo se avisa antes de enviar si son demasiados o muy grandes.
 */
const archivos = defineModel<File[]>({ default: () => [] })

const error = computed(() => errorAdjuntos(archivos.value))

function quitar(indice: number) {
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
            v-model="archivos"
            multiple
            :accept="ADJUNTO_ACEPTA"
            :dropzone="false"
            :interactive="false"
            class="w-full"
            data-testid="soporte-adjuntos"
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
                    <UButton
                        v-if="archivos.length < ADJUNTOS_MAXIMO"
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
