<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { FormSubmitEvent } from '@nuxt/ui'
import * as z from 'zod'

/**
 * Quitar un adicional del servicio (`POST …/:asignacionId/quitar`, `servicios.quitar_adicional`):
 * es una baja con fecha, nunca se borra. El motivo es opcional (3 a 500 caracteres si se escribe).
 */
const props = defineProps<{
    servicioId: number
    asignacion: AdicionalServicio
}>()

const abierto = defineModel<boolean>('open', { default: false })
const emit = defineEmits<{ hecho: [asignacion: AdicionalServicio] }>()

const esquema = z.object({
    motivo: z.string().trim().refine(valor => valor === '' || (valor.length >= 3 && valor.length <= 500), 'De 3 a 500 caracteres, o déjalo vacío'),
})
type Datos = z.output<typeof esquema>

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
}, { immediate: true })

async function enviar(evento: FormSubmitEvent<Datos>) {
    enviando.value = true
    problema.value = null
    const resultado = await useAdicionalesServicio().quitar(props.servicioId, props.asignacion.id, props.asignacion.version, evento.data.motivo || null, claveIdempotencia)
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
        :title="`Quitar ${asignacion.adicional_nombre}`"
        :description="`${MODALIDADES_ADICIONAL[asignacion.modalidad].etiqueta}${asignacion.identificador ? ` · ${asignacion.identificador}` : ''}`"
        :dismissible="!enviando"
    >
        <template #body>
            <UForm
                :id="idFormulario"
                :schema="esquema"
                :state="estado"
                class="flex flex-col gap-4"
                @submit="enviar"
            >
                <p class="text-sm text-muted">
                    Queda dado de baja con la fecha de hoy y sigue en el historial del servicio.<template v-if="asignacion.modalidad === 'cobrado'">
                        Deja de cobrarse desde el próximo periodo.
                    </template>
                </p>
                <UFormField
                    label="Motivo (opcional)"
                    name="motivo"
                >
                    <UTextarea
                        v-model="estado.motivo"
                        :rows="2"
                        placeholder="Ej.: el cliente ya no usa la cuenta"
                        class="w-full"
                        data-prueba="motivo-quitar-adicional"
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
                    label="Quitar adicional"
                    icon="i-lucide-trash-2"
                    color="error"
                    :loading="enviando"
                    data-prueba="confirmar-quitar-adicional"
                />
            </div>
        </template>
    </UModal>
</template>
