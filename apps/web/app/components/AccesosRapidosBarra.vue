<script setup lang="ts">
/**
 * Accesos rápidos de un clic (pedido del PM, «más compacto»): en la barra superior solo los 2
 * primeros accesos del usuario (icono + etiqueta corta; en el teléfono solo el icono, con `title`)
 * y «Más» (rayo), con el resto por área, sus contadores y atajos Alt+N, y «Personalizar mis
 * accesos» al final. Si algo del menú tiene pendientes, «Más» muestra la suma. Sin permiso, el
 * acceso no aparece (nunca deshabilitado). Sin `UTooltip`: las pruebas montan las pantallas sin
 * el proveedor de `UApp`.
 */
const { accesos, porArea } = useAccesosRapidos()
const comprobantes = useComprobantes()
const VISIBLES = 2

const visibles = computed(() => accesos.value.slice(0, VISIBLES))
const resto = computed(() => porArea.value
    .map(area => ({ ...area, secciones: area.secciones.filter(({ numero }) => numero > VISIBLES) }))
    .filter(area => area.secciones.length > 0))

/** Contadores de las secciones (hoy, los comprobantes por verificar). */
function pendientes(id: string): number {
    return id === 'comprobantes' ? (comprobantes.contador.value ?? 0) : 0
}

function contador(id: string): string | undefined {
    return id === 'comprobantes' ? textoContador(comprobantes.contador.value) : undefined
}

/** Suma de pendientes de lo que está dentro de «Más». */
const pendientesMas = computed(() => accesos.value.slice(VISIBLES).reduce((suma, seccion) => suma + pendientes(seccion.id), 0))

const masAbierto = ref(false)
const personalizando = ref(false)

function personalizar() {
    masAbierto.value = false
    personalizando.value = true
}
</script>

<template>
    <nav
        v-if="accesos.length"
        aria-label="Accesos rápidos"
        class="flex min-w-0 items-center gap-0.5"
        data-prueba="accesos-rapidos"
    >
        <UButton
            v-for="(seccion, indice) in visibles"
            :key="seccion.id"
            :to="seccion.ruta"
            :icon="seccion.icono"
            :label="seccion.etiqueta"
            color="neutral"
            variant="ghost"
            size="sm"
            :title="indice < 9 ? `${seccion.etiqueta} (Alt+${indice + 1})` : seccion.etiqueta"
            :aria-label="seccion.etiqueta"
            active-variant="soft"
            active-color="primary"
            class="shrink-0"
            :ui="{ label: 'hidden md:inline', leadingIcon: 'text-primary' }"
            :data-acceso="seccion.id"
        >
            <template
                v-if="contador(seccion.id)"
                #trailing
            >
                <UBadge
                    :label="contador(seccion.id)"
                    size="sm"
                    variant="solid"
                    class="rounded-full"
                />
            </template>
        </UButton>

        <UPopover
            v-model:open="masAbierto"
            :content="{ align: 'end', sideOffset: 8 }"
        >
            <UChip
                :text="pendientesMas ? textoContador(pendientesMas) : undefined"
                :show="pendientesMas > 0"
                size="2xl"
                color="primary"
                inset
            >
                <UButton
                    icon="i-lucide-zap"
                    label="Más"
                    color="neutral"
                    variant="ghost"
                    size="sm"
                    class="shrink-0"
                    :ui="{ label: 'hidden md:inline', leadingIcon: 'text-primary' }"
                    title="Más accesos rápidos y personalizar"
                    :aria-label="pendientesMas ? `Más accesos rápidos (${pendientesMas} pendientes)` : 'Más accesos rápidos'"
                    data-prueba="mas-accesos"
                />
            </UChip>
            <template #content>
                <div
                    class="flex w-72 max-w-[calc(100vw-2rem)] flex-col gap-3 p-3"
                    data-prueba="menu-accesos-rapidos"
                >
                    <p
                        v-if="!resto.length"
                        class="text-sm text-muted"
                    >
                        Tus dos accesos ya están en la barra. Agrega más con «Personalizar mis accesos».
                    </p>
                    <div
                        v-for="area in resto"
                        :key="area.etiqueta"
                        class="flex flex-col gap-0.5"
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
                            @click="masAbierto = false"
                        >
                            <UIcon
                                :name="seccion.icono"
                                class="size-4 shrink-0 text-primary"
                            />
                            <span class="flex-1 truncate">{{ seccion.etiqueta }}</span>
                            <UBadge
                                v-if="contador(seccion.id)"
                                :label="contador(seccion.id)"
                                size="sm"
                                variant="solid"
                                class="rounded-full"
                            />
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
                    </div>
                    <UButton
                        label="Personalizar mis accesos"
                        icon="i-lucide-sliders-horizontal"
                        color="neutral"
                        variant="soft"
                        size="sm"
                        block
                        data-prueba="personalizar-accesos"
                        @click="personalizar"
                    />
                </div>
            </template>
        </UPopover>
        <AccesosRapidosEditor v-model:open="personalizando" />
    </nav>
</template>
