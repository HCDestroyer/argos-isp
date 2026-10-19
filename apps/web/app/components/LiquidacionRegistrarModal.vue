<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { FormSubmitEvent } from '@nuxt/ui'
import Decimal from 'decimal.js'

/**
 * Registra la liquidación de un proveedor de cobro (`POST /cobros/liquidaciones`,
 * `cobros.liquidar`) con su `Idempotency-Key` por apertura. Se marcan los pagos que trae la
 * liquidación (y los contracargos que descuenta); el bruto se propone como Σ pagos − Σ
 * contracargos y el neto es bruto − comisión. Del archivo de la liquidación solo viajan el nombre
 * y su sha256 (lo calcula el panel, que hace de lector).
 */
const props = defineProps<{
    resumen: ResumenCobrosPorLiquidar
}>()

const abierto = defineModel<boolean>('open', { default: false })

const emit = defineEmits<{
    hecho: [liquidacion: LiquidacionCobro]
}>()

const nombres = useNombresClientes()
const formulario = useTemplateRef('formulario')
const hoy = hoyGuatemala()
const esquema = esquemaLiquidacion(hoy)
const estado = reactive<EntradaLiquidacion>({ referencia: '', fecha: '', bruto: '', comision: '0.00', pagos: [], contracargos: [], cuenta_id: null, archivo: '', nota: '' })
const archivo = ref<File | null>(null)
const huella = ref<string | null>(null)
const enviando = ref(false)
const problema = ref<Problem | null>(null)
/** El bruto lo cambió la persona: ya no se recalcula al marcar pagos. */
const brutoEditado = ref(false)
let clave = nuevaClaveIdempotencia()

const cobros = computed(() => props.resumen.pagos.filter(p => p.tipo === 'cobro'))
const contracargos = computed(() => props.resumen.pagos.filter(p => p.tipo === 'contracargo'))
const elegidos = computed(() => props.resumen.pagos.filter(p => (p.tipo === 'cobro' ? estado.pagos : estado.contracargos).includes(p.pago_id)))
const esperado = computed(() => brutoEsperado(elegidos.value))
const neto = computed(() => netoDe(estado.bruto, estado.comision))
const brutoDistinto = computed(() => {
    try {
        return estado.bruto.trim() !== '' && !new Decimal(estado.bruto.trim()).equals(esperado.value)
    }
    catch {
        return false
    }
})

function marcado(pago: PagoPorLiquidar): boolean {
    return (pago.tipo === 'cobro' ? estado.pagos : estado.contracargos).includes(pago.pago_id)
}

function alternar(pago: PagoPorLiquidar, valor: boolean | 'indeterminate') {
    const lista = pago.tipo === 'cobro' ? 'pagos' : 'contracargos'
    const actual = estado[lista].filter(id => id !== pago.pago_id)
    estado[lista] = valor === true ? [...actual, pago.pago_id] : actual
}

watch(esperado, (valor) => {
    if (!brutoEditado.value) {
        estado.bruto = valor.toFixed(2)
    }
})

watch(abierto, (valor) => {
    if (valor) {
        Object.assign(estado, {
            referencia: '',
            fecha: '',
            bruto: brutoEsperado(props.resumen.pagos).toFixed(2),
            comision: '0.00',
            pagos: cobros.value.map(p => p.pago_id),
            contracargos: contracargos.value.map(p => p.pago_id),
            cuenta_id: null,
            archivo: '',
            nota: '',
        })
        brutoEditado.value = false
        archivo.value = null
        huella.value = null
        problema.value = null
        clave = nuevaClaveIdempotencia()
        void nombres.cargar(props.resumen.pagos.map(p => p.cliente_id))
    }
}, { immediate: true })

watch(archivo, async (nuevo) => {
    huella.value = null
    estado.archivo = nuevo?.name ?? ''
    if (nuevo) {
        huella.value = await sha256Archivo(await nuevo.arrayBuffer())
    }
})

