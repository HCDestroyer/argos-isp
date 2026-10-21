<script setup lang="ts">
/** Premios de un sorteo en tarjetas con su imagen, del primero al último. */
const props = defineProps<{
    premios: Array<{ posicion: number, nombre: string, cantidad: number, imagen_url: string | null, valor: string }>
    /** Valor de cada premio (la página pública lo muestra; la cuenta no hace falta). */
    conValor?: boolean
}>()
</script>

<template>
    <ul
        class="grid grid-cols-2 gap-3 sm:grid-cols-3"
        data-testid="premios-sorteo"
    >
        <li
            v-for="premio in props.premios"
            :key="premio.posicion"
            class="flex flex-col gap-2"
            data-testid="premio-sorteo"
        >
            <SorteoImagenPremio
                :url="premio.imagen_url"
                :nombre="premio.nombre"
            />
            <div>
                <p class="text-xs font-medium text-primary">
                    {{ premio.posicion }}.º premio<template v-if="premio.cantidad > 1">
                        · {{ premio.cantidad }} ganadores
                    </template>
                </p>
                <p class="text-sm font-medium text-highlighted">
                    {{ premio.nombre }}
                </p>
                <p
                    v-if="props.conValor"
                    class="text-xs text-muted tabular-nums"
                >
                    Valor {{ formatearQuetzales(premio.valor) }}
                </p>
            </div>
        </li>
    </ul>
</template>
