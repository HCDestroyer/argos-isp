<script setup lang="ts">
import type { SelectItem, TableColumn } from '@nuxt/ui'

definePageMeta({ permiso: 'clientes.ver' })

useHead({ title: 'Clientes · ArgosIsp' })

const route = useRoute()
const router = useRouter()
const { puede } = usePermisos()
const clientesApi = useClientes()

const TODAS = 'todas'

function textoQuery(valor: unknown): string {
    return typeof valor === 'string' ? valor : ''
}

const busqueda = ref(textoQuery(route.query.q))
const zona = ref(textoQuery(route.query.zona) || TODAS)

const zonas = ref<Zona[]>([])
const verZonas = computed(() => puede('zonas.ver'))

const nombresZona = computed(() => new Map(zonas.value.map(z => [z.id, z.nombre])))

const itemsZona = computed<SelectItem[]>(() => [
    { label: 'Todas las zonas', value: TODAS },
    ...zonas.value.map(z => ({ label: z.nombre, value: String(z.id) })),
])

function filtros(): FiltrosClientes {
    const resultado: FiltrosClientes = {}
    const q = busqueda.value.trim()
    if (q) {
        resultado.q = q
    }
    if (zona.value !== TODAS) {
        resultado.zona_id = Number(zona.value)
    }
    return resultado
}

const lista = usePaginacionCursor(cursor => clientesApi.listar(filtros(), cursor))

const columnas = computed<TableColumn<Cliente>[]>(() => {
    const base: TableColumn<Cliente>[] = [
        { accessorKey: 'nombre', header: 'Cliente' },
        { accessorKey: 'nit_cui', header: 'NIT / CUI', meta: SOLO_ANCHO },
        { accessorKey: 'telefono', header: 'Teléfono' },
    ]
    if (verZonas.value) {
        base.push({ accessorKey: 'zona_id', header: 'Zona', meta: SOLO_ANCHO })
    }
    base.push({ accessorKey: 'created_at', header: 'Alta', meta: SOLO_ESCRITORIO })
    return base
})

const hayFiltros = computed(() => busqueda.value.trim() !== '' || zona.value !== TODAS)

async function aplicarFiltros() {
    const query: Record<string, string> = {}
    const q = busqueda.value.trim()
    if (q) {
        query.q = q
    }
    if (zona.value !== TODAS) {
        query.zona = zona.value
    }
    await router.replace({ query })
    await lista.recargar()
}

function limpiarFiltros() {
    busqueda.value = ''
    zona.value = TODAS
}

let temporizador: ReturnType<typeof setTimeout> | undefined
watch(busqueda, () => {
    clearTimeout(temporizador)
    temporizador = setTimeout(aplicarFiltros, 300)
})
watch(zona, aplicarFiltros)
onBeforeUnmount(() => clearTimeout(temporizador))

onMounted(async () => {
    void lista.recargar()
    if (verZonas.value) {
        const resultado = await useZonas().listar()
        if (resultado.ok) {
            zonas.value = resultado.data
        }
    }
})
</script>

<template>
    <PanelPagina
        id="clientes"
        titulo="Clientes"
        icono="i-lucide-users"
    >
        <template #acciones>
            <UButton
                v-if="puede('clientes.crear')"
                to="/clientes/nuevo"
                icon="i-lucide-user-plus"
                label="Nuevo cliente"
                :ui="{ label: 'hidden sm:inline' }"
                aria-label="Nuevo cliente"
            />
        </template>

        <div class="flex flex-col gap-4">
            <div class="flex flex-col gap-3 sm:flex-row sm:items-center">
                <UInput
                    v-model="busqueda"
                    icon="i-lucide-search"
                    placeholder="Nombre, NIT, teléfono, usuario PPP o IP"
                    aria-label="Buscar clientes"
                    class="w-full sm:max-w-md"
                    :loading="lista.cargando.value"
                >
                    <template
                        v-if="busqueda"
                        #trailing
                    >
                        <UButton
                            icon="i-lucide-x"
                            color="neutral"
                            variant="link"
                            size="sm"
                            aria-label="Borrar búsqueda"
                            @click="busqueda = ''"
                        />
                    </template>
                </UInput>

                <USelect
                    v-if="verZonas"
                    v-model="zona"
                    :items="itemsZona"
                    icon="i-lucide-map-pin"
                    aria-label="Filtrar por zona"
                    class="w-full sm:w-52"
                />

                <UButton
                    v-if="hayFiltros"
                    label="Limpiar"
                    icon="i-lucide-filter-x"
                    color="neutral"
                    variant="ghost"
                    class="self-start sm:self-auto"
                    @click="limpiarFiltros"
                />
            </div>

            <ProblemaAlerta
                v-if="lista.problema.value"
                :problema="lista.problema.value"
                :reintentar="lista.recargar"
            />

            <UTable
                :data="lista.filas.value"
                :columns="columnas"
                :loading="lista.cargando.value"
                sticky
                class="flex-1"
                :ui="{
                    td: 'py-3',
                }"
            >
                <template #nombre-cell="{ row }">
                    <div class="flex min-w-40 flex-col">
                        <ULink
                            :to="`/clientes/${row.original.id}`"
                            class="font-medium text-highlighted hover:text-primary"
                        >
                            {{ row.original.nombre }}
                        </ULink>
                        <span class="flex items-center gap-1.5 text-xs text-muted">
                            <UBadge
                                v-if="row.original.tipo === 'empresa'"
                                label="Empresa"
                                color="neutral"
                                variant="outline"
                                size="sm"
                            />
                            <span class="truncate">{{ row.original.email ?? 'Sin correo' }}</span>
                        </span>
                        <span
                            v-if="row.original.nit_cui"
                            class="font-mono text-xs text-muted sm:hidden"
                        >NIT {{ row.original.nit_cui }}</span>
                    </div>
                </template>

                <template #nit_cui-cell="{ row }">
                    <span class="font-mono text-sm">{{ row.original.nit_cui ?? '—' }}</span>
                </template>

                <template #telefono-cell="{ row }">
                    <div class="flex flex-col text-sm">
                        <span>{{ row.original.telefono ?? '—' }}</span>
                        <span
                            v-if="row.original.movil"
                            class="text-xs text-muted"
                        >{{ row.original.movil }}</span>
                    </div>
                </template>

                <template #zona_id-cell="{ row }">
                    {{ row.original.zona_id ? (nombresZona.get(row.original.zona_id) ?? `Zona ${row.original.zona_id}`) : '—' }}
                </template>

                <template #created_at-cell="{ row }">
                    <span class="whitespace-nowrap text-sm text-muted">{{ formatearFecha(row.original.created_at) }}</span>
                </template>

                <template #empty>
                    <UEmpty
                        icon="i-lucide-search-x"
                        :title="hayFiltros ? 'Ningún cliente coincide' : 'Todavía no hay clientes'"
                        :description="hayFiltros ? 'Prueba con otro nombre, NIT, teléfono, usuario PPP o IP.' : undefined"
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
        </div>
    </PanelPagina>
</template>
