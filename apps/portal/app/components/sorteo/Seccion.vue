<script setup lang="ts">
/**
 * Sección «Sorteos» de `/cuenta` (`?seccion=sorteos`): los sorteos publicados de las empresas del
 * cliente, con sus boletos, su seudónimo y el resultado. Error con «Reintentar» si no se pueden leer.
 */
const { sorteos, problema, recargar } = useSorteos()
</script>

<template>
    <div
        class="flex flex-col gap-4"
        data-testid="seccion-sorteos"
    >
        <h2 class="text-lg font-semibold text-highlighted">
            Sorteos
        </h2>
        <UAlert
            v-if="problema"
            color="error"
            variant="subtle"
            icon="i-lucide-cloud-off"
            title="No pudimos cargar los sorteos"
            :description="mensajeProblema(problema)"
            :actions="[{ label: 'Reintentar', icon: 'i-lucide-refresh-cw', color: 'error', variant: 'outline', onClick: () => recargar() }]"
            data-testid="sorteos-error"
        />
        <template v-else-if="sorteos">
            <UAlert
                v-if="sorteos.length === 0"
                color="neutral"
                variant="subtle"
                icon="i-lucide-ticket"
                title="No hay sorteos por ahora"
                description="Cuando tu proveedor publique uno, aquí verás los premios y tus boletos."
                data-testid="sin-sorteos"
            />
            <SorteoTarjeta
                v-for="sorteo in sorteos"
                :key="sorteo.id"
                :sorteo="sorteo"
            />
        </template>
        <template v-else>
            <USkeleton class="h-40 w-full" />
            <USkeleton class="h-40 w-full" />
        </template>
    </div>
</template>
