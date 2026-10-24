<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { SelectItem, TableColumn } from '@nuxt/ui'
import * as z from 'zod'

/**
 * Conteos físicos (A3, fase C): uno abierto por bodega. «Abrir conteo»
 * (`inventario.abrir_conteo`) lleva a la captura; cerrados con su faltante y sobrante valorizados.
 */
definePageMeta({ permiso: 'inventario.ver' })

useHead({ title: 'Conteos físicos · ArgosIsp' })

const { puede } = usePermisos()

const lista = usePaginacionCursor(cursor => useConteosInventario().listar({}, cursor))
onMounted(() => void lista.recargar())

const columnas: TableColumn<ConteoInventario>[] = [
    { accessorKey: 'bodega_nombre', header: 'Conteo', meta: { class: { td: 'whitespace-normal' } } },
    { accessorKey: 'estado', header: 'Estado' },
    { id: 'resultado', header: 'Faltante / sobrante', meta: { class: { th: 'text-right hidden sm:table-cell', td: 'text-right hidden sm:table-cell' } } },
]

/* Abrir */
const bodegas = shallowRef<SelectItem[]>([])
const abrirAbierto = ref(false)
/** Espejo de `abrirConteoValidator`: bodega obligatoria, motivo hasta 500. */
const esquema = z.object({
    bodega_id: z.number({ message: 'Elige la bodega' }).int().positive('Elige la bodega'),
    motivo: z.string().trim().max(500, 'Máximo 500 caracteres'),
})
const estado = reactive<{ bodega_id: number | undefined, motivo: string }>({ bodega_id: undefined, motivo: '' })
const enviando = ref(false)
const problema = ref<Problem | null>(null)
let clave = nuevaClaveIdempotencia()

async function abrirModal() {
    Object.assign(estado, { bodega_id: undefined, motivo: '' })
    problema.value = null
    clave = nuevaClaveIdempotencia()
    abrirAbierto.value = true
    const resultado = await useBodegas().activas()
    bodegas.value = resultado.ok ? resultado.data.map(b => ({ label: b.nombre, value: b.id, icon: TIPOS_BODEGA[b.tipo].icono })) : []
    problema.value = resultado.ok ? null : resultado.problema
}

async function abrir(evento: { data: z.output<typeof esquema> }) {
    enviando.value = true
    problema.value = null
    const resultado = await useConteosInventario().abrir(evento.data.bodega_id, evento.data.motivo || null, clave)
    enviando.value = false
    if (!resultado.ok) {
        problema.value = resultado.problema
        return
    }
    abrirAbierto.value = false
    await navigateTo(`/inventario/conteos/${resultado.data.id}`)
}
</script>

<template>
    <PanelPagina
        id="inventario-conteos"
        titulo="Conteos físicos"
        icono="i-lucide-clipboard-list"
    >
        <template #acciones>
            <UButton
                v-if="puede('inventario.abrir_conteo')"
                label="Abrir conteo"
                icon="i-lucide-plus"
                data-prueba="abrir-conteo"
                @click="abrirModal"
            />
        </template>

        <div class="flex flex-col gap-4">
            <p class="text-sm text-muted">
                Se captura producto por producto contra lo que había al capturarlo; al cerrar, los faltantes van a mermas (5.6.02) y los sobrantes a 4.2.04. La bodega sigue operando mientras se cuenta.
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
                    data-prueba="tabla-conteos"
                >
                    <template #bodega_nombre-cell="{ row }">
                        <div class="flex min-w-0 flex-col gap-0.5">
                            <ULink
                                :to="`/inventario/conteos/${row.original.id}`"
                                class="text-sm font-medium text-highlighted hover:text-primary"
                                :data-conteo="row.original.id"
                            >Conteo #{{ row.original.id }} · {{ row.original.bodega_nombre }}</ULink>
                            <span class="text-xs text-muted">Corte {{ formatearFecha(row.original.fecha_corte) }}<template v-if="row.original.motivo">
                                · {{ row.original.motivo }}
                            </template></span>
                        </div>
                    </template>
                    <template #estado-cell="{ row }">
                        <UBadge
                            :label="ESTADOS_CONTEO[row.original.estado].etiqueta"
                            :icon="ESTADOS_CONTEO[row.original.estado].icono"
                            :color="ESTADOS_CONTEO[row.original.estado].color"
                            variant="subtle"
                            size="sm"
                        />
                    </template>
                    <template #resultado-cell="{ row }">
                        <span
                            v-if="row.original.estado === 'cerrado'"
                            class="text-sm tabular-nums"
                        >{{ formatearQuetzales(row.original.faltante) }} / {{ formatearQuetzales(row.original.sobrante) }}</span>
                        <span
                            v-else
                            class="text-sm text-muted"
                        >—</span>
                    </template>
                    <template #empty>
                        <UEmpty
                            icon="i-lucide-clipboard-list"
                            title="Sin conteos"
                            description="Abre un conteo para comparar lo físico con el kardex."
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

        <UModal
            v-model:open="abrirAbierto"
            title="Abrir conteo"
            description="Uno abierto por bodega."
            :dismissible="!enviando"
        >
            <template #body>
                <UForm
                    id="form-abrir-conteo"
                    :schema="esquema"
                    :state="estado"
                    class="flex flex-col gap-4"
                    @submit="abrir"
                >
                    <UFormField
                        label="Bodega"
                        name="bodega_id"
                        required
                    >
                        <USelect
                            :model-value="estado.bodega_id"
                            :items="bodegas"
                            placeholder="Elige la bodega"
                            class="w-full"
                            data-prueba="conteo-bodega"
                            @update:model-value="v => estado.bodega_id = typeof v === 'number' ? v : undefined"
                        />
                    </UFormField>
                    <UFormField
                        label="Motivo"
                        name="motivo"
                    >
                        <UInput
                            v-model="estado.motivo"
                            placeholder="Conteo de fin de mes"
                            class="w-full"
                        />
                    </UFormField>
                    <ProblemaAlerta
                        v-if="problema"
                        :problema="problema"
                    />
                </UForm>
            </template>
            <template #footer>
                <div class="flex w-full justify-end gap-2">
                    <UButton
                        label="Cancelar"
                        color="neutral"
                        variant="ghost"
                        :disabled="enviando"
                        @click="abrirAbierto = false"
                    />
                    <UButton
                        type="submit"
                        form="form-abrir-conteo"
                        label="Abrir conteo"
                        icon="i-lucide-clipboard-list"
                        :loading="enviando"
                        data-prueba="conteo-abrir-confirmar"
                    />
                </div>
            </template>
        </UModal>
    </PanelPagina>
</template>
