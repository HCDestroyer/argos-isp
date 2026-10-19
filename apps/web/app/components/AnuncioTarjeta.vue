<script setup lang="ts">
/**
 * Vista previa de la tarjeta del portal (`apps/portal/.../promo/Tarjeta.vue`, A5): imagen 2:1
 * opcional, «Promoción», título, texto plano (con sus saltos de línea, nunca HTML) y botón. Aquí el
 * botón no navega: solo muestra el texto y a dónde lleva.
 */
const props = defineProps<{
    titulo: string
    texto: string
    boton: { texto: string, url: string } | null
    /** URL de objeto de la imagen (o de la vista previa local) y su texto alternativo. */
    imagen: { url: string, alt: string, ancho?: number, alto?: number } | null
}>()

const externo = computed(() => /^https?:\/\//i.test(props.boton?.url ?? ''))
</script>

<template>
    <UCard
        as="article"
        class="h-full overflow-hidden"
        :ui="{ body: 'flex h-full flex-col p-0 sm:p-0' }"
        :aria-label="`Vista previa: ${titulo || 'sin título'}`"
        data-prueba="anuncio-tarjeta"
    >
        <img
            v-if="imagen"
            :src="imagen.url"
            :alt="imagen.alt"
            :width="imagen.ancho ?? 1200"
            :height="imagen.alto ?? 600"
            class="aspect-2/1 w-full bg-elevated object-cover"
            data-prueba="anuncio-tarjeta-imagen"
        >
        <div class="flex flex-1 flex-col gap-2 p-4">
            <p class="flex items-center gap-1.5 text-xs font-medium text-primary">
                <UIcon
                    name="i-lucide-sparkles"
                    class="size-3.5 shrink-0"
                />
                Promoción
            </p>
            <h3 class="text-base font-semibold text-balance text-highlighted">
                {{ titulo || 'Sin título' }}
            </h3>
            <p
                v-if="texto"
                class="text-sm whitespace-pre-line text-muted"
                data-prueba="anuncio-tarjeta-texto"
            >
                {{ texto }}
            </p>
            <div
                v-if="boton"
                class="mt-auto flex flex-col items-start gap-1"
            >
                <UBadge
                    :label="boton.texto"
                    :trailing-icon="externo ? 'i-lucide-external-link' : 'i-lucide-arrow-right'"
                    color="primary"
                    variant="soft"
                    size="lg"
                    data-prueba="anuncio-tarjeta-boton"
                />
                <span class="break-all text-xs text-dimmed">{{ externo ? 'Abre en otra pestaña: ' : 'Lleva a ' }}{{ boton.url }}</span>
            </div>
        </div>
    </UCard>
</template>
