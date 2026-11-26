<script setup lang="ts">
/**
 * Navegación de Ajustes (tableros AjustesEscritorio y AjustesMovil; respuestas del PM del 26 nov
 * 2026). Un solo catálogo (`configuracionSecciones.ts`) y un solo buscador, en dos lugares:
 *
 * - `lateral`: la isla de la izquierda dentro de cada ajuste (escritorio), con «Ajustes», el
 *   buscador y la lista agrupada completa; la pantalla abierta queda resaltada.
 * - `indice`: la página de Ajustes (`/configuracion`). En el teléfono es la lista agrupada a
 *   pantalla completa (encabezado del grupo y sus filas en una tarjeta); en la computadora, una
 *   tarjeta por grupo con sus ajustes.
 *
 * Solo aparece lo que el usuario puede abrir y un grupo sin nada permitido no se muestra. El
 * buscador filtra mientras se escribe, sin tildes ni mayúsculas, por nombre, descripción, grupo y
 * lo que hay dentro («correo», «NIT», «mora»); ↑ ↓ para moverse, Enter abre, Esc borra. Lo que pide
 * atención (FEL en contingencia) lleva un indicador, solo si se pudo leer de la API.
 */
const props = withDefaults(defineProps<{
    variante?: 'lateral' | 'indice'
}>(), {
    variante: 'lateral',
})

const route = useRoute()
const { grupos, buscar } = usePaginasConfiguracion()
const { atencion, cargar } = useAjustesAtencion()
const { empresaId } = useEmpresaActiva()

const busqueda = ref('')
const activo = ref(0)
const lista = useTemplateRef<HTMLElement>('lista')

const buscando = computed(() => busqueda.value.trim().length > 0)
const resultados = computed(() => buscar(busqueda.value))
const actual = computed(() => ubicacionConfiguracion(route.path)?.pagina.id ?? null)
const lateral = computed(() => props.variante === 'lateral')

watch(busqueda, () => {
    activo.value = 0
})

function mover(paso: number) {
    const total = resultados.value.length
    if (total) {
        activo.value = (activo.value + paso + total) % total
        nextTick(() => lista.value?.querySelector('[data-activo="true"]')?.scrollIntoView({ block: 'nearest' }))
    }
}

function abrir() {
    const elegido = resultados.value[activo.value]
    if (elegido) {
        busqueda.value = ''
        void navigateTo(elegido.pagina.ruta)
    }
}

function borrar() {
    busqueda.value = ''
}

onMounted(() => {
    void cargar()
    // La pantalla abierta, a la vista en la lista (las del final quedan abajo del desplazamiento).
    lista.value?.querySelector('[aria-current="page"]')?.scrollIntoView({ block: 'nearest' })
})
watch(empresaId, () => void cargar())
</script>

