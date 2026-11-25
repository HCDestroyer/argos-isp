<script setup lang="ts">
import type { DropdownMenuItem, TableColumn } from '@nuxt/ui'

/**
 * Estados de cuenta importados (A3, fase 4 §10.3), en el sistema visual nuevo: tarjeta con el
 * filtro por cuenta y la lista con su avance (líneas conciliadas); cada fila abre su conciliación
 * en dos columnas. Acción principal «Importar estado de cuenta» (el archivo tal como lo descarga
 * el banco, `bancos.importar_extracto_archivo`); en «Más», el reporte y las reglas.
 */
definePageMeta({ permiso: 'bancos.ver' })

useHead({ title: 'Conciliación bancaria · ArgosIsp' })

const route = useRoute()
const router = useRouter()
const toast = useToast()
const { puede, enlace } = usePermisos()

const cuentaId = ref<number | null>(Number(route.query.cuenta) || null)
const importando = ref(false)

const lista = usePaginacionCursor(cursor => useExtractos().listar(cuentaId.value ?? undefined, cursor))

const columnas: TableColumn<Extracto>[] = [
    { accessorKey: 'cuenta_nombre', header: 'Extracto' },
    { accessorKey: 'saldo_inicial', header: 'Saldo inicial', meta: { class: { th: 'hidden text-right lg:table-cell', td: 'hidden text-right lg:table-cell' } } },
    { accessorKey: 'saldo_final', header: 'Saldo final', meta: { class: { th: 'hidden text-right sm:table-cell', td: 'hidden text-right sm:table-cell' } } },
    { accessorKey: 'conciliadas', header: 'Conciliadas' },
    { id: 'acciones', header: '', meta: { class: { td: 'w-0 text-right' } } },
]

const itemsMas = computed<DropdownMenuItem[][]>(() => [[
    ...(enlace('/bancos/conciliacion') ? [{ label: 'Reporte de conciliación', icon: 'i-lucide-scale', to: enlace('/bancos/conciliacion') }] : []),
    { label: 'Reglas de conciliación', icon: 'i-lucide-wand-sparkles', to: '/bancos/reglas' },
    ...(enlace('/bancos/transito') ? [{ label: 'Fondos en tránsito', icon: 'i-lucide-truck', to: enlace('/bancos/transito') }] : []),
]])

const menuFila = useMenuFila<Extracto>(extracto => [
    { etiqueta: 'Conciliar', icono: 'i-lucide-scale', to: `/bancos/extractos/${extracto.id}` },
    ...(enlace('/bancos/conciliacion') ? [{ etiqueta: 'Ver el reporte de la cuenta', icono: 'i-lucide-file-check', to: `/bancos/conciliacion?cuenta=${extracto.cuenta_id}`, soloMenu: true }] : []),
])

function alImportar(extracto: Extracto) {
    toast.add({
        title: `Extracto #${extracto.id} importado`,
        description: `${extracto.lineas} líneas de ${extracto.cuenta_nombre}, del ${formatearFecha(extracto.desde)} al ${formatearFecha(extracto.hasta)}`,
        icon: 'i-lucide-circle-check',
        color: 'success',
    })
    void lista.recargar()
}

watch(cuentaId, async (valor) => {
    await router.replace({ query: valor ? { cuenta: String(valor) } : {} })
    await lista.recargar()
})

onMounted(() => {
    void lista.recargar()
})
</script>

