<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'

/** Pestaña "Servicios" de la ficha del cliente. Recibe los servicios ya cargados por la página. */
const props = withDefaults(defineProps<{
    servicios: Servicio[]
    cargando?: boolean
}>(), {
    cargando: false,
})

const { puede, enlace } = usePermisos()

/** Solo para el precio del plan; los nombres vienen en cada `Servicio`. */
const planes = ref(new Map<number, Plan>())

const columnas: TableColumn<Servicio>[] = [
    { accessorKey: 'user_ppp', header: 'Servicio' },
    { accessorKey: 'plan_id', header: 'Plan' },
    { accessorKey: 'ipv4', header: 'Direcciones', meta: SOLO_ANCHO },
    { accessorKey: 'estado', header: 'Estado', meta: SOLO_ANCHO },
    { accessorKey: 'fecha_instalacion', header: 'Instalación', meta: SOLO_ESCRITORIO },
]

/** Precio efectivo: `costo_override` del servicio o el precio del plan. */
function precio(servicio: Servicio): string | null {
    return servicio.costo_override ?? planes.value.get(servicio.plan_id)?.precio ?? null
}

onMounted(async () => {
    if (!puede('planes.ver')) {
        return
    }
    const resultado = await usePlanes().listar()
    if (resultado.ok) {
        planes.value = new Map(resultado.data.data.map(plan => [plan.id, plan]))
    }
})
</script>

<template>
    <UTable
        :data="props.servicios"
        :columns="columnas"
        :loading="cargando"
    >
        <template #user_ppp-cell="{ row }">
            <div class="flex min-w-36 flex-col">
                <ULink
                    :to="enlace(`/servicios/${row.original.id}`)"
                    class="font-mono text-sm font-medium text-highlighted hover:text-primary"
                >
                    {{ etiquetaServicio(row.original) }}
                </ULink>
                <span class="text-xs text-muted">#{{ row.original.id }} · {{ nombreRouter(row.original) }}</span>
                <span
                    v-if="row.original.ipv4"
                    class="font-mono text-xs text-muted sm:hidden"
                >{{ row.original.ipv4 }}</span>
                <EstadoServicioBadge
                    :estado="row.original.estado"
                    size="sm"
                    class="mt-1 self-start sm:hidden"
                />
                <SuspensionManualBadge
                    :servicio="row.original"
                    size="sm"
                    con-motivo
                    class="mt-1 sm:hidden"
                />
            </div>
        </template>

        <template #plan_id-cell="{ row }">
            <div class="flex flex-col">
                <span class="text-sm">{{ nombrePlan(row.original) }}</span>
                <span class="text-xs text-muted">
                    {{ formatearQuetzales(precio(row.original)) }}
                    <template v-if="row.original.costo_override"> · precio especial</template>
                </span>
            </div>
        </template>

        <template #ipv4-cell="{ row }">
            <div class="flex flex-col font-mono text-xs">
                <span class="text-sm">{{ row.original.ipv4 ?? 'Sin IPv4' }}</span>
                <span
                    v-if="row.original.prefijo_delegado_v6"
                    class="text-muted"
                >{{ row.original.prefijo_delegado_v6 }}</span>
                <span
                    v-else
                    class="text-muted"
                >IPv6: {{ row.original.ipv6_modo === 'ninguno' ? 'no' : row.original.ipv6_modo }}</span>
            </div>
        </template>

        <template #estado-cell="{ row }">
            <div class="flex flex-wrap items-center gap-1">
                <EstadoServicioBadge
                    :estado="row.original.estado"
                    size="sm"
                />
                <UBadge
                    v-if="row.original.promesa_activa"
                    label="Promesa"
                    icon="i-lucide-calendar-clock"
                    color="info"
                    variant="outline"
                    size="sm"
                />
                <SuspensionManualBadge
                    :servicio="row.original"
                    size="sm"
                    con-motivo
                />
            </div>
        </template>

        <template #fecha_instalacion-cell="{ row }">
            <span class="text-sm text-muted">{{ formatearFecha(row.original.fecha_instalacion) }}</span>
        </template>

        <template #empty>
            <UEmpty
                icon="i-lucide-wifi-off"
                title="Sin servicios"
                description="Este cliente todavía no tiene servicios de internet."
                variant="naked"
            />
        </template>
    </UTable>
</template>
