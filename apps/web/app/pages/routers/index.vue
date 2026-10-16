<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'

/**
 * Routers (A1): lista con su control de velocidad y la capacidad del enlace. "Velocidad" abre el
 * panel para cambiar la capacidad y el modo de colas (`contratos/velocidad.md`). El CRUD
 * completo, las redes IPv4 y los bloques IPv6 quedan para la tarea 6 completa.
 */
definePageMeta({ permiso: 'routers.ver' })

useHead({ title: 'Routers · ArgosIsp' })

const lista = usePaginacionCursor(cursor => useRouters().listar({}, cursor))

const columnas: TableColumn<RouterNas>[] = [
    { accessorKey: 'nombre', header: 'Router', meta: { class: { td: 'whitespace-normal' } } },
    { accessorKey: 'nas_ip', header: 'NAS', meta: SOLO_ESCRITORIO },
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

const seleccionado = shallowRef<RouterNas | null>(null)
const velocidadAbierta = ref(false)

function abrir(router: RouterNas) {
    seleccionado.value = router
    velocidadAbierta.value = true
}

function alActualizar(router: RouterNas) {
    seleccionado.value = router
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
        </template>

        <div class="flex flex-col gap-4">
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
                                {{ row.original.nombre }}
                                <UBadge
                                    v-if="!row.original.activo"
                                    label="Inactivo"
                                    color="neutral"
                                    variant="subtle"
                                    size="sm"
                                />
                            </span>
                            <span class="font-mono text-xs text-muted">{{ row.original.host }}</span>
                            <span class="text-xs text-muted sm:hidden">{{ CONTROLES_VELOCIDAD[controlDe(row.original)].etiqueta }} · {{ capacidad(row.original) }}</span>
                        </div>
                    </template>
                    <template #nas_ip-cell="{ row }">
                        <span class="font-mono text-sm">{{ row.original.nas_ip }}</span>
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
                        <UButton
                            label="Velocidad"
                            icon="i-lucide-gauge"
                            color="neutral"
                            variant="outline"
                            size="sm"
                            :data-prueba="`velocidad-router-${row.original.id}`"
                            @click="abrir(row.original)"
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

        <RouterVelocidad
            v-if="seleccionado"
            v-model:open="velocidadAbierta"
            :router="seleccionado"
            @actualizado="alActualizar"
        />
    </PanelPagina>
</template>
