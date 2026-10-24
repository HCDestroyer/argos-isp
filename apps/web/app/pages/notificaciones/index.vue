<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { SelectItem, TabsItem, TableColumn } from '@nuxt/ui'

/**
 * Avisos a clientes y al equipo (A6, brief semana 2): plantillas por evento y canal con su editor
 * y las variables del evento, los tres recordatorios de pago y el registro de envíos con su
 * estado, error o motivo. Leer pide `notificaciones.ver`; editar, `notificaciones.editar`. Los
 * canales (SMTP, bot de Telegram) se configuran en Configuración → Notificaciones.
 */
definePageMeta({ permiso: 'notificaciones.ver' })

useHead({ title: 'Plantillas de avisos · ArgosIsp' })

const route = useRoute()
const router = useRouter()
const toast = useToast()
const { puede } = usePermisos()
const nombres = useNombresClientes()

type Pestana = 'plantillas' | 'recordatorios' | 'envios'
const PESTANAS: Pestana[] = ['plantillas', 'recordatorios', 'envios']
const pestana = ref<Pestana>(PESTANAS.includes(route.query.tab as Pestana) ? route.query.tab as Pestana : 'plantillas')
const pestanas: TabsItem[] = [
    { label: 'Plantillas', value: 'plantillas', icon: 'i-lucide-file-text' },
    { label: 'Recordatorios', value: 'recordatorios', icon: 'i-lucide-alarm-clock' },
    { label: 'Envíos', value: 'envios', icon: 'i-lucide-send' },
]
watch(pestana, valor => void router.replace({ query: { ...route.query, tab: valor } }))

const TODOS = 'todos'

/* Plantillas */
const plantillas = shallowRef<PlantillaNotificacion[]>([])
const cargandoPlantillas = ref(false)
const problemaPlantillas = ref<Problem | null>(null)
const grupo = ref<GrupoEvento | typeof TODOS>('cliente')
const canal = ref<CanalAviso | typeof TODOS>(TODOS)
const itemsGrupo: SelectItem[] = [
    { label: 'Todos los eventos', value: TODOS },
    ...(Object.keys(GRUPOS_EVENTO) as GrupoEvento[]).map(g => ({ label: GRUPOS_EVENTO[g], value: g })),
]
const itemsCanal: SelectItem[] = [
    { label: 'Todos los canales', value: TODOS },
    ...(Object.keys(CANALES_AVISO) as CanalAviso[]).map(c => ({ label: CANALES_AVISO[c].etiqueta, value: c, icon: CANALES_AVISO[c].icono })),
]

async function cargarPlantillas() {
    cargandoPlantillas.value = true
    const resultado = await usePlantillasNotificacion().listar()
    cargandoPlantillas.value = false
    plantillas.value = resultado.ok ? resultado.data : []
    problemaPlantillas.value = resultado.ok ? null : resultado.problema
}

const filasPlantillas = computed(() => plantillas.value
    .filter(p => grupo.value === TODOS || grupoEvento(p.evento) === grupo.value)
    .filter(p => canal.value === TODOS || p.canal === canal.value)
    .sort((a, b) => etiquetaEvento(a.evento).localeCompare(etiquetaEvento(b.evento)) || a.canal.localeCompare(b.canal)))

const columnasPlantillas: TableColumn<PlantillaNotificacion>[] = [
    { accessorKey: 'evento', header: 'Evento', meta: { class: { td: 'whitespace-normal' } } },
    { accessorKey: 'canal', header: 'Canal', meta: SOLO_ANCHO },
    { id: 'texto', header: 'Mensaje', meta: { class: { th: 'hidden lg:table-cell', td: 'hidden lg:table-cell whitespace-normal' } } },
    { id: 'acciones', header: '', meta: { class: { td: 'text-right w-0' } } },
]

const editando = shallowRef<PlantillaNotificacion | null>(null)
const editorAbierto = ref(false)

function editar(plantilla: PlantillaNotificacion) {
    editando.value = plantilla
    editorAbierto.value = true
}

function alGuardarPlantilla(plantilla: PlantillaNotificacion) {
    plantillas.value = plantillas.value.map(p => (p.id === plantilla.id ? plantilla : p))
    toast.add({ title: 'Plantilla guardada', description: `${etiquetaEvento(plantilla.evento)} · ${CANALES_AVISO[plantilla.canal].etiqueta}`, color: 'success', icon: 'i-lucide-circle-check' })
}

