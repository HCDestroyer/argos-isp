<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import Decimal from 'decimal.js'

/**
 * Fiscal (tablero ContaFiscal; A3 fase 8: `GET /fiscal/tablero`, `GET /fiscal/obligaciones`,
 * `GET /declaraciones` y `GET /fiscal/consejos`, `fiscal.ver`). Arriba cuatro indicadores de la
 * empresa: IVA del mes a hoy, ISR estimado del año, obligaciones vencidas y el límite del pequeño
 * contribuyente. En la tarjeta: Calendario (vencidas, este mes y próximas), Declaraciones,
 * Consejos y el Detalle de cada estimado; al elegir una obligación su detalle se abre a la derecha.
 * Con «Todas» los indicadores van por empresa en «Detalle»: ningún total consolidado. Solo lee: no
 * presenta nada ni cambia el régimen.
 */
definePageMeta({ permiso: 'fiscal.ver' })

useHead({ title: 'Fiscal · ArgosIsp' })

const { puede } = usePermisos()
const { eleccion, empresas, nombre: nombreEmpresa } = useEmpresaActiva()

const tablero = shallowRef<TableroFiscal | null>(null)
const problema = ref<Problem | null>(null)
const cargando = ref(false)

let pedido = 0
async function cargar() {
    const actual = ++pedido
    cargando.value = true
    const resultado = await useTableroFiscal().ver()
    if (actual !== pedido) {
        return
    }
    cargando.value = false
    tablero.value = resultado.ok ? resultado.data : null
    problema.value = resultado.ok ? null : problemaFiscalLegible(resultado.problema)
}

/* Consejos: se leen aparte del tablero (otro endpoint); su error no tapa el tablero. */
const consejos = shallowRef<ConsejosFiscales | null>(null)
const problemaConsejos = ref<Problem | null>(null)
const cargandoConsejos = ref(false)
const verOcultos = ref(false)
const verSinDatos = ref(false)

async function cargarConsejos() {
    cargandoConsejos.value = true
    const resultado = await useConsejosFiscales().listar()
    cargandoConsejos.value = false
    consejos.value = resultado.ok ? resultado.data : null
    problemaConsejos.value = resultado.ok ? null : problemaFiscalLegible(resultado.problema)
}

function consejosDe(empresaId: number) {
    return consejos.value?.empresas.find(e => e.empresa_id === empresaId)?.consejos ?? null
}

/* Calendario: obligaciones vencidas y las de los próximos tres meses. */
const verCalendario = computed(() => puede('declaraciones.ver'))
const obligaciones = shallowRef<ObligacionFiscal[] | null>(null)
const problemaObligaciones = ref<Problem | null>(null)
const hoy = hoyGuatemala()

async function cargarObligaciones() {
    if (!verCalendario.value) {
        return
    }
    const hasta = finDePeriodo(periodosRecientes(sumarMeses(hoy, 3), 1)[0]!)
    const [vencidas, proximas] = await Promise.all([
        useObligacionesFiscales().vencidas(),
        useObligacionesFiscales().delRango(`${hoy.slice(0, 7)}-01`, hasta),
    ])
    if (!vencidas.ok || !proximas.ok) {
        obligaciones.value = null
        problemaObligaciones.value = !vencidas.ok ? vencidas.problema : !proximas.ok ? proximas.problema : null
        return
    }
    problemaObligaciones.value = null
    const vistas = new Set<number>()
    obligaciones.value = [...vencidas.data, ...proximas.data].filter((o) => {
        if (vistas.has(o.id)) {
            return false
        }
        vistas.add(o.id)
        return true
    })
}

function sumarMeses(fecha: string, meses: number): string {
    const d = new Date(`${fecha.slice(0, 7)}-01T00:00:00Z`)
    d.setUTCMonth(d.getUTCMonth() + meses)
    return d.toISOString().slice(0, 10)
}

const filtroImpuesto = ref<'todas' | 'iva' | 'isr' | 'otras'>('todas')
const itemsFiltro = [
    { label: 'Todas', value: 'todas' },
    { label: 'IVA', value: 'iva' },
    { label: 'ISR', value: 'isr' },
    { label: 'ISO y retenciones', value: 'otras' },
]

function pasaFiltro(o: ObligacionFiscal): boolean {
    if (filtroImpuesto.value === 'todas') {
        return true
    }
    if (filtroImpuesto.value === 'iva') {
        return o.impuesto === 'iva_mensual' || o.impuesto === 'pc_mensual'
    }
    if (filtroImpuesto.value === 'isr') {
        return o.impuesto.startsWith('isr')
    }
    return o.impuesto === 'iso_trimestral' || o.impuesto.startsWith('retenciones')
}

