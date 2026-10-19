<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'

/**
 * Conciliación bancaria (A3, fase 4 §10.3): extractos importados por cuenta con su avance
 * (líneas conciliadas), "Importar extracto" (`bancos.importar_extracto`), las reglas y el reporte.
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
]

function alImportar(extracto: Extracto) {
    toast.add({
        title: `Extracto #${extracto.id} importado`,
        description: `${extracto.lineas} líneas de ${extracto.cuenta_nombre}, del ${formatearFecha(extracto.desde)} al ${formatearFecha(extracto.hasta)}`,
        icon: 'i-lucide-circle-check',
        color: 'success',
    })
    void router.push(`/bancos/extractos/${extracto.id}`)
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
        icono="i-lucide-file-spreadsheet"
    >
        <template #acciones>
            <UButton
                :to="enlace('/bancos/conciliacion')"
                label="Reporte"
                icon="i-lucide-scale"
                color="neutral"
                variant="outline"
                :ui="{ label: 'hidden sm:inline' }"
                aria-label="Reporte de conciliación"
            />
            <UButton
                to="/bancos/reglas"
                label="Reglas"
                icon="i-lucide-wand-sparkles"
                color="neutral"
                variant="outline"
                :ui="{ label: 'hidden sm:inline' }"
                aria-label="Reglas de conciliación"
            />
            <UButton
                v-if="puede('bancos.importar_extracto')"
                label="Importar extracto"
                icon="i-lucide-upload"
                :ui="{ label: 'hidden sm:inline' }"
                aria-label="Importar extracto"
                data-prueba="abrir-importar-extracto"
                @click="importando = true"
            />
        </template>

        <div class="flex flex-col gap-4">
            <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <CuentaBancoSelect
                    v-model="cuentaId"
                    con-todas
                    aria-label="Cuenta"
                />
            </div>

            <ProblemaAlerta
                v-if="lista.problema.value"
                :problema="lista.problema.value"
                :reintentar="lista.recargar"
                :reintentando="lista.cargando.value"
                data-prueba="extractos-error"
            />
            <template v-else>
                <UTable
                    :data="lista.filas.value"
                    :columns="columnas"
                    :loading="lista.cargando.value"
                    data-prueba="tabla-extractos"
                >
                    <template #cuenta_nombre-cell="{ row }">
                        <div class="flex min-w-0 flex-col">
                            <ULink
                                :to="`/bancos/extractos/${row.original.id}`"
                                class="text-sm font-medium text-highlighted hover:text-primary"
                            >
                                #{{ row.original.id }} · {{ row.original.cuenta_nombre }}
                            </ULink>
                            <span class="text-xs text-muted">{{ formatearFecha(row.original.desde) }} → {{ formatearFecha(row.original.hasta) }}<template v-if="row.original.archivo"> · {{ row.original.archivo }}</template></span>
                            <span
                                v-if="row.original.motivo_no_encadena"
                                class="text-xs text-warning"
                            >No encadena: {{ row.original.motivo_no_encadena }}</span>
                        </div>
                    </template>
                    <template #saldo_inicial-cell="{ row }">
                        <span class="tabular-nums">{{ formatearQuetzales(row.original.saldo_inicial) }}</span>
                    </template>
                    <template #saldo_final-cell="{ row }">
                        <span class="tabular-nums">{{ formatearQuetzales(row.original.saldo_final) }}</span>
                    </template>
                    <template #conciliadas-cell="{ row }">
                        <UBadge
                            :label="`${row.original.conciliadas} de ${row.original.lineas}`"
                            :color="row.original.conciliadas === row.original.lineas ? 'success' : 'warning'"
                            :icon="row.original.conciliadas === row.original.lineas ? 'i-lucide-circle-check' : 'i-lucide-list-checks'"
                            variant="subtle"
                            size="sm"
                        />
                    </template>
                    <template #empty>
                        <UEmpty
                            icon="i-lucide-file-spreadsheet"
                            title="Sin extractos importados"
                            description="Importa el extracto del banco para conciliarlo con el libro."
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

        <ExtractoImportarModal
            v-if="puede('bancos.importar_extracto')"
            v-model:open="importando"
            :cuenta-id="cuentaId"
            @hecho="alImportar"
        />
    </PanelPagina>
</template>
