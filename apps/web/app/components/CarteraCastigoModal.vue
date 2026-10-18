<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { FormSubmitEvent } from '@nuxt/ui'
import Decimal from 'decimal.js'

/**
 * Castigo de facturas incobrables (`POST /cartera/castigos`, `cartera.castigar`): un cliente, sus
 * facturas con saldo, el motivo y la evidencia de la gestión de cobro (LAT art. 21.20), con
 * confirmación escrita porque no se deshace desde el panel. Usa primero la estimación (1.1.12) y
 * luego el gasto (5.3.02). Al terminar se vuelve a leer cada factura y se muestra el estado que
 * diga la API (hoy queda `pagada`; puede cambiar a uno propio).
 */
const abierto = defineModel<boolean>('open', { default: false })

const emit = defineEmits<{
    hecho: [castigo: CastigoCartera]
}>()

const formulario = useTemplateRef('formulario')
const clienteId = ref(0)
const cliente = shallowRef<Cliente | null>(null)
const facturas = shallowRef<Factura[]>([])
const cargandoFacturas = ref(false)
const problemaFacturas = ref<Problem | null>(null)
const estado = reactive<EntradaCastigo>({ facturas: [], motivo: '', evidencia: '', confirmacion: '' })
const enviando = ref(false)
const problema = ref<Problem | null>(null)
let clave = nuevaClaveIdempotencia()

const castigables = computed(() => facturasCastigables(facturas.value))
const totalElegido = computed(() => castigables.value.filter(f => estado.facturas.includes(f.id)).reduce((suma, f) => suma.plus(saldoFactura(f)), new Decimal(0)))

watch(abierto, (valor) => {
    if (valor) {
        clienteId.value = 0
        cliente.value = null
        facturas.value = []
        problemaFacturas.value = null
        Object.assign(estado, { facturas: [], motivo: '', evidencia: '', confirmacion: '' })
        problema.value = null
        clave = nuevaClaveIdempotencia()
    }
})

async function cargarFacturas() {
    if (!clienteId.value) {
        facturas.value = []
        return
    }
    cargandoFacturas.value = true
    problemaFacturas.value = null
    const resultado = await useFacturas().listar({ cliente_id: clienteId.value, limit: 200 })
    cargandoFacturas.value = false
    facturas.value = resultado.ok ? resultado.data.data : []
    problemaFacturas.value = resultado.ok ? null : resultado.problema
    estado.facturas = []
}

watch(clienteId, cargarFacturas)

function alternar(id: number, valor: boolean | 'indeterminate') {
    const resto = estado.facturas.filter(f => f !== id)
    estado.facturas = valor === true ? [...resto, id] : resto
}

async function enviar(evento: FormSubmitEvent<EntradaCastigo>) {
    enviando.value = true
    problema.value = null
    const resultado = await useCartera().castigar({ facturas: evento.data.facturas, motivo: evento.data.motivo, evidencia: evento.data.evidencia }, clave)
    enviando.value = false
    if (resultado.ok) {
        abierto.value = false
        emit('hecho', resultado.data)
        return
    }
    const errores = erroresDeFormulario(resultado.problema).map(e => ({ ...e, name: e.name?.startsWith('facturas') ? 'facturas' : e.name }))
    formulario.value?.setErrors(errores.filter(e => e.name && Object.hasOwn(estado, e.name)))
    problema.value = resultado.problema
}
</script>

