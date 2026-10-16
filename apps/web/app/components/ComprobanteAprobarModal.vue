<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { FormSubmitEvent } from '@nuxt/ui'
import Decimal from 'decimal.js'

/**
 * Aprobar un comprobante (`POST /comprobantes/:id/aprobar`): registra el pago con los datos del
 * comprobante y reactiva. Como en `/cobro`, se pueden elegir las facturas (`facturas[]`, en el
 * orden de la pantalla) y se ve cómo se repartirá el monto. Sin elegir, la API aplica primero a
 * las del servicio del comprobante y luego a la más antigua. Una `Idempotency-Key` por apertura.
 */
const props = defineProps<{
    comprobante: Comprobante
}>()

const abierto = defineModel<boolean>('open', { default: false })

const emit = defineEmits<{
    hecho: [resultado: Comprobante]
    /** 409 `comprobante_revisado`: la página debe recargar el comprobante. */
    revisado: []
}>()

const { puede } = usePermisos()
const idFormulario = useId()
const hoy = hoyGuatemala()

const estado = reactive<EntradaAprobarComprobante>({ nota: '' })
const enviando = ref(false)
const problema = ref<Problem | null>(null)
let claveIdempotencia = nuevaClaveIdempotencia()

const cuenta = shallowRef<EstadoCuenta | null>(null)
const cargandoCuenta = ref(false)
const problemaCuenta = ref<Problem | null>(null)
const servicios = shallowRef<Servicio[]>([])
const marcadas = ref<number[]>([])

const puedeElegir = computed(() => puede('clientes.estado_cuenta'))
const resumen = computed(() => (cuenta.value ? resumenPendiente(cuenta.value.facturas_pendientes, hoy) : null))
const nombresServicio = computed(() => new Map(servicios.value.map(s => [s.id, etiquetaServicio(s)])))
const monto = computed(() => new Decimal(props.comprobante.monto))

/** Las que irán primero: las marcadas o, sin marcar, las que elegiría la API. */
const efectivas = computed(() => (marcadas.value.length || !resumen.value
    ? marcadas.value
    : facturasPorDefectoComprobante(props.comprobante, resumen.value.facturas)))

const distribucion = computed(() => (resumen.value ? distribuirPago(monto.value, resumen.value.facturas, efectivas.value) : null))

async function cargarCuenta() {
    if (!puedeElegir.value) {
        return
    }
    cargandoCuenta.value = true
    problemaCuenta.value = null
    const [resultado, deServicios] = await Promise.all([
        useClientes().estadoCuenta(props.comprobante.cliente_id),
        puede('servicios.ver') ? useServicios().listar({ cliente_id: props.comprobante.cliente_id, limit: 50 }) : Promise.resolve(null),
    ])
    cargandoCuenta.value = false
    servicios.value = deServicios?.ok ? deServicios.data.data : []
    if (!resultado.ok) {
        cuenta.value = null
        problemaCuenta.value = resultado.problema
        return
    }
    cuenta.value = resultado.data
    // Marcadas por defecto: las que elegiría la API, pero en el orden de la pantalla (así se mandan).
    const pantalla = resumenPendiente(resultado.data.facturas_pendientes, hoy).facturas
    const porDefecto = new Set(facturasPorDefectoComprobante(props.comprobante, pantalla))
    marcadas.value = pantalla.filter(f => porDefecto.has(f.id)).map(f => f.id)
}

function marcar(facturaId: number, valor: boolean) {
    const elegidas = new Set(marcadas.value)
    if (valor) {
        elegidas.add(facturaId)
    }
    else {
        elegidas.delete(facturaId)
    }
    marcadas.value = (resumen.value?.facturas ?? []).filter(f => elegidas.has(f.id)).map(f => f.id)
}

watch(abierto, (valor) => {
    if (valor) {
        estado.nota = ''
        problema.value = null
        claveIdempotencia = nuevaClaveIdempotencia()
        void cargarCuenta()
    }
})

