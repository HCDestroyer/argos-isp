<script setup lang="ts">
definePageMeta({ permiso: 'libro.ver' })

useHead({ title: 'Balance general · ArgosIsp' })

/**
 * Balance general en el catálogo de reportes (rediseño: tablero ContaReportes, categoría «Contabilidad»). Antes
 * era una pestaña del libro; el libro del tablero ContaLibro solo lleva diario, mayor, auxiliar y
 * plan de cuentas. Los totales y el «cuadra» vienen de la API (`LibroEstadoFinanciero`).
 */
</script>

<template>
    <PanelPagina
        id="reporte-balance"
        titulo="Balance general"
        icono="i-lucide-scale"
        descripcion="Lo que tiene, lo que debe y el capital de cada empresa a una fecha (balance de saldos)."
    >
        <template #acciones>
            <ContaSelectorEmpresa />
        </template>

        <ContaCuerpo libre>
            <section class="surface-card flex min-w-0 flex-col gap-4 rounded-[1.375rem] p-4 sm:p-5">
                <LibroEstadoFinanciero tipo="balance" />
            </section>
        </ContaCuerpo>
    </PanelPagina>
</template>
