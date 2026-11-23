<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { SelectItem, TableColumn, TabsItem } from '@nuxt/ui'
import { h } from 'vue'

/**
 * Routers (tablero RedRouters y RedRoutersMovil): contadores de en línea, con problemas, clientes
 * conectados y redes casi llenas; aviso del router caído; tarjeta con pestañas (Activos, En línea,
 * Con problemas, Por conectar, Inactivos), buscador y filtros de conexión y control; cada fila con
 * su estado, conexión, control de velocidad, conectados, IPs ocupadas, «Probar» y «⋯».
 *
 * El uso del router (CPU, memoria, historial) lo mide Horus (decisión 27 del PM): aquí no hay
 * columna de CPU; la ficha lleva el enlace a Horus. Los conectados salen de
 * `GET /routers/:id/resumen-sesiones` y las IPs de `GET /routers/:id/direccionamiento`; si una
 * lectura falla, la celda dice que no se pudo leer, nunca un cero.
 */
definePageMeta({ permiso: 'routers.ver' })

useHead({ title: 'Routers · ArgosIsp' })

const route = useRoute()
const router = useRouter()
const { puede } = usePermisos()

type Vista = 'activos' | 'en_linea' | 'problemas' | 'por_conectar' | 'inactivos'
const VISTAS: Vista[] = ['activos', 'en_linea', 'problemas', 'por_conectar', 'inactivos']
const TODOS = 'todos'

function esVista(valor: unknown): valor is Vista {
    return typeof valor === 'string' && (VISTAS as string[]).includes(valor)
}

const vista = ref<Vista>(esVista(route.query.vista) ? route.query.vista : 'activos')
const busqueda = ref('')
const conexion = ref<string>(TODOS)
const control = ref<string>(TODOS)

const activos = shallowRef<RouterNas[]>([])
const inactivos = shallowRef<RouterNas[]>([])
const cargando = ref(true)
const problema = ref<Problem | null>(null)
const incompleta = ref(false)

/** Lo que se lee aparte por router: conectados (sesiones) y direcciones (redes IPv4). */
interface ExtraRouter {
    servicios: number | null
    conectados: number | null
    problemaSesiones: boolean
    ocupacion: OcupacionPool | null
    redesLlenas: RedIpv4[]
    problemaRedes: boolean
}
const extras = ref<Record<number, ExtraRouter>>({})
const leyendoExtras = ref(false)
const actualizado = ref<number | null>(null)

const verSesiones = computed(() => puede('sesiones.ver'))
const verRedes = computed(() => puede('redes.ver'))

async function leerExtras(lista: RouterNas[]) {
    leyendoExtras.value = true
    const desde = new Date().toISOString()
    const nuevos: Record<number, ExtraRouter> = {}
    await Promise.all(lista.map(async (nas) => {
        const [sesiones, direcciones] = await Promise.all([
            verSesiones.value ? useRouters().resumenSesiones(nas.id, desde) : null,
            verRedes.value ? useRouters().direccionamiento(nas.id) : null,
        ])
        nuevos[nas.id] = {
            servicios: sesiones?.ok ? sesiones.data.servicios : null,
            conectados: sesiones?.ok ? sesiones.data.con_sesion_activa : null,
            problemaSesiones: Boolean(sesiones && !sesiones.ok),
            ocupacion: direcciones?.ok ? direcciones.data.ocupacion.ipv4 : null,
            redesLlenas: direcciones?.ok ? direcciones.data.redes_ipv4.filter(red => (porcentajeOcupacion(red.ocupacion) ?? 0) >= UMBRAL_RED_LLENA) : [],
            problemaRedes: Boolean(direcciones && !direcciones.ok),
        }
    }))
    extras.value = nuevos
    leyendoExtras.value = false
}

async function cargar() {
    cargando.value = true
    problema.value = null
    const [resultadoActivos, resultadoInactivos] = await Promise.all([
        leerTodas(cursor => useRouters().listar({ activo: true, limit: 200 }, cursor)),
        leerTodas(cursor => useRouters().listar({ activo: false, limit: 200 }, cursor)),
    ])
    cargando.value = false
    if (!resultadoActivos.ok) {
        problema.value = resultadoActivos.problema
        return
    }
    activos.value = resultadoActivos.data.filas
    inactivos.value = resultadoInactivos.ok ? resultadoInactivos.data.filas : []
    incompleta.value = !resultadoActivos.data.completa
    actualizado.value = Date.now()
    await leerExtras(activos.value)
}

