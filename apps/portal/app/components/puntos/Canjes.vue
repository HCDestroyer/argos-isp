<script setup lang="ts">
/** Mis canjes: qué premio, cuándo, cuántos puntos y en qué quedó. */
const { items, cargando, cargado, problema, hayMas, recargar, cargarMas } = useCanjes()

onMounted(recargar)
defineExpose({ recargar })
</script>

<template>
    <CuentaEstadoLista
        :cargando="cargando"
        :cargado="cargado"
        :problema="problema"
        :vacia="items.length === 0"
        :hay-mas="hayMas"
        texto-vacio="No has canjeado premios"
        icono-vacio="i-lucide-gift"
        @reintentar="recargar"
        @cargar-mas="cargarMas"
    >
        <PortalLista :columnas="{ concepto: 'Premio', monto: 'Puntos', estado: 'Estado' }">
            <PortalFila
                v-for="canje in items"
                :key="canje.id"
                :titulo="canje.premio_nombre"
                :subtitulo="`${formatearFecha(canje.created_at)}${canje.descuento ? ` · ${formatearQuetzales(canje.descuento)} de descuento` : ''}`"
                icono="i-lucide-gift"
                :tono="tonoDeColor(ESTADOS_CANJE[canje.estado].color)"
                :monto="puntosEnTexto(canje.puntos)"
                :estado="ESTADOS_CANJE[canje.estado]"
                data-testid="canje"
            />
        </PortalLista>
    </CuentaEstadoLista>
</template>