<template>
    <PanelPagina
        id="extractos"
        titulo="Conciliación bancaria"
        icono="i-lucide-scale"
    >
        <template #acciones>
            <UDropdownMenu
                :items="itemsMas"
                :content="{ align: 'end' }"
            >
                <UButton
                    icon="i-lucide-ellipsis"
                    color="neutral"
                    variant="outline"
                    size="lg"
                    class="rounded-full"
                    aria-label="Más: reporte y reglas"
                    data-prueba="mas-extractos"
                />
            </UDropdownMenu>
        </template>

        <template #accion-principal>
            <UButton
                v-if="puede('bancos.importar_extracto_archivo')"
                label="Importar estado de cuenta"
                icon="i-lucide-file-up"
                size="lg"
                class="glow-brand rounded-full px-5"
                data-prueba="abrir-importar-extracto"
                @click="importando = true"
            />
        </template>

        <div class="surface-card flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-2xl">
            <div class="flex flex-wrap items-center gap-2 p-3 sm:p-4">
                <CuentaBancoSelect
                    v-model="cuentaId"
                    con-todas
                    aria-label="Cuenta"
                    class="w-full sm:w-80"
                />
            </div>

            <div
                v-if="lista.problema.value"
                class="p-3 sm:p-4"
            >
                <ProblemaAlerta
                    :problema="lista.problema.value"
                    :reintentar="lista.recargar"
                    :reintentando="lista.cargando.value"
                    data-prueba="extractos-error"
                />
            </div>
            <template v-else>
                <UContextMenu :items="menuFila.items.value">
                    <UTable
                        :data="lista.filas.value"
                        :columns="columnas"
                        :loading="lista.cargando.value"
                        sticky
                        class="min-h-0 flex-1"
                        :ui="{ thead: 'bg-(--ax-cabecera-tabla)', th: 'text-xs', td: 'py-3' }"
                        data-menu-contextual
                        data-prueba="tabla-extractos"
                        @contextmenu="menuFila.alContextmenu"
                    >
                        <template #cuenta_nombre-cell="{ row }">
                            <div class="flex min-w-0 items-center gap-3">
                                <span class="pastilla-icono size-9 shrink-0 bg-primary/10 text-primary">
                                    <UIcon
                                        name="i-lucide-landmark"
                                        class="size-4"
                                    />
                                </span>
                                <div class="flex min-w-0 flex-col">
                                    <ULink
                                        :to="`/bancos/extractos/${row.original.id}`"
                                        class="truncate font-semibold text-highlighted hover:text-primary"
                                    >
                                        {{ row.original.cuenta_nombre }}
                                    </ULink>
                                    <span class="truncate text-xs text-muted">{{ formatearFechaCorta(row.original.desde) }} al {{ formatearFechaCorta(row.original.hasta) }}<template v-if="row.original.archivo"> · {{ row.original.archivo }}</template></span>
                                    <span
                                        v-if="row.original.motivo_no_encadena"
                                        class="text-xs text-warning"
                                    >No encadena: {{ row.original.motivo_no_encadena }}</span>
                                </div>
                            </div>
                        </template>
                        <template #saldo_inicial-cell="{ row }">
                            <span class="tabular-nums">{{ formatearQuetzales(row.original.saldo_inicial) }}</span>
                        </template>
                        <template #saldo_final-cell="{ row }">
                            <span class="font-semibold tabular-nums">{{ formatearQuetzales(row.original.saldo_final) }}</span>
                        </template>
                        <template #conciliadas-cell="{ row }">
                            <UBadge
                                :label="`${row.original.conciliadas} de ${row.original.lineas}`"
                                :color="row.original.conciliadas === row.original.lineas ? 'success' : 'warning'"
                                :icon="row.original.conciliadas === row.original.lineas ? 'i-lucide-circle-check' : 'i-lucide-list-checks'"
                                variant="subtle"
                                size="sm"
                                class="rounded-full"
                            />
                        </template>
                        <template #acciones-cell="{ row }">
                            <div class="flex items-center justify-end gap-0.5">
                                <AccionesFila
                                    :acciones="menuFila.accionesDe(row.original)"
                                    :nombre="row.original.cuenta_nombre"
                                />
                                <UDropdownMenu
                                    :items="menuFila.itemsDe(row.original)"
                                    :content="{ align: 'end' }"
                                >
                                    <UButton
                                        icon="i-lucide-ellipsis"
                                        color="neutral"
                                        variant="ghost"
                                        size="sm"
                                        :aria-label="`Más acciones del estado de cuenta ${row.original.id}`"
                                    />
                                </UDropdownMenu>
                            </div>
                        </template>
                        <template #empty>
                            <UEmpty
                                icon="i-lucide-file-spreadsheet"
                                title="Sin estados de cuenta importados"
                                description="Importa el estado de cuenta del banco, tal como lo descargas, para conciliarlo con Argos."
                                variant="naked"
                            />
                        </template>
                    </UTable>
                </UContextMenu>
                <PaginacionCursor
                    :pagina="lista.pagina.value"
                    :hay-anterior="lista.hayAnterior.value"
                    :hay-siguiente="lista.haySiguiente.value"
                    :cargando="lista.cargando.value"
                    :filas="lista.filas.value.length"
                    class="border-t border-(--ax-borde) px-3 py-2"
                    @anterior="lista.anterior"
                    @siguiente="lista.siguiente"
                />
            </template>
        </div>

        <ExtractoImportarModal
            v-if="puede('bancos.importar_extracto_archivo')"
            v-model:open="importando"
            :cuenta-id="cuentaId"
            @hecho="alImportar"
        />
    </PanelPagina>
</template>
