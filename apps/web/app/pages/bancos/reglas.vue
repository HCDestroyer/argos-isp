<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { TableColumn } from '@nuxt/ui'

/** Reglas de conciliación (A3, fase 4 §10.3): lista, alta y edición con `version` (`bancos.conciliar`). */
definePageMeta({ permiso: 'bancos.ver' })

useHead({ title: 'Reglas de conciliación · ArgosIsp' })

const toast = useToast()
const { puede } = usePermisos()

const reglas = shallowRef<ReglaConciliacion[]>([])
const cuentas = shallowRef<CuentaBanco[]>([])
const cargando = ref(true)
const problema = ref<Problem | null>(null)
const editada = shallowRef<ReglaConciliacion | null>(null)
const modalAbierto = ref(false)

const columnas: TableColumn<ReglaConciliacion>[] = [
    { accessorKey: 'nombre', header: 'Regla' },
    { accessorKey: 'accion', header: 'Acción', meta: SOLO_ANCHO },
    { accessorKey: 'prioridad', header: 'Prioridad', meta: SOLO_ESCRITORIO },
    { accessorKey: 'activa', header: 'Estado' },
    { id: 'acciones', header: '', meta: { class: { td: 'text-right w-0' } } },
]

const ordenadas = computed(() => [...reglas.value].sort((a, b) => a.prioridad - b.prioridad || a.id - b.id))

async function cargar() {
    cargando.value = true
    const resultado = await useReglasConciliacion().listar()
    cargando.value = false
    reglas.value = resultado.ok ? resultado.data : []
    problema.value = resultado.ok ? null : resultado.problema
}

function abrir(regla: ReglaConciliacion | null) {
    editada.value = regla
    modalAbierto.value = true
}

function alGuardar(regla: ReglaConciliacion) {
    toast.add({ title: editada.value ? 'Regla actualizada' : 'Regla creada', description: regla.nombre, icon: 'i-lucide-circle-check', color: 'success' })
    void cargar()
}

onMounted(cargar)
</script>

<template>
    <PanelPagina
        id="reglas-conciliacion"
        titulo="Reglas de conciliación"
        icono="i-lucide-wand-sparkles"
    >
        <template #acciones>
            <UButton
                to="/bancos/extractos"
                icon="i-lucide-arrow-left"
                label="Extractos"
                color="neutral"
                variant="ghost"
                class="hidden sm:inline-flex"
            />
            <UButton
                v-if="puede('bancos.conciliar')"
                label="Nueva regla"
                icon="i-lucide-plus"
                :ui="{ label: 'hidden sm:inline' }"
                aria-label="Nueva regla"
                data-prueba="nueva-regla"
                @click="abrir(null)"
            />
        </template>

        <!-- Solo para nombrar la cuenta de cada regla. -->
        <div class="hidden">
            <CuentaBancoSelect @cargadas="cuentas = $event" />
        </div>

        <ProblemaAlerta
            v-if="problema"
            :problema="problema"
            :reintentar="cargar"
            :reintentando="cargando"
        />
        <UTable
            v-else
            :data="ordenadas"
            :columns="columnas"
            :loading="cargando"
            data-prueba="tabla-reglas"
        >
            <template #nombre-cell="{ row }">
                <div class="flex min-w-0 flex-col whitespace-normal">
                    <span class="text-sm font-medium text-highlighted">{{ row.original.nombre }}</span>
                    <span class="text-xs text-muted">{{ condicionRegla(row.original) }}</span>
                    <span class="text-xs text-muted">{{ row.original.cuenta_id ? nombreCuentaBanco(cuentas, row.original.cuenta_id) : 'Todas las cuentas' }}</span>
                    <span class="text-xs text-muted sm:hidden">{{ ACCIONES_REGLA[row.original.accion].etiqueta }}<template v-if="row.original.contrapartida"> · {{ row.original.contrapartida }}</template></span>
                </div>
            </template>
            <template #accion-cell="{ row }">
                <div class="flex flex-col">
                    <span class="text-sm">{{ ACCIONES_REGLA[row.original.accion].etiqueta }}</span>
                    <span
                        v-if="row.original.contrapartida"
                        class="font-mono text-xs text-muted"
                    >{{ row.original.contrapartida }}</span>
                </div>
            </template>
            <template #prioridad-cell="{ row }">
                <span class="tabular-nums">{{ row.original.prioridad }}</span>
            </template>
            <template #activa-cell="{ row }">
                <UBadge
                    :label="row.original.activa ? 'Activa' : 'Inactiva'"
                    :color="row.original.activa ? 'success' : 'neutral'"
                    variant="subtle"
                    size="sm"
                />
            </template>
            <template #acciones-cell="{ row }">
                <UButton
                    v-if="puede('bancos.conciliar')"
                    icon="i-lucide-pencil"
                    color="neutral"
                    variant="ghost"
                    size="sm"
                    :aria-label="`Editar ${row.original.nombre}`"
                    @click="abrir(row.original)"
                />
            </template>
            <template #empty>
                <UEmpty
                    icon="i-lucide-wand-sparkles"
                    title="Sin reglas"
                    description="Una regla concilia sola las comisiones, intereses o transferencias de clientes que se repiten cada mes."
                    variant="naked"
                />
            </template>
        </UTable>

        <ReglaConciliacionModal
            v-if="puede('bancos.conciliar')"
            v-model:open="modalAbierto"
            :regla="editada"
            @hecho="alGuardar"
        />
    </PanelPagina>
</template>
