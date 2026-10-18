<script setup lang="ts">
import type { SelectItem, TableColumn } from '@nuxt/ui'

/**
 * Cola de DTE (A3, fase 3; `GET /dte`, `fel.ver`): pendientes, rechazados, en contingencia… con
 * filtros por estado y documento. Consolidable: con «Todas las empresas» pide `?empresas=todas`
 * (lo pone el plugin `empresa`) y muestra la empresa de cada DTE.
 */
definePageMeta({ permiso: 'fel.ver' })

useHead({ title: 'Cola de DTE · ArgosIsp' })

const route = useRoute()
const router = useRouter()
const { empresas, empresaId } = useEmpresaActiva()

const TODOS = 'todos'

function textoQuery(valor: unknown): string {
    return typeof valor === 'string' ? valor : ''
}

const FECHA = /^\d{4}-\d{2}-\d{2}$/

function estadosQuery(valor: unknown): EstadoDte[] {
    const lista = Array.isArray(valor) ? valor : [valor]
    return lista.flatMap(v => (typeof v === 'string' ? v.split(',') : [])).filter((v): v is EstadoDte => v in ESTADOS_DTE)
}

const estados = ref<EstadoDte[]>(estadosQuery(route.query.estado))
const desde = ref(FECHA.test(textoQuery(route.query.desde)) ? textoQuery(route.query.desde) : '')
const hasta = ref(FECHA.test(textoQuery(route.query.hasta)) ? textoQuery(route.query.hasta) : '')
const documento = ref<Dte['documento_tipo'] | typeof TODOS>(textoQuery(route.query.documento) in DOCUMENTOS_DTE ? (textoQuery(route.query.documento) as Dte['documento_tipo']) : TODOS)

/** Atajos a los estados que piden atención (varios estados en una sola consulta). */
const ATAJOS: { id: string, estados: EstadoDte[], etiqueta: string, icono: string }[] = [
    { id: 'pendientes', estados: ['pendiente', 'enviando', 'error_temporal'], etiqueta: 'Por atender', icono: 'i-lucide-clock' },
    { id: 'rechazado', estados: ['rechazado'], etiqueta: 'Rechazados', icono: ESTADOS_DTE.rechazado.icono },
    { id: 'contingencia', estados: ['contingencia'], etiqueta: 'En contingencia', icono: ESTADOS_DTE.contingencia.icono },
    { id: 'anulacion_pendiente', estados: ['anulacion_pendiente'], etiqueta: 'Anulación pendiente', icono: ESTADOS_DTE.anulacion_pendiente.icono },
]

function mismosEstados(a: readonly EstadoDte[], b: readonly EstadoDte[]): boolean {
    return a.length === b.length && a.every(e => b.includes(e))
}

const itemsEstado = Object.entries(ESTADOS_DTE).map(([valor, datos]) => ({ label: datos.etiqueta, value: valor as EstadoDte, icon: datos.icono }))

const itemsDocumento: SelectItem[] = [
    { label: 'Todos los documentos', value: TODOS },
    ...Object.entries(DOCUMENTOS_DTE).map(([valor, etiqueta]) => ({ label: etiqueta, value: valor })),
]

function filtros(): FiltrosDte {
    const resultado: FiltrosDte = {}
    if (estados.value.length) {
        resultado.estado = [...estados.value]
    }
    if (desde.value) {
        resultado.desde = desde.value
    }
    if (hasta.value) {
        resultado.hasta = hasta.value
    }
    if (documento.value !== TODOS) {
        resultado.documento_tipo = documento.value
    }
    return resultado
}

const lista = usePaginacionCursor(cursor => useDte().listar(filtros(), cursor))
const consolidado = computed(() => empresaId.value === null && empresas.value.length > 1)
const hayFiltros = computed(() => estados.value.length > 0 || documento.value !== TODOS || desde.value !== '' || hasta.value !== '')

const columnas = computed<TableColumn<Dte>[]>(() => [
    { id: 'dte', header: 'DTE' },
    { id: 'receptor', header: 'Receptor', meta: SOLO_ANCHO },
    ...(consolidado.value ? [{ id: 'empresa', header: 'Empresa', meta: SOLO_ESCRITORIO }] : []),
    { accessorKey: 'total', header: 'Total', meta: { class: { th: 'hidden text-right sm:table-cell', td: 'hidden text-right sm:table-cell' } } },
    { accessorKey: 'intentos', header: 'Intentos', meta: SOLO_ESCRITORIO },
    { accessorKey: 'estado', header: 'Estado' },
])

function nombreEmpresa(id: number): string {
    return empresas.value.find(e => e.id === id)?.nombre_comercial ?? `Empresa ${id}`
}

function rutaDocumento(dte: Dte): string {
    return dte.documento_tipo === 'nota_credito' ? `/notas-credito/${dte.documento_id}` : `/facturas/${dte.documento_id}`
}

async function aplicarFiltros() {
    const query: Record<string, string> = {}
    if (estados.value.length) {
        query.estado = estados.value.join(',')
    }
    if (desde.value) {
        query.desde = desde.value
    }
    if (hasta.value) {
        query.hasta = hasta.value
    }
    if (documento.value !== TODOS) {
        query.documento = documento.value
    }
    await router.replace({ query })
    await lista.recargar()
}

function limpiarFiltros() {
    estados.value = []
    documento.value = TODOS
    desde.value = ''
    hasta.value = ''
}

watch([estados, documento, desde, hasta], aplicarFiltros, { deep: true })
onMounted(() => void lista.recargar())
</script>

