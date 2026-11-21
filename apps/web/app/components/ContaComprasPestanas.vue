<script setup lang="ts">
/**
 * Pestañas de «Compras y gastos» (tablero ContaCompras): Compras, Borradores, Proveedores, Pagos,
 * Activos fijos y Diferidos. Cada una es su página y se muestra solo con su permiso; la activa es la
 * de la ruta. Sin contadores: la API no da los totales de cada lista (nunca un número inventado).
 */
const route = useRoute()
const { puede } = usePermisos()

const items = computed<PestanaConta[]>(() => [
    ...(puede('compras.ver') ? [{ label: 'Compras', value: '/compras', icon: 'i-lucide-shopping-cart', to: '/compras' }] : []),
    ...(puede('compras.cargar_borrador') ? [{ label: 'Borradores', value: '/compras/cargar', icon: 'i-lucide-file-up', to: '/compras/cargar' }] : []),
    ...(puede('proveedores.ver') ? [{ label: 'Proveedores', value: '/proveedores', icon: 'i-lucide-truck', to: '/proveedores' }] : []),
    ...(puede('compras.ver') ? [{ label: 'Pagos', value: '/pagos-proveedores', icon: 'i-lucide-banknote', to: '/pagos-proveedores' }] : []),
    ...(puede('activos.ver') ? [{ label: 'Activos fijos', value: '/activos', icon: 'i-lucide-boxes', to: '/activos' }] : []),
    ...(puede('libro.ver') ? [{ label: 'Diferidos', value: '/diferimientos', icon: 'i-lucide-calendar-range', to: '/diferimientos' }] : []),
])
const actual = computed({
    get: () => items.value.find(p => p.value === route.path)?.value ?? '',
    set: () => undefined,
})
</script>

<template>
    <ContaPestanas
        v-model="actual"
        :items="items"
        etiqueta="Compras y gastos"
    />
</template>
