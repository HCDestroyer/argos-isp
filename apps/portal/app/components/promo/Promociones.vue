<script lang="ts">
import type { Anuncio, LugarAnuncio } from '~/composables/useAnuncios'
import type { AvisoSorteo } from '~/composables/useAvisosSorteo'

/** Una diapositiva: un anuncio del panel o el aviso de un sorteo próximo. */
export type ItemPromocion = { tipo: 'anuncio', anuncio: Anuncio } | { tipo: 'sorteo', aviso: AvisoSorteo }
</script>

<script setup lang="ts">
/**
 * Promociones de un lugar del portal (`portal_inicio` o `pagina_corte`). Sin anuncios publicados
 * para el cliente no pinta nada: la página queda exactamente como sin esta función. Con uno, su
 * tarjeta; con varios, el carrusel. Mientras carga no reserva espacio (nunca empuja lo de arriba,
 * que es lo que el cliente vino a hacer). Si la lectura falla, un aviso con "Reintentar".
 *
 * Las vistas se cuentan solo cuando la sección está en pantalla (IntersectionObserver, la mitad
 * visible); los clics, al tocar el botón de la tarjeta.
 *
 * Los sorteos próximos que el panel ya abrió al público (`GET /portal/avisos-sorteo`) van en el
 * mismo carrusel, primero (tienen fecha). Si su lectura falla, el carrusel sigue con los anuncios:
 * el aviso de un sorteo no es lo que el cliente vino a hacer.
 */
const props = defineProps<{
    lugar: LugarAnuncio
}>()

const { anuncios, problema, cargar, registrar } = useAnuncios(props.lugar)
const { avisos, cargar: cargarAvisos } = useAvisosSorteo(props.lugar)
const conSesion = computed(() => props.lugar === 'portal_inicio')
const titulo = computed(() => avisos.value.length === 0
    ? 'Promociones'
    : anuncios.value.length > 0 ? 'Promociones y sorteos' : 'Sorteos')

const items = computed<ItemPromocion[]>(() => [
    ...avisos.value.map(aviso => ({ tipo: 'sorteo' as const, aviso })),
    ...anuncios.value.map(anuncio => ({ tipo: 'anuncio' as const, anuncio })),
])

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
onMounted(() => {
    void cargar()
    void cargarAvisos()
})
onBeforeUnmount(() => observador?.disconnect())

const unico = computed(() => items.value.length === 1 ? items.value[0]! : null)

// Una sola tarjeta: cuenta su vista al entrar en pantalla (solo los anuncios llevan métricas).
watch([visible, unico], () => {
    if (visible.value && unico.value?.tipo === 'anuncio') {
        registrar(unico.value.anuncio, 'vista')
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
        v-if="items.length > 0 || problema"
        ref="seccion"
        class="flex flex-col gap-2"
        :aria-labelledby="idTitulo"
        :data-testid="`promociones-${lugar}`"
    >
        <h2
            :id="idTitulo"
            class="text-sm font-semibold text-muted"
        >
            {{ titulo }}
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
        <SorteoAviso
            v-else-if="unico?.tipo === 'sorteo'"
            :aviso="unico.aviso"
            :con-sesion="conSesion"
        />
        <PromoTarjeta
            v-else-if="unico?.tipo === 'anuncio'"
            :anuncio="unico.anuncio"
            @clic="clic(unico.anuncio)"
        />
        <PromoCarrusel
            v-else
            :items="items"
            :visible="visible"
            :con-sesion="conSesion"
            :titulo="titulo"
            @vista="vista"
            @clic="clic"
        />
    </section>
</template>
