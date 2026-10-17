<script setup lang="ts">
import type { SelectItem, SelectMenuItem, TableColumn, TabsItem } from '@nuxt/ui'

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

const pestanas: TabsItem[] = [
    { label: 'Acciones', value: 'acciones', icon: 'i-lucide-scroll-text' },
    { label: 'Historial de cambios', value: 'cambios', icon: 'i-lucide-history' },
]

const pestana = ref(textoQuery(route.query.tab) === 'cambios' ? 'cambios' : 'acciones')
const actor = ref(textoQuery(route.query.actor) || TODOS)
const canal = ref<CanalAccion | typeof TODOS>((CANALES_ACCION as readonly string[]).includes(textoQuery(route.query.canal)) ? (textoQuery(route.query.canal) as CanalAccion) : TODOS)
const accion = ref(textoQuery(route.query.accion))
const entidadTipo = ref(textoQuery(route.query.tipo) || TODOS)
const entidadId = ref(idQuery(route.query.entidad) ? String(idQuery(route.query.entidad)) : '')
const desde = ref(FECHA.test(textoQuery(route.query.desde)) ? textoQuery(route.query.desde) : '')
const hasta = ref(FECHA.test(textoQuery(route.query.hasta)) ? textoQuery(route.query.hasta) : '')
const peticion = ref(textoQuery(route.query.peticion))

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
const lista = computed(() => (pestana.value === 'cambios' ? listaCambios : listaAcciones))

const columnasAcciones: TableColumn<AccionAuditoria>[] = [
    { accessorKey: 'created_at', header: 'Fecha', meta: SOLO_ANCHO },
    { accessorKey: 'accion', header: 'Acción' },
    { accessorKey: 'actor_id', header: 'Actor y canal', meta: SOLO_ESCRITORIO },
    { accessorKey: 'entidad_tipo', header: 'Entidad', meta: SOLO_ANCHO },
    { accessorKey: 'resultado', header: 'Resultado' },
]

const columnasCambios: TableColumn<CambioAuditoria>[] = [
    { accessorKey: 'created_at', header: 'Fecha', meta: SOLO_ANCHO },
    { accessorKey: 'campo', header: 'Campo' },
    { accessorKey: 'antes', header: 'Antes', meta: SOLO_ANCHO },
    { accessorKey: 'despues', header: 'Después' },
    { accessorKey: 'actor_id', header: 'Actor', meta: SOLO_ESCRITORIO },
]

const hayFiltros = computed(() => actor.value !== TODOS || canal.value !== TODOS || accion.value !== ''
    || entidadTipo.value !== TODOS || entidadId.value !== '' || desde.value !== '' || hasta.value !== '' || peticion.value !== '')

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
    if (pestana.value === 'cambios') {
        query.tab = 'cambios'
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
    await router.replace({ query })
    await lista.value.recargar()
}

function limpiarFiltros() {
    actor.value = TODOS
    canal.value = TODOS
    accion.value = ''
    entidadTipo.value = TODOS
    entidadId.value = ''
    desde.value = ''
    hasta.value = ''
    peticion.value = ''
}

function verDetalle(fila: AccionAuditoria) {
    elegida.value = fila
    detalleAbierto.value = true
}

function filtrarPeticion(requestId: string) {
    detalleAbierto.value = false
    limpiarFiltros()
    peticion.value = requestId
}

function verCambios(tipo: string, id: number) {
    detalleAbierto.value = false
    limpiarFiltros()
    entidadTipo.value = tipo
    entidadId.value = String(id)
    pestana.value = 'cambios'
}

let temporizador: ReturnType<typeof setTimeout> | undefined
watch(entidadId, () => {
    clearTimeout(temporizador)
    temporizador = setTimeout(aplicarFiltros, 300)
})
watch([pestana, actor, canal, accion, entidadTipo, desde, hasta, peticion], aplicarFiltros)
onBeforeUnmount(() => clearTimeout(temporizador))

