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
            class="fondo-login absolute inset-x-0 top-0 h-48 rounded-b-[2rem] bg-cover bg-center lg:inset-0 lg:h-auto lg:rounded-none"
            :style="estiloFondo"
            aria-hidden="true"
        />
        <div class="absolute top-4 right-4 z-10">
            <UColorModeButton
                color="neutral"
                variant="soft"
                class="rounded-full bg-white/80 dark:bg-black/40"
            />
        </div>

        <main class="relative grid min-h-dvh lg:grid-cols-[minmax(0,1fr)_minmax(0,30rem)] lg:gap-10 lg:px-16 lg:py-14">
            <section
                class="hidden flex-col justify-end text-white lg:flex"
                :aria-label="marca"
            >
                <p class="max-w-lg text-5xl leading-tight font-bold tracking-[-0.02em]">
                    {{ eslogan ?? 'Todo tu ISP en un solo lugar.' }}
                </p>
                <p class="mt-3 text-lg text-white/90">
                    Clientes, cobros, red e inventario.
                </p>
            </section>

            <div class="flex flex-col justify-center gap-4 px-4 pt-20 pb-10 lg:px-0 lg:py-0">
                <div
                    :id="props.id"
                    class="tarjeta-login w-full rounded-[1.375rem] border border-(--ax-borde) bg-(--ax-tarjeta) p-5 sm:p-8"
                >
                    <div class="mb-5 flex items-center gap-3">
                        <img
                            v-if="logo"
                            :src="logo"
                            alt=""
                            class="h-12 max-w-36 object-contain"
                        >
                        <LogoArgos
                            v-else
                            class="size-12 shrink-0"
                        />
                        <div class="flex min-w-0 flex-col">
                            <span class="truncate text-xl font-bold tracking-[-0.02em] text-highlighted">{{ marca }}</span>
                            <span
                                v-if="eslogan"
                                class="truncate text-sm text-muted"
                            >{{ eslogan }}</span>
                        </div>
                    </div>
                    <slot />
                </div>
                <p class="text-center text-xs text-muted lg:text-white/80">
                    <slot name="pie">
                        Panel de administración
                    </slot>
                </p>
            </div>
        </main>
    </div>
</template>

<style scoped>
.fondo-login {
    background-color: var(--argos-marca-1);
    background-image:
        radial-gradient(40rem 30rem at 15% 20%, rgb(6 182 212 / 0.45), transparent 70%),
        radial-gradient(40rem 30rem at 90% 90%, rgb(6 182 212 / 0.35), transparent 70%),
        linear-gradient(135deg, #3730a3 0%, #4f46e5 55%, #4338ca 100%);
}

.tarjeta-login {
    box-shadow: var(--ax-sombra-flotante);
}
</style>
