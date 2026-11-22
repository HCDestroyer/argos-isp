<script setup lang="ts">
import type { TableColumn, TabsItem } from '@nuxt/ui'

/**
 * Revisión de titulares (contrato Iris 0.14.1, A1): los cambios de titular a una empresa que
 * Argos no decidió solo (representante nuevo o varias empresas con el mismo NIT verificado). La
 * lista no trae datos del representante: se ven en el detalle, que queda en la bitácora.
 * Pestañas por estado dentro de la tarjeta, como el resto del rediseño; paginación por cursor.
 */
definePageMeta({ permiso: 'clientes.ver_identidad' })

useHead({ title: 'Revisión de titulares · ArgosIsp' })

const route = useRoute()
const router = useRouter()

type Pestana = typeof PESTANAS_REVISION_TITULAR[number]

function pestanaQuery(valor: unknown): Pestana {
    return (PESTANAS_REVISION_TITULAR as readonly string[]).includes(String(valor)) ? valor as Pestana : 'pendiente'
}

const estado = ref<Pestana>(pestanaQuery(route.query.estado))

const pestanas = computed<TabsItem[]>(() => PESTANAS_REVISION_TITULAR.map(valor => ({
    label: ESTADOS_REVISION_TITULAR[valor].plural,
    value: valor,
    icon: ESTADOS_REVISION_TITULAR[valor].icono,
})))

const lista = usePaginacionCursor(cursor => useTitularesEmpresa().listar(estado.value, cursor))

const columnas = computed<TableColumn<RevisionTitularEmpresa>[]>(() => [
    { accessorKey: 'razon_social', header: 'Empresa' },
    { accessorKey: 'motivo_revision', header: 'Por qué se revisa', meta: SOLO_ANCHO },
    { accessorKey: 'servicio_id', header: 'Servicio', meta: SOLO_ESCRITORIO },
    { accessorKey: 'created_at', header: estado.value === 'pendiente' ? 'Pedida' : 'Decidida', meta: SOLO_ANCHO },
    { accessorKey: 'estado', header: 'Estado', meta: { class: { th: 'text-right', td: 'text-right' } } },
])

watch(estado, async (valor) => {
    await router.replace({ query: valor === 'pendiente' ? {} : { estado: valor } })
    await lista.recargar()
})

function abrir(_evento: Event, fila: { original: RevisionTitularEmpresa }) {
    void navigateTo(`/clientes/titulares/${fila.original.id}`)
}

onMounted(() => void lista.recargar())
</script>

<template>
    <PanelPagina
        id="titulares-empresa"
        titulo="Revisión de titulares"
        icono="i-lucide-building-2"
    >
        <div class="surface-card flex min-w-0 flex-col overflow-hidden rounded-[1.375rem]">
            <div class="border-b border-(--ax-borde) p-3 sm:p-4">
                <UTabs
                    v-model="estado"
                    :items="pestanas"
                    variant="pill"
                    color="neutral"
                    :content="false"
                    class="w-full"
                    :ui="{
                        list: 'w-auto max-w-full justify-start self-start overflow-x-auto rounded-xl bg-(--ax-panel) p-1',
                        indicator: 'rounded-lg bg-(--ax-tarjeta) shadow-sm ring ring-(--ax-borde)',
                        trigger: 'shrink-0 grow-0 rounded-lg px-3 text-muted data-[state=active]:text-primary',
                        leadingIcon: 'size-4',
                    }"
                    data-prueba="pestanas-revisiones"
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
                />
            </div>

            <template v-else>
                <UTable
                    :data="lista.filas.value"
                    :columns="columnas"
                    :loading="lista.cargando.value"
                    sticky
                    class="flex-1"
                    :ui="{ thead: 'bg-(--ax-cabecera-tabla)', th: 'text-xs', td: 'py-3', tr: 'cursor-pointer' }"
                    data-prueba="lista-revisiones"
                    @select="abrir"
                >
                    <template #razon_social-cell="{ row }">
                        <div class="flex min-w-48 items-center gap-3">
                            <span class="pastilla-icono tono-marca pastilla-tono size-10 shrink-0 rounded-xl">
                                <UIcon
                                    name="i-lucide-building-2"
                                    class="size-5"
                                />
                            </span>
                            <div class="flex min-w-0 flex-col">
                                <ULink
                                    :to="`/clientes/titulares/${row.original.id}`"
                                    class="truncate font-semibold text-highlighted hover:text-primary"
                                >
                                    {{ row.original.razon_social }}
                                </ULink>
                                <span class="text-xs text-muted">
                                    NIT <span class="font-mono">{{ formatearNitNormalizado(row.original.nit) }}</span>
                                    · {{ DOCUMENTOS_REPRESENTANTE[row.original.representante_documento_tipo] }} del representante
                                </span>
                                <span class="text-xs text-muted sm:hidden">{{ MOTIVOS_REVISION_TITULAR[row.original.motivo_revision].etiqueta }}</span>
                            </div>
                        </div>
                    </template>

                    <template #motivo_revision-cell="{ row }">
                        <UBadge
                            :label="MOTIVOS_REVISION_TITULAR[row.original.motivo_revision].etiqueta"
                            :icon="row.original.motivo_revision === 'varios_candidatos' ? 'i-lucide-copy' : 'i-lucide-user-plus'"
                            color="neutral"
                            variant="outline"
                            class="rounded-full"
                        />
                    </template>

                    <template #servicio_id-cell="{ row }">
                        <span class="text-sm">Servicio #{{ row.original.servicio_id }}</span>
                    </template>

                    <template #created_at-cell="{ row }">
                        <span class="whitespace-nowrap text-sm text-muted">{{ formatearFechaHora(estado === 'pendiente' ? row.original.created_at : (row.original.decidida_en ?? row.original.created_at)) }}</span>
                    </template>

                    <template #estado-cell="{ row }">
                        <UBadge
                            :label="ESTADOS_REVISION_TITULAR[row.original.estado].etiqueta"
                            :icon="ESTADOS_REVISION_TITULAR[row.original.estado].icono"
                            :color="ESTADOS_REVISION_TITULAR[row.original.estado].color"
                            variant="subtle"
                            class="rounded-full"
                        />
                    </template>

                    <template #empty>
                        <UEmpty
                            icon="i-lucide-inbox"
                            :title="estado === 'pendiente' ? 'Nada por revisar' : `Sin revisiones ${ESTADOS_REVISION_TITULAR[estado].plural.toLowerCase()}`"
                            :description="estado === 'pendiente' ? 'Cuando un técnico cambie el titular a una empresa que Argos no pueda decidir solo, aparece aquí.' : undefined"
                            variant="naked"
                        />
                    </template>
                </UTable>

                <div class="border-t border-(--ax-borde) px-3 py-2 sm:px-4">
                    <PaginacionCursor
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
        </div>
    </PanelPagina>
</template>