onMounted(async () => {
    void lista.value.recargar()
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
    >
        <div class="flex flex-col gap-4">
            <UTabs
                v-model="pestana"
                :items="pestanas"
                variant="link"
                :content="false"
                class="w-full"
            />

            <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <template v-if="pestana === 'acciones'">
                    <USelect
                        v-if="puede('usuarios.ver')"
                        v-model="actor"
                        :items="itemsActor"
                        icon="i-lucide-user"
                        aria-label="Filtrar por actor"
                        class="w-full"
                    />
                    <UInput
                        v-else
                        :model-value="actor === TODOS ? '' : actor"
                        inputmode="numeric"
                        icon="i-lucide-user"
                        placeholder="ID del actor"
                        aria-label="Filtrar por id del actor"
                        class="w-full"
                        @update:model-value="actor = String($event).trim() || TODOS"
                    />
                    <USelect
                        v-model="canal"
                        :items="itemsCanal"
                        icon="i-lucide-radio-tower"
                        aria-label="Filtrar por canal"
                        class="w-full"
                    />
                    <USelectMenu
                        v-model="accion"
                        :items="itemsAccion"
                        value-key="value"
                        icon="i-lucide-zap"
                        placeholder="Todas las acciones"
                        :search-input="{ placeholder: 'Buscar acción…' }"
                        aria-label="Filtrar por acción"
                        class="w-full"
                    />
                </template>
                <USelect
                    v-model="entidadTipo"
                    :items="itemsEntidad"
                    icon="i-lucide-box"
                    aria-label="Filtrar por tipo de entidad"
                    class="w-full"
                />
                <UInput
                    v-model="entidadId"
                    inputmode="numeric"
                    icon="i-lucide-hash"
                    placeholder="ID de la entidad"
                    aria-label="Filtrar por id de la entidad"
                    class="w-full"
                />
            </div>

            <div class="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
                <template v-if="pestana === 'acciones'">
                    <UFormField
                        label="Desde"
                        size="sm"
                    >
                        <UInput
                            v-model="desde"
                            type="date"
                            :max="hasta || undefined"
                            class="w-full sm:w-44"
                        />
                    </UFormField>
                    <UFormField
                        label="Hasta"
                        size="sm"
                    >
                        <UInput
                            v-model="hasta"
                            type="date"
                            :min="desde || undefined"
                            class="w-full sm:w-44"
                        />
                    </UFormField>
                    <p class="text-xs text-muted sm:pb-2">
                        Fechas y horas en hora de Guatemala.
                    </p>
                </template>
                <UBadge
                    v-if="peticion"
                    :label="`Petición ${peticion}`"
                    icon="i-lucide-link"
                    color="info"
                    variant="subtle"
                    class="max-w-full self-start truncate font-mono sm:self-auto"
                />
                <UButton
                    v-if="hayFiltros"
                    label="Limpiar filtros"
                    icon="i-lucide-filter-x"
                    color="neutral"
                    variant="ghost"
                    class="self-start sm:ml-auto sm:self-auto"
                    @click="limpiarFiltros"
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
                    v-if="pestana === 'acciones'"
                    :data="listaAcciones.filas.value"
                    :columns="columnasAcciones"
                    :loading="listaAcciones.cargando.value"
                    sticky
                    class="flex-1"
                    :ui="{ td: 'py-3', tr: 'cursor-pointer' }"
                    @select="(_evento, fila) => verDetalle(fila.original)"
                >
                    <template #created_at-cell="{ row }">
                        <span class="whitespace-nowrap text-sm">{{ formatearFechaHora(row.original.created_at) }}</span>
                    </template>
                    <template #accion-cell="{ row }">
                        <div class="flex min-w-40 flex-col">
                            <span class="text-sm font-medium text-highlighted">{{ tituloAccion(row.original) }}</span>
                            <span class="font-mono text-xs text-muted">{{ row.original.accion }}</span>
                            <span class="text-xs text-muted sm:hidden">{{ formatearFechaHora(row.original.created_at) }}</span>
                            <span class="text-xs text-muted lg:hidden">{{ etiquetaActor(row.original) }} · {{ etiquetaCanal(row.original.canal) }}</span>
                            <span
                                v-if="motivoAccion(row.original)"
                                class="line-clamp-2 text-xs whitespace-normal text-muted"
                            >Motivo: {{ motivoAccion(row.original) }}</span>
                        </div>
                    </template>
                    <template #actor_id-cell="{ row }">
                        <div class="flex flex-col">
                            <span class="text-sm">{{ etiquetaActor(row.original) }}</span>
                            <span class="text-xs text-muted">{{ etiquetaCanal(row.original.canal) }}</span>
                        </div>
                    </template>
                    <template #entidad_tipo-cell="{ row }">
                        <ULink
                            v-if="rutaEntidad(row.original.entidad_tipo, row.original.entidad_id)"
                            :to="rutaEntidad(row.original.entidad_tipo, row.original.entidad_id) ?? undefined"
                            class="text-sm text-default hover:text-primary"
                            @click.stop
                        >
                            {{ etiquetaEntidad(row.original) }}
                        </ULink>
                        <span
                            v-else
                            class="text-sm"
                        >{{ etiquetaEntidad(row.original) ?? '—' }}</span>
                    </template>
                    <template #resultado-cell="{ row }">
                        <UBadge
                            :label="row.original.resultado === 'ok' ? 'Correcto' : 'Error'"
                            :icon="row.original.resultado === 'ok' ? 'i-lucide-circle-check' : 'i-lucide-circle-x'"
                            :color="row.original.resultado === 'ok' ? 'success' : 'error'"
                            variant="subtle"
                            size="sm"
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
                    v-else
                    :data="listaCambios.filas.value"
                    :columns="columnasCambios"
                    :loading="listaCambios.cargando.value"
                    sticky
                    class="flex-1"
                    :ui="{ td: 'py-3' }"
                >
                    <template #created_at-cell="{ row }">
                        <span class="whitespace-nowrap text-sm">{{ formatearFechaHora(row.original.created_at) }}</span>
                    </template>
                    <template #campo-cell="{ row }">
                        <div class="flex flex-col">
                            <span class="font-mono text-sm text-highlighted">{{ nombreCampoCambio(row.original.campo) }}</span>
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
                            class="font-mono text-xs break-all whitespace-normal"
                            :class="row.original.antes === null ? 'text-dimmed' : 'text-muted line-through'"
                        >{{ valorCambio(row.original.antes) }}</span>
                    </template>
                    <template #despues-cell="{ row }">
                        <div class="flex flex-col">
                            <span
                                class="font-mono text-xs break-all whitespace-normal"
                                :class="row.original.despues === null ? 'text-dimmed' : 'text-highlighted'"
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

        <BitacoraDetalle
            v-model:open="detalleAbierto"
            :accion="elegida"
            @peticion="filtrarPeticion"
            @cambios="verCambios"
        />
    </PanelPagina>
</template>
