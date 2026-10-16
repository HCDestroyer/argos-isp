<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'

/**
 * Planes (A1): lista con su modelo de velocidad y el rate-limit resultante, alta
 * (`planes.crear`) y edición (`planes.editar`) con vista previa. La implementación por router
 * con excepciones queda para la tarea 7 completa.
 */
definePageMeta({ permiso: 'planes.ver' })

useHead({ title: 'Planes · ArgosIsp' })

const toast = useToast()
const { puede } = usePermisos()

const lista = usePaginacionCursor(cursor => usePlanes().listar({}, cursor))

const columnas: TableColumn<Plan>[] = [
    { accessorKey: 'nombre', header: 'Plan', meta: { class: { td: 'whitespace-normal' } } },
    { id: 'velocidad', header: 'Bajada / subida', meta: SOLO_ANCHO },
    { id: 'modelo', header: 'Reuso · garantía · prioridad', meta: SOLO_ESCRITORIO },
    { id: 'rate_limit', header: 'Rate-limit (activo)', meta: SOLO_ESCRITORIO },
    { accessorKey: 'precio', header: 'Precio', meta: { class: { th: 'text-right', td: 'text-right' } } },
    { id: 'acciones', header: '', meta: { class: { td: 'text-right w-0' } } },
]

const editando = shallowRef<Plan | null>(null)
const formularioAbierto = ref(false)

function abrir(plan: Plan | null) {
    editando.value = plan
    formularioAbierto.value = true
}

function alGuardar(plan: Plan) {
    toast.add({ title: editando.value ? `${plan.nombre} actualizado` : `${plan.nombre} creado`, description: rateLimitServicio(velocidadDePlan(plan), 'activo'), icon: 'i-lucide-circle-check', color: 'success' })
    void lista.recargar()
}

function velocidad(plan: Plan): string {
    return `${formatearVelocidad(plan.bajada_kbps)} / ${formatearVelocidad(plan.subida_kbps)}`
}

function modelo(plan: Plan): string {
    const v = velocidadDePlan(plan)
    return `1:${v.reuso} · ${garantizadoEfectivoPct(v)} % · prioridad ${v.prioridad}${v.rafaga_bajada_kbps || v.rafaga_subida_kbps ? ' · con ráfaga' : ''}`
}

onMounted(() => void lista.recargar())
</script>

<template>
    <PanelPagina
        id="planes"
        titulo="Planes"
        icono="i-lucide-gauge"
    >
        <template #acciones>
            <UButton
                v-if="puede('planes.crear')"
                label="Nuevo plan"
                icon="i-lucide-plus"
                data-prueba="nuevo-plan"
                @click="abrir(null)"
            />
        </template>

        <div class="flex flex-col gap-4">
            <p class="text-sm text-muted">
                Cada plan define velocidad máxima, reuso 1:N, garantía, ráfaga y prioridad. El rate-limit es el que reciben PPPoE y WISP en cualquier router con control simple; las excepciones por router pueden cambiarlo.
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
                    :ui="{ td: 'py-2.5' }"
                    data-prueba="tabla-planes"
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
                                <UBadge
                                    v-if="!row.original.global"
                                    label="Por router"
                                    color="neutral"
                                    variant="outline"
                                    size="sm"
                                />
                            </span>
                            <span class="text-xs text-muted sm:hidden">{{ velocidad(row.original) }}</span>
                            <span class="text-xs text-muted lg:hidden">{{ modelo(row.original) }}</span>
                        </div>
                    </template>
                    <template #velocidad-cell="{ row }">
                        <span class="whitespace-nowrap text-sm">{{ velocidad(row.original) }}</span>
                    </template>
                    <template #modelo-cell="{ row }">
                        <span class="text-sm">{{ modelo(row.original) }}</span>
                    </template>
                    <template #rate_limit-cell="{ row }">
                        <span class="font-mono text-xs">{{ rateLimitServicio(velocidadDePlan(row.original), 'activo') }}</span>
                    </template>
                    <template #precio-cell="{ row }">
                        <span class="whitespace-nowrap tabular-nums">{{ formatearQuetzales(row.original.precio) }}</span>
                    </template>
                    <template #acciones-cell="{ row }">
                        <UButton
                            v-if="puede('planes.editar')"
                            icon="i-lucide-pencil"
                            color="neutral"
                            variant="ghost"
                            size="sm"
                            :aria-label="`Editar ${row.original.nombre}`"
                            :data-prueba="`editar-plan-${row.original.id}`"
                            @click="abrir(row.original)"
                        />
                    </template>
                    <template #empty>
                        <UEmpty
                            icon="i-lucide-gauge"
                            title="Todavía no hay planes"
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

        <PlanFormulario
            v-model:open="formularioAbierto"
            :plan="editando"
            @guardado="alGuardar"
        />
    </PanelPagina>
</template>
