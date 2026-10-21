<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { FormSubmitEvent } from '@nuxt/ui'

/**
 * Anula la entrega del premio de un ganador (H22, `POST /lealtad/sorteos/:id/ganadores/:g/anular-entrega`,
 * acción `sorteos.anular_entrega`, permiso `sorteos.entregar`), con motivo. La API la deshace toda
 * junta: anula el egreso (efectivo), revierte el asiento del bien o el canje (servicio) y el del ISR; el
 * ganador vuelve a «por notificar» y un sorteo con todos los premios entregados vuelve a «ejecutado».
 * Si el canje ya se aplicó a una factura, 409 `canje_no_revertible`.
 */
const props = defineProps<{
    sorteoId: number
    ganador: GanadorSorteo | null
    premio: PremioSorteo | null
    nombre: string
}>()

const abierto = defineModel<boolean>('open', { default: false })

const emit = defineEmits<{
    hecho: [sorteo: SorteoDetalle]
}>()

const formulario = useTemplateRef('formulario')
const estado = reactive<EntradaAnularEntrega>({ motivo: '' })
const enviando = ref(false)
const problema = ref<Problem | null>(null)
let clave = nuevaClaveIdempotencia()

/** Qué deshace la API según la entrega guardada en el ganador. */
const deshace = computed(() => {
    const g = props.ganador
    if (!g) {
        return ''
    }
    const partes = [
        g.egreso_id ? `anula el egreso #${g.egreso_id}` : null,
        g.canje_id ? `revierte el canje #${g.canje_id} (si el descuento ya se aplicó a una factura, no se puede)` : null,
        !g.egreso_id && !g.canje_id && g.asiento_id ? `revierte el asiento #${g.asiento_id}` : null,
        g.retencion_isr && g.retencion_isr !== '0.00' ? `revierte el ISR de ${formatearQuetzales(g.retencion_isr)}` : null,
    ].filter((p): p is string => p !== null)
    return partes.length ? `${partes.join(', ')}.` : 'deshace la entrega.'
})

watch(abierto, (valor) => {
    if (valor) {
        estado.motivo = ''
        problema.value = null
        clave = nuevaClaveIdempotencia()
    }
})

async function enviar(evento: FormSubmitEvent<EntradaAnularEntrega>) {
    if (!props.ganador) {
        return
    }
    enviando.value = true
    problema.value = null
    const resultado = await useSorteos().anularEntrega(props.sorteoId, props.ganador.id, evento.data.motivo, clave)
    enviando.value = false
    if (resultado.ok) {
        abierto.value = false
        emit('hecho', resultado.data)
        return
    }
    const errores = erroresDeFormulario(resultado.problema).filter(e => e.name === 'motivo')
    if (errores.length) {
        formulario.value?.setErrors(errores)
        return
    }
    problema.value = problemaSorteoLegible(resultado.problema)
}
</script>

<template>
    <UModal
        v-model:open="abierto"
        title="Anular la entrega"
        :description="premio ? `${premio.nombre} · ${nombre}` : nombre"
        :dismissible="!enviando"
    >
        <template #body>
            <UForm
                v-if="ganador"
                id="form-anular-entrega"
                ref="formulario"
                :schema="esquemaAnularEntrega"
                :state="estado"
                class="flex flex-col gap-4"
                @submit="enviar"
            >
                <UAlert
                    color="warning"
                    variant="subtle"
                    icon="i-lucide-undo-2"
                    title="Se deshace todo junto"
                    :description="`La API ${deshace} El ganador vuelve a «por notificar» y el premio se puede volver a entregar.`"
                    data-prueba="anular-entrega-deshace"
                />
                <UFormField
                    label="Motivo"
                    name="motivo"
                    required
                    help="Queda en la bitácora con la anulación."
                >
                    <UTextarea
                        v-model="estado.motivo"
                        :rows="2"
                        autoresize
                        class="w-full"
                        data-prueba="anular-entrega-motivo"
                    />
                </UFormField>
                <ProblemaAlerta
                    v-if="problema"
                    :problema="problema"
                    data-prueba="anular-entrega-problema"
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
                    form="form-anular-entrega"
                    label="Anular entrega"
                    icon="i-lucide-undo-2"
                    color="error"
                    :loading="enviando"
                    data-prueba="confirmar-anular-entrega"
                />
            </div>
        </template>
    </UModal>
</template>
