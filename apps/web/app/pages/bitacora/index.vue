<script setup lang="ts">
import type { SelectItem, SelectMenuItem, TableColumn, TabsItem } from '@nuxt/ui'

/**
 * Bitácora (tablero OperBitacora): quién hizo qué, cuándo y desde dónde. Tres pestañas en la
 * tarjeta: acciones, cambios de datos y órdenes a la red (`audit.red`, con `red.ver`). Cada acción
 * dice en español qué se hizo y debajo, siempre, su nombre técnico (decisión 25). La fila abre el
 * detalle a la derecha (en el teléfono, a pantalla completa). Nada se borra ni se edita.
 */
definePageMeta({ permiso: 'bitacora.ver' })

useHead({ title: 'Bitácora · ArgosIsp' })

const route = useRoute()
const router = useRouter()
const { puede } = usePermisos()

const TODOS = 'todos'
const FECHA = /^\d{4}-\d{2}-\d{2}$/

function textoQuery(valor: unknown): string {
    return typeof valor === 'string' ? valor : ''
}

function idQuery(valor: unknown): number {
    const id = Number(textoQuery(valor))
    return Number.isInteger(id) && id > 0 ? id : 0
}

const pestanas = computed<TabsItem[]>(() => [
    { label: 'Acciones', value: 'acciones', icon: 'i-lucide-zap' },
    { label: 'Cambios de datos', value: 'cambios', icon: 'i-lucide-history' },
    ...(puede('red.ver') ? [{ label: 'Órdenes a la red', value: 'red', icon: 'i-lucide-network' }] : []),
])

type PestanaBitacora = 'acciones' | 'cambios' | 'red'
const pestanaQuery = textoQuery(route.query.tab)
const pestana = ref<PestanaBitacora>(pestanaQuery === 'cambios' || pestanaQuery === 'red' ? pestanaQuery : 'acciones')
const clienteId = ref(idQuery(route.query.cliente))
const clienteElegido = shallowRef<Cliente | null>(null)
const filtrosAbiertos = ref(false)

/** Rango rápido del botón de fecha; «Elegir fechas» abre desde y hasta en «Más filtros». */
type Rango = 'todo' | 'hoy' | 'ayer' | 'semana' | 'mes' | 'elegir'
const hoy = hoyGuatemala()
function rangoInicial(): Rango {
    const d = textoQuery(route.query.desde)
    const h = textoQuery(route.query.hasta)
    if (!d && !h) {
        return 'todo'
    }
    if (d === hoy && h === hoy) {
        return 'hoy'
    }
    return 'elegir'
}
const rango = ref<Rango>(rangoInicial())
const itemsRango = computed<SelectItem[]>(() => [
    { label: 'Todas las fechas', value: 'todo' },
    { label: `Hoy, ${formatearFechaCorta(hoy)}`, value: 'hoy' },
    { label: 'Ayer', value: 'ayer' },
    { label: 'Últimos 7 días', value: 'semana' },
    { label: 'Este mes', value: 'mes' },
    { label: 'Elegir fechas…', value: 'elegir' },
])
watch(rango, (valor) => {
    if (valor === 'elegir') {
        filtrosAbiertos.value = true
        return
    }
    const fechas: Record<Exclude<Rango, 'elegir'>, [string, string]> = {
        todo: ['', ''],
        hoy: [hoy, hoy],
        ayer: [sumarDiasFecha(hoy, -1), sumarDiasFecha(hoy, -1)],
        semana: [sumarDiasFecha(hoy, -6), hoy],
        mes: [`${hoy.slice(0, 8)}01`, hoy],
    }
    ;[desde.value, hasta.value] = fechas[valor]
})
const actor = ref(textoQuery(route.query.actor) || TODOS)
const canal = ref<CanalAccion | typeof TODOS>((CANALES_ACCION as readonly string[]).includes(textoQuery(route.query.canal)) ? (textoQuery(route.query.canal) as CanalAccion) : TODOS)
const accion = ref(textoQuery(route.query.accion))
const entidadTipo = ref(textoQuery(route.query.tipo) || TODOS)
const entidadId = ref(idQuery(route.query.entidad) ? String(idQuery(route.query.entidad)) : '')
const desde = ref(FECHA.test(textoQuery(route.query.desde)) ? textoQuery(route.query.desde) : '')
const hasta = ref(FECHA.test(textoQuery(route.query.hasta)) ? textoQuery(route.query.hasta) : '')
const peticion = ref(textoQuery(route.query.peticion))
/** `X-Iris-Conversacion` de las acciones que llegaron de Iris (contrato Iris 0.6.0 §7.1). */
const conversacion = ref(textoQuery(route.query.conversacion))
/* Un filtro de «Más filtros» que llega en la URL se ve aplicado: la sección arranca abierta. */
filtrosAbiertos.value = conversacion.value !== '' || rango.value === 'elegir'
    || (pestana.value === 'acciones' && (entidadTipo.value !== TODOS || entidadId.value !== ''))

