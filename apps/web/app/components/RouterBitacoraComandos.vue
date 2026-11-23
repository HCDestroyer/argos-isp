<script setup lang="ts">
import type { SelectItem, TableColumn } from '@nuxt/ui'

/**
 * Pestaña «Bitácora de comandos» de la ficha del router (tablero RedRouterFicha): cada CoA,
 * Disconnect y comando a RouterOS que Argos le mandó, con la respuesta del equipo
 * (`GET /red/eventos?router_id=`, `audit.red`, permiso `red.ver`). Filtros por tipo y resultado.
 */
const props = defineProps<{
    routerId: number
}>()

const TODOS = 'todos'
const tipo = ref<string>(TODOS)
const resultado = ref<string>(TODOS)

const itemsTipo: SelectItem[] = [
    { label: 'Todos los tipos', value: TODOS },
    ...Object.entries(TIPOS_EVENTO_RED).map(([valor, t]) => ({ label: t.etiqueta, value: valor, icon: t.icono })),
]
const itemsResultado: SelectItem[] = [
    { label: 'Todos', value: TODOS },
    { label: 'Aceptados', value: 'ok' },
    { label: 'Fallidos', value: 'error' },
]

const lista = usePaginacionCursor(cursor => useRed().eventos({
    router_id: props.routerId,
    ...(tipo.value !== TODOS ? { tipo: tipo.value as EventoRed['tipo'] } : {}),
    ...(resultado.value !== TODOS ? { resultado: resultado.value as 'ok' | 'error' } : {}),
}, cursor))

watch([tipo, resultado], () => void lista.recargar())
onMounted(() => void lista.recargar())

const columnas: TableColumn<EventoRed>[] = [
    { accessorKey: 'tipo', header: 'Tipo' },
    { id: 'comando', header: 'Qué se mandó', meta: { class: { td: 'whitespace-normal' } } },
    { id: 'respuesta', header: 'Qué respondió', meta: SOLO_ANCHO },
    { accessorKey: 'created_at', header: 'Cuándo', meta: { class: { td: 'whitespace-nowrap' } } },
]
</script>

<template>
    <div
        class="flex flex-col gap-3"
        data-prueba="router-bitacora"
    >
        <div class="flex flex-wrap items-center gap-2">
            <USelect
                v-model="tipo"
                :items="itemsTipo"
                icon="i-lucide-filter"
                aria-label="Filtrar por tipo de comando"
                class="w-48"
            />
            <USelect
                v-model="resultado"
                :items="itemsResultado"
                icon="i-lucide-circle-check"
                aria-label="Filtrar por resultado"
                class="w-40"
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
                :ui="{ thead: 'bg-(--ax-cabecera-tabla)', th: 'text-xs', td: 'py-2.5' }"
            >
                <template #tipo-cell="{ row }">
                    <UBadge
                        :label="TIPOS_EVENTO_RED[row.original.tipo].etiqueta"
                        :icon="TIPOS_EVENTO_RED[row.original.tipo].icono"
                        :color="colorEventoRed(row.original)"
                        variant="soft"
                        size="sm"
                    />
                </template>
                <template #comando-cell="{ row }">
                    <span class="text-sm text-default">{{ resumenComando(row.original) }}</span>
                </template>
                <template #respuesta-cell="{ row }">
                    <span
                        class="text-sm"
                        :class="row.original.ok ? 'text-muted' : 'text-error'"
                    >{{ resumenRespuesta(row.original) }}</span>
                </template>
                <template #created_at-cell="{ row }">
                    <span class="text-sm text-muted">{{ formatearFechaHora(row.original.created_at) }}</span>
                </template>
                <template #empty>
                    <UEmpty
                        icon="i-lucide-history"
                        title="Sin comandos"
                        description="Argos todavía no le mandó nada a este router con estos filtros."
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
</template>
