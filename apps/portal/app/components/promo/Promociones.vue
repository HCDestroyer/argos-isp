<script setup lang="ts">
import type { Anuncio, LugarAnuncio } from '~/composables/useAnuncios'

/**
 * Promociones de un lugar del portal (`portal_inicio` o `pagina_corte`). Sin anuncios publicados
 * para el cliente no pinta nada: la página queda exactamente como sin esta función. Con uno, su
 * tarjeta; con varios, el carrusel. Mientras carga no reserva espacio (nunca empuja lo de arriba,
 * que es lo que el cliente vino a hacer). Si la lectura falla, un aviso con "Reintentar".
 *
 * Las vistas se cuentan solo cuando la sección está en pantalla (IntersectionObserver, la mitad
 * visible); los clics, al tocar el botón de la tarjeta.
 */
const props = defineProps<{
    lugar: LugarAnuncio
}>()

const { anuncios, problema, cargar, registrar } = useAnuncios(props.lugar)

const seccion = ref<HTMLElement | null>(null)
const visible = ref(false)
let observador: IntersectionObserver | null = null

function observar(elemento: HTMLElement | null) {
    observador?.disconnect()
    observador = null
    if (!elemento) {
        return
    }
    if (typeof IntersectionObserver === 'undefined') {
        visible.value = true
        return
    }
    observador = new IntersectionObserver((entradas) => {
        visible.value = entradas.some(entrada => entrada.isIntersecting)
    }, { threshold: 0.5 })
    observador.observe(elemento)
}

watch(seccion, observar)
onMounted(cargar)
onBeforeUnmount(() => observador?.disconnect())

const unico = computed(() => anuncios.value.length === 1 ? anuncios.value[0]! : null)

// Una sola tarjeta: cuenta su vista al entrar en pantalla.
watch([visible, unico], () => {
    if (visible.value && unico.value) {
        registrar(unico.value, 'vista')
    }
})

function vista(anuncio: Anuncio) {
    registrar(anuncio, 'vista')
}

function clic(anuncio: Anuncio) {
    registrar(anuncio, 'clic')
}

const idTitulo = `promociones-${props.lugar}`
</script>

<template>
    <section
        v-if="anuncios.length > 0 || problema"
        ref="seccion"
        class="flex flex-col gap-2"
        :aria-labelledby="idTitulo"
        :data-testid="`promociones-${lugar}`"
    >
        <h2
            :id="idTitulo"
            class="text-sm font-semibold text-muted"
        >
            Promociones
        </h2>
        <UAlert
            v-if="problema"
            color="neutral"
            variant="subtle"
            icon="i-lucide-cloud-off"
            title="No pudimos cargar las promociones"
            :description="mensajeProblema(problema)"
            :actions="[{ label: 'Reintentar', icon: 'i-lucide-refresh-cw', color: 'neutral', variant: 'outline', onClick: () => cargar() }]"
            data-testid="promociones-error"
        />
        <PromoTarjeta
            v-else-if="unico"
            :anuncio="unico"
            @clic="clic(unico)"
        />
        <PromoCarrusel
            v-else
            :anuncios="anuncios"
            :visible="visible"
            @vista="vista"
            @clic="clic"
        />
    </section>
</template>
