<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { FormSubmitEvent } from '@nuxt/ui'
import Decimal from 'decimal.js'
import * as z from 'zod'

/**
 * Nota de crédito interna sobre el saldo de una factura (`POST /facturas/:id/notas-credito`,
 * `facturas.nota_credito`), parcial o total, con `Idempotency-Key` por apertura. Por defecto el
 * monto es `total − pagado`. Si la nota deja al servicio sin deuda vencida, la API lo reactiva al
 * instante (`servicios[]`).
 */
const props = defineProps<{
    factura: Factura
}>()

const abierto = defineModel<boolean>('open', { default: false })

const emit = defineEmits<{
    hecho: [nota: NotaCreditoEmitida]
}>()

const MONTO = /^\d{1,12}(\.\d{1,2})?$/
const saldo = computed(() => new Decimal(props.factura.total).minus(props.factura.pagado))

/** Espejo de `notaCreditoValidator` (A3) + el saldo: > 0, hasta el saldo, motivo de 3 a 500. */
const esquema = computed(() => z.object({
    monto: z.string()
        .trim()
        .regex(MONTO, 'Escribe un monto con hasta 2 decimales, sin comas (ej. 150.00)')
        .refine(valor => !MONTO.test(valor) || new Decimal(valor).gt(0), 'El monto debe ser mayor que cero')
        .refine(valor => !MONTO.test(valor) || new Decimal(valor).lte(saldo.value), `No puede pasar del saldo (${formatearQuetzales(saldo.value)})`),
    motivo: z.string().trim().min(3, 'Al menos 3 caracteres').max(500, 'Máximo 500 caracteres'),
}))
type Datos = z.output<typeof esquema.value>

const formulario = useTemplateRef('formulario')
const estado = reactive<Datos>({ monto: '', motivo: '' })
const enviando = ref(false)
const problema = ref<Problem | null>(null)
let clave = nuevaClaveIdempotencia()

watch(abierto, (valor) => {
    if (valor) {
        estado.monto = saldo.value.gt(0) ? saldo.value.toFixed(2) : ''
        estado.motivo = ''
        problema.value = null
        clave = nuevaClaveIdempotencia()
    }
}, { immediate: true })

async function enviar(evento: FormSubmitEvent<Datos>) {
    enviando.value = true
    problema.value = null
    const resultado = await useFacturas().notaCredito(props.factura.id, { monto: new Decimal(evento.data.monto).toFixed(2), motivo: evento.data.motivo }, clave)
    enviando.value = false
    if (resultado.ok) {
        abierto.value = false
        emit('hecho', resultado.data)
        return
    }
    const errores = erroresDeFormulario(resultado.problema)
    if (errores.length) {
        formulario.value?.setErrors(errores)
    }
    problema.value = errores.length ? null : resultado.problema
}
</script>

<template>
    <UModal
        v-model:open="abierto"
        title="Nota de crédito"
        :description="`Factura #${factura.id} · saldo ${formatearQuetzales(saldo)}`"
        :dismissible="!enviando"
    >
        <template #body>
            <UForm
                id="form-nota-credito"
                ref="formulario"
                :schema="esquema"
                :state="estado"
                class="flex flex-col gap-4"
                @submit="enviar"
            >
                <UFormField
                    label="Monto"
                    name="monto"
                    required
                    help="Por defecto, todo el saldo. Puede ser parcial."
                >
                    <UInput
                        v-model="estado.monto"
                        inputmode="decimal"
                        class="w-full"
                        data-prueba="nota-monto"
                    >
                        <template #leading>
                            <span class="text-sm text-muted">Q</span>
                        </template>
                    </UInput>
                </UFormField>
                <UFormField
                    label="Motivo"
                    name="motivo"
                    required
                >
                    <UTextarea
                        v-model="estado.motivo"
                        :rows="2"
                        placeholder="Días sin servicio por falla en la zona"
                        class="w-full"
                        data-prueba="nota-motivo"
                    />
                </UFormField>
                <p class="text-xs text-muted">
                    Baja el saldo de la factura y la cuenta del cliente con un asiento de nota de crédito (ingresos e IVA en proporción). Todavía sin FEL.
                </p>
                <ProblemaAlerta
                    v-if="problema"
                    :problema="problema"
                    data-prueba="nota-error"
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
                    form="form-nota-credito"
                    label="Emitir nota de crédito"
                    icon="i-lucide-file-minus"
                    :loading="enviando"
                    data-prueba="nota-emitir"
                />
            </div>
        </template>
    </UModal>
</template>
