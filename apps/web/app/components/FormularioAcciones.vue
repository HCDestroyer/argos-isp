<template>
    <!--
        Barra de acciones de un formulario en página: Cancelar (secundario) y la acción primaria a la
        derecha, siempre la última. En escritorio, pegada al final mientras se desplaza el formulario;
        en el teléfono, isla fija justo encima de la isla de navegación (`PanelBarraAccion`, tablero
        MarcoMovil), con la primaria a lo ancho, y el contenido reserva su alto para que el último
        campo se pueda alcanzar. Dentro de un panel lateral se pega al final del panel.
    -->
    <PanelBarraAccion
        estirar
        class="lg:sticky lg:bottom-0 lg:z-10 lg:justify-end lg:rounded-b-(--ax-radio) lg:border-t lg:border-(--ax-borde) lg:px-4 lg:py-3 glass-material"
        data-prueba="formulario-acciones"
    >
        <slot />
    </PanelBarraAccion>
</template>