<template>
    <UModal
        v-model:open="abierto"
        title="Castigar cartera"
        description="Da de baja facturas incobrables con su gestión de cobro documentada. Sale de la estimación y, lo que falte, del gasto. No se deshace desde el panel."
        :dismissible="!enviando"
        :ui="{ content: 'sm:max-w-2xl' }"
    >
        <template #body>
            <UForm
                id="form-castigo"
                ref="formulario"
                :schema="esquemaCastigo"
                :state="estado"
                class="flex flex-col gap-4"
                @submit="enviar"
            >
                <UFormField
                    label="Cliente"
                    required
                >
                    <ClienteSelector
                        v-model="clienteId"
                        :seleccionado="cliente"
                        @elegido="cliente = $event"
                    />
                </UFormField>

                <UFormField
                    v-if="clienteId"
                    label="Facturas a castigar"
                    name="facturas"
                    required
                    :help="estado.facturas.length ? `${estado.facturas.length} ${estado.facturas.length === 1 ? 'factura' : 'facturas'} · saldo ${formatearQuetzales(totalElegido)}` : 'Solo facturas con saldo. Una empresa por castigo.'"
                >
                    <ProblemaAlerta
                        v-if="problemaFacturas"
                        :problema="problemaFacturas"
                        :reintentar="cargarFacturas"
                        :reintentando="cargandoFacturas"
                    />
                    <USkeleton
                        v-else-if="cargandoFacturas"
                        class="h-20 w-full"
                    />
                    <UEmpty
                        v-else-if="!castigables.length"
                        icon="i-lucide-circle-check"
                        title="Sin facturas con saldo"
                        variant="naked"
                    />
                    <ul
                        v-else
                        class="flex max-h-56 flex-col divide-y divide-default overflow-y-auto rounded-lg border border-default"
                        data-prueba="castigo-facturas"
                    >
                        <li
                            v-for="factura in castigables"
                            :key="factura.id"
                            class="flex items-center justify-between gap-3 px-3 py-2"
                        >
                            <UCheckbox
                                :model-value="estado.facturas.includes(factura.id)"
                                :label="`Factura #${factura.id} · ${formatearFecha(factura.periodo)}`"
                                :description="`Vence ${formatearFecha(factura.vence_en)} · ${estadoFacturaVisual(factura.estado).etiqueta}${factura.empresa_nombre ? ` · ${factura.empresa_nombre}` : ''}`"
                                :data-factura="factura.id"
                                @update:model-value="alternar(factura.id, $event)"
                            />
                            <span class="shrink-0 tabular-nums text-sm font-medium">{{ formatearQuetzales(saldoFactura(factura)) }}</span>
                        </li>
                    </ul>
                </UFormField>

                <UFormField
                    label="Motivo"
                    name="motivo"
                    required
                >
                    <UInput
                        v-model="estado.motivo"
                        placeholder="Cliente cerró operaciones; incobrable"
                        class="w-full"
                        data-prueba="castigo-motivo"
                    />
                </UFormField>
                <UFormField
                    label="Evidencia de la gestión de cobro"
                    name="evidencia"
                    required
                    help="Llamadas, cartas, avisos y fechas (LAT art. 21.20). Queda guardada con el castigo."
                >
                    <UTextarea
                        v-model="estado.evidencia"
                        :rows="3"
                        placeholder="3 llamadas (02, 09 y 16-oct), carta certificada del 05-oct, aviso por correo sin respuesta"
                        class="w-full"
                        data-prueba="castigo-evidencia"
                    />
                </UFormField>

                <UAlert
                    color="error"
                    variant="subtle"
                    icon="i-lucide-file-x"
                    :description="`Escribe ${FRASE_CASTIGO} para confirmar. Las facturas dejan de deberse y el castigo queda en el libro.`"
                />
                <UFormField
                    label="Confirmación"
                    name="confirmacion"
                    required
                >
                    <UInput
                        v-model="estado.confirmacion"
                        :placeholder="FRASE_CASTIGO"
                        autocomplete="off"
                        class="w-full"
                        data-prueba="castigo-confirmacion"
                    />
                </UFormField>

                <ProblemaAlerta
                    v-if="problema"
                    :problema="problema"
                    con-errores
                    data-prueba="castigo-error"
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
                    form="form-castigo"
                    label="Castigar facturas"
                    icon="i-lucide-file-x"
                    color="error"
                    :loading="enviando"
                    data-prueba="castigo-confirmar"
                />
            </div>
        </template>
    </UModal>
</template>
