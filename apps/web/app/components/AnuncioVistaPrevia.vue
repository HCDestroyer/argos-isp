<script setup lang="ts">
/**
 * Cómo se ve el anuncio en el portal, en un teléfono: la tarjeta va al final del inicio del portal
 * o debajo de pagar en la página de corte (`contratos/anuncios.md` §4), nunca encima ni en un modal.
 */
defineProps<{
    titulo: string
    texto: string
    boton: { texto: string, url: string } | null
    imagen: { url: string, alt: string, ancho?: number, alto?: number } | null
    lugares: LugarAnuncio[]
}>()
</script>

<template>
    <figure
        class="flex flex-col items-center gap-2"
        data-prueba="anuncio-vista-previa"
    >
        <div class="w-full max-w-[22rem] rounded-[2rem] bg-elevated p-3 ring ring-default">
            <div class="flex flex-col gap-3 rounded-[1.5rem] bg-default p-3">
                <div
                    class="flex items-center gap-2 text-xs text-dimmed"
                    aria-hidden="true"
                >
                    <UIcon
                        name="i-lucide-smartphone"
                        class="size-3.5"
                    />
                    <span>…después de {{ lugares.includes('pagina_corte') && !lugares.includes('portal_inicio') ? 'pagar y los accesos' : 'tus servicios' }}</span>
                </div>
                <AnuncioTarjeta
                    :titulo="titulo"
                    :texto="texto"
                    :boton="boton"
                    :imagen="imagen"
                />
            </div>
        </div>
        <figcaption class="flex flex-wrap items-center justify-center gap-1.5 text-xs text-muted">
            Vista previa en el teléfono ·
            <UBadge
                v-for="lugar in lugares"
                :key="lugar"
                :label="LUGARES_ANUNCIO[lugar].etiqueta"
                :icon="LUGARES_ANUNCIO[lugar].icono"
                color="neutral"
                variant="outline"
                size="sm"
            />
        </figcaption>
    </figure>
</template>
