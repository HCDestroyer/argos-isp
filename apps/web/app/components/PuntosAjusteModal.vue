<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { FormSubmitEvent } from '@nuxt/ui'

/**
 * Ajuste manual de puntos (`POST /lealtad/ajustes`, `lealtad.ajustar`) con su `Idempotency-Key` por
 * apertura: positivo agrega un lote, negativo descuenta sin dejar el saldo negativo (422
 * `saldo_insuficiente`). El motivo queda en la bitácora.
 */
const props = defineProps<{
    clienteId: number
    clienteNombre: string
}>()

const abierto = defineModel<boolean>('open', { default: false })

const emit = defineEmits<{
    hecho: [ajuste: AjustePuntos]
}>()

const formulario = useTemplateRef('formulario')
const estado = reactive<EntradaAjustePuntos>({ puntos: 0, motivo: '', servicio_id: null })
const enviando = ref(false)
const problema = ref<Problem | null>(null)
let clave = nuevaClaveIdempotencia()

watch(abierto, (valor) => {
    if (valor) {
        Object.assign(estado, { puntos: 0, motivo: '', servicio_id: null })
        problema.value = null
        clave = nuevaClaveIdempotencia()
    }
})

async function enviar(evento: FormSubmitEvent<EntradaAjustePuntos>) {
    enviando.value = true
    problema.value = null
    const resultado = await usePuntosLealtad().ajustar({ cliente_id: props.clienteId, puntos: evento.data.puntos, motivo: evento.data.motivo }, clave)
    enviando.value = false
    if (resultado.ok) {
        abierto.value = false
        emit('hecho', resultado.data)
        return
    }
    formulario.value?.setErrors(erroresDeFormulario(resultado.problema).filter(e => e.name && Object.hasOwn(estado, e.name)))
    problema.value = resultado.problema
}
</script>

<template>
    <UModal
        v-model:open="abierto"
        title="Ajustar puntos"
        :description="clienteNombre"
        :dismissible="!enviando"
    >
        <template #body>
            <UForm
                id="form-ajuste-puntos"
                ref="formulario"
                :schema="esquemaAjustePuntos"
                :state="estado"
                class="flex flex-col gap-4"
                @submit="enviar"
            >
                <UFormField
                    label="Puntos"
                    name="puntos"
                    required
                    help="Positivo agrega puntos; negativo los descuenta (sin dejar el saldo negativo)."
                >
                    <UInputNumber
                        v-model="estado.puntos"
                        :min="-1000000"
                        :max="1000000"
                        class="w-full"
                        data-prueba="ajuste-puntos"
                    />
                </UFormField>
                <UFormField
                    label="Motivo"
                    name="motivo"
                    required
                    help="Queda en la bitácora junto con tu usuario."
                >
                    <UTextarea
                        v-model="estado.motivo"
                        :rows="2"
                        placeholder="Ej.: compensación por la falla del 12 de octubre"
                        class="w-full"
                        data-prueba="ajuste-motivo"
                    />
                </UFormField>
                <ProblemaAlerta
                    v-if="problema"
                    :problema="problema"
                    data-prueba="ajuste-error"
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
                    form="form-ajuste-puntos"
                    label="Ajustar puntos"
                    icon="i-lucide-pencil"
                    :loading="enviando"
                    data-prueba="ajuste-confirmar"
                />
            </div>
        </template>
    </UModal>
</template>
