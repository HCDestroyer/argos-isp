<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'

// El cajero entra directo a su caja (`rutaInicio`); el resto ve el tablero.
definePageMeta({
    middleware: [() => {
        const destino = rutaInicio(useUsuarioActual().value)
        if (destino !== '/') {
            return navigateTo(destino, { replace: true })
        }
    }],
})

const { usuario } = useAuth()
const { puede, enlace } = usePermisos()

/**
 * Accesos agrupados por área (los grupos del menú, en su orden de uso): hasta 6 por bloque, los
 * primeros de cada grupo; la configuración, con un solo acceso a su índice.
 */
const MAX_ACCESOS = 6
const bloquesAccesos = computed(() => GRUPOS_PANEL
    .map(grupo => ({
        id: grupo.id,
        etiqueta: grupo.etiqueta,
        icono: grupo.icono,
        secciones: (grupo.id === 'configuracion' ? grupo.secciones : seccionesDeGrupo(grupo))
            .filter(seccion => puede(seccion.permiso))
            .slice(0, MAX_ACCESOS),
    }))
    .filter(bloque => bloque.secciones.length > 0))
const hoy = formatearFecha(new Date())

/** Saludo según la hora de Guatemala y el primer nombre («Buenos días, Ana»). */
const saludo = computed(() => {
    const hora = Number(new Intl.DateTimeFormat('es-GT', { hour: 'numeric', hourCycle: 'h23', timeZone: 'America/Guatemala' }).format(new Date()))
    const parte = hora < 12 ? 'Buenos días' : hora < 19 ? 'Buenas tardes' : 'Buenas noches'
    const nombre = usuario.value?.nombre.split(/\s+/)[0]
    return nombre ? `${parte}, ${nombre}` : parte
})
const verTablero = computed(() => puede('reportes.ver'))

const resumen = shallowRef<ResumenDashboard | null>(null)
const problema = ref<Problem | null>(null)
const cargando = ref(false)

const series = computed(() => (resumen.value ? seriesDashboard(resumen.value) : null))
const conSerie = computed(() => (resumen.value ? haySerie(resumen.value) : false))
const cobranza = computed(() => (resumen.value ? porcentajeCobranza(resumen.value.mes.cobranza_pct) : null))
const actualizado = computed(() => (resumen.value ? actualizacionDashboard(resumen.value) : null))

/** Servicios por estado, con los colores fijos y el enlace a la lista filtrada. */
const estados = computed(() => {
    if (!resumen.value) {
        return []
    }
    const s = resumen.value.servicios
    return [
        { estado: 'activo' as const, etiqueta: 'Activos', cantidad: s.activos },
        { estado: 'limitado' as const, etiqueta: 'Limitados', cantidad: s.limitados },
        { estado: 'suspendido' as const, etiqueta: 'Cortados', cantidad: s.suspendidos },
        { estado: 'retirado' as const, etiqueta: 'Retirados', cantidad: s.retirados },
    ]
})

function plural(cantidad: number, singular: string, varios: string): string {
    return `${cantidad.toLocaleString('es-GT')} ${cantidad === 1 ? singular : varios}`
}

/** Series de las mini gráficas (12 meses, el actual al final). */
const serieFacturado = computed(() => resumen.value?.series.map(m => m.facturado) ?? [])
const serieCobrado = computed(() => resumen.value?.series.map(m => m.cobrado) ?? [])

/*
 * Últimos pagos (lista de la portada), solo con `pagos.ver`. Con error se dice y se ofrece
 * reintentar; nunca una lista vacía que parezca "sin pagos".
 */
const verPagos = computed(() => puede('pagos.ver'))
const pagos = shallowRef<Pago[] | null>(null)
const problemaPagos = ref<Problem | null>(null)
const filtroPagos = ref<'todos' | 'registrado' | 'anulado'>('todos')
const nombres = useNombresClientes()
const pestanasPagos = [
    { label: 'Todos', value: 'todos' },
    { label: 'Registrados', value: 'registrado' },
    { label: 'Anulados', value: 'anulado' },
]
const pagosVisibles = computed(() => (pagos.value ?? []).filter(pago => filtroPagos.value === 'todos' || pago.estado === filtroPagos.value).slice(0, 6))

