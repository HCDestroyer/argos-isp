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

const estado = ref<EstadoDte | typeof TODOS>(textoQuery(route.query.estado) in ESTADOS_DTE ? (textoQuery(route.query.estado) as EstadoDte) : TODOS)
const documento = ref<Dte['documento_tipo'] | typeof TODOS>(textoQuery(route.query.documento) in DOCUMENTOS_DTE ? (textoQuery(route.query.documento) as Dte['documento_tipo']) : TODOS)

/** Atajos a los estados que piden atención. */
const ATAJOS: { estado: EstadoDte, etiqueta: string }[] = [
    { estado: 'pendiente', etiqueta: 'Pendientes' },
    { estado: 'error_temporal', etiqueta: 'Con error temporal' },
    { estado: 'rechazado', etiqueta: 'Rechazados' },
    { estado: 'contingencia', etiqueta: 'En contingencia' },
    { estado: 'anulacion_pendiente', etiqueta: 'Anulación pendiente' },
]

const itemsEstado: SelectItem[] = [
    { label: 'Todos los estados', value: TODOS },
    ...Object.entries(ESTADOS_DTE).map(([valor, datos]) => ({ label: datos.etiqueta, value: valor, icon: datos.icono })),
]

const itemsDocumento: SelectItem[] = [
    { label: 'Todos los documentos', value: TODOS },
    ...Object.entries(DOCUMENTOS_DTE).map(([valor, etiqueta]) => ({ label: etiqueta, value: valor })),
]

function filtros(): FiltrosDte {
    const resultado: FiltrosDte = {}
    if (estado.value !== TODOS) {
        resultado.estado = estado.value
    }
    if (documento.value !== TODOS) {
        resultado.documento_tipo = documento.value
    }
    return resultado
}

const lista = usePaginacionCursor(cursor => useDte().listar(filtros(), cursor))
const consolidado = computed(() => empresaId.value === null && empresas.value.length > 1)
const hayFiltros = computed(() => estado.value !== TODOS || documento.value !== TODOS)

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
    if (estado.value !== TODOS) {
        query.estado = estado.value
    }
    if (documento.value !== TODOS) {
        query.documento = documento.value
    }
    await router.replace({ query })
    await lista.recargar()
}

function limpiarFiltros() {
    estado.value = TODOS
    documento.value = TODOS
}

watch([estado, documento], aplicarFiltros)
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
                    :key="atajo.estado"
                    :label="atajo.etiqueta"
                    :icon="ESTADOS_DTE[atajo.estado].icono"
                    :color="estado === atajo.estado ? ESTADOS_DTE[atajo.estado].color : 'neutral'"
                    :variant="estado === atajo.estado ? 'subtle' : 'outline'"
                    size="sm"
                    :aria-pressed="estado === atajo.estado"
                    :data-prueba="`atajo-${atajo.estado}`"
                    @click="estado = estado === atajo.estado ? TODOS : atajo.estado"
                />
            </div>

            <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-[repeat(2,minmax(0,16rem))_1fr]">
                <USelect
                    v-model="estado"
                    :items="itemsEstado"
                    icon="i-lucide-activity"
                    aria-label="Filtrar por estado"
                    class="w-full"
                />
                <USelect
                    v-model="documento"
                    :items="itemsDocumento"
                    icon="i-lucide-file-text"
                    aria-label="Filtrar por documento"
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
