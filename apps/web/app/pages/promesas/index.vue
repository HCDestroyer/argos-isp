<script setup lang="ts">
import type { SelectItem, TableColumn } from '@nuxt/ui'

definePageMeta({ permiso: 'promesas.ver' })

useHead({ title: 'Promesas · ArgosIsp' })

const route = useRoute()
const router = useRouter()
const { puede } = usePermisos()
const toast = useToast()
const nombres = useNombresClientes()

const TODOS = 'todos'

function textoQuery(valor: unknown): string {
    return typeof valor === 'string' ? valor : ''
}

function idQuery(valor: unknown): number {
    const id = Number(textoQuery(valor))
    return Number.isInteger(id) && id > 0 ? id : 0
}

function estadoQuery(valor: unknown): EstadoPromesa | typeof TODOS {
    const texto = textoQuery(valor)
    return texto in ESTADOS_PROMESA ? (texto as EstadoPromesa) : TODOS
}

const estado = ref<EstadoPromesa | typeof TODOS>(estadoQuery(route.query.estado))
const clienteId = ref(idQuery(route.query.cliente))
const servicioId = ref(idQuery(route.query.servicio))
const clienteElegido = shallowRef<Cliente | null>(null)

const aprobarAbierto = ref(false)
const porAprobar = shallowRef<Promesa | null>(null)

const itemsEstado: SelectItem[] = [
    { label: 'Todos los estados', value: TODOS },
    ...Object.entries(ESTADOS_PROMESA).map(([valor, datos]) => ({ label: datos.etiqueta, value: valor, icon: datos.icono })),
]

function filtros(): FiltrosPromesas {
    const resultado: FiltrosPromesas = {}
    if (estado.value !== TODOS) {
        resultado.estado = estado.value
    }
    if (clienteId.value) {
        resultado.cliente_id = clienteId.value
    }
    if (servicioId.value) {
        resultado.servicio_id = servicioId.value
    }
    return resultado
}

const lista = usePaginacionCursor(cursor => usePromesas().listar(filtros(), cursor))

watch(lista.filas, filas => void nombres.cargar(filas.map(p => p.cliente_id)))

const columnas = computed<TableColumn<Promesa>[]>(() => [
    { accessorKey: 'id', header: 'Promesa' },
    { accessorKey: 'cliente_id', header: 'Cliente', meta: SOLO_ANCHO },
    { accessorKey: 'monto', header: 'Monto', meta: { class: { th: 'hidden text-right sm:table-cell', td: 'hidden text-right sm:table-cell' } } },
    { accessorKey: 'estado', header: 'Estado y evaluación', meta: { class: { th: 'hidden sm:table-cell', td: 'hidden whitespace-normal sm:table-cell' } } },
    ...(conAcciones.value ? [{ id: 'acciones', header: '', meta: { class: { th: 'hidden sm:table-cell', td: 'hidden text-right sm:table-cell' } } }] : []),
])

const hayFiltros = computed(() => estado.value !== TODOS || clienteId.value !== 0 || servicioId.value !== 0)

async function aplicarFiltros() {
    const query: Record<string, string> = {}
    if (estado.value !== TODOS) {
        query.estado = estado.value
    }
    if (clienteId.value) {
        query.cliente = String(clienteId.value)
    }
    if (servicioId.value) {
        query.servicio = String(servicioId.value)
    }
    await router.replace({ query })
    await lista.recargar()
}

function limpiarFiltros() {
    estado.value = TODOS
    clienteId.value = 0
    clienteElegido.value = null
    servicioId.value = 0
}

function alElegirCliente(cliente: Cliente) {
    clienteElegido.value = cliente
    nombres.recordar(cliente.id, cliente.nombre)
}

function abrirAprobar(promesa: Promesa) {
    porAprobar.value = promesa
    aprobarAbierto.value = true
}

// Rechazar (solo pendientes) y cancelar (activa o pendiente), con motivo (A3, día 4).
const cierre = shallowRef<{ promesa: Promesa, accion: 'rechazar' | 'cancelar' } | null>(null)
const cierreAbierto = ref(false)

const puedeRechazar = (promesa: Promesa) => puede('promesas.rechazar') && promesa.estado === 'pendiente_aprobacion'
const puedeCancelar = (promesa: Promesa) => puede('promesas.cancelar') && (promesa.estado === 'activa' || promesa.estado === 'pendiente_aprobacion')
const conAcciones = computed(() => puede('promesas.aprobar') || puede('promesas.rechazar') || puede('promesas.cancelar'))

function abrirCierre(promesa: Promesa, accion: 'rechazar' | 'cancelar') {
    cierre.value = { promesa, accion }
    cierreAbierto.value = true
}