async function cargarPagos() {
    if (!verPagos.value) {
        return
    }
    const resultado = await usePagos().listar({ limit: 12 })
    pagos.value = resultado.ok ? resultado.data.data : null
    problemaPagos.value = resultado.ok ? null : resultado.problema
    if (resultado.ok && puede('clientes.ver')) {
        void nombres.cargar(resultado.data.data.map(pago => pago.cliente_id))
    }
}

function nombreCliente(id: number): string {
    return puede('clientes.ver') ? nombres.nombre(id) : `Cliente #${id}`
}

/** Accesos rápidos del encabezado de bienvenida (los que el usuario puede abrir). */
const rapidos = computed(() => [
    { etiqueta: 'Cobrar', icono: ICONOS.cobrar, to: enlace('/cobro') },
    { etiqueta: 'Nuevo cliente', icono: 'i-lucide-user-plus', to: enlace('/clientes/nuevo') },
    { etiqueta: 'Cartera vencida', icono: 'i-lucide-alarm-clock', to: enlace('/facturas?estado=vencida') },
    { etiqueta: 'Comprobantes', icono: 'i-lucide-file-check-2', to: enlace('/comprobantes') },
].filter((acceso): acceso is { etiqueta: string, icono: string, to: string } => acceso.to !== undefined))

/** Los mismos accesos rápidos de la barra superior (rayo), también aquí. */
const accesosRapidos = useAccesosRapidos()
const personalizandoAccesos = ref(false)

async function cargar() {
    void cargarPagos()
    if (!verTablero.value) {
        return
    }
    cargando.value = true
    const resultado = await useReportes().resumenDashboard()
    cargando.value = false
    // Con error no queda nada del resumen anterior: nunca cifras viejas o en cero junto al aviso.
    resumen.value = resultado.ok ? resultado.data : null
    problema.value = resultado.ok ? null : resultado.problema
}

onMounted(cargar)
</script>

