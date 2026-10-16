<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { SelectItem, TableColumn } from '@nuxt/ui'
import type { LocationQuery } from 'vue-router'
import Decimal from 'decimal.js'
import { h } from 'vue'

definePageMeta({ permiso: 'reportes.ver' })

const route = useRoute()
const router = useRouter()
const toast = useToast()
const { puede } = usePermisos()

const TODOS = 'todos'
const FECHA = /^\d{4}-\d{2}-\d{2}$/

const clave = computed<ClaveReporte | null>(() => (esClaveReporte(route.params.reporte) ? route.params.reporte : null))
const presentacion = computed(() => (clave.value ? REPORTES[clave.value] : null))
const usa = (filtro: FiltroReporte) => presentacion.value?.filtros.includes(filtro) ?? false

useHead(() => ({ title: `${presentacion.value?.titulo ?? 'Reporte'} · ArgosIsp` }))

function texto(valor: unknown): string {
    return typeof valor === 'string' ? valor : ''
}

function id(valor: unknown): number | undefined {
    const numero = Number(texto(valor))
    return Number.isInteger(numero) && numero > 0 ? numero : undefined
}

function fecha(valor: unknown): string | undefined {
    return FECHA.test(texto(valor)) ? texto(valor) : undefined
}

function esClave<K extends string>(mapa: Record<K, string>, valor: unknown): valor is K {
    return typeof valor === 'string' && Object.hasOwn(mapa, valor)
}

function opcion<K extends string>(mapa: Record<K, string>, valor: unknown): K | undefined {
    return esClave(mapa, valor) ? valor : undefined
}

/** Filtros desde la URL: así un reporte filtrado se puede compartir o recargar. */
function filtrosDeQuery(query: LocationQuery): FiltrosReporte {
    return {
        desde: fecha(query.desde),
        hasta: fecha(query.hasta),
        corte: fecha(query.corte),
        cliente_id: id(query.cliente_id),
        zona_id: id(query.zona_id),
        router_id: id(query.router_id),
        plan_id: id(query.plan_id),
        caja_id: id(query.caja_id),
        metodo_pago: opcion(ETIQUETAS_METODO, query.metodo_pago),
        metodo_egreso: opcion(METODOS_EGRESO, query.metodo_egreso),
        categoria: opcion(CATEGORIAS_EGRESO, query.categoria),
        canal: opcion(CANALES_PROMESA, query.canal),
        tipo: opcion(TIPOS_FACTURA_REPORTE, query.tipo),
        agrupar_cartera: opcion(AGRUPAR_CARTERA, query.agrupar_cartera),
        agrupar_ingresos: opcion(AGRUPAR_INGRESOS, query.agrupar_ingresos),
    }
}

function queryDeFiltros(filtros: FiltrosReporte): Record<string, string> {
    return Object.fromEntries(Object.entries(filtros)
        .filter((par): par is [string, string | number] => par[1] !== undefined && par[1] !== '')
        .map(([k, v]) => [k, String(v)]))
}

const filtros = reactive<FiltrosReporte>(filtrosDeQuery(route.query))
const clienteElegido = shallowRef<Cliente | null>(null)

/* Selectores con "todos": el valor `todos` es `undefined` en los filtros. */
function selectorEnum<K extends string>(mapa: Record<K, string>, leer: () => K | undefined, escribir: (valor: K | undefined) => void) {
    return computed<string>({
        get: () => leer() ?? TODOS,
        set: valor => escribir(opcion(mapa, valor)),
    })
}

function selectorId(campo: 'zona_id' | 'router_id' | 'plan_id' | 'caja_id') {
    return computed<string>({
        get: () => (filtros[campo] ? String(filtros[campo]) : TODOS),
        set: (valor) => {
            filtros[campo] = valor === TODOS ? undefined : Number(valor)
        },
    })
}

