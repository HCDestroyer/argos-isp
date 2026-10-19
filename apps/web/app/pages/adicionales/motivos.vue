<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { SelectItem, TableColumn } from '@nuxt/ui'

/**
 * Motivos de cortesía (A1, `contratos/adicionales.md`): por qué se regala un adicional. Los
 * comunes (`empresa_id = null`) son de todas las empresas; cada empresa agrega los suyos
 * (`adicionales.crear_motivo`). Desactivar (`adicionales.desactivar_motivo`) uno común pide alcance
 * global; nada se borra.
 */
definePageMeta({ permiso: 'adicionales.ver' })

useHead({ title: 'Motivos de cortesía · ArgosIsp' })

const toast = useToast()
const { puede } = usePermisos()
const usuario = useUsuarioActual()
const { nombre: nombreEmpresa } = useEmpresaActiva()

const TODOS = 'todos'
const activo = ref<'activos' | 'inactivos' | typeof TODOS>('activos')
const itemsActivo: SelectItem[] = [
    { label: 'Activos', value: 'activos' },
    { label: 'Desactivados', value: 'inactivos' },
    { label: 'Todos', value: TODOS },
]

const motivos = shallowRef<MotivoCortesia[]>([])
const cargando = ref(false)
const problema = ref<Problem | null>(null)

const columnas: TableColumn<MotivoCortesia>[] = [
    { accessorKey: 'nombre', header: 'Motivo', meta: { class: { td: 'whitespace-normal' } } },
    { accessorKey: 'empresa_id', header: 'Ámbito' },
    { accessorKey: 'activo', header: 'Estado', meta: SOLO_ANCHO },
    { id: 'acciones', header: '', meta: { class: { td: 'text-right w-0' } } },
]

const nuevoAbierto = ref(false)
const desactivarAbierto = ref(false)
const aDesactivar = shallowRef<MotivoCortesia | null>(null)

/** Un motivo común solo lo desactiva quien tiene alcance global (la API responde 403). */
function puedeDesactivar(motivo: MotivoCortesia): boolean {
    return puede('adicionales.desactivar_motivo') && motivo.activo && (motivo.empresa_id !== null || usuario.value?.alcance_global === true)
}

async function cargar() {
    cargando.value = true
    problema.value = null
    const resultado = await useAdicionales().motivos(activo.value === TODOS ? {} : { activo: activo.value === 'activos' })
    cargando.value = false
    motivos.value = resultado.ok ? resultado.data : []
    problema.value = resultado.ok ? null : resultado.problema
}

function pedirDesactivar(motivo: MotivoCortesia) {
    aDesactivar.value = motivo
    desactivarAbierto.value = true
}

function desactivar() {
    const actual = aDesactivar.value
    if (!actual) {
        return Promise.resolve({ ok: false as const, problema: { type: 'about:blank', title: 'Sin motivo', status: 0 } })
    }
    return useAdicionales().desactivarMotivo(actual.id, actual.version)
}

function alCrear(motivo: MotivoCortesia) {
    toast.add({ title: `Motivo ${motivo.nombre} creado`, description: motivo.codigo, icon: 'i-lucide-circle-check', color: 'success' })
    void cargar()
}

function alDesactivar(motivo: MotivoCortesia) {
    toast.add({ title: `Motivo ${motivo.nombre} desactivado`, description: 'Las cortesías que ya lo usan lo conservan.', icon: 'i-lucide-ban', color: 'neutral' })
    void cargar()
}

watch(activo, () => void cargar())
onMounted(cargar)
</script>

<template>
    <PanelPagina
        id="motivos-cortesia"
        titulo="Motivos de cortesía"
        icono="i-lucide-gift"
    >
        <template #acciones>
            <UButton
                v-if="puede('adicionales.crear_motivo')"
                label="Nuevo motivo"
                icon="i-lucide-plus"
                :ui="{ label: 'hidden sm:inline' }"
                aria-label="Nuevo motivo"
                data-prueba="nuevo-motivo"
                @click="nuevoAbierto = true"
            />
        </template>

        <div class="flex flex-col gap-4">
            <UButton
                to="/adicionales"
                label="Adicionales"
                icon="i-lucide-arrow-left"
                color="neutral"
                variant="link"
                class="self-start px-0"
            />
            <p class="max-w-3xl text-sm text-muted">
                Toda cortesía lleva uno de estos motivos. Los comunes valen para todas las empresas; cada empresa agrega los suyos.
            </p>
            <USelect
                v-model="activo"
                :items="itemsActivo"
                aria-label="Filtrar por estado"
                class="w-full sm:w-44"
            />

            <ProblemaAlerta
                v-if="problema"
                :problema="problema"
                :reintentar="cargar"
                :reintentando="cargando"
            />
            <UTable
                v-else
                :data="motivos"
                :columns="columnas"
                :loading="cargando"
                data-prueba="tabla-motivos"
            >
                <template #nombre-cell="{ row }">
                    <div class="flex flex-col">
                        <span class="text-sm font-medium text-highlighted">{{ row.original.nombre }}</span>
                        <span class="font-mono text-xs text-muted">{{ row.original.codigo }}</span>
                    </div>
                </template>
                <template #empresa_id-cell="{ row }">
                    <UBadge
                        v-if="row.original.empresa_id === null"
                        label="Común"
                        icon="i-lucide-globe"
                        color="neutral"
                        variant="outline"
                        size="sm"
                    />
                    <span
                        v-else
                        class="text-sm"
                    >{{ nombreEmpresa(row.original.empresa_id) }}</span>
                </template>
                <template #activo-cell="{ row }">
                    <UBadge
                        :label="row.original.activo ? 'Activo' : 'Desactivado'"
                        :color="row.original.activo ? 'success' : 'neutral'"
                        variant="subtle"
                        size="sm"
                    />
                </template>
                <template #acciones-cell="{ row }">
                    <UButton
                        v-if="puedeDesactivar(row.original)"
                        icon="i-lucide-ban"
                        color="error"
                        variant="ghost"
                        size="sm"
                        :aria-label="`Desactivar ${row.original.nombre}`"
                        :data-prueba="`desactivar-motivo-${row.original.id}`"
                        @click="pedirDesactivar(row.original)"
                    />
                </template>
                <template #empty>
                    <UEmpty
                        icon="i-lucide-gift"
                        title="Sin motivos"
                        variant="naked"
                    />
                </template>
            </UTable>
        </div>

        <MotivoCortesiaModal
            v-if="puede('adicionales.crear_motivo')"
            v-model:open="nuevoAbierto"
            @guardado="alCrear"
        />
        <ConfirmacionModal
            v-if="aDesactivar && puede('adicionales.desactivar_motivo')"
            v-model:open="desactivarAbierto"
            :titulo="`Desactivar ${aDesactivar.nombre}`"
            efecto="Ya no se podrá elegir para una cortesía nueva; las que ya lo usan lo conservan."
            confirmar="Desactivar"
            :ejecutar="desactivar"
            @hecho="alDesactivar"
        />
    </PanelPagina>
</template>
