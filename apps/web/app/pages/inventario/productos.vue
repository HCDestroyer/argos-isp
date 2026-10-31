<script setup lang="ts">
import type { SelectItem, TableColumn } from '@nuxt/ui'

/**
 * Productos del inventario (A3): SKU, tipo, seguimiento, existencia y valor de todas las bodegas.
 * «Nuevo producto» (`productos.crear`), «Editar» (`productos.editar`) y «Desactivar»
 * (`productos.desactivar`, solo sin existencias: 409 `producto_con_existencias`).
 */
definePageMeta({ permiso: 'inventario.ver' })

useHead({ title: 'Productos · ArgosIsp' })

const toast = useToast()
const { puede } = usePermisos()

const TODOS = 'todos'
const busqueda = ref('')
const seguimiento = ref<Producto['seguimiento'] | typeof TODOS>(TODOS)
const activo = ref<'si' | 'no' | typeof TODOS>('si')
const itemsSeguimiento: SelectItem[] = [{ label: 'Todo seguimiento', value: TODOS }, { label: 'Por cantidad', value: 'cantidad' }, { label: 'Por serie', value: 'serie' }]
const itemsActivo: SelectItem[] = [{ label: 'Activos', value: 'si' }, { label: 'Desactivados', value: 'no' }, { label: 'Todos', value: TODOS }]

const lista = usePaginacionCursor(cursor => useProductos().listar({
    ...(busqueda.value.trim() ? { q: busqueda.value.trim() } : {}),
    ...(seguimiento.value !== TODOS ? { seguimiento: seguimiento.value } : {}),
    ...(activo.value !== TODOS ? { activo: activo.value === 'si' } : {}),
}, cursor))

let espera: ReturnType<typeof setTimeout> | undefined
watch(busqueda, () => {
    clearTimeout(espera)
    espera = setTimeout(() => void lista.recargar(), 300)
})
watch([seguimiento, activo], () => void lista.recargar())
onMounted(() => void lista.recargar())

const columnas: TableColumn<Producto>[] = [
    { accessorKey: 'nombre', header: 'Producto', meta: { class: { td: 'whitespace-normal' } } },
    { accessorKey: 'seguimiento', header: 'Seguimiento', meta: SOLO_ANCHO },
    { accessorKey: 'modalidad', header: 'Modalidad', meta: SOLO_ANCHO },
    { accessorKey: 'existencia', header: 'Existencia', meta: { class: { th: 'text-right', td: 'text-right' } } },
    { accessorKey: 'valor', header: 'Valor', meta: { class: { th: 'text-right hidden lg:table-cell', td: 'text-right hidden lg:table-cell' } } },
    { id: 'acciones', header: '', meta: { class: { td: 'text-right w-0' } } },
]

const formularioAbierto = ref(false)
const editando = shallowRef<Producto | null>(null)

function abrirAlta() {
    editando.value = null
    formularioAbierto.value = true
}

function abrirEdicion(producto: Producto) {
    editando.value = producto
    formularioAbierto.value = true
}

function alGuardar(producto: Producto) {
    const existia = lista.filas.value.some(p => p.id === producto.id)
    lista.filas.value = existia ? lista.filas.value.map(p => (p.id === producto.id ? producto : p)) : [producto, ...lista.filas.value]
    toast.add({ title: existia ? `${producto.nombre} guardado` : `${producto.nombre} creado`, icon: 'i-lucide-circle-check', color: 'success' })
}

const aDesactivar = shallowRef<Producto | null>(null)
const desactivarAbierto = ref(false)

function pedirDesactivar(producto: Producto) {
    aDesactivar.value = producto
    desactivarAbierto.value = true
}

function desactivar(motivo: string): Promise<Resultado<Producto>> {
    const producto = aDesactivar.value
    return producto ? useProductos().desactivar(producto, motivo) : Promise.resolve({ ok: false, problema: { type: 'about:blank', title: 'Elige un producto', status: 400 } })
}

function alDesactivar(producto: Producto) {
    lista.filas.value = lista.filas.value.map(p => (p.id === producto.id ? producto : p))
    toast.add({ title: `${producto.nombre} desactivado`, icon: 'i-lucide-circle-check', color: 'success' })
}
</script>

