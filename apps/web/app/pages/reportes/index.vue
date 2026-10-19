<script setup lang="ts">
definePageMeta({ permiso: 'reportes.ver' })

useHead({ title: 'Reportes · ArgosIsp' })

const reportes = CLAVES_REPORTE.map(clave => ({ clave, ...REPORTES[clave] }))
</script>

<template>
    <PanelPagina
        id="reportes"
        titulo="Reportes"
        icono="i-lucide-file-chart-column"
    >
        <div class="flex flex-col gap-4">
            <p class="text-sm text-muted">
                Cada reporte se filtra, muestra sus totales y se descarga en CSV o Excel con los mismos filtros.
            </p>
            <UPageGrid class="gap-4 sm:gap-6 lg:grid-cols-3">
                <UPageCard
                    v-for="reporte in reportes"
                    :key="reporte.clave"
                    :title="reporte.titulo"
                    :description="reporte.descripcion"
                    :icon="reporte.icono"
                    :to="`/reportes/${reporte.clave}`"
                    variant="subtle"
                    :data-prueba="`reporte-${reporte.clave}`"
                />
                <!-- Lealtad (A3): su propio formato, con el pasivo de los puntos contra el libro. -->
                <UPageCard
                    title="Lealtad"
                    description="Puntos emitidos, canjeados y vencidos, y el pasivo de los puntos contra 2.1.10."
                    icon="i-lucide-gem"
                    to="/reportes/lealtad"
                    variant="subtle"
                    data-prueba="reporte-lealtad"
                />
            </UPageGrid>
        </div>
    </PanelPagina>
</template>
