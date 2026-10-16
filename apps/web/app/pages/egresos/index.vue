<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { SelectItem, TableColumn } from '@nuxt/ui'

/**
 * Egresos (A3): lista con filtros, registrar (`egresos.registrar`) y anular con motivo
 * (`egresos.anular`, asiento de reverso). El total de la página suma solo los vigentes.
 */
definePageMeta({ permiso: 'egresos.ver' })

useHead({ title: 'Egresos · ArgosIsp' })

const route = useRoute()
const router = useRouter()
const toast = useToast()
const { puede } = usePermisos()

const TODOS = 'todos'
const FECHA = /^\d{4}-\d{2}-\d{2}$/

function texto(valor: unknown): string {
    return typeof valor === 'string' ? valor : ''
}

function esClave<K extends string>(mapa: Record<K, string>, valor: unknown): valor is K {
    return typeof valor === 'string' && Object.hasOwn(mapa, valor)
}

const ESTADOS: Record<EstadoEgreso, string> = { registrado: 'Registrados', anulado: 'Anulados' }

const desde = ref(FECHA.test(texto(route.query.desde)) ? texto(route.query.desde) : '')
const hasta = ref(FECHA.test(texto(route.query.hasta)) ? texto(route.query.hasta) : '')
const categoria = ref<CategoriaEgreso | typeof TODOS>(esClave(CATEGORIAS_EGRESO, route.query.categoria) ? route.query.categoria : TODOS)
const metodo = ref<MetodoEgreso | typeof TODOS>(esClave(METODOS_EGRESO, route.query.metodo) ? route.query.metodo : TODOS)
const estado = ref<EstadoEgreso | typeof TODOS>(esClave(ESTADOS, route.query.estado) ? route.query.estado : TODOS)

const categorias = shallowRef<CategoriaEgresoApi[]>([])
const problemaCategorias = ref<Problem | null>(null)
const nombreCategoria = (clave: CategoriaEgreso) => categorias.value.find(c => c.clave === clave)?.nombre ?? CATEGORIAS_EGRESO[clave]

const itemsCategoria = computed<SelectItem[]>(() => [
    { label: 'Todas las categorías', value: TODOS },
    ...Object.keys(CATEGORIAS_EGRESO).filter(c => esClave(CATEGORIAS_EGRESO, c)).map(c => ({ label: nombreCategoria(c), value: c })),
])
const itemsMetodo: SelectItem[] = [{ label: 'Cualquier origen', value: TODOS }, ...Object.entries(METODOS_EGRESO).map(([value, label]) => ({ label, value }))]
const itemsEstado: SelectItem[] = [{ label: 'Todos los estados', value: TODOS }, ...Object.entries(ESTADOS).map(([value, label]) => ({ label, value }))]

function filtros(): FiltrosEgresos {
    const resultado: FiltrosEgresos = {}
    if (desde.value) {
        resultado.desde = desde.value
    }
    if (hasta.value) {
        resultado.hasta = hasta.value
    }
    if (categoria.value !== TODOS) {
        resultado.categoria = categoria.value
    }
    if (metodo.value !== TODOS) {
        resultado.metodo = metodo.value
    }
    if (estado.value !== TODOS) {
        resultado.estado = estado.value
    }
    return resultado
}

const lista = usePaginacionCursor(cursor => useEgresos().listar(filtros(), cursor))
const totalPagina = computed(() => totalEgresos(lista.filas.value))

const columnas: TableColumn<Egreso>[] = [
    { accessorKey: 'fecha', header: 'Fecha', meta: SOLO_ANCHO },
    { accessorKey: 'categoria', header: 'Egreso', meta: { class: { td: 'whitespace-normal' } } },
    { accessorKey: 'metodo', header: 'Pagado con', meta: SOLO_ESCRITORIO },
    { accessorKey: 'monto', header: 'Monto', meta: { class: { th: 'text-right', td: 'text-right' } } },
    { accessorKey: 'estado', header: 'Estado', meta: SOLO_ANCHO },
    { id: 'acciones', header: '', meta: { class: { th: 'hidden sm:table-cell', td: 'hidden sm:table-cell text-right w-0' } } },
]

const hayFiltros = computed(() => Object.keys(filtros()).length > 0)

