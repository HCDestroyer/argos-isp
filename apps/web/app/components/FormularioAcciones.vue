<template>
    <!--
        Barra de acciones de un formulario en página: fija abajo mientras se desplaza el formulario,
        con Cancelar (secundario) y la acción primaria a la derecha. En el teléfono se detiene encima de la
        isla de navegación (`--ax-isla-reserva`), nunca debajo.
    -->
    <div class="sticky bottom-(--ax-isla-reserva) z-10 -mx-4 flex flex-col-reverse gap-2 border-t border-(--ax-borde) px-4 py-3 glass-material sm:mx-0 sm:flex-row sm:items-center sm:justify-end sm:rounded-b-(--ax-radio)">
        <slot />
    </div>
</template>
