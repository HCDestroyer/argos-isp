<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { SelectItem, SelectMenuItem, TableColumn, TabsItem } from '@nuxt/ui'
import Decimal from 'decimal.js'

definePageMeta({ permiso: 'libro.ver' })

useHead({ title: 'Libro · ArgosIsp' })

const route = useRoute()
const router = useRouter()
const nombres = useNombresClientes()
const { puede } = usePermisos()

const TODOS = 'todos'
const PERSONALIZADO = 'personalizado'
const FECHA = /^\d{4}-\d{2}-\d{2}$/

function textoQuery(valor: unknown): string {
    return typeof valor === 'string' ? valor : ''
}

function idQuery(valor: unknown): number {
    const id = Number(textoQuery(valor))
    return Number.isInteger(id) && id > 0 ? id : 0
}

const pestanas: TabsItem[] = [
    { label: 'Diario', value: 'diario', icon: 'i-lucide-book-open' },
    { label: 'Mayor', value: 'mayor', icon: 'i-lucide-library' },
    { label: 'Balance', value: 'balance', icon: 'i-lucide-scale' },
    { label: 'Resultados', value: 'resultados', icon: 'i-lucide-trending-up' },
    { label: 'Cierres', value: 'cierres', icon: 'i-lucide-lock' },
    { label: 'Integridad', value: 'integridad', icon: 'i-lucide-shield-check' },
    { label: 'Diarios', value: 'diarios', icon: 'i-lucide-list-ordered' },
]

/** Pestañas con su propio filtro (balance, resultados y cierres no usan los del diario y el mayor). */
const PROPIAS = ['balance', 'resultados', 'cierres', 'integridad', 'diarios']

const pestana = ref(['mayor', ...PROPIAS].includes(textoQuery(route.query.tab)) ? textoQuery(route.query.tab) : 'diario')
const desde = ref(FECHA.test(textoQuery(route.query.desde)) ? textoQuery(route.query.desde) : '')
const hasta = ref(FECHA.test(textoQuery(route.query.hasta)) ? textoQuery(route.query.hasta) : '')
const origen = ref<OrigenAsiento | typeof TODOS>(textoQuery(route.query.origen) in ORIGENES_ASIENTO ? (textoQuery(route.query.origen) as OrigenAsiento) : TODOS)
const cuentaId = ref<number | undefined>(idQuery(route.query.cuenta) || undefined)
const clienteId = ref(idQuery(route.query.cliente))
const clienteElegido = shallowRef<Cliente | null>(null)

const cuentas = shallowRef<Cuenta[]>([])
const problemaCuentas = ref<Problem | null>(null)

/** Mes rápido: pone `desde` y `hasta` en el primer y último día del mes. */
const periodo = computed<string>({
    get() {
        if (!desde.value && !hasta.value) {
            return TODOS
        }
        return desde.value.endsWith('-01') && hasta.value === finDePeriodo(desde.value) ? desde.value : PERSONALIZADO
    },
    set(valor) {
        if (valor === TODOS) {
            desde.value = ''
            hasta.value = ''
        }
        else if (valor !== PERSONALIZADO) {
            desde.value = valor
            hasta.value = finDePeriodo(valor)
        }
    },
})

const itemsPeriodo = computed<SelectItem[]>(() => [
    { label: 'Todo el libro', value: TODOS },
    ...periodosRecientes(hoyGuatemala(), 12).map(p => ({ label: etiquetaPeriodo(p), value: p })),
    ...(periodo.value === PERSONALIZADO ? [{ label: 'Fechas personalizadas', value: PERSONALIZADO }] : []),
])

const itemsOrigen: SelectItem[] = [
    { label: 'Todos los orígenes', value: TODOS },
    ...Object.entries(ORIGENES_ASIENTO).map(([valor, datos]) => ({ label: datos.etiqueta, value: valor, icon: datos.icono })),
]

/** Solo cuentas imputables: las de agrupación no reciben movimientos. */
const itemsCuenta = computed<SelectMenuItem[]>(() => cuentas.value
    .filter(c => c.imputable)
    .map(c => ({ label: `${c.codigo} · ${c.nombre}`, value: c.id, description: TIPOS_CUENTA[c.tipo] })))

const cuenta = computed(() => cuentas.value.find(c => c.id === cuentaId.value) ?? null)

function rango(): { desde?: string, hasta?: string } {
    const resultado: { desde?: string, hasta?: string } = {}
    if (desde.value) {
        resultado.desde = desde.value
    }
    if (hasta.value) {
        resultado.hasta = hasta.value
    }
    return resultado
}

function filtrosDiario(): FiltrosDiario {
    const resultado: FiltrosDiario = { ...rango(), limit: 25 }
    if (origen.value !== TODOS) {
        resultado.origen_tipo = origen.value
    }
    return resultado
}

