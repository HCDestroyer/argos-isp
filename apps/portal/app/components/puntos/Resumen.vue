<script setup lang="ts">
/**
 * Atajo del inicio a «Puntos»: el saldo (y lo que vence pronto) con un enlace a los premios. Solo
 * con el programa visible en el portal; si los puntos no se pudieron leer, no se muestra nada aquí
 * (la sección «Puntos» tiene su error con «Reintentar»).
 */
const { empresas } = usePuntos()
</script>

<template>
    <div
        v-if="empresas && empresas.length > 0"
        class="flex flex-col gap-2"
    >
        <UButton
            v-for="puntos in empresas"
            :key="puntos.empresa.id"
            to="/cuenta?seccion=puntos"
            color="neutral"
            variant="outline"
            size="xl"
            block
            trailing-icon="i-lucide-chevron-right"
            :ui="{ base: 'justify-between text-start', trailingIcon: 'text-muted' }"
            data-testid="resumen-puntos"
        >
            <span class="flex min-w-0 items-center gap-3">
                <UIcon
                    name="i-lucide-sparkles"
                    class="size-6 shrink-0 text-primary"
                />
                <span class="min-w-0">
                    <span class="block font-semibold tabular-nums text-highlighted">
                        {{ puntosEnTexto(puntos.saldo) }}<template v-if="empresas.length > 1">
                            con {{ puntos.empresa.nombre_comercial }}
                        </template>
                    </span>
                    <span class="block text-sm font-normal text-muted">
                        {{ puntos.por_vencer > 0 ? `${puntosEnTexto(puntos.por_vencer)} vencen pronto · Ver premios` : 'Ver premios para canjear' }}
                    </span>
                </span>
            </span>
        </UButton>
    </div>
</template>
