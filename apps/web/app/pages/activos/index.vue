<script setup lang="ts">
import type { SelectItem, TableColumn } from '@nuxt/ui'

/**
 * Activos fijos (A3, fase 5): costo, depreciación acumulada y valor en libros por clase, vigentes o dados
 * de baja. «Alta de activo» y «Depreciar pendiente» (`activos.registrar`): la depreciación la hace el cron
 * cada día hasta el mes anterior; el botón hace lo mismo a mano (repetir no duplica).
 */
definePageMeta({ permiso: 'activos.ver' })

useHead({ title: 'Activos fijos · ArgosIsp' })

const route = useRoute()
const router = useRouter()
const toast = useToast()
const { puede } = usePermisos()

const TODOS = 'todos'
const texto = (valor: unknown) => (typeof valor === 'string' ? valor : '')

const clase = ref<ClaseActivo | typeof TODOS>(texto(route.query.clase) in CLASES_ACTIVO ? texto(route.query.clase) as ClaseActivo : TODOS)
const estado = ref<'vigente' | 'dado_de_baja' | typeof TODOS>(route.query.estado === 'dado_de_baja' || route.query.estado === TODOS ? route.query.estado : 'vigente')

const itemsClase: SelectItem[] = [{ label: 'Todas las clases', value: TODOS }, ...Object.entries(CLASES_ACTIVO).map(([value, label]) => ({ label, value }))]
const itemsEstado: SelectItem[] = [{ label: 'Vigentes', value: 'vigente' }, { label: 'Dados de baja', value: 'dado_de_baja' }, { label: 'Todos', value: TODOS }]

function filtros(): FiltrosActivos {
    return {
        ...(clase.value !== TODOS ? { clase: clase.value } : {}),
        ...(estado.value !== TODOS ? { estado: estado.value } : {}),
    }
}

const lista = usePaginacionCursor(cursor => useActivos().listar(filtros(), cursor))

const columnas: TableColumn<ActivoFijo>[] = [
    { accessorKey: 'descripcion', header: 'Activo', meta: { class: { td: 'whitespace-normal' } } },
    { accessorKey: 'costo', header: 'Costo', meta: { class: { th: 'text-right hidden sm:table-cell', td: 'text-right hidden sm:table-cell' } } },
    { accessorKey: 'depreciacion_acumulada', header: 'Depreciado', meta: { class: { th: 'text-right hidden lg:table-cell', td: 'text-right hidden lg:table-cell' } } },
    { accessorKey: 'valor_libros', header: 'En libros', meta: { class: { th: 'text-right', td: 'text-right' } } },
    { accessorKey: 'estado', header: 'Estado', meta: SOLO_ANCHO },
]

async function aplicarFiltros() {
    await router.replace({ query: { ...(clase.value !== TODOS ? { clase: clase.value } : {}), ...(estado.value !== 'vigente' ? { estado: estado.value } : {}) } })
    await lista.recargar()
}

watch([clase, estado], aplicarFiltros)

const dandoDeAlta = ref(false)
const depreciando = ref(false)

function alAlta(activo: ActivoFijo) {
    toast.add({ title: `Activo #${activo.id} dado de alta`, description: `${activo.descripcion} · cuota ${formatearQuetzales(activo.cuota_mensual)} al mes`, icon: 'i-lucide-circle-check', color: 'success' })
    void router.push(`/activos/${activo.id}`)
}

async function depreciar() {
    depreciando.value = true
    const resultado = await useActivos().depreciar()
    depreciando.value = false
    if (!resultado.ok) {
        const legible = problemaCompraLegible(resultado.problema)
        toast.add({ title: legible.title, description: legible.detail, icon: 'i-lucide-circle-alert', color: 'error' })
        return
    }
    toast.add({
        title: resultado.data.cuotas ? `${resultado.data.cuotas} cuotas registradas` : 'Nada pendiente',
        description: resultado.data.cuotas ? `${formatearQuetzales(resultado.data.monto)} hasta ${resultado.data.hasta.slice(0, 7)}` : `La depreciación ya está al día hasta ${resultado.data.hasta.slice(0, 7)}.`,
        icon: 'i-lucide-trending-down',
        color: 'success',
    })
    void lista.recargar()
}

