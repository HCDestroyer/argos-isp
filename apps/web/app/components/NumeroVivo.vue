<script setup lang="ts">
/**
 * Número vivo de la identidad: cada dígito rueda hasta su valor nuevo (0,7 s, sin rebote) solo
 * cuando el dato cambia, y el valor que cambió destella (solo en oscuro). El dígito real queda
 * como texto (lectores de pantalla, copiar, pruebas); la tira 0–9 es un pseudoelemento
 * (`.roll-digit` en main.css). Con `prefers-reduced-motion` cambia sin rodar.
 * Recibe el texto ya formateado (`Q 98,450.00`, `412`); los demás caracteres no ruedan.
 */
const props = defineProps<{
    valor: string
}>()

/** Caracteres con clave desde la derecha: las unidades siguen siendo unidades si crece el número. */
const caracteres = computed(() => {
    const lista = [...props.valor]
    return lista.map((c, i) => ({ c, clave: lista.length - i, digito: /\d/.test(c) }))
})

/** Alterna ping-a / ping-b en cada cambio para reiniciar el destello. */
const destello = ref<'ping-a' | 'ping-b' | null>(null)
watch(() => props.valor, (nuevo, anterior) => {
    if (nuevo !== anterior) {
        destello.value = destello.value === 'ping-a' ? 'ping-b' : 'ping-a'
    }
})
</script>

<template>
    <span
        class="inline-block whitespace-nowrap leading-none tabular-nums"
        :class="destello"
        data-numero-vivo
    >
        <template
            v-for="caracter in caracteres"
            :key="caracter.clave"
        >
            <span
                v-if="caracter.digito"
                class="roll-digit"
                :data-d="caracter.c"
            >{{ caracter.c }}</span>
            <template v-else>{{ caracter.c }}</template>
        </template>
    </span>
</template>