const diario = usePaginacionCursor(cursor => useLibro().diario(filtrosDiario(), cursor))
const totalesDiario = computed(() => totalesAsientos(diario.filas.value))

/*
 * El mayor no es una lista simple: trae la cuenta, saldo inicial y final además de la página,
 * así que se pagina aquí guardando esos datos de la última respuesta.
 */
const mayor = shallowRef<Mayor | null>(null)
const lineasMayor = usePaginacionCursor(async (cursor) => {
    if (!cuentaId.value) {
        mayor.value = null
        return { ok: true as const, data: { data: [], nextCursor: null } }
    }
    const filtros: FiltrosMayor = { cuenta_id: cuentaId.value, ...rango() }
    if (clienteId.value && cuenta.value?.auxiliar_cliente) {
        filtros.cliente_id = clienteId.value
    }
    const resultado = await useLibro().mayor(filtros, cursor)
    mayor.value = resultado.ok ? resultado.data : null
    return resultado.ok ? { ok: true as const, data: { data: resultado.data.data, nextCursor: resultado.data.nextCursor } } : resultado
})
const totalesMayor = computed(() => totalesPartida(lineasMayor.filas.value))

watch(lineasMayor.filas, filas => void nombres.cargar(filas.map(l => l.cliente_id).filter((id): id is number => id !== null)))

const columnasMayor: TableColumn<LineaMayor>[] = [
    { accessorKey: 'fecha', header: 'Fecha', meta: SOLO_ANCHO },
    { accessorKey: 'descripcion', header: 'Concepto', meta: { class: { td: 'whitespace-normal' } } },
    { accessorKey: 'debe', header: 'Debe', meta: { class: { th: 'hidden text-right sm:table-cell', td: 'hidden text-right sm:table-cell' } } },
    { accessorKey: 'haber', header: 'Haber', meta: { class: { th: 'hidden text-right sm:table-cell', td: 'hidden text-right sm:table-cell' } } },
    { accessorKey: 'saldo', header: 'Saldo', meta: { class: { th: 'text-right', td: 'text-right' } } },
]

const hayFiltros = computed(() => desde.value !== '' || hasta.value !== '' || origen.value !== TODOS || clienteId.value !== 0)

async function aplicarFiltros() {
    const query: Record<string, string> = {}
    if (pestana.value !== 'diario') {
        query.tab = pestana.value
    }
    if (PROPIAS.includes(pestana.value)) {
        await router.replace({ query })
        return
    }
    if (desde.value) {
        query.desde = desde.value
    }
    if (hasta.value) {
        query.hasta = hasta.value
    }
    if (origen.value !== TODOS) {
        query.origen = origen.value
    }
    if (cuentaId.value) {
        query.cuenta = String(cuentaId.value)
    }
    if (clienteId.value) {
        query.cliente = String(clienteId.value)
    }
    await router.replace({ query })
    await (pestana.value === 'mayor' ? lineasMayor.recargar() : diario.recargar())
}

function limpiarFiltros() {
    desde.value = ''
    hasta.value = ''
    origen.value = TODOS
    clienteId.value = 0
    clienteElegido.value = null
}

function alElegirCliente(elegido: Cliente) {
    clienteElegido.value = elegido
    nombres.recordar(elegido.id, elegido.nombre)
}

async function cargarCuentas() {
    const resultado = await useLibro().cuentas()
    cuentas.value = resultado.ok ? resultado.data : []
    problemaCuentas.value = resultado.ok ? null : resultado.problema
}

watch([pestana, desde, hasta, origen, cuentaId, clienteId], aplicarFiltros)
// Un enlace dentro del libro (el cierre lleva a «Integridad») cambia la pestaña sin recargar.
watch(() => route.query.tab, (tab) => {
    const valor = textoQuery(tab)
    if (['mayor', ...PROPIAS].includes(valor) && valor !== pestana.value) {
        pestana.value = valor
    }
})

onMounted(async () => {
    if (pestana.value === 'mayor') {
        // El mayor necesita saber si la cuenta lleva auxiliar por cliente antes de pedirlo.
        await cargarCuentas()
        void lineasMayor.recargar()
    }
    else {
        void cargarCuentas()
        void diario.recargar()
    }
    // Sin `clientes.ver` el filtro por cliente sigue por id, sin pedir su nombre (revisión de ACL).
    if (clienteId.value && puede('clientes.ver')) {
        const resultado = await useClientes().ver(clienteId.value)
        if (resultado.ok) {
            alElegirCliente(resultado.data)
        }
    }
})
</script>

