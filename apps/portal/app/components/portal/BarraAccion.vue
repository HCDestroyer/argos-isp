<script setup lang="ts">
/**
 * Acción principal de una pantalla (diseño aprobado: «teléfono primero, con la acción principal fija
 * abajo»). En el teléfono (< 768 px) queda fija al pie, de vidrio, encima de la barra de secciones si
 * la hay (`.barra-accion` en `main.css`); desde `md` va en su lugar, dentro del flujo. Puede ir dentro
 * de un `UForm`: el botón sigue siendo del formulario.
 */
</script>

<template>
    <div
        class="barra-accion flex flex-col gap-2"
        data-testid="barra-accion"
    >
        <slot />
    </div>
</template>
