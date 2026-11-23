<script setup lang="ts">
definePageMeta({ permiso: 'libro.ver' })

useHead({ title: 'Estado de resultados · ArgosIsp' })

/**
 * Estado de resultados en el catálogo de reportes (rediseño: tablero ContaReportes, categoría «Contabilidad»). Antes
 * era una pestaña del libro; el libro del tablero ContaLibro solo lleva diario, mayor, auxiliar y
 * plan de cuentas. Los totales y el «cuadra» vienen de la API (`LibroEstadoFinanciero`).
 */
</script>

<template>
    <PanelPagina
        id="reporte-resultados"
        titulo="Estado de resultados"
        icono="i-lucide-trending-up"
        descripcion="Ingresos, gastos y la ganancia o pérdida del periodo."
    >
        <template #acciones>
            <ContaSelectorEmpresa />
        </template>

        <ContaCuerpo libre>
            <section class="surface-card flex min-w-0 flex-col gap-4 rounded-[1.375rem] p-4 sm:p-5">
                <LibroEstadoFinanciero tipo="resultados" />
            </section>
        </ContaCuerpo>
    </PanelPagina>
</template>
