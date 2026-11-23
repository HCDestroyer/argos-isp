<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { SelectItem, TableColumn } from '@nuxt/ui'
import { h } from 'vue'

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
const itemsActivo: SelectItem[] = [{ label: 'Estado: activos', value: 'si' }, { label: 'Desactivados', value: 'no' }, { label: 'Estado: todos', value: TODOS }]
const busqueda = ref('')
const visibles = computed(() => {
    const q = busqueda.value.trim().toLowerCase()
    return tipos.value.filter(t => !q || t.nombre.toLowerCase().includes(q) || t.codigo.toLowerCase().includes(q))
})

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
    { id: 'acciones', header: () => h('span', { class: 'sr-only' }, 'Acciones'), meta: { class: { td: 'w-0 text-end', th: 'w-0' } } },
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

function accionesTipo(tipo: TipoProducto): AccionFila[] {
    if (!tipo.activo || !editable(tipo)) {
        return []
    }
    return [
        ...(puede('tipos_producto.editar') ? [{ etiqueta: 'Editar tipo', icono: ICONOS.editar, alElegir: () => abrir(tipo) }] : []),
        ...(puede('tipos_producto.desactivar') ? [{ etiqueta: 'Desactivar', icono: 'i-lucide-circle-pause', color: 'error' as const, alElegir: () => pedirDesactivar(tipo) }] : []),
    ]
}

const menuFila = useMenuFila(accionesTipo)

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
                size="lg"
                class="glow-brand rounded-full px-5"
                data-prueba="nuevo-tipo-producto"
                @click="abrir(null)"
            />
        </template>

        <div class="surface-card flex min-h-0 min-w-0 flex-1 flex-col overflow-auto rounded-2xl">
            <div class="flex flex-wrap items-center gap-2 p-3 sm:px-4">
                <UInput
                    v-model="busqueda"
                    icon="i-lucide-search"
                    placeholder="Nombre o código"
                    aria-label="Buscar tipo de producto"
                    class="w-full sm:w-72"
                    :ui="{ base: 'rounded-full' }"
                />
                <USelect
                    v-model="activo"
                    :items="itemsActivo"
                    icon="i-lucide-filter"
                    class="w-full sm:ms-auto sm:w-44"
                    aria-label="Estado"
                />
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
            <UContextMenu
                v-else
                :items="menuFila.items.value"
            >
                <UTable
                    :data="visibles"
                    :columns="columnas"
                    :loading="cargando"
                    sticky
                    :ui="{ thead: 'bg-(--ax-cabecera-tabla)', th: 'text-xs', td: 'py-3' }"
                    data-menu-contextual
                    data-prueba="tabla-tipos-producto"
                    @contextmenu="menuFila.alContextmenu"
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
                        <UDropdownMenu
                            v-if="menuFila.itemsDe(row.original).length"
                            :items="menuFila.itemsDe(row.original)"
                            :content="{ align: 'end' }"
                        >
                            <UButton
                                icon="i-lucide-ellipsis"
                                color="neutral"
                                variant="ghost"
                                size="sm"
                                :aria-label="`Más acciones: ${row.original.nombre}`"
                            />
                        </UDropdownMenu>
                    </template>
                    <template #empty>
                        <UEmpty
                            icon="i-lucide-tags"
                            title="Sin tipos de producto"
                            variant="naked"
                        />
                    </template>
                </UTable>
            </UContextMenu>
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
