<script setup lang="ts">
/**
 * Acción principal fija de una pantalla en el teléfono («Cobrar Q …» en la ficha del cliente):
 * una isla de vidrio fija abajo, justo encima de la navegación del teléfono (`PanelIslaMovil`), sin
 * taparla ni quedar tapada (`--ax-isla-reserva`). El contenido gana el aire que ocupa la barra
 * (`.panel-cuerpo:has(.panel-barra-accion)` en `main.css`). Desde `lg` va en su lugar, dentro del
 * flujo; la pantalla decide si en escritorio se muestra (por ejemplo, con `sm:hidden`). Es el mismo
 * patrón que `PortalBarraAccion` del portal.
 */
</script>

<template>
    <div
        class="panel-barra-accion flex items-center gap-2"
        data-prueba="barra-accion"
    >
        <slot />
    </div>
</template>
