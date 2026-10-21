<script setup lang="ts">
import type { Anuncio } from '~/composables/useAnuncios'
import type { ItemPromocion } from '~/components/promo/Promociones.vue'

/**
 * Carrusel de anuncios y avisos de sorteo (`UCarousel`): deslizar en el teléfono (la siguiente tarjeta asoma por el
 * borde), flechas y puntos desde `sm`. Avanza solo, despacio (8 s), y se detiene mientras se toca,
 * tiene el foco o el ratón encima; el botón de pausa lo detiene del todo (WCAG 2.2.2). Con
 * `prefers-reduced-motion` no avanza solo ni ofrece pausa. Teclado: flechas con el carrusel
 * enfocado (lo da `UCarousel`) y Tab por los botones de cada tarjeta.
 *
 * Emite `vista` con el anuncio a la vista cada vez que cambia, solo mientras el carrusel está en
 * pantalla (`visible`), y `clic` al tocar su botón. Los avisos de sorteo no cuentan métricas.
 */
const props = defineProps<{
    items: ItemPromocion[]
    visible: boolean
    conSesion?: boolean
    /** Nombre del carrusel para lectores de pantalla (el mismo título de la sección). */
    titulo?: string
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

watch([actual, () => props.visible, () => props.items], () => {
    const item = props.items[actual.value]
    if (props.visible && item?.tipo === 'anuncio') {
        emit('vista', item.anuncio)
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
            :items="items"
            :autoplay="autoplay"
            arrows
            dots
            loop
            align="start"
            :prev="{ color: 'neutral', variant: 'soft' }"
            :next="{ color: 'neutral', variant: 'soft' }"
            :aria-label="titulo ?? 'Promociones'"
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
            <SorteoAviso
                v-if="item.tipo === 'sorteo'"
                :aviso="item.aviso"
                :posicion="`${index + 1} de ${items.length}`"
                :con-sesion="conSesion"
            />
            <PromoTarjeta
                v-else
                :anuncio="item.anuncio"
                :posicion="`${index + 1} de ${items.length}`"
                @clic="emit('clic', item.anuncio)"
            />
        </UCarousel>

        <div class="flex items-center justify-between gap-3">
            <p
                class="text-xs text-muted tabular-nums sm:hidden"
                aria-hidden="true"
            >
                {{ actual + 1 }} / {{ items.length }}
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
