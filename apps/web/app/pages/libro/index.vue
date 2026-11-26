<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { SelectItem, SelectMenuItem, TableColumn } from '@nuxt/ui'
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

/**
 * Libro contable (tablero ContaLibro): Diario, Mayor, Auxiliar de cliente y Plan de cuentas en una
 * sola tarjeta. Lo que antes eran pestañas del libro vive ahora en su pantalla: el balance y el
 * estado de resultados en Reportes, el cierre y el ejercicio en «Periodos y cierres» y la integridad
 * en su página; los enlaces viejos (`?tab=`) llevan allá.
 */
const pestanas: PestanaConta[] = [
    { label: 'Diario', value: 'diario', icon: 'i-lucide-list' },
    { label: 'Mayor', value: 'mayor', icon: 'i-lucide-book' },
    { label: 'Auxiliar de cliente', value: 'auxiliar', icon: 'i-lucide-user' },
    { label: 'Plan de cuentas', value: 'cuentas', icon: 'i-lucide-network' },
]

const REDIRECCIONES: Record<string, string> = {
    balance: '/reportes/balance',
    resultados: '/reportes/resultados',
    cierres: '/libro/cierres',
    ejercicios: '/libro/cierres?tab=ejercicio',
    integridad: '/libro/integridad',
}

const tabInicial = textoQuery(route.query.tab)
if (REDIRECCIONES[tabInicial]) {
    const destino = REDIRECCIONES[tabInicial]!
    const mes = textoQuery(route.query.mes)
    await navigateTo(mes && destino.startsWith('/libro/cierres') ? `${destino}${destino.includes('?') ? '&' : '?'}mes=${mes}` : destino, { replace: true })
}

/** Pestañas con su propio filtro (el plan de cuentas no usa los del diario y el mayor). */
const PROPIAS = ['cuentas']

const pestana = ref(['mayor', 'auxiliar', ...PROPIAS].includes(tabInicial) ? tabInicial : tabInicial === 'diarios' ? 'cuentas' : 'diario')
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
/** Cuenta de clientes (1.1.03, la que lleva auxiliar por cliente) para la pestaña Auxiliar. */
const cuentaClientes = computed(() => cuentas.value.find(c => c.auxiliar_cliente) ?? null)
const cuentaDelMayor = computed(() => (pestana.value === 'auxiliar' ? cuentaClientes.value?.id : cuentaId.value))