<template>
    <PanelPagina
        id="inventario-productos"
        titulo="Productos"
        icono="i-lucide-box"
    >
        <template #acciones>
            <UButton
                v-if="puede('productos.crear_lote')"
                label="Alta por lote"
                icon="i-lucide-sheet"
                color="neutral"
                variant="outline"
                to="/inventario/productos-lote"
                aria-label="Alta por lote"
                :ui="{ label: 'hidden sm:inline' }"
                data-prueba="productos-lote"
            />
            <UButton
                v-if="puede('productos.crear')"
                label="Nuevo producto"
                icon="i-lucide-plus"
                data-prueba="nuevo-producto"
                @click="abrirAlta"
            />
        </template>

        <div class="flex flex-col gap-4">
            <div class="flex flex-col gap-2 sm:flex-row">
                <UInput
                    v-model="busqueda"
                    icon="i-lucide-search"
                    placeholder="SKU o nombre"
                    class="w-full sm:w-72"
                    aria-label="Buscar producto"
                />
                <USelect
                    v-model="seguimiento"
                    :items="itemsSeguimiento"
                    class="w-full sm:w-44"
                    aria-label="Seguimiento"
                />
                <USelect
                    v-model="activo"
                    :items="itemsActivo"
                    class="w-full sm:w-40"
                    aria-label="Estado"
                />
            </div>
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
                    :ui="{ td: 'py-3' }"
                    data-prueba="tabla-productos"
                >
                    <template #nombre-cell="{ row }">
                        <div
                            class="flex min-w-0 flex-col gap-0.5"
                            :data-producto="row.original.sku"
                        >
                            <span class="flex flex-wrap items-center gap-1.5 text-sm font-medium text-highlighted">
                                {{ row.original.nombre }}
                                <UBadge
                                    v-if="!row.original.activo"
                                    label="Desactivado"
                                    color="neutral"
                                    variant="subtle"
                                    size="sm"
                                />
                            </span>
                            <span class="font-mono text-xs text-muted">{{ row.original.sku }} · {{ nombreTipoProducto(row.original) }}</span>
                            <span class="text-xs text-muted sm:hidden">{{ SEGUIMIENTOS[row.original.seguimiento].etiqueta }}</span>
                            <ModalidadBadge
                                v-if="row.original.modalidad"
                                :modalidad="row.original.modalidad"
                                class="self-start sm:hidden"
                            />
                        </div>
                    </template>
                    <template #seguimiento-cell="{ row }">
                        <UBadge
                            :label="SEGUIMIENTOS[row.original.seguimiento].etiqueta"
                            :icon="SEGUIMIENTOS[row.original.seguimiento].icono"
                            color="neutral"
                            variant="subtle"
                            size="sm"
                        />
                    </template>
                    <template #modalidad-cell="{ row }">
                        <div class="flex flex-col items-start gap-0.5">
                            <ModalidadBadge
                                v-if="row.original.modalidad"
                                :modalidad="row.original.modalidad"
                            />
                            <span
                                v-if="row.original.modalidad === 'consumible_cobro'"
                                class="text-xs text-muted tabular-nums"
                            >{{ row.original.precio_venta ? formatearQuetzales(row.original.precio_venta) : 'Sin precio' }}</span>
                        </div>
                    </template>
                    <template #existencia-cell="{ row }">
                        <div class="flex flex-col items-end text-sm tabular-nums">
                            <ULink
                                :to="`/inventario?producto=${row.original.id}`"
                                class="font-medium text-highlighted hover:text-primary"
                            >{{ formatearCantidad(row.original.existencia, row.original.unidad) }}</ULink>
                            <span
                                v-if="row.original.existencia_minima"
                                class="text-xs text-muted"
                            >mín. {{ formatearCantidad(row.original.existencia_minima) }}</span>
                        </div>
                    </template>
                    <template #valor-cell="{ row }">
                        <span class="text-sm tabular-nums">{{ formatearQuetzales(row.original.valor) }}</span>
                    </template>
                    <template #acciones-cell="{ row }">
                        <div class="flex justify-end gap-1">
                            <UButton
                                v-if="puede('productos.editar')"
                                icon="i-lucide-pencil"
                                color="neutral"
                                variant="ghost"
                                size="sm"
                                :aria-label="`Editar ${row.original.nombre}`"
                                @click="abrirEdicion(row.original)"
                            />
                            <UButton
                                v-if="row.original.activo && puede('productos.desactivar')"
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
                            icon="i-lucide-box"
                            title="Sin productos"
                            description="Crea los productos que compras, guardas y prestas."
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

        <ProductoFormulario
            v-model:open="formularioAbierto"
            :producto="editando"
            @guardado="alGuardar"
        />
        <AccionMotivoModal
            v-model:open="desactivarAbierto"
            titulo="Desactivar producto"
            :efecto="`«${aDesactivar?.nombre ?? ''}» deja de ofrecerse en compras, ventas y movimientos. Su kardex se conserva. Solo se puede con existencia 0.`"
            confirmar="Desactivar"
            icono="i-lucide-circle-pause"
            :ejecutar="motivo => desactivar(motivo)"
            @hecho="alDesactivar"
        />
    </PanelPagina>
</template>
