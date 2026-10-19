<script setup lang="ts">
/** Partes en línea de `markdownSeguro` (texto, negrita, cursiva, código y enlaces), como texto. */
defineProps<{
    partes: Linea[]
}>()
</script>

<template>
    <template
        v-for="(parte, indice) in partes"
        :key="indice"
    >
        <strong
            v-if="parte.tipo === 'negrita'"
            class="font-semibold text-highlighted"
        >{{ parte.texto }}</strong>
        <em v-else-if="parte.tipo === 'cursiva'">{{ parte.texto }}</em>
        <code
            v-else-if="parte.tipo === 'codigo'"
            class="rounded bg-elevated px-1 py-0.5 font-mono text-xs"
        >{{ parte.texto }}</code>
        <ULink
            v-else-if="parte.tipo === 'enlace'"
            :to="parte.url"
            target="_blank"
            rel="noopener noreferrer"
            class="text-primary underline"
        >{{ parte.texto }}</ULink>
        <span v-else>{{ parte.texto }}</span>
    </template>
</template>
