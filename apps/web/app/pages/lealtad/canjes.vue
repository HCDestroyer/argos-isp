<script setup lang="ts">
import type { SelectItem, TableColumn } from '@nuxt/ui'

/**
 * Canjes de puntos (A3, fase 2; `lealtad.ver`): del panel y del portal, con su estado. «Canjear»
 * con `lealtad.canjear` (y `clientes.ver` para buscar al cliente); «Revertir» un reservado con
 * `lealtad.revertir_canje` y motivo, que devuelve los puntos.
 */
definePageMeta({ permiso: 'lealtad.ver' })

useHead({ title: 'Canjes de puntos · ArgosIsp' })

const { puede, enlace } = usePermisos()
const toast = useToast()
const nombres = useNombresClientes()

const TODOS = 'todos'
const estado = ref<CanjeLealtad['estado'] | typeof TODOS>(TODOS)
const itemsEstado: SelectItem[] = [
    { label: 'Todos los estados', value: TODOS },
    ...(Object.keys(ESTADOS_CANJE) as CanjeLealtad['estado'][]).map(e => ({ label: ESTADOS_CANJE[e].etiqueta, value: e })),
]

const lista = usePaginacionCursor(cursor => useCanjesLealtad().listar(estado.value === TODOS ? {} : { estado: estado.value }, cursor))
watch(estado, () => void lista.recargar())
watch(() => lista.filas.value, (filas) => {
    if (puede('clientes.ver')) {
        void nombres.cargar(filas.map(c => c.cliente_id))
    }
})

const premios = shallowRef<PremioLealtad[]>([])

async function cargarPremios() {
    const resultado = await usePremiosLealtad().listar({ activo: true })
    premios.value = resultado.ok ? resultado.data.data : []
}

onMounted(() => {
    void lista.recargar()
    if (puede('lealtad.canjear')) {
        void cargarPremios()
    }
})

const columnas: TableColumn<CanjeLealtad>[] = [
    { id: 'premio', header: 'Canje', meta: { class: { td: 'whitespace-normal' } } },
    { accessorKey: 'puntos', header: 'Puntos', meta: { class: { th: 'text-right', td: 'text-right' } } },
    { accessorKey: 'estado', header: 'Estado' },
    { id: 'acciones', header: '', meta: { class: { td: 'text-right w-0' } } },
]

const canjearAbierto = ref(false)

function alCanjear(canje: CanjeLealtad) {
    toast.add({ title: `${canje.premio_nombre}: ${ESTADOS_CANJE[canje.estado].etiqueta.toLowerCase()}`, description: `${formatearPuntos(canje.puntos)} descontados.`, color: 'success', icon: 'i-lucide-gift' })
    void lista.recargar()
}

const aRevertir = shallowRef<CanjeLealtad | null>(null)
const revertirAbierto = ref(false)

function pedirRevertir(canje: CanjeLealtad) {
    aRevertir.value = canje
    revertirAbierto.value = true
}

function revertir(motivo: string, clave: string): Promise<Resultado<CanjeLealtad>> {
    const canje = aRevertir.value
    return canje ? useCanjesLealtad().revertir(canje.id, motivo, clave) : Promise.resolve({ ok: false, problema: { type: 'about:blank', title: 'Elige un canje', status: 400 } })
}

function alRevertir(canje: CanjeLealtad) {
    toast.add({ title: 'Canje revertido', description: `${formatearPuntos(canje.puntos)} devueltos al cliente.`, color: 'success', icon: 'i-lucide-undo-2' })
    void lista.recargar()
}

function nombreCliente(id: number): string {
    return nombres.nombre(id)
}
</script>

<template>
    <PanelPagina
        id="canjes-lealtad"
        titulo="Canjes de puntos"
        icono="i-lucide-gift"
    >
        <template #acciones>
            <UButton
                v-if="puede('lealtad.canjear') && puede('clientes.ver')"
                label="Canjear"
                icon="i-lucide-plus"
                data-prueba="nuevo-canje"
                @click="canjearAbierto = true"
            />
        </template>

        <div class="flex flex-col gap-4">
            <USelect
                v-model="estado"
                :items="itemsEstado"
                aria-label="Filtrar por estado"
                class="w-full sm:w-56"
            />
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
                    :ui="{ td: 'py-3' }"
                    data-prueba="tabla-canjes"
                >
                    <template #premio-cell="{ row }">
                        <div
                            class="flex min-w-0 flex-col gap-0.5"
                            :data-canje="row.original.id"
                        >
                            <span class="text-sm font-medium text-highlighted">{{ row.original.premio_nombre }}</span>
                            <span class="text-xs text-muted">
                                <ULink
                                    v-if="enlace(`/clientes/${row.original.cliente_id}`)"
                                    :to="enlace(`/clientes/${row.original.cliente_id}`)"
                                    class="hover:text-primary"
                                >{{ nombreCliente(row.original.cliente_id) }}</ULink>
                                <template v-else>{{ nombreCliente(row.original.cliente_id) }}</template>
                                · {{ row.original.canal === 'portal' ? 'portal' : 'panel' }} · {{ formatearFechaHora(row.original.created_at) }}
                            </span>
                            <span
                                v-if="row.original.descuento"
                                class="text-xs text-muted"
                            >Descuento {{ formatearQuetzales(row.original.descuento) }}</span>
                            <span
                                v-if="row.original.motivo"
                                class="text-xs text-muted"
                            >{{ row.original.motivo }}</span>
                        </div>
                    </template>
                    <template #puntos-cell="{ row }">
                        <span class="tabular-nums">{{ formatearPuntos(row.original.puntos) }}</span>
                    </template>
                    <template #estado-cell="{ row }">
                        <UBadge
                            :label="ESTADOS_CANJE[row.original.estado].etiqueta"
                            :color="ESTADOS_CANJE[row.original.estado].color"
                            variant="subtle"
                            size="sm"
                        />
                    </template>
                    <template #acciones-cell="{ row }">
                        <UButton
                            v-if="puede('lealtad.revertir_canje') && row.original.estado === 'reservado'"
                            label="Revertir"
                            icon="i-lucide-undo-2"
                            color="neutral"
                            variant="ghost"
                            size="sm"
                            :aria-label="`Revertir el canje ${row.original.id}`"
                            :data-prueba="`revertir-canje-${row.original.id}`"
                            @click="pedirRevertir(row.original)"
                        />
                    </template>
                    <template #empty>
                        <UEmpty
                            icon="i-lucide-gift"
                            title="Sin canjes"
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

        <CanjeLealtadModal
            v-model:open="canjearAbierto"
            :premios="premios"
            @canjeado="alCanjear"
        />
        <AccionMotivoModal
            v-model:open="revertirAbierto"
            titulo="Revertir canje"
            :descripcion="aRevertir?.premio_nombre"
            :efecto="`Devuelve ${aRevertir ? formatearPuntos(aRevertir.puntos) : 'los puntos'} al cliente y anula la reserva del premio.`"
            confirmar="Revertir"
            icono="i-lucide-undo-2"
            placeholder="Ej.: el cliente cambió de opinión"
            :ejecutar="revertir"
            @hecho="alRevertir"
        />
    </PanelPagina>
</template>
