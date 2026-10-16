<script setup lang="ts">
import type { Problem, Schema } from '@argosisp/contracts'
import type { TableColumn } from '@nuxt/ui'
import Decimal from 'decimal.js'

definePageMeta({ permiso: 'pagos.ver' })

type Aplicacion = Schema<'AplicacionPago'>

const route = useRoute()
const { puede, enlace } = usePermisos()
const toast = useToast()
const nombres = useNombresClientes()

const pagoId = computed(() => Number(route.params.id))

const pago = shallowRef<Pago | null>(null)
const cargando = ref(true)
const problema = ref<Problem | null>(null)

const asientos = shallowRef<Asiento[]>([])
const cargandoAsientos = ref(false)
const problemaAsientos = ref<Problem | null>(null)

const anularAbierto = ref(false)
/** Cómo quedaron los servicios tras anular (si la API lo devuelve). */
const evaluados = shallowRef<ServicioEvaluado[]>([])

useHead(() => ({ title: `Pago #${route.params.id} · ArgosIsp` }))

const puedeAnular = computed(() => puede('pagos.anular') && pago.value !== null && pago.value.estado !== 'anulado')

const columnasAplicaciones: TableColumn<Aplicacion>[] = [
    { accessorKey: 'factura_id', header: 'Factura' },
    { accessorKey: 'monto', header: 'Aplicado', meta: { class: { th: 'text-right', td: 'text-right' } } },
]

const anticipo = computed(() => {
    if (!pago.value) {
        return null
    }
    const aplicado = pago.value.aplicaciones.reduce((suma, a) => suma.plus(a.monto), new Decimal(0))
    const resto = new Decimal(pago.value.monto).minus(aplicado)
    return resto.gt(0) ? resto : null
})

async function cargarAsientos(actual: Pago) {
    if (!puede('libro.ver')) {
        return
    }
    cargandoAsientos.value = true
    const resultado = await useLibro().asientosDe('pago', actual.id, sumarDiasFecha(fechaGuatemala(actual.created_at), -1))
    cargandoAsientos.value = false
    asientos.value = resultado.ok ? resultado.data : []
    problemaAsientos.value = resultado.ok ? null : resultado.problema
}

function reintentarAsientos() {
    if (pago.value) {
        void cargarAsientos(pago.value)
    }
}

async function cargar() {
    cargando.value = true
    problema.value = null
    const resultado = await usePagos().ver(pagoId.value)
    cargando.value = false
    if (!resultado.ok) {
        pago.value = null
        problema.value = resultado.problema
        return
    }
    pago.value = resultado.data
    void nombres.cargar([resultado.data.cliente_id])
    void cargarAsientos(resultado.data)
}

function anular(motivo: string, clave: string) {
    return usePagos().anular(pagoId.value, motivo, clave)
}

function alAnular(anulado: Pago) {
    evaluados.value = (anulado.servicios ?? []).filter(s => s.cambiado)
    toast.add({
        title: 'Pago anulado',
        description: `Pago #${anulado.id} · ${formatearQuetzales(anulado.monto)} vuelve a deberse`,
        icon: 'i-lucide-ban',
        color: 'success',
    })
    void cargar()
}

watch(pagoId, cargar)
onMounted(cargar)
</script>

