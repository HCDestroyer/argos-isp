<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { FormSubmitEvent } from '@nuxt/ui'
import Decimal from 'decimal.js'

/**
 * Depositar lo que tienes en custodia (tablero PlanCajas, ventana «Depositar»; B1,
 * `POST /custodia/depositar`, `cajas.depositar`): sin turno abierto, con su boleta y la cuenta que
 * lo recibe. Queda «en camino» hasta que aparezca en el estado de cuenta. La foto de la boleta del
 * tablero no está en la API (anotado en `integration/a4.md`).
 */
const props = defineProps<{
    /** Lo que tienes en custodia (`null` si no se pudo leer: no se propone monto). */
    saldo: Decimal | null
}>()

const abierto = defineModel<boolean>('open', { default: false })

const emit = defineEmits<{
    hecho: [deposito: Deposito]
}>()

const toast = useToast()
const formulario = useTemplateRef('formulario')
const hoy = hoyGuatemala()
const esquema = computed(() => esquemaDepositoCustodia(hoy, props.saldo))
const estado = reactive<EntradaDepositoCustodia>({ monto: '', boleta: '', fecha: hoy, cuenta_id: null })
const enviando = ref(false)
const problema = ref<Problem | null>(null)
let clave = nuevaClaveIdempotencia()

watch(abierto, (valor) => {
    if (valor) {
        Object.assign(estado, { monto: props.saldo?.gt(0) ? props.saldo.toFixed(2) : '', boleta: '', fecha: hoy, cuenta_id: estado.cuenta_id })
        problema.value = null
        clave = nuevaClaveIdempotencia()
    }
}, { immediate: true })

async function enviar(evento: FormSubmitEvent<EntradaDepositoCustodia>) {
    enviando.value = true
    problema.value = null
    const datos = evento.data
    const resultado = await useCustodia().depositar({
        monto: new Decimal(datos.monto).toFixed(2),
        boleta: datos.boleta.trim(),
        cuenta_id: datos.cuenta_id,
        ...(datos.fecha ? { fecha: datos.fecha } : {}),
    }, clave)
    enviando.value = false
    if (!resultado.ok) {
        if (resultado.problema.status >= 400 && resultado.problema.status < 500) {
            clave = nuevaClaveIdempotencia()
        }
        formulario.value?.setErrors(erroresDeFormulario(resultado.problema).filter(e => e.name && Object.hasOwn(estado, e.name)))
        problema.value = resultado.problema
        return
    }
    abierto.value = false
    toast.add({ title: `Depósito de ${formatearQuetzales(resultado.data.monto)} registrado`, description: 'Queda en camino hasta que aparezca en el estado de cuenta.', color: 'success', icon: 'i-lucide-landmark' })
    emit('hecho', resultado.data)
}
</script>

<template>
    <UModal
        v-model:open="abierto"
        :dismissible="!enviando"
        :ui="{ content: 'sm:max-w-[32.5rem]', header: 'items-start', footer: 'justify-end bg-(--ax-cabecera-tabla)' }"
    >
        <template #title>
            <ModalTitulo
                texto="Depositar lo que tienes en custodia"
                icono="i-lucide-landmark"
            />
        </template>
        <template #description>
            <span class="ps-13">Del efectivo a tu nombre al banco, con su boleta</span>
        </template>

        <template #body>
            <UForm
                id="form-deposito-custodia"
                ref="formulario"
                :schema="esquema"
                :state="estado"
                class="flex flex-col gap-4"
                @submit="enviar"
            >
                <div class="grid gap-3 sm:grid-cols-2">
                    <UFormField
                        label="Monto"
                        name="monto"
                        required
                        :help="saldo ? `Tienes ${formatearQuetzales(saldo)} en custodia` : undefined"
                    >
                        <UInput
                            v-model="estado.monto"
                            inputmode="decimal"
                            placeholder="0.00"
                            class="w-full"
                            data-prueba="deposito-custodia-monto"
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
                    >
                        <UInput
                            v-model="estado.boleta"
                            placeholder="Número de boleta"
                            class="w-full"
                            data-prueba="deposito-custodia-boleta"
                        />
                    </UFormField>
                </div>
                <UFormField
                    label="A qué cuenta"
                    name="cuenta_id"
                    required
                >
                    <CuentaBancoSelect v-model="estado.cuenta_id" />
                </UFormField>
                <UFormField
                    label="Fecha del depósito"
                    name="fecha"
                >
                    <CampoFecha
                        v-model="estado.fecha"
                        :max="hoy"
                        class="w-full"
                    />
                </UFormField>
                <p class="text-sm text-muted">
                    Queda «en camino» hasta que aparezca en el estado de cuenta.
                </p>
                <ProblemaAlerta
                    v-if="problema"
                    :problema="problema"
                />
            </UForm>
        </template>

        <template #footer>
            <UButton
                label="Cancelar"
                color="neutral"
                variant="ghost"
                :disabled="enviando"
                @click="abierto = false"
            />
            <UButton
                type="submit"
                form="form-deposito-custodia"
                label="Registrar depósito"
                icon="i-lucide-check"
                class="glow-brand rounded-full"
                :loading="enviando"
                data-prueba="deposito-custodia-registrar"
            />
        </template>
    </UModal>
</template>