/* El estado se vuelve a leer solo cada minuto (pie de la tarjeta). */
let temporizador: ReturnType<typeof setInterval> | undefined
onMounted(() => {
    void cargar()
    temporizador = setInterval(() => {
        if (!document.hidden) {
            void cargar()
        }
    }, 60_000)
})
onBeforeUnmount(() => clearInterval(temporizador))

watch(vista, valor => void router.replace({ query: valor === 'activos' ? {} : { vista: valor } }))

const conteo = computed(() => {
    const porEstado = { en_linea: 0, caido: 0, por_conectar: 0, desconocido: 0 }
    for (const nas of activos.value) {
        const estado = estadoListaRouter(nas)
        if (estado !== 'inactivo') {
            porEstado[estado]++
        }
    }
    return porEstado
})

/* Contadores de arriba (con su detalle real; «—» mientras no se leyó). */
const totalesSesiones = computed(() => {
    const filas = Object.values(extras.value)
    if (!verSesiones.value || !filas.length || filas.some(f => f.conectados === null)) {
        return null
    }
    return {
        conectados: filas.reduce((suma, f) => suma + (f.conectados ?? 0), 0),
        servicios: filas.reduce((suma, f) => suma + (f.servicios ?? 0), 0),
    }
})
const problemaSesiones = computed(() => Object.values(extras.value).some(f => f.problemaSesiones))
const redesLlenas = computed(() => activos.value.flatMap(nas => (extras.value[nas.id]?.redesLlenas ?? []).map(red => ({ red, router: nas }))))
const problemaRedes = computed(() => Object.values(extras.value).some(f => f.problemaRedes))

const caidos = computed(() => activos.value.filter(nas => estadoListaRouter(nas) === 'caido'))

const pestanas = computed<TabsItem[]>(() => [
    { label: 'Activos', value: 'activos', badge: { label: String(activos.value.length), color: 'neutral', variant: 'soft' } },
    { label: 'En línea', value: 'en_linea', badge: { label: String(conteo.value.en_linea), color: 'neutral', variant: 'soft' } },
    { label: 'Con problemas', value: 'problemas', badge: { label: String(conteo.value.caido), color: conteo.value.caido ? 'error' : 'neutral', variant: 'soft' } },
    { label: 'Por conectar', value: 'por_conectar', badge: { label: String(conteo.value.por_conectar), color: 'neutral', variant: 'soft' } },
    { label: 'Inactivos', value: 'inactivos', badge: { label: String(inactivos.value.length), color: 'neutral', variant: 'soft' } },
])

const itemsConexion: SelectItem[] = [
    { label: 'Conexión: todas', value: TODOS },
    { label: 'PPPoE', value: 'pppoe' },
    { label: 'IP estática', value: 'ip_estatica' },
    { label: 'DHCP fija', value: 'dhcp_fija' },
]
const itemsControl: SelectItem[] = [
    { label: 'Control: todos', value: TODOS },
    ...Object.entries(OPCIONES_APLICACION).map(([valor, opcion]) => ({ label: opcion.etiqueta, value: valor })),
]

const filas = computed(() => {
    const base = vista.value === 'inactivos'
        ? inactivos.value
        : activos.value.filter((nas) => {
                const estado = estadoListaRouter(nas)
                return vista.value === 'activos'
                    || (vista.value === 'en_linea' && estado === 'en_linea')
                    || (vista.value === 'problemas' && estado === 'caido')
                    || (vista.value === 'por_conectar' && estado === 'por_conectar')
            })
    const texto = busqueda.value.trim().toLowerCase()
    return base.filter(nas => (conexion.value === TODOS || nas.tipo_conexion === conexion.value)
        && (control.value === TODOS || controlRouter(nas).estrategia.aplicacion === control.value)
        && (!texto || [nas.nombre, nas.host, nas.nas_ip, nas.serial].some(valor => valor?.toLowerCase().includes(texto))))
})

const hayFiltros = computed(() => Boolean(busqueda.value.trim()) || conexion.value !== TODOS || control.value !== TODOS)

function limpiarFiltros() {
    busqueda.value = ''
    conexion.value = TODOS
    control.value = TODOS
}