const lineasMayor = usePaginacionCursor(async (cursor) => {
    if (pestana.value === 'auxiliar' && !clienteId.value) {
        mayor.value = null
        return { ok: true as const, data: { data: [], nextCursor: null } }
    }
    if (!cuentaDelMayor.value) {
        mayor.value = null
        return { ok: true as const, data: { data: [], nextCursor: null } }
    }
    const filtros: FiltrosMayor = { cuenta_id: cuentaDelMayor.value, ...rango() }
    if (clienteId.value && (pestana.value === 'auxiliar' || cuenta.value?.auxiliar_cliente)) {
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
    await (pestana.value === 'diario' ? diario.recargar() : lineasMayor.recargar())
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
    if (['mayor', 'auxiliar', ...PROPIAS].includes(valor) && valor !== pestana.value) {
        pestana.value = valor
    }
})

/* Detalle del asiento en el panel lateral (tablero ContaLibro). */
const elegido = shallowRef<Asiento | null>(null)
watch(() => diario.filas.value, (filas) => {
    if (elegido.value && !filas.some(a => a.id === elegido.value?.id)) {
        elegido.value = null
    }
})

function elegirAsiento(_evento: Event, fila: { original: Asiento }) {
    elegido.value = fila.original
}

function alRevertir() {
    elegido.value = null
    void diario.recargar()
}

const columnasDiario: TableColumn<Asiento>[] = [
    { accessorKey: 'fecha', header: 'Fecha', meta: SOLO_ANCHO },
    { id: 'numero', header: 'Número', meta: SOLO_ESCRITORIO },
    { accessorKey: 'descripcion', header: 'Descripción', meta: { class: { td: 'max-w-80' } } },
    { id: 'origen', header: 'Documento de origen', meta: SOLO_ANCHO },
    { id: 'monto', header: 'Debe = Haber', meta: { class: { th: 'text-right', td: 'text-right' } } },
]

/* Integridad: la cadena verificada en el pie del diario. */
const integridad = shallowRef<IntegridadLibro[] | null>(null)
async function cargarIntegridad() {
    const r = await useLibro().integridad()
    integridad.value = r.ok ? r.data : null
}
const cadenaRota = computed(() => integridad.value?.some(i => !i.verificado) ?? false)
const ultimoSello = computed(() => (integridad.value?.length ? Math.max(...integridad.value.map(i => i.ultimo_sello ?? 0)) : null))

/* Plan de cuentas. */
const busquedaCuenta = ref('')
const cuentasVisibles = computed(() => {
    const q = busquedaCuenta.value.trim().toLowerCase()
    return q ? cuentas.value.filter(c => `${c.codigo} ${c.nombre}`.toLowerCase().includes(q)) : cuentas.value
})
const columnasCuentas: TableColumn<Cuenta>[] = [
    { accessorKey: 'codigo', header: 'Código' },
    { accessorKey: 'nombre', header: 'Cuenta' },
    { accessorKey: 'tipo', header: 'Tipo', meta: SOLO_ANCHO },
    { id: 'uso', header: 'Uso', meta: SOLO_ESCRITORIO },
]

const { eleccion, empresas } = useEmpresaActiva()
const descripcion = computed(() => {
    const quien = eleccion.value === 'todas' ? 'Todas las empresas' : empresas.value.find(e => e.id === eleccion.value)?.nombre_comercial
    return [quien, 'un asiento nunca se edita ni se borra'].filter(Boolean).join(' · ')
})

onMounted(async () => {
    if (pestana.value === 'mayor') {
        // El mayor necesita saber si la cuenta lleva auxiliar por cliente antes de pedirlo.
        await cargarCuentas()
        void lineasMayor.recargar()
    }
    else if (pestana.value === 'auxiliar') {
        await cargarCuentas()
        void lineasMayor.recargar()
    }
    else {
        void cargarCuentas()
        void diario.recargar()
    }
    void cargarIntegridad()
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
        titulo="Libro contable"
        icono="i-lucide-book-open"
        :descripcion="descripcion"
    >
        <template #acciones>
            <ContaSelectorEmpresa />
            <USelect
                v-if="!PROPIAS.includes(pestana)"
                v-model="periodo"
                :items="itemsPeriodo"
                icon="i-lucide-calendar"
                aria-label="Periodo"
                variant="ghost"
                class="boton-flotante w-48 rounded-full"
                data-prueba="periodo-libro"
            />
        </template>

        <template #accion-principal>
            <UButton
                v-if="puede('libro.registrar_asiento')"
                title="Llega con la API del asiento manual con aprobación"
                label="Asiento de ajuste"
                icon="i-lucide-plus"
                size="lg"
                class="glow-brand rounded-full px-5"
                disabled
                data-prueba="asiento-ajuste"
            />
        </template>

        <ContaCuerpo>
            <ContaIsla
                llenar
                ancho-lateral="lg:w-[26rem]"
            >
                <template #cabecera>
                    <ContaPestanas
                        v-model="pestana"
                        :items="pestanas"
                        etiqueta="Vistas del libro"
                    />
                </template>
                <template #herramientas>
                    <template v-if="pestana === 'diario'">
                        <USelect
                            v-model="origen"
                            :items="itemsOrigen"
                            icon="i-lucide-filter"
                            aria-label="Origen"
                            class="w-52"
                            :ui="{ base: 'rounded-full' }"
                            data-prueba="origen-libro"
                        />
                    </template>
                    <USelectMenu
                        v-else-if="pestana === 'mayor'"
                        v-model="cuentaId"
                        :items="itemsCuenta"
                        value-key="value"
                        icon="i-lucide-book"
                        placeholder="Elige la cuenta"
                        :search-input="{ placeholder: 'Código o nombre…' }"
                        aria-label="Cuenta"
                        class="w-full sm:w-80"
                        :ui="{ base: 'rounded-full' }"
                    />
                    <ClienteSelector
                        v-else-if="pestana === 'auxiliar'"
                        v-model="clienteId"
                        :seleccionado="clienteElegido"
                        placeholder="Busca el cliente"
                        aria-label="Cliente del auxiliar"
                        class="w-full sm:w-80"
                        @elegido="alElegirCliente"
                    />
                    <UInput
                        v-else
                        v-model="busquedaCuenta"
                        icon="i-lucide-search"
                        placeholder="Código o nombre de la cuenta…"
                        aria-label="Buscar cuenta"
                        class="w-full sm:w-72"
                        :ui="{ base: 'rounded-full' }"
                    />
                    <UPopover v-if="!PROPIAS.includes(pestana)">
                        <UButton
                            :label="desde || hasta ? 'Fechas' : 'Fechas'"
                            icon="i-lucide-calendar-range"
                            color="neutral"
                            :variant="desde || hasta ? 'subtle' : 'outline'"
                            class="rounded-full"
                        />
                        <template #content>
                            <div class="flex flex-col gap-2 p-3">
                                <UFormField label="Desde">
                                    <CampoFecha
                                        v-model="desde"
                                        :max="hasta || undefined"
                                        class="w-full"
                                    />
                                </UFormField>
                                <UFormField label="Hasta">
                                    <CampoFecha
                                        v-model="hasta"
                                        :min="desde || undefined"
                                        class="w-full"
                                    />
                                </UFormField>
                                <p class="text-xs text-muted">
                                    Fechas contables (día de Guatemala).
                                </p>
                            </div>
                        </template>
                    </UPopover>
                    <UButton
                        v-if="hayFiltros"
                        label="Limpiar"
                        icon="i-lucide-rotate-ccw"
                        color="primary"
                        variant="ghost"
                        size="sm"
                        @click="limpiarFiltros"
                    />
                </template>

                <!-- Diario: una fila por asiento; el detalle a la derecha. -->
                <template v-if="pestana === 'diario'">
                    <div
                        v-if="diario.problema.value"
                        class="p-4"
                    >
                        <ProblemaAlerta
                            :problema="diario.problema.value"
                            :reintentar="diario.recargar"
                            :reintentando="diario.cargando.value"
                        />
                    </div>
                    <template v-else>
                        <UTable
                            :data="diario.filas.value"
                            :columns="columnasDiario"
                            :loading="diario.cargando.value"
                            sticky
                            :ui="{ td: 'py-3', tr: 'cursor-pointer' }"
                            data-prueba="tabla-diario"
                            @select="elegirAsiento"
                        >
                            <template #fecha-cell="{ row }">
                                <span class="whitespace-nowrap text-sm text-muted">{{ formatearFecha(row.original.fecha) }}</span>
                            </template>
                            <template #numero-cell="{ row }">
                                <span class="font-mono text-[0.8125rem] whitespace-nowrap">{{ numeroAsientoConta(row.original) }}</span>
                            </template>
                            <template #descripcion-cell="{ row }">
                                <div
                                    class="flex min-w-0 items-center gap-2.5"
                                    :data-asiento="row.original.id"
                                >
                                    <span
                                        class="pastilla-icono pastilla-tono size-7 shrink-0 rounded-lg"
                                        :class="row.original.reversa_de ? 'tono-aviso' : 'tono-marca'"
                                    >
                                        <UIcon
                                            :name="row.original.reversa_de ? 'i-lucide-undo-2' : origenAsiento(row.original.origen_tipo).icono"
                                            class="size-3.5"
                                        />
                                    </span>
                                    <span class="flex min-w-0 flex-col">
                                        <span class="truncate text-sm">{{ row.original.descripcion }}</span>
                                        <span class="font-mono text-xs text-muted md:hidden">{{ numeroAsientoConta(row.original) }}</span>
                                    </span>
                                </div>
                            </template>
                            <template #origen-cell="{ row }">
                                <div class="flex flex-col items-start gap-0.5">
                                    <UBadge
                                        :label="row.original.reversa_de ? 'Reverso' : origenAsiento(row.original.origen_tipo).etiqueta"
                                        color="neutral"
                                        variant="soft"
                                        size="sm"
                                    />
                                    <span
                                        v-if="row.original.origen_id"
                                        class="font-mono text-xs text-muted"
                                    >#{{ row.original.origen_id }}</span>
                                </div>
                            </template>
                            <template #monto-cell="{ row }">
                                <span class="flex items-center justify-end gap-2">
                                    <span class="font-semibold tabular-nums">{{ formatearQuetzales(totalesPartida(row.original.movimientos).debe).replace('Q ', '') }}</span>
                                    <UIcon
                                        :name="cuadra(totalesPartida(row.original.movimientos)) ? 'i-lucide-shield-check' : 'i-lucide-octagon-alert'"
                                        :class="cuadra(totalesPartida(row.original.movimientos)) ? 'text-success' : 'text-error'"
                                        class="size-4"
                                        :aria-label="cuadra(totalesPartida(row.original.movimientos)) ? 'Cuadra' : 'No cuadra'"
                                    />
                                </span>
                            </template>
                            <template #empty>
                                <UEmpty
                                    icon="i-lucide-book-x"
                                    :title="hayFiltros ? 'Sin asientos para estos filtros' : 'El libro diario está vacío'"
                                    variant="naked"
                                />
                            </template>
                        </UTable>
                        <div class="px-3 pb-3">
                            <PaginacionCursor
                                :pagina="diario.pagina.value"
                                :hay-anterior="diario.hayAnterior.value"
                                :hay-siguiente="diario.haySiguiente.value"
                                :cargando="diario.cargando.value"
                                :filas="diario.filas.value.length"
                                @anterior="diario.anterior"
                                @siguiente="diario.siguiente"
                            />
                        </div>
                    </template>
                </template>

                <!-- Mayor y auxiliar: movimientos de una cuenta con su saldo corrido. -->
                <template v-else-if="pestana === 'mayor' || pestana === 'auxiliar'">
                    <div
                        v-if="problemaCuentas"
                        class="p-4"
                    >
                        <ProblemaAlerta
                            :problema="problemaCuentas"
                            :reintentar="cargarCuentas"
                        />
                    </div>
                    <UEmpty
                        v-else-if="pestana === 'mayor' && !cuentaId"
                        icon="i-lucide-book"
                        title="Elige una cuenta"
                        description="El mayor muestra los movimientos de una cuenta con su saldo acumulado."
                        variant="naked"
                    />
                    <UEmpty
                        v-else-if="pestana === 'auxiliar' && !clienteId"
                        icon="i-lucide-user-search"
                        title="Busca un cliente"
                        description="Su auxiliar muestra cada factura, pago y nota de crédito con el saldo que va quedando."
                        variant="naked"
                    />
                    <div
                        v-else-if="lineasMayor.problema.value"
                        class="p-4"
                    >
                        <ProblemaAlerta
                            :problema="lineasMayor.problema.value"
                            :reintentar="lineasMayor.recargar"
                            :reintentando="lineasMayor.cargando.value"
                        />
                    </div>
                    <template v-else>
                        <div
                            v-if="mayor"
                            class="flex flex-wrap items-center justify-between gap-3 border-b border-(--ax-borde) bg-(--ax-panel) px-4 py-3"
                            data-prueba="resumen-mayor"
                        >
                            <div class="flex min-w-0 items-center gap-3">
                                <AvatarIniciales
                                    v-if="pestana === 'auxiliar' && clienteElegido"
                                    :nombre="clienteElegido.nombre"
                                />
                                <div class="flex min-w-0 flex-col">
                                    <span class="truncate font-semibold text-highlighted">
                                        {{ pestana === 'auxiliar' && clienteElegido ? clienteElegido.nombre : `${mayor.cuenta.codigo} · ${mayor.cuenta.nombre}` }}
                                    </span>
                                    <span class="truncate text-xs text-muted">
                                        Saldo inicial {{ formatearQuetzales(mayor.saldo_inicial) }} · Debe {{ formatearQuetzales(totalesMayor.debe) }} · Haber {{ formatearQuetzales(totalesMayor.haber) }} en esta página
                                    </span>
                                </div>
                            </div>
                            <div class="flex items-center gap-3">
                                <div class="flex flex-col items-end">
                                    <span class="text-xs text-muted">{{ pestana === 'auxiliar' ? 'Saldo (suma de su auxiliar)' : 'Saldo final' }}</span>
                                    <span
                                        class="text-lg font-bold tabular-nums"
                                        :class="pestana === 'auxiliar' && new Decimal(mayor.saldo_final).gt(0) ? 'text-error' : 'text-highlighted'"
                                    >{{ formatearQuetzales(mayor.saldo_final) }}</span>
                                </div>
                                <UButton
                                    v-if="pestana === 'auxiliar' && clienteId && puede('clientes.ver')"
                                    label="Ficha del cliente"
                                    icon="i-lucide-user"
                                    :to="`/clientes/${clienteId}`"
                                    color="neutral"
                                    variant="outline"
                                    class="rounded-full"
                                />
                            </div>
                        </div>
                        <UTable
                            :data="lineasMayor.filas.value"
                            :columns="columnasMayor"
                            :loading="lineasMayor.cargando.value"
                            sticky
                            :ui="{ td: 'py-2.5' }"
                        >
                            <template #fecha-cell="{ row }">
                                <span class="whitespace-nowrap text-sm text-muted">{{ formatearFecha(row.original.fecha) }}</span>
                            </template>
                            <template #descripcion-cell="{ row }">
                                <div class="flex flex-col">
                                    <span class="text-sm">{{ row.original.descripcion }}</span>
                                    <span class="text-xs text-muted">
                                        Asiento #{{ row.original.asiento_id }}<template v-if="row.original.cliente_id && pestana === 'mayor'"> · {{ nombres.nombre(row.original.cliente_id) }}</template>
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
                                <span class="font-semibold tabular-nums">{{ formatearQuetzales(row.original.saldo).replace('Q ', '') }}</span>
                            </template>
                            <template #empty>
                                <UEmpty
                                    icon="i-lucide-list"
                                    title="Sin movimientos en este rango"
                                    variant="naked"
                                />
                            </template>
                        </UTable>
                        <div class="px-3 pb-3">
                            <PaginacionCursor
                                :pagina="lineasMayor.pagina.value"
                                :hay-anterior="lineasMayor.hayAnterior.value"
                                :hay-siguiente="lineasMayor.haySiguiente.value"
                                :cargando="lineasMayor.cargando.value"
                                :filas="lineasMayor.filas.value.length"
                                @anterior="lineasMayor.anterior"
                                @siguiente="lineasMayor.siguiente"
                            />
                        </div>
                    </template>
                </template>

                <!-- Plan de cuentas y diarios. -->
                <div
                    v-else
                    class="flex flex-col gap-6 p-3 sm:p-4"
                >
                    <ProblemaAlerta
                        v-if="problemaCuentas"
                        :problema="problemaCuentas"
                        :reintentar="cargarCuentas"
                    />
                    <UTable
                        v-else
                        :data="cuentasVisibles"
                        :columns="columnasCuentas"
                        sticky
                        class="max-h-[28rem] rounded-xl border border-(--ax-borde)"
                        :ui="{ td: 'py-2' }"
                        data-prueba="plan-cuentas"
                    >
                        <template #codigo-cell="{ row }">
                            <span class="font-mono text-[0.8125rem]">{{ row.original.codigo }}</span>
                        </template>
                        <template #nombre-cell="{ row }">
                            <span :class="row.original.imputable ? '' : 'font-semibold text-highlighted'">{{ row.original.nombre }}</span>
                        </template>
                        <template #tipo-cell="{ row }">
                            {{ TIPOS_CUENTA[row.original.tipo] }}
                        </template>
                        <template #uso-cell="{ row }">
                            <span class="text-xs text-muted">{{ row.original.imputable ? (row.original.auxiliar_cliente ? 'Recibe movimientos · auxiliar por cliente' : 'Recibe movimientos') : 'Agrupa cuentas' }}</span>
                        </template>
                    </UTable>
                    <section class="flex flex-col gap-2">
                        <h2 class="text-base font-semibold text-highlighted">
                            Diarios y su numeración
                        </h2>
                        <LibroDiarios />
                    </section>
                </div>

                <template
                    v-if="pestana === 'diario' && elegido"
                    #lateral
                >
                    <ContaAsientoDetalle
                        :key="elegido.id"
                        :asiento="elegido"
                        @cerrar="elegido = null"
                        @revertido="alRevertir"
                    />
                </template>

                <template #pie>
                    <template v-if="pestana === 'diario'">
                        <template v-if="cadenaRota">
                            La cadena del libro está rota: <ULink
                                to="/libro/integridad"
                                class="text-error underline"
                            >revisa la integridad</ULink>.
                        </template>
                        <template v-else-if="ultimoSello">
                            Cadena verificada hasta el sello {{ ultimoSello.toLocaleString('es-GT') }}. Ningún asiento se edita ni se borra: los errores se corrigen con un reverso.
                            <ULink
                                to="/libro/integridad"
                                class="text-primary"
                            >Ver integridad</ULink>
                        </template>
                        <template v-else>
                            Ningún asiento se edita ni se borra: los errores se corrigen con un reverso.
                        </template>
                    </template>
                    <template v-else-if="pestana === 'auxiliar'">
                        El saldo no es un campo: es la suma de estos movimientos. Un cliente con servicios en dos empresas tiene un auxiliar por empresa.
                    </template>
                    <template v-else-if="pestana === 'mayor'">
                        Fechas contables (día de Guatemala). Los gastos se registran en Egresos y dejan su asiento.
                    </template>
                    <template v-else>
                        Las cuentas en negrita agrupan a otras; solo las demás reciben movimientos.
                    </template>
                </template>
                <template
                    v-if="pestana === 'diario' && diario.filas.value.length"
                    #pie-derecha
                >
                    <span data-prueba="totales-diario">
                        Página: Debe <strong data-prueba="diario-debe">{{ formatearQuetzales(totalesDiario.debe) }}</strong>
                        · Haber <strong data-prueba="diario-haber">{{ formatearQuetzales(totalesDiario.haber) }}</strong>
                        · {{ cuadra(totalesDiario) ? 'Cuadra' : 'No cuadra' }}
                    </span>
                </template>
            </ContaIsla>
        </ContaCuerpo>
    </PanelPagina>
</template>
