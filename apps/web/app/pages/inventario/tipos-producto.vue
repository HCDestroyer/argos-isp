<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { SelectItem, TableColumn } from '@nuxt/ui'

/**
 * Tipos de producto (A3, `contratos/inventario.md` D.2): globales (las semillas `equipo`, `material`,
 * `otro` y los que cree alguien con alcance global) y de la empresa. «Nuevo tipo»
 * (`tipos_producto.crear`), «Editar» (`tipos_producto.editar`) y «Desactivar» (`tipos_producto.desactivar`).
 */
definePageMeta({ permiso: 'inventario.ver' })

useHead({ title: 'Tipos de producto · ArgosIsp' })

const toast = useToast()
const { puede } = usePermisos()
const usuario = useUsuarioActual()
const alcanceGlobal = computed(() => usuario.value?.alcance_global === true)

const TODOS = 'todos'
const activo = ref<'si' | 'no' | typeof TODOS>('si')
const itemsActivo: SelectItem[] = [{ label: 'Activos', value: 'si' }, { label: 'Desactivados', value: 'no' }, { label: 'Todos', value: TODOS }]

const tipos = shallowRef<TipoProducto[]>([])
const problema = ref<Problem | null>(null)
const cargando = ref(false)

async function cargar() {
    cargando.value = true
    const resultado = await useTiposProducto().listar(activo.value === TODOS ? {} : { activo: activo.value === 'si' })
    cargando.value = false
    tipos.value = resultado.ok ? resultado.data.data : []
    problema.value = resultado.ok ? null : resultado.problema
}

onMounted(cargar)
watch(activo, cargar)

/** Un global solo lo toca quien tiene alcance global. */
const editable = (tipo: TipoProducto) => tipo.empresa_id !== null || alcanceGlobal.value

const columnas: TableColumn<TipoProducto>[] = [
    { accessorKey: 'nombre', header: 'Tipo', meta: { class: { td: 'whitespace-normal' } } },
    { accessorKey: 'seguimiento_defecto', header: 'Seguimiento', meta: SOLO_ANCHO },
    { accessorKey: 'modalidad_defecto', header: 'Modalidad', meta: SOLO_ANCHO },
    { id: 'acciones', header: '', meta: { class: { td: 'text-right w-0' } } },
]

const formularioAbierto = ref(false)
const editando = shallowRef<TipoProducto | null>(null)

function abrir(tipo: TipoProducto | null) {
    editando.value = tipo
    formularioAbierto.value = true
}

function alGuardar(tipo: TipoProducto) {
    const existia = tipos.value.some(t => t.id === tipo.id)
    tipos.value = existia ? tipos.value.map(t => (t.id === tipo.id ? tipo : t)) : [...tipos.value, tipo]
    toast.add({ title: existia ? `${tipo.nombre} guardado` : `${tipo.nombre} creado`, icon: 'i-lucide-circle-check', color: 'success' })
}

const aDesactivar = shallowRef<TipoProducto | null>(null)
const desactivarAbierto = ref(false)

function pedirDesactivar(tipo: TipoProducto) {
    aDesactivar.value = tipo
    desactivarAbierto.value = true
}

function desactivar(motivo: string): Promise<Resultado<TipoProducto>> {
    const tipo = aDesactivar.value
    return tipo ? useTiposProducto().desactivar(tipo, motivo) : Promise.resolve({ ok: false, problema: { type: 'about:blank', title: 'Elige un tipo', status: 400 } })
}

function alDesactivar(tipo: TipoProducto) {
    tipos.value = activo.value === 'si' ? tipos.value.filter(t => t.id !== tipo.id) : tipos.value.map(t => (t.id === tipo.id ? tipo : t))
    toast.add({ title: `${tipo.nombre} desactivado`, icon: 'i-lucide-circle-check', color: 'success' })
}
</script>

