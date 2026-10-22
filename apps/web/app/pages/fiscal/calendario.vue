<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { TableColumn, TabsItem } from '@nuxt/ui'

/**
 * Calendario fiscal (A3, fase 7 PR A; `GET /fiscal/obligaciones`, `declaraciones.ver`): las
 * obligaciones de la empresa activa (con «Todas», de todas) por mes o en lista. Vencidas sin presentar
 * en rojo, presentadas en verde, las que no aplican atenuadas con su motivo. El detalle (`?obligacion=`)
 * explica el vencimiento (plazo, inhábil corrido al siguiente hábil) y el formulario. El sistema nunca
 * presenta nada a la SAT.
 */
definePageMeta({ permiso: 'declaraciones.ver' })

useHead({ title: 'Calendario fiscal · ArgosIsp' })

const route = useRoute()
const router = useRouter()
const { puede } = usePermisos()
const { conSelector, eleccion, nombre: nombreEmpresa } = useEmpresaActiva()
const consolidado = computed(() => conSelector.value && eleccion.value === 'todas')
const empresaDe = computed(() => (consolidado.value ? (id: number) => nombreEmpresa(id) : undefined))

const hoy = hoyGuatemala()
const MES = /^\d{4}-(0[1-9]|1[0-2])$/
const FECHA = /^\d{4}-\d{2}-\d{2}$/

function texto(valor: unknown): string {
    return typeof valor === 'string' ? valor : ''
}

function listaQuery<T extends string>(valor: unknown, validos: readonly T[]): T[] {
    const lista = Array.isArray(valor) ? valor : [valor]
    return lista.flatMap(v => (typeof v === 'string' ? v.split(',') : [])).filter((v): v is T => (validos as readonly string[]).includes(v))
}

/* Vista y filtros (en la URL). */
const vista = computed<'mes' | 'lista'>({
    get: () => (route.query.vista === 'lista' ? 'lista' : 'mes'),
    set: valor => void router.replace({ query: { ...route.query, vista: valor === 'mes' ? undefined : valor } }),
})
const itemsVista: TabsItem[] = [
    { label: 'Mes', value: 'mes', icon: 'i-lucide-calendar-days' },
    { label: 'Lista', value: 'lista', icon: 'i-lucide-list' },
]

const mes = ref(MES.test(texto(route.query.mes)) ? texto(route.query.mes) : mesDe(hoy))
const impuestos = ref<ImpuestoObligacion[]>(listaQuery(route.query.impuesto, IMPUESTOS_ORDEN))
const estados = ref<EstadoObligacion[]>(listaQuery(route.query.estado, ESTADOS_ORDEN))
const desde = ref(FECHA.test(texto(route.query.desde)) ? texto(route.query.desde) : '')
const hasta = ref(FECHA.test(texto(route.query.hasta)) ? texto(route.query.hasta) : '')

const itemsImpuesto = IMPUESTOS_ORDEN.map(i => ({ label: IMPUESTOS_OBLIGACION[i].etiqueta, value: i, icon: IMPUESTOS_OBLIGACION[i].icono }))
const itemsEstado = ESTADOS_ORDEN.map(e => ({ label: ESTADOS_OBLIGACION[e].etiqueta, value: e, icon: ESTADOS_OBLIGACION[e].icono }))
const hayFiltros = computed(() => impuestos.value.length > 0 || estados.value.length > 0)

function filtrosBase(): Pick<FiltrosObligaciones, 'impuesto' | 'estado'> {
    return {
        ...(impuestos.value.length ? { impuesto: [...impuestos.value] } : {}),
        ...(estados.value.length ? { estado: [...estados.value] } : {}),
    }
}

function limpiarFiltros() {
    impuestos.value = []
    estados.value = []
    desde.value = ''
    hasta.value = ''
}

/* Vencidas sin presentar (de cualquier mes): pendientes o borradores que vencieron antes de hoy. */
const vencidas = shallowRef<ObligacionFiscal[] | null>(null)
const problemaVencidas = ref<Problem | null>(null)
const cargandoVencidas = ref(false)

