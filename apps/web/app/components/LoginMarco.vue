<script setup lang="ts">
/**
 * Marco de las pantallas sin sesión del panel (tableros OperLogin y OperLoginMovil): fondo con el
 * degradado de marca (o la foto de Configuración › Apariencia), la frase de la marca abajo a la
 * izquierda y la tarjeta a la derecha con el logo, el nombre y el eslogan. En el teléfono, el
 * degradado es una franja arriba y la tarjeta la monta encima.
 */
const props = defineProps<{
    /** Id de la tarjeta, para las pruebas. */
    id: string
}>()

const tema = useTemaApariencia()
const marca = computed(() => tema.publica.value?.nombre_marca ?? 'ArgosIsp')
const eslogan = computed(() => tema.publica.value?.eslogan ?? null)
const logo = computed(() => tema.urlArchivo(tema.publica.value?.logo_login_url ?? null))
const fondo = computed(() => tema.urlArchivo(tema.publica.value?.fondo_login_url ?? null))
const estiloFondo = computed(() => (fondo.value
    ? { backgroundImage: `linear-gradient(rgb(15 23 42 / 0.55), rgb(15 23 42 / 0.65)), url(${fondo.value})` }
    : undefined))
</script>

<template>
    <div class="relative min-h-dvh bg-(--ax-fondo)">
        <div
            class="absolute inset-x-0 top-0 h-48 rounded-b-[2.5rem] bg-cover bg-center lg:inset-0 lg:h-auto lg:rounded-none"
            :class="{ bienvenida: !fondo }"
            :style="estiloFondo"
            aria-hidden="true"
        />
        <div class="absolute top-4 right-4 z-10">
            <UColorModeButton class="boton-flotante boton-circulo" />
        </div>

        <main class="relative grid min-h-dvh lg:grid-cols-[minmax(0,1fr)_minmax(0,28rem)] lg:gap-10 lg:px-16 xl:px-24">
            <section
                class="hidden flex-col justify-end pb-16 text-white lg:flex"
                :aria-label="marca"
            >
                <p class="max-w-lg text-[2.75rem] leading-tight font-bold tracking-[-0.03em]">
                    {{ eslogan ?? 'Todo tu ISP en un solo lugar.' }}
                </p>
                <p class="mt-3 text-lg text-white/85">
                    Clientes, cobros, red e inventario.
                </p>
            </section>

            <div class="flex flex-col items-center justify-start gap-6 px-4 pt-28 pb-10 lg:justify-center lg:px-0 lg:pt-10">
                <div
                    :id="props.id"
                    class="w-full max-w-md rounded-[1.75rem] bg-(--ax-tarjeta) p-6 shadow-(--ax-sombra-flotante) ring ring-(--ax-borde) sm:p-8"
                    :data-prueba="props.id"
                >
                    <div class="mb-6 flex items-center gap-3">
                        <img
                            v-if="logo"
                            :src="logo"
                            alt=""
                            class="h-12 max-w-32 rounded-xl object-contain"
                        >
                        <span
                            v-else
                            class="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-(image:--ax-gradiente) text-white shadow-lg"
                        >
                            <LogoArgos
                                variante="linea"
                                class="size-8"
                            />
                        </span>
                        <div class="flex min-w-0 flex-col">
                            <span class="truncate text-xl font-bold tracking-[-0.02em] text-highlighted">{{ marca }}</span>
                            <span
                                v-if="eslogan"
                                class="truncate text-[0.8125rem] text-muted"
                            >{{ eslogan }}</span>
                        </div>
                    </div>
                    <slot />
                </div>
                <p class="text-center text-xs text-muted lg:text-white/80">
                    <slot name="pie">
                        {{ marca === 'ArgosIsp' ? 'ArgosIsp' : `${marca} · con ArgosIsp` }}
                    </slot>
                </p>
            </div>
        </main>
    </div>
</template>