function ejecutarCierre(motivo: string, clave: string) {
    const actual = cierre.value
    if (!actual) {
        return Promise.resolve<Resultado<Promesa>>({ ok: false, problema: { type: 'about:blank', title: 'Sin promesa', status: 0 } })
    }
    return actual.accion === 'rechazar'
        ? usePromesas().rechazar(actual.promesa.id, motivo, clave)
        : usePromesas().cancelar(actual.promesa.id, motivo, clave)
}

function alCerrar(promesa: Promesa) {
    toast.add({
        title: promesa.estado === 'rechazada' ? 'Promesa rechazada' : 'Promesa cancelada',
        description: `Promesa #${promesa.id} · servicio ${promesa.servicio_id}`,
        icon: 'i-lucide-circle-slash',
        color: 'success',
    })
    void lista.recargar()
}

function alAprobar(promesa: Promesa) {
    toast.add({ title: 'Promesa aprobada', description: `Promesa #${promesa.id} · servicio ${promesa.servicio_id}`, icon: 'i-lucide-check', color: 'success' })
    void lista.recargar()
}

watch([estado, clienteId, servicioId], aplicarFiltros)

onMounted(async () => {
    void lista.recargar()
    if (clienteId.value) {
        const resultado = await useClientes().ver(clienteId.value)
        if (resultado.ok) {
            alElegirCliente(resultado.data)
        }
    }
})
</script>

