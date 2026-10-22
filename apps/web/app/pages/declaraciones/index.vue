<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'

/**
 * Declaraciones de IVA y de pequeño contribuyente (A3, fase 7 PR B; `GET /declaraciones`,
 * `declaraciones.ver`): cada versión con su estado, impuesto determinado, a pagar y pago, la más
 * reciente primero; filtros por impuesto, estado y mes; consolidable con «Todas». «Calcular
 * declaración» (`declaraciones.calcular`, con la empresa elegida) abre el formulario; el calendario
 * fiscal llega aquí con `?calcular=<impuesto>&periodo=AAAA-MM`.
 */
definePageMeta({ permiso: 'declaraciones.ver' })

useHead({ title: 'Declaraciones · ArgosIsp' })

const route = useRoute()
const router = useRouter()
const toast = useToast()
const { puede } = usePermisos()
const { conSelector, eleccion, empresaId, empresas, nombre: nombreEmpresa } = useEmpresaActiva()
const consolidado = computed(() => conSelector.value && eleccion.value === 'todas')
const empresa = computed<number | null>(() => empresaId.value ?? (conSelector.value ? null : (empresas.value[0]?.id ?? null)))

const PERIODO = /^\d{4}-(0[1-9]|1[0-2])$/

function texto(valor: unknown): string {
    return typeof valor === 'string' ? valor : ''
}

function listaQuery<T extends string>(valor: unknown, validos: readonly T[]): T[] {
    const lista = Array.isArray(valor) ? valor : [valor]
    return lista.flatMap(v => (typeof v === 'string' ? v.split(',') : [])).filter((v): v is T => (validos as readonly string[]).includes(v))
}

const impuestos = ref<ImpuestoDeclarable[]>(listaQuery(route.query.impuesto, IMPUESTOS_DECLARABLES_ORDEN))
const estados = ref<EstadoDeclaracion[]>(listaQuery(route.query.estado, ESTADOS_DECLARACION_ORDEN))
const periodo = ref(PERIODO.test(texto(route.query.periodo)) ? texto(route.query.periodo) : '')

const itemsImpuesto = IMPUESTOS_DECLARABLES_ORDEN.map(i => ({ label: IMPUESTOS_DECLARABLES[i].etiqueta, value: i, icon: IMPUESTOS_DECLARABLES[i].icono }))
const itemsEstado = ESTADOS_DECLARACION_ORDEN.map(e => ({ label: ESTADOS_DECLARACION[e].etiqueta, value: e, icon: ESTADOS_DECLARACION[e].icono }))
const hayFiltros = computed(() => impuestos.value.length > 0 || estados.value.length > 0 || periodo.value !== '')

const lista = usePaginacionCursor(cursor => useDeclaraciones().listar({
    ...(impuestos.value.length ? { impuesto: [...impuestos.value] } : {}),
    ...(estados.value.length ? { estado: [...estados.value] } : {}),
    ...(periodo.value ? { periodo: periodo.value } : {}),
}, cursor))

watch([impuestos, estados, periodo], () => {
    void router.replace({
        query: {
            ...route.query,
            impuesto: impuestos.value.length ? impuestos.value.join(',') : undefined,
            estado: estados.value.length ? estados.value.join(',') : undefined,
            periodo: periodo.value || undefined,
        },
    })
    void lista.recargar()
})
watch(eleccion, () => void lista.recargar())

function limpiarFiltros() {
    impuestos.value = []
    estados.value = []
    periodo.value = ''
}

const columnas: TableColumn<Declaracion>[] = [
    { accessorKey: 'periodo_desde', header: 'Declaración', meta: { class: { td: 'whitespace-normal' } } },
    { accessorKey: 'estado', header: 'Estado', meta: SOLO_ANCHO },
    { id: 'determinado', header: 'Determinado', meta: { class: { th: 'hidden md:table-cell text-right', td: 'hidden md:table-cell text-right' } } },
    { id: 'a_pagar', header: 'A pagar', meta: { class: { th: 'text-right', td: 'text-right' } } },
]

