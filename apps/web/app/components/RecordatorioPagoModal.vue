<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { FormSubmitEvent } from '@nuxt/ui'
import * as z from 'zod'

/**
 * Un recordatorio de pago (A6): días respecto al vencimiento (negativo = antes), hora de Guatemala
 * y activo. `PUT /notificaciones/recordatorios/:id` con la `version` (409). El texto del aviso es la
 * plantilla `recordatorio.<orden>` de cada canal.
 */
const props = defineProps<{
    recordatorio: RecordatorioPago
}>()

const abierto = defineModel<boolean>('open', { default: false })
const emit = defineEmits<{ guardado: [recordatorio: RecordatorioPago] }>()

/** Espejo de `editarRecordatorioValidator`: días −60…60, hora HH:MM. */
const esquema = z.object({
    dias: z.number({ message: 'Escribe los días' }).int('Solo enteros').min(-60, 'Entre −60 y 60').max(60, 'Entre −60 y 60'),
    hora: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Hora en formato HH:MM'),
    activo: z.boolean(),
})
type Entrada = z.input<typeof esquema>

const formulario = useTemplateRef('formulario')
const estado = reactive<Entrada>({ dias: 0, hora: '09:00', activo: true })
const enviando = ref(false)
const problema = ref<Problem | null>(null)

watch(abierto, (valor) => {
    if (valor) {
        Object.assign(estado, { dias: props.recordatorio.dias, hora: props.recordatorio.hora.slice(0, 5), activo: props.recordatorio.activo })
        problema.value = null
    }
}, { immediate: true })

async function enviar(evento: FormSubmitEvent<z.output<typeof esquema>>) {
    enviando.value = true
    problema.value = null
    const resultado = await useRecordatoriosPago().editar(props.recordatorio.id, { version: props.recordatorio.version, ...evento.data })
    enviando.value = false
    if (resultado.ok) {
        abierto.value = false
        emit('guardado', resultado.data)
        return
    }
    const errores = erroresDeFormulario(resultado.problema)
    if (errores.length) {
        formulario.value?.setErrors(errores)
        return
    }
    problema.value = resultado.problema
}
</script>

<template>
    <UModal
        v-model:open="abierto"
        :title="`Recordatorio ${recordatorio.orden}`"
        description="Se envía a los clientes con la factura sin pagar, por su canal preferido."
        :dismissible="!enviando"
    >
        <template #body>
            <UForm
                id="form-recordatorio"
                ref="formulario"
                :schema="esquema"
                :state="estado"
                class="flex flex-col gap-4"
                @submit="enviar"
            >
                <UFormField
                    label="Días respecto al vencimiento"
                    name="dias"
                    required
                    :help="typeof estado.dias === 'number' ? diasRecordatorio(estado.dias) : 'Negativo = antes; 0 = el día que vence; positivo = después.'"
                >
                    <UInputNumber
                        v-model="estado.dias"
                        :min="-60"
                        :max="60"
                        class="w-full"
                        data-prueba="recordatorio-dias"
                    />
                </UFormField>
                <UFormField
                    label="Hora"
                    name="hora"
                    required
                    help="Hora de Guatemala."
                >
                    <UInput
                        v-model="estado.hora"
                        type="time"
                        class="w-full"
                        data-prueba="recordatorio-hora"
                    />
                </UFormField>
                <USwitch
                    v-model="estado.activo"
                    label="Activo"
                />
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
                    form="form-recordatorio"
                    label="Guardar"
                    icon="i-lucide-save"
                    :loading="enviando"
                    data-prueba="recordatorio-guardar"
                />
            </div>
        </template>
    </UModal>
</template>