async function aplicarFiltros() {
    await router.replace({ query: { ...filtros() } })
    await lista.recargar()
}

function limpiarFiltros() {
    desde.value = ''
    hasta.value = ''
    categoria.value = TODOS
    metodo.value = TODOS
    estado.value = TODOS
}

async function cargarCategorias() {
    const resultado = await useEgresos().categorias()
    categorias.value = resultado.ok ? resultado.data : []
    problemaCategorias.value = resultado.ok ? null : resultado.problema
}

const registrando = ref(false)
const aAnular = shallowRef<Egreso | null>(null)
const anulando = computed({
    get: () => aAnular.value !== null,
    set: (valor) => {
        if (!valor) {
            aAnular.value = null
        }
    },
})

function alRegistrar(egreso: Egreso) {
    toast.add({ title: `Egreso #${egreso.id} registrado`, description: `${nombreCategoria(egreso.categoria)} · ${formatearQuetzales(egreso.monto)}`, icon: 'i-lucide-circle-check', color: 'success' })
    void lista.recargar()
}

function anularSeleccionado(motivo: string, clave: string) {
    if (!aAnular.value) {
        return Promise.resolve({ ok: false as const, problema: { type: 'about:blank', title: 'Sin egreso', status: 0 } })
    }
    return useEgresos().anular(aAnular.value.id, motivo, clave)
}

function alAnular(egreso: Egreso) {
    toast.add({ title: `Egreso #${egreso.id} anulado`, description: 'Se registró el asiento de reverso.', icon: 'i-lucide-ban', color: 'neutral' })
    void lista.recargar()
}

watch([desde, hasta, categoria, metodo, estado], aplicarFiltros)

onMounted(() => {
    void cargarCategorias()
    void lista.recargar()
})
</script>

