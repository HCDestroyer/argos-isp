<script setup lang="ts">
/**
 * Teléfono (390 px): la acción principal fija abajo, a todo el ancho (sistema visual, tableros
 * RedRoutersMovil, RedRouterFichaMovil, RedSesionesMovil y OperServicioFichaMovil). Deja un espacio
 * al final del contenido para que la barra no tape la última fila. Desde `sm` no se muestra.
 */
</script>

<template>
    <div
        class="h-20 sm:hidden"
        aria-hidden="true"
    />
    <div
        class="fixed inset-x-0 bottom-0 z-20 flex gap-2 border-t border-(--ax-borde) bg-(--ax-tarjeta) p-3 sm:hidden"
        data-prueba="barra-telefono"
    >
        <slot />
    </div>
</template>
