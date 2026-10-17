<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'

/**
 * Un asiento del libro diario con sus movimientos y los totales Debe/Haber (`decimal.js`).
 * Los reversos (anulaciones) se marcan y enlazan al asiento que revierten. Con `conReverso`
 * (libro diario) ofrece "Revertir" si la API lo acepta (`Asiento.revertible`,
 * `libro.revertir_asiento`); si no, dice por qué (`motivo_no_revertible`) y lleva al documento.
 */
const props = withDefaults(defineProps<{
    asiento: Asiento
    /** Enlace al documento de origen (factura o pago); apágalo dentro de su propia ficha. */
    conOrigen?: boolean
    /** Acción "Revertir" (solo en el libro diario). */
    conReverso?: boolean
}>(), {
    conOrigen: true,
    conReverso: false,
})

const emit = defineEmits<{
    revertido: [reverso: Asiento]
}>()

const { puede } = usePermisos()
const toast = useToast()
const revertirAbierto = ref(false)
const puedeRevertir = computed(() => props.conReverso && puede('libro.revertir_asiento'))
const rutaDocumento = computed(() => rutaOrigen(props.asiento))

function revertir(motivo: string, clave: string) {
    return useLibro().revertir(props.asiento.id, motivo, clave)
}

function alRevertir(reverso: Asiento) {
    toast.add({ title: `Asiento #${props.asiento.id} revertido`, description: `Asiento de reverso #${reverso.id}`, icon: 'i-lucide-undo-2', color: 'success' })
    emit('revertido', reverso)
}

const columnas: TableColumn<MovimientoAsiento>[] = [
    { accessorKey: 'cuenta_codigo', header: 'Cuenta' },
    { accessorKey: 'debe', header: 'Debe', meta: { class: { th: 'hidden text-right sm:table-cell', td: 'hidden text-right sm:table-cell' } } },
    { accessorKey: 'haber', header: 'Haber', meta: { class: { th: 'hidden text-right sm:table-cell', td: 'hidden text-right sm:table-cell' } } },
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
                    v-if="asiento.revertido_por"
                    :label="`Revertido por #${asiento.revertido_por}`"
                    icon="i-lucide-undo-2"
                    color="neutral"
                    variant="subtle"
                    size="sm"
                    data-prueba="asiento-revertido"
                />
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
                    <span class="text-sm whitespace-normal">{{ row.original.cuenta_nombre }}<template v-if="row.original.cliente_id"> · cliente {{ row.original.cliente_id }}</template></span>
                    <span class="text-xs tabular-nums text-muted sm:hidden">
                        {{ montoLado(row.original.debe) ? `Debe ${montoLado(row.original.debe)}` : `Haber ${montoLado(row.original.haber)}` }}
                    </span>
                </div>
            </template>
            <template #debe-cell="{ row }">
                <span class="tabular-nums">{{ montoLado(row.original.debe) }}</span>
            </template>
            <template #haber-cell="{ row }">
                <span class="tabular-nums">{{ montoLado(row.original.haber) }}</span>
            </template>
        </UTable>

        <footer class="flex flex-wrap items-center justify-end gap-x-4 gap-y-1 border-t border-default pt-2 text-sm">
            <span class="text-muted">Debe / Haber</span>
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
                icon="i-lucide-octagon-alert"
                color="error"
                variant="solid"
                size="sm"
            />
        </footer>

        <div
            v-if="puedeRevertir && asiento.revertible"
            class="flex justify-end"
        >
            <UButton
                label="Revertir"
                icon="i-lucide-undo-2"
                color="warning"
                variant="outline"
                size="sm"
                :data-prueba="`revertir-asiento-${asiento.id}`"
                @click="revertirAbierto = true"
            />
        </div>
        <p
            v-else-if="puedeRevertir && asiento.revertible === false && asiento.motivo_no_revertible"
            class="flex flex-wrap items-center justify-end gap-x-2 text-xs text-muted"
            :data-prueba="`no-revertible-${asiento.id}`"
        >
            <span>No se revierte aquí: {{ asiento.motivo_no_revertible }}</span>
            <ULink
                v-if="rutaDocumento"
                :to="rutaDocumento"
                class="text-primary"
            >
                Ir al documento
            </ULink>
        </p>

        <AccionMotivoModal
            v-if="puedeRevertir && asiento.revertible"
            v-model:open="revertirAbierto"
            titulo="Revertir asiento"
            :descripcion="`Asiento #${asiento.id} · ${asiento.descripcion}`"
            efecto="Se registra un asiento espejo (debe ↔ haber) con fecha de hoy. El original no se modifica y no se puede revertir dos veces."
            confirmar="Revertir asiento"
            icono="i-lucide-undo-2"
            color="warning"
            :ejecutar="revertir"
            @hecho="alRevertir"
        />
    </article>
</template>
