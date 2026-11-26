<script setup lang="ts">
/**
 * Marco de las pantallas de Configuración (tableros OperConfigEmpresa, OperConfigCobro,
 * OperConfigRed, OperConfigNotificaciones, OperConfigIntegraciones y OperConfigImportar):
 *
 * - a la izquierda, el submenú de secciones (`ConfiguracionSubmenu`), fijo en su isla;
 * - a la derecha, el título de la sección con su «?», la descripción y las acciones; debajo, si la
 *   sección es por empresa, las pastillas «Empresa: …» y «Nueva»;
 * - la tarjeta isla con las pantallas de la sección como pestañas segmentadas dentro de ella, el
 *   cuerpo con su propio desplazamiento y el pie (`#pie`) fijo abajo con la acción principal
 *   («Descartar / Guardar»); en el teléfono, el pie es la isla fija encima de la navegación
 *   (`PanelBarraAccion`) y su nota corta va arriba de los botones;
 * - `#accion-principal`: la acción principal de una sección sin pie (como en `PanelPagina`), en el
 *   encabezado en escritorio y en la isla fija en el teléfono.
 *
 * En el teléfono (pantallas, no columnas) el submenú solo aparece en el índice: cada sección lleva
 * «‹ Configuración» y su pie queda fijo abajo.
 */
const props = withDefaults(defineProps<{
    id: string
    titulo: string
    descripcion?: string
    /** Pastillas de la empresa activa (las secciones que son de cada NIT). */
    empresas?: boolean
    /** Sin la tarjeta isla: la pantalla pinta sus propias tarjetas (listas con detalle, pasos). */
    sinTarjeta?: boolean
    /** Índice de Configuración: el submenú también se ve en el teléfono. */
    indice?: boolean
    /** Subpágina a la que se llega desde otra pantalla: «Atrás» vuelve aquí. */
    volver?: string
}>(), {
    descripcion: undefined,
    empresas: false,
    sinTarjeta: false,
    indice: false,
    volver: undefined,
})

const route = useRoute()
const { puede, enlace } = usePermisos()
const { empresas: listaEmpresas, empresaId, elegir } = useEmpresaActiva()
const slots = useSlots()

const ubicacion = computed(() => ubicacionConfiguracion(route.path))

/** El catálogo único ya no tiene pestañas de navegación (plan del menú y Ajustes, lote 1). */
const conPestanas = false
const pestanas: { label: string, value: string, icon: string }[] = []
const pestana = ref<string>()
</script>

