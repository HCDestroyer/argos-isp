<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { FormSubmitEvent, SelectItem } from '@nuxt/ui'
import Decimal from 'decimal.js'

/**
 * Cobro rápido (pedido del PM): una sola pantalla para buscar al cliente, ver lo que debe,
 * registrar el pago y entregar el recibo. Enter registra; Esc limpia.
 */
definePageMeta({ permiso: 'pagos.registrar' })

useHead({ title: 'Cobrar · ArgosIsp' })

const route = useRoute()
const router = useRouter()
const { puede } = usePermisos()
const usuario = useUsuarioActual()
const toast = useToast()

function idQuery(valor: unknown): number {
    const id = Number(typeof valor === 'string' ? valor : '')
    return Number.isInteger(id) && id > 0 ? id : 0
}

// Cliente elegido
const clienteId = ref(idQuery(route.query.cliente))
const cliente = shallowRef<Cliente | null>(null)
const problemaCliente = ref<Problem | null>(null)

// Lo que debe
const cuenta = shallowRef<EstadoCuenta | null>(null)
const cargandoCuenta = ref(false)
const problemaCuenta = ref<Problem | null>(null)
const resumen = computed(() => (cuenta.value ? resumenPendiente(cuenta.value.facturas_pendientes, hoyGuatemala()) : null))

// Sus servicios
const servicios = shallowRef<Servicio[]>([])
const cargandoServicios = ref(false)
const problemaServicios = ref<Problem | null>(null)

// Cajas con turno abierto (método "caja")
const cajas = shallowRef<Caja[]>([])
const problemaCajas = ref<Problem | null>(null)
const cajasAbiertas = computed(() => cajas.value.filter(c => c.activa && c.turno_abierto_id !== null))
const itemsCaja = computed<SelectItem[]>(() => cajasAbiertas.value.map(c => ({ label: c.nombre, value: c.id })))

// Formulario
const formulario = useTemplateRef('formulario')
const estado = reactive<EntradaCobro>({ monto: '', metodo: 'caja', caja_id: null, referencia: '', nota: '' })
const enviando = ref(false)
const problemaPago = ref<Problem | null>(null)
let claveIdempotencia = nuevaClaveIdempotencia()

// Resultado
const pago = shallowRef<Pago | null>(null)
const facturasAntes = shallowRef<EstadoCuenta['facturas_pendientes']>([])
const seguimiento = useSeguimientoReactivacion()

const itemsMetodo: SelectItem[] = METODOS_COBRO.map(m => ({ label: m.etiqueta, value: m.metodo, icon: m.icono }))

const montoValido = computed(() => /^\d{1,12}(\.\d{1,2})?$/.test(estado.monto.trim()))
/** Cuánto quedaría debiendo con el monto escrito, o el saldo a favor si paga de más. */
const restante = computed(() => (resumen.value && montoValido.value ? resumen.value.pendiente.minus(new Decimal(estado.monto.trim())) : null))

const nombreCaja = computed(() => cajas.value.find(c => c.id === pago.value?.caja_id)?.nombre ?? null)

/** Servicios a mostrar: los que sigue el seguimiento tras el pago, o los cargados. */
const serviciosVista = computed(() => (pago.value && seguimiento.servicios.value.length ? seguimiento.servicios.value : servicios.value))
const reactivados = computed(() => new Set(seguimiento.reactivados.value.map(s => s.id)))

function cajaPorDefecto() {
    if (estado.caja_id !== null && cajasAbiertas.value.some(c => c.id === estado.caja_id)) {
        return
    }
    const mia = cajasAbiertas.value.find(c => c.cajero_id === usuario.value?.id)
    estado.caja_id = mia?.id ?? (cajasAbiertas.value.length === 1 ? (cajasAbiertas.value[0]?.id ?? null) : null)
}

async function cargarCajas() {
    if (!puede('cajas.ver')) {
        return
    }
    const resultado = await useCajas().listar()
    cajas.value = resultado.ok ? resultado.data : []
    problemaCajas.value = resultado.ok ? null : resultado.problema
    cajaPorDefecto()
}

async function cargarCuenta() {
    if (!clienteId.value || !puede('clientes.estado_cuenta')) {
        return
    }
    cargandoCuenta.value = true
    const resultado = await useClientes().estadoCuenta(clienteId.value)
    cargandoCuenta.value = false
    cuenta.value = resultado.ok ? resultado.data : null
    problemaCuenta.value = resultado.ok ? null : resultado.problema
}