async function cargarVencidas() {
    cargandoVencidas.value = true
    const ayer = new Date(Date.parse(`${hoy}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10)
    const resultado = await useObligacionesFiscales().delRango('2000-01-01', ayer, { estado: ['pendiente', 'borrador'] })
    cargandoVencidas.value = false
    vencidas.value = resultado.ok ? resultado.data.filter(o => o.vencida) : null
    problemaVencidas.value = resultado.ok ? null : resultado.problema
}

/* Vista por mes: todas las del mes (siguiendo el cursor) y los feriados del año. */
const delMes = shallowRef<ObligacionFiscal[] | null>(null)
const problemaMes = ref<Problem | null>(null)
const cargandoMes = ref(false)
let pedidoMes = 0

async function cargarMes() {
    const actual = ++pedidoMes
    const { desde: inicio, hasta: fin } = rangoMes(mes.value)
    cargandoMes.value = true
    const resultado = await useObligacionesFiscales().delRango(inicio, fin, filtrosBase())
    if (actual !== pedidoMes) {
        return
    }
    cargandoMes.value = false
    delMes.value = resultado.ok ? resultado.data : null
    problemaMes.value = resultado.ok ? null : resultado.problema
}

/** Agenda del mes: las obligaciones agrupadas por día de vencimiento. */
const agenda = computed(() => {
    const grupos = new Map<string, ObligacionFiscal[]>()
    for (const obligacion of delMes.value ?? []) {
        grupos.set(obligacion.vence_en, [...(grupos.get(obligacion.vence_en) ?? []), obligacion])
    }
    return [...grupos.entries()].map(([fecha, obligaciones]) => ({ fecha, obligaciones }))
})

const feriados = ref<Record<string, string>>({})
const problemaFeriados = ref<Problem | null>(null)
let anioFeriados: number | null = null

async function cargarFeriados(forzar = false) {
    const anio = Number(mes.value.slice(0, 4))
    if (!puede('fiscal.ver') || (anio === anioFeriados && !forzar)) {
        return
    }
    const resultado = await useFeriadosFiscales().listar(anio)
    anioFeriados = resultado.ok ? anio : null
    feriados.value = resultado.ok ? Object.fromEntries(resultado.data.vigentes.map(f => [f.fecha, f.nombre])) : {}
    problemaFeriados.value = resultado.ok ? null : resultado.problema
}

function irAMes(nuevo: string) {
    mes.value = nuevo
}

watch(mes, (valor) => {
    void router.replace({ query: { ...route.query, mes: valor === mesDe(hoy) ? undefined : valor } })
    void cargarMes()
    void cargarFeriados()
})

/* Vista en lista: paginada por cursor, con el rango del vencimiento. */
const lista = usePaginacionCursor(cursor => useObligacionesFiscales().listar({
    ...filtrosBase(),
    ...(desde.value ? { desde: desde.value } : {}),
    ...(hasta.value ? { hasta: hasta.value } : {}),
}, cursor))

const columnas = computed<TableColumn<ObligacionFiscal>[]>(() => [
    { accessorKey: 'vence_en', header: 'Vence' },
    { accessorKey: 'nombre', header: 'Obligación', meta: { class: { td: 'whitespace-normal' } } },
    { accessorKey: 'estado', header: 'Estado', meta: SOLO_ANCHO },
    { accessorKey: 'formulario', header: 'Formulario', meta: SOLO_ESCRITORIO },
])

const metaTabla = {
    class: {
        tr: (fila: { original: ObligacionFiscal }) => [
            'cursor-pointer',
            fila.original.estado === 'no_aplica' ? 'bg-elevated/50' : '',
            fila.original.vencida ? 'bg-error/5' : '',
        ].join(' '),
    },
}

function sincronizarFiltros() {
    void router.replace({
        query: {
            ...route.query,
            impuesto: impuestos.value.length ? impuestos.value.join(',') : undefined,
            estado: estados.value.length ? estados.value.join(',') : undefined,
            desde: desde.value || undefined,
            hasta: hasta.value || undefined,
        },
    })
}

watch([impuestos, estados], () => {
    sincronizarFiltros()
    void cargarMes()
    void lista.recargar()
})
watch([desde, hasta], () => {
    sincronizarFiltros()
    void lista.recargar()
})

/* Detalle (`?obligacion=`). */
const idDetalle = computed(() => {
    const id = Number(route.query.obligacion)
    return Number.isInteger(id) && id > 0 ? id : null
})
const detalle = shallowRef<ObligacionFiscal | null>(null)
const problemaDetalle = ref<Problem | null>(null)
const cargandoDetalle = ref(false)

async function cargarDetalle() {
    const id = idDetalle.value
    if (id === null) {
        return
    }
    if (detalle.value?.id !== id) {
        detalle.value = null
    }
    cargandoDetalle.value = true
    const resultado = await useObligacionesFiscales().ver(id)
    cargandoDetalle.value = false
    detalle.value = resultado.ok ? resultado.data : null
    problemaDetalle.value = resultado.ok ? null : resultado.problema
}

function abrirDetalle(obligacion: ObligacionFiscal | null) {
    if (obligacion) {
        detalle.value = obligacion
        problemaDetalle.value = null
    }
    void router.replace({ query: { ...route.query, obligacion: obligacion ? String(obligacion.id) : undefined } })
}

const viendoDetalle = computed({
    get: () => idDetalle.value !== null,
    set: (valor: boolean) => {
        if (!valor) {
            abrirDetalle(null)
        }
    },
})

watch(idDetalle, () => void cargarDetalle())

function recargarTodo() {
    void cargarVencidas()
    void cargarMes()
    void lista.recargar()
}

// Cambiar de empresa (o «Todas») cambia todo el calendario.
watch(eleccion, recargarTodo)

onMounted(() => {
    recargarTodo()
    void cargarFeriados()
    void cargarDetalle()
})
</script>

<template>
    <PanelPagina
        id="fiscal-calendario"
        titulo="Calendario fiscal"
        icono="i-lucide-calendar-check"
    >
        <div class="flex flex-col gap-4">
            <UAlert
                color="neutral"
                variant="subtle"
                icon="i-lucide-info"
                description="Vencimientos de las declaraciones según el régimen y las banderas de cada periodo. Un vencimiento en sábado, domingo o feriado corre al siguiente día hábil. El sistema nunca presenta nada a la SAT."
                :actions="puede('fiscal.ver') ? [{ label: 'Feriados', icon: 'i-lucide-flag', color: 'neutral', variant: 'outline', to: '/configuracion/fiscal?pestana=feriados' }] : undefined"
            />

            <ProblemaAlerta
                v-if="problemaVencidas"
                :problema="problemaVencidas"
                :reintentar="cargarVencidas"
                :reintentando="cargandoVencidas"
            />
            <UAlert
                v-else-if="vencidas && vencidas.length"
                color="error"
                variant="subtle"
                icon="i-lucide-alarm-clock-off"
                :title="vencidas.length === 1 ? '1 obligación vencida sin presentar' : `${vencidas.length} obligaciones vencidas sin presentar`"
                data-prueba="calendario-vencidas"
            >
                <template #description>
                    <ul class="mt-1 flex flex-col gap-1">
                        <li
                            v-for="obligacion in vencidas.slice(0, 5)"
                            :key="obligacion.id"
                        >
                            <ULink
                                raw
                                class="text-left text-error underline underline-offset-2 hover:decoration-2"
                                :to="{ query: { ...route.query, obligacion: String(obligacion.id) } }"
                                :data-vencida="obligacion.id"
                            >
                                {{ obligacion.nombre }}, {{ periodoObligacion(obligacion) }}<template v-if="consolidado">
                                    ({{ nombreEmpresa(obligacion.empresa_id) }})
                                </template> · venció el {{ formatearFecha(obligacion.vence_en) }}
                            </ULink>
                        </li>
                    </ul>
                </template>
            </UAlert>

            <div class="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <UTabs
                    v-model="vista"
                    :items="itemsVista"
                    :content="false"
                    size="sm"
                    class="w-full sm:w-56"
                    data-prueba="calendario-vista"
                />
                <div class="grid gap-2 sm:grid-cols-2 lg:flex lg:items-center">
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
                    <UButton
                        v-if="hayFiltros || desde || hasta"
                        label="Quitar filtros"
                        icon="i-lucide-x"
                        color="neutral"
                        variant="ghost"
                        size="sm"
                        class="justify-self-start"
                        @click="limpiarFiltros"
                    />
                </div>
            </div>

            <!-- Vista por mes -->
            <section
                v-if="vista === 'mes'"
                class="flex flex-col gap-3"
                aria-label="Calendario del mes"
            >
                <div class="flex items-center justify-between gap-2">
                    <div class="flex items-center gap-1">
                        <UButton
                            icon="i-lucide-chevron-left"
                            color="neutral"
                            variant="ghost"
                            aria-label="Mes anterior"
                            data-prueba="mes-anterior"
                            @click="irAMes(moverMes(mes, -1))"
                        />
                        <h2
                            class="min-w-36 text-center text-base font-semibold text-highlighted"
                            data-prueba="calendario-titulo-mes"
                        >
                            {{ etiquetaMes(mes) }}
                        </h2>
                        <UButton
                            icon="i-lucide-chevron-right"
                            color="neutral"
                            variant="ghost"
                            aria-label="Mes siguiente"
                            data-prueba="mes-siguiente"
                            @click="irAMes(moverMes(mes, 1))"
                        />
                    </div>
                    <UButton
                        v-if="mes !== mesDe(hoy)"
                        label="Hoy"
                        color="neutral"
                        variant="outline"
                        size="sm"
                        @click="irAMes(mesDe(hoy))"
                    />
                </div>

                <UAlert
                    v-if="problemaFeriados"
                    color="warning"
                    variant="subtle"
                    icon="i-lucide-flag-off"
                    title="No se pudieron leer los feriados"
                    description="El calendario se ve sin marcar los feriados; los vencimientos ya vienen corridos por la API."
                    :actions="[{ label: 'Reintentar', icon: 'i-lucide-rotate-cw', color: 'warning', variant: 'outline', onClick: () => void cargarFeriados(true) }]"
                />

                <ProblemaAlerta
                    v-if="problemaMes"
                    :problema="problemaMes"
                    :reintentar="cargarMes"
                    :reintentando="cargandoMes"
                />
                <USkeleton
                    v-else-if="delMes === null"
                    class="h-96 w-full"
                />
                <div
                    v-else
                    class="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]"
                >
                    <CalendarioFiscalMes
                        :mes="mes"
                        :hoy="hoy"
                        :obligaciones="delMes"
                        :feriados="feriados"
                        :empresa="empresaDe"
                        @elegir="abrirDetalle"
                    />
                    <div
                        class="flex flex-col gap-3"
                        data-prueba="calendario-agenda"
                    >
                        <h3 class="text-sm font-semibold text-highlighted">
                            Vencimientos de {{ etiquetaMes(mes).toLowerCase() }}
                        </h3>
                        <UEmpty
                            v-if="!agenda.length"
                            icon="i-lucide-calendar-check"
                            title="Sin vencimientos en el mes"
                            :description="hayFiltros ? 'Con los filtros elegidos.' : undefined"
                            variant="naked"
                        />
                        <div
                            v-for="grupo in agenda"
                            :key="grupo.fecha"
                            class="flex flex-col gap-1.5"
                        >
                            <span class="text-xs font-medium capitalize text-muted">{{ diaSemana(grupo.fecha) }} {{ formatearFecha(grupo.fecha) }}<template v-if="feriados[grupo.fecha]"> · {{ feriados[grupo.fecha] }}</template></span>
                            <UButton
                                v-for="obligacion in grupo.obligaciones"
                                :key="obligacion.id"
                                color="neutral"
                                variant="outline"
                                block
                                class="items-start justify-start text-left"
                                :class="{ 'border-dashed bg-elevated/50': obligacion.estado === 'no_aplica', 'ring-error/60': obligacion.vencida }"
                                :data-agenda="obligacion.id"
                                @click="abrirDetalle(obligacion)"
                            >
                                <span class="flex min-w-0 flex-1 flex-col gap-1">
                                    <span
                                        class="text-sm font-medium"
                                        :class="obligacion.vencida ? 'text-error' : obligacion.estado === 'no_aplica' ? 'text-muted line-through decoration-1' : 'text-highlighted'"
                                    >{{ obligacion.nombre }}</span>
                                    <span class="text-xs font-normal text-muted">
                                        {{ periodoObligacion(obligacion) }}<template v-if="consolidado"> · {{ nombreEmpresa(obligacion.empresa_id) }}</template><template v-if="obligacion.formulario"> · {{ obligacion.formulario }}</template>
                                    </span>
                                    <span
                                        v-if="obligacion.estado === 'no_aplica'"
                                        class="text-xs font-normal text-muted"
                                        data-prueba="agenda-motivo"
                                    >{{ motivoObligacion(obligacion.motivo_estado) }}</span>
                                    <span class="flex flex-wrap gap-1">
                                        <UBadge
                                            :label="estadoVisible(obligacion).etiqueta"
                                            :icon="estadoVisible(obligacion).icono"
                                            :color="estadoVisible(obligacion).color"
                                            variant="subtle"
                                            size="sm"
                                        />
                                        <UBadge
                                            v-if="textoDiasRestantes(obligacion)"
                                            :label="textoDiasRestantes(obligacion) ?? ''"
                                            :color="colorDiasRestantes(obligacion)"
                                            variant="outline"
                                            size="sm"
                                        />
                                        <UBadge
                                            v-if="!obligacion.formulario"
                                            label="Formulario por confirmar"
                                            icon="i-lucide-user-check"
                                            color="warning"
                                            variant="subtle"
                                            size="sm"
                                        />
                                    </span>
                                </span>
                            </UButton>
                        </div>
                    </div>
                </div>
            </section>

            <!-- Vista en lista -->
            <section
                v-else
                class="flex flex-col gap-3"
                aria-label="Obligaciones"
            >
                <div class="grid grid-cols-2 gap-2 sm:flex sm:items-center">
                    <UInput
                        v-model="desde"
                        type="date"
                        aria-label="Vence desde"
                        class="w-full sm:w-44"
                        data-prueba="filtro-desde"
                    />
                    <UInput
                        v-model="hasta"
                        type="date"
                        aria-label="Vence hasta"
                        class="w-full sm:w-44"
                        data-prueba="filtro-hasta"
                    />
                </div>
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
                        :meta="metaTabla"
                        :loading="lista.cargando.value"
                        data-prueba="tabla-obligaciones"
                        @select="(_evento, fila) => abrirDetalle(fila.original)"
                    >
                        <template #vence_en-cell="{ row }">
                            <div
                                class="flex flex-col"
                                :data-obligacion="row.original.id"
                                :data-estado="row.original.vencida ? 'vencida' : row.original.estado"
                            >
                                <span
                                    class="text-sm tabular-nums"
                                    :class="row.original.vencida ? 'font-semibold text-error' : 'text-highlighted'"
                                >{{ formatearFecha(row.original.vence_en) }}</span>
                                <span
                                    v-if="textoDiasRestantes(row.original)"
                                    class="text-xs"
                                    :class="row.original.vencida ? 'text-error' : 'text-muted'"
                                >{{ textoDiasRestantes(row.original) }}</span>
                            </div>
                        </template>
                        <template #nombre-cell="{ row }">
                            <div class="flex min-w-0 flex-col">
                                <span
                                    class="text-sm font-medium"
                                    :class="row.original.estado === 'no_aplica' ? 'text-muted line-through decoration-1' : 'text-highlighted'"
                                >{{ row.original.nombre }}</span>
                                <span class="text-xs text-muted">{{ periodoObligacion(row.original) }}<template v-if="consolidado"> · {{ nombreEmpresa(row.original.empresa_id) }}</template></span>
                                <span
                                    v-if="row.original.estado === 'no_aplica'"
                                    class="text-xs text-muted"
                                    data-prueba="fila-motivo"
                                >{{ motivoObligacion(row.original.motivo_estado) }}</span>
                                <UBadge
                                    :label="estadoVisible(row.original).etiqueta"
                                    :icon="estadoVisible(row.original).icono"
                                    :color="estadoVisible(row.original).color"
                                    variant="subtle"
                                    size="sm"
                                    class="mt-1 self-start sm:hidden"
                                />
                            </div>
                        </template>
                        <template #estado-cell="{ row }">
                            <UBadge
                                :label="estadoVisible(row.original).etiqueta"
                                :icon="estadoVisible(row.original).icono"
                                :color="estadoVisible(row.original).color"
                                variant="subtle"
                            />
                        </template>
                        <template #formulario-cell="{ row }">
                            <span
                                v-if="row.original.formulario"
                                class="font-mono text-xs"
                            >{{ row.original.formulario }}</span>
                            <UBadge
                                v-else
                                label="Por confirmar con contador"
                                color="warning"
                                variant="subtle"
                                size="sm"
                            />
                        </template>
                        <template #empty>
                            <UEmpty
                                icon="i-lucide-calendar-check"
                                title="Sin obligaciones"
                                :description="hayFiltros || desde || hasta ? 'Ninguna con los filtros elegidos.' : 'El calendario se genera cada hora para todo lo pendiente hasta el periodo en curso.'"
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
            </section>
        </div>

        <USlideover
            v-model:open="viendoDetalle"
            :title="detalle ? detalle.nombre : 'Obligación fiscal'"
            :description="detalle ? `${periodoObligacion(detalle)} · vence el ${formatearFecha(detalle.vence_en)}` : undefined"
        >
            <template #body>
                <ProblemaAlerta
                    v-if="problemaDetalle"
                    :problema="problemaDetalle"
                    :reintentar="cargarDetalle"
                    :reintentando="cargandoDetalle"
                />
                <USkeleton
                    v-else-if="!detalle"
                    class="h-64 w-full"
                />
                <ObligacionFiscalDetalle
                    v-else
                    :obligacion="detalle"
                    :empresa="consolidado ? nombreEmpresa(detalle.empresa_id) : null"
                />
            </template>
        </USlideover>
    </PanelPagina>
</template>