const usuarios = shallowRef<UsuarioPanel[]>([])

const detalleAbierto = ref(false)
const elegida = shallowRef<AccionAuditoria | null>(null)

const itemsActor = computed<SelectItem[]>(() => [
    { label: 'Todos los actores', value: TODOS },
    ...usuarios.value.map(u => ({ label: u.nombre, value: String(u.id), description: u.email })),
    ...(actor.value !== TODOS && !usuarios.value.some(u => String(u.id) === actor.value) ? [{ label: `Usuario #${actor.value}`, value: actor.value }] : []),
])

const itemsCanal: SelectItem[] = [
    { label: 'Todos los canales', value: TODOS },
    ...CANALES_ACCION.map(c => ({ label: `${etiquetaCanal(c)} (${c})`, value: c })),
]

const itemsAccion = computed<SelectMenuItem[]>(() => {
    const items = ACCIONES_CONOCIDAS.map(a => ({ label: a.etiqueta, value: a.accion, description: a.accion }))
    if (accion.value && !items.some(i => i.value === accion.value)) {
        items.unshift({ label: accion.value, value: accion.value, description: 'Acción escrita a mano' })
    }
    return items
})

const itemsEntidad: SelectItem[] = [
    { label: 'Todas las entidades', value: TODOS },
    ...Object.entries(ENTIDADES_BITACORA).map(([tipo, datos]) => ({ label: datos.etiqueta, value: tipo })),
]

function filtrosEntidad(): { entidad_tipo?: string, entidad_id?: number } {
    const resultado: { entidad_tipo?: string, entidad_id?: number } = {}
    if (entidadTipo.value !== TODOS) {
        resultado.entidad_tipo = entidadTipo.value
    }
    const id = Number(entidadId.value)
    if (Number.isInteger(id) && id > 0) {
        resultado.entidad_id = id
    }
    return resultado
}

function filtrosAcciones(): FiltrosAcciones {
    const resultado: FiltrosAcciones = { ...filtrosEntidad() }
    if (clienteId.value) {
        resultado.cliente_id = clienteId.value
    }
    if (actor.value !== TODOS) {
        resultado.actor_id = Number(actor.value)
    }
    if (canal.value !== TODOS) {
        resultado.canal = canal.value
    }
    if (accion.value) {
        resultado.accion = accion.value
    }
    // Días elegidos en hora de Guatemala; la API recibe instantes UTC.
    if (desde.value) {
        resultado.desde = inicioDiaGuatemala(desde.value)
    }
    if (hasta.value) {
        resultado.hasta = finDiaGuatemala(hasta.value)
    }
    if (peticion.value) {
        resultado.request_id = peticion.value
    }
    if (conversacion.value.trim()) {
        resultado.iris_conversacion = conversacion.value.trim()
    }
    return resultado
}

function filtrosCambios(): FiltrosCambios {
    const resultado: FiltrosCambios = { ...filtrosEntidad() }
    if (peticion.value) {
        resultado.request_id = peticion.value
    }
    return resultado
}

const listaAcciones = usePaginacionCursor(cursor => useBitacora().acciones(filtrosAcciones(), cursor))
const listaCambios = usePaginacionCursor(cursor => useBitacora().cambios(filtrosCambios(), cursor))

/** Órdenes a la red (`GET /red/eventos`, `red.ver`): cada CoA, Disconnect o comando a RouterOS. */
function filtrosRed(): FiltrosEventosRed {
    const resultado: FiltrosEventosRed = {}
    if (entidadTipo.value === 'servicio' && Number(entidadId.value) > 0) {
        resultado.servicio_id = Number(entidadId.value)
    }
    if (entidadTipo.value === 'router' && Number(entidadId.value) > 0) {
        resultado.router_id = Number(entidadId.value)
    }
    if (desde.value) {
        resultado.desde = inicioDiaGuatemala(desde.value)
    }
    if (hasta.value) {
        resultado.hasta = finDiaGuatemala(hasta.value)
    }
    return resultado
}
const listaRed = usePaginacionCursor(cursor => useRed().eventos(filtrosRed(), cursor))
const lista = computed(() => (pestana.value === 'cambios' ? listaCambios : pestana.value === 'red' ? listaRed : listaAcciones))