async function enviar(evento: FormSubmitEvent<SalidaLiquidacion>) {
    enviando.value = true
    problema.value = null
    const resultado = await useLiquidaciones().registrar(cuerpoLiquidacion(props.resumen.proveedor_cobro_id, evento.data, huella.value), clave)
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
        :title="`Registrar liquidación · ${resumen.nombre}`"
        description="El bruto sale de la cuenta puente, el neto entra al banco y la comisión va a gastos. Un pago se liquida una sola vez."
        :dismissible="!enviando"
        :ui="{ content: 'sm:max-w-2xl' }"
    >
        <template #body>
            <UForm
                id="form-liquidacion"
                ref="formulario"
                :schema="esquema"
                :state="estado"
                class="flex flex-col gap-4"
                @submit="enviar"
            >
                <UFormField
                    label="Pagos incluidos"
                    name="pagos"
                    :help="`${estado.pagos.length} de ${cobros.length} pagos${contracargos.length ? ` · ${estado.contracargos.length} de ${contracargos.length} contracargos` : ''}`"
                >
                    <ul
                        class="flex max-h-56 flex-col divide-y divide-default overflow-y-auto rounded-lg border border-default"
                        data-prueba="liquidacion-pagos"
                    >
                        <li
                            v-for="pago in resumen.pagos"
                            :key="`${pago.tipo}-${pago.pago_id}`"
                            class="flex items-center justify-between gap-3 px-3 py-2"
                        >
                            <UCheckbox
                                :model-value="marcado(pago)"
                                :label="`Pago #${pago.pago_id} · ${nombres.nombre(pago.cliente_id)}`"
                                :description="[formatearFecha(pago.fecha), pago.referencia, pago.tipo === 'contracargo' ? 'Contracargo: se descuenta' : null].filter(Boolean).join(' · ')"
                                :ui="{ description: 'break-all' }"
                                @update:model-value="alternar(pago, $event)"
                            />
                            <span
                                class="shrink-0 tabular-nums text-sm font-medium"
                                :class="pago.tipo === 'contracargo' ? 'text-error' : 'text-highlighted'"
                            >{{ pago.tipo === 'contracargo' ? `− ${formatearQuetzales(pago.monto)}` : formatearQuetzales(pago.monto) }}</span>
                        </li>
                    </ul>
                </UFormField>

                <div class="grid gap-4 sm:grid-cols-3">
                    <UFormField
                        label="Bruto"
                        name="bruto"
                        required
                        :help="brutoDistinto ? `Lo marcado suma ${formatearQuetzales(esperado)}` : 'Σ pagos − contracargos'"
                    >
                        <UInput
                            v-model="estado.bruto"
                            inputmode="decimal"
                            class="w-full"
                            data-prueba="liquidacion-bruto"
                            @input="brutoEditado = true"
                        >
                            <template #leading>
                                <span class="text-sm text-muted">Q</span>
                            </template>
                        </UInput>
                    </UFormField>
                    <UFormField
                        label="Comisión"
                        name="comision"
                        required
                    >
                        <UInput
                            v-model="estado.comision"
                            inputmode="decimal"
                            class="w-full"
                            data-prueba="liquidacion-comision"
                        >
                            <template #leading>
                                <span class="text-sm text-muted">Q</span>
                            </template>
                        </UInput>
                    </UFormField>
                    <div class="flex flex-col gap-1">
                        <span class="text-sm font-medium text-default">Neto al banco</span>
                        <span
                            class="flex h-8 items-center text-base font-semibold tabular-nums text-highlighted"
                            data-prueba="liquidacion-neto"
                        >{{ neto ? formatearQuetzales(neto) : '—' }}</span>
                    </div>
                </div>

                <UAlert
                    v-if="brutoDistinto"
                    color="warning"
                    variant="subtle"
                    icon="i-lucide-triangle-alert"
                    :description="`El bruto no es la suma de lo marcado (${formatearQuetzales(esperado)}): la API lo rechaza como descuadrado.`"
                />

                <div class="grid gap-4 sm:grid-cols-2">
                    <UFormField
                        label="Referencia"
                        name="referencia"
                        required
                        help="Número de la liquidación del proveedor."
                    >
                        <UInput
                            v-model="estado.referencia"
                            placeholder="LIQ-2026-10-18"
                            class="w-full"
                            data-prueba="liquidacion-referencia"
                        />
                    </UFormField>
                    <UFormField
                        label="Fecha del depósito"
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
                    <UFormField
                        label="Banco"
                        name="cuenta_id"
                        class="sm:col-span-2"
                        help="Sin elegir: el banco del proveedor."
                    >
                        <CuentaBancoSelect
                            v-model="estado.cuenta_id"
                            placeholder="El banco del proveedor"
                        />
                    </UFormField>
                    <UFormField
                        label="Archivo de la liquidación"
                        name="archivo"
                        class="sm:col-span-2"
                        :help="huella ? `sha256 ${huella.slice(0, 16)}…` : 'Opcional: se guarda su nombre y su huella, no el archivo.'"
                    >
                        <UFileUpload
                            v-model="archivo"
                            accept=".csv,.xlsx,.pdf,.txt"
                            label="Elige o arrastra el archivo"
                            icon="i-lucide-file-up"
                            layout="list"
                            class="w-full"
                        />
                    </UFormField>
                    <UFormField
                        label="Nota"
                        name="nota"
                        class="sm:col-span-2"
                    >
                        <UTextarea
                            v-model="estado.nota"
                            :rows="2"
                            class="w-full"
                        />
                    </UFormField>
                </div>

                <ProblemaAlerta
                    v-if="problema"
                    :problema="problema"
                    con-errores
                    data-prueba="liquidacion-error"
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
                    form="form-liquidacion"
                    label="Registrar liquidación"
                    icon="i-lucide-hand-coins"
                    :loading="enviando"
                    data-prueba="liquidacion-registrar"
                />
            </div>
        </template>
    </UModal>
</template>
