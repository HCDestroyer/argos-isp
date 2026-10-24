<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { TableColumn } from '@nuxt/ui'

/**
 * Catálogo de premios del programa de lealtad (A3, fase 2; `lealtad.ver`): lo que el cliente puede
 * canjear con sus puntos. Nuevo y Editar con `lealtad.configurar` (desactivar = `activo: false`).
 */
definePageMeta({ permiso: 'lealtad.ver' })

useHead({ title: 'Premios de lealtad · ArgosIsp' })

const { puede } = usePermisos()
const toast = useToast()

const programa = shallowRef<ProgramaLealtad | null>(null)
const problemaPrograma = ref<Problem | null>(null)
const cargandoPrograma = ref(true)

const lista = usePaginacionCursor(cursor => usePremiosLealtad().listar(programa.value ? { programa_id: programa.value.id } : {}, cursor))

async function cargar() {
    cargandoPrograma.value = true
    const resultado = await useProgramasLealtad().actual()
    cargandoPrograma.value = false
    programa.value = resultado.ok ? resultado.data.programa : null
    problemaPrograma.value = resultado.ok ? null : resultado.problema
    if (programa.value) {
        void lista.recargar()
    }
}

onMounted(cargar)

const columnas: TableColumn<PremioLealtad>[] = [
    { accessorKey: 'nombre', header: 'Premio', meta: { class: { td: 'whitespace-normal' } } },
    { accessorKey: 'costo_puntos', header: 'Puntos', meta: { class: { th: 'text-right', td: 'text-right' } } },
    { id: 'estado', header: 'Estado', meta: SOLO_ANCHO },
    { id: 'acciones', header: '', meta: { class: { td: 'text-right w-0' } } },
]

const editando = shallowRef<PremioLealtad | null>(null)
const abierto = ref(false)

function abrir(premio: PremioLealtad | null) {
    editando.value = premio
    abierto.value = true
}

function alGuardar(premio: PremioLealtad) {
    toast.add({ title: editando.value ? `${premio.nombre} actualizado` : `${premio.nombre} creado`, description: `${formatearPuntos(premio.costo_puntos)} · ${resumenPremio(premio)}`, color: 'success', icon: 'i-lucide-circle-check' })
    void lista.recargar()
}
</script>

<template>
    <PanelPagina
        id="premios-lealtad"
        titulo="Premios de lealtad"
        icono="i-lucide-gift"
    >
        <template #acciones>
            <UButton
                v-if="programa && puede('lealtad.configurar')"
                label="Nuevo premio"
                icon="i-lucide-plus"
                data-prueba="nuevo-premio"
                @click="abrir(null)"
            />
        </template>

        <div class="flex flex-col gap-4">
            <ProblemaAlerta
                v-if="problemaPrograma"
                :problema="problemaPrograma"
                :reintentar="cargar"
                :reintentando="cargandoPrograma"
            />
            <USkeleton
                v-else-if="cargandoPrograma"
                class="h-32 w-full"
            />
            <UEmpty
                v-else-if="!programa"
                icon="i-lucide-gem"
                title="La empresa no tiene programa de lealtad"
                description="Créalo en Lealtad antes de armar el catálogo."
                variant="naked"
            />
            <ProblemaAlerta
                v-else-if="lista.problema.value"
                :problema="lista.problema.value"
                :reintentar="lista.recargar"
                :reintentando="lista.cargando.value"
            />
            <template v-else>
                <p class="text-sm text-muted">
                    {{ programa.nombre }} · un punto vale {{ formatearQuetzales(programa.valor_punto) }}<template v-if="programa.minimo_canje">
                        · canje desde {{ formatearPuntos(programa.minimo_canje) }}
                    </template> · portal: {{ programa.canje_portal ? 'se canjea ahí' : programa.visible_portal ? 'solo se ve' : 'oculto' }}.
                </p>
                <UTable
                    :data="lista.filas.value"
                    :columns="columnas"
                    :loading="lista.cargando.value"
                    :ui="{ td: 'py-3' }"
                    data-prueba="tabla-premios"
                >
                    <template #nombre-cell="{ row }">
                        <div
                            class="flex min-w-0 items-start gap-2"
                            :data-premio="row.original.id"
                        >
                            <UIcon
                                :name="TIPOS_PREMIO[row.original.tipo].icono"
                                class="mt-0.5 size-4 shrink-0 text-muted"
                            />
                            <div class="flex min-w-0 flex-col gap-0.5">
                                <span class="text-sm font-medium text-highlighted">{{ row.original.nombre }}</span>
                                <span class="text-xs text-muted">{{ TIPOS_PREMIO[row.original.tipo].etiqueta }} · {{ resumenPremio(row.original) }}</span>
                                <span class="text-xs text-muted sm:hidden">{{ row.original.activo ? 'Activo' : 'Inactivo' }}{{ row.original.en_portal ? ' · en el portal' : '' }}</span>
                            </div>
                        </div>
                    </template>
                    <template #costo_puntos-cell="{ row }">
                        <span class="tabular-nums font-medium">{{ formatearPuntos(row.original.costo_puntos) }}</span>
                    </template>
                    <template #estado-cell="{ row }">
                        <div class="flex flex-wrap gap-1">
                            <UBadge
                                :label="row.original.activo ? 'Activo' : 'Inactivo'"
                                :color="row.original.activo ? 'success' : 'neutral'"
                                variant="subtle"
                                size="sm"
                            />
                            <UBadge
                                v-if="row.original.en_portal"
                                label="En el portal"
                                color="info"
                                variant="outline"
                                size="sm"
                            />
                        </div>
                    </template>
                    <template #acciones-cell="{ row }">
                        <UButton
                            v-if="puede('lealtad.configurar')"
                            icon="i-lucide-pencil"
                            color="neutral"
                            variant="ghost"
                            size="sm"
                            :aria-label="`Editar ${row.original.nombre}`"
                            :data-prueba="`editar-premio-${row.original.id}`"
                            @click="abrir(row.original)"
                        />
                    </template>
                    <template #empty>
                        <UEmpty
                            icon="i-lucide-gift"
                            title="El catálogo está vacío"
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

        <PremioLealtadModal
            v-if="programa"
            v-model:open="abierto"
            :programa="programa"
            :premio="editando"
            @guardado="alGuardar"
        />
    </PanelPagina>
</template>
