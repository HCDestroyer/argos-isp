<script setup lang="ts">
definePageMeta({ permiso: 'libro.ver' })

useHead({ title: 'Integridad del libro · ArgosIsp' })

/**
 * Integridad de la cadena del libro (antes una pestaña del libro; en el rediseño se llega desde el
 * pie del diario y desde el aviso del panel financiero): cada asiento lleva un sello encadenado y
 * aquí se recalcula. Es una lectura (`LibroIntegridad`).
 */
</script>

<template>
    <PanelPagina
        id="integridad-libro"
        titulo="Integridad del libro"
        icono="i-lucide-shield-check"
        descripcion="Cada asiento lleva un sello encadenado al anterior: si alguien cambiara un dato, la cadena se rompe y se ve aquí."
    >
        <template #acciones>
            <ContaSelectorEmpresa />
        </template>

        <ContaCuerpo libre>
            <section class="surface-card flex min-w-0 flex-col gap-4 rounded-[1.375rem] p-4 sm:p-5">
                <LibroIntegridad />
            </section>
        </ContaCuerpo>
    </PanelPagina>
</template>
