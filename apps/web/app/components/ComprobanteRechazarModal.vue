<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { FormSubmitEvent, SelectItem } from '@nuxt/ui'

/**
 * Rechazar un comprobante (`POST /comprobantes/:id/rechazar { motivo, causa }`, A3) con la causa
 * del contrato Iris 0.6.0 §7.2. Si el comprobante sostiene una reconexión temporal activa, avisa
 * que rechazarlo la cancela y el servicio vuelve a cortarse a la hora de corte de su plantilla.
 * Una `Idempotency-Key` por apertura; 409 `comprobante_revisado` pide recargar.
 */
const props = defineProps<{
    comprobante: Comprobante
    /** Reconexión temporal activa ligada a este comprobante (`null` si no tiene). */
    reconexion: Promesa | null
    /** No se pudo saber si tiene reconexión temporal: se avisa en vez de callarlo. */
    reconexionDesconocida?: boolean
}>()

const abierto = defineModel<boolean>('open', { default: false })

const emit = defineEmits<{
    hecho: [comprobante: Comprobante]
    revisado: []
}>()

const idFormulario = useId()
const estado = reactive<EntradaRechazarComprobante>({ causa: 'no_aparece', motivo: '' })
const enviando = ref(false)
const problema = ref<Problem | null>(null)
let claveIdempotencia = nuevaClaveIdempotencia()

const itemsCausa: SelectItem[] = (Object.keys(CAUSAS_RECHAZO) as CausaRechazo[]).map(causa => ({
    label: CAUSAS_RECHAZO[causa].etiqueta,
    value: causa,
}))

const efecto = computed(() => llegoPorIris(props.comprobante)
    ? 'No se registra pago ni asiento. Iris le explica al cliente en la conversación y puede mandarlo de nuevo.'
    : 'No se registra pago ni asiento. El cliente recibe el aviso con el motivo y puede subir el comprobante de nuevo con la misma referencia.')

watch(abierto, (valor) => {
    if (valor) {
        Object.assign(estado, { causa: 'no_aparece', motivo: '' })
        problema.value = null
        claveIdempotencia = nuevaClaveIdempotencia()
    }
})

async function enviar(evento: FormSubmitEvent<SalidaRechazarComprobante>) {
    enviando.value = true
    problema.value = null
    const resultado = await useComprobantes().rechazar(props.comprobante.id, evento.data, claveIdempotencia)
    enviando.value = false
    if (resultado.ok) {
        abierto.value = false
        emit('hecho', resultado.data)
        return
    }
    problema.value = resultado.problema
    if (esComprobanteRevisado(resultado.problema)) {
        emit('revisado')
    }
}
</script>

<template>
    <UModal
        v-model:open="abierto"
        title="Rechazar comprobante"
        :description="`#${comprobante.id} · ${comprobante.cliente_nombre} · ${formatearQuetzales(comprobante.monto)}`"
        :dismissible="!enviando"
    >
        <template #body>
            <UForm
                :id="idFormulario"
                :schema="esquemaRechazarComprobante"
                :state="estado"
                class="flex flex-col gap-4"
                @submit="enviar"
            >
                <UAlert
                    v-if="reconexion"
                    color="warning"
                    variant="subtle"
                    icon="i-lucide-plug-zap"
                    title="Tiene una reconexión temporal activa"
                    :description="`Rechazarlo vuelve a cortar el servicio a la hora de corte. La reconexión (promesa #${reconexion.id}) vence el ${formatearFechaHora(reconexion.vence_en)}.`"
                    data-prueba="aviso-reconexion-rechazo"
                />
                <UAlert
                    v-else-if="reconexionDesconocida"
                    color="warning"
                    variant="subtle"
                    icon="i-lucide-circle-help"
                    title="No se pudo revisar la reconexión temporal"
                    description="Si el servicio tiene una reconexión temporal por este comprobante, rechazarlo vuelve a cortarlo a la hora de corte."
                />
                <UAlert
                    color="error"
                    variant="subtle"
                    icon="i-lucide-circle-x"
                    :description="efecto"
                />

                <UFormField
                    label="Causa"
                    name="causa"
                    required
                    :help="CAUSAS_RECHAZO[estado.causa].descripcion"
                >
                    <USelect
                        v-model="estado.causa"
                        :items="itemsCausa"
                        class="w-full"
                        data-prueba="causa-rechazo"
                    />
                </UFormField>

                <UFormField
                    label="Motivo"
                    name="motivo"
                    required
                    :help="llegoPorIris(comprobante) ? 'Iris se lo dice al cliente; queda en la bitácora con tu usuario.' : 'El cliente lo recibe en el aviso; queda en la bitácora con tu usuario.'"
                >
                    <UTextarea
                        v-model="estado.motivo"
                        :rows="3"
                        autofocus
                        placeholder="Ej.: la boleta no aparece en el estado de cuenta del banco"
                        class="w-full"
                        data-prueba="motivo-rechazo"
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
                    label="Rechazar comprobante"
                    icon="i-lucide-circle-x"
                    color="error"
                    :loading="enviando"
                    data-prueba="confirmar-rechazo"
                />
            </div>
        </template>
    </UModal>
</template>
