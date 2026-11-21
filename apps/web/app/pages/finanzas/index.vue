<script setup lang="ts">
import type { Problem, Schema } from '@argosisp/contracts'
import Decimal from 'decimal.js'

definePageMeta({ permiso: 'reportes.ver' })

useHead({ title: 'Panel financiero · ArgosIsp' })

/**
 * Panel financiero del dueño (tableros ContaPanel, ContaPanelMovil y ContaPanelMovil2; decisiones
 * 2, 3, 4, 9 y 12 del PM). Junta lo que la API ya da:
 * - cobrado contra facturado, cartera vencida y la serie de 12 meses (`GET /dashboard/resumen`);
 * - la antigüedad de lo vencido (`GET /reportes/cartera-vencida`);
 * - impuestos por pagar y el límite del pequeño contribuyente (`GET /fiscal/tablero`);
 * - efectivo en cajas y bancos (cuentas 1.1.01 y 1.1.02 del balance, `GET /libro/balance`);
 * - integridad de la cadena y el último mes cerrado (`GET /libro/integridad`, `/libro/periodos`).
 * Lo que la API del panel financiero aún no da (ingreso recurrente con IVA, bajas a 60 días, ingreso
 * por servicio, efectivo por semana y la comparación por empresa) se dice sin cifra inventada; lo
 * construye A3 en `agente/a3-reportes-pm` (`.claude/integration/a4.md`).
 * En el teléfono solo se consulta (decisión 9): cerrar, declarar o castigar es de la computadora.
 */
type Resumen = Schema<'ResumenDashboard'>
type Tablero = Schema<'TableroFiscal'>
type Cartera = Schema<'ReporteCarteraVencida'>

const { puede } = usePermisos()
const { eleccion, empresas } = useEmpresaActiva()

const verLibro = computed(() => puede('libro.ver'))
const verFiscal = computed(() => puede('fiscal.ver'))

const resumen = shallowRef<Resumen | null>(null)
const problemaResumen = ref<Problem | null>(null)
const cartera = shallowRef<Cartera | null>(null)
const problemaCartera = ref<Problem | null>(null)
const tablero = shallowRef<Tablero | null>(null)
const problemaTablero = ref<Problem | null>(null)
const efectivo = shallowRef<{ total: string, bancos: number, cajas: number } | null>(null)
const problemaEfectivo = ref<Problem | null>(null)
const integridad = shallowRef<Schema<'IntegridadLibro'>[] | null>(null)
const cierres = shallowRef<Schema<'CierrePeriodo'>[] | null>(null)

const hoy = hoyGuatemala()

async function cargarResumen() {
    problemaResumen.value = null
    const r = await useReportes().resumenDashboard()
    resumen.value = r.ok ? r.data : null
    problemaResumen.value = r.ok ? null : r.problema
}

async function cargarCartera() {
    problemaCartera.value = null
    const r = await useReportes().reporte('cartera-vencida', { corte: hoy })
    cartera.value = r.ok ? r.data : null
    problemaCartera.value = r.ok ? null : r.problema
}

async function cargarTablero() {
    if (!verFiscal.value) {
        return
    }
    problemaTablero.value = null
    const r = await useTableroFiscal().ver()
    tablero.value = r.ok ? r.data : null
    problemaTablero.value = r.ok ? null : r.problema
}

async function cargarEfectivo() {
    if (!verLibro.value) {
        return
    }
    problemaEfectivo.value = null
    const r = await useLibro().balance(hoy)
    if (!r.ok) {
        efectivo.value = null
        problemaEfectivo.value = r.problema
        return
    }
    let total = new Decimal(0)
    let bancos = 0
    let cajas = 0
    for (const empresa of r.data.empresas) {
        for (const cuenta of empresa.cuentas) {
            if (cuenta.codigo.startsWith('1.1.01.')) {
                cajas += 1
                total = total.plus(cuenta.saldo)
            }
            else if (cuenta.codigo.startsWith('1.1.02.')) {
                bancos += 1
                total = total.plus(cuenta.saldo)
            }
        }
    }
    efectivo.value = { total: total.toFixed(2), bancos, cajas }
}