<template>
    <nav
        class="flex min-w-0 flex-col"
        :class="lateral ? 'surface-card min-h-0 rounded-[1.25rem] px-2.5 pt-3.5 lg:h-full' : 'gap-3'"
        aria-label="Ajustes"
        :data-prueba="lateral ? 'navegacion-ajustes' : 'indice-ajustes'"
    >
        <p
            v-if="lateral"
            class="px-2 pb-2.5 text-lg font-bold tracking-[-0.01em] text-highlighted"
        >
            Ajustes
        </p>
        <div :class="lateral ? 'px-1 pb-1.5' : 'lg:max-w-xl'">
            <UInput
                v-model="busqueda"
                icon="i-lucide-search"
                placeholder="Buscar un ajuste…"
                aria-label="Buscar un ajuste"
                :size="lateral ? 'lg' : 'xl'"
                class="w-full"
                :ui="{ base: 'rounded-full' }"
                data-prueba="buscar-ajuste"
                @keydown.down.prevent="mover(1)"
                @keydown.up.prevent="mover(-1)"
                @keydown.enter.prevent="abrir"
                @keydown.esc.prevent="borrar"
            >
                <template
                    v-if="buscando"
                    #trailing
                >
                    <UButton
                        icon="i-lucide-x"
                        color="neutral"
                        variant="link"
                        size="xs"
                        aria-label="Borrar la búsqueda"
                        @click="borrar"
                    />
                </template>
            </UInput>
        </div>

        <div
            ref="lista"
            class="flex min-w-0 flex-col"
            :class="lateral ? '-mx-1 min-h-0 flex-1 overflow-y-auto px-1 pb-3' : ''"
        >
            <!-- Resultados del buscador: lista plana con su grupo debajo. -->
            <template v-if="buscando">
                <template v-if="resultados.length">
                    <p
                        class="text-[0.6875rem] font-bold tracking-[0.06em] text-muted uppercase"
                        :class="lateral ? 'px-2.5 py-1.5' : 'px-1.5 pt-1.5 pb-0.5'"
                        aria-live="polite"
                        data-prueba="resultados-ajustes"
                    >
                        {{ resultados.length === 1 ? '1 resultado' : `${resultados.length} resultados` }}<template v-if="!lateral">
                            para «{{ busqueda.trim() }}»
                        </template>
                    </p>
                    <div
                        v-if="lateral"
                        class="flex flex-col gap-0.5"
                    >
                        <ULink
                            v-for="(resultado, indice) in resultados"
                            :key="resultado.pagina.id"
                            :to="resultado.pagina.ruta"
                            class="flex items-center gap-2.5 rounded-[0.625rem] px-2.5 py-2 transition-colors hover:bg-(--ax-fila-hover)"
                            :class="indice === activo ? 'bg-primary/10 hover:bg-primary/10' : ''"
                            :data-activo="indice === activo"
                            :data-ajuste="resultado.pagina.id"
                            @click="borrar"
                        >
                            <span class="flex size-8 shrink-0 items-center justify-center rounded-[0.625rem] bg-(--ax-panel) text-muted">
                                <UIcon
                                    :name="resultado.pagina.icono"
                                    class="size-4"
                                />
                            </span>
                            <span class="flex min-w-0 flex-1 flex-col">
                                <span class="text-[0.8125rem] font-semibold text-highlighted">{{ resultado.pagina.etiqueta }}</span>
                                <span class="text-[0.71875rem] text-muted">
                                    {{ resultado.seccion.etiqueta }}<template v-if="resultado.fragmento"> · <template
                                        v-for="(trozo, n) in resaltar(resultado.fragmento, busqueda)"
                                        :key="n"
                                    ><mark
                                        v-if="trozo.marca"
                                        class="rounded-[3px] bg-warning/15 px-px text-inherit"
                                    >{{ trozo.texto }}</mark><template v-else>{{ trozo.texto }}</template></template></template>
                                </span>
                            </span>
                            <UKbd
                                v-if="indice === activo"
                                value="Enter"
                                class="shrink-0"
                            />
                        </ULink>
                    </div>
                    <section
                        v-else
                        class="surface-card overflow-hidden rounded-2xl lg:max-w-xl"
                    >
                        <ULink
                            v-for="(resultado, indice) in resultados"
                            :key="resultado.pagina.id"
                            :to="resultado.pagina.ruta"
                            class="flex min-h-[3.625rem] items-center gap-3 border-t border-(--ax-borde) px-3.5 py-2 transition-colors first:border-t-0 hover:bg-(--ax-fila-hover)"
                            :class="indice === activo ? 'bg-primary/10 hover:bg-primary/10' : ''"
                            :data-activo="indice === activo"
                            :data-ajuste="resultado.pagina.id"
                        >
                            <UIcon
                                :name="resultado.pagina.icono"
                                class="size-[1.125rem] shrink-0 text-muted"
                            />
                            <span class="flex min-w-0 flex-1 flex-col">
                                <span class="text-[0.90625rem] font-semibold text-highlighted">{{ resultado.pagina.etiqueta }}</span>
                                <span class="text-xs text-muted">{{ resultado.seccion.etiqueta }}</span>
                            </span>
                            <UIcon
                                name="i-lucide-chevron-right"
                                class="size-4 shrink-0 text-muted"
                            />
                        </ULink>
                    </section>
                    <p
                        v-if="lateral"
                        class="px-2.5 py-3 text-xs/[1.45] text-muted"
                    >
                        Busca por nombre y por lo que hay dentro: «correo», «NIT», «mora», «logo», «RADIUS».
                        <UKbd value="↑" /> <UKbd value="↓" /> para moverse, <UKbd value="Esc" /> para borrar.
                    </p>
                </template>
                <UEmpty
                    v-else
                    icon="i-lucide-search-x"
                    :title="`Nada coincide con «${busqueda.trim()}»`"
                    description="Prueba con otra palabra: «correo», «NIT», «mora», «logo»…"
                    :actions="[{ label: 'Borrar búsqueda', icon: 'i-lucide-x', color: 'neutral', variant: 'subtle', onClick: borrar }]"
                    variant="naked"
                    :size="lateral ? 'sm' : 'md'"
                    data-prueba="ajustes-sin-resultados"
                />
            </template>

            <!-- Escritorio, dentro de un ajuste: la lista agrupada completa. -->
            <template v-else-if="lateral">
                <div
                    v-for="grupo in grupos"
                    :key="grupo.id"
                    class="flex flex-col"
                    :data-grupo-ajustes="grupo.id"
                >
                    <p class="px-2.5 pt-3 pb-1 text-[0.6875rem] font-bold tracking-[0.06em] text-muted uppercase">
                        {{ grupo.etiqueta }}
                    </p>
                    <ULink
                        v-for="pagina in grupo.paginas"
                        :key="pagina.id"
                        :to="pagina.ruta"
                        class="flex h-8 items-center gap-2.5 rounded-[0.5625rem] px-2.5 text-[0.8125rem] whitespace-nowrap transition-colors"
                        :class="actual === pagina.id ? 'bg-primary/10 font-semibold text-primary' : 'text-toned hover:bg-(--ax-fila-hover)'"
                        :aria-current="actual === pagina.id ? 'page' : undefined"
                        :data-ajuste="pagina.id"
                    >
                        <UIcon
                            :name="pagina.icono"
                            class="size-4 shrink-0"
                            :class="actual === pagina.id ? 'text-primary' : 'text-dimmed'"
                        />
                        <span class="min-w-0 flex-1 truncate">{{ pagina.etiqueta }}</span>
                        <UBadge
                            v-if="atencion[pagina.id]"
                            icon="i-lucide-triangle-alert"
                            color="warning"
                            variant="soft"
                            size="sm"
                            class="rounded-full"
                            :title="atencion[pagina.id]?.texto"
                            :aria-label="atencion[pagina.id]?.texto"
                            :data-atencion="pagina.id"
                        />
                    </ULink>
                </div>
            </template>

            <!-- Página de Ajustes: en el teléfono, grupo y filas; en la computadora, una tarjeta por grupo. -->
            <div
                v-else
                class="gap-4 lg:columns-2 2xl:columns-3"
            >
                <section
                    v-for="grupo in grupos"
                    :key="grupo.id"
                    class="flex break-inside-avoid flex-col lg:mb-4"
                    :aria-labelledby="`grupo-${grupo.id}`"
                    :data-grupo-ajustes="grupo.id"
                >
                    <h2
                        :id="`grupo-${grupo.id}`"
                        class="px-1.5 pt-3.5 pb-1.5 text-[0.6875rem] font-bold tracking-[0.06em] text-muted uppercase lg:sr-only"
                    >
                        {{ grupo.etiqueta }}
                    </h2>
                    <div class="surface-card overflow-hidden rounded-2xl">
                        <div
                            class="hidden items-center gap-3 border-b border-(--ax-borde) px-4 py-3.5 lg:flex"
                            aria-hidden="true"
                        >
                            <span class="pastilla-icono pastilla-tono tono-marca">
                                <UIcon
                                    :name="grupo.icono"
                                    class="size-5"
                                />
                            </span>
                            <span class="flex min-w-0 flex-col">
                                <span class="text-sm font-semibold text-highlighted">{{ grupo.etiqueta }}</span>
                                <span class="text-xs text-muted">{{ grupo.resumen }}</span>
                            </span>
                        </div>
                        <div class="flex flex-col">
                            <ULink
                                v-for="pagina in grupo.paginas"
                                :key="pagina.id"
                                :to="pagina.ruta"
                                class="flex min-h-12 items-center gap-3 border-t border-(--ax-borde) px-3.5 text-[0.90625rem] text-highlighted transition-colors first:border-t-0 hover:bg-(--ax-fila-hover) lg:min-h-11 lg:px-4 lg:text-sm"
                                :title="pagina.descripcion"
                                :data-ajuste="pagina.id"
                            >
                                <UIcon
                                    :name="pagina.icono"
                                    class="size-[1.125rem] shrink-0 text-muted"
                                />
                                <span class="min-w-0 flex-1">{{ pagina.etiqueta }}</span>
                                <UBadge
                                    v-if="atencion[pagina.id]"
                                    :label="atencion[pagina.id]?.corto"
                                    icon="i-lucide-triangle-alert"
                                    color="warning"
                                    variant="soft"
                                    size="sm"
                                    class="shrink-0 rounded-full"
                                    :title="atencion[pagina.id]?.texto"
                                    :data-atencion="pagina.id"
                                />
                                <UIcon
                                    name="i-lucide-chevron-right"
                                    class="size-4 shrink-0 text-muted"
                                />
                            </ULink>
                        </div>
                    </div>
                </section>
            </div>
        </div>
    </nav>
</template>