<template>
    <PanelPagina
        id="pago"
        :titulo="`Pago #${route.params.id}`"
        icono="i-lucide-banknote"
    >
        <template #acciones>
            <UButton
                to="/pagos"
                icon="i-lucide-arrow-left"
                label="Pagos"
                color="neutral"
                variant="ghost"
                class="hidden sm:inline-flex"
            />
        </template>

        <div
            v-if="cargando && !pago"
            class="flex flex-col gap-4"
        >
            <USkeleton class="h-8 w-64" />
            <USkeleton class="h-32 w-full" />
        </div>

        <UEmpty
            v-else-if="problema?.status === 404"
            icon="i-lucide-file-x"
            title="Pago no encontrado"
            :description="`No existe un pago con id ${route.params.id}.`"
            :actions="[{ label: 'Volver a pagos', to: '/pagos', icon: 'i-lucide-arrow-left', color: 'neutral', variant: 'subtle' }]"
        />

        <ProblemaAlerta
            v-else-if="problema"
            :problema="problema"
            :reintentar="cargar"
            :reintentando="cargando"
        />

        <div
            v-else-if="pago"
            class="flex flex-col gap-6"
        >
            <div class="flex flex-wrap items-start justify-between gap-3">
                <div class="flex flex-col gap-1">
                    <div class="flex flex-wrap items-center gap-2">
                        <h2 class="text-xl font-semibold text-highlighted">
                            Pago #{{ pago.id }}
                        </h2>
                        <EstadoPagoBadge :estado="pago.estado" />
                    </div>
                    <p class="text-sm text-muted">
                        {{ formatearFechaHora(pago.created_at) }} ·
                        <ULink
                            :to="enlace(`/clientes/${pago.cliente_id}?tab=cuenta`)"
                            class="text-default hover:text-primary"
                        >
                            {{ nombres.nombre(pago.cliente_id) }}
                        </ULink>
                    </p>
                </div>
                <UButton
                    v-if="puedeAnular"
                    label="Anular pago"
                    icon="i-lucide-ban"
                    color="error"
                    variant="outline"
                    @click="anularAbierto = true"
                />
            </div>

            <UAlert
                v-if="pago.estado === 'anulado'"
                color="neutral"
                variant="subtle"
                icon="i-lucide-ban"
                title="Pago anulado"
                :description="[pago.anulado_en ? formatearFechaHora(pago.anulado_en) : null, pago.motivo_anulacion].filter(Boolean).join(' · ') || undefined"
                data-prueba="pago-anulado"
            />

            <UAlert
                v-for="servicio in evaluados"
                :key="servicio.servicio_id"
                color="warning"
                variant="subtle"
                :icon="ESTADOS_SERVICIO[servicio.estado].icono"
                :title="`Servicio ${servicio.servicio_id}: ${ESTADOS_SERVICIO[servicio.de].etiqueta} → ${ESTADOS_SERVICIO[servicio.estado].etiqueta}`"
                :description="servicio.motivo"
            />

            <UPageCard
                title="Datos del pago"
                icon="i-lucide-receipt"
                variant="subtle"
            >
                <dl class="grid grid-cols-2 gap-x-6 gap-y-4 lg:grid-cols-4">
                    <DatoFicha
                        etiqueta="Monto"
                        :valor="formatearQuetzales(pago.monto)"
                    />
                    <DatoFicha
                        etiqueta="Comisión"
                        :valor="formatearQuetzales(pago.comision)"
                    />
                    <DatoFicha
                        etiqueta="Método"
                        :valor="ETIQUETAS_METODO[pago.metodo]"
                    />
                    <DatoFicha
                        :etiqueta="etiquetaReferencia(pago.metodo)"
                        :valor="pago.referencia"
                        mono
                    />
                    <DatoFicha
                        v-if="pago.banco_origen_nombre"
                        etiqueta="Banco de origen"
                        :valor="pago.banco_origen_nombre"
                    />
                    <DatoFicha
                        v-if="pago.cuenta_bancaria_nombre"
                        etiqueta="Cuenta de destino"
                        :valor="pago.cuenta_bancaria_nombre"
                    />
                    <DatoFicha
                        v-if="pago.caja_id"
                        etiqueta="Caja"
                        :valor="`Caja #${pago.caja_id}`"
                    />
                    <DatoFicha
                        v-if="pago.pasarela"
                        etiqueta="Pasarela"
                        :valor="pago.pasarela"
                    />
                    <DatoFicha
                        etiqueta="Registrado por"
                        :valor="pago.registrado_por ? `Usuario #${pago.registrado_por}` : 'Sistema'"
                    />
                    <DatoFicha
                        v-if="anticipo"
                        etiqueta="Anticipo sin aplicar"
                        :valor="formatearQuetzales(anticipo)"
                    />
                    <DatoFicha
                        etiqueta="Nota"
                        :valor="pago.nota"
                        class="col-span-2"
                    />
                </dl>
            </UPageCard>

            <section class="flex flex-col gap-2">
                <h3 class="text-sm font-semibold text-highlighted">
                    Facturas pagadas
                </h3>
                <UTable
                    :data="pago.aplicaciones"
                    :columns="columnasAplicaciones"
                >
                    <template #factura_id-cell="{ row }">
                        <ULink
                            v-if="puede('facturas.ver')"
                            :to="`/facturas/${row.original.factura_id}`"
                            class="text-sm font-medium text-highlighted hover:text-primary"
                        >
                            Factura #{{ row.original.factura_id }}
                        </ULink>
                        <span
                            v-else
                            class="text-sm"
                        >Factura #{{ row.original.factura_id }}</span>
                    </template>
                    <template #monto-cell="{ row }">
                        <span class="tabular-nums font-medium">{{ formatearQuetzales(row.original.monto) }}</span>
                    </template>
                    <template #empty>
                        <UEmpty
                            icon="i-lucide-piggy-bank"
                            title="No se aplicó a facturas"
                            description="Todo el monto quedó como anticipo del cliente."
                            variant="naked"
                        />
                    </template>
                </UTable>
            </section>

            <section
                v-if="puede('libro.ver')"
                class="flex flex-col gap-2"
            >
                <h3 class="text-sm font-semibold text-highlighted">
                    Asientos del libro
                </h3>
                <ProblemaAlerta
                    v-if="problemaAsientos"
                    :problema="problemaAsientos"
                    :reintentar="reintentarAsientos"
                    :reintentando="cargandoAsientos"
                />
                <USkeleton
                    v-else-if="cargandoAsientos && !asientos.length"
                    class="h-24 w-full"
                />
                <p
                    v-else-if="!asientos.length"
                    class="text-sm text-muted"
                >
                    No se encontró el asiento de este pago en el libro diario.
                </p>
                <div
                    v-else
                    class="grid gap-3 lg:grid-cols-2"
                >
                    <AsientoContable
                        v-for="asiento in asientos"
                        :key="asiento.id"
                        :asiento="asiento"
                        :con-origen="false"
                    />
                </div>
            </section>

            <AccionMotivoModal
                v-model:open="anularAbierto"
                titulo="Anular pago"
                :descripcion="`Pago #${pago.id} · ${formatearQuetzales(pago.monto)} · ${nombres.nombre(pago.cliente_id)}`"
                efecto="Se registra un asiento de reverso, las facturas vuelven a deber lo que este pago cubría y la API vuelve a evaluar sus servicios (pueden cortarse). No se puede deshacer."
                confirmar="Anular pago"
                placeholder="Ej.: el depósito fue rechazado por el banco"
                :ejecutar="anular"
                @hecho="alAnular"
            />
        </div>
    </PanelPagina>
</template>