async function cargarLibro() {
    if (!verLibro.value) {
        return
    }
    const [rIntegridad, rCierres] = await Promise.all([useLibro().integridad(), useLibro().periodos()])
    integridad.value = rIntegridad.ok ? rIntegridad.data : null
    cierres.value = rCierres.ok ? rCierres.data.data : null
}

function cargar() {
    void cargarResumen()
    void cargarCartera()
    void cargarTablero()
    void cargarEfectivo()
    void cargarLibro()
}

onMounted(cargar)

/* Encabezado: qué se ve y desde cuándo. */
const descripcion = computed(() => {
    const quien = eleccion.value === 'todas'
        ? `Consolidado de ${empresas.value.length} empresas`
        : empresas.value.find(e => e.id === eleccion.value)?.nombre_comercial ?? 'Empresa activa'
    const refresco = resumen.value?.actualizado_en.resumen_cobros_diarios
    return [quien, refresco ? `cifras al ${formatearFechaHora(refresco)}` : null, 'se actualiza con cada cobro'].filter(Boolean).join(' · ')
})

/* Avisos de arriba: el libro, el último mes por cerrar, el próximo impuesto y el pequeño contribuyente. */
interface AvisoPanel {
    id: string
    titulo: string
    detalle: string
    icono: string
    tono: 'exito' | 'aviso' | 'error'
    accion?: { etiqueta: string, to: string }
}

const mesAnterior = computed(() => periodosRecientes(hoy, 2)[1]!.slice(0, 7))

const avisos = computed<AvisoPanel[]>(() => {
    const lista: AvisoPanel[] = []
    if (integridad.value?.length) {
        const rota = integridad.value.find(i => !i.verificado)
        const ultimo = Math.max(...integridad.value.map(i => i.ultimo_sello ?? 0))
        lista.push(rota
            ? { id: 'integridad', titulo: 'Cadena del libro rota', detalle: `Sello ${rota.ruptura?.sello ?? '—'}: revisa la integridad`, icono: 'i-lucide-shield-alert', tono: 'error', accion: { etiqueta: 'Revisar', to: '/libro/integridad' } }
            : { id: 'integridad', titulo: 'Libro íntegro', detalle: `Cadena verificada hasta el sello ${ultimo.toLocaleString('es-GT')}`, icono: 'i-lucide-shield-check', tono: 'exito' })
    }
    if (cierres.value) {
        const cerrado = cierres.value.some(c => c.periodo === mesAnterior.value && c.estado === 'cerrado')
        if (!cerrado) {
            lista.push({ id: 'cierre', titulo: `${capitalizar(etiquetaPeriodo(mesAnterior.value).split(' ')[0]!)} sin cerrar`, detalle: 'Revisa sus verificaciones y ciérralo', icono: 'i-lucide-lock-open', tono: 'aviso', accion: puede('libro.cerrar_periodo') ? { etiqueta: 'Cerrar mes', to: '/libro/cierres' } : undefined })
        }
    }
    const proxima = impuestos.value.find(i => !i.vencida)
    if (proxima) {
        lista.push({ id: 'impuesto', titulo: `${proxima.nombre} vence en ${proxima.dias_restantes} días`, detalle: `${proxima.a_pagar ? formatearQuetzales(proxima.a_pagar) : 'sin calcular'} · ${ESTADO_OBLIGACION[proxima.estado] ?? proxima.estado}`, icono: 'i-lucide-clock', tono: 'aviso', accion: { etiqueta: 'Abrir', to: proxima.declaracion_id ? `/declaraciones/${proxima.declaracion_id}` : '/fiscal/tablero' } })
    }
    for (const pc of pequenos.value) {
        lista.push({ id: `pc-${pc.empresaId}`, titulo: `Pequeño contribuyente al ${Math.round(Number(pc.porcentaje))} %`, detalle: `${pc.nombre} · quedan ${formatearQuetzales(pc.disponible)} del límite`, icono: 'i-lucide-gauge', tono: pc.supera ? 'error' : 'aviso', accion: { etiqueta: 'Ver', to: '/fiscal/tablero' } })
    }
    return lista
})

