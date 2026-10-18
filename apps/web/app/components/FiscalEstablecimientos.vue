<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { TableColumn } from '@nuxt/ui'

/**
 * Establecimientos de la SAT de la empresa activa (`GET /fiscal/establecimientos`). El por
 * defecto es con el que se emite; no se borran, se desactivan.
 */
const { puede } = usePermisos()
const toast = useToast()

const datos = shallowRef<EstablecimientoFiscal[]>([])
const cargando = ref(false)
const leidos = ref(false)
const problema = ref<Problem | null>(null)
const editando = shallowRef<EstablecimientoFiscal | null>(null)
const abierto = ref(false)

const columnas: TableColumn<EstablecimientoFiscal>[] = [
    { accessorKey: 'codigo', header: 'Código', meta: { class: { th: 'w-0', td: 'font-mono' } } },
    { accessorKey: 'nombre', header: 'Establecimiento' },
    { accessorKey: 'municipio', header: 'Municipio', meta: SOLO_ESCRITORIO },
    { accessorKey: 'activo', header: 'Estado' },
    { id: 'acciones', header: '', meta: { class: { th: 'w-0', td: 'text-right' } } },
]

async function cargar() {
    // La página ya exige `fiscal.ver`; la guardia deja explícito el permiso de la lectura.
    if (!puede('fiscal.ver')) {
        return
    }
    cargando.value = true
    const resultado = await useEstablecimientosFiscales().listar()
    cargando.value = false
    leidos.value = true
    datos.value = resultado.ok ? resultado.data : []
    problema.value = resultado.ok ? null : problemaFiscalLegible(resultado.problema)
}

function nuevo() {
    editando.value = null
    abierto.value = true
}

function editar(establecimiento: EstablecimientoFiscal) {
    editando.value = establecimiento
    abierto.value = true
}

async function recargarEditado() {
    const id = editando.value?.id
    if (!id) {
        return
    }
    const resultado = await useEstablecimientosFiscales().ver(id)
    if (resultado.ok) {
        editando.value = resultado.data
        datos.value = datos.value.map(e => (e.id === id ? resultado.data : e))
    }
    else {
        toast.add({ title: 'No se pudo recargar el establecimiento', description: resultado.problema.detail ?? resultado.problema.title, color: 'error', icon: 'i-lucide-circle-alert' })
    }
}

function alGuardar(establecimiento: EstablecimientoFiscal, esNuevo: boolean) {
    toast.add({
        title: esNuevo ? 'Establecimiento creado' : 'Establecimiento actualizado',
        description: `${establecimiento.codigo} · ${establecimiento.nombre}${establecimiento.por_defecto ? ' (por defecto)' : ''}`,
        icon: 'i-lucide-store',
        color: 'success',
    })
    void cargar()
}

onMounted(cargar)
</script>

<template>
    <div class="flex flex-col gap-4">
        <div class="flex flex-wrap items-center justify-between gap-2">
            <p class="text-sm text-muted">
                Cada DTE lleva el código del establecimiento que lo emite; sin indicar otro, el por defecto.
            </p>
            <UButton
                v-if="puede('fiscal.configurar')"
                label="Nuevo establecimiento"
                icon="i-lucide-plus"
                @click="nuevo"
            />
        </div>

        <ProblemaAlerta
            v-if="problema"
            :problema="problema"
            :reintentar="cargar"
            :reintentando="cargando"
        />
        <UTable
            v-else
            :data="datos"
            :columns="columnas"
            :loading="cargando"
            :empty="leidos ? 'La empresa no tiene establecimientos: agrega el que registró en la SAT.' : ''"
        >
            <template #nombre-cell="{ row }">
                <div
                    class="flex min-w-0 flex-col whitespace-normal"
                    :data-establecimiento="row.original.codigo"
                >
                    <div class="flex flex-wrap items-center gap-1.5">
                        <span class="font-medium text-highlighted">{{ row.original.nombre }}</span>
                        <UBadge
                            v-if="row.original.por_defecto"
                            label="Por defecto"
                            icon="i-lucide-star"
                            color="primary"
                            variant="subtle"
                            size="sm"
                        />
                    </div>
                    <span class="text-xs text-muted">{{ [row.original.direccion, row.original.departamento].filter(Boolean).join(' · ') || 'Sin dirección' }}</span>
                </div>
            </template>
            <template #municipio-cell="{ row }">
                {{ row.original.municipio ?? '—' }}
            </template>
            <template #activo-cell="{ row }">
                <UBadge
                    :label="row.original.activo ? 'Activo' : 'Inactivo'"
                    :icon="row.original.activo ? 'i-lucide-circle-check' : 'i-lucide-circle-pause'"
                    :color="row.original.activo ? 'success' : 'neutral'"
                    variant="subtle"
                />
            </template>
            <template #acciones-cell="{ row }">
                <UButton
                    v-if="puede('fiscal.configurar')"
                    icon="i-lucide-pencil"
                    color="neutral"
                    variant="ghost"
                    size="sm"
                    :aria-label="`Editar establecimiento ${row.original.codigo}`"
                    @click="editar(row.original)"
                />
            </template>
        </UTable>

        <EstablecimientoFiscalFormulario
            v-if="puede('fiscal.configurar')"
            v-model:open="abierto"
            :establecimiento="editando"
            @guardado="alGuardar"
            @recargar="recargarEditado"
        />
    </div>
</template>
