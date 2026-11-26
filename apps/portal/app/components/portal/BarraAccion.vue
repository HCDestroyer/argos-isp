<script setup lang="ts">
/**
 * Acción principal de una pantalla (diseño aprobado: «teléfono primero, con la acción principal fija
 * abajo»). En el teléfono (< 768 px) queda fija al pie, de vidrio, encima de la barra de secciones si
 * la hay (`.barra-accion` en `main.css`); desde `md` va en su lugar, dentro del flujo. Puede ir dentro
 * de un `UForm`: el botón sigue siendo del formulario.
 */

const barra = useTemplateRef<HTMLElement>('barra')
let observador: ResizeObserver | undefined

/**
 * El alto de la barra depende de su contenido (botones, textos, avisos), así que el aire al final
 * de la página no puede ser una cifra fija: la barra publica su alto real en `--ax-barra-alto`
 * (en `<html>`) y `main.css` lo reserva debajo del pie.
 */
function publicar(): void {
    const alto = barra.value?.offsetHeight ?? 0
    document.documentElement.style.setProperty('--ax-barra-alto', `${alto}px`)
}

onMounted(() => {
    publicar()
    if (barra.value && typeof ResizeObserver !== 'undefined') {
        observador = new ResizeObserver(publicar)
        observador.observe(barra.value)
    }
})

onBeforeUnmount(() => {
    observador?.disconnect()
    document.documentElement.style.removeProperty('--ax-barra-alto')
})
</script>

<template>
    <div
        ref="barra"
        class="barra-accion flex flex-col gap-2"
        data-testid="barra-accion"
    >
        <slot />
    </div>
</template>