const metodoPago = selectorEnum(ETIQUETAS_METODO, () => filtros.metodo_pago, (v) => {
    filtros.metodo_pago = v
})
const metodoEgreso = selectorEnum(METODOS_EGRESO, () => filtros.metodo_egreso, (v) => {
    filtros.metodo_egreso = v
})
const categoria = selectorEnum(CATEGORIAS_EGRESO, () => filtros.categoria, (v) => {
    filtros.categoria = v
})
const canal = selectorEnum(CANALES_PROMESA, () => filtros.canal, (v) => {
    filtros.canal = v
})
const tipo = selectorEnum(TIPOS_FACTURA_REPORTE, () => filtros.tipo, (v) => {
    filtros.tipo = v
})
const agruparCartera = selectorEnum(AGRUPAR_CARTERA, () => filtros.agrupar_cartera, (v) => {
    filtros.agrupar_cartera = v
})
const agruparIngresos = selectorEnum(AGRUPAR_INGRESOS, () => filtros.agrupar_ingresos, (v) => {
    filtros.agrupar_ingresos = v
})
const zona = selectorId('zona_id')
const routerSel = selectorId('router_id')
const plan = selectorId('plan_id')
const caja = selectorId('caja_id')

const clienteId = computed<number>({
    get: () => filtros.cliente_id ?? 0,
    set: (valor) => {
        filtros.cliente_id = valor || undefined
        if (!valor) {
            clienteElegido.value = null
        }
    },
})

function items(mapa: Record<string, string>, todos: string): SelectItem[] {
    return [{ label: todos, value: TODOS }, ...Object.entries(mapa).map(([value, label]) => ({ label, value }))]
}

const zonas = shallowRef<Zona[]>([])
const routers = shallowRef<RouterNas[]>([])
const planes = shallowRef<Plan[]>([])
const cajas = shallowRef<Caja[]>([])

const itemsZona = computed<SelectItem[]>(() => [{ label: 'Todas las zonas', value: TODOS }, ...zonas.value.map(z => ({ label: z.nombre, value: String(z.id) }))])
const itemsRouter = computed<SelectItem[]>(() => [{ label: 'Todos los routers', value: TODOS }, ...routers.value.map(r => ({ label: r.nombre, value: String(r.id) }))])
const itemsPlan = computed<SelectItem[]>(() => [{ label: 'Todos los planes', value: TODOS }, ...planes.value.map(p => ({ label: p.nombre, value: String(p.id) }))])
const itemsCaja = computed<SelectItem[]>(() => [{ label: 'Todas las cajas', value: TODOS }, ...cajas.value.map(c => ({ label: c.nombre, value: String(c.id) }))])

/* Los catálogos piden su propio permiso: sin él, el filtro no aparece. */
const conZonas = computed(() => usa('zona') && puede('zonas.ver'))
const conRouters = computed(() => usa('router') && puede('routers.ver'))
const conPlanes = computed(() => usa('plan') && puede('planes.ver'))
const conCajas = computed(() => usa('caja') && puede('cajas.ver'))
const conCliente = computed(() => usa('cliente') && puede('clientes.ver'))

async function cargarCatalogos() {
    const [rZonas, rRouters, rPlanes, rCajas] = await Promise.all([
        conZonas.value ? useZonas().listar() : null,
        conRouters.value ? useRouters().listar({ limit: 100 }) : null,
        conPlanes.value ? usePlanes().listar({ limit: 100 }) : null,
        conCajas.value ? useCajas().listar() : null,
    ])
    zonas.value = rZonas?.ok ? rZonas.data : []
    routers.value = rRouters?.ok ? rRouters.data.data : []
    planes.value = rPlanes?.ok ? rPlanes.data.data : []
    cajas.value = rCajas?.ok ? rCajas.data : []
}

const reporte = shallowRef<ReporteCualquiera | null>(null)
const problema = ref<Problem | null>(null)
const cargando = ref(false)
const descargando = ref<FormatoDescarga | null>(null)

/** Filtros que este reporte acepta (los demás se ignoran al pedir y al compartir la URL). */
function filtrosAplicables(): FiltrosReporte {
    const todos: FiltrosReporte = { ...filtros }
    const resultado: FiltrosReporte = {}
    const campos: [FiltroReporte, (keyof FiltrosReporte)[]][] = [
        ['rango', ['desde', 'hasta']],
        ['corte', ['corte']],
        ['cliente', ['cliente_id']],
        ['zona', ['zona_id']],
        ['router', ['router_id']],
        ['plan', ['plan_id']],
        ['caja', ['caja_id']],
        ['metodo_pago', ['metodo_pago']],
        ['metodo_egreso', ['metodo_egreso']],
        ['categoria', ['categoria']],
        ['canal', ['canal']],
        ['tipo', ['tipo']],
        ['agrupar_cartera', ['agrupar_cartera']],
        ['agrupar_ingresos', ['agrupar_ingresos']],
    ]
    for (const [filtro, claves] of campos) {
        if (usa(filtro)) {
            for (const c of claves) {
                Object.assign(resultado, { [c]: todos[c] })
            }
        }
    }
    return resultado
}

