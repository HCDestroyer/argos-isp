<script setup lang="ts">
import type { SelectItem, TableColumn } from '@nuxt/ui'

/**
 * Sorteos (A3, `contratos/lealtad.md` §7 y §15.3): lista con su estado y fecha, filtro por estado y
 * «Nuevo sorteo» (`sorteos.gestionar`). Cada paso se da desde la ficha.
 */
definePageMeta({ permiso: 'sorteos.ver' })

useHead({ title: 'Sorteos · ArgosIsp' })

const route = useRoute()
const router = useRouter()
const toast = useToast()
const { puede, enlace } = usePermisos()

const TODOS = 'todos'
const estado = ref<EstadoSorteo | typeof TODOS>(typeof route.query.estado === 'string' && Object.hasOwn(ESTADOS_SORTEO, route.query.estado) ? route.query.estado as EstadoSorteo : TODOS)
const itemsEstado: SelectItem[] = [{ label: 'Todos los estados', value: TODOS }, ...Object.entries(ESTADOS_SORTEO).map(([value, e]) => ({ label: e.etiqueta, value }))]

const lista = usePaginacionCursor(cursor => useSorteos().listar(estado.value === TODOS ? {} : { estado: estado.value }, cursor))
const creando = ref(false)

const columnas: TableColumn<SorteoLista>[] = [
    { accessorKey: 'nombre', header: 'Sorteo', meta: { class: { td: 'whitespace-normal' } } },
    { accessorKey: 'fecha_sorteo', header: 'Fecha del sorteo', meta: SOLO_ANCHO },
    { id: 'premios', header: 'Premios', meta: SOLO_ANCHO },
    { accessorKey: 'estado', header: 'Estado' },
]

function resumenPremios(sorteo: SorteoLista): string {
    const titulares = titularesSorteo(sorteo.premios)
    return titulares === 0 ? 'Sin premios' : `${titulares} ${titulares === 1 ? 'premio' : 'premios'} · ${formatearQuetzales(valorPremiosSorteo(sorteo.premios))}`
}

async function alCrear(sorteo: SorteoDetalle) {
    toast.add({ title: 'Sorteo creado en borrador', description: sorteo.nombre, icon: 'i-lucide-circle-check', color: 'success' })
    await navigateTo(`/lealtad/sorteos/${sorteo.id}`)
}

watch(estado, async (valor) => {
    await router.replace({ query: valor === TODOS ? {} : { estado: valor } })
    await lista.recargar()
})

onMounted(() => {
    void lista.recargar()
})
</script>

<template>
    <PanelPagina
        id="sorteos"
        titulo="Sorteos"
        icono="i-lucide-ticket"
    >
        <template #acciones>
            <UButton
                v-if="enlace('/lealtad')"
                :to="enlace('/lealtad')"
                icon="i-lucide-arrow-left"
                label="Lealtad"
                color="neutral"
                variant="ghost"
                class="hidden sm:inline-flex"
            />
            <UButton
                v-if="puede('sorteos.gestionar')"
                label="Nuevo sorteo"
                icon="i-lucide-plus"
                data-prueba="nuevo-sorteo"
                @click="creando = true"
            />
        </template>

        <div class="flex flex-col gap-4">
            <USelect
                v-model="estado"
                :items="itemsEstado"
                aria-label="Estado"
                class="w-full sm:w-56"
                data-prueba="filtro-estado-sorteo"
            />
            <ProblemaAlerta
                v-if="lista.problema.value"
                :problema="lista.problema.value"
                :reintentar="lista.recargar"
                :reintentando="lista.cargando.value"
                data-prueba="sorteos-error"
            />
            <template v-else>
                <UTable
                    :data="lista.filas.value"
                    :columns="columnas"
                    :loading="lista.cargando.value"
                    data-prueba="tabla-sorteos"
                >
                    <template #nombre-cell="{ row }">
                        <div class="flex min-w-0 flex-col">
                            <ULink
                                :to="`/lealtad/sorteos/${row.original.id}`"
                                class="text-sm font-medium text-highlighted hover:text-primary"
                            >
                                {{ row.original.nombre }}
                            </ULink>
                            <span class="text-xs text-muted sm:hidden">
                                {{ row.original.fecha_sorteo ? formatearFechaHora(row.original.fecha_sorteo) : 'Sin fecha' }} · {{ resumenPremios(row.original) }}
                            </span>
                            <span
                                v-if="row.original.estado === 'cancelado' && row.original.motivo_cancelacion"
                                class="text-xs text-muted"
                            >{{ row.original.motivo_cancelacion }}</span>
                        </div>
                    </template>
                    <template #fecha_sorteo-cell="{ row }">
                        <span class="whitespace-nowrap text-sm">{{ row.original.fecha_sorteo ? formatearFechaHora(row.original.fecha_sorteo) : '—' }}</span>
                    </template>
                    <template #premios-cell="{ row }">
                        <span class="text-sm tabular-nums">{{ resumenPremios(row.original) }}</span>
                    </template>
                    <template #estado-cell="{ row }">
                        <SorteoEstadoBadge :estado="row.original.estado" />
                    </template>
                    <template #empty>
                        <div class="flex flex-col items-center gap-2 py-6 text-center">
                            <UIcon
                                name="i-lucide-ticket"
                                class="size-8 text-dimmed"
                            />
                            <p class="text-sm text-muted">
                                {{ estado === TODOS ? 'Aún no hay sorteos.' : 'No hay sorteos en ese estado.' }}
                            </p>
                        </div>
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

        <SorteoFormulario
            v-model:open="creando"
            @hecho="alCrear"
        />
    </PanelPagina>
</template>
