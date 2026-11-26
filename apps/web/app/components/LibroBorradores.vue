<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'

/**
 * Pestaña «Por aprobar» del libro (tablero ContaLibro): los asientos de ajuste que esperan a una
 * segunda persona (`GET /libro/borradores`). Un borrador no toca el libro hasta que se aprueba.
 * Elegir una fila abre su detalle en el panel lateral (lo pinta la página con `LibroBorradorDetalle`).
 */
defineProps<{
    elegido: BorradorAsiento | null
}>()

const emit = defineEmits<{
    elegir: [borrador: BorradorAsiento]
    /** Cuántos pendientes hay en la página (para la insignia de la pestaña). */
    pendientes: [cantidad: number]
}>()

const usuario = useUsuarioActual()
const TODOS = 'todos'
const filtro = ref<EstadoBorrador | typeof TODOS>('pendiente')

const lista = usePaginacionCursor(cursor => useLibro().borradores(filtro.value === TODOS ? undefined : filtro.value, cursor))

watch(filtro, () => void lista.recargar())
watch(lista.filas, filas => emit('pendientes', filas.filter(f => f.estado === 'pendiente').length))
onMounted(() => void lista.recargar())

const columnas: TableColumn<BorradorAsiento>[] = [
    { id: 'fecha', header: 'Fecha' },
    { id: 'descripcion', header: 'Descripción' },
    { id: 'creador', header: 'Lo creó' },
    { id: 'total', header: 'Total', meta: { class: { th: 'text-right', td: 'text-right' } } },
    { id: 'estado', header: 'Estado' },
]

const ESTADOS: Record<EstadoBorrador, { etiqueta: string, color: 'warning' | 'success' | 'error' }> = {
    pendiente: { etiqueta: 'Pendiente', color: 'warning' },
    aprobado: { etiqueta: 'Aprobado', color: 'success' },
    rechazado: { etiqueta: 'Rechazado', color: 'error' },
}

function fechaDe(b: BorradorAsiento): string {
    return formatearFecha(b.fecha ?? b.created_at.slice(0, 10))
}

function esMio(b: BorradorAsiento): boolean {
    return usuario.value?.id !== undefined && b.creado_por === usuario.value.id
}

function elegir(_evento: Event, fila: { original: BorradorAsiento }) {
    emit('elegir', fila.original)
}

defineExpose({ recargar: () => lista.recargar() })
</script>

<template>
    <div
        class="flex min-h-0 flex-1 flex-col"
        data-prueba="libro-por-aprobar"
    >
        <div class="flex flex-wrap items-center justify-between gap-3 border-b border-(--ax-borde) px-4 py-3">
            <p class="flex min-w-0 flex-1 items-start gap-2 text-sm text-muted">
                <UIcon
                    name="i-lucide-user-check"
                    class="mt-0.5 size-4 shrink-0 text-primary"
                />
                <span>Si la empresa lo pide, <strong class="text-highlighted">otra persona</strong> aprueba cada asiento de ajuste. Un borrador no toca el libro hasta que se aprueba; quien lo creó no puede aprobarlo.</span>
            </p>
            <USelect
                v-model="filtro"
                :items="[
                    { label: 'Pendientes', value: 'pendiente' },
                    { label: 'Aprobados', value: 'aprobado' },
                    { label: 'Rechazados', value: 'rechazado' },
                    { label: 'Todos', value: TODOS },
                ]"
                icon="i-lucide-filter"
                aria-label="Estado del borrador"
                class="w-44"
                :ui="{ base: 'rounded-full' }"
                data-prueba="filtro-borradores"
            />
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
            <UTable
                :data="lista.filas.value"
                :columns="columnas"
                :loading="lista.cargando.value"
                sticky
                :ui="{ td: 'py-3', tr: 'cursor-pointer' }"
                data-prueba="tabla-borradores"
                @select="elegir"
            >
                <template #fecha-cell="{ row }">
                    <span class="text-sm whitespace-nowrap text-muted">{{ fechaDe(row.original) }}</span>
                </template>
                <template #descripcion-cell="{ row }">
                    <span
                        class="block max-w-[28rem] truncate text-sm"
                        :class="elegido?.id === row.original.id ? 'font-semibold text-highlighted' : ''"
                        :data-borrador="row.original.id"
                    >{{ row.original.descripcion }}</span>
                </template>
                <template #creador-cell="{ row }">
                    <span class="text-sm whitespace-nowrap">{{ row.original.creado_por_nombre ?? 'El sistema' }}<span
                        v-if="esMio(row.original)"
                        class="text-muted"
                    > (tú)</span></span>
                </template>
                <template #total-cell="{ row }">
                    <span class="font-semibold tabular-nums">{{ formatearQuetzales(row.original.total).replace('Q ', '') }}</span>
                </template>
                <template #estado-cell="{ row }">
                    <div class="flex flex-col items-start gap-0.5">
                        <UBadge
                            :label="ESTADOS[row.original.estado].etiqueta"
                            :color="ESTADOS[row.original.estado].color"
                            variant="soft"
                            size="sm"
                        />
                        <span
                            v-if="row.original.estado === 'pendiente' && esMio(row.original)"
                            class="text-xs text-muted"
                        >lo creaste tú</span>
                        <span
                            v-else-if="row.original.estado === 'rechazado' && row.original.motivo_rechazo"
                            class="max-w-48 truncate text-xs text-muted"
                        >«{{ row.original.motivo_rechazo }}»</span>
                    </div>
                </template>
                <template #empty>
                    <UEmpty
                        icon="i-lucide-check-check"
                        :title="filtro === 'pendiente' ? 'No hay asientos por aprobar' : 'Sin borradores'"
                        description="Aparecen aquí cuando alguien registra un asiento de ajuste y la empresa pide aprobación."
                        variant="naked"
                    />
                </template>
            </UTable>
            <div class="px-4 pb-3">
                <PaginacionCursor
                    :pagina="lista.pagina.value"
                    :hay-anterior="lista.hayAnterior.value"
                    :hay-siguiente="lista.haySiguiente.value"
                    :cargando="lista.cargando.value"
                    :filas="lista.filas.value.length"
                    @anterior="lista.anterior"
                    @siguiente="lista.siguiente"
                />
            </div>
        </template>
    </div>
</template>