onMounted(() => void lista.recargar())
</script>

<template>
    <PanelPagina
        id="activos"
        titulo="Activos fijos"
        icono="i-lucide-boxes"
    >
        <template #acciones>
            <div class="flex flex-wrap gap-2">
                <UButton
                    v-if="puede('activos.registrar')"
                    label="Depreciar pendiente"
                    :aria-label="'Depreciar pendiente'"
                    :ui="{ label: 'hidden sm:inline' }"
                    icon="i-lucide-trending-down"
                    color="neutral"
                    variant="outline"
                    :loading="depreciando"
                    data-prueba="depreciar-pendiente"
                    @click="depreciar"
                />
                <UButton
                    v-if="puede('activos.registrar')"
                    label="Alta de activo"
                    :aria-label="'Alta de activo'"
                    :ui="{ label: 'hidden sm:inline' }"
                    icon="i-lucide-plus"
                    data-prueba="alta-activo"
                    @click="dandoDeAlta = true"
                />
            </div>
        </template>

        <div class="flex flex-col gap-4">
            <div class="grid gap-3 sm:grid-cols-2">
                <USelect
                    v-model="clase"
                    :items="itemsClase"
                    aria-label="Clase"
                    class="w-full"
                />
                <USelect
                    v-model="estado"
                    :items="itemsEstado"
                    aria-label="Estado"
                    class="w-full"
                />
            </div>
            <p class="text-xs text-muted">
                Línea recta por mes desde el mes siguiente al alta, hasta el valor residual. Un activo comprado nace con su compra (línea «activo fijo»).
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
                    data-prueba="tabla-activos"
                >
                    <template #descripcion-cell="{ row }">
                        <div
                            class="flex min-w-0 flex-col"
                            :data-activo="row.original.id"
                        >
                            <ULink
                                :to="`/activos/${row.original.id}`"
                                class="text-sm font-medium text-highlighted hover:underline"
                            >
                                #{{ row.original.id }} · {{ row.original.descripcion }}
                            </ULink>
                            <span class="text-xs text-muted">{{ etiquetaClaseActivo(row.original.clase) }} · {{ row.original.tasa_anual }} % anual · desde {{ formatearFecha(row.original.fecha_alta) }}</span>
                            <span class="text-xs text-muted sm:hidden">Costo {{ formatearQuetzales(row.original.costo) }} · {{ ESTADOS_ACTIVO[row.original.estado].etiqueta }}</span>
                        </div>
                    </template>
                    <template #costo-cell="{ row }">
                        <span class="tabular-nums">{{ formatearQuetzales(row.original.costo) }}</span>
                    </template>
                    <template #depreciacion_acumulada-cell="{ row }">
                        <span class="tabular-nums">{{ formatearQuetzales(row.original.depreciacion_acumulada) }}</span>
                    </template>
                    <template #valor_libros-cell="{ row }">
                        <span class="font-medium tabular-nums">{{ formatearQuetzales(row.original.valor_libros) }}</span>
                    </template>
                    <template #estado-cell="{ row }">
                        <UBadge
                            :label="ESTADOS_ACTIVO[row.original.estado].etiqueta"
                            :color="ESTADOS_ACTIVO[row.original.estado].color"
                            :icon="ESTADOS_ACTIVO[row.original.estado].icono"
                            variant="subtle"
                            size="sm"
                        />
                    </template>
                    <template #empty>
                        <UEmpty
                            icon="i-lucide-boxes"
                            title="Sin activos para estos filtros"
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

        <ActivoAltaModal
            v-model:open="dandoDeAlta"
            @hecho="alAlta"
        />
    </PanelPagina>
</template>