async function cargarServicios() {
    if (!clienteId.value || !puede('servicios.ver')) {
        return
    }
    cargandoServicios.value = true
    const resultado = await useServicios().listar({ cliente_id: clienteId.value, limit: 200 })
    cargandoServicios.value = false
    servicios.value = resultado.ok ? resultado.data.data : []
    problemaServicios.value = resultado.ok ? null : resultado.problema
}

function limpiarFormulario() {
    estado.monto = resumen.value ? montoSugerido(resumen.value) : ''
    estado.metodo = 'caja'
    estado.referencia = ''
    estado.nota = ''
    cajaPorDefecto()
    problemaPago.value = null
    formulario.value?.clear()
    claveIdempotencia = nuevaClaveIdempotencia()
}

async function elegirCliente(id: number) {
    pago.value = null
    seguimiento.reiniciar()
    cuenta.value = null
    servicios.value = []
    problemaCliente.value = null
    problemaCuenta.value = null
    problemaServicios.value = null
    await router.replace({ query: id ? { cliente: String(id) } : {} })
    if (!id) {
        cliente.value = null
        limpiarFormulario()
        return
    }
    if (cliente.value?.id !== id) {
        const resultado = await useClientes().ver(id)
        cliente.value = resultado.ok ? resultado.data : null
        problemaCliente.value = resultado.ok ? null : resultado.problema
    }
    await Promise.all([cargarCuenta(), cargarServicios()])
    limpiarFormulario()
}

async function registrar(evento: FormSubmitEvent<SalidaCobro>) {
    if (!cliente.value || enviando.value) {
        return
    }
    enviando.value = true
    problemaPago.value = null
    const datos = evento.data
    const resultado = await usePagos().registrar({
        cliente_id: cliente.value.id,
        metodo: datos.metodo,
        monto: new Decimal(datos.monto).toFixed(2),
        referencia: datos.referencia || null,
        caja_id: datos.metodo === 'caja' ? datos.caja_id : null,
        nota: datos.nota || null,
    }, claveIdempotencia)
    enviando.value = false

    if (!resultado.ok) {
        problemaPago.value = resultado.problema
        // Un rechazo definitivo (4xx salvo 409 "en curso") estrena clave; un error de red o 5xx
        // la conserva para que reintentar no cobre dos veces.
        const { status } = resultado.problema
        if (status >= 400 && status < 500 && status !== 409) {
            claveIdempotencia = nuevaClaveIdempotencia()
        }
        if (status === 422) {
            formulario.value?.setErrors(erroresDeFormulario(resultado.problema))
        }
        return
    }

    facturasAntes.value = cuenta.value?.facturas_pendientes ?? []
    pago.value = resultado.data
    toast.add({ title: 'Pago registrado', description: `${formatearQuetzales(resultado.data.monto)} · ${cliente.value.nombre}`, icon: 'i-lucide-badge-check', color: 'success' })
    seguimiento.iniciar(cliente.value.id, servicios.value)
    void cargarCuenta()
}

function nuevoCobro() {
    pago.value = null
    seguimiento.reiniciar()
    void cargarServicios()
    limpiarFormulario()
}

function imprimir() {
    window.print()
}

/** Esc limpia (o empieza otro cobro tras el recibo), salvo que haya un menú o modal abierto. */
function alTeclear(evento: KeyboardEvent) {
    if (evento.key !== 'Escape' || evento.defaultPrevented) {
        return
    }
    if (document.querySelector('[role="dialog"], [role="listbox"], [data-state="open"][role="menu"]')) {
        return
    }
    if (pago.value) {
        nuevoCobro()
        return
    }
    if (clienteId.value) {
        clienteId.value = 0
    }
    else {
        limpiarFormulario()
    }
}

watch(clienteId, id => elegirCliente(id))
watch(() => estado.metodo, (metodo) => {
    if (metodo === 'caja') {
        cajaPorDefecto()
    }
})

onMounted(() => {
    window.addEventListener('keydown', alTeclear)
    void cargarCajas()
    if (clienteId.value) {
        void elegirCliente(clienteId.value)
    }
})
onBeforeUnmount(() => window.removeEventListener('keydown', alTeclear))
</script>