async function enviar(evento: FormSubmitEvent<SalidaAprobarComprobante>) {
    enviando.value = true
    problema.value = null
    const datos: DatosAprobarComprobante = {}
    if (marcadas.value.length) {
        datos.facturas = marcadas.value
    }
    if (evento.data.nota) {
        datos.nota = evento.data.nota
    }
    const resultado = await useComprobantes().aprobar(props.comprobante.id, datos, claveIdempotencia)
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
        title="Aprobar comprobante"
        :description="`#${comprobante.id} · ${comprobante.cliente_nombre} · ${formatearQuetzales(comprobante.monto)}`"
        :dismissible="!enviando"
        :ui="{ content: 'sm:max-w-xl' }"
    >
        <template #body>
            <UForm
                :id="idFormulario"
                :schema="esquemaAprobarComprobante"
                :state="estado"
                class="flex flex-col gap-4"
                @submit="enviar"
            >
                <UAlert
                    color="success"
                    variant="subtle"
                    icon="i-lucide-badge-check"
                    :description="`Se registra un pago por ${ETIQUETAS_METODO[comprobante.metodo].toLowerCase()} de ${formatearQuetzales(comprobante.monto)} a ${comprobante.cuenta_bancaria_nombre} con referencia ${comprobante.referencia}. Si el cliente ya no debe facturas vencidas, su servicio se reactiva.`"
                />

                <section
                    v-if="puedeElegir"
                    class="flex flex-col gap-2"
                >
                    <h3 class="text-sm font-semibold text-highlighted">
                        Facturas a pagar
                    </h3>

                    <ProblemaAlerta
                        v-if="problemaCuenta"
                        :problema="problemaCuenta"
                        :reintentar="cargarCuenta"
                        :reintentando="cargandoCuenta"
                    />
                    <USkeleton
                        v-else-if="cargandoCuenta || !resumen"
                        class="h-24 w-full"
                    />
                    <p
                        v-else-if="!resumen.facturas.length"
                        class="text-sm text-muted"
                    >
                        El cliente no tiene facturas pendientes: todo el monto queda como saldo a favor.
                    </p>
                    <template v-else>
                        <CobroFacturasLista
                            :facturas="resumen.facturas"
                            :marcadas="marcadas"
                            :servicios="nombresServicio"
                            @marcar="marcar"
                        />
                        <p
                            v-if="!marcadas.length"
                            class="text-xs text-muted"
                        >
                            Sin facturas marcadas la API aplica primero a las del servicio del comprobante y luego a la más antigua.
                        </p>
                        <ul
                            v-if="distribucion"
                            class="flex flex-col gap-1 rounded-md bg-elevated/50 p-3 text-xs text-muted"
                            aria-label="Cómo se aplicará el pago"
                            data-prueba="distribucion-comprobante"
                        >
                            <li
                                v-for="linea in [...distribucion.marcadas, ...distribucion.otras].filter(l => l.aplicado.gt(0))"
                                :key="linea.factura.id"
                                class="flex justify-between gap-3"
                            >
                                <span>Aviso #{{ linea.factura.id }} · {{ etiquetaPeriodo(linea.factura.periodo) }}<template v-if="linea.parcial"> (queda parcial)</template></span>
                                <span class="tabular-nums text-default">{{ formatearQuetzales(linea.aplicado) }}</span>
                            </li>
                            <li
                                v-if="distribucion.aFavor.gt(0)"
                                class="flex justify-between gap-3"
                            >
                                <span>Saldo a favor del cliente</span>
                                <span class="tabular-nums text-default">{{ formatearQuetzales(distribucion.aFavor) }}</span>
                            </li>
                        </ul>
                    </template>
                </section>

                <UFormField
                    label="Nota"
                    name="nota"
                    help="Opcional. Queda en el pago junto al número de comprobante."
                >
                    <UTextarea
                        v-model="estado.nota"
                        :rows="2"
                        placeholder="Ej.: verificado en la banca en línea de Banrural"
                        class="w-full"
                    />
                </UFormField>

                <ProblemaAlerta
                    v-if="problema"
                    :problema="problema"
                />
                <p
                    v-if="problema && esReferenciaDuplicada(problema)"
                    class="text-xs text-muted"
                >
                    Ya hay un pago con esa referencia: revisa el pago existente y rechaza este comprobante.
                </p>
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
                    label="Aprobar y registrar pago"
                    icon="i-lucide-badge-check"
                    color="success"
                    :loading="enviando"
                    :disabled="problema !== null && esComprobanteRevisado(problema)"
                />
            </div>
        </template>
    </UModal>
</template>