function capitalizar(texto: string): string {
    return texto.charAt(0).toUpperCase() + texto.slice(1)
}

const ESTADO_OBLIGACION: Record<string, string> = {
    pendiente: 'sin calcular',
    borrador: 'en borrador',
    presentada: 'presentada',
    no_aplica: 'no aplica',
}

/* Impuestos por pagar: los vencimientos de los próximos 30 días de cada empresa (tablero fiscal). */
type Obligacion = NonNullable<Schema<'BloqueVencimientos'>['datos']>['obligaciones'][number] & { empresaId: number }

const impuestos = computed<Obligacion[]>(() => (tablero.value?.empresas ?? [])
    .flatMap(e => (e.bloques.vencimientos.datos?.obligaciones ?? []).map(o => ({ ...o, empresaId: e.empresa_id })))
    .filter(o => o.estado !== 'no_aplica' && !(o.pagado && o.estado === 'presentada'))
    .sort((a, b) => a.vence_en.localeCompare(b.vence_en)))

/** Suma de lo calculado; sin ningún borrador calculado no hay total (nunca un Q 0.00 inventado). */
const totalImpuestos = computed(() => (impuestos.value.some(o => o.a_pagar)
    ? impuestos.value.reduce((suma, o) => suma.plus(o.a_pagar ?? 0), new Decimal(0)).toFixed(2)
    : null))

/** Decisión 12 del PM: el aviso aparece al 80 % y al 95 % del límite (umbrales del parámetro). */
const pequenos = computed(() => (tablero.value?.empresas ?? []).flatMap((e) => {
    const datos = e.bloques.pequeno_contribuyente.datos
    if (!datos || (!datos.umbral_alcanzado && !datos.supera_limite)) {
        return []
    }
    return [{
        empresaId: e.empresa_id,
        nombre: empresas.value.find(x => x.id === e.empresa_id)?.nombre_comercial ?? `Empresa ${e.empresa_id}`,
        porcentaje: datos.porcentaje,
        disponible: datos.disponible,
        supera: datos.supera_limite,
    }]
}))

/* Indicadores. */
const cobranza = computed(() => resumen.value?.mes ?? null)
const faltaCobrar = computed(() => (cobranza.value ? Decimal.max(new Decimal(cobranza.value.facturado).minus(cobranza.value.cobrado), 0).toFixed(2) : null))
const nombreMes = computed(() => (cobranza.value ? etiquetaPeriodo(cobranza.value.periodo).split(' ')[0]! : ''))

const series = computed(() => (resumen.value ? seriesDashboard(resumen.value) : null))
const hallazgoSerie = computed(() => (cobranza.value && faltaCobrar.value
    ? `En ${nombreMes.value} va cobrado el ${Math.floor(cobranza.value.cobranza_pct)} % de lo facturado; faltan ${formatearQuetzales(faltaCobrar.value)}`
    : undefined))

const totalesCartera = computed(() => cartera.value?.totales ?? null)
const tramos = computed(() => (totalesCartera.value ? tramosCartera(totalesCartera.value) : []))
const masDe60 = computed(() => (totalesCartera.value ? new Decimal(totalesCartera.value.dias_61_90).plus(totalesCartera.value.dias_mas_90).toFixed(2) : null))

/* Teléfono: por pantallas (Resumen, Empresas, Reportes; tablero ContaPanelMovil2). */
const vistaMovil = ref('resumen')
const pestanasMovil: PestanaConta[] = [
    { label: 'Resumen', value: 'resumen' },
    { label: 'Empresas', value: 'empresas' },
    { label: 'Reportes', value: 'reportes' },
]

const REPORTES_MOVIL = ['cartera-vencida', 'facturado-vs-cobrado', 'cobranza-diaria', 'ingresos'] as const