<template>
    <PanelPagina
        id="cobro"
        titulo="Cobrar"
        icono="i-lucide-hand-coins"
    >
        <div class="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,24rem)] lg:items-start">
            <div class="flex flex-col gap-4">
                <UFormField
                    label="Cliente"
                    description="Nombre, NIT, teléfono, usuario PPP o IP"
                    name="cliente"
                >
                    <ClienteSelector
                        v-model="clienteId"
                        :seleccionado="cliente"
                        placeholder="Buscar cliente…"
                        aria-label="Buscar cliente para cobrar"
                        @elegido="cliente = $event"
                    />
                </UFormField>

                <ProblemaAlerta
                    v-if="problemaCliente"
                    :problema="problemaCliente"
                    :reintentar="() => elegirCliente(clienteId)"
                />

                <UEmpty
                    v-if="!clienteId"
                    icon="i-lucide-hand-coins"
                    title="Busca al cliente que va a pagar"
                    description="Verás lo que debe, sus servicios y el formulario de cobro. Esc limpia la pantalla."
                    variant="naked"
                />

                <template v-else-if="cliente">
                    <div class="flex flex-wrap items-center justify-between gap-2">
                        <div class="flex flex-col">
                            <ULink
                                :to="`/clientes/${cliente.id}`"
                                class="text-lg font-semibold text-highlighted hover:text-primary"
                            >
                                {{ cliente.nombre }}
                            </ULink>
                            <span class="text-sm text-muted">
                                Cliente #{{ cliente.id }} · NIT {{ cliente.nit_cui ?? 'CF' }}<template v-if="cliente.telefono"> · {{ cliente.telefono }}</template>
                            </span>
                        </div>
                    </div>

                    <section
                        v-if="puede('clientes.estado_cuenta')"
                        class="flex flex-col gap-3"
                        aria-label="Pendiente de pago"
                    >
                        <ProblemaAlerta
                            v-if="problemaCuenta"
                            :problema="problemaCuenta"
                            :reintentar="cargarCuenta"
                            :reintentando="cargandoCuenta"
                        />
                        <div
                            v-else-if="!resumen"
                            class="grid gap-3 sm:grid-cols-2"
                        >
                            <USkeleton class="h-20" />
                            <USkeleton class="h-20" />
                        </div>
                        <template v-else>
                            <div class="grid gap-3 sm:grid-cols-2">
                                <UPageCard
                                    variant="subtle"
                                    :ui="{ container: 'gap-1 sm:p-4' }"
                                >
                                    <p class="text-xs font-medium text-muted">
                                        Vencido
                                    </p>
                                    <p
                                        class="text-2xl font-semibold tabular-nums"
                                        :class="resumen.vencido.gt(0) ? 'text-error' : 'text-highlighted'"
                                        data-prueba="vencido"
                                    >
                                        {{ formatearQuetzales(resumen.vencido) }}
                                    </p>
                                    <p class="text-xs text-muted">
                                        {{ resumen.vencidas }} {{ resumen.vencidas === 1 ? 'aviso vencido' : 'avisos vencidos' }}
                                    </p>
                                </UPageCard>
                                <UPageCard
                                    variant="subtle"
                                    :ui="{ container: 'gap-1 sm:p-4' }"
                                >
                                    <p class="text-xs font-medium text-muted">
                                        Pendiente total
                                    </p>
                                    <p
                                        class="text-2xl font-semibold tabular-nums text-highlighted"
                                        data-prueba="pendiente"
                                    >
                                        {{ formatearQuetzales(resumen.pendiente) }}
                                    </p>
                                    <p class="text-xs text-muted">
                                        {{ resumen.facturas.length }} {{ resumen.facturas.length === 1 ? 'aviso por pagar' : 'avisos por pagar' }}
                                    </p>
                                </UPageCard>
                            </div>

                            <ul
                                v-if="resumen.facturas.length"
                                class="flex flex-col divide-y divide-default rounded-md border border-default"
                            >
                                <li
                                    v-for="factura in resumen.facturas"
                                    :key="factura.id"
                                    class="flex items-center justify-between gap-3 px-3 py-2 text-sm"
                                >
                                    <div class="flex min-w-0 flex-col">
                                        <span class="text-highlighted">Aviso #{{ factura.id }} · {{ formatearFecha(factura.periodo).slice(3) }}</span>
                                        <span class="text-xs text-muted">Vence {{ formatearFecha(factura.vence_en) }}<template v-if="factura.servicio_id"> · servicio {{ factura.servicio_id }}</template></span>
                                    </div>
                                    <div class="flex shrink-0 items-center gap-2">
                                        <UBadge
                                            :label="ESTADOS_FACTURA[factura.estado].etiqueta"
                                            :color="ESTADOS_FACTURA[factura.estado].color"
                                            variant="subtle"
                                            size="sm"
                                        />
                                        <span class="font-medium tabular-nums text-highlighted">{{ formatearQuetzales(saldoFactura(factura)) }}</span>
                                    </div>
                                </li>
                            </ul>
                            <p
                                v-else
                                class="flex items-center gap-2 text-sm text-success"
                            >
                                <UIcon
                                    name="i-lucide-badge-check"
                                    class="size-4"
                                />
                                No tiene avisos pendientes.
                            </p>
                        </template>
                    </section>

                    <section
                        v-if="puede('servicios.ver')"
                        class="flex flex-col gap-2"
                        aria-label="Servicios del cliente"
                    >
                        <div class="flex items-center justify-between gap-2">
                            <h3 class="text-sm font-semibold text-highlighted">
                                Servicios
                            </h3>
                            <span
                                v-if="seguimiento.siguiendo.value"
                                class="flex items-center gap-1.5 text-xs text-muted"
                            >
                                <UIcon
                                    name="i-lucide-loader-circle"
                                    class="size-3.5 animate-spin"
                                />
                                Esperando la reactivación…
                            </span>
                        </div>
                        <ProblemaAlerta
                            v-if="problemaServicios"
                            :problema="problemaServicios"
                            :reintentar="cargarServicios"
                            :reintentando="cargandoServicios"
                        />
                        <div
                            v-else-if="cargandoServicios && !serviciosVista.length"
                            class="flex flex-col gap-2"
                        >
                            <USkeleton class="h-12" />
                        </div>
                        <p
                            v-else-if="!serviciosVista.length"
                            class="text-sm text-muted"
                        >
                            Sin servicios.
                        </p>
                        <ul
                            v-else
                            class="flex flex-col divide-y divide-default rounded-md border border-default"
                        >
                            <li
                                v-for="servicio in serviciosVista"
                                :key="servicio.id"
                                class="flex flex-wrap items-center justify-between gap-2 px-3 py-2"
                                :data-servicio="servicio.id"
                            >
                                <ULink
                                    :to="`/servicios/${servicio.id}`"
                                    class="font-mono text-sm text-highlighted hover:text-primary"
                                >
                                    {{ servicio.user_ppp }}
                                </ULink>
                                <div class="flex flex-wrap items-center gap-1">
                                    <UBadge
                                        v-if="reactivados.has(servicio.id)"
                                        label="Servicio reactivado"
                                        icon="i-lucide-party-popper"
                                        color="success"
                                        variant="solid"
                                        size="sm"
                                    />
                                    <EstadoServicioBadge
                                        :estado="servicio.estado"
                                        size="sm"
                                    />
                                </div>
                            </li>
                        </ul>
                        <UAlert
                            v-if="seguimiento.agotado.value"
                            color="warning"
                            variant="subtle"
                            icon="i-lucide-clock-alert"
                            title="El servicio no se ha reactivado"
                            description="Pasaron 30 segundos. Puede que aún deba avisos vencidos o que la reactivación siga en cola; revisa la ficha del servicio."
                        />
                        <ProblemaAlerta
                            v-else-if="seguimiento.problema.value"
                            :problema="seguimiento.problema.value"
                        />
                    </section>
                </template>
            </div>

            <div
                v-if="cliente && pago"
                class="flex flex-col gap-3"
            >
                <ReciboPago
                    :pago="pago"
                    :cliente="cliente"
                    :facturas="facturasAntes"
                    :caja="nombreCaja"
                    :cajero="usuario?.nombre ?? null"
                />
                <div class="flex flex-wrap gap-2">
                    <UButton
                        label="Imprimir"
                        icon="i-lucide-printer"
                        @click="imprimir"
                    />
                    <UButton
                        label="Nuevo cobro"
                        icon="i-lucide-rotate-ccw"
                        color="neutral"
                        variant="outline"
                        @click="nuevoCobro"
                    />
                </div>
            </div>

            <UPageCard
                v-else-if="cliente"
                title="Registrar pago"
                icon="i-lucide-banknote"
                variant="outline"
            >
                <UForm
                    ref="formulario"
                    :schema="esquemaCobro"
                    :state="estado"
                    :validate-on="['input']"
                    class="flex flex-col gap-4"
                    @submit="registrar"
                >
                    <UFormField
                        label="Monto"
                        name="monto"
                        required
                        :help="resumen ? `Vencido ${formatearQuetzales(resumen.vencido)} · pendiente ${formatearQuetzales(resumen.pendiente)}` : undefined"
                    >
                        <UInput
                            v-model="estado.monto"
                            inputmode="decimal"
                            autocomplete="off"
                            placeholder="0.00"
                            size="xl"
                            class="w-full"
                            :ui="{ base: 'text-lg tabular-nums' }"
                        >
                            <template #leading>
                                <span class="text-sm text-muted">Q</span>
                            </template>
                        </UInput>
                    </UFormField>

                    <p
                        v-if="restante && restante.lt(0)"
                        class="-mt-2 text-xs text-info"
                    >
                        Paga {{ formatearQuetzales(restante.abs()) }} de más: queda como saldo a favor.
                    </p>
                    <p
                        v-else-if="restante && restante.gt(0) && resumen && !resumen.pendiente.isZero()"
                        class="-mt-2 text-xs text-muted"
                    >
                        Quedará debiendo {{ formatearQuetzales(restante) }}.
                    </p>

                    <UFormField
                        label="Método"
                        name="metodo"
                        required
                    >
                        <USelect
                            v-model="estado.metodo"
                            :items="itemsMetodo"
                            class="w-full"
                        />
                    </UFormField>

                    <UFormField
                        v-if="estado.metodo === 'caja'"
                        label="Caja"
                        name="caja_id"
                        required
                    >
                        <ProblemaAlerta
                            v-if="problemaCajas"
                            :problema="problemaCajas"
                            :reintentar="cargarCajas"
                        />
                        <UAlert
                            v-else-if="!cajasAbiertas.length"
                            color="warning"
                            variant="subtle"
                            icon="i-lucide-lock"
                            title="No hay turnos de caja abiertos"
                            description="Abre tu turno en Caja para cobrar en efectivo, o usa otro método."
                            :actions="puede('cajas.ver') ? [{ label: 'Ir a Caja', to: '/caja', color: 'warning', variant: 'outline' }] : undefined"
                        />
                        <USelect
                            v-else
                            v-model="estado.caja_id"
                            :items="itemsCaja"
                            placeholder="Elige la caja"
                            class="w-full"
                        />
                    </UFormField>

                    <UFormField
                        label="Referencia"
                        name="referencia"
                        :required="estado.metodo !== 'caja'"
                        :hint="estado.metodo === 'caja' ? 'Opcional' : undefined"
                    >
                        <UInput
                            v-model="estado.referencia"
                            autocomplete="off"
                            placeholder="No. de boleta, transferencia o autorización"
                            class="w-full"
                        />
                    </UFormField>

                    <UFormField
                        label="Nota"
                        name="nota"
                        hint="Opcional"
                    >
                        <UInput
                            v-model="estado.nota"
                            autocomplete="off"
                            class="w-full"
                        />
                    </UFormField>

                    <ProblemaAlerta
                        v-if="problemaPago && problemaPago.status !== 422"
                        :problema="problemaPago"
                    />
                    <UAlert
                        v-else-if="problemaPago"
                        color="error"
                        variant="subtle"
                        icon="i-lucide-circle-alert"
                        :title="problemaPago.title"
                        :description="problemaPago.detail ?? 'Corrige los campos marcados.'"
                    />

                    <div class="flex flex-wrap items-center gap-2">
                        <UButton
                            type="submit"
                            label="Registrar pago"
                            icon="i-lucide-check"
                            size="lg"
                            :loading="enviando"
                            class="grow justify-center sm:grow-0"
                        />
                        <UButton
                            label="Limpiar"
                            color="neutral"
                            variant="ghost"
                            :disabled="enviando"
                            @click="limpiarFormulario"
                        />
                        <span class="hidden text-xs text-muted sm:inline">
                            <UKbd value="Enter" /> registra · <UKbd value="Esc" /> limpia
                        </span>
                    </div>
                </UForm>
            </UPageCard>
        </div>
    </PanelPagina>
</template>