<template>
    <PanelPagina
        id="dte"
        titulo="Cola de DTE"
        icono="i-lucide-badge-check"
    >
        <div class="flex flex-col gap-4">
            <p class="text-sm text-muted">
                Documentos tributarios electrónicos de cada factura, mora (NDEB) y nota de crédito (NCRE). Un rechazado se corrige y se reintenta; uno con error temporal se reintenta solo.
            </p>

            <div class="flex flex-wrap gap-2">
                <UButton
                    v-for="atajo in ATAJOS"
                    :key="atajo.id"
                    :label="atajo.etiqueta"
                    :icon="atajo.icono"
                    :color="mismosEstados(estados, atajo.estados) ? 'primary' : 'neutral'"
                    :variant="mismosEstados(estados, atajo.estados) ? 'subtle' : 'outline'"
                    size="sm"
                    :aria-pressed="mismosEstados(estados, atajo.estados)"
                    :data-prueba="`atajo-${atajo.id}`"
                    @click="estados = mismosEstados(estados, atajo.estados) ? [] : [...atajo.estados]"
                />
            </div>

            <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,18rem)_minmax(0,14rem)_repeat(2,minmax(0,11rem))_1fr]">
                <USelectMenu
                    v-model="estados"
                    :items="itemsEstado"
                    value-key="value"
                    multiple
                    icon="i-lucide-activity"
                    placeholder="Todos los estados"
                    aria-label="Filtrar por estado"
                    class="w-full"
                    data-prueba="filtro-estados"
                />
                <USelect
                    v-model="documento"
                    :items="itemsDocumento"
                    icon="i-lucide-file-text"
                    aria-label="Filtrar por documento"
                    class="w-full"
                />
                <UInput
                    v-model="desde"
                    type="date"
                    aria-label="Emitidos desde"
                    class="w-full"
                />
                <UInput
                    v-model="hasta"
                    type="date"
                    aria-label="Emitidos hasta"
                    class="w-full"
                />
                <div
                    v-if="hayFiltros"
                    class="flex sm:col-span-2 lg:col-span-1"
                >
                    <UButton
                        label="Limpiar filtros"
                        icon="i-lucide-filter-x"
                        color="neutral"
                        variant="ghost"
                        @click="limpiarFiltros"
                    />
                </div>
            </div>

            <ProblemaAlerta
                v-if="lista.problema.value"
                :problema="lista.problema.value"
                :reintentar="lista.recargar"
                :reintentando="lista.cargando.value"
                data-prueba="dte-lista-error"
            />

            <template v-else>
                <UTable
                    :data="lista.filas.value"
                    :columns="columnas"
                    :loading="lista.cargando.value"
                    sticky
                    class="flex-1"
                    :ui="{ td: 'py-3' }"
                    data-prueba="tabla-dte"
                >
                    <template #dte-cell="{ row }">
                        <div class="flex min-w-36 flex-col">
                            <ULink
                                :to="`/dte/${row.original.id}`"
                                class="text-sm font-medium text-highlighted hover:text-primary"
                            >
                                {{ row.original.tipo_dte }} · DTE #{{ row.original.id }}
                            </ULink>
                            <ULink
                                :to="rutaDocumento(row.original)"
                                class="text-xs text-muted hover:text-primary"
                            >
                                {{ DOCUMENTOS_DTE[row.original.documento_tipo] }} #{{ row.original.documento_id }}
                            </ULink>
                            <span
                                v-if="row.original.serie"
                                class="truncate font-mono text-xs text-muted"
                            >{{ serieNumeroDte(row.original) }}</span>
                            <span
                                v-if="row.original.ultimo_error"
                                class="mt-1 line-clamp-2 max-w-72 whitespace-normal text-xs text-error"
                            >{{ row.original.ultimo_error }}</span>
                            <span class="truncate text-xs text-muted sm:hidden">{{ row.original.receptor.nombre }} · {{ formatearQuetzales(row.original.total) }}</span>
                        </div>
                    </template>

                    <template #receptor-cell="{ row }">
                        <div class="flex max-w-56 flex-col">
                            <span class="truncate text-sm">{{ row.original.receptor.nombre }}</span>
                            <span class="text-xs text-muted">{{ TIPOS_RECEPTOR[row.original.receptor.tipo] }}<template v-if="row.original.receptor.tipo !== 'cf'"> {{ row.original.receptor.id }}</template></span>
                        </div>
                    </template>

                    <template #empresa-cell="{ row }">
                        <span class="text-sm">{{ nombreEmpresa(row.original.empresa_id) }}</span>
                    </template>

                    <template #total-cell="{ row }">
                        <span class="tabular-nums">{{ formatearQuetzales(row.original.total) }}</span>
                    </template>

                    <template #intentos-cell="{ row }">
                        <div class="flex flex-col text-sm">
                            <span class="tabular-nums">{{ row.original.intentos }}</span>
                            <span
                                v-if="row.original.proximo_intento && row.original.estado !== 'certificado'"
                                class="text-xs text-muted"
                            >próximo {{ formatearFechaHora(row.original.proximo_intento) }}</span>
                        </div>
                    </template>

                    <template #estado-cell="{ row }">
                        <div class="flex flex-col items-start gap-1">
                            <EstadoDteBadge
                                :estado="row.original.estado"
                                size="sm"
                            />
                            <UBadge
                                v-if="row.original.contingencia"
                                label="Contingencia"
                                icon="i-lucide-cloud-off"
                                color="warning"
                                variant="outline"
                                size="sm"
                            />
                        </div>
                    </template>

                    <template #empty>
                        <UEmpty
                            icon="i-lucide-badge-check"
                            :title="hayFiltros ? 'Ningún DTE coincide' : 'Todavía no hay DTE'"
                            :description="hayFiltros ? 'Prueba con otro estado o documento.' : 'Aparecen al certificar facturas y notas.'"
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
    </PanelPagina>
</template>