<template>
    <PanelPagina
        :id="props.id"
        :titulo="ubicacion && ubicacion.pagina.etiqueta !== ubicacion.seccion.etiqueta && ubicacion.pagina.ruta === route.path ? ubicacion.pagina.etiqueta : props.titulo"
        encabezado-propio
    >
        <div
            class="grid min-w-0 gap-3.5 lg:min-h-0 lg:flex-1 lg:grid-cols-[16.5rem_minmax(0,1fr)]"
            data-prueba="marco-configuracion"
        >
            <ConfiguracionSubmenu
                :activa="ubicacion?.seccion.id ?? null"
                :class="props.indice ? '' : 'hidden lg:flex'"
            />

            <div class="flex min-w-0 flex-col gap-3 lg:min-h-0">
                <ULink
                    v-if="!props.indice"
                    :to="props.volver ?? '/configuracion'"
                    class="inline-flex items-center gap-1 self-start text-sm font-medium text-muted hover:text-default lg:hidden"
                    data-prueba="volver-configuracion"
                >
                    <UIcon
                        name="i-lucide-chevron-left"
                        class="size-4"
                    />
                    {{ props.volver ? 'Atrás' : 'Configuración' }}
                </ULink>

                <div
                    class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"
                    data-prueba="encabezado-pagina"
                >
                    <div class="flex min-w-0 flex-col">
                        <div class="flex items-center gap-1">
                            <UButton
                                v-if="props.volver"
                                icon="i-lucide-chevron-left"
                                color="neutral"
                                variant="ghost"
                                size="sm"
                                :to="props.volver"
                                aria-label="Atrás"
                                title="Atrás"
                                class="-ms-2 hidden lg:inline-flex"
                            />
                            <h1 class="text-2xl font-bold tracking-[-0.02em] text-highlighted">
                                {{ props.titulo }}
                            </h1>
                        </div>
                        <p
                            v-if="props.descripcion"
                            class="text-sm text-muted"
                        >
                            {{ props.descripcion }}
                        </p>
                    </div>
                    <div class="panel-acciones flex shrink-0 flex-wrap items-center gap-2">
                        <AyudaBoton
                            solo-icono
                            class="boton-flotante boton-circulo"
                        />
                        <slot name="acciones" />
                        <PanelBarraAccion
                            v-if="hayContenido(slots['accion-principal']?.())"
                            estirar
                            data-prueba="accion-principal"
                        >
                            <slot name="accion-principal" />
                        </PanelBarraAccion>
                    </div>
                </div>

                <div
                    v-if="props.empresas && listaEmpresas.length"
                    class="flex flex-wrap items-center gap-2"
                    data-prueba="pastillas-empresa"
                >
                    <span class="text-sm text-muted">Empresa</span>
                    <UButton
                        v-for="empresa in listaEmpresas"
                        :key="empresa.id"
                        :label="empresa.nombre_comercial"
                        icon="i-lucide-building"
                        :color="empresa.id === empresaId ? 'primary' : 'neutral'"
                        :variant="empresa.id === empresaId ? 'solid' : 'outline'"
                        :aria-pressed="empresa.id === empresaId"
                        :data-empresa="empresa.id"
                        @click="elegir(empresa.id)"
                    />
                    <UButton
                        v-if="puede('empresas.crear')"
                        label="Nueva"
                        icon="i-lucide-plus"
                        color="neutral"
                        variant="outline"
                        :to="enlace('/configuracion/empresas?nueva=1')"
                        data-prueba="nueva-empresa"
                    />
                </div>

                <slot name="alcance" />

                <slot
                    v-if="props.sinTarjeta"
                />
                <section
                    v-else
                    class="surface-card flex min-w-0 flex-col rounded-2xl lg:min-h-0 lg:flex-1"
                    data-prueba="tarjeta-configuracion"
                >
                    <div
                        v-if="conPestanas || slots.cabecera"
                        class="flex flex-wrap items-center justify-between gap-2 border-b border-(--ax-borde) p-3 sm:px-4"
                    >
                        <UTabs
                            v-if="conPestanas"
                            v-model="pestana"
                            :items="pestanas"
                            variant="pill"
                            color="neutral"
                            :content="false"
                            class="min-w-0 max-w-full"
                            :ui="{
                                list: 'w-auto max-w-full justify-start self-start overflow-x-auto rounded-xl bg-(--ax-panel) p-1',
                                indicator: 'rounded-lg bg-(--ax-tarjeta) shadow-sm ring ring-(--ax-borde)',
                                trigger: 'shrink-0 grow-0 rounded-lg px-3 text-muted data-[state=active]:text-primary',
                                leadingIcon: 'size-4',
                            }"
                            data-prueba="pestanas-configuracion"
                        />
                        <slot name="cabecera" />
                    </div>
                    <div class="flex min-w-0 flex-col gap-4 p-4 lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
                        <slot />
                    </div>
                    <!-- El pie («Descartar / Guardar»): en escritorio, fijo al final de la tarjeta; en el
                         teléfono, isla fija encima de la navegación y el contenido reserva su alto. -->
                    <PanelBarraAccion
                        v-if="hayContenido(slots.pie?.())"
                        estirar
                        class="lg:sticky lg:bottom-0 lg:z-10 lg:flex-wrap lg:justify-end lg:rounded-b-2xl lg:border-t lg:border-(--ax-borde) lg:bg-(--ax-tarjeta) lg:px-4 lg:py-3"
                        data-prueba="pie-configuracion"
                    >
                        <slot name="pie" />
                    </PanelBarraAccion>
                </section>
            </div>
        </div>
    </PanelPagina>
</template>
