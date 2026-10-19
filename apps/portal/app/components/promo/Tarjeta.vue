<script setup lang="ts">
import type { Anuncio } from '~/composables/useAnuncios'

/**
 * Un anuncio: imagen opcional (tamaño fijo y `loading="lazy"`: no mueve la página al cargar),
 * título, texto plano y botón. El texto se pinta como texto (Vue lo escapa): nunca HTML.
 */
const props = defineProps<{
    anuncio: Anuncio
    /** "2 de 3": para lectores de pantalla dentro del carrusel */
    posicion?: string
}>()

const emit = defineEmits<{
    clic: []
}>()

/** Un enlace `http(s)://` sale del portal (pestaña nueva); una ruta `/…` es del portal. */
const externo = computed(() => /^https?:\/\//i.test(props.anuncio.boton?.url ?? ''))
const etiqueta = computed(() => props.posicion ? `${props.posicion}: ${props.anuncio.titulo}` : props.anuncio.titulo)
</script>

<template>
    <UCard
        as="article"
        class="h-full overflow-hidden"
        :ui="{ body: 'flex h-full flex-col p-0 sm:p-0' }"
        :aria-label="etiqueta"
        data-testid="promo-tarjeta"
    >
        <img
            v-if="anuncio.imagen"
            :src="anuncio.imagen.url"
            :alt="anuncio.imagen.alt"
            :width="anuncio.imagen.ancho"
            :height="anuncio.imagen.alto"
            loading="lazy"
            decoding="async"
            class="aspect-2/1 w-full bg-elevated object-cover"
            data-testid="promo-imagen"
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
                {{ anuncio.titulo }}
            </h3>
            <p
                v-if="anuncio.texto"
                class="text-sm whitespace-pre-line text-muted"
            >
                {{ anuncio.texto }}
            </p>
            <UButton
                v-if="anuncio.boton"
                :label="anuncio.boton.texto"
                :to="anuncio.boton.url"
                :target="externo ? '_blank' : undefined"
                :external="externo"
                :trailing-icon="externo ? 'i-lucide-external-link' : 'i-lucide-arrow-right'"
                color="primary"
                variant="soft"
                class="mt-auto self-start"
                data-testid="promo-boton"
                @click="emit('clic')"
            />
        </div>
    </UCard>
</template>
