<script setup lang="ts">
/**
 * Dibuja Markdown sin HTML crudo (`markdownSeguro`): todo se interpola como texto, así que una
 * etiqueta `<script>` en el CHANGELOG se ve como texto. Los enlaces solo son http o https.
 */
const props = defineProps<{
    markdown: string | null
}>()

const bloques = computed(() => markdownSeguro(props.markdown))
</script>

<template>
    <div class="flex flex-col gap-3 text-sm text-default">
        <template
            v-for="(bloque, indice) in bloques"
            :key="indice"
        >
            <component
                :is="`h${bloque.nivel + 1}`"
                v-if="bloque.tipo === 'titulo'"
                class="font-semibold text-highlighted"
                :class="bloque.nivel === 2 ? 'text-base' : 'text-sm'"
            >
                <MarkdownLinea :partes="bloque.partes" />
            </component>
            <p v-else-if="bloque.tipo === 'parrafo'">
                <MarkdownLinea :partes="bloque.partes" />
            </p>
            <component
                :is="bloque.ordenada ? 'ol' : 'ul'"
                v-else
                class="flex flex-col gap-1 pl-5"
                :class="bloque.ordenada ? 'list-decimal' : 'list-disc'"
            >
                <li
                    v-for="(elemento, posicion) in bloque.elementos"
                    :key="posicion"
                >
                    <MarkdownLinea :partes="elemento" />
                </li>
            </component>
        </template>
    </div>
</template>
