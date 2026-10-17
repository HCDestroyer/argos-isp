<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { FormSubmitEvent } from '@nuxt/ui'
import Decimal from 'decimal.js'

/**
 * Cierre de turno con arqueo (`POST /cajas/:id/cerrar`, `cajas.cerrar`). El contado se escribe
 * o se cuenta por denominación; la diferencia contra el esperado provisional se ve mientras se
 * escribe y, si no es cero, el motivo es obligatorio. La API calcula el esperado oficial.
 */
const props = withDefaults(defineProps<{
    caja: Caja
    turno: TurnoCaja
    /** Fondo + efectivo cobrado − egresos en efectivo del turno; `null` si no se pudo calcular. */
    esperado?: Decimal | null
    /** Por qué no hay esperado provisional (sin `egresos.ver`, o un dato que no se pudo leer). */
    sinEsperado?: string | null
}>(), {
    esperado: null,
    sinEsperado: null,
})

const abierto = defineModel<boolean>('open', { default: false })

const emit = defineEmits<{
    hecho: [turno: TurnoCaja]
}>()

const porDenominacion = ref(false)
const cantidades = reactive<Record<string, number | null>>({})
const estado = reactive<{ contado: string, motivo: string }>({ contado: '', motivo: '' })
const enviando = ref(false)
const problema = ref<Problem | null>(null)
const formulario = useTemplateRef<{ setErrors: (errores: ReturnType<typeof erroresDeFormulario>) => void }>('formulario')
let clave = nuevaClaveIdempotencia()

const esquema = computed(() => esquemaCierre(props.esperado))

const contado = computed<Decimal | null>(() => {
    try {
        return estado.contado.trim() ? new Decimal(estado.contado.trim()) : null
    }
    catch {
        return null
    }
})

const diferencia = computed<Decimal | null>(() => (props.esperado && contado.value ? contado.value.minus(props.esperado) : null))

watch(abierto, (valor) => {
    if (valor) {
        porDenominacion.value = false
        DENOMINACIONES.forEach((d) => {
            cantidades[d.valor] = null
        })
        estado.contado = ''
        estado.motivo = ''
        problema.value = null
        clave = nuevaClaveIdempotencia()
    }
})

watch(cantidades, () => {
    if (porDenominacion.value) {
        estado.contado = totalDenominaciones(cantidades).toFixed(2)
    }
})

watch(porDenominacion, (valor) => {
    if (valor) {
        estado.contado = totalDenominaciones(cantidades).toFixed(2)
    }
})

async function enviar(evento: FormSubmitEvent<DatosCierreFormulario>) {
    enviando.value = true
    problema.value = null
    const resultado = await useCajas().cerrar(props.caja.id, {
        contado: new Decimal(evento.data.contado).toFixed(2),
        motivo: evento.data.motivo || null,
    }, clave)
    enviando.value = false
    if (resultado.ok) {
        abierto.value = false
        emit('hecho', resultado.data)
        return
    }
    problema.value = resultado.problema
    if (resultado.problema.status === 422) {
        formulario.value?.setErrors(erroresDeFormulario(resultado.problema))
    }
}
</script>

<template>
    <UModal
        v-model:open="abierto"
        title="Cerrar turno"
        :description="`${caja.nombre} · abierto ${formatearFechaHora(turno.abierto_en)}`"
        :dismissible="!enviando"
        :ui="{ content: 'sm:max-w-xl' }"
    >
        <template #body>
            <UForm
                id="form-cierre-caja"
                ref="formulario"
                :schema="esquema"
                :state="estado"
                class="flex flex-col gap-4"
                @submit="enviar"
            >
                <dl class="grid grid-cols-3 gap-3 rounded-lg bg-elevated p-3">
                    <div class="flex flex-col gap-0.5">
                        <dt class="text-xs text-muted">
                            Esperado
                        </dt>
                        <dd
                            class="font-semibold tabular-nums text-highlighted"
                            data-prueba="cierre-esperado"
                        >
                            {{ esperado ? formatearQuetzales(esperado) : '—' }}
                        </dd>
                    </div>
                    <div class="flex flex-col gap-0.5">
                        <dt class="text-xs text-muted">
                            Contado
                        </dt>
                        <dd
                            class="font-semibold tabular-nums text-highlighted"
                            data-prueba="cierre-contado"
                        >
                            {{ contado ? formatearQuetzales(contado) : '—' }}
                        </dd>
                    </div>
                    <div class="flex flex-col gap-0.5">
                        <dt class="text-xs text-muted">
                            Diferencia
                        </dt>
                        <dd data-prueba="cierre-diferencia">
                            <UBadge
                                v-if="diferencia"
                                :label="etiquetaDiferencia(diferencia)"
                                :icon="iconoDiferencia(diferencia)"
                                :color="colorDiferencia(diferencia)"
                                variant="subtle"
                            />
                            <span
                                v-else
                                class="text-sm text-muted"
                            >—</span>
                        </dd>
                    </div>
                </dl>
                <p
                    v-if="!esperado"
                    class="text-xs text-muted"
                >
                    {{ sinEsperado ?? 'No se pudieron leer los cobros del turno: la API calcula el esperado y la diferencia al cerrar.' }}
                </p>

                <USwitch
                    v-model="porDenominacion"
                    label="Contar por denominación"
                />

                <div
                    v-if="porDenominacion"
                    class="grid grid-cols-2 gap-3 sm:grid-cols-3"
                >
                    <UFormField
                        v-for="denominacion in DENOMINACIONES"
                        :key="denominacion.valor"
                        :label="denominacion.etiqueta"
                        size="sm"
                    >
                        <UInputNumber
                            v-model="cantidades[denominacion.valor]"
                            :min="0"
                            :step="1"
                            placeholder="0"
                            :aria-label="`Cantidad de ${denominacion.etiqueta}`"
                            class="w-full"
                        />
                    </UFormField>
                </div>

                <UFormField
                    label="Efectivo contado"
                    name="contado"
                    required
                    :help="porDenominacion ? 'Suma de las denominaciones.' : 'Todo el efectivo de la caja, fondo incluido.'"
                >
                    <UInput
                        v-model="estado.contado"
                        inputmode="decimal"
                        placeholder="1450.00"
                        :readonly="porDenominacion"
                        class="w-full"
                    >
                        <template #leading>
                            <span class="text-sm text-muted">Q</span>
                        </template>
                    </UInput>
                </UFormField>

                <UFormField
                    label="Motivo de la diferencia"
                    name="motivo"
                    :required="diferencia !== null && !diferencia.isZero()"
                    help="Obligatorio si lo contado no cuadra con lo esperado. Queda en la bitácora."
                >
                    <UTextarea
                        v-model="estado.motivo"
                        :rows="2"
                        placeholder="Ej.: faltaron Q 5.00, vuelto mal entregado"
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
                    form="form-cierre-caja"
                    label="Cerrar turno"
                    icon="i-lucide-lock"
                    :loading="enviando"
                />
            </div>
        </template>
    </UModal>
</template>
