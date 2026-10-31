<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'

/**
 * Adjunta el papel firmado de una orden recibida con `firma_papel`
 * (`POST /inventario/traslados/:id/documento`, `inventario.adjuntar_documento_traslado`): la foto o el
 * escaneo, JPG, PNG, WebP o PDF de hasta 5 MB, una sola vez (409 `documento_registrado`).
 */
const props = defineProps<{
    orden: Pick<OrdenTraslado, 'id' | 'numero'>
}>()

const abierto = defineModel<boolean>('open', { default: false })
const emit = defineEmits<{ adjuntado: [orden: OrdenTrasladoDetalle] }>()

const archivo = ref<File | null>(null)
const nota = ref('')
const error = ref<string | null>(null)
const problema = ref<Problem | null>(null)
const enviando = ref(false)
let clave = nuevaClaveIdempotencia()

watch(abierto, (valor) => {
    if (valor) {
        archivo.value = null
        nota.value = ''
        error.value = null
        problema.value = null
        clave = nuevaClaveIdempotencia()
    }
})

watch(archivo, async (nuevo) => {
    error.value = nuevo ? errorArchivoSorteo(new Uint8Array(await nuevo.arrayBuffer())) : null
})

async function adjuntar() {
    if (!archivo.value) {
        error.value = 'Elige la foto o el escaneo del papel firmado'
        return
    }
    if (error.value) {
        return
    }
    enviando.value = true
    problema.value = null
    const resultado = await useOrdenesTraslado().adjuntarDocumento(props.orden.id, archivo.value, nota.value.trim() || null, clave)
    enviando.value = false
    if (resultado.ok) {
        abierto.value = false
        emit('adjuntado', resultado.data)
        return
    }
    problema.value = resultado.problema
}
</script>

<template>
    <UModal
        v-model:open="abierto"
        :title="`Papel firmado de la orden N.º ${orden.numero}`"
        description="La foto o el escaneo de la orden impresa y firmada por quien recibió."
        :dismissible="!enviando"
    >
        <template #body>
            <div class="flex flex-col gap-4">
                <UFormField
                    label="Archivo"
                    name="archivo"
                    required
                    :error="error ?? undefined"
                >
                    <UFileUpload
                        v-model="archivo"
                        accept="image/png,image/jpeg,image/webp,application/pdf"
                        label="Elige, arrastra o toma la foto"
                        description="JPG, PNG, WebP o PDF, hasta 5 MB"
                        icon="i-lucide-file-up"
                        class="w-full"
                        data-prueba="traslado-documento-archivo"
                    />
                </UFormField>
                <UFormField
                    label="Nota"
                    name="nota"
                    help="Opcional; queda en la bitácora."
                >
                    <UInput
                        v-model="nota"
                        class="w-full"
                        maxlength="500"
                    />
                </UFormField>
                <ProblemaAlerta
                    v-if="problema"
                    :problema="problema"
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
                    label="Adjuntar"
                    icon="i-lucide-paperclip"
                    :loading="enviando"
                    data-prueba="traslado-documento-adjuntar"
                    @click="adjuntar"
                />
            </div>
        </template>
    </UModal>
</template>
