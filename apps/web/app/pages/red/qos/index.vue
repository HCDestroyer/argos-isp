<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { TableColumn } from '@nuxt/ui'

/**
 * Perfiles de QoS por clases (`contratos/qos.md`, A2): el predeterminado y los de cada empresa, con
 * sus clases activas, los routers que los usan y el costo (hojas del árbol contra el límite). Los
 * routers y el costo vienen del detalle de cada perfil (`GET /qos/perfiles/:id`); si uno falla, esa
 * fila lo dice con «Reintentar» y no muestra costo. Con `qos.gestionar`, «Nuevo perfil» (copia).
 */
definePageMeta({ permiso: 'qos.ver' })

useHead({ title: 'Prioridad por clases (QoS) · ArgosIsp' })

const { puede } = usePermisos()
const toast = useToast()
const { nombre: nombreEmpresa } = useEmpresaActiva()

const lista = usePaginacionCursor(cursor => useQos().listar(cursor))

/** Detalle (routers y costo) de cada perfil de la página. */
const detalles = ref<Record<number, { cargando: boolean, detalle: PerfilQosDetalle | null, problema: Problem | null }>>({})

async function cargarDetalle(id: number) {
    detalles.value[id] = { cargando: true, detalle: detalles.value[id]?.detalle ?? null, problema: null }
    const resultado = await useQos().ver(id)
    detalles.value[id] = { cargando: false, detalle: resultado.ok ? resultado.data : null, problema: resultado.ok ? null : resultado.problema }
}

watch(() => lista.filas.value, (filas) => {
    for (const perfil of filas) {
        void cargarDetalle(perfil.id)
    }
})

const columnas: TableColumn<PerfilQos>[] = [
    { accessorKey: 'nombre', header: 'Perfil', meta: { class: { td: 'whitespace-normal' } } },
    { id: 'clases', header: 'Clases activas', meta: SOLO_ANCHO },
    { id: 'routers', header: 'Routers que lo usan', meta: { class: { td: 'whitespace-normal' } } },
    { id: 'costo', header: 'Costo', meta: SOLO_ESCRITORIO },
    { id: 'acciones', header: '', meta: { class: { td: 'text-right w-0' } } },
]

const crearAbierto = ref(false)
const copiarDe = ref<number | null>(null)

function abrirCrear(origen: number | null) {
    copiarDe.value = origen
    crearAbierto.value = true
}

function alCrear(perfil: PerfilQos) {
    toast.add({ title: `Perfil ${perfil.nombre} creado`, description: `${perfil.clases.length} clases copiadas. Elígelo en la ficha de un router para usarlo.`, icon: 'i-lucide-circle-check', color: 'success' })
    void navigateTo(`/red/qos/${perfil.id}`)
}

/** El router con más hojas (el que más cerca está del límite). */
function mayorUso(detalle: PerfilQosDetalle): UsoPerfilQos | null {
    return [...detalle.routers].sort((a, b) => b.hojas - a.hojas)[0] ?? null
}

onMounted(() => void lista.recargar())
</script>

