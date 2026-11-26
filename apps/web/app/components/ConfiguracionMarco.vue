<script setup lang="ts">
import type { BreadcrumbItem } from '@nuxt/ui'

/**
 * Marco de cada ajuste (tableros AjustesEscritorio y AjustesMovil; respuestas del PM del 26 nov 2026):
 *
 * - en la computadora, las migas «Ajustes › grupo › pantalla» arriba; a la izquierda, la lista de
 *   grupos con su buscador (`AjustesNavegacion`), fija en su isla; a la derecha, el título de la
 *   pantalla con su «?», su frase y las acciones; debajo, si la pantalla es por empresa, las
 *   pastillas «Empresa: …» y «Nueva»;
 * - en el teléfono, la pantalla a lo ancho con «‹ Ajustes» (vuelve a la lista), el título y el
 *   nombre del grupo debajo; la lista es la página de Ajustes;
 * - la tarjeta isla con el cuerpo y su propio desplazamiento, y el pie (`#pie`, «Descartar /
 *   Guardar») fijo abajo; en el teléfono, el pie es la isla fija encima de la navegación
 *   (`PanelBarraAccion`) y su nota corta va arriba de los botones;
 * - `#accion-principal`: la acción principal de una pantalla sin pie (como en `PanelPagina`), en el
 *   encabezado en escritorio y en la isla fija en el teléfono.
 *
 * Título, frase y grupo salen del catálogo único (`configuracionSecciones.ts`). Una subpágina (la
 * edición de una plantilla, Iris dentro de Integraciones) pasa su `titulo` y `volver`: «‹ Atrás»
 * vuelve a la pantalla de la que salió. Ya no hay pestañas para pasar de un ajuste a otro: quedan
 * solo las que dividen una misma pantalla, dentro de ella.
 */
const props = withDefaults(defineProps<{
    id: string
    /** Solo en subpáginas: en la pantalla de un ajuste, el título es el del catálogo. */
    titulo?: string
    /** Solo en subpáginas: en la pantalla de un ajuste, la frase es la del catálogo. */
    descripcion?: string
    /** Pastillas de la empresa activa (los ajustes que son de cada NIT). */
    empresas?: boolean
    /** Sin la tarjeta isla: la pantalla pinta sus propias tarjetas (listas con detalle, pasos). */
    sinTarjeta?: boolean
    /** Subpágina a la que se llega desde otra pantalla: «Atrás» vuelve aquí. */
    volver?: string
}>(), {
    titulo: undefined,
    descripcion: undefined,
    empresas: false,
    sinTarjeta: false,
    volver: undefined,
})

const route = useRoute()
const { puede, enlace } = usePermisos()
const { empresas: listaEmpresas, empresaId, elegir } = useEmpresaActiva()
const slots = useSlots()

const ubicacion = computed(() => ubicacionConfiguracion(route.path))
/** La pantalla del catálogo (y no una subpágina suya). */
const enPantalla = computed(() => ubicacion.value?.pagina.ruta === route.path)

const titulo = computed(() => (enPantalla.value || !props.titulo ? ubicacion.value?.pagina.etiqueta ?? props.titulo ?? 'Ajustes' : props.titulo))
const descripcion = computed(() => (enPantalla.value ? ubicacion.value?.pagina.descripcion : props.descripcion ?? ubicacion.value?.pagina.descripcion))

const migas = computed<BreadcrumbItem[]>(() => {
    const lista: BreadcrumbItem[] = [{ label: 'Ajustes', to: RUTA_AJUSTES }]
    const lugar = ubicacion.value
    if (lugar) {
        lista.push({ label: lugar.seccion.etiqueta })
        lista.push(enPantalla.value ? { label: lugar.pagina.etiqueta } : { label: lugar.pagina.etiqueta, to: lugar.pagina.ruta })
    }
    if (!enPantalla.value) {
        lista.push({ label: titulo.value })
    }
    return lista
})

const conPastillas = computed(() => props.empresas && listaEmpresas.value.length > 0)
</script>