const grupos = computed(() => {
    const lista = (obligaciones.value ?? []).filter(pasaFiltro).sort((a, b) => a.vence_en.localeCompare(b.vence_en))
    const mes = hoy.slice(0, 7)
    return [
        { id: 'vencidas', titulo: 'Vencidas', filas: lista.filter(o => o.vencida) },
        { id: 'mes', titulo: 'Este mes', filas: lista.filter(o => !o.vencida && o.vence_en.slice(0, 7) <= mes) },
        { id: 'proximas', titulo: 'Próximas', filas: lista.filter(o => !o.vencida && o.vence_en.slice(0, 7) > mes) },
    ].filter(g => g.filas.length)
})

const elegida = shallowRef<ObligacionFiscal | null>(null)

/* Declaraciones (pestaña): la lista con su estado. */
const declaraciones = usePaginacionCursor(cursor => useDeclaraciones().listar({ limit: 25 }, cursor))

const route = useRoute()
const PESTANAS_FISCAL = ['calendario', 'declaraciones', 'consejos', 'detalle']
const pestana = ref(typeof route.query.tab === 'string' && PESTANAS_FISCAL.includes(route.query.tab) ? route.query.tab : (puede('declaraciones.ver') ? 'calendario' : 'consejos'))
const pestanas = computed<PestanaConta[]>(() => [
    ...(verCalendario.value
        ? [
                { label: 'Calendario', value: 'calendario', icon: 'i-lucide-calendar' },
                { label: 'Declaraciones', value: 'declaraciones', icon: 'i-lucide-file-text' },
            ]
        : []),
    { label: 'Consejos', value: 'consejos', icon: 'i-lucide-sparkles', contador: consejos.value ? consejos.value.empresas.reduce((n, e) => n + e.consejos.filter(c => c.estado === 'aplica' && !c.oculto).length, 0) : null },
    { label: 'Detalle', value: 'detalle', icon: 'i-lucide-layout-dashboard' },
])

watch(pestana, (valor) => {
    if (valor === 'declaraciones' && !declaraciones.filas.value.length) {
        void declaraciones.recargar()
    }
})

/* Indicadores (una empresa). */
const unica = computed(() => (tablero.value?.empresas.length === 1 ? tablero.value.empresas[0]! : null))
const bloques = computed(() => unica.value?.bloques ?? null)
const ivaMes = computed(() => bloques.value?.iva.datos ?? null)
const isrAnual = computed(() => bloques.value?.isr.datos?.anual ?? null)
const pequeno = computed(() => bloques.value?.pequeno_contribuyente.datos ?? null)
const vencidas = computed(() => bloques.value?.vencimientos.datos?.vencidas ?? null)

const descripcion = computed(() => {
    if (eleccion.value === 'todas' && empresas.value.length > 1) {
        return 'Todas las empresas · una sección por empresa, sin totales consolidados'
    }
    const empresa = unica.value
    if (!empresa) {
        return undefined
    }
    const fel = empresa.bloques.fel.datos
    return [nombreEmpresa(empresa.empresa_id), empresa.regimen ? `régimen ${empresa.regimen.replaceAll('_', ' ')}` : null, fel ? `FEL ${fel.modo}` : null].filter(Boolean).join(' · ')
})

function reintentar() {
    void cargar()
    void cargarConsejos()
    void cargarObligaciones()
}

watch(eleccion, reintentar)
onMounted(reintentar)
</script>

