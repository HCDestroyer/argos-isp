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
const busqueda = ref('')
const filtradas = computed(() => {
    const texto = busqueda.value.trim().toLowerCase()
    return texto ? ordenadas.value.filter(r => `${r.nombre} ${condicionRegla(r)}`.toLowerCase().includes(texto)) : ordenadas.value
})

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
        <template #accion-principal>
            <UButton
                v-if="puede('bancos.conciliar')"
                label="Nueva regla"
                icon="i-lucide-plus"
                size="lg"
                class="glow-brand rounded-full px-5"
                data-prueba="nueva-regla"
                @click="abrir(null)"
            />
        </template>

        <!-- Solo para nombrar la cuenta de cada regla. -->
        <div class="hidden">
            <CuentaBancoSelect @cargadas="cuentas = $event" />
        </div>

        <div class="surface-card flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-2xl">
            <div class="flex flex-wrap items-center gap-2 p-3 sm:p-4">
                <UInput
                    v-model="busqueda"
                    icon="i-lucide-search"
                    placeholder="Buscar regla"
                    aria-label="Buscar regla por nombre o condición"
                    class="w-full sm:w-72"
                    :ui="{ base: 'rounded-full' }"
                />
                <span class="text-xs text-muted">Cada línea sin conciliar toma la primera regla que coincide (menor prioridad primero).</span>
            </div>
            <div
                v-if="problema"
                class="p-3 sm:p-4"
            >
                <ProblemaAlerta
                    :problema="problema"
                    :reintentar="cargar"
                    :reintentando="cargando"
                />
            </div>
            <UTable
                v-else
                :data="filtradas"
                :columns="columnas"
                :loading="cargando"
                sticky
                class="min-h-0 flex-1"
                :ui="{ thead: 'bg-(--ax-cabecera-tabla)', th: 'text-xs', td: 'py-3' }"
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
                        :icon="row.original.activa ? 'i-lucide-circle-check' : 'i-lucide-circle-pause'"
                        :color="row.original.activa ? 'success' : 'neutral'"
                        variant="subtle"
                        size="sm"
                        class="rounded-full"
                    />
                </template>
                <template #acciones-cell="{ row }">
                    <div class="flex items-center justify-end gap-0.5">
                        <UButton
                            v-if="puede('bancos.conciliar')"
                            :icon="ICONOS.editar"
                            color="neutral"
                            variant="ghost"
                            size="sm"
                            :title="`Editar ${row.original.nombre}`"
                            :aria-label="`Editar ${row.original.nombre}`"
                            @click="abrir(row.original)"
                        />
                    </div>
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
        </div>

        <ReglaConciliacionModal
            v-if="puede('bancos.conciliar')"
            v-model:open="modalAbierto"
            :regla="editada"
            @hecho="alGuardar"
        />
    </PanelPagina>
</template>