const columnas = computed<TableColumn<RouterNas>[]>(() => [
    { accessorKey: 'nombre', header: 'Router', meta: { class: { td: 'whitespace-normal min-w-56' } } },
    { id: 'estado', header: 'Estado', meta: SOLO_ANCHO },
    { id: 'conexion', header: 'Conexión', meta: { class: { th: 'hidden xl:table-cell', td: 'hidden xl:table-cell' } } },
    { id: 'control', header: 'Control de velocidad', meta: SOLO_ESCRITORIO },
    ...(verSesiones.value ? [{ id: 'conectados', header: 'Clientes conectados', meta: { class: { th: 'text-end sm:text-start', td: 'text-end sm:text-start' } } }] : []),
    ...(verRedes.value ? [{ id: 'ips', header: 'IPs ocupadas', meta: SOLO_ESCRITORIO }] : []),
    { id: 'acciones', header: () => h('span', { class: 'sr-only' }, 'Acciones'), meta: { class: { td: 'w-0 text-end', th: 'w-0' } } },
])

/** Nombre del router al que se unió uno absorbido (si está en las listas). */
function unidoA(nas: RouterNas): string {
    const destino = [...activos.value, ...inactivos.value].find(otro => otro.id === nas.unido_a_id)
    return destino ? `Unido a ${destino.nombre}` : `Unido al router ${nas.unido_a_id}`
}

function lineaEquipo(nas: RouterNas): string {
    return [nas.routeros_version ? `RouterOS ${nas.routeros_version}` : null, nas.host, nas.serial].filter(Boolean).join(' · ')
}

/** Lo que pide atención en la fila (en rojo o ámbar bajo el nombre). */
function avisoFila(nas: RouterNas): { texto: string, clase: string } | null {
    const estado = estadoListaRouter(nas)
    const extra = extras.value[nas.id]
    if (estado === 'caido') {
        return { texto: extra?.servicios ? `${formatearEntero(extra.servicios)} servicios PPPoE sin router` : 'No responde', clase: 'text-error' }
    }
    const llena = extra?.redesLlenas[0]
    if (llena) {
        return { texto: `Red ${llena.cidr} casi llena`, clase: 'text-warning' }
    }
    return null
}

const pruebaAbierta = ref(false)
const pruebaRouter = shallowRef<RouterNas | null>(null)

function probar(nas: RouterNas) {
    pruebaRouter.value = nas
    pruebaAbierta.value = true
}

function alActualizar() {
    void cargar()
}

function hace(marca: number | null): string {
    return marca ? haceCuanto(new Date(marca).toISOString()) : ''
}
</script>