function resumen(texto: string): string {
    return texto.length > 140 ? `${texto.slice(0, 140)}…` : texto
}

/* Recordatorios */
const recordatorios = shallowRef<RecordatorioPago[]>([])
const cargandoRecordatorios = ref(false)
const problemaRecordatorios = ref<Problem | null>(null)
const recordatorio = shallowRef<RecordatorioPago | null>(null)
const recordatorioAbierto = ref(false)

async function cargarRecordatorios() {
    cargandoRecordatorios.value = true
    const resultado = await useRecordatoriosPago().listar()
    cargandoRecordatorios.value = false
    recordatorios.value = resultado.ok ? [...resultado.data].sort((a, b) => a.orden - b.orden) : []
    problemaRecordatorios.value = resultado.ok ? null : resultado.problema
}

function editarRecordatorio(r: RecordatorioPago) {
    recordatorio.value = r
    recordatorioAbierto.value = true
}

function alGuardarRecordatorio(r: RecordatorioPago) {
    recordatorios.value = recordatorios.value.map(x => (x.id === r.id ? r : x))
    toast.add({ title: `Recordatorio ${r.orden} guardado`, description: `${diasRecordatorio(r.dias)} · ${r.hora.slice(0, 5)} h`, color: 'success', icon: 'i-lucide-circle-check' })
}

/* Envíos */
const filtroCanal = ref<CanalAviso | typeof TODOS>(TODOS)
const filtroEstado = ref<EnvioNotificacion['estado'] | typeof TODOS>(TODOS)
const filtroEvento = ref('')
const clienteId = ref(0)
const clienteElegido = shallowRef<Cliente | null>(null)
const itemsEstado: SelectItem[] = [
    { label: 'Todos los estados', value: TODOS },
    ...(Object.keys(ESTADOS_ENVIO) as EnvioNotificacion['estado'][]).map(e => ({ label: ESTADOS_ENVIO[e].etiqueta, value: e })),
]

function filtrosEnvios(): FiltrosEnvios {
    const filtros: FiltrosEnvios = {}
    if (filtroCanal.value !== TODOS) {
        filtros.canal = filtroCanal.value
    }
    if (filtroEstado.value !== TODOS) {
        filtros.estado = filtroEstado.value
    }
    if (filtroEvento.value.trim()) {
        filtros.evento = filtroEvento.value.trim()
    }
    if (clienteId.value) {
        filtros.cliente_id = clienteId.value
    }
    return filtros
}

const envios = usePaginacionCursor(cursor => useEnviosNotificacion().listar(filtrosEnvios(), cursor))

watch(() => envios.filas.value, (filas) => {
    if (puede('clientes.ver')) {
        void nombres.cargar(filas.map(e => e.cliente_id).filter((id): id is number => id !== null))
    }
})

let esperaEvento: ReturnType<typeof setTimeout> | undefined
watch([filtroCanal, filtroEstado, clienteId], () => void envios.recargar())
watch(filtroEvento, () => {
    clearTimeout(esperaEvento)
    esperaEvento = setTimeout(() => void envios.recargar(), 400)
})
onBeforeUnmount(() => clearTimeout(esperaEvento))

function alElegirCliente(cliente: Cliente) {
    clienteElegido.value = cliente
    nombres.recordar(cliente.id, cliente.nombre)
}

const columnasEnvios: TableColumn<EnvioNotificacion>[] = [
    { id: 'fecha', header: 'Fecha', meta: SOLO_ANCHO },
    { accessorKey: 'evento', header: 'Aviso', meta: { class: { td: 'whitespace-normal' } } },
    { id: 'cliente', header: 'Cliente', meta: SOLO_ESCRITORIO },
    { accessorKey: 'estado', header: 'Estado' },
    { id: 'acciones', header: '', meta: { class: { td: 'text-right w-0' } } },
]

const envio = shallowRef<EnvioNotificacion | null>(null)
const envioAbierto = ref(false)

function verEnvio(e: EnvioNotificacion) {
    envio.value = e
    envioAbierto.value = true
}

function nombreCliente(id: number | null): string {
    return id === null ? 'Equipo' : nombres.nombre(id)
}