<template>
    <PanelPagina
        id="egresos"
        titulo="Egresos"
        icono="i-lucide-receipt"
    >
        <template #acciones>
            <UButton
                v-if="puede('egresos.registrar')"
                label="Registrar egreso"
                icon="i-lucide-plus"
                data-prueba="abrir-registrar-egreso"
                @click="registrando = true"
            />
        </template>

        <div class="flex flex-col gap-4">
            <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
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
                    v-model="categoria"
                    :items="itemsCategoria"
                    aria-label="Categoría"
                    class="w-full"
                />
                <USelect
                    v-model="metodo"
                    :items="itemsMetodo"
                    aria-label="Pagado con"
                    class="w-full"
                />
                <USelect
                    v-model="estado"
                    :items="itemsEstado"
                    aria-label="Estado"
                    class="w-full"
                />
            </div>

            <div class="flex flex-wrap items-center gap-3">
                <p class="text-xs text-muted">
                    Fechas contables (día de Guatemala). Cada egreso tiene su asiento en el
                    <ULink
                        to="/libro?origen=egreso"
                        class="underline"
                    >libro diario</ULink>.
                </p>
                <UButton
                    v-if="hayFiltros"
                    label="Limpiar filtros"
                    icon="i-lucide-filter-x"
                    color="neutral"
                    variant="ghost"
                    size="sm"
                    class="sm:ml-auto"
                    @click="limpiarFiltros"
                />
            </div>

            <ProblemaAlerta
                v-if="problemaCategorias"
                :problema="problemaCategorias"
                :reintentar="cargarCategorias"
            />

            <ProblemaAlerta
                v-if="lista.problema.value"
                :problema="lista.problema.value"
                :reintentar="lista.recargar"
                :reintentando="lista.cargando.value"
                data-prueba="egresos-error"
            />
            <template v-else>
                <div
                    v-if="lista.filas.value.length"
                    class="flex items-center justify-end gap-3 rounded-lg bg-elevated px-3 py-2 text-sm"
                >
                    <span class="text-muted">Vigentes en la página</span>
                    <strong
                        class="tabular-nums"
                        data-prueba="total-egresos"
                    >{{ formatearQuetzales(totalPagina) }}</strong>
                </div>

                <UTable
                    :data="lista.filas.value"
                    :columns="columnas"
                    :loading="lista.cargando.value"
                    :ui="{ td: 'py-2.5' }"
                    data-prueba="tabla-egresos"
                >
                    <template #fecha-cell="{ row }">
                        <span class="whitespace-nowrap text-sm">{{ formatearFecha(row.original.fecha) }}</span>
                    </template>
                    <template #categoria-cell="{ row }">
                        <div class="flex min-w-0 flex-col">
                            <span class="text-sm font-medium text-highlighted">
                                #{{ row.original.id }} · {{ row.original.categoria_nombre || nombreCategoria(row.original.categoria) }}
                            </span>
                            <span class="truncate text-xs text-muted">
                                {{ [row.original.proveedor, row.original.comprobante, row.original.descripcion].filter(Boolean).join(' · ') || 'Sin proveedor ni descripción' }}
                            </span>
                            <span class="text-xs text-muted lg:hidden">{{ origenEgreso(row.original) }}</span>
                            <span class="text-xs text-muted sm:hidden">{{ formatearFecha(row.original.fecha) }} · {{ ESTADOS_EGRESO[row.original.estado].etiqueta }}</span>
                            <span
                                v-if="row.original.estado === 'anulado' && row.original.motivo_anulacion"
                                class="text-xs text-muted"
                            >Anulado: {{ row.original.motivo_anulacion }}</span>
                            <UButton
                                v-if="puede('egresos.anular') && row.original.estado === 'registrado'"
                                label="Anular"
                                icon="i-lucide-ban"
                                color="error"
                                variant="ghost"
                                size="xs"
                                class="mt-1 self-start sm:hidden"
                                @click="aAnular = row.original"
                            />
                        </div>
                    </template>
                    <template #metodo-cell="{ row }">
                        <span class="text-sm">{{ origenEgreso(row.original) }}</span>
                    </template>
                    <template #monto-cell="{ row }">
                        <span
                            class="whitespace-nowrap tabular-nums"
                            :class="row.original.estado === 'anulado' ? 'text-muted line-through' : 'font-medium'"
                        >{{ formatearQuetzales(row.original.monto) }}</span>
                    </template>
                    <template #estado-cell="{ row }">
                        <UBadge
                            :label="ESTADOS_EGRESO[row.original.estado].etiqueta"
                            :color="ESTADOS_EGRESO[row.original.estado].color"
                            :icon="ESTADOS_EGRESO[row.original.estado].icono"
                            variant="subtle"
                            size="sm"
                        />
                    </template>
                    <template #acciones-cell="{ row }">
                        <UButton
                            v-if="puede('egresos.anular') && row.original.estado === 'registrado'"
                            icon="i-lucide-ban"
                            color="error"
                            variant="ghost"
                            size="sm"
                            :aria-label="`Anular el egreso ${row.original.id}`"
                            data-prueba="anular-egreso"
                            @click="aAnular = row.original"
                        />
                    </template>
                    <template #empty>
                        <UEmpty
                            icon="i-lucide-receipt"
                            :title="hayFiltros ? 'Sin egresos para estos filtros' : 'Todavía no hay egresos'"
                            variant="naked"
                        />
                    </template>
                </UTable>

                <PaginacionCursor
                    :pagina="lista.pagina.value"
                    :hay-anterior="lista.hayAnterior.value"
                    :hay-siguiente="lista.haySiguiente.value"
                    :cargando="lista.cargando.value"
                    :filas="lista.filas.value.length"
                    @anterior="lista.anterior"
                    @siguiente="lista.siguiente"
                />
            </template>
        </div>

        <EgresoRegistrarModal
            v-model:open="registrando"
            :categorias="categorias"
            @hecho="alRegistrar"
        />

        <AccionMotivoModal
            v-model:open="anulando"
            :titulo="aAnular ? `Anular egreso #${aAnular.id}` : 'Anular egreso'"
            :descripcion="aAnular ? `${aAnular.categoria_nombre} · ${formatearQuetzales(aAnular.monto)} · ${formatearFecha(aAnular.fecha)}` : undefined"
            efecto="Se registra un asiento de reverso con la fecha de hoy. El egreso queda en la lista como anulado; no se borra."
            confirmar="Anular egreso"
            placeholder="Ej.: se registró dos veces"
            :ejecutar="anularSeleccionado"
            @hecho="alAnular"
        />
    </PanelPagina>
</template>
