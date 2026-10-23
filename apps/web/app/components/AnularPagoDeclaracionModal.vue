<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { FormSubmitEvent } from '@nuxt/ui'

/**
 * Anula el pago vigente de una declaración (`POST /declaraciones/:id/anular-pago`,
 * `declaraciones.anular_pago`): revierte su asiento `pago_impuesto` con la fecha indicada (vacía: hoy;
 * nunca antes del pago) y el pago queda en el historial de anulados; después se puede registrar otro.
 * Pide motivo y una confirmación escrita. 409 `declaracion_sin_pago`.
 */
const props = defineProps<{
    declaracion: Declaracion
    pago: NonNullable<Declaracion['pago']>
}>()

const abierto = defineModel<boolean>('open', { default: false })
const emit = defineEmits<{ hecho: [declaracion: Declaracion] }>()

const { puede } = usePermisos()
const hoy = hoyGuatemala()
const esquema = computed(() => esquemaAnularPago(hoy, props.pago.fecha))
const formulario = useTemplateRef('formulario')
const idFormulario = useId()
const estado = reactive<EntradaAnularPago>({ motivo: '', fecha: '' })
const confirmo = ref(false)
const enviando = ref(false)
const problema = ref<Problem | null>(null)
let clave = nuevaClaveIdempotencia()

watch(abierto, (valor) => {
    if (valor) {
        Object.assign(estado, { motivo: '', fecha: '' })
        confirmo.value = false
        problema.value = null
        clave = nuevaClaveIdempotencia()
        formulario.value?.clear()
    }
})

async function enviar(evento: FormSubmitEvent<CuerpoAnularPagoDeclaracion>) {
    enviando.value = true
    problema.value = null
    const resultado = await useDeclaraciones().anularPago(props.declaracion.id, evento.data, clave)
    enviando.value = false
    if (resultado.ok) {
        abierto.value = false
        emit('hecho', resultado.data)
        return
    }
    const errores = erroresDeFormulario(resultado.problema)
    if (resultado.problema.status === 422 && errores.length && errores.every(e => e.name && e.name in estado)) {
        formulario.value?.setErrors(errores)
        return
    }
    problema.value = problemaDeclaracionLegible(resultado.problema)
    clave = nuevaClaveIdempotencia()
}
</script>

<template>
    <UModal
        v-model:open="abierto"
        title="Anular pago"
        :description="`${etiquetaImpuestoDeclaracion(declaracion.impuesto)} de ${etiquetaPeriodoDeclaracion(declaracion)} · versión ${declaracion.version}`"
        :dismissible="!enviando"
    >
        <template #body>
            <UForm
                :id="idFormulario"
                ref="formulario"
                :schema="esquema"
                :state="estado"
                class="flex flex-col gap-4"
                @submit="enviar"
            >
                <UAlert
                    color="error"
                    variant="subtle"
                    icon="i-lucide-undo-2"
                    title="Se revierte el asiento del pago"
                    :description="`El pago del ${formatearFecha(pago.fecha)} por ${formatearQuetzales(pago.total)} (asiento #${pago.asiento_id}) se revierte con un asiento nuevo: el dinero vuelve a su caja o banco y el impuesto queda otra vez por pagar. Nada se borra; el pago anulado queda en el historial.`"
                    data-prueba="anular-pago-aviso"
                />
                <UFormField
                    label="Motivo"
                    name="motivo"
                    required
                    help="Queda en la bitácora junto con tu usuario."
                >
                    <UTextarea
                        v-model="estado.motivo"
                        :rows="2"
                        class="w-full"
                        data-prueba="anular-pago-motivo"
                    />
                </UFormField>
                <UFormField
                    label="Fecha del reverso"
                    name="fecha"
                    :help="`Vacía: hoy. No antes del pago (${formatearFecha(pago.fecha)}).`"
                >
                    <UInput
                        v-model="estado.fecha"
                        type="date"
                        :min="pago.fecha"
                        :max="hoy"
                        class="w-full"
                    />
                </UFormField>
                <UCheckbox
                    v-model="confirmo"
                    label="Entiendo que se revierte el pago y el impuesto vuelve a quedar por pagar"
                    data-prueba="anular-pago-confirmo"
                />
                <ProblemaAlerta
                    v-if="problema"
                    :problema="problema"
                    data-prueba="anular-pago-problema"
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
                    label="Anular pago"
                    icon="i-lucide-undo-2"
                    color="error"
                    :disabled="!confirmo || !puede('declaraciones.anular_pago')"
                    :loading="enviando"
                    data-prueba="anular-pago-confirmar"
                />
            </div>
        </template>
    </UModal>
</template>