const columnasAcciones: TableColumn<AccionAuditoria>[] = [
    { accessorKey: 'created_at', header: 'Hora', meta: SOLO_ANCHO },
    { accessorKey: 'actor_id', header: 'Quién', meta: { class: { th: 'max-md:hidden', td: 'max-md:hidden' } } },
    { accessorKey: 'canal', header: 'Desde', meta: { class: { th: 'max-2xl:hidden', td: 'max-2xl:hidden' } } },
    { accessorKey: 'accion', header: 'Qué hizo' },
    { accessorKey: 'entidad_tipo', header: 'Sobre qué', meta: { class: { th: 'max-2xl:hidden', td: 'max-2xl:hidden' } } },
    { accessorKey: 'resultado', header: 'Resultado' },
]

const columnasRed: TableColumn<EventoRed>[] = [
    { accessorKey: 'created_at', header: 'Hora', meta: SOLO_ANCHO },
    { accessorKey: 'tipo', header: 'Orden' },
    { accessorKey: 'router_nombre', header: 'Router y servicio', meta: SOLO_ANCHO },
    { accessorKey: 'respuesta', header: 'Respuesta del equipo', meta: SOLO_ESCRITORIO },
    { accessorKey: 'ok', header: 'Resultado' },
]

/** Hora si es de hoy; si no, fecha y hora. */
function horaFila(instante: string): string {
    return fechaGuatemala(instante) === hoy ? formatearHora(instante) : formatearFechaHora(instante)
}

const TONO_CANAL: Record<string, string> = { panel: 'tono-marca', portal: 'tono-1', ia: 'tono-2', api: 'tono-3', cron: 'tono-4', worker: 'tono-4', webhook: 'tono-5' }

const metaAcciones = metaFilaElegida<AccionAuditoria>(fila => fila.id === elegida.value?.id)