<template>
    <PanelPagina
        id="routers"
        titulo="Routers"
        icono="i-lucide-router"
        :descripcion="cargando ? 'Leyendo routers…' : `${activos.length} routers activos${totalesSesiones ? ` · ${formatearEntero(totalesSesiones.conectados)} clientes conectados ahora` : ''}`"
    >
        <template #acciones>
            <UButton
                to="/routers/migracion"
                label="Migración"
                icon="i-lucide-arrow-right-left"
                color="neutral"
                variant="outline"
                class="hidden rounded-full sm:inline-flex"
                data-prueba="ir-migracion"
            />
            <UButton
                v-if="puede('routers.crear')"
                to="/routers/nuevo"
                label="Conectar router"
                icon="i-lucide-plus"
                size="lg"
                class="glow-brand hidden rounded-full px-5 sm:inline-flex"
                data-prueba="nuevo-router"
            />
        </template>

        <div class="flex flex-col gap-4">
            <RoutersDuplicadosAviso @unido="alActualizar" />

            <!-- Contadores (tablero RedRouters): en el teléfono, en línea, problemas y conectados. -->
            <div
                class="grid grid-cols-3 gap-3 lg:grid-cols-4"
                data-prueba="contadores-routers"
            >
                <TarjetaDato
                    etiqueta="En línea"
                    icono="i-lucide-circle-check"
                    tono="tono-exito"
                    :valor="cargando ? null : String(conteo.en_linea)"
                    :detalle="`de ${activos.length} routers`"
                    :problema="problema"
                    @reintentar="cargar"
                />
                <TarjetaDato
                    etiqueta="Con problemas"
                    icono="i-lucide-triangle-alert"
                    tono="tono-error"
                    :valor="cargando ? null : String(conteo.caido)"
                    :detalle="`${conteo.caido} caídos · ${conteo.por_conectar} por conectar`"
                    :peligro="conteo.caido > 0"
                    :problema="problema"
                    @reintentar="cargar"
                />
                <TarjetaDato
                    v-if="verSesiones"
                    etiqueta="Clientes conectados"
                    icono="i-lucide-users"
                    :valor="totalesSesiones ? formatearEntero(totalesSesiones.conectados) : (problemaSesiones ? '—' : null)"
                    :detalle="totalesSesiones ? `de ${formatearEntero(totalesSesiones.servicios)} servicios` : (problemaSesiones ? 'No se pudo leer' : undefined)"
                />
                <TarjetaDato
                    v-if="verRedes"
                    etiqueta="Redes casi llenas"
                    icono="i-lucide-network"
                    tono="tono-aviso"
                    class="hidden lg:flex"
                    :valor="leyendoExtras && !redesLlenas.length ? null : (problemaRedes && !redesLlenas.length ? '—' : String(redesLlenas.length))"
                    :detalle="redesLlenas[0] ? `${redesLlenas[0].router.nombre} al ${Math.round(redesLlenas[0].red.ocupacion.porcentaje)} %` : (problemaRedes ? 'No se pudo leer' : `Ninguna arriba de ${UMBRAL_RED_LLENA} %`)"
                />
            </div>

            <UAlert
                v-for="nas in caidos"
                :key="nas.id"
                color="error"
                variant="subtle"
                icon="i-lucide-triangle-alert"
                :title="`${nas.nombre} no responde ${nas.ultimo_contacto ? `desde ${haceCuanto(nas.ultimo_contacto)}` : ''}.`"
                :description="extras[nas.id]?.servicios ? `${formatearEntero(extras[nas.id]!.servicios!)} servicios PPPoE dependen de él. Las sesiones se cierran solas si no vuelve.` : 'Las sesiones se cierran solas si no vuelve.'"
                :actions="[{ label: 'Ver router', to: `/routers/${nas.id}`, color: 'neutral', variant: 'outline', class: 'rounded-full' }]"
                orientation="horizontal"
                :data-prueba="`aviso-caido-${nas.id}`"
            />

            <div class="surface-card flex min-w-0 flex-col overflow-hidden rounded-2xl">
                <div class="flex flex-col gap-3 p-3 sm:p-4 2xl:flex-row 2xl:items-center 2xl:justify-between">
                    <RedPestanas
                        v-model="vista"
                        :items="pestanas"
                        etiqueta="Ver routers"
                        data-prueba="vista-routers"
                    />
                    <div class="flex flex-wrap items-center gap-2">
                        <UInput
                            v-model="busqueda"
                            icon="i-lucide-search"
                            placeholder="Buscar por nombre, IP o serie…"
                            aria-label="Buscar routers por nombre, IP o serie"
                            class="w-full sm:w-64"
                            :ui="{ base: 'rounded-full' }"
                        />
                        <USelect
                            v-model="conexion"
                            :items="itemsConexion"
                            icon="i-lucide-plug"
                            aria-label="Filtrar por tipo de conexión"
                            class="hidden rounded-full sm:inline-flex"
                        />
                        <USelect
                            v-model="control"
                            :items="itemsControl"
                            icon="i-lucide-gauge"
                            aria-label="Filtrar por control de velocidad"
                            class="hidden rounded-full sm:inline-flex"
                        />
                    </div>
                </div>

                <div
                    v-if="problema"
                    class="p-3 sm:p-4"
                >
                    <ProblemaAlerta
                        :problema="problema"
                        :reintentar="cargar"
                        :reintentando="cargando"
                    />
                </div>
                <UTable
                    v-else
                    :data="filas"
                    :columns="columnas"
                    :loading="cargando"
                    sticky
                    :ui="{ thead: 'bg-(--ax-cabecera-tabla)', th: 'text-xs', td: 'py-3' }"
                    data-prueba="tabla-routers"
                >
                    <template #nombre-cell="{ row }">
                        <div class="flex min-w-0 items-center gap-3">
                            <span
                                class="pastilla-icono pastilla-tono size-10 shrink-0 rounded-xl"
                                :class="ESTADOS_LISTA_ROUTER[estadoListaRouter(row.original)].tono || 'bg-(--ax-panel) text-muted'"
                            >
                                <UIcon
                                    name="i-lucide-router"
                                    class="size-5"
                                />
                            </span>
                            <div class="flex min-w-0 flex-col">
                                <span class="flex flex-wrap items-center gap-1.5">
                                    <ULink
                                        :to="`/routers/${row.original.id}`"
                                        class="font-semibold text-highlighted hover:text-primary"
                                    >{{ row.original.nombre }}</ULink>
                                    <UBadge
                                        v-if="row.original.unido_a_id"
                                        :label="unidoA(row.original)"
                                        icon="i-lucide-merge"
                                        color="neutral"
                                        variant="subtle"
                                        size="sm"
                                        :data-prueba="`unido-${row.original.id}`"
                                    />
                                </span>
                                <span class="truncate text-xs text-muted">{{ lineaEquipo(row.original) }}</span>
                                <span class="text-xs text-muted sm:hidden">{{ tipoConexionCorto(row.original.tipo_conexion) }} · {{ MODOS_SEGURIDAD[row.original.modo_seguridad].etiqueta }} · {{ controlRouter(row.original).etiqueta }}</span>
                                <span class="mt-0.5 flex items-center gap-1.5 sm:hidden">
                                    <UBadge
                                        :label="ESTADOS_LISTA_ROUTER[estadoListaRouter(row.original)].etiqueta"
                                        :color="ESTADOS_LISTA_ROUTER[estadoListaRouter(row.original)].color"
                                        variant="subtle"
                                        size="sm"
                                        class="rounded-full"
                                        :data-prueba="`en-linea-${row.original.id}`"
                                    />
                                    <span
                                        class="text-xs text-muted"
                                        :data-prueba="`ultimo-contacto-${row.original.id}`"
                                    >{{ detalleContactoRouter(row.original) }}</span>
                                </span>
                                <span
                                    v-if="avisoFila(row.original)"
                                    class="text-xs font-medium"
                                    :class="avisoFila(row.original)!.clase"
                                >{{ avisoFila(row.original)!.texto }}</span>
                            </div>
                        </div>
                    </template>
                    <template #estado-cell="{ row }">
                        <div
                            class="flex flex-col items-start gap-1"
                            :data-prueba="`contacto-${row.original.id}`"
                        >
                            <UBadge
                                :label="ESTADOS_LISTA_ROUTER[estadoListaRouter(row.original)].etiqueta"
                                :icon="ESTADOS_LISTA_ROUTER[estadoListaRouter(row.original)].icono"
                                :color="ESTADOS_LISTA_ROUTER[estadoListaRouter(row.original)].color"
                                variant="subtle"
                                size="sm"
                                class="rounded-full"
                                :data-prueba="`en-linea-${row.original.id}`"
                            />
                            <span
                                class="text-xs text-muted"
                                :title="row.original.ultimo_contacto ? formatearFechaHora(row.original.ultimo_contacto) : undefined"
                                :data-prueba="`ultimo-contacto-${row.original.id}`"
                            >{{ detalleContactoRouter(row.original) }}</span>
                        </div>
                    </template>
                    <template #conexion-cell="{ row }">
                        <div class="flex flex-col text-sm">
                            <span class="font-medium text-highlighted">{{ tipoConexionCorto(row.original.tipo_conexion) }}</span>
                            <span
                                class="text-xs text-muted"
                                :data-prueba="`modo-${row.original.id}`"
                            >{{ MODOS_SEGURIDAD[row.original.modo_seguridad].etiqueta }}</span>
                        </div>
                    </template>
                    <template #control-cell="{ row }">
                        <div
                            class="flex flex-col text-sm"
                            :data-prueba="`control-${row.original.id}`"
                        >
                            <span class="font-medium text-highlighted">{{ controlRouter(row.original).etiqueta }}</span>
                            <span class="text-xs text-muted">{{ controlRouter(row.original).padre }}</span>
                        </div>
                    </template>
                    <template #conectados-cell="{ row }">
                        <div
                            class="flex min-w-24 flex-col gap-1"
                            :data-prueba="`conectados-${row.original.id}`"
                        >
                            <template v-if="extras[row.original.id]?.conectados != null">
                                <span class="text-sm tabular-nums">
                                    <span class="font-semibold text-highlighted">{{ formatearEntero(extras[row.original.id]!.conectados!) }}</span>
                                    <span class="text-muted"> de {{ formatearEntero(extras[row.original.id]!.servicios ?? 0) }}</span>
                                </span>
                                <UProgress
                                    :model-value="extras[row.original.id]!.servicios ? (extras[row.original.id]!.conectados! / extras[row.original.id]!.servicios!) * 100 : 0"
                                    color="success"
                                    size="sm"
                                    class="hidden sm:block"
                                    :aria-label="`${extras[row.original.id]!.conectados} conectados de ${extras[row.original.id]!.servicios}`"
                                />
                            </template>
                            <span
                                v-else-if="extras[row.original.id]?.problemaSesiones"
                                class="text-xs text-muted"
                            >No se pudo leer</span>
                            <USkeleton
                                v-else
                                class="h-4 w-16"
                            />
                        </div>
                    </template>
                    <template #ips-cell="{ row }">
                        <div class="min-w-28">
                            <RedOcupacion
                                v-if="porcentajeOcupacion(extras[row.original.id]?.ocupacion) !== null"
                                :porcentaje="porcentajeOcupacion(extras[row.original.id]?.ocupacion)!"
                            />
                            <span
                                v-else-if="extras[row.original.id]?.problemaRedes"
                                class="text-xs text-muted"
                            >No se pudo leer</span>
                            <span
                                v-else-if="extras[row.original.id]"
                                class="text-xs text-muted"
                            >Sin redes</span>
                            <USkeleton
                                v-else
                                class="h-4 w-16"
                            />
                        </div>
                    </template>
                    <template #acciones-cell="{ row }">
                        <div class="flex items-center justify-end gap-1">
                            <UButton
                                v-if="puede('routers.probar_conexion')"
                                icon="i-lucide-activity"
                                color="neutral"
                                variant="ghost"
                                size="sm"
                                class="hidden rounded-full sm:inline-flex"
                                :aria-label="`Probar conexión de ${row.original.nombre}`"
                                :title="`Probar conexión de ${row.original.nombre}`"
                                @click="probar(row.original)"
                            />
                            <RouterAcciones
                                :router="row.original"
                                solo-icono
                                tamano="sm"
                                @actualizado="alActualizar"
                            />
                        </div>
                    </template>
                    <template #empty>
                        <UEmpty
                            :icon="hayFiltros ? 'i-lucide-search-x' : 'i-lucide-router'"
                            :title="hayFiltros ? 'Ningún router coincide' : (vista === 'activos' ? 'Todavía no hay routers' : 'Ningún router aquí')"
                            :description="hayFiltros ? 'Prueba con otra búsqueda o quita algún filtro.' : undefined"
                            :actions="hayFiltros ? [{ label: 'Limpiar filtros', icon: 'i-lucide-filter-x', color: 'neutral', variant: 'subtle', onClick: limpiarFiltros }] : (vista === 'activos' && puede('routers.crear') && !cargando ? [{ label: 'Conectar el primer router', icon: 'i-lucide-plus', to: '/routers/nuevo' }] : undefined)"
                            variant="naked"
                        />
                    </template>
                </UTable>

                <div class="flex flex-wrap items-center justify-between gap-2 border-t border-(--ax-borde) px-3 py-2.5 text-xs text-muted sm:px-4">
                    <span class="flex items-center gap-1.5">
                        <UIcon
                            name="i-lucide-info"
                            class="size-3.5 shrink-0"
                        />
                        El estado se vuelve a leer solo cada minuto{{ actualizado ? ` (última lectura ${hace(actualizado)})` : '' }}.
                    </span>
                    <span>{{ filas.length }} de {{ activos.length + inactivos.length }} routers{{ incompleta ? ' (hay más: afina la búsqueda)' : '' }}</span>
                </div>
            </div>
        </div>

        <RedBarraTelefono v-if="puede('routers.crear')">
            <UButton
                to="/routers/nuevo"
                label="Conectar router"
                icon="i-lucide-plus"
                size="lg"
                block
                class="rounded-full"
            />
        </RedBarraTelefono>

        <RouterPruebaConexionModal
            v-if="pruebaRouter && puede('routers.probar_conexion')"
            v-model:open="pruebaAbierta"
            :router="pruebaRouter"
            @probado="alActualizar"
            @actualizado="alActualizar"
        />
    </PanelPagina>
</template>