/** Impuesto determinado: IVA (débito − crédito − retenciones) o el del pequeño contribuyente. */
function determinado(d: Declaracion): string | null {
    return totalDe(d, d.impuesto === 'pc_mensual' ? 'impuesto' : 'impuesto_determinado')
}

/* Calcular (también desde el calendario: `?calcular=&periodo=`). */
const calculando = ref(false)
const impuestoCalcular = ref<ImpuestoDeclarable>('iva_mensual')
const periodoCalcular = ref<string | undefined>(undefined)

function abrirCalcular(impuesto: ImpuestoDeclarable = 'iva_mensual', mes?: string) {
    impuestoCalcular.value = impuesto
    periodoCalcular.value = mes
    calculando.value = true
}

function alCalcular(d: Declaracion) {
    toast.add({
        title: `Versión ${d.version} calculada`,
        description: `${etiquetaImpuestoDeclaracion(d.impuesto)} de ${etiquetaPeriodo(periodoDeclaracion(d))}: borrador${d.sustitutiva ? ' sustitutivo' : ''}.`,
        icon: 'i-lucide-calculator',
        color: 'success',
    })
    void router.push(`/declaraciones/${d.id}`)
}

onMounted(() => {
    void lista.recargar()
    const pedido = route.query.calcular
    if (esImpuestoDeclarable(pedido) && puede('declaraciones.calcular') && empresa.value !== null) {
        abrirCalcular(pedido, PERIODO.test(texto(route.query.periodo)) ? texto(route.query.periodo) : undefined)
        void router.replace({ query: { ...route.query, calcular: undefined } })
    }
})
</script>

