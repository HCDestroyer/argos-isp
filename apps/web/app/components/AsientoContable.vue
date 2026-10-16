<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'

/**
 * Un asiento del libro diario con sus movimientos y los totales Debe/Haber (`decimal.js`).
 * Los reversos (anulaciones) se marcan y enlazan al asiento que revierten.
 */
const props = withDefaults(defineProps<{
    asiento: Asiento
    /** Enlace al documento de origen (factura o pago); apágalo dentro de su propia ficha. */
    conOrigen?: boolean
}>(), {
    conOrigen: true,
})

const columnas: TableColumn<MovimientoAsiento>[] = [
    { accessorKey: 'cuenta_codigo', header: 'Cuenta' },
    { accessorKey: 'debe', header: 'Debe', meta: { class: { th: 'text-right', td: 'text-right' } } },
    { accessorKey: 'haber', header: 'Haber', meta: { class: { th: 'text-right', td: 'text-right' } } },
]

const totales = computed(() => totalesPartida(props.asiento.movimientos))
const origen = computed(() => ORIGENES_ASIENTO[props.asiento.origen_tipo])
const enlace = computed(() => (props.conOrigen ? rutaOrigen(props.asiento) : null))
</script>

<template>
    <article
        class="flex flex-col gap-2 rounded-lg border border-default p-3"
        :aria-label="`Asiento ${asiento.id}`"
        :data-asiento="asiento.id"
    >
        <header class="flex flex-wrap items-start justify-between gap-2">
            <div class="flex min-w-0 flex-col">
                <p class="text-sm font-medium text-highlighted">
                    Asiento #{{ asiento.id }} · {{ formatearFecha(asiento.fecha) }}
                </p>
                <p class="text-xs text-muted break-words">
                    {{ asiento.descripcion }}
                </p>
            </div>
            <div class="flex flex-wrap items-center gap-1">
                <UBadge
                    v-if="asiento.reversa_de"
                    :label="`Reverso del #${asiento.reversa_de}`"
                    icon="i-lucide-undo-2"
                    color="warning"
                    variant="subtle"
                    size="sm"
                />
                <UBadge
                    :label="asiento.origen_id ? `${origen.etiqueta} ${asiento.origen_id}` : origen.etiqueta"
                    :icon="origen.icono"
                    color="neutral"
                    variant="outline"
                    size="sm"
                    :to="enlace ?? undefined"
                />
            </div>
        </header>

        <UTable
            :data="asiento.movimientos"
            :columns="columnas"
            :ui="{ td: 'py-1.5', th: 'py-1.5' }"
        >
            <template #cuenta_codigo-cell="{ row }">
                <div class="flex min-w-0 flex-col">
                    <span class="font-mono text-xs text-muted">{{ row.original.cuenta_codigo }}</span>
                    <span class="truncate text-sm">{{ row.original.cuenta_nombre }}<template v-if="row.original.cliente_id"> · cliente {{ row.original.cliente_id }}</template></span>
                </div>
            </template>
            <template #debe-cell="{ row }">
                <span class="tabular-nums">{{ montoLado(row.original.debe) }}</span>
            </template>
            <template #haber-cell="{ row }">
                <span class="tabular-nums">{{ montoLado(row.original.haber) }}</span>
            </template>
        </UTable>

        <footer class="flex items-center justify-end gap-4 border-t border-default pt-2 text-sm">
            <span class="text-muted">Totales</span>
            <span
                class="tabular-nums font-medium"
                data-prueba="total-debe"
            >{{ formatearQuetzales(totales.debe) }}</span>
            <span
                class="tabular-nums font-medium"
                data-prueba="total-haber"
            >{{ formatearQuetzales(totales.haber) }}</span>
            <UBadge
                v-if="!cuadra(totales)"
                label="No cuadra"
                color="error"
                variant="solid"
                size="sm"
            />
        </footer>
    </article>
</template>
