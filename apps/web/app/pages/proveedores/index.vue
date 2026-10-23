<script setup lang="ts">
import type { SelectItem, TableColumn } from '@nuxt/ui'

/**
 * Proveedores (A3, fase 5): búsqueda por nombre o documento, filtros por tipo y si están activos, el
 * saldo de su auxiliar (lo que la empresa les debe) y «Nuevo proveedor» (`proveedores.editar`). La ficha
 * tiene el estado de cuenta, sus compras y sus pagos.
 */
definePageMeta({ permiso: 'proveedores.ver' })

useHead({ title: 'Proveedores · ArgosIsp' })

const route = useRoute()
const router = useRouter()
const toast = useToast()
const { puede } = usePermisos()

const TODOS = 'todos'
const texto = (valor: unknown) => (typeof valor === 'string' ? valor : '')

const buscar = ref(texto(route.query.buscar))
const tipo = ref<TipoProveedor | typeof TODOS>(texto(route.query.tipo) in TIPOS_PROVEEDOR ? texto(route.query.tipo) as TipoProveedor : TODOS)
const activos = ref<'si' | 'no' | typeof TODOS>(route.query.activo === 'false' ? 'no' : route.query.activo === 'todos' ? TODOS : 'si')

const itemsTipo: SelectItem[] = [{ label: 'Todos los tipos', value: TODOS }, ...Object.entries(TIPOS_PROVEEDOR).map(([value, label]) => ({ label, value }))]
const itemsActivo: SelectItem[] = [{ label: 'Activos', value: 'si' }, { label: 'Inactivos', value: 'no' }, { label: 'Activos e inactivos', value: TODOS }]

function filtros(): FiltrosProveedores {
    return {
        ...(buscar.value.trim() ? { buscar: buscar.value.trim() } : {}),
        ...(tipo.value !== TODOS ? { tipo: tipo.value } : {}),
        ...(activos.value !== TODOS ? { activo: activos.value === 'si' } : {}),
    }
}

const lista = usePaginacionCursor(cursor => useProveedores().listar(filtros(), cursor))

const columnas: TableColumn<Proveedor>[] = [
    { accessorKey: 'nombre', header: 'Proveedor', meta: { class: { td: 'whitespace-normal' } } },
    { accessorKey: 'tipo', header: 'Tipo', meta: SOLO_ANCHO },
    { accessorKey: 'dias_credito', header: 'Crédito', meta: SOLO_ESCRITORIO },
    { accessorKey: 'saldo', header: 'Le debemos', meta: { class: { th: 'text-right', td: 'text-right' } } },
]

async function aplicarFiltros() {
    await router.replace({ query: { ...(buscar.value.trim() ? { buscar: buscar.value.trim() } : {}), ...(tipo.value !== TODOS ? { tipo: tipo.value } : {}), ...(activos.value !== 'si' ? { activo: activos.value === 'no' ? 'false' : 'todos' } : {}) } })
    await lista.recargar()
}

let temporizador: ReturnType<typeof setTimeout> | undefined
watch(buscar, () => {
    clearTimeout(temporizador)
    temporizador = setTimeout(aplicarFiltros, 300)
})
watch([tipo, activos], aplicarFiltros)

const creando = ref(false)

function alCrear(proveedor: Proveedor) {
    toast.add({ title: 'Proveedor creado', description: proveedor.nombre, icon: 'i-lucide-circle-check', color: 'success' })
    void router.push(`/proveedores/${proveedor.id}`)
}

onMounted(() => void lista.recargar())
</script>

<template>
    <PanelPagina
        id="proveedores"
        titulo="Proveedores"
        icono="i-lucide-truck"
    >
        <template #acciones>
            <UButton
                v-if="puede('proveedores.editar')"
                label="Nuevo proveedor"
                icon="i-lucide-plus"
                data-prueba="nuevo-proveedor"
                @click="creando = true"
            />
        </template>

        <div class="flex flex-col gap-4">
            <div class="grid gap-3 sm:grid-cols-3">
                <UInput
                    v-model="buscar"
                    icon="i-lucide-search"
                    placeholder="Nombre o NIT"
                    aria-label="Buscar proveedor"
                    class="w-full"
                    data-prueba="buscar-proveedor"
                />
                <USelect
                    v-model="tipo"
                    :items="itemsTipo"
                    aria-label="Tipo"
                    class="w-full"
                />
                <USelect
                    v-model="activos"
                    :items="itemsActivo"
                    aria-label="Activos"
                    class="w-full"
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
                    data-prueba="tabla-proveedores"
                >
                    <template #nombre-cell="{ row }">
                        <div class="flex min-w-0 flex-col">
                            <ULink
                                :to="`/proveedores/${row.original.id}`"
                                class="text-sm font-medium text-highlighted hover:underline"
                                :data-proveedor="row.original.id"
                            >
                                {{ row.original.nombre }}
                            </ULink>
                            <span class="text-xs text-muted">{{ DOCUMENTOS_PROVEEDOR[row.original.tipo_documento] }} {{ row.original.nit }}<template v-if="!row.original.activo"> · inactivo</template></span>
                            <span class="text-xs text-muted sm:hidden">{{ TIPOS_PROVEEDOR[row.original.tipo] }}</span>
                        </div>
                    </template>
                    <template #tipo-cell="{ row }">
                        <span class="text-sm">{{ TIPOS_PROVEEDOR[row.original.tipo] }}</span>
                    </template>
                    <template #dias_credito-cell="{ row }">
                        <span class="text-sm">{{ row.original.dias_credito ? `${row.original.dias_credito} días` : 'Contado' }}</span>
                    </template>
                    <template #saldo-cell="{ row }">
                        <span class="whitespace-nowrap font-medium tabular-nums">{{ formatearQuetzales(row.original.saldo) }}</span>
                    </template>
                    <template #empty>
                        <UEmpty
                            icon="i-lucide-truck"
                            title="Sin proveedores para estos filtros"
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

        <ProveedorModal
            v-model:open="creando"
            @hecho="alCrear"
        />
    </PanelPagina>
</template>