<template>
    <PanelPagina
        id="qos"
        titulo="Prioridad (QoS)"
        icono="i-lucide-list-ordered"
    >
        <template #acciones>
            <UButton
                v-if="puede('qos.gestionar')"
                label="Nuevo perfil"
                icon="i-lucide-copy-plus"
                :ui="{ label: 'hidden sm:inline' }"
                aria-label="Nuevo perfil"
                :disabled="!lista.filas.value.length"
                data-prueba="nuevo-perfil-qos"
                @click="abrirCrear(null)"
            />
        </template>

        <div class="flex flex-col gap-4">
            <p class="max-w-3xl text-sm text-muted">
                Dentro del plan de cada cliente, el tráfico interactivo (DNS, VoIP, juegos) y la web van antes que las descargas pesadas. Un perfil es un juego de clases; cada router usa uno (sin elegir, el predeterminado).
            </p>
            <QosAyuda />

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
                    data-prueba="tabla-perfiles-qos"
                >
                    <template #nombre-cell="{ row }">
                        <div class="flex min-w-0 flex-col gap-0.5">
                            <ULink
                                :to="`/red/qos/${row.original.id}`"
                                class="flex flex-wrap items-center gap-1.5 text-sm font-medium text-highlighted"
                                :data-prueba="`perfil-qos-${row.original.id}`"
                            >
                                {{ row.original.nombre }}
                                <UBadge
                                    v-if="row.original.predeterminado"
                                    label="Predeterminado"
                                    icon="i-lucide-star"
                                    color="primary"
                                    variant="subtle"
                                    size="sm"
                                />
                            </ULink>
                            <span class="text-xs text-muted">{{ row.original.empresa_id === null ? 'Común a todas las empresas' : nombreEmpresa(row.original.empresa_id) }}</span>
                            <span
                                v-if="row.original.advertencias.length"
                                class="flex items-center gap-1 text-xs text-warning"
                            >
                                <UIcon
                                    name="i-lucide-triangle-alert"
                                    class="size-3.5 shrink-0"
                                />
                                {{ row.original.advertencias.length === 1 ? '1 advertencia' : `${row.original.advertencias.length} advertencias` }}
                            </span>
                        </div>
                    </template>
                    <template #clases-cell="{ row }">
                        <span class="tabular-nums">{{ row.original.clases.filter(c => c.activa).length }}</span>
                    </template>
                    <template #routers-cell="{ row }">
                        <ProblemaAlerta
                            v-if="detalles[row.original.id]?.problema"
                            :problema="detalles[row.original.id]!.problema!"
                            :reintentar="() => cargarDetalle(row.original.id)"
                            :reintentando="detalles[row.original.id]?.cargando"
                        />
                        <USkeleton
                            v-else-if="!detalles[row.original.id]?.detalle"
                            class="h-4 w-28"
                        />
                        <span
                            v-else-if="!detalles[row.original.id]!.detalle!.routers.length"
                            class="text-sm text-muted"
                        >Ninguno</span>
                        <div
                            v-else
                            class="flex flex-wrap gap-1"
                            :data-prueba="`routers-perfil-${row.original.id}`"
                        >
                            <UBadge
                                v-for="uso in detalles[row.original.id]!.detalle!.routers"
                                :key="uso.router_id"
                                :label="uso.planes_qos ? `${uso.nombre} · ${uso.planes_qos} con QoS` : uso.nombre"
                                color="neutral"
                                variant="outline"
                                size="sm"
                            />
                        </div>
                    </template>
                    <template #costo-cell="{ row }">
                        <QosCosto
                            v-if="detalles[row.original.id]?.detalle && mayorUso(detalles[row.original.id]!.detalle!)"
                            :uso="mayorUso(detalles[row.original.id]!.detalle!)!"
                            corto
                        />
                        <span
                            v-else-if="detalles[row.original.id]?.detalle"
                            class="text-sm text-muted"
                        >—</span>
                    </template>
                    <template #acciones-cell="{ row }">
                        <div class="flex justify-end gap-1">
                            <UButton
                                v-if="puede('qos.gestionar')"
                                icon="i-lucide-copy"
                                color="neutral"
                                variant="ghost"
                                size="sm"
                                :aria-label="`Copiar ${row.original.nombre}`"
                                :data-prueba="`copiar-perfil-${row.original.id}`"
                                @click="abrirCrear(row.original.id)"
                            />
                            <UButton
                                :to="`/red/qos/${row.original.id}`"
                                icon="i-lucide-chevron-right"
                                color="neutral"
                                variant="ghost"
                                size="sm"
                                :aria-label="`Ver ${row.original.nombre}`"
                            />
                        </div>
                    </template>
                    <template #empty>
                        <UEmpty
                            icon="i-lucide-list-ordered"
                            title="Todavía no hay perfiles de QoS"
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

        <QosPerfilModal
            v-if="puede('qos.gestionar')"
            v-model:open="crearAbierto"
            :perfiles="lista.filas.value"
            :copiar-de="copiarDe"
            @creado="alCrear"
        />
    </PanelPagina>
</template>