<template>
    <PanelPagina
        :id="props.id"
        :titulo="titulo"
        encabezado-propio
        sin-migas
    >
        <UBreadcrumb
            :items="migas"
            class="hidden lg:flex"
            :ui="{ link: 'text-[0.8125rem]' }"
            data-prueba="migas"
        />
        <div
            class="grid min-w-0 gap-4 lg:min-h-0 lg:flex-1 lg:grid-cols-[17rem_minmax(0,1fr)]"
            data-prueba="marco-configuracion"
        >
            <AjustesNavegacion
                variante="lateral"
                class="hidden lg:flex"
            />

            <div class="flex min-w-0 flex-col gap-3 lg:min-h-0">
                <ULink
                    :to="props.volver ?? RUTA_AJUSTES"
                    class="inline-flex items-center gap-1 self-start text-sm font-medium text-muted hover:text-default lg:hidden"
                    data-prueba="volver-ajustes"
                >
                    <UIcon
                        name="i-lucide-chevron-left"
                        class="size-4"
                    />
                    {{ props.volver ? 'Atrás' : 'Ajustes' }}
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
                                {{ titulo }}
                            </h1>
                        </div>
                        <!-- Teléfono: el grupo debajo del título (la lista quedó atrás); computadora: la frase. -->
                        <p
                            v-if="ubicacion"
                            class="text-[0.8125rem] text-muted lg:hidden"
                            data-prueba="grupo-ajuste"
                        >
                            {{ ubicacion.seccion.etiqueta }}
                        </p>
                        <p
                            v-if="descripcion"
                            class="hidden text-sm text-muted lg:block"
                        >
                            {{ descripcion }}
                        </p>
                    </div>
                    <div class="panel-acciones flex shrink-0 flex-wrap items-center gap-2">
                        <AyudaBoton
                            solo-icono
                            class="boton-flotante boton-circulo"
                            :class="conPastillas ? 'max-lg:hidden' : ''"
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
                    v-if="conPastillas"
                    class="flex flex-wrap items-center gap-2"
                    data-prueba="pastillas-empresa"
                >
                    <span class="text-sm text-muted max-lg:hidden">Empresa</span>
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
                        class="max-lg:hidden"
                        :to="enlace('/configuracion/empresas?nueva=1')"
                        data-prueba="nueva-empresa"
                    />
                    <AyudaBoton
                        solo-icono
                        class="boton-flotante boton-circulo ms-auto lg:hidden"
                    />
                </div>

                <slot name="alcance" />

                <slot
                    v-if="props.sinTarjeta"
                />
                <section
                    v-else
                    class="surface-card flex min-w-0 flex-col rounded-[1.25rem] lg:min-h-0 lg:flex-1"
                    data-prueba="tarjeta-configuracion"
                >
                    <div
                        v-if="slots.cabecera"
                        class="flex flex-wrap items-center justify-between gap-2 border-b border-(--ax-borde) p-3 sm:px-4"
                    >
                        <slot name="cabecera" />
                    </div>
                    <div class="flex min-w-0 flex-col gap-4 p-4 lg:min-h-0 lg:flex-1 lg:overflow-y-auto lg:p-5">
                        <slot />
                    </div>
                    <!-- El pie («Descartar / Guardar»): en escritorio, fijo al final de la tarjeta; en el
                         teléfono, isla fija encima de la navegación y el contenido reserva su alto. -->
                    <PanelBarraAccion
                        v-if="hayContenido(slots.pie?.())"
                        estirar
                        class="lg:sticky lg:bottom-0 lg:z-10 lg:flex-wrap lg:justify-end lg:rounded-b-[1.25rem] lg:border-t lg:border-(--ax-borde) lg:bg-(--ax-tarjeta) lg:px-5 lg:py-3.5"
                        data-prueba="pie-configuracion"
                    >
                        <slot name="pie" />
                    </PanelBarraAccion>
                </section>
            </div>
        </div>
    </PanelPagina>
</template>
