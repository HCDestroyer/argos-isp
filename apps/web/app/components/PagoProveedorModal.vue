<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { FormSubmitEvent } from '@nuxt/ui'
import Decimal from 'decimal.js'

/**
 * Pago a un proveedor (`POST /pagos-proveedores`, `compras.pagar`): se aplica primero a las compras
 * marcadas y luego a la más antigua por vencimiento, sin pasar de lo pendiente. El dinero sale de una
 * caja (su turno abierto), un banco del libro o una cuenta bancaria propia.
 */
const props = defineProps<{
    proveedor: Proveedor
    pendientes: EstadoCuentaProveedor['pendientes']
}>()

const abierto = defineModel<boolean>('open', { default: false })

const emit = defineEmits<{
    hecho: [pago: PagoProveedor]
}>()

const hoy = hoyGuatemala()
const formulario = useTemplateRef('formulario')
const total = computed(() => props.pendientes.reduce((s, p) => s.plus(p.saldo), new Decimal(0)).toFixed(2))
const esquema = computed(() => esquemaPagoProveedor(hoy, total.value))

function vacio(): EntradaPagoProveedor {
    return { monto: '', metodo: 'banco', caja_id: null, banco_id: null, cuenta_bancaria_id: null, fecha: '', referencia: '', descripcion: '', compras: [] }
}

const estado = reactive<EntradaPagoProveedor>(vacio())
const enviando = ref(false)
const problema = ref<Problem | null>(null)
let clave = nuevaClaveIdempotencia()

const marcadas = computed(() => props.pendientes.filter(p => estado.compras.includes(p.compra_id)))

function alternar(compraId: number, marcada: boolean | 'indeterminate') {
    estado.compras = marcada === true ? [...estado.compras, compraId] : estado.compras.filter(id => id !== compraId)
    // Con compras marcadas, el monto propuesto es su saldo.
    estado.monto = marcadas.value.length ? marcadas.value.reduce((s, p) => s.plus(p.saldo), new Decimal(0)).toFixed(2) : estado.monto
}

watch(abierto, (valor) => {
    if (valor) {
        Object.assign(estado, vacio())
        problema.value = null
        clave = nuevaClaveIdempotencia()
        formulario.value?.clear()
    }
})

async function enviar(evento: FormSubmitEvent<EntradaPagoProveedor>) {
    enviando.value = true
    problema.value = null
    const resultado = await usePagosProveedores().registrar(cuerpoPagoProveedor(props.proveedor.id, evento.data), clave)
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
    problema.value = problemaCompraLegible(resultado.problema)
    clave = nuevaClaveIdempotencia()
}
</script>

<template>
    <UModal
        v-model:open="abierto"
        :title="`Pagar a ${proveedor.nombre}`"
        :description="`Pendiente: ${formatearQuetzales(total)}. Se aplica primero a las compras marcadas y luego a la más antigua por vencimiento.`"
        :dismissible="!enviando"
    >
        <template #body>
            <UForm
                id="form-pago-proveedor"
                ref="formulario"
                :schema="esquema"
                :state="estado"
                class="flex flex-col gap-4"
                @submit="enviar"
            >
                <fieldset
                    v-if="pendientes.length"
                    class="flex flex-col gap-2"
                >
                    <legend class="mb-1 text-sm font-medium text-highlighted">
                        Compras a pagar primero
                    </legend>
                    <UCheckbox
                        v-for="p in pendientes"
                        :key="p.compra_id"
                        :model-value="estado.compras.includes(p.compra_id)"
                        :label="`${p.documento} · ${formatearQuetzales(p.saldo)}`"
                        :description="p.dias_vencida ? `Vencida hace ${p.dias_vencida} días` : `Vence el ${formatearFecha(p.vence_en)}`"
                        :data-pendiente="p.compra_id"
                        @update:model-value="alternar(p.compra_id, $event)"
                    />
                </fieldset>
                <div class="grid gap-4 sm:grid-cols-2">
                    <UFormField
                        label="Monto"
                        name="monto"
                        required
                    >
                        <UInput
                            v-model="estado.monto"
                            inputmode="decimal"
                            placeholder="0.00"
                            class="w-full"
                            data-prueba="pago-proveedor-monto"
                        />
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
                <MedioPagoCampos
                    v-model:metodo="estado.metodo"
                    v-model:caja-id="estado.caja_id"
                    v-model:banco-id="estado.banco_id"
                    v-model:cuenta-bancaria-id="estado.cuenta_bancaria_id"
                />
                <div class="grid gap-4 sm:grid-cols-2">
                    <UFormField
                        label="Referencia"
                        name="referencia"
                        help="Cheque, transferencia…"
                    >
                        <UInput
                            v-model="estado.referencia"
                            class="w-full"
                        />
                    </UFormField>
                    <UFormField
                        label="Descripción"
                        name="descripcion"
                    >
                        <UInput
                            v-model="estado.descripcion"
                            class="w-full"
                        />
                    </UFormField>
                </div>
                <ProblemaAlerta
                    v-if="problema"
                    :problema="problema"
                    con-errores
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
                    form="form-pago-proveedor"
                    label="Registrar pago"
                    icon="i-lucide-banknote"
                    :loading="enviando"
                    data-prueba="confirmar-pago-proveedor"
                />
            </div>
        </template>
    </UModal>
</template>