<template>
    <PanelPagina
        id="inicio"
        titulo="Inicio"
        icono="i-lucide-house"
    >
        <template #acciones>
            <UButton
                v-if="verTablero"
                icon="i-lucide-refresh-cw"
                color="neutral"
                variant="ghost"
                aria-label="Actualizar el tablero"
                :loading="cargando"
                @click="cargar"
            />
        </template>

        <div class="flex flex-col gap-6">
            <!-- Bienvenida: el único bloque con el degradado de marca de fondo. El texto queda en la
                 zona índigo (blanco sobre #4f46e5, 6,3:1); el cian entra a la derecha, bajo el dibujo. -->
            <section
                class="bienvenida relative overflow-hidden rounded-(--ax-radio) p-5 text-white sm:p-7"
                aria-labelledby="titulo-bienvenida"
                data-prueba="bienvenida"
            >
                <svg
                    class="pointer-events-none absolute -right-6 -bottom-10 hidden h-56 opacity-30 sm:block"
                    viewBox="0 0 64 64"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2.2"
                    stroke-linecap="round"
                    aria-hidden="true"
                >
                    <path d="M5 42 C14.5 27 49.5 27 59 42 C49.5 57 14.5 57 5 42 Z" />
                    <circle
                        cx="32"
                        cy="42"
                        r="6.4"
                    />
                    <path d="M22.75 25.98 A18.5 18.5 0 0 1 41.25 25.98" />
                    <path d="M19.12 20.57 A25 25 0 0 1 44.88 20.57" />
                    <path d="M15.31 15.29 A31.5 31.5 0 0 1 48.69 15.29" />
                </svg>
                <div class="relative flex max-w-3xl flex-col gap-4">
                    <div class="flex max-w-2xl flex-col gap-1.5">
                        <h2
                            id="titulo-bienvenida"
                            class="text-xl font-bold tracking-[-0.02em] sm:text-2xl"
                        >
                            {{ saludo }}
                        </h2>
                        <p class="text-sm text-white/90">
                            {{ hoy }}<template v-if="verTablero && actualizado">
                                · Datos al {{ formatearFechaHora(actualizado) }}
                            </template>
                        </p>
                    </div>
                    <div
                        v-if="rapidos.length"
                        class="flex flex-wrap gap-2"
                    >
                        <UButton
                            v-for="(acceso, indice) in rapidos"
                            :key="acceso.to"
                            :to="acceso.to"
                            :label="acceso.etiqueta"
                            :icon="acceso.icono"
                            size="sm"
                            :class="indice === 0
                                ? 'bg-white text-(--ui-color-primary-700) hover:bg-white/90 active:bg-white/90'
                                : 'bg-white/10 text-white ring ring-white/60 hover:bg-white/20 active:bg-white/20'"
                        />
                    </div>
                </div>
            </section>

            <section
                v-if="accesosRapidos.accesos.value.length"
                class="flex flex-col gap-3"
                aria-labelledby="titulo-accesos-rapidos"
                data-prueba="inicio-accesos-rapidos"
            >
                <div class="flex items-center justify-between gap-2">
                    <h3
                        id="titulo-accesos-rapidos"
                        class="flex items-center gap-2 text-sm font-semibold text-highlighted"
                    >
                        <UIcon
                            name="i-lucide-zap"
                            class="size-4 text-primary"
                        />
                        Tus accesos rápidos
                    </h3>
                    <UButton
                        label="Personalizar"
                        icon="i-lucide-sliders-horizontal"
                        color="neutral"
                        variant="ghost"
                        size="sm"
                        @click="personalizandoAccesos = true"
                    />
                </div>
                <div class="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-6">
                    <ULink
                        v-for="(seccion, indice) in accesosRapidos.accesos.value"
                        :key="seccion.id"
                        :to="seccion.ruta"
                        :title="seccion.descripcion"
                        class="tarjeta-interactiva flex items-center gap-2.5 surface-card px-3 py-2.5 text-sm font-medium text-highlighted"
                    >
                        <span class="pastilla-icono tono-marca pastilla-tono size-8">
                            <UIcon
                                :name="seccion.icono"
                                class="size-4"
                            />
                        </span>
                        <span class="flex-1 truncate">{{ seccion.etiqueta }}</span>
                        <UKbd
                            v-if="indice < 9"
                            :value="String(indice + 1)"
                            size="sm"
                            class="hidden lg:inline-flex"
                        />
                    </ULink>
                </div>
                <AccesosRapidosEditor v-model:open="personalizandoAccesos" />
            </section>

            <template v-if="verTablero">
                <ProblemaAlerta
                    v-if="problema"
                    :problema="problema"
                    :reintentar="cargar"
                    :reintentando="cargando"
                    data-prueba="tablero-error"
                />

                <div
                    v-else-if="!resumen"
                    class="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"
                >
                    <USkeleton
                        v-for="i in 4"
                        :key="i"
                        class="h-40 w-full rounded-(--ax-radio)"
                    />
                    <USkeleton class="h-72 w-full rounded-(--ax-radio) sm:col-span-2 xl:col-span-4" />
                </div>

                <template v-else>
                    <div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                        <TarjetaKpi
                            etiqueta="Facturado del mes"
                            :valor="formatearQuetzales(resumen.mes.facturado)"
                            icono="i-lucide-receipt-text"
                            :tono="1"
                            :serie="serieFacturado"
                            :to="enlace('/facturas')"
                            etiqueta-enlace="Ver facturas"
                            destacada
                            data-prueba="kpi-mes"
                        >
                            <span class="flex flex-col gap-1.5">
                                <span>
                                    Cobrado {{ formatearQuetzales(resumen.mes.cobrado) }} · {{ cobranza?.texto }}
                                    · pendiente {{ formatearQuetzales(pendienteMes(resumen.mes)) }}
                                </span>
                                <UProgress
                                    :model-value="cobranza?.barra ?? 0"
                                    size="sm"
                                    color="primary"
                                    :aria-label="`Cobranza del mes: ${cobranza?.texto}`"
                                />
                                <span>{{ etiquetaPeriodo(resumen.mes.periodo) }}</span>
                            </span>
                        </TarjetaKpi>
                        <TarjetaKpi
                            etiqueta="Cobros de hoy"
                            :valor="formatearQuetzales(resumen.hoy.cobrado)"
                            icono="i-lucide-banknote"
                            :tono="3"
                            :serie="serieCobrado"
                            comparacion="cobrado vs. mes anterior"
                            :to="enlace(`/pagos?desde=${resumen.hoy.fecha}&hasta=${resumen.hoy.fecha}`)"
                            etiqueta-enlace="Ver pagos de hoy"
                            :detalle="`${plural(resumen.hoy.pagos, 'pago', 'pagos')} · ${formatearFecha(resumen.hoy.fecha)}`"
                            data-prueba="kpi-hoy"
                        />
                        <TarjetaKpi
                            etiqueta="Cartera vencida"
                            :valor="formatearQuetzales(resumen.cartera_vencida.monto)"
                            icono="i-lucide-alarm-clock"
                            :tono="2"
                            :to="enlace('/facturas?estado=vencida')"
                            etiqueta-enlace="Ver facturas vencidas"
                            :detalle="`${plural(resumen.cartera_vencida.facturas, 'factura', 'facturas')} · ${plural(resumen.cartera_vencida.clientes, 'cliente', 'clientes')} · por cobrar en total ${formatearQuetzales(resumen.cartera_vencida.pendiente_total)}`"
                            data-prueba="kpi-cartera"
                        />
                        <TarjetaKpi
                            etiqueta="Promesas activas"
                            :valor="resumen.promesas_activas.cantidad.toLocaleString('es-GT')"
                            icono="i-lucide-calendar-clock"
                            :tono="4"
                            :to="enlace('/promesas?estado=activa')"
                            etiqueta-enlace="Ver promesas"
                            :detalle="`${formatearQuetzales(resumen.promesas_activas.monto)} prometidos`"
                            data-prueba="kpi-promesas"
                        />
                    </div>

                    <section
                        class="flex flex-col gap-3 surface-card p-4 sm:p-5"
                        aria-labelledby="titulo-servicios"
                        data-prueba="tablero-servicios"
                    >
                        <div class="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                            <h3
                                id="titulo-servicios"
                                class="text-sm font-semibold text-highlighted"
                            >
                                Servicios por estado
                            </h3>
                            <p class="text-xs text-muted">
                                Clientes: {{ resumen.clientes.activos }} al día · {{ resumen.clientes.limitados }} limitados · {{ resumen.clientes.cortados }} cortados
                            </p>
                        </div>
                        <ul class="grid grid-cols-2 gap-3 sm:grid-cols-4">
                            <li
                                v-for="item in estados"
                                :key="item.estado"
                            >
                                <ULink
                                    :to="enlace(`/servicios?estado=${item.estado}`)"
                                    class="tarjeta-interactiva flex flex-col gap-1.5 rounded-lg bg-(--ax-panel) p-3"
                                    :data-prueba="`servicios-${item.estado}`"
                                >
                                    <NumeroVivo
                                        :valor="item.cantidad.toLocaleString('es-GT')"
                                        class="text-2xl font-bold tracking-[-0.02em] text-highlighted"
                                    />
                                    <EstadoServicioBadge
                                        :estado="item.estado"
                                        :etiqueta="item.etiqueta"
                                        size="sm"
                                        class="self-start"
                                    />
                                </ULink>
                            </li>
                        </ul>
                    </section>

                    <div class="grid gap-4 lg:grid-cols-2">
                        <section
                            class="flex min-w-0 flex-col gap-2 surface-card p-4 sm:p-5"
                            aria-labelledby="titulo-montos"
                            data-prueba="grafica-montos"
                        >
                            <h3
                                id="titulo-montos"
                                class="text-sm font-semibold text-highlighted"
                            >
                                Facturado y cobrado · últimos 12 meses
                            </h3>
                            <GraficaColumnas
                                v-if="series && conSerie"
                                titulo="Facturado y cobrado por mes"
                                :categorias="series.categorias"
                                :categorias-largas="series.categoriasLargas"
                                :series="series.montos"
                                :hallazgo="hallazgoMontos(resumen)"
                            />
                            <UEmpty
                                v-else
                                icon="i-lucide-chart-column"
                                title="Sin facturación ni cobros en los últimos 12 meses"
                                description="Cuando se emitan avisos de cobro y se registren pagos, aparecen aquí."
                                variant="naked"
                            />
                        </section>
                        <section
                            class="flex min-w-0 flex-col gap-2 surface-card p-4 sm:p-5"
                            aria-labelledby="titulo-conteos"
                            data-prueba="grafica-conteos"
                        >
                            <h3
                                id="titulo-conteos"
                                class="text-sm font-semibold text-highlighted"
                            >
                                Facturas emitidas y pagos registrados
                            </h3>
                            <GraficaColumnas
                                v-if="series && conSerie"
                                titulo="Facturas y pagos por mes"
                                :categorias="series.categorias"
                                :categorias-largas="series.categoriasLargas"
                                :series="series.conteos"
                                :hallazgo="hallazgoConteos(resumen)"
                                formato="entero"
                            />
                            <UEmpty
                                v-else
                                icon="i-lucide-chart-column"
                                title="Sin movimientos en los últimos 12 meses"
                                variant="naked"
                            />
                        </section>
                    </div>
                </template>
            </template>

            <div
                class="grid gap-4"
                :class="verPagos ? 'lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]' : ''"
            >
                <section
                    v-if="verPagos"
                    class="flex min-w-0 flex-col gap-2 surface-card p-4 sm:p-5"
                    aria-labelledby="titulo-ultimos-pagos"
                    data-prueba="ultimos-pagos"
                >
                    <div class="flex flex-wrap items-center justify-between gap-2">
                        <h3
                            id="titulo-ultimos-pagos"
                            class="text-sm font-semibold text-highlighted"
                        >
                            Últimos pagos
                        </h3>
                        <UTabs
                            v-model="filtroPagos"
                            :items="pestanasPagos"
                            :content="false"
                            size="xs"
                            color="neutral"
                            aria-label="Filtrar los últimos pagos"
                        />
                    </div>
                    <ProblemaAlerta
                        v-if="problemaPagos"
                        :problema="problemaPagos"
                        :reintentar="cargarPagos"
                    />
                    <div
                        v-else-if="pagos === null"
                        class="flex flex-col gap-2"
                    >
                        <USkeleton
                            v-for="i in 4"
                            :key="i"
                            class="h-12 w-full"
                        />
                    </div>
                    <ul
                        v-else-if="pagosVisibles.length"
                        class="-mx-2 flex flex-col"
                    >
                        <ListaItem
                            v-for="pago in pagosVisibles"
                            :key="pago.id"
                            :titulo="nombreCliente(pago.cliente_id)"
                            :subtitulo="`${ETIQUETAS_METODO[pago.metodo]} · ${formatearFechaHora(pago.created_at)}`"
                            :valor="`${pago.estado === 'anulado' ? '' : '+'}${formatearQuetzales(pago.monto)}`"
                            :to="`/pagos/${pago.id}`"
                        >
                            <template #derecha>
                                <EstadoPagoBadge
                                    :estado="pago.estado"
                                    size="sm"
                                />
                            </template>
                        </ListaItem>
                    </ul>
                    <UEmpty
                        v-else
                        icon="i-lucide-banknote"
                        title="Sin pagos para mostrar"
                        :description="filtroPagos === 'todos' ? 'Los pagos que se registren aparecen aquí.' : 'Ninguno de los últimos pagos tiene ese estado.'"
                        :actions="puede('pagos.registrar') && filtroPagos === 'todos' ? [{ label: 'Cobrar', icon: ICONOS.cobrar, to: '/cobro' }] : undefined"
                        variant="naked"
                    />
                    <UButton
                        to="/pagos"
                        label="Ver todos los pagos"
                        trailing-icon="i-lucide-arrow-right"
                        color="neutral"
                        variant="soft"
                        size="sm"
                        block
                        class="mt-auto"
                    />
                </section>

                <section
                    class="flex min-w-0 flex-col gap-3"
                    aria-labelledby="titulo-accesos"
                    data-prueba="accesos"
                >
                    <h3
                        id="titulo-accesos"
                        class="text-sm font-semibold text-highlighted"
                    >
                        Accesos
                    </h3>
                    <div class="grid gap-3 sm:grid-cols-2 2xl:grid-cols-3">
                        <nav
                            v-for="bloque in bloquesAccesos"
                            :key="bloque.id"
                            class="flex flex-col gap-1 surface-card p-3"
                            :aria-labelledby="`accesos-${bloque.id}`"
                        >
                            <h4
                                :id="`accesos-${bloque.id}`"
                                class="flex items-center gap-2 px-1 pb-1 text-xs font-bold tracking-[0.05em] text-muted uppercase"
                            >
                                <UIcon
                                    :name="bloque.icono"
                                    class="size-4 text-primary"
                                />
                                {{ bloque.etiqueta }}
                            </h4>
                            <ULink
                                v-for="seccion in bloque.secciones"
                                :key="seccion.id"
                                :to="seccion.ruta"
                                :title="seccion.descripcion"
                                class="flex items-center gap-2.5 rounded-md px-1.5 py-1.5 text-sm text-default transition-colors hover:bg-(--ax-fila-hover) hover:text-primary"
                            >
                                <UIcon
                                    :name="seccion.icono"
                                    class="size-4 shrink-0 text-dimmed"
                                />
                                <span class="truncate">{{ seccion.etiqueta }}</span>
                            </ULink>
                        </nav>
                    </div>
                </section>
            </div>
        </div>
    </PanelPagina>
</template>