const cargados = new Set<Pestana>()
function cargarPestana(valor: Pestana) {
    if (cargados.has(valor)) {
        return
    }
    cargados.add(valor)
    if (valor === 'plantillas') {
        void cargarPlantillas()
    }
    else if (valor === 'recordatorios') {
        void cargarRecordatorios()
    }
    else {
        void envios.recargar()
    }
}
watch(pestana, cargarPestana)
onMounted(() => cargarPestana(pestana.value))
</script>

<template>
    <PanelPagina
        id="notificaciones-plantillas"
        titulo="Plantillas de avisos"
        icono="i-lucide-message-square-text"
    >
        <div class="flex flex-col gap-4">
            <UTabs
                v-model="pestana"
                :items="pestanas"
                :content="false"
                variant="link"
                class="w-full"
                data-prueba="avisos-pestanas"
            />

            <!-- Plantillas -->
            <template v-if="pestana === 'plantillas'">
                <p class="text-sm text-muted">
                    Un texto por evento y canal. Los canales y qué tipos de aviso se mandan se configuran en Configuración → Notificaciones.
                </p>
                <ProblemaAlerta
                    v-if="problemaPlantillas"
                    :problema="problemaPlantillas"
                    :reintentar="cargarPlantillas"
                    :reintentando="cargandoPlantillas"
                />
                <template v-else>
                    <div class="flex flex-col gap-2 sm:flex-row">
                        <USelect
                            v-model="grupo"
                            :items="itemsGrupo"
                            aria-label="Filtrar por tipo de evento"
                            class="w-full sm:w-56"
                            data-prueba="filtro-grupo-evento"
                        />
                        <USelect
                            v-model="canal"
                            :items="itemsCanal"
                            aria-label="Filtrar por canal"
                            class="w-full sm:w-48"
                        />
                    </div>
                    <UTable
                        :data="filasPlantillas"
                        :columns="columnasPlantillas"
                        :loading="cargandoPlantillas"
                        :ui="{ td: 'py-3' }"
                        data-prueba="tabla-plantillas-aviso"
                    >
                        <template #evento-cell="{ row }">
                            <div
                                class="flex min-w-0 flex-col gap-0.5"
                                :data-aviso="`${row.original.evento}/${row.original.canal}`"
                            >
                                <span class="flex flex-wrap items-center gap-1.5 text-sm font-medium text-highlighted">
                                    {{ etiquetaEvento(row.original.evento) }}
                                    <UBadge
                                        v-if="!row.original.activa"
                                        label="Apagada"
                                        color="neutral"
                                        variant="subtle"
                                        size="sm"
                                    />
                                </span>
                                <span class="font-mono text-xs text-muted">{{ row.original.evento }}<span class="sm:hidden"> · {{ CANALES_AVISO[row.original.canal].etiqueta }}</span></span>
                            </div>
                        </template>
                        <template #canal-cell="{ row }">
                            <UBadge
                                :label="CANALES_AVISO[row.original.canal].etiqueta"
                                :icon="CANALES_AVISO[row.original.canal].icono"
                                color="neutral"
                                variant="outline"
                                size="sm"
                            />
                        </template>
                        <template #texto-cell="{ row }">
                            <div class="flex flex-col gap-0.5 text-xs">
                                <span
                                    v-if="row.original.asunto"
                                    class="font-medium text-highlighted"
                                >{{ row.original.asunto }}</span>
                                <span class="whitespace-pre-line text-muted">{{ resumen(row.original.cuerpo) }}</span>
                            </div>
                        </template>
                        <template #acciones-cell="{ row }">
                            <UButton
                                v-if="puede('notificaciones.editar')"
                                icon="i-lucide-pencil"
                                color="neutral"
                                variant="ghost"
                                size="sm"
                                :aria-label="`Editar ${etiquetaEvento(row.original.evento)} por ${CANALES_AVISO[row.original.canal].etiqueta}`"
                                :data-prueba="`editar-aviso-${row.original.id}`"
                                @click="editar(row.original)"
                            />
                        </template>
                        <template #empty>
                            <UEmpty
                                icon="i-lucide-file-text"
                                title="No hay plantillas con estos filtros"
                                variant="naked"
                            />
                        </template>
                    </UTable>
                </template>
            </template>

            <!-- Recordatorios -->
            <template v-else-if="pestana === 'recordatorios'">
                <p class="text-sm text-muted">
                    Hasta tres recordatorios por factura sin pagar. Su texto es la plantilla «Recordatorio de pago n» de cada canal.
                </p>
                <ProblemaAlerta
                    v-if="problemaRecordatorios"
                    :problema="problemaRecordatorios"
                    :reintentar="cargarRecordatorios"
                    :reintentando="cargandoRecordatorios"
                />
                <div
                    v-else
                    class="grid gap-3 md:grid-cols-3"
                    data-prueba="recordatorios"
                >
                    <USkeleton
                        v-if="cargandoRecordatorios && !recordatorios.length"
                        class="h-28 md:col-span-3"
                    />
                    <UCard
                        v-for="r in recordatorios"
                        :key="r.id"
                        variant="subtle"
                        :data-recordatorio="r.orden"
                    >
                        <div class="flex items-start justify-between gap-2">
                            <div class="flex flex-col gap-1">
                                <span class="text-sm font-medium text-highlighted">Recordatorio {{ r.orden }}</span>
                                <span class="text-sm">{{ diasRecordatorio(r.dias) }}</span>
                                <span class="text-xs text-muted">a las {{ r.hora.slice(0, 5) }} h (Guatemala)</span>
                                <UBadge
                                    :label="r.activo ? 'Activo' : 'Apagado'"
                                    :color="r.activo ? 'success' : 'neutral'"
                                    variant="subtle"
                                    size="sm"
                                    class="self-start"
                                />
                            </div>
                            <UButton
                                v-if="puede('notificaciones.editar')"
                                icon="i-lucide-pencil"
                                color="neutral"
                                variant="ghost"
                                size="sm"
                                :aria-label="`Editar el recordatorio ${r.orden}`"
                                :data-prueba="`editar-recordatorio-${r.orden}`"
                                @click="editarRecordatorio(r)"
                            />
                        </div>
                    </UCard>
                </div>
            </template>

            <!-- Envíos -->
            <template v-else>
                <div class="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                    <ClienteSelector
                        v-if="puede('clientes.ver')"
                        v-model="clienteId"
                        :seleccionado="clienteElegido"
                        placeholder="Cliente"
                        aria-label="Filtrar por cliente"
                        class="w-full"
                        @elegido="alElegirCliente"
                    />
                    <UInput
                        v-model="filtroEvento"
                        icon="i-lucide-search"
                        placeholder="Evento exacto (factura.emitida)"
                        aria-label="Filtrar por evento"
                        class="w-full"
                    />
                    <USelect
                        v-model="filtroCanal"
                        :items="itemsCanal"
                        aria-label="Filtrar envíos por canal"
                        class="w-full"
                    />
                    <USelect
                        v-model="filtroEstado"
                        :items="itemsEstado"
                        aria-label="Filtrar envíos por estado"
                        class="w-full"
                        data-prueba="filtro-estado-envio"
                    />
                </div>
                <ProblemaAlerta
                    v-if="envios.problema.value"
                    :problema="envios.problema.value"
                    :reintentar="envios.recargar"
                    :reintentando="envios.cargando.value"
                />
                <template v-else>
                    <UTable
                        :data="envios.filas.value"
                        :columns="columnasEnvios"
                        :loading="envios.cargando.value"
                        :ui="{ td: 'py-2.5' }"
                        data-prueba="tabla-envios"
                    >
                        <template #fecha-cell="{ row }">
                            <span class="whitespace-nowrap text-sm">{{ formatearFechaHora(row.original.created_at) }}</span>
                        </template>
                        <template #evento-cell="{ row }">
                            <div
                                class="flex min-w-0 flex-col gap-0.5"
                                :data-envio="row.original.id"
                            >
                                <span class="text-sm font-medium text-highlighted">{{ etiquetaEvento(row.original.evento) }}</span>
                                <span class="text-xs text-muted">
                                    <UIcon
                                        :name="CANALES_AVISO[row.original.canal].icono"
                                        class="size-3 align-middle"
                                    /> {{ row.original.destino }}
                                </span>
                                <span class="text-xs text-muted sm:hidden">{{ formatearFechaHora(row.original.created_at) }}</span>
                                <span class="text-xs text-muted lg:hidden">{{ nombreCliente(row.original.cliente_id) }}</span>
                            </div>
                        </template>
                        <template #cliente-cell="{ row }">
                            <span class="text-sm">{{ nombreCliente(row.original.cliente_id) }}</span>
                        </template>
                        <template #estado-cell="{ row }">
                            <div class="flex flex-col items-start gap-0.5">
                                <UBadge
                                    :label="ESTADOS_ENVIO[row.original.estado].etiqueta"
                                    :icon="ESTADOS_ENVIO[row.original.estado].icono"
                                    :color="ESTADOS_ENVIO[row.original.estado].color"
                                    variant="subtle"
                                    size="sm"
                                />
                                <span
                                    v-if="row.original.fallback_de"
                                    class="text-xs text-muted"
                                >respaldo del #{{ row.original.fallback_de }}</span>
                            </div>
                        </template>
                        <template #acciones-cell="{ row }">
                            <UButton
                                icon="i-lucide-eye"
                                color="neutral"
                                variant="ghost"
                                size="sm"
                                :aria-label="`Ver el envío ${row.original.id}`"
                                :data-prueba="`ver-envio-${row.original.id}`"
                                @click="verEnvio(row.original)"
                            />
                        </template>
                        <template #empty>
                            <UEmpty
                                icon="i-lucide-send"
                                title="No hay envíos con estos filtros"
                                variant="naked"
                            />
                        </template>
                    </UTable>
                    <PaginacionCursor
                        :pagina="envios.pagina.value"
                        :hay-anterior="envios.hayAnterior.value"
                        :hay-siguiente="envios.haySiguiente.value"
                        :cargando="envios.cargando.value"
                        :filas="envios.filas.value.length"
                        @anterior="envios.anterior"
                        @siguiente="envios.siguiente"
                    />
                </template>
            </template>
        </div>

        <PlantillaNotificacionModal
            v-if="editando"
            v-model:open="editorAbierto"
            :plantilla="editando"
            @guardado="alGuardarPlantilla"
        />
        <RecordatorioPagoModal
            v-if="recordatorio"
            v-model:open="recordatorioAbierto"
            :recordatorio="recordatorio"
            @guardado="alGuardarRecordatorio"
        />
        <UModal
            v-model:open="envioAbierto"
            :title="envio ? `Envío #${envio.id} · ${etiquetaEvento(envio.evento)}` : 'Envío'"
            :description="envio ? `${CANALES_AVISO[envio.canal].etiqueta} a ${envio.destino}` : undefined"
        >
            <template #body>
                <dl
                    v-if="envio"
                    class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm"
                    data-prueba="detalle-envio"
                >
                    <dt class="text-muted">
                        Estado
                    </dt>
                    <dd>{{ ESTADOS_ENVIO[envio.estado].etiqueta }} · {{ envio.intentos }} {{ envio.intentos === 1 ? 'intento' : 'intentos' }}</dd>
                    <dt class="text-muted">
                        Cliente
                    </dt>
                    <dd>{{ nombreCliente(envio.cliente_id) }}</dd>
                    <dt class="text-muted">
                        Creado
                    </dt>
                    <dd>{{ formatearFechaHora(envio.created_at) }}</dd>
                    <template v-if="envio.enviado_en">
                        <dt class="text-muted">
                            Enviado
                        </dt>
                        <dd>{{ formatearFechaHora(envio.enviado_en) }}</dd>
                    </template>
                    <dt class="text-muted">
                        Origen
                    </dt>
                    <dd class="break-all font-mono text-xs">
                        {{ envio.origen }}
                    </dd>
                    <template v-if="envio.error">
                        <dt class="text-muted">
                            Error
                        </dt>
                        <dd class="text-error">
                            {{ envio.error }}
                        </dd>
                    </template>
                    <template v-if="envio.motivo">
                        <dt class="text-muted">
                            Motivo
                        </dt>
                        <dd>{{ envio.motivo }}</dd>
                    </template>
                    <template v-if="envio.asunto">
                        <dt class="text-muted">
                            Asunto
                        </dt>
                        <dd>{{ envio.asunto }}</dd>
                    </template>
                    <template v-if="envio.cuerpo">
                        <dt class="text-muted">
                            Mensaje
                        </dt>
                        <dd class="whitespace-pre-line">
                            {{ envio.cuerpo }}
                        </dd>
                    </template>
                </dl>
            </template>
        </UModal>
    </PanelPagina>
</template>