<template>
    <PanelPagina
        id="inventario-tipos-producto"
        titulo="Tipos de producto"
        icono="i-lucide-tags"
    >
        <template #acciones>
            <UButton
                v-if="puede('tipos_producto.crear')"
                label="Nuevo tipo"
                icon="i-lucide-plus"
                data-prueba="nuevo-tipo-producto"
                @click="abrir(null)"
            />
        </template>

        <div class="flex flex-col gap-4">
            <USelect
                v-model="activo"
                :items="itemsActivo"
                class="w-full sm:w-44"
                aria-label="Estado"
            />
            <ProblemaAlerta
                v-if="problema"
                :problema="problema"
                :reintentar="cargar"
                :reintentando="cargando"
            />
            <UTable
                v-else
                :data="tipos"
                :columns="columnas"
                :loading="cargando"
                :ui="{ td: 'py-3' }"
                data-prueba="tabla-tipos-producto"
            >
                <template #nombre-cell="{ row }">
                    <div
                        class="flex min-w-0 flex-col gap-0.5"
                        :data-tipo-producto="row.original.codigo"
                    >
                        <span class="flex flex-wrap items-center gap-1.5 text-sm font-medium text-highlighted">
                            {{ row.original.nombre }}
                            <UBadge
                                v-if="row.original.empresa_id === null"
                                label="Global"
                                color="neutral"
                                variant="outline"
                                size="sm"
                            />
                            <UBadge
                                v-if="!row.original.activo"
                                label="Desactivado"
                                color="neutral"
                                variant="subtle"
                                size="sm"
                            />
                        </span>
                        <span class="font-mono text-xs text-muted">{{ row.original.codigo }}</span>
                        <div class="flex flex-wrap gap-1 sm:hidden">
                            <UBadge
                                :label="SEGUIMIENTOS[row.original.seguimiento_defecto].etiqueta"
                                color="neutral"
                                variant="subtle"
                                size="sm"
                            />
                            <ModalidadBadge :modalidad="row.original.modalidad_defecto" />
                        </div>
                    </div>
                </template>
                <template #seguimiento_defecto-cell="{ row }">
                    <UBadge
                        :label="SEGUIMIENTOS[row.original.seguimiento_defecto].etiqueta"
                        :icon="SEGUIMIENTOS[row.original.seguimiento_defecto].icono"
                        color="neutral"
                        variant="subtle"
                        size="sm"
                    />
                </template>
                <template #modalidad_defecto-cell="{ row }">
                    <ModalidadBadge :modalidad="row.original.modalidad_defecto" />
                </template>
                <template #acciones-cell="{ row }">
                    <div
                        v-if="row.original.activo && editable(row.original)"
                        class="flex justify-end gap-1"
                    >
                        <UButton
                            v-if="puede('tipos_producto.editar')"
                            icon="i-lucide-pencil"
                            color="neutral"
                            variant="ghost"
                            size="sm"
                            :aria-label="`Editar ${row.original.nombre}`"
                            @click="abrir(row.original)"
                        />
                        <UButton
                            v-if="puede('tipos_producto.desactivar')"
                            icon="i-lucide-circle-pause"
                            color="error"
                            variant="ghost"
                            size="sm"
                            :aria-label="`Desactivar ${row.original.nombre}`"
                            @click="pedirDesactivar(row.original)"
                        />
                    </div>
                </template>
                <template #empty>
                    <UEmpty
                        icon="i-lucide-tags"
                        title="Sin tipos de producto"
                        variant="naked"
                    />
                </template>
            </UTable>
        </div>

        <TipoProductoFormulario
            v-model:open="formularioAbierto"
            :tipo="editando"
            @guardado="alGuardar"
        />
        <AccionMotivoModal
            v-model:open="desactivarAbierto"
            titulo="Desactivar tipo de producto"
            :efecto="`Los productos nuevos ya no podrán ser «${aDesactivar?.nombre ?? ''}». Los que ya lo usan siguen igual.`"
            confirmar="Desactivar"
            icono="i-lucide-circle-pause"
            :ejecutar="motivo => desactivar(motivo)"
            @hecho="alDesactivar"
        />
    </PanelPagina>
</template>