<template>
    <PanelPagina
        id="promesas"
        titulo="Promesas"
        icono="i-lucide-calendar-clock"
    >
        <div class="flex flex-col gap-4">
            <div
                class="flex flex-wrap gap-2"
                role="group"
                aria-label="Accesos rápidos por estado"
            >
                <UButton
                    label="Todas"
                    :variant="estado === TODOS ? 'solid' : 'outline'"
                    color="neutral"
                    size="sm"
                    class="rounded-full"
                    @click="estado = TODOS"
                />
                <UButton
                    label="Pendientes de aprobación"
                    icon="i-lucide-hourglass"
                    :variant="estado === 'pendiente_aprobacion' ? 'solid' : 'outline'"
                    color="warning"
                    size="sm"
                    class="rounded-full"
                    @click="estado = 'pendiente_aprobacion'"
                />
                <UButton
                    label="Activas"
                    icon="i-lucide-calendar-clock"
                    :variant="estado === 'activa' ? 'solid' : 'outline'"
                    color="info"
                    size="sm"
                    class="rounded-full"
                    @click="estado = 'activa'"
                />
            </div>

            <div class="flex flex-col gap-3 sm:flex-row sm:items-center">
                <ClienteSelector
                    v-model="clienteId"
                    :seleccionado="clienteElegido"
                    placeholder="Filtrar por cliente: nombre, NIT o teléfono"
                    aria-label="Filtrar por cliente"
                    class="w-full sm:max-w-md"
                    @elegido="alElegirCliente"
                />
                <USelect
                    v-model="estado"
                    :items="itemsEstado"
                    icon="i-lucide-activity"
                    aria-label="Filtrar por estado"
                    class="w-full sm:w-60"
                />
                <UBadge
                    v-if="servicioId"
                    :label="`Servicio ${servicioId}`"
                    icon="i-lucide-wifi"
                    color="neutral"
                    variant="outline"
                    class="self-start sm:self-auto"
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
                    :data="lista.filas.value"
                    :columns="columnas"
                    :loading="lista.cargando.value"
                    sticky
                    class="flex-1"
                    :ui="{ td: 'py-3 align-top' }"
                >
                    <template #id-cell="{ row }">
                        <div class="flex min-w-0 flex-col whitespace-normal sm:min-w-28">
                            <span class="text-sm font-medium text-highlighted">Promesa #{{ row.original.id }}<span class="sm:hidden"> · {{ formatearQuetzales(row.original.monto) }}</span></span>
                            <span class="text-xs text-muted">Vence {{ formatearFechaHora(row.original.vence_en) }}</span>
                            <span class="text-xs text-muted">
                                <ULink
                                    :to="`/servicios/${row.original.servicio_id}`"
                                    class="hover:text-primary"
                                >servicio {{ row.original.servicio_id }}</ULink>
                                · {{ CANALES_PROMESA[row.original.canal] }}
                            </span>
                            <span class="truncate text-xs text-muted sm:hidden">{{ nombres.nombre(row.original.cliente_id) }}</span>
                            <!-- En teléfono, estado, evaluación y "Aprobar" van en la misma celda. -->
                            <div class="mt-1 flex flex-col gap-1 whitespace-normal sm:hidden">
                                <UBadge
                                    :label="ESTADOS_PROMESA[row.original.estado].etiqueta"
                                    :icon="ESTADOS_PROMESA[row.original.estado].icono"
                                    :color="ESTADOS_PROMESA[row.original.estado].color"
                                    variant="subtle"
                                    size="sm"
                                    class="self-start"
                                />
                                <EvaluacionPromesa
                                    :promesa="row.original"
                                    compacta
                                />
                                <div class="flex flex-wrap gap-1.5">
                                    <UButton
                                        v-if="puede('promesas.aprobar') && row.original.estado === 'pendiente_aprobacion'"
                                        label="Aprobar"
                                        icon="i-lucide-check"
                                        color="success"
                                        variant="outline"
                                        size="sm"
                                        @click="abrirAprobar(row.original)"
                                    />
                                    <UButton
                                        v-if="puedeRechazar(row.original)"
                                        label="Rechazar"
                                        icon="i-lucide-x"
                                        color="error"
                                        variant="ghost"
                                        size="sm"
                                        @click="abrirCierre(row.original, 'rechazar')"
                                    />
                                    <UButton
                                        v-if="puedeCancelar(row.original)"
                                        label="Cancelar promesa"
                                        icon="i-lucide-circle-slash"
                                        color="neutral"
                                        variant="ghost"
                                        size="sm"
                                        @click="abrirCierre(row.original, 'cancelar')"
                                    />
                                </div>
                            </div>
                        </div>
                    </template>

                    <template #cliente_id-cell="{ row }">
                        <ULink
                            :to="`/clientes/${row.original.cliente_id}?tab=cuenta`"
                            class="text-sm text-default hover:text-primary"
                        >
                            {{ nombres.nombre(row.original.cliente_id) }}
                        </ULink>
                    </template>

                    <template #monto-cell="{ row }">
                        <span class="tabular-nums font-medium text-highlighted">{{ formatearQuetzales(row.original.monto) }}</span>
                    </template>

                    <template #estado-cell="{ row }">
                        <div class="flex max-w-xs flex-col gap-1">
                            <UBadge
                                :label="ESTADOS_PROMESA[row.original.estado].etiqueta"
                                :icon="ESTADOS_PROMESA[row.original.estado].icono"
                                :color="ESTADOS_PROMESA[row.original.estado].color"
                                variant="subtle"
                                size="sm"
                                class="self-start"
                            />
                            <EvaluacionPromesa
                                :promesa="row.original"
                                compacta
                            />
                        </div>
                    </template>

                    <template #acciones-cell="{ row }">
                        <div class="flex justify-end gap-1">
                            <UButton
                                v-if="puede('promesas.aprobar') && row.original.estado === 'pendiente_aprobacion'"
                                label="Aprobar"
                                icon="i-lucide-check"
                                color="success"
                                variant="outline"
                                size="sm"
                                @click="abrirAprobar(row.original)"
                            />
                            <UButton
                                v-if="puedeRechazar(row.original)"
                                label="Rechazar"
                                icon="i-lucide-x"
                                color="error"
                                variant="ghost"
                                size="sm"
                                @click="abrirCierre(row.original, 'rechazar')"
                            />
                            <UButton
                                v-if="puedeCancelar(row.original)"
                                icon="i-lucide-circle-slash"
                                color="neutral"
                                variant="ghost"
                                size="sm"
                                :aria-label="`Cancelar la promesa ${row.original.id}`"
                                title="Cancelar promesa"
                                @click="abrirCierre(row.original, 'cancelar')"
                            />
                        </div>
                    </template>

                    <template #empty>
                        <UEmpty
                            icon="i-lucide-calendar-x"
                            :title="hayFiltros ? 'Ninguna promesa coincide' : 'Todavía no hay promesas'"
                            :description="puede('promesas.crear') ? 'Las promesas se crean desde la ficha del servicio.' : undefined"
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

        <PromesaAprobarModal
            v-model:open="aprobarAbierto"
            :promesa="porAprobar"
            :nombre-cliente="porAprobar ? nombres.nombre(porAprobar.cliente_id) : undefined"
            @aprobada="alAprobar"
        />

        <AccionMotivoModal
            v-model:open="cierreAbierto"
            :titulo="cierre?.accion === 'rechazar' ? 'Rechazar promesa' : 'Cancelar promesa'"
            :descripcion="cierre ? `Promesa #${cierre.promesa.id} · ${nombres.nombre(cierre.promesa.cliente_id)} · ${formatearQuetzales(cierre.promesa.monto)}` : undefined"
            :efecto="cierre?.accion === 'rechazar'
                ? 'La promesa no se activa y el servicio sigue como está.'
                : cierre?.promesa.estado === 'activa'
                    ? 'La promesa deja de proteger el servicio: se vuelve a evaluar y puede cortarse si tiene avisos vencidos.'
                    : 'La promesa pendiente se descarta sin activarse.'"
            :confirmar="cierre?.accion === 'rechazar' ? 'Rechazar' : 'Cancelar promesa'"
            :icono="cierre?.accion === 'rechazar' ? 'i-lucide-x' : 'i-lucide-circle-slash'"
            placeholder="Ej.: el cliente ya no puede pagar en esa fecha"
            :ejecutar="ejecutarCierre"
            @hecho="alCerrar"
        />
    </PanelPagina>
</template>
