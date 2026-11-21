<script setup lang="ts">
/**
 * Accesos rápidos en la barra superior (rayo): un menú con los accesos del usuario agrupados por
 * área, con su atajo (Alt+1…9), y «Personalizar». Sin `UTooltip`: las pruebas montan las
 * pantallas sin el proveedor de `UApp`.
 */
const { porArea } = useAccesosRapidos()
const abierto = ref(false)
const personalizando = ref(false)

function personalizar() {
    abierto.value = false
    personalizando.value = true
}
</script>

<template>
    <div>
        <UPopover
            v-model:open="abierto"
            :content="{ align: 'start', sideOffset: 8 }"
        >
            <UButton
                icon="i-lucide-zap"
                color="neutral"
                variant="ghost"
                title="Accesos rápidos (Alt+1…9)"
                aria-label="Accesos rápidos"
                data-prueba="accesos-rapidos"
            />
            <template #content>
                <div
                    class="flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-3 p-3"
                    data-prueba="menu-accesos-rapidos"
                >
                    <div class="flex items-center justify-between gap-2">
                        <p class="flex items-center gap-2 text-sm font-semibold text-highlighted">
                            <span class="pastilla-icono tono-marca pastilla-tono size-7">
                                <UIcon
                                    name="i-lucide-zap"
                                    class="size-4"
                                />
                            </span>
                            Accesos rápidos
                        </p>
                        <UButton
                            label="Personalizar"
                            icon="i-lucide-sliders-horizontal"
                            color="neutral"
                            variant="ghost"
                            size="xs"
                            data-prueba="personalizar-accesos"
                            @click="personalizar"
                        />
                    </div>
                    <p
                        v-if="!porArea.length"
                        class="text-sm text-muted"
                    >
                        Todavía no tienes accesos. Usa «Personalizar» para elegirlos.
                    </p>
                    <nav
                        v-for="area in porArea"
                        :key="area.etiqueta"
                        class="flex flex-col gap-0.5"
                        :aria-label="area.etiqueta"
                    >
                        <p class="flex items-center gap-1.5 px-1 text-[0.6875rem] font-bold tracking-[0.06em] text-dimmed uppercase">
                            <UIcon
                                :name="area.icono"
                                class="size-3.5"
                            />
                            {{ area.etiqueta }}
                        </p>
                        <ULink
                            v-for="{ seccion, numero } in area.secciones"
                            :key="seccion.id"
                            :to="seccion.ruta"
                            :title="seccion.descripcion"
                            class="flex items-center gap-2.5 rounded-md px-1.5 py-1.5 text-sm text-default transition-colors hover:bg-(--ax-fila-hover) hover:text-primary"
                            @click="abierto = false"
                        >
                            <UIcon
                                :name="seccion.icono"
                                class="size-4 shrink-0 text-primary"
                            />
                            <span class="flex-1 truncate">{{ seccion.etiqueta }}</span>
                            <span
                                v-if="numero <= 9"
                                class="flex gap-0.5"
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
                </div>
            </template>
        </UPopover>
        <AccesosRapidosEditor v-model:open="personalizando" />
    </div>
</template>
