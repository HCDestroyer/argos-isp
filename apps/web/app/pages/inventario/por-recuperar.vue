<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'

/**
 * Equipos por recuperar (A3, `GET /reportes/equipos-por-recuperar`): equipos en comodato de
 * servicios retirados. Se recuperan desde la ficha del servicio (devolver) o se declaran perdidos.
 */
definePageMeta({ permiso: 'inventario.ver' })

const { enlace } = usePermisos()

useHead({ title: 'Equipos por recuperar · ArgosIsp' })

const lista = usePaginacionCursor(cursor => useReportesInventario().porRecuperar({}, cursor))
onMounted(() => void lista.recargar())

const columnas: TableColumn<EquipoServicio>[] = [
    { id: 'equipo', header: 'Equipo', meta: { class: { td: 'whitespace-normal' } } },
    { id: 'servicio', header: 'Servicio' },
    { accessorKey: 'fecha_asignacion', header: 'Prestado', meta: SOLO_ANCHO },
    { accessorKey: 'valor_libros', header: 'En libros', meta: { class: { th: 'text-right hidden sm:table-cell', td: 'text-right hidden sm:table-cell' } } },
]
</script>

<template>
    <PanelPagina
        id="inventario-por-recuperar"
        titulo="Equipos por recuperar"
        icono="i-lucide-undo-2"
    >
        <div class="flex flex-col gap-4">
            <p class="text-sm text-muted">
                Equipos en casa de clientes cuyo servicio se retiró. Recupéralos con «Devolver» en la ficha del servicio, o declara la pérdida si el cliente no los entrega.
            </p>
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
                    data-prueba="tabla-por-recuperar"
                >
                    <template #equipo-cell="{ row }">
                        <div class="flex min-w-0 flex-col gap-0.5">
                            <span class="font-mono text-sm font-medium text-highlighted">{{ identificacionUnidad(row.original) }}</span>
                            <span class="text-xs text-muted">{{ row.original.producto_nombre }}</span>
                        </div>
                    </template>
                    <template #servicio-cell="{ row }">
                        <div class="flex flex-col gap-0.5 text-sm">
                            <ULink
                                v-if="row.original.servicio_id"
                                :to="enlace(`/servicios/${row.original.servicio_id}#equipos`)"
                                class="text-primary"
                            >Servicio #{{ row.original.servicio_id }}</ULink>
                            <ULink
                                v-if="row.original.cliente_id"
                                :to="enlace(`/clientes/${row.original.cliente_id}`)"
                                class="text-xs text-muted hover:text-primary"
                            >Cliente #{{ row.original.cliente_id }}</ULink>
                        </div>
                    </template>
                    <template #fecha_asignacion-cell="{ row }">
                        <span class="text-sm tabular-nums">{{ row.original.fecha_asignacion ? formatearFecha(row.original.fecha_asignacion) : '—' }}</span>
                    </template>
                    <template #valor_libros-cell="{ row }">
                        <span class="text-sm tabular-nums">{{ row.original.valor_libros ? formatearQuetzales(row.original.valor_libros) : '—' }}</span>
                    </template>
                    <template #empty>
                        <UEmpty
                            icon="i-lucide-undo-2"
                            title="Nada por recuperar"
                            description="Ningún servicio retirado tiene equipos en comodato."
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
    </PanelPagina>
</template>
