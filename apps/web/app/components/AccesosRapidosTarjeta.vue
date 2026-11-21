<script setup lang="ts">
/**
 * Accesos rápidos en el inicio: los mismos de la barra superior, agrupados por área, con su atajo
 * (Alt+N) y «Personalizar mis accesos».
 */
const { porArea, problema, cargar } = useAccesosRapidos()
const personalizando = ref(false)
</script>

<template>
    <section
        class="flex min-w-0 flex-col gap-3 surface-card p-4 sm:p-5"
        aria-labelledby="titulo-accesos"
        data-prueba="accesos"
    >
        <header class="flex items-center justify-between gap-2">
            <h3
                id="titulo-accesos"
                class="flex items-center gap-2 text-sm font-semibold text-highlighted"
            >
                <UIcon
                    name="i-lucide-zap"
                    class="size-4 text-primary"
                />
                Accesos rápidos
            </h3>
            <UButton
                label="Personalizar"
                icon="i-lucide-sliders-horizontal"
                color="neutral"
                variant="ghost"
                size="sm"
                @click="personalizando = true"
            />
        </header>
        <ProblemaAlerta
            v-if="problema"
            :problema="problema"
            :reintentar="cargar"
        />
        <template v-else>
            <nav
                v-for="area in porArea"
                :key="area.etiqueta"
                class="flex flex-col gap-0.5"
                :aria-label="area.etiqueta"
            >
                <p class="px-1 text-[0.6875rem] font-bold tracking-[0.06em] text-dimmed uppercase">
                    {{ area.etiqueta }}
                </p>
                <ULink
                    v-for="{ seccion, numero } in area.secciones"
                    :key="seccion.id"
                    :to="seccion.ruta"
                    :title="seccion.descripcion"
                    class="flex items-center gap-3 rounded-lg px-1.5 py-1.5 text-sm text-default transition-colors hover:bg-(--ax-fila-hover) hover:text-primary"
                >
                    <span class="pastilla-icono tono-marca pastilla-tono size-8">
                        <UIcon
                            :name="seccion.icono"
                            class="size-4"
                        />
                    </span>
                    <span class="flex-1 truncate font-medium">{{ seccion.etiqueta }}</span>
                    <span
                        v-if="numero <= 9"
                        class="hidden gap-0.5 lg:flex"
                    >
                        <UKbd
                            value="Alt"
                            size="sm"
                        />
                        <UKbd
                            :value="String(numero)"
                            size="sm"
                        />
                    </span>
                </ULink>
            </nav>
            <p
                v-if="!porArea.length"
                class="text-sm text-muted"
            >
                No tienes accesos rápidos. Elige los tuyos con «Personalizar».
            </p>
        </template>
        <AccesosRapidosEditor v-model:open="personalizando" />
    </section>
</template>
