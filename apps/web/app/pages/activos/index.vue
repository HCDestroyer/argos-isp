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

/** Parte del costo ya depreciada (barra del tablero ContaCompras · Activos fijos). */
function porcentajeDepreciado(activo: ActivoFijo): number {
    return partePorcentual(activo.depreciacion_acumulada, activo.costo) ?? 0
}

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
        titulo="Compras y gastos"
        icono="i-lucide-boxes"
        descripcion="Activos fijos: alta, depreciación mensual en línea recta y baja por venta o retiro."
    >
        <template #acciones>
            <ContaComprasAcciones />
        </template>

        <ContaCuerpo>
            <ContaIsla llenar>
                <template #cabecera>
                    <ContaComprasPestanas />
                </template>
                <template #herramientas>
                    <USelect
                        v-model="clase"
                        :items="itemsClase"
                        aria-label="Clase"
                        class="w-48"
                        :ui="{ base: 'rounded-full' }"
                    />
                    <USelect
                        v-model="estado"
                        :items="itemsEstado"
                        aria-label="Estado"
                        class="w-40"
                        :ui="{ base: 'rounded-full' }"
                    />
                </template>

                <div class="flex flex-wrap items-center gap-3 border-b border-(--ax-borde) bg-(--ax-panel) px-4 py-3">
                    <span class="pastilla-icono pastilla-tono tono-exito size-8 shrink-0 rounded-full">
                        <UIcon
                            name="i-lucide-trending-down"
                            class="size-4"
                        />
                    </span>
                    <span class="flex min-w-0 flex-1 flex-col">
                        <span class="text-sm font-semibold text-highlighted">Depreciación en línea recta</span>
                        <span class="text-xs text-muted">Cada mes desde el siguiente al alta, hasta el valor residual. Un activo comprado nace con su compra.</span>
                    </span>
                    <UButton
                        v-if="puede('activos.registrar')"
                        label="Depreciar pendiente"
                        :aria-label="'Depreciar pendiente'"
                        :ui="{ label: 'hidden sm:inline' }"
                        icon="i-lucide-trending-down"
                        color="neutral"
                        variant="outline"
                        class="rounded-full"
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
                        color="neutral"
                        variant="outline"
                        class="rounded-full"
                        data-prueba="alta-activo"
                        @click="dandoDeAlta = true"
                    />
                </div>
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
                            <div class="flex items-center justify-end gap-2">
                                <UProgress
                                    :model-value="porcentajeDepreciado(row.original)"
                                    size="sm"
                                    class="w-24"
                                    :aria-label="`Depreciado ${porcentajeDepreciado(row.original)} %`"
                                />
                                <span class="w-10 text-right text-xs text-muted tabular-nums">{{ porcentajeDepreciado(row.original) }} %</span>
                            </div>
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
                    <div class="px-3 pb-3">
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

                <template #pie>
                    Un activo nunca se edita ni se borra: se da de baja con su asiento.
                </template>
            </ContaIsla>
        </ContaCuerpo>

        <ActivoAltaModal
            v-model:open="dandoDeAlta"
            @hecho="alAlta"
        />
    </PanelPagina>
</template>
