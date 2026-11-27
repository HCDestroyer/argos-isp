<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { TableColumn } from '@nuxt/ui'

/**
 * Pestaña «Caja chica» de Cajas y efectivo (tablero PlanCajas; B9): arriba la cuenta que siempre
 * debe dar («efectivo que debe haber + comprobantes sin reponer = fondo fijo»), los gastos sin
 * reponer con su comprobante y, a la derecha, los datos de la caja (encargada, fondo, última
 * reposición y último conteo) con «Registrar gasto» y «Reponer». Sin tope por gasto (decisión del
 * PM del 26 nov): el tablero mostraba «Tope por gasto», que ya no existe.
 */
const props = defineProps<{
    estado: EstadoCajaChica
    gastos: Egreso[]
    problemaGastos: Problem | null
    cargandoGastos: boolean
}>()

const emit = defineEmits<{
    gasto: []
    reponer: []
    contar: []
    recargarGastos: []
}>()

const { puede } = usePermisos()

/** Solo los gastos vigentes que aún no se reponen: son los comprobantes que cuentan para el fondo. */
const sinReponer = computed(() => props.gastos.filter(g => g.estado === 'registrado' && !g.reposicion_id))
const porReponer = computed(() => Number(props.estado.por_reponer) > 0)

const columnas: TableColumn<Egreso>[] = [
    { id: 'numero', header: 'N.º', meta: { class: { th: 'w-20 max-sm:hidden', td: 'w-20 max-sm:hidden' } } },
    { id: 'descripcion', header: 'En qué se gastó' },
    { id: 'tipo', header: 'Tipo de gasto', meta: { class: { th: 'w-36 max-xl:hidden', td: 'w-36 max-xl:hidden' } } },
    { id: 'cuando', header: 'Cuándo', meta: { class: { th: 'w-24 max-md:hidden', td: 'w-24 max-md:hidden' } } },
    { id: 'monto', header: 'Monto', meta: { class: { th: 'w-28 text-end', td: 'w-28 text-end' } } },
    { id: 'comprobante', header: 'Comprobante', meta: { class: { th: 'w-48 max-sm:hidden', td: 'w-48 max-sm:hidden' } } },
]

function chipComprobante(gasto: Egreso): { etiqueta: string, color: 'success' | 'info' | 'warning', icono: string } {
    if (gasto.compra_id) {
        return { etiqueta: 'Factura · en Compras', color: 'info', icono: 'i-lucide-file-text' }
    }
    if (gasto.con_comprobante === false) {
        return { etiqueta: 'Sin comprobante', color: 'warning', icono: 'i-lucide-triangle-alert' }
    }
    return { etiqueta: 'Con comprobante', color: 'success', icono: 'i-lucide-image' }
}
</script>

