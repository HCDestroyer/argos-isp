<script setup lang="ts">
/**
 * Acciones del encabezado de «Compras y gastos» (tablero ContaCompras), las mismas en cada pestaña:
 * la empresa, «Pagar a proveedor», «Registrar a mano» y la principal, «Cargar factura».
 */
const { puede } = usePermisos()
</script>

<template>
    <ContaSelectorEmpresa />
    <UButton
        v-if="puede('compras.registrar')"
        to="/pagos-proveedores"
        label="Pagar a proveedor"
        icon="i-lucide-landmark"
        color="neutral"
        variant="ghost"
        class="boton-flotante boton-pastilla max-sm:hidden"
    />
    <UButton
        v-if="puede('compras.registrar')"
        to="/compras/nueva"
        label="Registrar a mano"
        icon="i-lucide-plus"
        color="neutral"
        variant="ghost"
        class="boton-flotante boton-pastilla"
        data-prueba="registrar-compra"
    />
    <UButton
        v-if="puede('compras.cargar_borrador')"
        to="/compras/cargar"
        label="Cargar factura"
        icon="i-lucide-upload"
        size="lg"
        class="glow-brand rounded-full px-5"
        data-prueba="cargar-factura"
    />
</template>
