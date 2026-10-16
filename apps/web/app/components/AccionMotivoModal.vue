<script setup lang="ts" generic="T">
import type { Problem } from '@argosisp/contracts'
import type { ButtonProps, FormSubmitEvent } from '@nuxt/ui'

/**
 * Confirmación con motivo de una acción explícita (`POST /facturas/:id/anular`,
 * `POST /pagos/:id/anular`…). Una `Idempotency-Key` por apertura: reintentar tras un corte de
 * red no repite la acción. Con 501, 409 o 422 el error se muestra aquí y nada cambia.
 */
const props = withDefaults(defineProps<{
    titulo: string
    descripcion?: string
    /** Qué pasa al confirmar, en una frase. */
    efecto: string
    confirmar: string
    icono?: string
    color?: ButtonProps['color']
    placeholder?: string
    ejecutar: (motivo: string, claveIdempotencia: string) => Promise<Resultado<T>>
}>(), {
    descripcion: undefined,
    icono: 'i-lucide-ban',
    color: 'error',
    placeholder: 'Ej.: se emitió con el plan equivocado',
})

const abierto = defineModel<boolean>('open', { default: false })

const emit = defineEmits<{
    hecho: [resultado: T]
}>()

const idFormulario = useId()
const estado = reactive<{ motivo: string }>({ motivo: '' })
const enviando = ref(false)
const problema = ref<Problem | null>(null)
let claveIdempotencia = nuevaClaveIdempotencia()

watch(abierto, (valor) => {
    if (valor) {
        estado.motivo = ''
        problema.value = null
        claveIdempotencia = nuevaClaveIdempotencia()
    }
})

async function enviar(evento: FormSubmitEvent<DatosMotivo>) {
    enviando.value = true
    problema.value = null
    const resultado = await props.ejecutar(evento.data.motivo, claveIdempotencia)
    enviando.value = false
    if (resultado.ok) {
        abierto.value = false
        emit('hecho', resultado.data)
        return
    }
    problema.value = resultado.problema
}
</script>

<template>
    <UModal
        v-model:open="abierto"
        :title="titulo"
        :description="descripcion"
        :dismissible="!enviando"
    >
        <template #body>
            <UForm
                :id="idFormulario"
                :schema="esquemaMotivo"
                :state="estado"
                class="flex flex-col gap-4"
                @submit="enviar"
            >
                <UAlert
                    :color="color === 'error' ? 'error' : 'neutral'"
                    variant="subtle"
                    :icon="icono"
                    :description="efecto"
                />

                <UFormField
                    label="Motivo"
                    name="motivo"
                    required
                    help="Queda en la bitácora junto con tu usuario."
                >
                    <UTextarea
                        v-model="estado.motivo"
                        :rows="3"
                        autofocus
                        :placeholder="placeholder"
                        class="w-full"
                    />
                </UFormField>

                <ProblemaAlerta
                    v-if="problema"
                    :problema="problema"
                />
            </UForm>
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
                    type="submit"
                    :form="idFormulario"
                    :label="confirmar"
                    :icon="icono"
                    :color="color"
                    :loading="enviando"
                />
            </div>
        </template>
    </UModal>
</template>