<template>
    <PanelPagina
        id="libro"
        titulo="Libro"
        icono="i-lucide-book-open"
    >
        <div class="flex flex-col gap-4">
            <UTabs
                v-model="pestana"
                :items="pestanas"
                variant="link"
                :content="false"
                class="w-full overflow-x-auto"
                :ui="{ list: 'w-max sm:w-full', label: 'whitespace-nowrap' }"
            />

            <LibroCierres v-if="pestana === 'cierres'" />
            <LibroIntegridad v-else-if="pestana === 'integridad'" />
            <LibroDiarios v-else-if="pestana === 'diarios'" />
            <LibroEstadoFinanciero
                v-else-if="pestana === 'balance' || pestana === 'resultados'"
                :key="pestana"
                :tipo="pestana"
            />

            <div
                v-if="!PROPIAS.includes(pestana)"
                class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
            >
                <USelectMenu
                    v-if="pestana === 'mayor'"
                    v-model="cuentaId"
                    :items="itemsCuenta"
                    value-key="value"
                    icon="i-lucide-landmark"
                    placeholder="Elige la cuenta"
                    :search-input="{ placeholder: 'Código o nombre…' }"
                    aria-label="Cuenta"
                    class="w-full sm:col-span-2 lg:col-span-1"
                />
                <USelect
                    v-model="periodo"
                    :items="itemsPeriodo"
                    icon="i-lucide-calendar"
                    aria-label="Periodo"
                    class="w-full"
                />
                <UInput
                    v-model="desde"
                    type="date"
                    :max="hasta || undefined"
                    aria-label="Desde"
                    class="w-full"
                />
                <UInput
                    v-model="hasta"
                    type="date"
                    :min="desde || undefined"
                    aria-label="Hasta"
                    class="w-full"
                />
                <USelect
                    v-if="pestana === 'diario'"
                    v-model="origen"
                    :items="itemsOrigen"
                    icon="i-lucide-git-branch"
                    aria-label="Origen"
                    class="w-full"
                />
            </div>

            <div
                v-if="!PROPIAS.includes(pestana)"
                class="flex flex-col gap-3 sm:flex-row sm:items-center"
            >
                <ClienteSelector
                    v-if="pestana === 'mayor' && cuenta?.auxiliar_cliente"
                    v-model="clienteId"
                    :seleccionado="clienteElegido"
                    placeholder="Auxiliar de un cliente (opcional)"
                    aria-label="Auxiliar de un cliente"
                    class="w-full sm:max-w-md"
                    @elegido="alElegirCliente"
                />
                <p class="text-xs text-muted">
                    Fechas contables (día de Guatemala).
                </p>
                <UButton
                    v-if="hayFiltros"
                    label="Limpiar filtros"
                    icon="i-lucide-filter-x"
                    color="neutral"
                    variant="ghost"
                    class="self-start sm:ml-auto sm:self-auto"
                    @click="limpiarFiltros"
                />
            </div>

            <template v-if="pestana === 'diario'">
                <ProblemaAlerta
                    v-if="diario.problema.value"
                    :problema="diario.problema.value"
                    :reintentar="diario.recargar"
                    :reintentando="diario.cargando.value"
                />
                <template v-else>
                    <div
                        v-if="diario.filas.value.length"
                        class="flex flex-wrap items-center justify-end gap-x-4 gap-y-1 rounded-lg bg-elevated px-3 py-2 text-sm"
                        data-prueba="totales-diario"
                    >
                        <span class="text-muted">Totales de la página</span>
                        <span class="tabular-nums">Debe <strong data-prueba="diario-debe">{{ formatearQuetzales(totalesDiario.debe) }}</strong></span>
                        <span class="tabular-nums">Haber <strong data-prueba="diario-haber">{{ formatearQuetzales(totalesDiario.haber) }}</strong></span>
                        <UBadge
                            :label="cuadra(totalesDiario) ? 'Cuadra' : 'No cuadra'"
                            :icon="cuadra(totalesDiario) ? 'i-lucide-circle-check' : 'i-lucide-octagon-alert'"
                            :color="cuadra(totalesDiario) ? 'success' : 'error'"
                            variant="subtle"
                            size="sm"
                        />
                    </div>

                    <div
                        v-if="diario.cargando.value && !diario.filas.value.length"
                        class="flex flex-col gap-3"
                    >
                        <USkeleton class="h-32 w-full" />
                        <USkeleton class="h-32 w-full" />
                    </div>
                    <UEmpty
                        v-else-if="!diario.filas.value.length"
                        icon="i-lucide-book-x"
                        :title="hayFiltros ? 'Sin asientos para estos filtros' : 'El libro diario está vacío'"
                        variant="naked"
                    />
                    <div
                        v-else
                        class="grid gap-3 lg:grid-cols-2"
                    >
                        <AsientoContable
                            v-for="asiento in diario.filas.value"
                            :key="asiento.id"
                            :asiento="asiento"
                            con-reverso
                            @revertido="diario.recargar"
                        />
                    </div>

                    <PaginacionCursor
                        :pagina="diario.pagina.value"
                        :hay-anterior="diario.hayAnterior.value"
                        :hay-siguiente="diario.haySiguiente.value"
                        :cargando="diario.cargando.value"
                        :filas="diario.filas.value.length"
                        @anterior="diario.anterior"
                        @siguiente="diario.siguiente"
                    />
                </template>
            </template>

            <template v-else-if="pestana === 'mayor'">
                <ProblemaAlerta
                    v-if="problemaCuentas"
                    :problema="problemaCuentas"
                    :reintentar="cargarCuentas"
                />
                <UEmpty
                    v-else-if="!cuentaId"
                    icon="i-lucide-landmark"
                    title="Elige una cuenta"
                    description="El mayor muestra los movimientos de una cuenta con su saldo acumulado."
                    variant="naked"
                />
                <ProblemaAlerta
                    v-else-if="lineasMayor.problema.value"
                    :problema="lineasMayor.problema.value"
                    :reintentar="lineasMayor.recargar"
                    :reintentando="lineasMayor.cargando.value"
                />
                <template v-else>
                    <dl
                        v-if="mayor"
                        class="grid grid-cols-2 gap-3 rounded-lg bg-elevated p-3 sm:grid-cols-4"
                        data-prueba="resumen-mayor"
                    >
                        <DatoFicha
                            etiqueta="Cuenta"
                            :valor="`${mayor.cuenta.codigo} · ${mayor.cuenta.nombre}`"
                            class="col-span-2 sm:col-span-1"
                        />
                        <DatoFicha
                            etiqueta="Saldo inicial"
                            :valor="formatearQuetzales(mayor.saldo_inicial)"
                        />
                        <DatoFicha
                            etiqueta="Debe / Haber (página)"
                            :valor="`${formatearQuetzales(totalesMayor.debe)} / ${formatearQuetzales(totalesMayor.haber)}`"
                        />
                        <DatoFicha
                            etiqueta="Saldo final"
                            :valor="formatearQuetzales(mayor.saldo_final)"
                        />
                    </dl>

                    <UTable
                        :data="lineasMayor.filas.value"
                        :columns="columnasMayor"
                        :loading="lineasMayor.cargando.value"
                        sticky
                        :ui="{ td: 'py-2.5' }"
                    >
                        <template #fecha-cell="{ row }">
                            <span class="whitespace-nowrap text-sm">{{ formatearFecha(row.original.fecha) }}</span>
                        </template>
                        <template #descripcion-cell="{ row }">
                            <div class="flex flex-col">
                                <span class="text-sm">{{ row.original.descripcion }}</span>
                                <span class="text-xs text-muted">
                                    Asiento #{{ row.original.asiento_id }}<template v-if="row.original.cliente_id"> · {{ nombres.nombre(row.original.cliente_id) }}</template>
                                    <span class="sm:hidden"> · {{ formatearFecha(row.original.fecha) }}</span>
                                </span>
                                <span class="text-xs tabular-nums text-muted sm:hidden">
                                    {{ new Decimal(row.original.debe).isZero() ? `Haber ${formatearQuetzales(row.original.haber)}` : `Debe ${formatearQuetzales(row.original.debe)}` }}
                                </span>
                            </div>
                        </template>
                        <template #debe-cell="{ row }">
                            <span class="tabular-nums">{{ montoLado(row.original.debe) }}</span>
                        </template>
                        <template #haber-cell="{ row }">
                            <span class="tabular-nums">{{ montoLado(row.original.haber) }}</span>
                        </template>
                        <template #saldo-cell="{ row }">
                            <span class="tabular-nums font-medium">{{ formatearQuetzales(row.original.saldo) }}</span>
                        </template>
                        <template #empty>
                            <UEmpty
                                icon="i-lucide-list"
                                title="Sin movimientos en este rango"
                                variant="naked"
                            />
                        </template>
                    </UTable>

                    <PaginacionCursor
                        :pagina="lineasMayor.pagina.value"
                        :hay-anterior="lineasMayor.hayAnterior.value"
                        :hay-siguiente="lineasMayor.haySiguiente.value"
                        :cargando="lineasMayor.cargando.value"
                        :filas="lineasMayor.filas.value.length"
                        @anterior="lineasMayor.anterior"
                        @siguiente="lineasMayor.siguiente"
                    />
                </template>
            </template>

            <p
                v-if="puede('egresos.ver') && !PROPIAS.includes(pestana)"
                class="text-xs text-muted"
            >
                Los gastos se registran y anulan en
                <ULink
                    to="/egresos"
                    class="underline"
                >Egresos</ULink>; cada uno deja su asiento con origen "egreso".
            </p>
        </div>
    </PanelPagina>
</template>
