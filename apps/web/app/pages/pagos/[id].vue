<script setup lang="ts">
import type { Problem, Schema } from '@argosisp/contracts'
import type { DropdownMenuItem, TableColumn } from '@nuxt/ui'
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

/*
 * Fase 4: proveedor de cobro (pasarela, agente o débito con fecha de corte) y su liquidación. El
 * nombre viene en el pago; la cuenta puente sale de `GET /cobros/proveedores` (`bancos.ver`).
 */
const proveedores = shallowRef<ProveedorCobro[]>([])
const proveedor = computed(() => (pago.value?.proveedor_cobro_id ? proveedores.value.find(p => p.id === pago.value?.proveedor_cobro_id) ?? null : null))
/** `Pago.proveedor_cobro_nombre` (lo ve cualquiera con `pagos.ver`); la cuenta puente, con `bancos.ver`. */
const nombreProveedor = computed(() => {
    const actual = pago.value
    if (!actual?.proveedor_cobro_id) {
        return ''
    }
    const nombre = actual.proveedor_cobro_nombre ?? proveedor.value?.nombre ?? `Proveedor #${actual.proveedor_cobro_id}`
    return proveedor.value ? `${nombre} · ${proveedor.value.cuenta_codigo}` : nombre
})

/*
 * Cerrar diferencia (`pagos.cerrar_diferencia`): el saldo pequeño que el pago dejó en sus facturas.
 * Con `facturas.ver` se lee cuánto quedó; sin él, el botón se ofrece y la API decide.
 */
const saldosFacturas = ref<Record<number, Decimal> | null>(null)
const pendienteFacturas = computed(() => (saldosFacturas.value ? Object.values(saldosFacturas.value).reduce((suma, saldo) => suma.plus(saldo), new Decimal(0)) : null))
const diferenciaAbierta = ref(false)
const diferenciaCerrada = shallowRef<DiferenciaCerrada | null>(null)
const puedeCerrarDiferencia = computed(() => puede('pagos.cerrar_diferencia') && pago.value !== null && pago.value.estado === 'registrado'
    && pago.value.aplicaciones.length > 0 && (pendienteFacturas.value === null || pendienteFacturas.value.gt(0)))

async function cargarProveedores(actual: Pago) {
    if (!actual.proveedor_cobro_id || !puede('bancos.ver')) {
        return
    }
    const resultado = await useProveedoresCobro().listar()
    proveedores.value = resultado.ok ? resultado.data : []
}

async function cargarSaldos(actual: Pago) {
    saldosFacturas.value = null
    if (!puede('facturas.ver') || actual.estado !== 'registrado' || !actual.aplicaciones.length) {
        return
    }
    const ids = [...new Set(actual.aplicaciones.map(a => a.factura_id))]
    const leidas = await Promise.all(ids.map(id => useFacturas().ver(id)))
    if (leidas.some(r => !r.ok)) {
        return
    }
    const saldos: Record<number, Decimal> = {}
    leidas.forEach((r) => {
        if (r.ok && ['emitida', 'parcial', 'vencida'].includes(r.data.estado)) {
            saldos[r.data.id] = saldoFactura(r.data)
        }
    })
    saldosFacturas.value = saldos
}

function cerrarDiferencia(motivo: string, clave: string) {
    return usePagos().cerrarDiferencia(pagoId.value, motivo, clave)
}

function alCerrarDiferencia(resultado: DiferenciaCerrada) {
    diferenciaCerrada.value = resultado
    toast.add({
        title: 'Diferencia cerrada',
        description: `${formatearQuetzales(resultado.monto)} como gasto en ${resultado.diferencias.length} ${resultado.diferencias.length === 1 ? 'factura' : 'facturas'} (tope ${formatearQuetzales(resultado.tope)})`,
        icon: 'i-lucide-circle-check',
        color: 'success',
    })
    void cargar()
}
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
    void cargarProveedores(resultado.data)
    void cargarSaldos(resultado.data)
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

/** Pestañas dentro de la tarjeta del pago (sistema visual nuevo). */
const pestana = ref<'datos' | 'facturas' | 'asientos'>('datos')
const itemsPestanas = computed(() => [
    { label: 'Datos', value: 'datos', icon: 'i-lucide-receipt' },
    { label: 'Facturas', value: 'facturas', icon: 'i-lucide-receipt-text', badge: pago.value?.aplicaciones.length || undefined },
    ...(puede('libro.ver') ? [{ label: 'Asientos', value: 'asientos', icon: 'i-lucide-book-open' }] : []),
])

