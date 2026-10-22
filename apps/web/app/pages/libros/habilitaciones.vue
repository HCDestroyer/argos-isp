<script setup lang="ts">
import type { SelectItem, TableColumn } from '@nuxt/ui'

/**
 * Habilitaciones de folios de los libros (`GET /libros/habilitaciones`, la más reciente primero; con
 * «Todas», de todas las empresas): autorización, rango, fecha, cuántos folios usaron las emisiones y
 * cuántos quedan. «Registrar habilitación» (`libros.habilitar`) propone el folio siguiente al último
 * habilitado del libro; una habilitación no se edita ni se borra.
 */
definePageMeta({ permiso: 'libros.ver' })

useHead({ title: 'Habilitaciones de folios · ArgosIsp' })

const route = useRoute()
const router = useRouter()
const toast = useToast()
const { puede } = usePermisos()
const { conSelector, eleccion, empresaId, empresas, nombre: nombreEmpresa } = useEmpresaActiva()
const consolidado = computed(() => conSelector.value && eleccion.value === 'todas')
const empresa = computed<number | null>(() => empresaId.value ?? (conSelector.value ? null : (empresas.value[0]?.id ?? null)))

const TODOS = 'todos'
const libro = ref<LibroHabilitable | typeof TODOS>(esLibroHabilitable(route.query.libro) ? route.query.libro : TODOS)
const itemsLibro: SelectItem[] = [{ label: 'Todos los libros', value: TODOS }, ...LIBROS_HABILITABLES.map(l => ({ label: LIBROS[l].etiqueta, value: l }))]

const lista = usePaginacionCursor(cursor => useLibros().habilitaciones(libro.value === TODOS ? {} : { libro: libro.value }, cursor))
watch(libro, () => {
    void router.replace({ query: { ...route.query, libro: libro.value === TODOS ? undefined : libro.value } })
    void lista.recargar()
})

const columnas: TableColumn<HabilitacionLibro>[] = [
    { accessorKey: 'libro', header: 'Libro', meta: { class: { td: 'whitespace-normal' } } },
    { accessorKey: 'folio_desde', header: 'Folios' },
    { accessorKey: 'usados', header: 'Uso', meta: SOLO_ANCHO },
    { accessorKey: 'fecha', header: 'Autorización', meta: { class: { th: 'hidden md:table-cell', td: 'hidden md:table-cell whitespace-normal' } } },
]

const registrando = ref(false)

function alHabilitar(habilitacion: HabilitacionLibro) {
    toast.add({
        title: 'Habilitación registrada',
        description: `${LIBROS[habilitacion.libro].legal} · folios ${habilitacion.folio_desde} a ${habilitacion.folio_hasta}`,
        icon: 'i-lucide-book-plus',
        color: 'success',
    })
    void lista.recargar()
}

onMounted(() => {
    void lista.recargar()
    // Desde «Registrar habilitación» de un error de folios: el formulario abre con ese libro.
    if (route.query.nueva === '1' && puede('libros.habilitar') && empresa.value !== null) {
        registrando.value = true
        void router.replace({ query: { ...route.query, nueva: undefined } })
    }
})
</script>

