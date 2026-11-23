<script setup lang="ts">
/**
 * Teléfono (390 px): la acción principal fija abajo (sistema visual, tableros RedRoutersMovil,
 * RedRouterFichaMovil, RedSesionesMovil y OperServicioFichaMovil). Va como `PanelBarraAccion`: otra
 * isla justo encima de la navegación del teléfono (tablero MarcoMovil), sin taparla ni quedar
 * tapada; el contenido gana el aire de la barra. Desde `sm` no se muestra.
 */
</script>

<template>
    <PanelBarraAccion
        class="sm:hidden"
        data-prueba="barra-telefono"
    >
        <slot />
    </PanelBarraAccion>
</template>