/** CSV de lo que está en pantalla, con el nombre técnico en su columna (decisión 11). */
function descargarFiltrado() {
    const filas = listaAcciones.filas.value
    const celdas = (valores: (string | number | null)[]) => valores.map(v => `"${String(v ?? '').replaceAll('"', '""')}"`).join(',')
    const lineas = [
        celdas(['Fecha y hora (Guatemala)', 'Quién', 'Desde', 'Qué hizo', 'Acción (nombre técnico)', 'Sobre qué', 'Resultado', 'Error', 'Petición']),
        ...filas.map(a => celdas([formatearFechaHora(a.created_at), etiquetaActor(a), etiquetaCanal(a.canal), tituloAccion(a), a.accion, etiquetaEntidad(a), a.resultado === 'ok' ? 'Correcto' : 'Error', a.error, a.request_id])),
    ]
    const url = URL.createObjectURL(new Blob([`\uFEFF${lineas.join('\n')}`], { type: 'text/csv;charset=utf-8' }))
    const enlace = document.createElement('a')
    enlace.href = url
    enlace.download = `bitacora-${hoy}.csv`
    enlace.click()
    setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

const columnasCambios: TableColumn<CambioAuditoria>[] = [
    { accessorKey: 'created_at', header: 'Fecha', meta: SOLO_ANCHO },
    { accessorKey: 'campo', header: 'Campo' },
    { accessorKey: 'antes', header: 'Antes', meta: SOLO_ANCHO },
    { accessorKey: 'despues', header: 'Después' },
    { accessorKey: 'actor_id', header: 'Actor', meta: SOLO_ESCRITORIO },
]

const hayFiltros = computed(() => clienteId.value !== 0 || actor.value !== TODOS || canal.value !== TODOS || accion.value !== ''
    || entidadTipo.value !== TODOS || entidadId.value !== '' || desde.value !== '' || hasta.value !== '' || peticion.value !== '' || conversacion.value !== '')

/** Actor de un cambio: `actor_nombre` de la API (A1, día 4); si falta, el de `GET /usuarios`. */
function nombreActor(tipo: string | null, id: number | null, nombre?: string | null): string {
    if (nombre) {
        return nombre
    }
    if (id === null) {
        return tipo === 'sistema' || tipo === null ? 'Sistema' : tipo
    }
    return usuarios.value.find(u => u.id === id)?.nombre ?? `${tipo === 'token' ? 'Token' : 'Usuario'} #${id}`
}

async function aplicarFiltros() {
    const query: Record<string, string> = {}
    if (pestana.value !== 'acciones') {
        query.tab = pestana.value
    }
    if (clienteId.value) {
        query.cliente = String(clienteId.value)
    }
    if (actor.value !== TODOS) {
        query.actor = actor.value
    }
    if (canal.value !== TODOS) {
        query.canal = canal.value
    }
    if (accion.value) {
        query.accion = accion.value
    }
    if (entidadTipo.value !== TODOS) {
        query.tipo = entidadTipo.value
    }
    if (entidadId.value) {
        query.entidad = entidadId.value
    }
    if (desde.value) {
        query.desde = desde.value
    }
    if (hasta.value) {
        query.hasta = hasta.value
    }
    if (peticion.value) {
        query.peticion = peticion.value
    }
    if (conversacion.value.trim()) {
        query.conversacion = conversacion.value.trim()
    }
    await router.replace({ query })
    await lista.value.recargar()
    if (pestana.value === 'acciones' && esEscritorio() && !listaAcciones.filas.value.some(a => a.id === elegida.value?.id)) {
        elegida.value = listaAcciones.filas.value[0] ?? null
    }
}

function limpiarFiltros() {
    clienteId.value = 0
    clienteElegido.value = null
    rango.value = 'todo'
    actor.value = TODOS
    canal.value = TODOS
    accion.value = ''
    entidadTipo.value = TODOS
    entidadId.value = ''
    desde.value = ''
    hasta.value = ''
    peticion.value = ''
    conversacion.value = ''
}

/** Con varias empresas, cada acción dice de cuál es (A1: `empresa_id`/`empresa_nombre`; null = del grupo). */
const { conSelector: variasEmpresas } = useEmpresaActiva()

function verDetalle(fila: AccionAuditoria) {
    elegida.value = fila
    detalleAbierto.value = !esEscritorio()
}

function filtrarActor(actorId: number) {
    detalleAbierto.value = false
    limpiarFiltros()
    actor.value = String(actorId)
}

function filtrarPeticion(requestId: string) {
    detalleAbierto.value = false
    limpiarFiltros()
    peticion.value = requestId
}

function filtrarConversacion(id: string) {
    detalleAbierto.value = false
    limpiarFiltros()
    conversacion.value = id
}

function verCambios(tipo: string, id: number) {
    detalleAbierto.value = false
    limpiarFiltros()
    entidadTipo.value = tipo
    entidadId.value = String(id)
    pestana.value = 'cambios'
}

let temporizador: ReturnType<typeof setTimeout> | undefined
watch([entidadId, conversacion], () => {
    clearTimeout(temporizador)
    temporizador = setTimeout(aplicarFiltros, 300)
})
watch([pestana, clienteId, actor, canal, accion, entidadTipo, desde, hasta, peticion], aplicarFiltros)
onBeforeUnmount(() => clearTimeout(temporizador))

onMounted(async () => {
    void aplicarFiltros()
    if (puede('usuarios.ver')) {
        const resultado = await useUsuarios().listar()
        usuarios.value = resultado.ok ? resultado.data.data : []
    }
})
</script>

<template>
    <PanelPagina
        id="bitacora"
        titulo="Bitácora"
        icono="i-lucide-scroll-text"
        descripcion="Quién hizo qué, cuándo y desde dónde. Nada se borra ni se edita."
    >
        <template #acciones>
            <UButton
                v-if="pestana === 'acciones'"
                label="Descargar lo filtrado"
                :icon="ICONOS.exportar"
                color="neutral"
                variant="outline"
                size="lg"
                class="boton-flotante"
                :disabled="!listaAcciones.filas.value.length"
                title="Descarga en CSV lo que ves en esta página, con el nombre técnico de cada acción"
                data-prueba="descargar-bitacora"
                @click="descargarFiltrado"
            />
        </template>

        <div class="grid gap-4 lg:min-h-0 lg:flex-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
            <section class="surface-card flex min-h-0 min-w-0 flex-col overflow-hidden rounded-[1.375rem] lg:max-h-[calc(100dvh-11rem)]">
                <div class="flex flex-col gap-3 border-b border-(--ax-borde) p-3 sm:p-4">
                    <div class="flex flex-wrap items-center justify-between gap-2">
                        <OperPestanas
                            v-model="pestana"
                            :items="pestanas"
                            etiqueta="Qué ver"
                            class="w-auto"
                        />
                        <USelect
                            v-if="pestana !== 'cambios'"
                            v-model="rango"
                            :items="itemsRango"
                            icon="i-lucide-calendar"
                            aria-label="Fechas"
                            class="w-full sm:w-48"
                            data-prueba="rango-bitacora"
                        />
                    </div>
                    <div class="flex flex-wrap items-center gap-2">
                        <template v-if="pestana === 'acciones'">
                            <ClienteSelector
                                v-if="puede('clientes.ver')"
                                v-model="clienteId"
                                :seleccionado="clienteElegido"
                                placeholder="Cliente: nombre, NIT o teléfono"
                                aria-label="Filtrar por cliente"
                                class="w-full min-w-0 sm:min-w-52 sm:flex-1"
                                @elegido="clienteElegido = $event"
                            />
                            <USelect
                                v-if="puede('usuarios.ver')"
                                v-model="actor"
                                :items="itemsActor"
                                icon="i-lucide-user"
                                aria-label="Filtrar por quién"
                                class="w-full sm:w-44"
                            />
                            <UInput
                                v-else
                                :model-value="actor === TODOS ? '' : actor"
                                inputmode="numeric"
                                icon="i-lucide-user"
                                placeholder="ID de quién"
                                aria-label="Filtrar por id del actor"
                                class="w-full sm:w-40"
                                @update:model-value="actor = String($event).trim() || TODOS"
                            />
                            <USelectMenu
                                v-model="accion"
                                :items="itemsAccion"
                                value-key="value"
                                icon="i-lucide-zap"
                                placeholder="Acción: todas"
                                :search-input="{ placeholder: 'Buscar acción…' }"
                                aria-label="Filtrar por acción"
                                class="w-full sm:w-48"
                            />
                            <USelect
                                v-model="canal"
                                :items="itemsCanal"
                                icon="i-lucide-message-square"
                                aria-label="Filtrar por desde dónde"
                                class="w-full sm:w-44"
                            />
                        </template>
                        <template v-else>
                            <USelect
                                v-model="entidadTipo"
                                :items="itemsEntidad"
                                icon="i-lucide-box"
                                aria-label="Filtrar por tipo de entidad"
                                class="w-full sm:w-52"
                            />
                            <UInput
                                v-model="entidadId"
                                inputmode="numeric"
                                icon="i-lucide-hash"
                                placeholder="ID de la entidad"
                                aria-label="Filtrar por id de la entidad"
                                class="w-full sm:w-44"
                            />
                        </template>
                        <UButton
                            icon="i-lucide-filter"
                            label="Más filtros"
                            color="neutral"
                            :variant="filtrosAbiertos ? 'subtle' : 'outline'"
                            :aria-expanded="filtrosAbiertos"
                            aria-controls="filtros-bitacora"
                            @click="filtrosAbiertos = !filtrosAbiertos"
                        />
                        <UButton
                            v-if="hayFiltros"
                            label="Limpiar"
                            icon="i-lucide-filter-x"
                            color="neutral"
                            variant="ghost"
                            @click="limpiarFiltros"
                        />
                    </div>
                    <div
                        v-show="filtrosAbiertos"
                        id="filtros-bitacora"
                        class="grid gap-3 rounded-xl bg-(--ax-panel) p-3 sm:grid-cols-2 xl:grid-cols-4"
                        role="group"
                        aria-label="Más filtros de la bitácora"
                    >
                        <template v-if="pestana === 'acciones'">
                            <UFormField
                                label="Entidad"
                                size="sm"
                            >
                                <USelect
                                    v-model="entidadTipo"
                                    :items="itemsEntidad"
                                    icon="i-lucide-box"
                                    aria-label="Filtrar por tipo de entidad"
                                    class="w-full"
                                />
                            </UFormField>
                            <UFormField
                                label="ID de la entidad"
                                size="sm"
                            >
                                <UInput
                                    v-model="entidadId"
                                    inputmode="numeric"
                                    icon="i-lucide-hash"
                                    aria-label="Filtrar por id de la entidad"
                                    class="w-full"
                                />
                            </UFormField>
                            <UFormField
                                label="Conversación de Iris"
                                size="sm"
                            >
                                <UInput
                                    v-model="conversacion"
                                    icon="i-lucide-messages-square"
                                    aria-label="Filtrar por conversación de Iris"
                                    class="w-full font-mono"
                                    data-prueba="filtro-conversacion-iris"
                                />
                            </UFormField>
                        </template>
                        <template v-if="pestana !== 'cambios'">
                            <UFormField
                                label="Desde"
                                size="sm"
                            >
                                <CampoFecha
                                    v-model="desde"
                                    :max="hasta || undefined"
                                    class="w-full"
                                    @update:model-value="rango = 'elegir'"
                                />
                            </UFormField>
                            <UFormField
                                label="Hasta"
                                size="sm"
                                help="Hora de Guatemala"
                            >
                                <CampoFecha
                                    v-model="hasta"
                                    :min="desde || undefined"
                                    class="w-full"
                                    @update:model-value="rango = 'elegir'"
                                />
                            </UFormField>
                        </template>
                        <p
                            v-if="pestana === 'cambios'"
                            class="text-xs text-muted sm:col-span-2"
                        >
                            Elige un tipo de entidad y su id para ver su historial campo por campo.
                        </p>
                    </div>
                    <div
                        v-if="peticion || (conversacion && pestana === 'acciones')"
                        class="flex flex-wrap gap-2"
                    >
                        <UBadge
                            v-if="conversacion && pestana === 'acciones'"
                            :label="`Conversación de Iris ${conversacion}`"
                            icon="i-lucide-messages-square"
                            color="info"
                            variant="subtle"
                            class="max-w-full truncate font-mono"
                        />
                        <UBadge
                            v-if="peticion"
                            :label="`Petición ${peticion}`"
                            icon="i-lucide-link"
                            color="info"
                            variant="subtle"
                            class="max-w-full truncate font-mono"
                        />
                    </div>
                </div>

                <div
                    v-if="lista.problema.value"
                    class="p-4"
                >
                    <ProblemaAlerta
                        :problema="lista.problema.value"
                        :reintentar="lista.recargar"
                        :reintentando="lista.cargando.value"
                    />
                </div>

                <template v-else>
                    <div class="min-h-0 flex-1 overflow-y-auto">
                        <UTable
                            v-if="pestana === 'acciones'"
                            :data="listaAcciones.filas.value"
                            :columns="columnasAcciones"
                            :loading="listaAcciones.cargando.value"
                            :meta="metaAcciones"
                            sticky
                            :ui="{ root: 'rounded-none bg-transparent ring-0 shadow-none dark:shadow-none', td: 'py-3' }"
                            @select="(_evento, fila) => verDetalle(fila.original)"
                        >
                            <template #created_at-cell="{ row }">
                                <span class="text-sm whitespace-nowrap tabular-nums">{{ horaFila(row.original.created_at) }}</span>
                            </template>
                            <template #actor_id-cell="{ row }">
                                <div class="flex max-w-44 items-center gap-2">
                                    <AvatarIniciales
                                        :nombre="etiquetaActor(row.original)"
                                        size="sm"
                                    />
                                    <span class="truncate text-sm font-semibold text-highlighted">{{ etiquetaActor(row.original) }}</span>
                                </div>
                            </template>
                            <template #canal-cell="{ row }">
                                <span
                                    class="pastilla-tono rounded-full px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap"
                                    :class="TONO_CANAL[row.original.canal] ?? 'tono-marca'"
                                >{{ etiquetaCanal(row.original.canal) }}</span>
                            </template>
                            <template #accion-cell="{ row }">
                                <div class="flex min-w-40 flex-col">
                                    <span class="text-sm font-semibold text-highlighted">{{ tituloAccion(row.original) }}</span>
                                    <span
                                        class="max-w-56 truncate font-mono text-xs text-muted"
                                        data-prueba="accion-tecnica"
                                    >{{ row.original.accion }}</span>
                                    <span class="text-xs text-muted 2xl:hidden"><span class="md:hidden">{{ etiquetaActor(row.original) }} · </span>{{ etiquetaCanal(row.original.canal) }}<template v-if="etiquetaEntidad(row.original)"> · {{ etiquetaEntidad(row.original) }}</template></span>
                                    <span class="text-xs text-muted sm:hidden">{{ horaFila(row.original.created_at) }}</span>
                                    <ULink
                                        v-if="row.original.iris_conversacion"
                                        class="max-w-56 truncate text-xs text-info hover:text-primary"
                                        :title="origenIris(row.original) ?? undefined"
                                        data-prueba="origen-iris"
                                        @click.stop="filtrarConversacion(row.original.iris_conversacion)"
                                    >{{ origenIris(row.original) }}</ULink>
                                    <span
                                        v-else-if="origenIris(row.original)"
                                        class="text-xs text-info"
                                        data-prueba="origen-iris"
                                    >{{ origenIris(row.original) }}</span>
                                    <span
                                        v-if="variasEmpresas && row.original.empresa_nombre"
                                        class="text-xs text-muted"
                                        :data-empresa-accion="row.original.empresa_id"
                                    >{{ row.original.empresa_nombre }}</span>
                                    <span
                                        v-if="motivoAccion(row.original)"
                                        class="line-clamp-2 text-xs whitespace-normal text-muted"
                                    >Motivo: {{ motivoAccion(row.original) }}</span>
                                </div>
                            </template>
                            <template #entidad_tipo-cell="{ row }">
                                <ULink
                                    v-if="rutaEntidad(row.original.entidad_tipo, row.original.entidad_id)"
                                    :to="rutaEntidad(row.original.entidad_tipo, row.original.entidad_id) ?? undefined"
                                    class="block max-w-48 truncate text-sm text-default hover:text-primary"
                                    @click.stop
                                >
                                    {{ etiquetaEntidad(row.original) }}
                                </ULink>
                                <span
                                    v-else
                                    class="block max-w-48 truncate text-sm"
                                >{{ etiquetaEntidad(row.original) ?? '—' }}</span>
                            </template>
                            <template #resultado-cell="{ row }">
                                <UBadge
                                    :label="row.original.resultado === 'ok' ? 'Correcto' : 'Rechazado'"
                                    :icon="row.original.resultado === 'ok' ? 'i-lucide-circle-check' : 'i-lucide-circle-x'"
                                    :color="row.original.resultado === 'ok' ? 'success' : 'error'"
                                    variant="subtle"
                                    size="sm"
                                    :title="row.original.error ?? undefined"
                                />
                            </template>
                            <template #empty>
                                <UEmpty
                                    icon="i-lucide-search-x"
                                    :title="hayFiltros ? 'Ninguna acción coincide' : 'La bitácora está vacía'"
                                    variant="naked"
                                />
                            </template>
                        </UTable>

                        <UTable
                            v-else-if="pestana === 'cambios'"
                            :data="listaCambios.filas.value"
                            :columns="columnasCambios"
                            :loading="listaCambios.cargando.value"
                            sticky
                            :ui="{ root: 'rounded-none bg-transparent ring-0 shadow-none dark:shadow-none', td: 'py-3' }"
                        >
                            <template #created_at-cell="{ row }">
                                <span class="text-sm whitespace-nowrap">{{ formatearFechaHora(row.original.created_at) }}</span>
                            </template>
                            <template #campo-cell="{ row }">
                                <div class="flex flex-col">
                                    <span class="text-sm font-semibold text-highlighted">{{ nombreCampoCambio(row.original.campo) }}</span>
                                    <span class="text-xs text-muted">
                                        <ULink
                                            v-if="rutaEntidad(row.original.entidad_tipo, row.original.entidad_id)"
                                            :to="rutaEntidad(row.original.entidad_tipo, row.original.entidad_id) ?? undefined"
                                            class="hover:text-primary"
                                        >{{ ENTIDADES_BITACORA[row.original.entidad_tipo]?.etiqueta ?? row.original.entidad_tipo }} {{ row.original.entidad_id }}</ULink>
                                        <template v-else>{{ ENTIDADES_BITACORA[row.original.entidad_tipo]?.etiqueta ?? row.original.entidad_tipo }} {{ row.original.entidad_id }}</template>
                                    </span>
                                    <span class="text-xs text-muted sm:hidden">{{ formatearFechaHora(row.original.created_at) }}</span>
                                </div>
                            </template>
                            <template #antes-cell="{ row }">
                                <span
                                    class="rounded-md px-1.5 py-0.5 font-mono text-xs break-all whitespace-normal"
                                    :class="row.original.antes === null ? 'text-dimmed' : 'bg-error/10 text-error line-through'"
                                >{{ valorCambio(row.original.antes) }}</span>
                            </template>
                            <template #despues-cell="{ row }">
                                <div class="flex flex-col gap-1">
                                    <span
                                        class="self-start rounded-md px-1.5 py-0.5 font-mono text-xs break-all whitespace-normal"
                                        :class="row.original.despues === null ? 'text-dimmed' : 'bg-success/10 text-success'"
                                        :data-campo="nombreCampoCambio(row.original.campo)"
                                    >{{ valorCambio(row.original.despues) }}</span>
                                    <span class="font-mono text-xs text-muted sm:hidden">antes: {{ valorCambio(row.original.antes) }}</span>
                                </div>
                            </template>
                            <template #actor_id-cell="{ row }">
                                <span class="text-sm">{{ nombreActor(row.original.actor_tipo, row.original.actor_id, row.original.actor_nombre) }}</span>
                            </template>
                            <template #empty>
                                <UEmpty
                                    icon="i-lucide-history"
                                    :title="hayFiltros ? 'Sin cambios para estos filtros' : 'Sin cambios registrados'"
                                    description="Elige un tipo de entidad y su id para ver su historial campo por campo."
                                    variant="naked"
                                />
                            </template>
                        </UTable>

                        <UTable
                            v-else
                            :data="listaRed.filas.value"
                            :columns="columnasRed"
                            :loading="listaRed.cargando.value"
                            sticky
                            :ui="{ root: 'rounded-none bg-transparent ring-0 shadow-none dark:shadow-none', td: 'py-3 align-top' }"
                            data-prueba="ordenes-red"
                        >
                            <template #created_at-cell="{ row }">
                                <span class="text-sm whitespace-nowrap tabular-nums">{{ horaFila(row.original.created_at) }}</span>
                            </template>
                            <template #tipo-cell="{ row }">
                                <div class="flex max-w-72 flex-col">
                                    <span class="font-mono text-sm font-semibold text-highlighted">{{ row.original.tipo }}</span>
                                    <span class="truncate font-mono text-xs text-muted">{{ row.original.comando }}</span>
                                </div>
                            </template>
                            <template #router_nombre-cell="{ row }">
                                <div class="flex flex-col text-sm">
                                    <span>{{ row.original.router_nombre ?? '—' }}</span>
                                    <ULink
                                        v-if="row.original.servicio_id && puede('servicios.ver')"
                                        :to="`/servicios/${row.original.servicio_id}`"
                                        class="text-xs text-muted hover:text-primary"
                                    >Servicio {{ row.original.servicio_id }}</ULink>
                                </div>
                            </template>
                            <template #respuesta-cell="{ row }">
                                <span class="line-clamp-2 max-w-72 font-mono text-xs whitespace-normal text-muted">{{ row.original.respuesta ?? '—' }}</span>
                            </template>
                            <template #ok-cell="{ row }">
                                <UBadge
                                    :label="row.original.ok ? 'Correcto' : 'Falló'"
                                    :icon="row.original.ok ? 'i-lucide-circle-check' : 'i-lucide-circle-x'"
                                    :color="row.original.ok ? 'success' : 'error'"
                                    variant="subtle"
                                    size="sm"
                                />
                            </template>
                            <template #empty>
                                <UEmpty
                                    icon="i-lucide-network"
                                    title="Sin órdenes a la red con estos filtros"
                                    variant="naked"
                                />
                            </template>
                        </UTable>
                    </div>

                    <footer class="flex flex-col gap-2 border-t border-(--ax-borde) px-4 py-2 text-xs text-muted sm:flex-row sm:items-center sm:justify-between">
                        <PaginacionCursor
                            :pagina="lista.pagina.value"
                            :hay-anterior="lista.hayAnterior.value"
                            :hay-siguiente="lista.haySiguiente.value"
                            :cargando="lista.cargando.value"
                            :filas="lista.filas.value.length"
                            @anterior="lista.anterior"
                            @siguiente="lista.siguiente"
                        />
                        <span class="shrink-0">Los sondeos y evaluaciones sin efecto no dejan fila.</span>
                    </footer>
                </template>
            </section>

            <BitacoraDetalle
                v-if="pestana === 'acciones' && elegida"
                :accion="elegida"
                class="hidden lg:flex lg:max-h-[calc(100dvh-11rem)]"
                @peticion="filtrarPeticion"
                @cambios="verCambios"
                @actor="filtrarActor"
            />
            <div
                v-else
                class="surface-card hidden items-center justify-center rounded-[1.375rem] p-6 lg:flex"
            >
                <UEmpty
                    icon="i-lucide-mouse-pointer-click"
                    :title="pestana === 'acciones' ? 'Elige una acción' : 'Historial y órdenes'"
                    :description="pestana === 'acciones' ? 'Aquí ves qué cambió, los detalles y lo demás de la misma petición.' : 'Cada fila ya muestra todo lo que se guardó.'"
                    variant="naked"
                />
            </div>
        </div>

        <USlideover
            v-model:open="detalleAbierto"
            :title="elegida ? tituloAccion(elegida) : 'Entrada'"
            :description="elegida ? elegida.accion : undefined"
            :ui="{ body: 'p-0 sm:p-0' }"
        >
            <template #body>
                <BitacoraDetalle
                    v-if="elegida"
                    :accion="elegida"
                    sin-encabezado
                    class="h-full rounded-none border-0 shadow-none"
                    @peticion="filtrarPeticion"
                    @cambios="verCambios"
                    @actor="filtrarActor"
                />
            </template>
        </USlideover>
    </PanelPagina>
</template>