<template>
    <PanelPagina
        id="libros-habilitaciones"
        titulo="Habilitaciones de folios"
        icono="i-lucide-book-plus"
    >
        <div class="flex flex-col gap-6">
            <LibrosNavegacion />

            <UAlert
                color="neutral"
                variant="subtle"
                icon="i-lucide-info"
                description="Los rangos de cada libro son correlativos: el primero empieza donde diga la autorización (SAT-7121 y Registro Mercantil) y cada uno nuevo en el folio siguiente al último habilitado. Las emisiones toman sus folios de aquí."
            />

            <section
                class="flex flex-col gap-3"
                aria-label="Habilitaciones"
            >
                <div class="flex flex-wrap items-center justify-between gap-2">
                    <USelect
                        v-model="libro"
                        :items="itemsLibro"
                        aria-label="Libro"
                        class="w-48"
                        data-prueba="habilitaciones-libro"
                    />
                    <UButton
                        v-if="puede('libros.habilitar')"
                        label="Registrar habilitación"
                        icon="i-lucide-book-plus"
                        size="sm"
                        :disabled="empresa === null"
                        data-prueba="abrir-habilitacion"
                        @click="registrando = true"
                    />
                </div>
                <p
                    v-if="puede('libros.habilitar') && empresa === null"
                    class="text-sm text-muted"
                    data-prueba="habilitaciones-sin-empresa"
                >
                    Con «Todas» se ven las de todas las empresas; para registrar una, elija la empresa en el selector de arriba.
                </p>

                <ProblemaAlerta
                    v-if="lista.problema.value"
                    :problema="lista.problema.value"
                    :reintentar="lista.recargar"
                    :reintentando="lista.cargando.value"
                />
                <template v-else>
                    <UTable
                        :data="lista.filas.value"
                        :columns="columnas"
                        :loading="lista.cargando.value"
                        data-prueba="tabla-habilitaciones"
                    >
                        <template #libro-cell="{ row }">
                            <div class="flex min-w-0 flex-col">
                                <span class="flex items-center gap-2 text-sm font-medium text-highlighted">
                                    <UIcon
                                        :name="LIBROS[row.original.libro].icono"
                                        class="size-4 shrink-0"
                                    />
                                    {{ LIBROS[row.original.libro].legal }}
                                </span>
                                <span class="text-xs text-muted md:hidden">{{ row.original.autorizacion }} · {{ formatearFecha(row.original.fecha) }}</span>
                                <span
                                    v-if="consolidado"
                                    class="text-xs text-muted"
                                >{{ nombreEmpresa(row.original.empresa_id) }}</span>
                            </div>
                        </template>
                        <template #folio_desde-cell="{ row }">
                            <div class="flex flex-col">
                                <span
                                    class="text-sm tabular-nums"
                                    data-prueba="habilitacion-rango"
                                >{{ row.original.folio_desde }}–{{ row.original.folio_hasta }}</span>
                                <span
                                    class="text-xs text-muted tabular-nums"
                                    data-prueba="habilitacion-disponibles"
                                >{{ row.original.disponibles }} disponibles</span>
                            </div>
                        </template>
                        <template #usados-cell="{ row }">
                            <div class="flex w-32 flex-col gap-1">
                                <UProgress
                                    :model-value="row.original.usados"
                                    :max="row.original.folio_hasta - row.original.folio_desde + 1"
                                    size="sm"
                                    :color="row.original.disponibles === 0 ? 'error' : row.original.disponibles <= 10 ? 'warning' : 'primary'"
                                    :aria-label="`${row.original.usados} folios usados`"
                                />
                                <span class="text-xs text-muted tabular-nums">{{ row.original.usados }} usados</span>
                            </div>
                        </template>
                        <template #fecha-cell="{ row }">
                            <div class="flex flex-col">
                                <span class="text-sm">{{ row.original.autorizacion }}</span>
                                <span class="text-xs text-muted">{{ formatearFecha(row.original.fecha) }}{{ row.original.nota ? ` · ${row.original.nota}` : '' }}</span>
                            </div>
                        </template>
                        <template #empty>
                            <UEmpty
                                icon="i-lucide-book-plus"
                                title="Sin habilitaciones"
                                description="Sin folios habilitados, un libro no se emite."
                                variant="naked"
                            />
                        </template>
                    </UTable>
                    <PaginacionCursor
                        :pagina="lista.pagina.value"
                        :hay-anterior="lista.hayAnterior.value"
                        :hay-siguiente="lista.haySiguiente.value"
                        :cargando="lista.cargando.value"
                        :filas="lista.filas.value.length"
                        @anterior="lista.anterior"
                        @siguiente="lista.siguiente"
                    />
                </template>
            </section>
        </div>

        <HabilitacionLibroModal
            v-if="puede('libros.habilitar') && empresa !== null"
            v-model:open="registrando"
            :empresa-id="empresa"
            :empresa="conSelector ? nombreEmpresa(empresa) : null"
            :libro-inicial="libro === TODOS ? 'diario' : libro"
            @hecho="alHabilitar"
        />
    </PanelPagina>
</template>