const TONO_AVISO = {
    exito: 'border-success/30 bg-success/8 text-success',
    aviso: 'border-warning/40 bg-warning/8 text-warning',
    error: 'border-error/30 bg-error/8 text-error',
} as const
</script>

<template>
    <PanelPagina
        id="panel-financiero"
        titulo="Panel financiero"
        icono="i-lucide-layout-dashboard"
        :descripcion="descripcion"
    >
        <template #acciones>
            <ContaSelectorEmpresa />
            <UButton
                label="Actualizar"
                icon="i-lucide-refresh-cw"
                color="neutral"
                variant="ghost"
                class="boton-flotante boton-pastilla"
                data-prueba="actualizar-panel"
                @click="cargar"
            />
        </template>

        <ContaCuerpo libre>
            <div class="lg:hidden">
                <ContaPestanas
                    v-model="vistaMovil"
                    :items="pestanasMovil"
                    etiqueta="Vistas del panel"
                />
            </div>

            <!-- Avisos: lo que pide atención hoy (en el teléfono, en fila que se desliza). -->
            <div
                v-if="avisos.length"
                class="flex snap-x gap-3 overflow-x-auto pb-1 lg:grid lg:grid-cols-4 lg:overflow-visible"
                :class="vistaMovil === 'resumen' ? '' : 'max-lg:hidden'"
                data-prueba="avisos-panel"
            >
                <div
                    v-for="aviso in avisos"
                    :key="aviso.id"
                    class="flex min-w-64 shrink-0 snap-start items-center gap-3 rounded-2xl border px-4 py-2.5 lg:min-w-0"
                    :class="TONO_AVISO[aviso.tono]"
                    :data-aviso="aviso.id"
                >
                    <UIcon
                        :name="aviso.icono"
                        class="size-5 shrink-0"
                    />
                    <div class="flex min-w-0 flex-1 flex-col">
                        <span class="truncate text-sm font-semibold">{{ aviso.titulo }}</span>
                        <span class="truncate text-xs text-muted">{{ aviso.detalle }}</span>
                    </div>
                    <UButton
                        v-if="aviso.accion"
                        :label="aviso.accion.etiqueta"
                        :to="aviso.accion.to"
                        color="primary"
                        variant="link"
                        size="sm"
                        class="shrink-0 px-0"
                    />
                </div>
            </div>

            <!-- Indicadores. -->
            <div
                class="grid grid-cols-2 gap-3 lg:grid-cols-3 2xl:grid-cols-6"
                :class="vistaMovil === 'resumen' ? '' : 'max-lg:hidden'"
                data-prueba="kpis-panel"
            >
                <ContaKpi
                    titulo="Ingreso recurrente"
                    icono="i-lucide-trending-up"
                    :valor="null"
                    sin-api="Con IVA, de activos y limitados: llega con la API del panel financiero."
                    ayuda="Lo que se factura cada mes por los servicios activos y limitados, con IVA, menos descuentos y precios temporales (MRR)."
                    class="max-lg:order-3"
                />
                <ContaKpi
                    :titulo="`Cobrado en ${nombreMes || 'el mes'}`"
                    icono="i-lucide-banknote"
                    tono="tono-exito"
                    :valor="cobranza ? formatearQuetzales(cobranza.cobrado) : null"
                    :variacion="cobranza ? `${Math.floor(cobranza.cobranza_pct)} %` : undefined"
                    :detalle="cobranza ? `de ${formatearQuetzales(cobranza.facturado)}` : undefined"
                    :problema="problemaResumen"
                    class="max-lg:order-1"
                    @reintentar="cargarResumen"
                />
                <ContaKpi
                    titulo="Cartera vencida"
                    icono="i-lucide-triangle-alert"
                    tono="tono-error"
                    :valor="resumen ? formatearQuetzales(resumen.cartera_vencida.monto) : null"
                    :detalle="resumen ? `${resumen.cartera_vencida.facturas.toLocaleString('es-GT')} facturas de ${resumen.cartera_vencida.clientes.toLocaleString('es-GT')} clientes` : undefined"
                    :problema="problemaResumen"
                    class="max-lg:hidden"
                    @reintentar="cargarResumen"
                />
                <ContaKpi
                    v-if="verLibro"
                    titulo="Efectivo disponible"
                    icono="i-lucide-landmark"
                    tono="tono-2"
                    :valor="efectivo ? formatearQuetzales(efectivo.total) : null"
                    :detalle="efectivo ? `en ${efectivo.bancos} ${efectivo.bancos === 1 ? 'banco' : 'bancos'} y ${efectivo.cajas} ${efectivo.cajas === 1 ? 'caja' : 'cajas'}` : undefined"
                    :problema="problemaEfectivo"
                    ayuda="Saldo de las cuentas de caja (1.1.01) y bancos (1.1.02) del libro, hoy."
                    class="max-lg:order-2"
                    @reintentar="cargarEfectivo"
                />
                <ContaKpi
                    titulo="Bajas del mes"
                    icono="i-lucide-users"
                    tono="tono-3"
                    :valor="null"
                    sin-api="Retirados o suspendidos más de 60 días: llega con la API del panel financiero."
                    ayuda="Un servicio cuenta como baja si se retiró o lleva más de 60 días suspendido; si se reactiva, deja de contar (churn)."
                    class="max-lg:hidden"
                />
                <ContaKpi
                    titulo="Por servicio"
                    icono="i-lucide-pie-chart"
                    tono="tono-4"
                    :valor="null"
                    sin-api="Ingreso promedio por servicio: llega con la API del panel financiero."
                    ayuda="Ingreso recurrente entre los servicios que facturan (ARPU)."
                    class="max-lg:hidden"
                />
                <ContaKpi
                    v-if="verFiscal"
                    titulo="Impuestos por pagar"
                    icono="i-lucide-receipt"
                    tono="tono-aviso"
                    :valor="tablero ? (totalImpuestos ? formatearQuetzales(totalImpuestos) : 'Sin calcular') : null"
                    :detalle="impuestos[0] ? `${impuestos[0].nombre} en ${impuestos[0].dias_restantes} días` : undefined"
                    :problema="problemaTablero"
                    class="order-4 lg:hidden"
                    @reintentar="cargarTablero"
                />
            </div>

            <!-- Gráfica, antigüedad e impuestos. -->
            <div
                class="grid gap-4 xl:grid-cols-[1.25fr_1fr_1fr]"
                :class="vistaMovil === 'resumen' ? '' : 'max-lg:hidden'"
            >
                <section
                    class="surface-card flex min-w-0 flex-col gap-2 rounded-[1.375rem] p-4 sm:p-5"
                    aria-labelledby="titulo-cobranza"
                    data-prueba="grafica-cobranza"
                >
                    <h2
                        id="titulo-cobranza"
                        class="text-base font-semibold text-highlighted"
                    >
                        {{ hallazgoSerie ?? 'Facturado y cobrado por mes' }}
                    </h2>
                    <p class="text-xs text-muted">
                        Facturado y cobrado por mes de factura · últimos 12 meses
                    </p>
                    <ProblemaAlerta
                        v-if="problemaResumen"
                        :problema="problemaResumen"
                        :reintentar="cargarResumen"
                    />
                    <USkeleton
                        v-else-if="!series"
                        class="h-60 w-full"
                    />
                    <GraficaColumnas
                        v-else
                        titulo="Facturado y cobrado por mes"
                        :categorias="series.categorias"
                        :categorias-largas="series.categoriasLargas"
                        :series="series.montos"
                        :alto="220"
                    />
                </section>

                <section
                    class="surface-card flex min-w-0 flex-col gap-3 rounded-[1.375rem] p-4 sm:p-5"
                    aria-labelledby="titulo-vencido"
                    data-prueba="cartera-panel"
                >
                    <div class="flex items-start justify-between gap-2">
                        <div class="min-w-0">
                            <h2
                                id="titulo-vencido"
                                class="text-base font-semibold text-highlighted"
                            >
                                <template v-if="totalesCartera && masDe60">
                                    {{ formatearQuetzales(totalesCartera.vencido) }} vencidos; lo de más de 60 días es {{ formatearQuetzales(masDe60) }}
                                </template>
                                <template v-else>
                                    Cartera por antigüedad
                                </template>
                            </h2>
                            <p
                                v-if="totalesCartera"
                                class="text-xs text-muted"
                            >
                                Lo que deben por antigüedad · {{ totalesCartera.facturas.toLocaleString('es-GT') }} facturas
                            </p>
                        </div>
                        <UButton
                            label="Ver cartera"
                            trailing-icon="i-lucide-chevron-right"
                            to="/cartera"
                            color="primary"
                            variant="link"
                            size="sm"
                            class="shrink-0 px-0"
                        />
                    </div>
                    <ProblemaAlerta
                        v-if="problemaCartera"
                        :problema="problemaCartera"
                        :reintentar="cargarCartera"
                    />
                    <USkeleton
                        v-else-if="!totalesCartera"
                        class="h-48 w-full"
                    />
                    <ContaAntiguedad
                        v-else
                        :tramos="tramos"
                        etiqueta="Saldo por antigüedad"
                    />
                </section>

                <section
                    v-if="verFiscal"
                    class="surface-card flex min-w-0 flex-col gap-3 rounded-[1.375rem] p-4 sm:p-5"
                    aria-labelledby="titulo-impuestos"
                    data-prueba="impuestos-panel"
                >
                    <div>
                        <h2
                            id="titulo-impuestos"
                            class="text-base font-semibold text-highlighted"
                        >
                            Impuestos por pagar<template v-if="totalImpuestos">
                                : {{ formatearQuetzales(totalImpuestos) }}
                            </template>
                        </h2>
                        <p class="text-xs text-muted">
                            Borradores calculados; Argos no presenta nada a la SAT
                        </p>
                    </div>
                    <ProblemaAlerta
                        v-if="problemaTablero"
                        :problema="problemaTablero"
                        :reintentar="cargarTablero"
                    />
                    <USkeleton
                        v-else-if="!tablero"
                        class="h-48 w-full"
                    />
                    <UEmpty
                        v-else-if="!impuestos.length"
                        icon="i-lucide-calendar-check"
                        title="Nada vence en los próximos 30 días"
                        variant="naked"
                    />
                    <ul
                        v-else
                        class="flex flex-col divide-y divide-(--ax-borde)"
                    >
                        <li
                            v-for="impuesto in impuestos.slice(0, 5)"
                            :key="`${impuesto.empresaId}-${impuesto.obligacion_id}`"
                            class="flex items-center gap-3 py-2.5"
                        >
                            <span
                                class="pastilla-icono pastilla-tono size-8 shrink-0 rounded-full"
                                :class="impuesto.vencida ? 'tono-error' : impuesto.dias_restantes <= 10 ? 'tono-aviso' : 'tono-marca'"
                            >
                                <UIcon
                                    :name="impuesto.vencida ? 'i-lucide-triangle-alert' : impuesto.dias_restantes <= 10 ? 'i-lucide-clock' : 'i-lucide-calendar'"
                                    class="size-4"
                                />
                            </span>
                            <div class="flex min-w-0 flex-1 flex-col">
                                <span class="truncate text-sm font-semibold text-highlighted">{{ impuesto.nombre }}</span>
                                <span class="truncate text-xs text-muted">{{ [impuesto.formulario, ESTADO_OBLIGACION[impuesto.estado]].filter(Boolean).join(' · ') }}</span>
                            </div>
                            <div class="flex shrink-0 flex-col items-end">
                                <span class="text-sm font-semibold text-highlighted tabular-nums">{{ impuesto.a_pagar ? formatearQuetzales(impuesto.a_pagar) : '—' }}</span>
                                <span
                                    class="text-xs"
                                    :class="impuesto.vencida ? 'text-error' : impuesto.dias_restantes <= 10 ? 'text-warning' : 'text-muted'"
                                >{{ impuesto.vencida ? `venció ${formatearFecha(impuesto.vence_en)}` : `vence ${formatearFecha(impuesto.vence_en)} · ${impuesto.dias_restantes} días` }}</span>
                            </div>
                        </li>
                    </ul>
                    <div class="mt-auto flex justify-end border-t border-(--ax-borde) pt-2">
                        <UButton
                            label="Calendario fiscal"
                            trailing-icon="i-lucide-chevron-right"
                            to="/fiscal/calendario"
                            color="primary"
                            variant="link"
                            size="sm"
                            class="px-0"
                        />
                    </div>
                </section>
            </div>

            <!-- Efectivo por semana y comparación por empresa: esperan la API del panel financiero. -->
            <div
                class="grid gap-4 xl:grid-cols-[1fr_1.6fr]"
                :class="vistaMovil === 'empresas' ? '' : 'max-lg:hidden'"
            >
                <section
                    class="surface-card flex min-w-0 flex-col gap-2 rounded-[1.375rem] p-4 sm:p-5 max-lg:hidden"
                    aria-labelledby="titulo-efectivo"
                >
                    <h2
                        id="titulo-efectivo"
                        class="text-base font-semibold text-highlighted"
                    >
                        Efectivo en cajas y bancos por semana
                    </h2>
                    <SeccionSinApi
                        titulo="Todavía sin la serie semanal"
                        descripcion="La API da el saldo de hoy (arriba), no su historia por semana; llega con la API del panel financiero."
                        icono="i-lucide-chart-line"
                    />
                </section>
                <section
                    class="surface-card flex min-w-0 flex-col gap-2 rounded-[1.375rem] p-4 sm:p-5"
                    aria-labelledby="titulo-empresas"
                    data-prueba="empresas-panel"
                >
                    <div class="flex flex-wrap items-start justify-between gap-2">
                        <div>
                            <h2
                                id="titulo-empresas"
                                class="text-base font-semibold text-highlighted"
                            >
                                Por empresa
                            </h2>
                            <p class="text-xs text-muted">
                                Cada NIT lleva su libro; el total del grupo es solo informativo
                            </p>
                        </div>
                        <UBadge
                            label="Solo con alcance global"
                            icon="i-lucide-lock"
                            color="primary"
                            variant="soft"
                        />
                    </div>
                    <SeccionSinApi
                        titulo="Comparación por empresa pendiente"
                        descripcion="Servicios, ingreso mensual, cobranza y vencido de cada empresa llegan con la API del panel financiero."
                        icono="i-lucide-building-2"
                    />
                </section>
            </div>

            <!-- Teléfono: reportes a un toque y la regla de consulta. -->
            <section
                class="surface-card flex flex-col rounded-[1.375rem] lg:hidden"
                :class="vistaMovil === 'reportes' ? '' : 'hidden'"
                aria-label="Reportes"
            >
                <ULink
                    v-for="clave in REPORTES_MOVIL"
                    :key="clave"
                    :to="`/reportes/${clave}`"
                    class="flex items-center gap-3 border-b border-(--ax-borde) px-4 py-3 last:border-b-0"
                >
                    <span class="pastilla-icono pastilla-tono tono-marca size-9 shrink-0 rounded-xl">
                        <UIcon
                            :name="REPORTES[clave].icono"
                            class="size-4"
                        />
                    </span>
                    <span class="flex min-w-0 flex-1 flex-col">
                        <span class="truncate text-sm font-semibold text-highlighted">{{ REPORTES[clave].titulo }}</span>
                        <span class="truncate text-xs text-muted">{{ REPORTES[clave].descripcion }}</span>
                    </span>
                    <UIcon
                        name="i-lucide-chevron-right"
                        class="size-4 text-muted"
                    />
                </ULink>
            </section>
            <p class="text-center text-xs text-muted lg:hidden">
                En el teléfono solo se consulta. Cerrar un mes, declarar o castigar se hace en la computadora.
            </p>
        </ContaCuerpo>
    </PanelPagina>
</template>
