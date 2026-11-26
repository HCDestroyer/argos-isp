<script lang="ts">
/**
 * Alto de las barras fijas que hay en pantalla (puede haber más de una montada, por ejemplo con una
 * pestaña oculta): el contenido reserva el mayor (`--ax-barra-accion`, `main.css`) para que el último
 * campo o la última fila nunca queden debajo de la barra.
 */
const alturas = new Map<symbol, number>()

function publicarAltura(): void {
    if (typeof document === 'undefined') {
        return
    }
    const mayor = Math.max(0, ...alturas.values())
    if (mayor > 0) {
        document.documentElement.style.setProperty('--ax-barra-accion', `${Math.ceil(mayor)}px`)
    }
    else {
        document.documentElement.style.removeProperty('--ax-barra-accion')
    }
}
</script>

<script setup lang="ts">
/**
 * Acción principal fija de una pantalla en el teléfono (tablero `MarcoMovil`): una isla de vidrio
 * fija abajo, justo encima de la navegación del teléfono (`PanelIslaMovil`), sin taparla ni quedar
 * tapada (`--ax-isla-reserva`). El contenido gana el aire que ocupa la barra (su alto real, que esta
 * barra publica en `--ax-barra-accion`), así que se puede desplazar hasta el final sin que nada
 * quede debajo. Desde `lg` va en su lugar, dentro del flujo. Es el mismo patrón que
 * `PortalBarraAccion` del portal.
 *
 * Casi nunca se usa directo:
 * - la acción principal de una pantalla va en el slot `#accion-principal` de `PanelPagina` o
 *   `ConfiguracionMarco` (en escritorio, junto a las demás acciones del encabezado);
 * - «Descartar / Guardar» de un formulario va en `FormularioAcciones` o en `#pie` de
 *   `ConfiguracionMarco`.
 *
 * `estirar`: el último hijo (la acción primaria) ocupa el ancho que sobra en el teléfono, como
 * «Cobrar Q 300.00» del tablero.
 */
const props = withDefaults(defineProps<{
    estirar?: boolean
}>(), {
    estirar: false,
})

const raiz = useTemplateRef<HTMLElement>('raiz')
const clave = Symbol('barra-accion')
let observador: ResizeObserver | null = null
let consulta: MediaQueryList | null = null

function medir(): void {
    const elemento = raiz.value
    // Solo cuenta mientras es una isla fija (teléfono y tableta); en escritorio va en el flujo.
    const fija = elemento !== null && getComputedStyle(elemento).position === 'fixed'
    alturas.set(clave, fija && elemento ? elemento.getBoundingClientRect().height : 0)
    publicarAltura()
}

onMounted(() => {
    medir()
    if (typeof ResizeObserver !== 'undefined' && raiz.value) {
        observador = new ResizeObserver(medir)
        observador.observe(raiz.value)
    }
    consulta = window.matchMedia('(min-width: 1024px)')
    consulta.addEventListener('change', medir)
})

onBeforeUnmount(() => {
    observador?.disconnect()
    consulta?.removeEventListener('change', medir)
    alturas.delete(clave)
    publicarAltura()
})
</script>

<template>
    <div
        ref="raiz"
        class="panel-barra-accion flex items-center gap-2"
        :class="{ 'panel-barra-accion-estirar': props.estirar }"
        data-prueba="barra-accion"
    >
        <slot />
    </div>
</template>
