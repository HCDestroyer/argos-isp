<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'

/**
 * Historial de sesiones PPPoE del servicio (`GET /sesiones?servicio_id=`, `sesiones.ver`), de la más
 * reciente a la más vieja: inicio y fin (hora de Guatemala), IPv4, consumo y causa de fin. Una sesión
 * de un router sin RADIUS (`origen = 'sondeo'`, `contratos/pppoe-local.md` §6) lleva el distintivo
 * «Por sondeo», sin consumo y con «—» si no hay IP del NAS.
 */
const props = defineProps<{
    servicioId: number
}>()

defineExpose({ recargar: () => lista.recargar() })

const lista = usePaginacionCursor(cursor => useSesiones().listar({ servicio_id: props.servicioId, limit: 10 }, cursor))

const columnas: TableColumn<Sesion>[] = [
    { accessorKey: 'inicio', header: 'Sesión' },
    { accessorKey: 'ipv4', header: 'IPv4 y NAS', meta: SOLO_ANCHO },
    { accessorKey: 'bytes_in', header: 'Consumo', meta: SOLO_ESCRITORIO },
    { accessorKey: 'causa_fin', header: 'Fin', meta: SOLO_ESCRITORIO },
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
            tabindex="0"
            aria-label="Historial de sesiones"
            data-prueba="sesiones-servicio"
        >
            <template #inicio-cell="{ row }">
                <div
                    class="flex flex-col gap-0.5"
                    :data-prueba="`sesion-${row.original.id}`"
                >
                    <span class="flex flex-wrap items-center gap-1.5 text-sm text-highlighted">
                        {{ formatearFechaHora(row.original.inicio) }}
                        <UBadge
                            v-if="row.original.fin === null"
                            label="Abierta"
                            icon="i-lucide-activity"
                            color="success"
                            variant="subtle"
                            size="sm"
                        />
                        <UTooltip
                            v-if="esSesionPorSondeo(row.original)"
                            :text="DISTINTIVO_SONDEO.explicacion"
                        >
                            <UBadge
                                :label="DISTINTIVO_SONDEO.etiqueta"
                                :icon="DISTINTIVO_SONDEO.icono"
                                :color="DISTINTIVO_SONDEO.color"
                                variant="subtle"
                                size="sm"
                                data-prueba="sesion-por-sondeo"
                            />
                        </UTooltip>
                    </span>
                    <span class="text-xs text-muted">
                        {{ row.original.fin ? `hasta ${formatearFechaHora(row.original.fin)} · ` : '' }}{{ formatearDuracion(row.original.inicio, row.original.fin) }}
                    </span>
                    <span class="font-mono text-xs text-muted sm:hidden">{{ row.original.ipv4 ?? 'Sin IPv4' }}</span>
                    <span class="text-xs text-muted lg:hidden">{{ textoConsumoSesion(row.original) }}</span>
                    <span
                        v-if="textoCausaFin(row.original)"
                        class="text-xs text-muted lg:hidden"
                    >{{ textoCausaFin(row.original) }}</span>
                </div>
            </template>
            <template #ipv4-cell="{ row }">
                <div class="flex flex-col font-mono text-xs">
                    <span class="text-sm">{{ row.original.ipv4 ?? 'Sin IPv4' }}</span>
                    <span class="text-muted">NAS {{ textoNasSesion(row.original) }}</span>
                </div>
            </template>
            <template #bytes_in-cell="{ row }">
                <span
                    class="text-sm"
                    :class="esSesionPorSondeo(row.original) ? 'text-muted' : ''"
                >{{ textoConsumoSesion(row.original) }}</span>
            </template>
            <template #causa_fin-cell="{ row }">
                <span class="text-sm whitespace-normal">{{ textoCausaFin(row.original) ?? (row.original.fin ? '—' : 'Conectada') }}</span>
            </template>
            <template #empty>
                <UEmpty
                    icon="i-lucide-activity"
                    title="Sin sesiones registradas"
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
