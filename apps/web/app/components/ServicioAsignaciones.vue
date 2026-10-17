<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'

/**
 * Historial de asignaciones del servicio (`GET /servicios/:id/asignaciones`): cada tramo con su
 * router, plan, IPv4 y prefijos IPv6, desde y hasta cuándo (hora de Guatemala) y por qué cambió.
 * El vigente tiene `fin: null`.
 */
const props = defineProps<{
    servicioId: number
}>()

defineExpose({ recargar: () => lista.recargar() })

const lista = usePaginacionCursor(cursor => useServicios().asignaciones(props.servicioId, cursor))

const columnas: TableColumn<TramoAsignacion>[] = [
    { accessorKey: 'inicio', header: 'Periodo' },
    { accessorKey: 'plan_nombre', header: 'Router y plan', meta: SOLO_ANCHO },
    { accessorKey: 'ipv4', header: 'Direcciones', meta: { class: { td: 'whitespace-normal min-w-0' } } },
    { accessorKey: 'motivo', header: 'Motivo', meta: SOLO_ESCRITORIO },
]

watch(() => props.servicioId, () => lista.recargar())
onMounted(() => lista.recargar())
</script>

<template>
    <ProblemaAlerta
        v-if="lista.problema.value"
        :problema="lista.problema.value"
        :reintentar="lista.recargar"
        :reintentando="lista.cargando.value"
    />
    <div
        v-else
        class="flex flex-col gap-2"
    >
        <UTable
            :data="lista.filas.value"
            :columns="columnas"
            :loading="lista.cargando.value"
            :ui="{ td: 'py-2.5 align-top' }"
        >
            <template #inicio-cell="{ row }">
                <div class="flex flex-col">
                    <span class="flex items-center gap-1.5 text-sm text-highlighted">
                        {{ formatearFechaHora(row.original.inicio) }}
                        <UBadge
                            v-if="row.original.fin === null"
                            label="Vigente"
                            icon="i-lucide-circle-check"
                            color="success"
                            variant="subtle"
                            size="sm"
                        />
                    </span>
                    <span
                        v-if="row.original.fin"
                        class="text-xs text-muted"
                    >hasta {{ formatearFechaHora(row.original.fin) }}</span>
                    <span class="text-xs text-muted sm:hidden">{{ row.original.router_nombre ?? '—' }} · {{ row.original.plan_nombre ?? '—' }}</span>
                    <span
                        v-if="row.original.motivo"
                        class="text-xs text-muted lg:hidden"
                    >{{ row.original.motivo }}</span>
                </div>
            </template>
            <template #plan_nombre-cell="{ row }">
                <div class="flex flex-col">
                    <span class="text-sm">{{ row.original.plan_nombre ?? (row.original.plan_id ? `Plan #${row.original.plan_id}` : '—') }}</span>
                    <span class="text-xs text-muted">{{ row.original.router_nombre ?? (row.original.router_id ? `Router #${row.original.router_id}` : '—') }}</span>
                </div>
            </template>
            <template #ipv4-cell="{ row }">
                <div class="flex flex-col font-mono text-xs">
                    <span class="text-sm">{{ row.original.ipv4 ?? 'Sin IPv4' }}</span>
                    <span
                        v-if="row.original.prefijo_enlace_v6"
                        class="break-all text-muted"
                    >{{ row.original.prefijo_enlace_v6 }}</span>
                    <span
                        v-if="row.original.prefijo_delegado_v6"
                        class="break-all text-muted"
                    >{{ row.original.prefijo_delegado_v6 }}</span>
                </div>
            </template>
            <template #motivo-cell="{ row }">
                <span class="text-sm whitespace-normal">{{ row.original.motivo ?? '—' }}</span>
            </template>
            <template #empty>
                <UEmpty
                    icon="i-lucide-history"
                    title="Sin asignaciones registradas"
                    variant="naked"
                />
            </template>
        </UTable>
        <PaginacionCursor
            v-if="lista.hayAnterior.value || lista.haySiguiente.value"
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
