<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { FormSubmitEvent } from '@nuxt/ui'
import type Decimal from 'decimal.js'

/**
 * Depósito del efectivo de un turno al banco (`POST /cajas/:id/depositar`, `cajas.depositar`).
 * Queda en fondos en tránsito (1.1.11) con su boleta hasta que el extracto lo acredite, y baja el
 * esperado del cierre igual que un egreso. Con el efectivo del turno conocido el formulario no
 * deja pasarlo; la API lo revisa siempre (422 `deposito_excede_efectivo`).
 */
const props = withDefaults(defineProps<{
    caja: Caja
    turno: TurnoCaja
    /** Efectivo del turno (fondo + cobros − egresos − depósitos); `null` si no se pudo calcular. */
    efectivo?: Decimal | null
}>(), {
    efectivo: null,
})

const abierto = defineModel<boolean>('open', { default: false })

const emit = defineEmits<{
    hecho: [deposito: Deposito]
}>()

const formulario = useTemplateRef('formulario')
const hoy = hoyGuatemala()
const esquema = computed(() => esquemaDeposito(hoy, props.efectivo))
const estado = reactive<EntradaDeposito>({ monto: '', boleta: '', fecha: '', cuenta_id: null })
const enviando = ref(false)
const problema = ref<Problem | null>(null)
let clave = nuevaClaveIdempotencia()

watch(abierto, (valor) => {
    if (valor) {
        Object.assign(estado, { monto: props.efectivo?.gt(0) ? props.efectivo.toFixed(2) : '', boleta: '', fecha: '', cuenta_id: estado.cuenta_id })
        problema.value = null
        clave = nuevaClaveIdempotencia()
    }
})

async function enviar(evento: FormSubmitEvent<SalidaDeposito>) {
    enviando.value = true
    problema.value = null
    const resultado = await useCajas().depositar(props.caja.id, cuerpoDeposito(evento.data), clave)
    enviando.value = false
    if (resultado.ok) {
        abierto.value = false
        emit('hecho', resultado.data)
        return
    }
    const errores = erroresDeFormulario(resultado.problema).filter(e => e.name && Object.hasOwn(estado, e.name))
    formulario.value?.setErrors(errores)
    problema.value = resultado.problema
}
</script>

<template>
    <UModal
        v-model:open="abierto"
        title="Depositar al banco"
        :description="`${caja.nombre} · turno #${turno.id}`"
        :dismissible="!enviando"
    >
        <template #body>
            <UForm
                id="form-deposito-caja"
                ref="formulario"
                :schema="esquema"
                :state="estado"
                class="flex flex-col gap-4"
                @submit="enviar"
            >
                <UAlert
                    color="neutral"
                    variant="subtle"
                    icon="i-lucide-truck"
                    :description="efectivo
                        ? `Efectivo del turno: ${formatearQuetzales(efectivo)}. El depósito sale de la caja hoy y queda en tránsito hasta que el extracto del banco lo acredite.`
                        : 'El depósito sale de la caja hoy y queda en tránsito hasta que el extracto del banco lo acredite. La API revisa que no supere el efectivo del turno.'"
                    data-prueba="deposito-efectivo"
                />
                <div class="grid gap-4 sm:grid-cols-2">
                    <UFormField
                        label="Monto"
                        name="monto"
                        required
                    >
                        <UInput
                            v-model="estado.monto"
                            inputmode="decimal"
                            placeholder="600.00"
                            class="w-full"
                            data-prueba="deposito-monto"
                        >
                            <template #leading>
                                <span class="text-sm text-muted">Q</span>
                            </template>
                        </UInput>
                    </UFormField>
                    <UFormField
                        label="Boleta"
                        name="boleta"
                        required
                        help="Número de la boleta del banco."
                    >
                        <UInput
                            v-model="estado.boleta"
                            placeholder="778812"
                            class="w-full"
                            data-prueba="deposito-boleta"
                        />
                    </UFormField>
                    <UFormField
                        label="Cuenta que recibe"
                        name="cuenta_id"
                        required
                        class="sm:col-span-2"
                    >
                        <CuentaBancoSelect v-model="estado.cuenta_id" />
                    </UFormField>
                    <UFormField
                        label="Fecha"
                        name="fecha"
                        help="Vacía: hoy."
                    >
                        <UInput
                            v-model="estado.fecha"
                            type="date"
                            :max="hoy"
                            class="w-full"
                        />
                    </UFormField>
                </div>

                <ProblemaAlerta
                    v-if="problema"
                    :problema="problema"
                    data-prueba="deposito-error"
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
                    form="form-deposito-caja"
                    label="Depositar"
                    icon="i-lucide-landmark"
                    :loading="enviando"
                    data-prueba="deposito-registrar"
                />
            </div>
        </template>
    </UModal>
</template>
