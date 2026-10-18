<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { FormSubmitEvent } from '@nuxt/ui'

/**
 * Anular una factura con DTE certificado, en dos pasos (`POST /facturas/:id/anular`, con
 * `facturas.anular` y `fel.anular`; contrato §8.3 y §17): 1) el motivo; 2) la confirmación de lo
 * que pasa con el DTE. La API pide la anulación al certificador (`anulacion_pendiente`) y la
 * factura se anula cuando la SAT confirma; mientras tanto no recibe pagos ni notas. Fuera de plazo
 * (422 `anulacion_fuera_de_plazo`) ofrece la nota de crédito.
 */
const props = defineProps<{
    factura: Factura
}>()

const abierto = defineModel<boolean>('open', { default: false })

const emit = defineEmits<{
    hecho: [factura: Factura]
    notaCredito: []
}>()

const idFormulario = useId()
const paso = ref<1 | 2>(1)
const estado = reactive<{ motivo: string }>({ motivo: '' })
const enviando = ref(false)
const problema = ref<Problem | null>(null)
let clave = nuevaClaveIdempotencia()

const fueraDePlazo = computed(() => problema.value !== null && codigoProblema(problema.value) === 'anulacion_fuera_de_plazo')

watch(abierto, (valor) => {
    if (valor) {
        paso.value = 1
        estado.motivo = ''
        problema.value = null
        clave = nuevaClaveIdempotencia()
    }
})

function aConfirmar(_evento: FormSubmitEvent<DatosMotivo>) {
    paso.value = 2
    problema.value = null
}

async function confirmar() {
    enviando.value = true
    problema.value = null
    const resultado = await useFacturas().anular(props.factura.id, estado.motivo.trim(), clave)
    enviando.value = false
    if (resultado.ok) {
        abierto.value = false
        emit('hecho', resultado.data)
        return
    }
    problema.value = problemaFelLegible(resultado.problema)
}

function aNotaCredito() {
    abierto.value = false
    emit('notaCredito')
}
</script>

<template>
    <UModal
        v-model:open="abierto"
        title="Anular factura certificada"
        :description="`Factura #${factura.id} · ${formatearQuetzales(factura.total)} · paso ${paso} de 2`"
        :dismissible="!enviando"
    >
        <template #body>
            <UForm
                v-if="paso === 1"
                :id="idFormulario"
                :schema="esquemaMotivo"
                :state="estado"
                class="flex flex-col gap-4"
                @submit="aConfirmar"
            >
                <UAlert
                    color="warning"
                    variant="subtle"
                    icon="i-lucide-badge-check"
                    title="Esta factura tiene DTE certificado"
                    :description="`Autorización ${factura.fel_uuid ?? '—'} · serie ${factura.fel_serie ?? '—'} · número ${factura.fel_numero ?? '—'}. Anularla también anula el DTE ante la SAT.`"
                />
                <UFormField
                    label="Motivo"
                    name="motivo"
                    required
                    help="Viaja al certificador con la anulación y queda en la bitácora."
                >
                    <UTextarea
                        v-model="estado.motivo"
                        :rows="3"
                        autofocus
                        placeholder="Ej.: el servicio se dio de baja antes del periodo"
                        class="w-full"
                        data-prueba="anular-motivo"
                    />
                </UFormField>
            </UForm>

            <div
                v-else
                class="flex flex-col gap-4"
                data-prueba="anular-confirmacion"
            >
                <ul class="flex list-disc flex-col gap-1.5 pl-5 text-sm text-default">
                    <li>Se pide al certificador anular el DTE; el estado pasa a <strong>anulación pendiente</strong>.</li>
                    <li>La factura se anula (con su asiento de reverso) cuando la SAT lo confirma.</li>
                    <li>Mientras tanto la factura no recibe pagos ni notas de crédito.</li>
                    <li>Si la SAT rechaza la anulación, el DTE vuelve a certificado y la factura sigue vigente.</li>
                </ul>
                <DatoFicha
                    etiqueta="Motivo"
                    :valor="estado.motivo"
                />
                <ProblemaAlerta
                    v-if="problema"
                    :problema="problema"
                    data-prueba="anular-error"
                />
                <UButton
                    v-if="fueraDePlazo"
                    label="Emitir nota de crédito"
                    icon="i-lucide-file-minus"
                    color="neutral"
                    variant="outline"
                    class="self-start"
                    data-prueba="anular-a-nota"
                    @click="aNotaCredito"
                />
            </div>
        </template>

        <template #footer>
            <div class="flex w-full justify-end gap-2">
                <UButton
                    v-if="paso === 2"
                    label="Atrás"
                    icon="i-lucide-arrow-left"
                    color="neutral"
                    variant="ghost"
                    :disabled="enviando"
                    @click="paso = 1"
                />
                <UButton
                    v-else
                    label="Cancelar"
                    color="neutral"
                    variant="ghost"
                    @click="abierto = false"
                />
                <UButton
                    v-if="paso === 1"
                    type="submit"
                    :form="idFormulario"
                    label="Continuar"
                    icon="i-lucide-arrow-right"
                    color="error"
                    data-prueba="anular-continuar"
                />
                <UButton
                    v-else
                    label="Confirmar anulación"
                    icon="i-lucide-ban"
                    color="error"
                    :loading="enviando"
                    :disabled="fueraDePlazo"
                    data-prueba="anular-confirmar"
                    @click="confirmar"
                />
            </div>
        </template>
    </UModal>
</template>