<template>
    <PanelPagina
        id="fiscal-tablero"
        titulo="Fiscal"
        icono="i-lucide-landmark"
        :descripcion="descripcion"
    >
        <template #acciones>
            <ContaSelectorEmpresa />
            <UButton
                label="Comparar regímenes"
                icon="i-lucide-git-compare"
                to="/fiscal/comparador"
                color="neutral"
                variant="ghost"
                class="boton-flotante boton-pastilla"
            />
        </template>

        <ContaCuerpo>
            <ProblemaAlerta
                v-if="problema"
                :problema="problema"
                :reintentar="reintentar"
                :reintentando="cargando"
                data-prueba="tablero-problema"
            />

            <!-- Indicadores de la empresa. -->
            <div
                v-else-if="!tablero || unica"
                class="grid grid-cols-2 gap-3 xl:grid-cols-[1fr_1fr_1fr_1.4fr]"
                data-prueba="kpis-fiscal"
            >
                <ContaIndicador
                    clave="iva-mes"
                    titulo="IVA del mes a hoy"
                    icono="i-lucide-receipt"
                    tono="tono-aviso"
                    :valor="!tablero ? null : ivaMes?.totales.a_pagar ? formatearQuetzales(ivaMes.totales.a_pagar) : (bloques?.iva.estado === 'no_aplica' ? 'No aplica' : 'Sin calcular')"
                    :detalle="ivaMes?.totales.debito ? `débito ${formatearQuetzales(ivaMes.totales.debito)} · crédito ${formatearQuetzales(ivaMes.totales.credito ?? '0')}` : (bloques?.iva.motivo ?? undefined)"
                />
                <ContaIndicador
                    clave="isr-estimado"
                    icono="i-lucide-calculator"
                    tono="tono-marca"
                    :valor="!tablero ? null : isrAnual ? formatearQuetzales(isrAnual.isr_proyectado) : (bloques?.isr.estado === 'no_aplica' ? 'No aplica' : 'Sin datos')"
                    :detalle="isrAnual ? `proyectado con ${isrAnual.meses_transcurridos} meses` : (bloques?.isr.motivo ?? undefined)"
                />
                <ContaIndicador
                    clave="obligaciones-vencidas"
                    icono="i-lucide-triangle-alert"
                    :tono="vencidas ? 'tono-error' : 'tono-exito'"
                    :valor="!tablero ? null : vencidas === null ? 'Sin datos' : String(vencidas)"
                    :estado="vencidas === null ? undefined : vencidas ? 'urgente' : 'bien'"
                    :etiqueta-estado="vencidas === null ? undefined : vencidas ? 'Sin presentar' : 'Al día'"
                    :detalle="vencidas ? 'obligaciones con fecha límite pasada' : undefined"
                />
                <div
                    class="surface-card col-span-2 flex min-w-0 flex-col gap-2 rounded-2xl p-4 xl:col-span-1"
                    data-prueba="kpi-pequeno"
                >
                    <div class="flex items-center gap-2 border-b border-(--ax-borde) pb-2.5">
                        <span class="pastilla-icono pastilla-tono tono-aviso size-7 shrink-0 rounded-lg">
                            <UIcon
                                name="i-lucide-gauge"
                                class="size-4"
                            />
                        </span>
                        <span class="min-w-0 flex-1 truncate text-[0.8125rem] font-medium">Pequeño contribuyente</span>
                        <UBadge
                            v-if="pequeno"
                            :label="`${Math.round(Number(pequeno.porcentaje))} % del límite`"
                            :color="pequeno.supera_limite ? 'error' : pequeno.umbral_alcanzado ? 'warning' : 'neutral'"
                            variant="soft"
                            size="sm"
                        />
                    </div>
                    <USkeleton
                        v-if="!tablero"
                        class="h-8 w-40"
                    />
                    <template v-else-if="pequeno">
                        <span class="flex flex-wrap items-baseline gap-2">
                            <span class="text-[1.625rem] leading-tight font-bold text-highlighted tabular-nums">{{ formatearQuetzales(pequeno.acumulado) }}</span>
                            <span class="text-xs text-muted">de {{ formatearQuetzales(pequeno.limite) }} al año · quedan {{ formatearQuetzales(pequeno.disponible) }}</span>
                        </span>
                        <UProgress
                            :model-value="Math.min(Number(pequeno.porcentaje), 100)"
                            :color="pequeno.supera_limite ? 'error' : pequeno.umbral_alcanzado ? 'warning' : 'primary'"
                            size="sm"
                            :aria-label="`Facturado del año: ${pequeno.porcentaje} % del límite`"
                        />
                        <span
                            v-if="pequeno.mensaje"
                            class="text-xs text-error"
                        >{{ pequeno.mensaje }}</span>
                    </template>
                    <span
                        v-else
                        class="text-sm text-muted"
                    >{{ bloques?.pequeno_contribuyente.motivo ?? 'No aplica a este régimen' }}</span>
                </div>
            </div>

            <div class="grid min-h-0 flex-1 gap-4">
                <ContaIsla
                    llenar
                    ancho-lateral="lg:w-[30rem]"
                >
                    <template #cabecera>
                        <ContaPestanas
                            v-model="pestana"
                            :items="pestanas"
                            etiqueta="Vistas de lo fiscal"
                        />
                    </template>
                    <template
                        v-if="pestana === 'calendario'"
                        #herramientas
                    >
                        <USelect
                            v-model="filtroImpuesto"
                            :items="itemsFiltro"
                            icon="i-lucide-filter"
                            aria-label="Impuesto"
                            class="w-44"
                            :ui="{ base: 'rounded-full' }"
                        />
                    </template>

                    <!-- Calendario. -->
                    <template v-if="pestana === 'calendario'">
                        <div
                            v-if="problemaObligaciones"
                            class="p-4"
                        >
                            <ProblemaAlerta
                                :problema="problemaObligaciones"
                                :reintentar="cargarObligaciones"
                            />
                        </div>
                        <USkeleton
                            v-else-if="!obligaciones"
                            class="m-4 h-48"
                        />
                        <UEmpty
                            v-else-if="!grupos.length"
                            icon="i-lucide-calendar-check"
                            title="Nada vence en los próximos tres meses"
                            variant="naked"
                        />
                        <div
                            v-for="grupo in grupos"
                            v-else
                            :key="grupo.id"
                            :data-grupo="grupo.id"
                        >
                            <h3 class="border-b border-(--ax-borde) bg-(--ax-panel) px-4 py-2 text-xs font-bold tracking-[0.06em] text-muted uppercase">
                                {{ grupo.titulo }} · {{ grupo.filas.length }}
                            </h3>
                            <UButton
                                v-for="o in grupo.filas"
                                :key="o.id"
                                color="neutral"
                                variant="ghost"
                                class="w-full rounded-none border-b border-(--ax-borde) px-4 py-3 text-start"
                                :class="elegida?.id === o.id ? 'bg-primary/8 shadow-[inset_3px_0_0_var(--ui-primary)]' : ''"
                                :data-obligacion="o.id"
                                @click="elegida = o"
                            >
                                <span
                                    class="pastilla-icono pastilla-tono size-8 shrink-0 rounded-full"
                                    :class="o.vencida ? 'tono-error' : o.estado === 'presentada' ? 'tono-exito' : 'tono-marca'"
                                >
                                    <UIcon
                                        :name="estadoVisible(o).icono"
                                        class="size-4"
                                    />
                                </span>
                                <span class="flex min-w-0 flex-1 flex-col">
                                    <span class="truncate text-sm font-semibold text-highlighted">{{ o.nombre }}</span>
                                    <span class="truncate text-xs font-normal text-muted">
                                        {{ [o.formulario, `vence el ${formatearFecha(o.vence_en)}`].filter(Boolean).join(' · ') }}
                                        <span
                                            v-if="textoDiasRestantes(o)"
                                            :class="o.vencida ? 'text-error' : o.dias_restantes <= 10 ? 'text-warning' : ''"
                                        > · {{ textoDiasRestantes(o) }}</span>
                                    </span>
                                </span>
                                <UBadge
                                    :label="estadoVisible(o).etiqueta"
                                    :color="estadoVisible(o).color"
                                    :icon="estadoVisible(o).icono"
                                    variant="soft"
                                    class="shrink-0"
                                />
                            </UButton>
                        </div>
                    </template>

                    <!-- Declaraciones. -->
                    <template v-else-if="pestana === 'declaraciones'">
                        <div
                            v-if="declaraciones.problema.value"
                            class="p-4"
                        >
                            <ProblemaAlerta
                                :problema="declaraciones.problema.value"
                                :reintentar="declaraciones.recargar"
                            />
                        </div>
                        <UEmpty
                            v-else-if="!declaraciones.cargando.value && !declaraciones.filas.value.length"
                            icon="i-lucide-file-text"
                            title="Todavía no hay declaraciones"
                            description="Se calculan desde el calendario o desde Declaraciones."
                            variant="naked"
                        />
                        <ul
                            v-else
                            class="divide-y divide-(--ax-borde)"
                        >
                            <li
                                v-for="d in declaraciones.filas.value"
                                :key="d.id"
                            >
                                <ULink
                                    :to="`/declaraciones/${d.id}`"
                                    class="flex items-center gap-3 px-4 py-3 hover:bg-(--ax-fila-hover)"
                                >
                                    <span class="pastilla-icono pastilla-tono tono-marca size-8 shrink-0 rounded-lg">
                                        <UIcon
                                            name="i-lucide-file-text"
                                            class="size-4"
                                        />
                                    </span>
                                    <span class="flex min-w-0 flex-1 flex-col">
                                        <span class="truncate text-sm font-semibold text-highlighted">{{ IMPUESTOS_DECLARABLES[d.impuesto as ImpuestoDeclarable]?.etiqueta ?? d.impuesto }} · {{ etiquetaPeriodoDeclaracion(d) }}</span>
                                        <span class="truncate text-xs text-muted">Versión {{ d.version }}<template v-if="d.vence_en"> · vence el {{ formatearFecha(d.vence_en) }}</template></span>
                                    </span>
                                    <span class="text-sm font-semibold tabular-nums">{{ d.totales.a_pagar ? formatearQuetzales(new Decimal(d.totales.a_pagar)) : '—' }}</span>
                                    <UBadge
                                        :label="ESTADOS_DECLARACION[d.estado].etiqueta"
                                        :color="ESTADOS_DECLARACION[d.estado].color"
                                        :icon="ESTADOS_DECLARACION[d.estado].icono"
                                        variant="soft"
                                    />
                                </ULink>
                            </li>
                        </ul>
                        <div class="px-3 pb-3">
                            <PaginacionCursor
                                :pagina="declaraciones.pagina.value"
                                :hay-anterior="declaraciones.hayAnterior.value"
                                :hay-siguiente="declaraciones.haySiguiente.value"
                                :cargando="declaraciones.cargando.value"
                                :filas="declaraciones.filas.value.length"
                                @anterior="declaraciones.anterior"
                                @siguiente="declaraciones.siguiente"
                            />
                        </div>
                    </template>

                    <!-- Consejos. -->
                    <div
                        v-else-if="pestana === 'consejos'"
                        class="flex flex-col gap-4 p-3 sm:p-4"
                    >
                        <ProblemaAlerta
                            v-if="problemaConsejos"
                            :problema="problemaConsejos"
                            :reintentar="cargarConsejos"
                            :reintentando="cargandoConsejos"
                            data-prueba="consejos-problema"
                        />
                        <template v-else-if="consejos && tablero">
                            <ConsejosFiscalesEmpresa
                                v-for="empresa in tablero.empresas"
                                :key="empresa.empresa_id"
                                v-model:ver-ocultos="verOcultos"
                                v-model:ver-sin-datos="verSinDatos"
                                :consejos="consejosDe(empresa.empresa_id) ?? []"
                                :empresa-id="empresa.empresa_id"
                                :aviso="consejos.aviso"
                                :recargar="cargarConsejos"
                                :recargando="cargandoConsejos"
                            />
                        </template>
                        <USkeleton
                            v-else
                            class="h-40 w-full"
                        />
                    </div>

                    <!-- Detalle de cada estimado, por empresa. -->
                    <div
                        v-else
                        class="flex flex-col gap-6 p-3 sm:p-4"
                    >
                        <USkeleton
                            v-if="!tablero"
                            class="h-60 w-full"
                        />
                        <template
                            v-for="(empresa, indice) in tablero?.empresas ?? []"
                            v-else
                            :key="empresa.empresa_id"
                        >
                            <USeparator v-if="indice > 0" />
                            <TableroFiscalEmpresa
                                :empresa="empresa"
                                :nombre="nombreEmpresa(empresa.empresa_id)"
                                :reintentar="reintentar"
                                :reintentando="cargando"
                            />
                        </template>
                    </div>

                    <template
                        v-if="pestana === 'calendario' && elegida"
                        #lateral
                    >
                        <div class="flex items-start justify-between gap-2 border-b border-(--ax-borde) p-4">
                            <div class="min-w-0">
                                <h2 class="text-lg font-bold text-highlighted">
                                    {{ elegida.nombre }}
                                </h2>
                                <p class="text-xs text-muted">
                                    {{ [elegida.formulario ? `Formulario ${elegida.formulario}` : null, `vence el ${formatearFecha(elegida.vence_en)}`].filter(Boolean).join(' · ') }}
                                </p>
                            </div>
                            <UButton
                                icon="i-lucide-x"
                                color="neutral"
                                variant="ghost"
                                size="sm"
                                aria-label="Cerrar el detalle"
                                @click="elegida = null"
                            />
                        </div>
                        <div class="p-4">
                            <ObligacionFiscalDetalle
                                :obligacion="elegida"
                                :empresa="empresas.length > 1 ? nombreEmpresa(elegida.empresa_id) : null"
                            />
                        </div>
                    </template>

                    <template #pie>
                        Los plazos cuentan días hábiles y feriados. Argos calcula borradores; la presentación la haces tú en la Agencia Virtual.
                    </template>
                </ContaIsla>
            </div>
        </ContaCuerpo>
    </PanelPagina>
</template>