const generandoRecibo = ref(false)
async function imprimirRecibo(plantillaId: number | null) {
    const cobroId = pago.value?.cobro_id
    if (!cobroId || generandoRecibo.value) {
        return
    }
    generandoRecibo.value = true
    const problemaPdf = await abrirPdf(() => useDocumentos().reciboCobro(cobroId, plantillaId), `recibo-cobro-${cobroId}.pdf`)
    generandoRecibo.value = false
    if (problemaPdf) {
        useToast().add({ title: 'No se pudo generar el recibo', description: problemaPdf.detail ?? problemaPdf.title, icon: 'i-lucide-circle-alert', color: 'error' })
    }
}

const itemsMas = computed<DropdownMenuItem[][]>(() => [
    ...(puedeCerrarDiferencia.value ? [[{ label: 'Cerrar diferencia', icon: 'i-lucide-scissors', onSelect: () => { diferenciaAbierta.value = true } }]] : []),
    ...(pago.value && enlace(`/clientes/${pago.value.cliente_id}`) ? [[{ label: 'Ver cliente', icon: 'i-lucide-user', to: enlace(`/clientes/${pago.value.cliente_id}?tab=cuenta`) }]] : []),
])
</script>

<template>
    <PanelPagina
        id="pago"
        :titulo="`Pago #${route.params.id}`"
        icono="i-lucide-banknote"
    >
        <template #acciones>
            <ImprimirConPlantilla
                v-if="pago?.cobro_id && puede('pagos.ver')"
                tipo="recibo_cobro"
                etiqueta="Imprimir recibo"
                variant="solid"
                :generando="generandoRecibo"
                data-prueba="recibo-pdf"
                @imprimir="imprimirRecibo"
            />
            <!-- Como «Anular factura» en OperFacturaDetalle: la anulación va a la vista, el resto en «Más». -->
            <UButton
                v-if="puedeAnular"
                label="Anular pago"
                icon="i-lucide-ban"
                color="error"
                variant="outline"
                class="rounded-full"
                data-prueba="anular-pago"
                @click="anularAbierto = true"
            />
            <UDropdownMenu
                v-if="itemsMas.length"
                :items="itemsMas"
                :content="{ align: 'end' }"
            >
                <UButton
                    icon="i-lucide-ellipsis"
                    color="neutral"
                    variant="outline"
                    class="rounded-full"
                    aria-label="Más acciones del pago"
                    data-prueba="mas-pago"
                />
            </UDropdownMenu>
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
            class="flex flex-col gap-4"
        >
            <div class="surface-card flex flex-wrap items-start justify-between gap-3 rounded-2xl p-4">
                <div class="flex flex-col gap-1">
                    <div class="flex flex-wrap items-center gap-2">
                        <span class="pastilla-icono size-10 bg-primary/10 text-primary">
                            <UIcon
                                :name="pago.metodo === 'caja' ? 'i-lucide-banknote' : 'i-lucide-landmark'"
                                class="size-5"
                            />
                        </span>
                        <h2 class="text-xl font-bold text-highlighted">
                            {{ ETIQUETAS_METODO[pago.metodo] }}
                        </h2>
                        <EstadoPagoBadge :estado="pago.estado" />
                        <UBadge
                            v-if="esPagoHistorico(pago)"
                            label="Importado"
                            icon="i-lucide-import"
                            color="neutral"
                            variant="outline"
                            data-prueba="pago-historico"
                        />
                    </div>
                    <p
                        v-if="esPagoHistorico(pago)"
                        class="text-xs text-dimmed"
                    >
                        Pago histórico de otro sistema, con su fecha original: no pasó por caja ni bancos.<template v-if="pago.origen || pago.id_externo">
                            Origen: <span class="font-mono">{{ [pago.origen, pago.id_externo].filter(Boolean).join(' · ') }}</span>
                        </template>
                    </p>
                    <p class="text-sm text-muted">
                        {{ formatearFechaHora(pago.created_at) }} ·
                        <ULink
                            :to="enlace(`/clientes/${pago.cliente_id}?tab=cuenta`)"
                            class="text-default underline hover:text-primary"
                        >
                            {{ nombres.nombre(pago.cliente_id) }}
                        </ULink>
                    </p>
                </div>
                <div class="flex flex-col items-end">
                    <span class="text-xs text-muted">Monto</span>
                    <span
                        class="text-2xl font-bold tabular-nums"
                        :class="pago.estado === 'anulado' ? 'text-muted line-through' : 'text-highlighted'"
                    >{{ formatearQuetzales(pago.monto) }}</span>
                </div>
            </div>

            <UAlert
                v-if="diferenciaCerrada"
                color="success"
                variant="subtle"
                icon="i-lucide-scissors"
                :title="`Diferencia de ${formatearQuetzales(diferenciaCerrada.monto)} cerrada`"
                data-prueba="resultado-diferencia"
            >
                <template #description>
                    <ul class="flex flex-col gap-0.5">
                        <li
                            v-for="diferencia in diferenciaCerrada.diferencias"
                            :key="diferencia.diferencia_id"
                            data-prueba="diferencia-cerrada"
                        >
                            <ULink
                                v-if="puede('facturas.ver')"
                                :to="enlace(`/facturas/${diferencia.factura_id}`)"
                                class="underline"
                            >Factura #{{ diferencia.factura_id }}</ULink>
                            <span v-else>Factura #{{ diferencia.factura_id }}</span>:
                            {{ formatearQuetzales(diferencia.monto) }} a gasto (5.3.05 Diferencias de cobro) · asiento #{{ diferencia.asiento_id }}
                        </li>
                    </ul>
                </template>
            </UAlert>

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

            <div class="surface-card flex flex-col gap-4 rounded-2xl p-3 sm:p-4">
                <UTabs
                    v-model="pestana"
                    :items="itemsPestanas"
                    :content="false"
                    color="neutral"
                    variant="pill"
                    class="w-full sm:w-auto"
                    :ui="{ list: 'rounded-xl bg-(--ax-panel) p-1 sm:w-fit', trigger: 'rounded-lg px-4 data-[state=active]:bg-(--ax-tarjeta) data-[state=active]:text-primary data-[state=active]:shadow-sm max-sm:flex-1' }"
                    aria-label="Secciones del pago"
                />
                <dl
                    v-if="pestana === 'datos'"
                    class="grid grid-cols-2 gap-x-6 gap-y-4 lg:grid-cols-4"
                >
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
                        v-if="pago.proveedor_cobro_id"
                        etiqueta="Proveedor de cobro"
                        data-prueba="pago-proveedor"
                    >
                        <ULink
                            :to="enlace('/configuracion/proveedores-cobro')"
                            class="hover:text-primary"
                        >
                            {{ nombreProveedor }}
                        </ULink>
                    </DatoFicha>
                    <DatoFicha
                        v-if="pago.proveedor_cobro_id"
                        etiqueta="Liquidación"
                        data-prueba="pago-liquidacion"
                    >
                        <ULink
                            v-if="pago.liquidacion_id"
                            :to="enlace(`/cobros/liquidaciones/${pago.liquidacion_id}`)"
                            class="hover:text-primary"
                        >
                            Liquidación #{{ pago.liquidacion_id }}
                        </ULink>
                        <UBadge
                            v-else
                            label="Por liquidar"
                            icon="i-lucide-hourglass"
                            color="warning"
                            variant="subtle"
                            size="sm"
                        />
                    </DatoFicha>
                    <DatoFicha
                        v-if="pendienteFacturas && pendienteFacturas.gt(0)"
                        etiqueta="Saldo pendiente en sus facturas"
                        :valor="formatearQuetzales(pendienteFacturas)"
                        data-prueba="pago-saldo-facturas"
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

                <section
                    v-else-if="pestana === 'facturas'"
                    class="flex flex-col gap-2"
                >
                    <h3 class="sr-only">
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
                    v-else-if="pestana === 'asientos' && puede('libro.ver')"
                    class="flex flex-col gap-2"
                >
                    <h3 class="sr-only">
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
            </div>

            <AccionMotivoModal
                v-model:open="diferenciaAbierta"
                titulo="Cerrar diferencia"
                :descripcion="`Pago #${pago.id} · ${pendienteFacturas ? `saldo ${formatearQuetzales(pendienteFacturas)} en sus facturas` : nombres.nombre(pago.cliente_id)}`"
                efecto="Cierra como gasto (5.3.05 Diferencias de cobro) el saldo pequeño que dejó este pago en cada factura, hasta el tope de la empresa. No toca el IVA ni el DTE; las facturas quedan pagadas. Si el saldo supera el tope, la API no lo cierra. Anular el pago revierte la diferencia."
                confirmar="Cerrar diferencia"
                icono="i-lucide-scissors"
                color="warning"
                placeholder="Ej.: el cliente pagó Q 0.33 de menos por redondeo"
                :ejecutar="cerrarDiferencia"
                @hecho="alCerrarDiferencia"
            />
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