<template>
    <div
        class="flex min-h-0 flex-1 flex-col lg:flex-row"
        data-prueba="caja-chica"
    >
        <div class="flex min-w-0 flex-1 flex-col">
            <div
                class="m-3 rounded-2xl border border-(--ax-borde) p-4 lg:hidden"
                data-prueba="caja-chica-movil"
            >
                <div class="flex items-center gap-2">
                    <div class="flex-1">
                        <p class="text-xs text-muted">
                            Debe haber en efectivo
                        </p>
                        <p class="text-2xl font-bold tabular-nums text-highlighted">
                            {{ formatearQuetzales(estado.efectivo) }}
                        </p>
                    </div>
                    <UBadge
                        :label="estado.cuadra ? 'Cuadra' : 'No cuadra'"
                        :icon="estado.cuadra ? 'i-lucide-check' : 'i-lucide-triangle-alert'"
                        :color="estado.cuadra ? 'success' : 'error'"
                        variant="soft"
                        class="rounded-full"
                    />
                </div>
                <UProgress
                    :model-value="Math.min(Math.max(estado.porcentaje, 0), 100)"
                    size="sm"
                    class="mt-2"
                    :color="estado.porcentaje < 30 ? 'error' : 'primary'"
                    aria-label="Efectivo que queda del fondo"
                />
                <div class="mt-1 flex items-center gap-2">
                    <p class="flex-1 text-xs text-muted">
                        Fondo fijo {{ formatearQuetzales(estado.fondo_vigente) }} · comprobantes {{ formatearQuetzales(estado.comprobantes.monto) }}
                    </p>
                    <UButton
                        v-if="puede('caja_chica.contar')"
                        label="Contar"
                        icon="i-lucide-calculator"
                        color="neutral"
                        variant="link"
                        size="xs"
                        data-prueba="movil-contar"
                        @click="emit('contar')"
                    />
                </div>
            </div>
            <div class="grid grid-cols-[1fr_auto_1fr_auto_1fr] items-stretch gap-2 p-4 max-lg:hidden">
                <div class="rounded-2xl bg-(--ax-panel) px-4 py-3">
                    <p class="text-xs text-muted">
                        Efectivo que debe haber
                    </p>
                    <p
                        class="text-xl font-bold tabular-nums text-highlighted"
                        data-prueba="caja-chica-efectivo"
                    >
                        {{ formatearQuetzales(estado.efectivo) }}
                    </p>
                </div>
                <span class="self-center text-center font-bold text-dimmed max-sm:hidden">+</span>
                <div class="rounded-2xl bg-(--ax-panel) px-4 py-3">
                    <p class="text-xs text-muted">
                        Comprobantes sin reponer
                    </p>
                    <p
                        class="text-xl font-bold tabular-nums text-highlighted"
                        data-prueba="caja-chica-comprobantes"
                    >
                        {{ formatearQuetzales(estado.comprobantes.monto) }}
                    </p>
                </div>
                <span class="self-center text-center font-bold text-dimmed max-sm:hidden">=</span>
                <div class="rounded-2xl bg-(--ax-panel) px-4 py-3">
                    <p
                        class="flex items-center gap-1 text-xs"
                        :class="estado.cuadra ? 'text-success' : 'text-error'"
                    >
                        <UIcon
                            :name="estado.cuadra ? 'i-lucide-check' : 'i-lucide-triangle-alert'"
                            class="size-3.5"
                        />
                        {{ estado.cuadra ? 'Fondo fijo' : 'No cuadra con el fondo' }}
                    </p>
                    <p class="text-xl font-bold tabular-nums text-highlighted">
                        {{ formatearQuetzales(estado.fondo_vigente) }}
                    </p>
                </div>
            </div>

            <ProblemaAlerta
                v-if="problemaGastos"
                class="m-3"
                :problema="problemaGastos"
                :reintentar="() => emit('recargarGastos')"
                :reintentando="cargandoGastos"
            />
            <UTable
                v-else
                :data="sinReponer"
                :columns="columnas"
                :loading="cargandoGastos"
                sticky
                class="min-h-0 flex-1"
                :ui="{ base: 'table-fixed', thead: 'bg-(--ax-cabecera-tabla)', th: 'text-xs uppercase', td: 'py-3' }"
                data-prueba="tabla-gastos-caja-chica"
            >
                <template #numero-cell="{ row }">
                    <span class="font-mono text-sm">{{ numeroMovimiento('G', row.original.id) }}</span>
                </template>
                <template #descripcion-cell="{ row }">
                    <span class="flex min-w-0 flex-col">
                        <span class="truncate font-semibold text-highlighted">{{ row.original.descripcion ?? row.original.categoria_nombre }}</span>
                        <span class="truncate text-xs text-muted xl:hidden">{{ row.original.categoria_nombre }}<span class="md:hidden"> · {{ cuandoEfectivo(row.original.created_at) }}</span></span>
                    </span>
                </template>
                <template #tipo-cell="{ row }">
                    <span class="text-sm text-muted">{{ row.original.categoria_nombre }}{{ row.original.cuenta_codigo.startsWith('5.7') ? ' (interno)' : '' }}</span>
                </template>
                <template #cuando-cell="{ row }">
                    <span class="text-sm text-muted">{{ cuandoEfectivo(row.original.created_at) }}</span>
                </template>
                <template #monto-cell="{ row }">
                    <span class="font-semibold tabular-nums">{{ formatearQuetzales(row.original.monto) }}</span>
                </template>
                <template #comprobante-cell="{ row }">
                    <UBadge
                        :label="chipComprobante(row.original).etiqueta"
                        :icon="chipComprobante(row.original).icono"
                        :color="chipComprobante(row.original).color"
                        variant="soft"
                        class="rounded-full"
                    />
                </template>
                <template #empty>
                    <UEmpty
                        icon="i-lucide-receipt"
                        title="Sin gastos por reponer"
                        description="La caja chica tiene su fondo completo."
                        variant="naked"
                    />
                </template>
            </UTable>

            <div class="flex flex-wrap items-center gap-3 border-t border-(--ax-borde) px-4 py-3 max-lg:hidden">
                <p class="flex-1 text-xs text-muted">
                    Sin comprobante no hay gasto. Un gasto con factura a nombre de la empresa pasa a Compras para no perder el IVA.
                </p>
                <UButton
                    v-if="puede('caja_chica.contar')"
                    label="Contar la caja chica"
                    icon="i-lucide-calculator"
                    color="neutral"
                    variant="outline"
                    size="sm"
                    class="rounded-full"
                    data-prueba="abrir-contar"
                    @click="emit('contar')"
                />
            </div>
        </div>

        <aside class="flex w-80 shrink-0 flex-col gap-3 border-s border-(--ax-borde) p-4 max-lg:hidden">
            <p class="flex items-center gap-2 text-xs font-semibold tracking-wide text-muted uppercase">
                <UIcon
                    name="i-lucide-wallet"
                    class="size-4"
                />
                {{ estado.nombre }}
            </p>
            <dl class="flex flex-col text-sm">
                <div class="flex justify-between gap-3 border-b border-(--ax-borde) py-2">
                    <dt class="text-muted">
                        Encargada
                    </dt>
                    <dd class="font-semibold text-highlighted">
                        {{ estado.encargado_nombre ?? 'Sin asignar' }}
                    </dd>
                </div>
                <div class="flex justify-between gap-3 border-b border-(--ax-borde) py-2">
                    <dt class="text-muted">
                        Fondo fijo
                    </dt>
                    <dd class="tabular-nums">
                        {{ formatearQuetzales(estado.fondo_fijo) }}
                    </dd>
                </div>
                <div class="flex justify-between gap-3 border-b border-(--ax-borde) py-2">
                    <dt class="text-muted">
                        Última reposición
                    </dt>
                    <dd>{{ estado.ultima_reposicion ? `${formatearFechaCorta(estado.ultima_reposicion.fecha)} · ${numeroMovimiento('R', estado.ultima_reposicion.id)}` : 'Ninguna' }}</dd>
                </div>
                <div class="flex justify-between gap-3 py-2">
                    <dt class="text-muted">
                        Último conteo
                    </dt>
                    <dd>{{ estado.ultimo_conteo ? `${formatearFechaCorta(estado.ultimo_conteo.fecha)} · ${Number(estado.ultimo_conteo.diferencia) === 0 ? 'cuadró' : `diferencia ${formatearQuetzales(estado.ultimo_conteo.diferencia)}`}` : 'Ninguno' }}</dd>
                </div>
            </dl>
            <p
                class="flex items-start gap-2 rounded-xl border px-3 py-2 text-sm"
                :class="estado.porcentaje < 30 ? 'border-error/30 bg-error/10 text-error' : 'border-warning/30 bg-warning/10 text-warning'"
                data-prueba="caja-chica-porcentaje"
            >
                <UIcon
                    name="i-lucide-triangle-alert"
                    class="mt-0.5 size-4 shrink-0"
                />
                <span v-if="estado.porcentaje < 30">Queda el {{ estado.porcentaje }} % del fondo: repónla por lo gastado.</span>
                <span v-else>Queda el {{ estado.porcentaje }} % del fondo. Se avisa para reponer al bajar del 30 %.</span>
            </p>
            <span class="flex-1" />
            <div class="hidden flex-col gap-2 lg:flex">
                <UButton
                    v-if="puede('caja_chica.registrar_gasto')"
                    label="Registrar gasto"
                    icon="i-lucide-plus"
                    block
                    class="glow-brand rounded-full"
                    data-prueba="abrir-gasto"
                    @click="emit('gasto')"
                />
                <UButton
                    v-if="puede('caja_chica.reponer')"
                    :label="`Reponer ${formatearQuetzales(estado.por_reponer)}`"
                    icon="i-lucide-refresh-cw"
                    color="neutral"
                    variant="outline"
                    block
                    class="rounded-full"
                    :disabled="!porReponer"
                    data-prueba="abrir-reponer"
                    @click="emit('reponer')"
                />
            </div>
        </aside>
    </div>
</template>
