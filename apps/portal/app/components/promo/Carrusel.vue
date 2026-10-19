<script setup lang="ts">
import type { Anuncio } from '~/composables/useAnuncios'

/**
 * Carrusel de anuncios (`UCarousel`): deslizar en el teléfono (la siguiente tarjeta asoma por el
 * borde), flechas y puntos desde `sm`. Avanza solo, despacio (8 s), y se detiene mientras se toca,
 * tiene el foco o el ratón encima; el botón de pausa lo detiene del todo (WCAG 2.2.2). Con
 * `prefers-reduced-motion` no avanza solo ni ofrece pausa. Teclado: flechas con el carrusel
 * enfocado (lo da `UCarousel`) y Tab por los botones de cada tarjeta.
 *
 * Emite `vista` con el anuncio a la vista cada vez que cambia, solo mientras el carrusel está en
 * pantalla (`visible`), y `clic` al tocar su botón.
 */
const props = defineProps<{
    anuncios: Anuncio[]
    visible: boolean
}>()

const emit = defineEmits<{
    vista: [anuncio: Anuncio]
    clic: [anuncio: Anuncio]
}>()

const DEMORA_MS = 8_000

const reducido = useMovimientoReducido()
const pausado = ref(false)
const actual = ref(0)

const autoplay = computed(() => reducido.value || pausado.value
    ? false
    : { delay: DEMORA_MS, stopOnInteraction: false, stopOnMouseEnter: true, stopOnFocusIn: true })

function alSeleccionar(indice: number) {
    actual.value = indice
}

watch([actual, () => props.visible, () => props.anuncios], () => {
    const anuncio = props.anuncios[actual.value]
    if (props.visible && anuncio) {
        emit('vista', anuncio)
    }
}, { immediate: true })
</script>

<template>
    <div
        class="flex flex-col gap-2"
        data-testid="promo-carrusel"
    >
        <UCarousel
            v-slot="{ item, index }"
            :items="anuncios"
            :autoplay="autoplay"
            arrows
            dots
            loop
            align="start"
            :prev="{ color: 'neutral', variant: 'soft' }"
            :next="{ color: 'neutral', variant: 'soft' }"
            aria-label="Promociones"
            :ui="{
                root: 'rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary',
                // teléfono: la siguiente tarjeta asoma (invita a deslizar); escritorio: una a la vez, sin bordes cortados
                item: 'basis-[88%] ps-3 sm:basis-full sm:ps-0',
                container: '-ms-3 items-stretch sm:ms-0',
                controls: 'hidden items-center justify-between gap-3 pt-3 sm:flex',
                arrows: 'flex gap-2',
                // 12 px + 12 px de separación: cada punto tiene su zona de 24 px (WCAG 2.5.8)
                dots: 'flex gap-3',
                dot: 'size-3 rounded-full bg-accented data-[state=active]:bg-primary',
            }"
            data-testid="promo-carrusel-ucarousel"
            @select="alSeleccionar"
        >
            <PromoTarjeta
                :anuncio="item"
                :posicion="`${index + 1} de ${anuncios.length}`"
                @clic="emit('clic', item)"
            />
        </UCarousel>

        <div class="flex items-center justify-between gap-3">
            <p
                class="text-xs text-muted tabular-nums sm:hidden"
                aria-hidden="true"
            >
                {{ actual + 1 }} / {{ anuncios.length }}
            </p>
            <UButton
                v-if="!reducido"
                :icon="pausado ? 'i-lucide-play' : 'i-lucide-pause'"
                :label="pausado ? 'Reanudar' : 'Pausar'"
                :aria-pressed="pausado"
                color="neutral"
                variant="ghost"
                size="xs"
                class="ms-auto"
                data-testid="promo-pausa"
                @click="pausado = !pausado"
            />
        </div>
    </div>
</template>