let pedido = 0
async function cargar() {
    if (!clave.value) {
        return
    }
    const actual = ++pedido
    cargando.value = true
    const aplicables = filtrosAplicables()
    void router.replace({ query: queryDeFiltros(aplicables) })
    const resultado = await useReportes().reporte(clave.value, aplicables)
    if (actual !== pedido) {
        return
    }
    cargando.value = false
    reporte.value = resultado.ok ? resultado.data : null
    problema.value = resultado.ok ? null : resultado.problema
}

async function descargar(formato: FormatoDescarga) {
    if (!clave.value || descargando.value) {
        return
    }
    descargando.value = formato
    const resultado = await useReportes().descargar(clave.value, filtrosAplicables(), formato)
    descargando.value = null
    if (!resultado.ok) {
        toast.add({ title: 'No se pudo descargar el reporte', description: resultado.problema.detail ?? resultado.problema.title, icon: 'i-lucide-circle-alert', color: 'error' })
        return
    }
    const url = URL.createObjectURL(resultado.data)
    const enlace = document.createElement('a')
    enlace.href = url
    enlace.download = nombreDescarga(clave.value, formato, hoyGuatemala())
    enlace.click()
    setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

const columnas = computed(() => (reporte.value ? columnasVisibles(reporte.value.columnas) : []))
const filas = computed(() => (reporte.value ? filasReporte(reporte.value) : []))
const totales = computed(() => (reporte.value ? totalesReporte(columnas.value, filas.value, totalesApi(reporte.value)) : {}))

const NUMERICAS: ColumnaReporte['tipo'][] = ['dinero', 'entero', 'porcentaje']

/** La cartera agrupa por cliente, zona, router o plan: la columna `grupo` se titula así. */
const tituloGrupo = computed(() => {
    const agrupar = reporte.value?.filtros.agrupar
    return esClave(TITULOS_GRUPO, agrupar) ? TITULOS_GRUPO[agrupar] : 'Grupo'
})

/** En el teléfono los filtros se pliegan; en pantallas anchas siempre están a la vista. */
const verFiltros = ref(false)
const cuantosFiltros = computed(() => Object.keys(queryDeFiltros(filtrosAplicables())).length)

const columnasTabla = computed<TableColumn<FilaReporte>[]>(() => columnas.value.map((columna, indice) => {
    const numerica = NUMERICAS.includes(columna.tipo)
    const total = totales.value[columna.clave]
    const pieTotal = total === null || total === undefined
        ? (indice === 0 ? 'Total' : '')
        : celdaReporte(columna, total instanceof Decimal ? total : new Decimal(total))
    return {
        id: columna.clave,
        header: columna.clave === 'grupo' ? tituloGrupo.value : columna.titulo,
        cell: ({ row }) => {
            const valor = row.original[columna.clave]
            return h('span', { class: [numerica ? 'tabular-nums' : '', esNegativo(columna, valor) ? 'text-error' : ''] }, celdaReporte(columna, valor))
        },
        footer: () => h('span', { 'class': ['whitespace-nowrap font-semibold text-highlighted', numerica ? 'tabular-nums' : '', esNegativo(columna, total) ? 'text-error' : ''], 'data-prueba': `total-${columna.clave}` }, pieTotal),
        meta: { class: { th: numerica ? 'text-right' : '', td: numerica ? 'text-right whitespace-nowrap' : 'whitespace-nowrap' } },
    }
}))

/** Rango que usó la API (con sus valores por defecto si no se eligieron fechas). */
const rangoAplicado = computed(() => {
    const aplicados = reporte.value?.filtros ?? {}
    const desde = typeof aplicados.desde === 'string' ? aplicados.desde : null
    const hasta = typeof aplicados.hasta === 'string' ? aplicados.hasta : null
    const corte = typeof aplicados.corte === 'string' ? aplicados.corte : null
    if (corte) {
        return `Antigüedad al ${formatearFecha(corte)}`
    }
    if (desde || hasta) {
        return `Del ${formatearFecha(desde)} al ${formatearFecha(hasta)}`
    }
    return null
})

const hayFiltros = computed(() => cuantosFiltros.value > 0)

function limpiar() {
    Object.assign(filtros, filtrosDeQuery({}))
    clienteElegido.value = null
}

watch(filtros, () => void cargar(), { deep: true })
watch(clave, () => {
    reporte.value = null
    problema.value = null
    void cargarCatalogos()
    void cargar()
})

onMounted(async () => {
    void cargarCatalogos()
    void cargar()
    if (filtros.cliente_id && conCliente.value) {
        const resultado = await useClientes().ver(filtros.cliente_id)
        if (resultado.ok) {
            clienteElegido.value = resultado.data
        }
    }
})
</script>

<template>
    <PanelPagina
        id="reporte"
        :titulo="presentacion?.titulo ?? 'Reporte'"
        :icono="presentacion?.icono ?? 'i-lucide-file-chart-column'"
    >
        <template #acciones>
            <UButton
                to="/reportes"
                label="Reportes"
                icon="i-lucide-arrow-left"
                color="neutral"
                variant="ghost"
                class="hidden sm:inline-flex"
            />
        </template>

        <UEmpty
            v-if="!clave || !presentacion"
            icon="i-lucide-file-question"
            title="Ese reporte no existe"
            :actions="[{ label: 'Ver los reportes', to: '/reportes', icon: 'i-lucide-arrow-left' }]"
            variant="naked"
        />

        <div
            v-else
            class="flex flex-col gap-4"
        >
            <p class="text-sm text-muted">
                {{ presentacion.descripcion }}
            </p>

            <UButton
                :label="cuantosFiltros ? `Filtros (${cuantosFiltros})` : 'Filtros'"
                icon="i-lucide-sliders-horizontal"
                :trailing-icon="verFiltros ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'"
                color="neutral"
                variant="outline"
                class="self-start sm:hidden"
                :aria-expanded="verFiltros"
                aria-controls="filtros-reporte"
                @click="verFiltros = !verFiltros"
            />

            <div
                id="filtros-reporte"
                class="gap-3 sm:grid sm:grid-cols-2 lg:grid-cols-4"
                :class="verFiltros ? 'grid' : 'hidden'"
            >
                <template v-if="usa('rango')">
                    <UFormField
                        label="Desde"
                        size="sm"
                    >
                        <UInput
                            v-model="filtros.desde"
                            type="date"
                            :max="filtros.hasta || undefined"
                            class="w-full"
                            data-prueba="filtro-desde"
                        />
                    </UFormField>
                    <UFormField
                        label="Hasta"
                        size="sm"
                    >
                        <UInput
                            v-model="filtros.hasta"
                            type="date"
                            :min="filtros.desde || undefined"
                            class="w-full"
                            data-prueba="filtro-hasta"
                        />
                    </UFormField>
                </template>
                <UFormField
                    v-if="usa('corte')"
                    label="Antigüedad al"
                    size="sm"
                >
                    <UInput
                        v-model="filtros.corte"
                        type="date"
                        class="w-full"
                    />
                </UFormField>
                <UFormField
                    v-if="usa('agrupar_cartera')"
                    label="Agrupar"
                    size="sm"
                >
                    <USelect
                        v-model="agruparCartera"
                        :items="items(AGRUPAR_CARTERA, 'Por cliente (por defecto)')"
                        class="w-full"
                    />
                </UFormField>
                <UFormField
                    v-if="usa('agrupar_ingresos')"
                    label="Agrupar"
                    size="sm"
                >
                    <USelect
                        v-model="agruparIngresos"
                        :items="items(AGRUPAR_INGRESOS, 'Por mes (por defecto)')"
                        class="w-full"
                    />
                </UFormField>
                <UFormField
                    v-if="usa('tipo')"
                    label="Facturas"
                    size="sm"
                >
                    <USelect
                        v-model="tipo"
                        :items="items(TIPOS_FACTURA_REPORTE, 'Servicio y mora')"
                        class="w-full"
                    />
                </UFormField>
                <UFormField
                    v-if="usa('metodo_pago')"
                    label="Método de pago"
                    size="sm"
                >
                    <USelect
                        v-model="metodoPago"
                        :items="items(ETIQUETAS_METODO, 'Todos los métodos')"
                        class="w-full"
                    />
                </UFormField>
                <UFormField
                    v-if="usa('categoria')"
                    label="Categoría"
                    size="sm"
                >
                    <USelect
                        v-model="categoria"
                        :items="items(CATEGORIAS_EGRESO, 'Todas las categorías')"
                        class="w-full"
                    />
                </UFormField>
                <UFormField
                    v-if="usa('metodo_egreso')"
                    label="Pagado con"
                    size="sm"
                >
                    <USelect
                        v-model="metodoEgreso"
                        :items="items(METODOS_EGRESO, 'Cualquier origen')"
                        class="w-full"
                    />
                </UFormField>
                <UFormField
                    v-if="usa('canal')"
                    label="Canal"
                    size="sm"
                >
                    <USelect
                        v-model="canal"
                        :items="items(CANALES_PROMESA, 'Todos los canales')"
                        class="w-full"
                    />
                </UFormField>
                <UFormField
                    v-if="conZonas"
                    label="Zona"
                    size="sm"
                >
                    <USelect
                        v-model="zona"
                        :items="itemsZona"
                        class="w-full"
                    />
                </UFormField>
                <UFormField
                    v-if="conRouters"
                    label="Router"
                    size="sm"
                >
                    <USelect
                        v-model="routerSel"
                        :items="itemsRouter"
                        class="w-full"
                    />
                </UFormField>
                <UFormField
                    v-if="conPlanes"
                    label="Plan"
                    size="sm"
                >
                    <USelect
                        v-model="plan"
                        :items="itemsPlan"
                        class="w-full"
                    />
                </UFormField>
                <UFormField
                    v-if="conCajas"
                    label="Caja"
                    size="sm"
                >
                    <USelect
                        v-model="caja"
                        :items="itemsCaja"
                        class="w-full"
                    />
                </UFormField>
                <UFormField
                    v-if="conCliente"
                    label="Cliente"
                    size="sm"
                    class="sm:col-span-2"
                >
                    <ClienteSelector
                        v-model="clienteId"
                        :seleccionado="clienteElegido"
                        placeholder="Todos los clientes"
                        class="w-full"
                        @elegido="clienteElegido = $event"
                    />
                </UFormField>
            </div>

            <div class="flex flex-wrap items-center gap-2">
                <p class="text-xs text-muted">
                    <template v-if="rangoAplicado">
                        {{ rangoAplicado }}
                    </template>
                    <template v-else-if="presentacion.rangoPorDefecto">
                        {{ presentacion.rangoPorDefecto }}
                    </template>
                    <template v-if="reporte">
                        · generado {{ formatearFechaHora(reporte.generado_en) }}
                    </template>
                </p>
                <UButton
                    v-if="hayFiltros"
                    label="Limpiar filtros"
                    icon="i-lucide-filter-x"
                    color="neutral"
                    variant="ghost"
                    size="sm"
                    @click="limpiar"
                />
                <div class="flex gap-2 sm:ml-auto">
                    <UButton
                        label="CSV"
                        icon="i-lucide-file-text"
                        color="neutral"
                        variant="outline"
                        size="sm"
                        :loading="descargando === 'csv'"
                        :disabled="!reporte || descargando !== null"
                        data-prueba="descargar-csv"
                        @click="descargar('csv')"
                    />
                    <UButton
                        label="Excel"
                        icon="i-lucide-file-spreadsheet"
                        color="neutral"
                        variant="outline"
                        size="sm"
                        :loading="descargando === 'xlsx'"
                        :disabled="!reporte || descargando !== null"
                        data-prueba="descargar-xlsx"
                        @click="descargar('xlsx')"
                    />
                </div>
            </div>

            <ProblemaAlerta
                v-if="problema"
                :problema="problema"
                :reintentar="cargar"
                :reintentando="cargando"
                data-prueba="reporte-error"
            />
            <USkeleton
                v-else-if="!reporte"
                class="h-64 w-full"
            />
            <UTable
                v-else
                :data="filas"
                :columns="columnasTabla"
                :loading="cargando"
                sticky
                class="max-h-[70vh] rounded-lg border border-default"
                :ui="{ td: 'py-2 text-sm', th: 'py-2 text-xs', tfoot: 'bg-elevated/50' }"
                data-prueba="tabla-reporte"
            >
                <template #empty>
                    <UEmpty
                        icon="i-lucide-file-x"
                        :title="hayFiltros ? 'Sin datos para estos filtros' : 'Sin datos en el periodo'"
                        variant="naked"
                    />
                </template>
            </UTable>
        </div>
    </PanelPagina>
</template>
