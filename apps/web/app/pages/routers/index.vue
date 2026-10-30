<script setup lang="ts">
import type { TableColumn, TabsItem } from '@nuxt/ui'

/**
 * Routers (A1): lista con su estado en línea y último contacto (`contacto_router.ts`), su control
 * de velocidad y la capacidad del enlace. Cada fila lleva «Editar» y el menú de acciones del
 * router (`RouterAcciones`: conexión de la API, control de velocidad…). "Nuevo router" (`routers.crear`);
 * redes IPv4 y bloques y pools IPv6 en la ficha de cada router.
 */
definePageMeta({ permiso: 'routers.ver' })

useHead({ title: 'Routers · ArgosIsp' })

const route = useRoute()
const router = useRouter()

/**
 * «Activos» (por defecto) e «Inactivos» (`?activo=false` de la API; en la URL del panel
 * `?vista=inactivos`): un router desactivado no se mezcla con los que están en uso.
 */
type VistaRouters = 'activos' | 'inactivos'
const vista = ref<VistaRouters>(route.query.vista === 'inactivos' ? 'inactivos' : 'activos')
const itemsVista: TabsItem[] = [
    { label: 'Activos', value: 'activos', icon: 'i-lucide-router' },
    { label: 'Inactivos', value: 'inactivos', icon: 'i-lucide-circle-pause' },
]

const lista = usePaginacionCursor(cursor => useRouters().listar({ activo: vista.value === 'activos' }, cursor))

watch(vista, async (valor) => {
    await router.replace({ query: valor === 'inactivos' ? { vista: 'inactivos' } : {} })
    await lista.recargar()
})
const { puede } = usePermisos()
const toast = useToast()
const altaAbierta = ref(false)

function alCrear(router: RouterNas) {
    toast.add({ title: `${router.nombre} creado`, description: 'Agrega sus redes IPv4 y bloques IPv6 en su ficha.', icon: 'i-lucide-circle-check', color: 'success' })
    void navigateTo(`/routers/${router.id}`)
}

const columnas: TableColumn<RouterNas>[] = [
    { accessorKey: 'nombre', header: 'Router', meta: { class: { td: 'whitespace-normal' } } },
    { accessorKey: 'nas_ip', header: 'NAS', meta: SOLO_ESCRITORIO },
    { id: 'contacto', header: 'Contacto', meta: SOLO_ANCHO },
    { id: 'control', header: 'Colas', meta: SOLO_ANCHO },
    { id: 'capacidad', header: 'Capacidad (bajada / subida)', meta: SOLO_ESCRITORIO },
    { id: 'acciones', header: '', meta: { class: { td: 'text-right w-0' } } },
]

function controlDe(router: RouterNas): ControlVelocidad {
    return router.control_velocidad ?? (router.modo_velocidad === 'pcq' ? 'arbol_pcq' : 'simple')
}

function capacidad(router: RouterNas): string {
    const bajada = router.capacidad_bajada_kbps
    const subida = router.capacidad_subida_kbps
    if (!bajada && !subida) {
        return 'Sin techo'
    }
    return `${bajada ? formatearVelocidad(bajada) : 'sin techo'} / ${subida ? formatearVelocidad(subida) : 'sin techo'}`
}

function alActualizar() {
    void lista.recargar()
}

onMounted(() => void lista.recargar())
</script>

<template>
    <PanelPagina
        id="routers"
        titulo="Routers"
        icono="i-lucide-router"
    >
        <template #acciones>
            <UButton
                to="/routers/migracion"
                label="Migración"
                icon="i-lucide-arrow-right-left"
                color="neutral"
                variant="outline"
                data-prueba="ir-migracion"
            />
            <UButton
                v-if="puede('routers.crear')"
                label="Nuevo router"
                icon="i-lucide-plus"
                data-prueba="nuevo-router"
                @click="altaAbierta = true"
            />
        </template>

        <div class="flex flex-col gap-4">
            <UTabs
                v-model="vista"
                :items="itemsVista"
                :content="false"
                size="sm"
                class="self-start"
                data-prueba="vista-routers"
            />
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
                    :ui="{ td: 'py-2.5' }"
                    data-prueba="tabla-routers"
                >
                    <template #nombre-cell="{ row }">
                        <div class="flex min-w-0 flex-col gap-0.5">
                            <span class="flex flex-wrap items-center gap-1.5 text-sm font-medium text-highlighted">
                                <ULink
                                    :to="`/routers/${row.original.id}`"
                                    class="hover:text-primary"
                                >{{ row.original.nombre }}</ULink>
                                <UBadge
                                    v-if="!row.original.activo"
                                    label="Inactivo"
                                    color="neutral"
                                    variant="subtle"
                                    size="sm"
                                />
                            </span>
                            <span class="font-mono text-xs text-muted">{{ row.original.host }}</span>
                            <RouterContacto
                                :router="row.original"
                                compacto
                                class="sm:hidden"
                            />
                            <span class="text-xs text-muted sm:hidden">{{ CONTROLES_VELOCIDAD[controlDe(row.original)].etiqueta }} · {{ capacidad(row.original) }}</span>
                        </div>
                    </template>
                    <template #nas_ip-cell="{ row }">
                        <span class="font-mono text-sm">{{ row.original.nas_ip }}</span>
                    </template>
                    <template #contacto-cell="{ row }">
                        <RouterContacto
                            :router="row.original"
                            compacto
                            class="flex-col items-start"
                        />
                    </template>
                    <template #control-cell="{ row }">
                        <UBadge
                            :label="CONTROLES_VELOCIDAD[controlDe(row.original)].etiqueta"
                            :icon="CONTROLES_VELOCIDAD[controlDe(row.original)].icono"
                            color="neutral"
                            variant="subtle"
                            size="sm"
                            :data-prueba="`control-${row.original.id}`"
                        />
                    </template>
                    <template #capacidad-cell="{ row }">
                        <span class="text-sm">{{ capacidad(row.original) }}</span>
                    </template>
                    <template #acciones-cell="{ row }">
                        <RouterAcciones
                            :router="row.original"
                            con-editar
                            tamano="sm"
                            @actualizado="alActualizar"
                        />
                    </template>
                    <template #empty>
                        <UEmpty
                            icon="i-lucide-router"
                            title="Todavía no hay routers"
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

        <RouterAltaModal
            v-model:open="altaAbierta"
            @creado="alCrear"
        />
    </PanelPagina>
</template>