<template>
    <PanelPagina
        id="declaraciones"
        titulo="Declaraciones"
        icono="i-lucide-file-spreadsheet"
    >
        <div class="flex flex-col gap-4">
            <UAlert
                color="neutral"
                variant="subtle"
                icon="i-lucide-info"
                description="Borradores del IVA (SAT-2237) y del pequeño contribuyente (SAT-2046) calculados desde los libros del mes. Revisar registra la liquidación y bloquea los impuestos del mes. ArgosIsp no presenta nada a la SAT: solo registra la presentación y el pago."
                :actions="[{ label: 'Calendario fiscal', icon: 'i-lucide-calendar-check', color: 'neutral', variant: 'outline', to: '/fiscal/calendario' }]"
            />

            <div class="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div class="grid gap-2 sm:grid-cols-3 lg:flex lg:items-center">
                    <USelectMenu
                        v-model="impuestos"
                        :items="itemsImpuesto"
                        value-key="value"
                        multiple
                        icon="i-lucide-landmark"
                        placeholder="Todos los impuestos"
                        aria-label="Filtrar por impuesto"
                        class="w-full lg:w-56"
                        data-prueba="filtro-impuestos"
                    />
                    <USelectMenu
                        v-model="estados"
                        :items="itemsEstado"
                        value-key="value"
                        multiple
                        icon="i-lucide-activity"
                        placeholder="Todos los estados"
                        aria-label="Filtrar por estado"
                        class="w-full lg:w-48"
                        data-prueba="filtro-estados"
                    />
                    <UInput
                        v-model="periodo"
                        type="month"
                        aria-label="Mes de la declaración"
                        class="w-full lg:w-44"
                        data-prueba="filtro-periodo"
                    />
                    <UButton
                        v-if="hayFiltros"
                        label="Quitar filtros"
                        icon="i-lucide-x"
                        color="neutral"
                        variant="ghost"
                        size="sm"
                        class="justify-self-start"
                        @click="limpiarFiltros"
                    />
                </div>
                <UButton
                    v-if="puede('declaraciones.calcular')"
                    label="Calcular declaración"
                    icon="i-lucide-calculator"
                    :disabled="empresa === null"
                    class="self-start"
                    data-prueba="abrir-calcular"
                    @click="abrirCalcular()"
                />
            </div>
            <p
                v-if="puede('declaraciones.calcular') && empresa === null"
                class="text-sm text-muted"
                data-prueba="declaraciones-sin-empresa"
            >
                Con «Todas» se ven las de todas las empresas; para calcular una, elija la empresa en el selector de arriba.
            </p>

            <ProblemaAlerta
                v-if="lista.problema.value"
                :problema="lista.problema.value"
                :reintentar="lista.recargar"
                :reintentando="lista.cargando.value"
            />
            <template v-else>
                <UTable
                    :data="lista.filas.value"
                    :columns="columnas"
                    :loading="lista.cargando.value"
                    data-prueba="tabla-declaraciones"
                >
                    <template #periodo_desde-cell="{ row }">
                        <div
                            class="flex min-w-0 flex-col"
                            :data-declaracion="row.original.id"
                            :data-estado="row.original.estado"
                        >
                            <ULink
                                :to="`/declaraciones/${row.original.id}`"
                                class="text-sm font-medium text-highlighted hover:text-primary"
                                :class="{ 'line-through decoration-1': row.original.estado === 'sustituida' }"
                            >
                                {{ etiquetaImpuestoDeclaracion(row.original.impuesto) }} · {{ etiquetaPeriodo(periodoDeclaracion(row.original)) }}
                            </ULink>
                            <span class="text-xs text-muted">
                                Versión {{ row.original.version }}<template v-if="row.original.sustitutiva"> · sustitutiva</template> · {{ row.original.formulario ?? 'formulario por confirmar' }}<template v-if="consolidado"> · {{ nombreEmpresa(row.original.empresa_id) }}</template>
                            </span>
                            <UBadge
                                :label="ESTADOS_DECLARACION[row.original.estado].etiqueta"
                                :icon="ESTADOS_DECLARACION[row.original.estado].icono"
                                :color="ESTADOS_DECLARACION[row.original.estado].color"
                                variant="subtle"
                                size="sm"
                                class="mt-1 self-start sm:hidden"
                            />
                        </div>
                    </template>
                    <template #estado-cell="{ row }">
                        <div class="flex flex-wrap gap-1">
                            <UBadge
                                :label="ESTADOS_DECLARACION[row.original.estado].etiqueta"
                                :icon="ESTADOS_DECLARACION[row.original.estado].icono"
                                :color="ESTADOS_DECLARACION[row.original.estado].color"
                                variant="subtle"
                            />
                            <UBadge
                                v-if="row.original.pago"
                                label="Pagada"
                                icon="i-lucide-banknote"
                                color="success"
                                variant="outline"
                            />
                        </div>
                    </template>
                    <template #determinado-cell="{ row }">
                        <span class="text-sm tabular-nums">{{ determinado(row.original) === null ? '—' : formatearQuetzales(determinado(row.original)) }}</span>
                    </template>
                    <template #a_pagar-cell="{ row }">
                        <div class="flex flex-col items-end">
                            <span class="text-sm font-medium tabular-nums text-highlighted">{{ totalDe(row.original, 'a_pagar') === null ? '—' : formatearQuetzales(totalDe(row.original, 'a_pagar')) }}</span>
                            <span class="text-xs text-muted">vence {{ formatearFecha(row.original.vence_en) }}</span>
                        </div>
                    </template>
                    <template #empty>
                        <UEmpty
                            icon="i-lucide-file-spreadsheet"
                            title="Sin declaraciones"
                            :description="hayFiltros ? 'Ninguna con los filtros elegidos.' : 'Calcule el borrador de un mes desde aquí o desde el calendario fiscal.'"
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

        <CalcularDeclaracionModal
            v-if="puede('declaraciones.calcular') && empresa !== null"
            v-model:open="calculando"
            :impuesto="impuestoCalcular"
            :periodo="periodoCalcular"
            :empresa="conSelector ? nombreEmpresa(empresa) : null"
            @hecho="alCalcular"
        />
    </PanelPagina>
</template>
