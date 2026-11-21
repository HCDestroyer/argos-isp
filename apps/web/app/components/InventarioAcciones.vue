<script setup lang="ts">
import type { DropdownMenuItem } from '@nuxt/ui'

/**
 * Acciones del encabezado de Inventario (tablero NuevoInventario): «Registrar compra» y «Trasladar»
 * como botones flotantes y «Nuevo producto» como la acción principal. Las operaciones a mano (saldo
 * inicial, consumo, traslado directo, ajuste y baja) van en «Más», cada una con su permiso, y abren
 * su ventana corta. `abrir()` la usa la fila de existencias con el producto y la bodega elegidos.
 */
const emit = defineEmits<{ hecho: [operacion: OperacionInventario] }>()

const { puede } = usePermisos()
const toast = useToast()

const operaciones = computed(() => (Object.keys(OPERACIONES_INVENTARIO) as OperacionInventario[]).filter(o => puede(OPERACIONES_INVENTARIO[o].permiso)))
const operacion = ref<OperacionInventario>('consumo')
const abierta = ref(false)
const elegida = shallowRef<{ productoId: number | null, bodegaId: number | null }>({ productoId: null, bodegaId: null })
const productos = shallowRef<Producto[]>([])
const bodegas = shallowRef<Bodega[]>([])

async function cargarCatalogos() {
    if (productos.value.length && bodegas.value.length) {
        return
    }
    const [p, b] = await Promise.all([useProductos().activos(), useBodegas().activas()])
    productos.value = p.ok ? p.data : []
    bodegas.value = b.ok ? b.data : []
}

async function abrir(o: OperacionInventario, productoId: number | null = null, bodegaId: number | null = null) {
    await cargarCatalogos()
    operacion.value = o
    elegida.value = { productoId, bodegaId }
    abierta.value = true
}

defineExpose({ abrir, operaciones })

const mas = computed<DropdownMenuItem[][]>(() => [
    [{ type: 'label', label: 'Registrar a mano' }, ...operaciones.value.map(o => ({ label: OPERACIONES_INVENTARIO[o].etiqueta, icon: OPERACIONES_INVENTARIO[o].icono, onSelect: () => void abrir(o) }))],
    [
        { label: 'Bodegas y traslados', icon: 'i-lucide-warehouse', to: '/inventario/bodegas' },
        { label: 'Conteos físicos', icon: 'i-lucide-clipboard-list', to: '/inventario/conteos' },
        { label: 'Inventario valorizado', icon: 'i-lucide-scale', to: '/inventario/valorizado' },
    ],
])

function alHacer(o: OperacionInventario) {
    toast.add({ title: `${OPERACIONES_INVENTARIO[o].etiqueta} registrado`, icon: 'i-lucide-circle-check', color: 'success' })
    emit('hecho', o)
}
</script>

<template>
    <div class="flex flex-wrap items-center gap-2">
        <UButton
            v-if="puede('compras.registrar')"
            to="/compras/nueva"
            icon="i-lucide-receipt"
            label="Registrar compra"
            color="neutral"
            variant="outline"
            class="boton-flotante rounded-full"
            :ui="{ label: 'hidden sm:inline' }"
            aria-label="Registrar compra"
        />
        <UButton
            v-if="puede('inventario.crear_traslado')"
            to="/inventario/traslados/nueva"
            icon="i-lucide-truck"
            label="Trasladar"
            color="neutral"
            variant="outline"
            class="boton-flotante rounded-full"
            :ui="{ label: 'hidden sm:inline' }"
            aria-label="Trasladar"
        />
        <UDropdownMenu
            v-if="operaciones.length"
            :items="mas"
            :content="{ align: 'end' }"
        >
            <UButton
                icon="i-lucide-ellipsis"
                color="neutral"
                variant="outline"
                class="boton-flotante rounded-full"
                aria-label="Más acciones de inventario"
                data-prueba="inventario-registrar"
            />
        </UDropdownMenu>
        <UButton
            v-if="puede('productos.crear')"
            to="/inventario/productos?nuevo=1"
            icon="i-lucide-plus"
            label="Nuevo producto"
            size="lg"
            class="glow-brand rounded-full px-5"
            data-prueba="inventario-nuevo-producto"
        />
        <MovimientoInventarioModal
            v-model:open="abierta"
            :operacion="operacion"
            :productos="productos"
            :bodegas="bodegas"
            :producto-id="elegida.productoId"
            :bodega-id="elegida.bodegaId"
            @hecho="alHacer"
        />
    </div>
</template>
