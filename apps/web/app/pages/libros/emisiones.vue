<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { SelectItem, TableColumn } from '@nuxt/ui'

/**
 * Historial de emisiones oficiales de los libros (`GET /libros/emisiones`, la más reciente primero,
 * por cursor; con «Todas», de todas las empresas). Cada emisión: libro, periodo, folios, formato,
 * quién y cuándo, y la marca de reimpresión con la emisión que sustituye. «Descargar» pide el archivo
 * tal como se guardó: si su SHA-256 ya no coincide, la API responde 409 `archivo_alterado` y se dice
 * qué hacer. El detalle (`?emision=`) muestra la huella, el último sello y hash de la cadena y los
 * totales.
 */
definePageMeta({ permiso: 'libros.ver' })

useHead({ title: 'Emisiones de libros · ArgosIsp' })

const route = useRoute()
const router = useRouter()
const { conSelector, eleccion, nombre: nombreEmpresa } = useEmpresaActiva()
const consolidado = computed(() => conSelector.value && eleccion.value === 'todas')

const TODOS = 'todos'
const libro = ref<LibroEmitible | typeof TODOS>(esLibroEmitible(route.query.libro) ? route.query.libro : TODOS)
const itemsLibro: SelectItem[] = [{ label: 'Todos los libros', value: TODOS }, ...LIBROS_EMITIBLES.map(l => ({ label: LIBROS[l].etiqueta, value: l }))]

const lista = usePaginacionCursor(cursor => useLibros().emisiones(libro.value === TODOS ? {} : { libro: libro.value }, cursor))
watch(libro, () => {
    void router.replace({ query: { ...route.query, libro: libro.value === TODOS ? undefined : libro.value } })
    void lista.recargar()
})

const columnas: TableColumn<EmisionLibro>[] = [
    { accessorKey: 'id', header: 'Emisión', meta: { class: { td: 'whitespace-normal' } } },
    { accessorKey: 'desde', header: 'Periodo', meta: SOLO_ANCHO },
    { accessorKey: 'folio_inicial', header: 'Folios' },
    { accessorKey: 'generado_en', header: 'Emitida', meta: { class: { th: 'hidden md:table-cell', td: 'hidden md:table-cell whitespace-normal' } } },
    { id: 'acciones', header: '' },
]

/* Descarga del archivo guardado. */
const descargando = ref<number | null>(null)
const problemaDescarga = ref<Problem | null>(null)

async function descargar(emision: EmisionLibro) {
    descargando.value = emision.id
    problemaDescarga.value = null
    const resultado = await useLibros().archivoEmision(emision.id)
    descargando.value = null
    if (!resultado.ok) {
        problemaDescarga.value = resultado.problema
        return
    }
    guardarBlob(resultado.data, nombreArchivoEmision(emision))
}

/* Detalle (`?emision=`). */
const idDetalle = computed(() => {
    const id = Number(route.query.emision)
    return Number.isInteger(id) && id > 0 ? id : null
})
const detalle = shallowRef<EmisionLibro | null>(null)
const cargandoDetalle = ref(false)
const problemaDetalle = ref<Problem | null>(null)

async function cargarDetalle() {
    const id = idDetalle.value
    if (id === null) {
        detalle.value = null
        return
    }
    const enLista = lista.filas.value.find(e => e.id === id)
    if (enLista) {
        detalle.value = enLista
        problemaDetalle.value = null
        return
    }
    cargandoDetalle.value = true
    const resultado = await useLibros().emision(id)
    cargandoDetalle.value = false
    detalle.value = resultado.ok ? resultado.data : null
    problemaDetalle.value = resultado.ok ? null : resultado.problema
}

function abrirDetalle(id: number | null) {
    problemaDescarga.value = null
    void router.replace({ query: { ...route.query, emision: id === null ? undefined : String(id) } })
}

const viendoDetalle = computed({
    get: () => idDetalle.value !== null,
    set: (valor: boolean) => {
        if (!valor) {
            abrirDetalle(null)
        }
    },
})

watch(idDetalle, () => void cargarDetalle())

/** Totales de la emisión con su etiqueta; solo montos. */
function totalesDe(emision: EmisionLibro): { clave: string, monto: string }[] {
    return Object.entries(emision.totales)
        .filter((par): par is [string, string] => typeof par[1] === 'string' && /^-?\d+(\.\d+)?$/.test(par[1]))
        .map(([clave, monto]) => ({ clave, monto }))
}

function etiquetaTotal(clave: string): string {
    return clave.replace(/_/g, ' ').replace(/^./, c => c.toUpperCase())
}

onMounted(async () => {
    await lista.recargar()
    void cargarDetalle()
})
</script>

<template>
    <PanelPagina
        id="libros-emisiones"
        titulo="Emisiones de libros"
        icono="i-lucide-stamp"
    >
        <div class="flex flex-col gap-6">
            <LibrosNavegacion />

            <section
                class="flex flex-col gap-3"
                aria-label="Emisiones"
            >
                <div class="flex flex-wrap items-center justify-between gap-2">
                    <p class="text-sm text-muted">
                        Cada emisión gasta un folio por página y guarda su archivo con la huella SHA-256.
                    </p>
                    <USelect
                        v-model="libro"
                        :items="itemsLibro"
                        aria-label="Libro"
                        class="w-48"
                        data-prueba="emisiones-libro"
                    />
                </div>

                <ProblemaLibro
                    v-if="problemaDescarga && !viendoDetalle"
                    :problema="problemaDescarga"
                    data-prueba="emisiones-problema-descarga"
                />

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
                        data-prueba="tabla-emisiones"
                    >
                        <template #id-cell="{ row }">
                            <div class="flex min-w-0 flex-col gap-1">
                                <span class="flex flex-wrap items-center gap-2 text-sm font-medium text-highlighted">
                                    <UIcon
                                        :name="LIBROS[row.original.libro].icono"
                                        class="size-4 shrink-0"
                                    />
                                    {{ LIBROS[row.original.libro].etiqueta }} · #{{ row.original.id }}
                                    <UBadge
                                        v-if="row.original.reimpresion"
                                        :label="row.original.reimpresion_de ? `Reimpresión de #${row.original.reimpresion_de}` : 'Reimpresión'"
                                        color="warning"
                                        variant="subtle"
                                        size="sm"
                                        data-prueba="emision-reimpresion"
                                    />
                                </span>
                                <span class="text-xs text-muted sm:hidden">{{ periodoEmision(row.original.desde, row.original.hasta) }}</span>
                                <span
                                    v-if="consolidado"
                                    class="text-xs text-muted"
                                >{{ nombreEmpresa(row.original.empresa_id) }}</span>
                            </div>
                        </template>
                        <template #desde-cell="{ row }">
                            <span class="text-sm">{{ periodoEmision(row.original.desde, row.original.hasta) }}</span>
                        </template>
                        <template #folio_inicial-cell="{ row }">
                            <div class="flex flex-col">
                                <span
                                    class="text-sm tabular-nums"
                                    data-prueba="emision-folios"
                                >{{ rangoFolios(row.original.folio_inicial, row.original.folio_final) }}</span>
                                <span class="text-xs text-muted">{{ row.original.paginas }} {{ row.original.paginas === 1 ? 'página' : 'páginas' }} · {{ FORMATOS_EMISION[row.original.formato].etiqueta }}</span>
                            </div>
                        </template>
                        <template #generado_en-cell="{ row }">
                            <div class="flex flex-col">
                                <span class="text-sm tabular-nums">{{ formatearFechaHora(row.original.generado_en) }}</span>
                                <span class="text-xs text-muted">{{ row.original.generado_por_nombre ?? 'Sistema' }}</span>
                            </div>
                        </template>
                        <template #acciones-cell="{ row }">
                            <div class="flex justify-end gap-1">
                                <UButton
                                    icon="i-lucide-download"
                                    color="neutral"
                                    variant="ghost"
                                    size="xs"
                                    :loading="descargando === row.original.id"
                                    :aria-label="`Descargar la emisión ${row.original.id}`"
                                    data-prueba="descargar-emision"
                                    @click="descargar(row.original)"
                                />
                                <UButton
                                    icon="i-lucide-panel-right-open"
                                    color="neutral"
                                    variant="ghost"
                                    size="xs"
                                    :aria-label="`Ver la emisión ${row.original.id}`"
                                    data-prueba="ver-emision"
                                    @click="abrirDetalle(row.original.id)"
                                />
                            </div>
                        </template>
                        <template #empty>
                            <UEmpty
                                icon="i-lucide-stamp"
                                title="Sin emisiones"
                                description="Los libros emitidos con folio aparecen aquí."
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

        <USlideover
            v-model:open="viendoDetalle"
            :title="detalle ? `${LIBROS[detalle.libro].legal} · emisión ${detalle.id}` : 'Emisión'"
            :description="detalle ? periodoEmision(detalle.desde, detalle.hasta) : undefined"
        >
            <template #body>
                <ProblemaAlerta
                    v-if="problemaDetalle"
                    :problema="problemaDetalle"
                    :reintentar="cargarDetalle"
                    :reintentando="cargandoDetalle"
                />
                <USkeleton
                    v-else-if="!detalle"
                    class="h-64 w-full"
                />
                <div
                    v-else
                    class="flex flex-col gap-4"
                    data-prueba="emision-detalle"
                >
                    <UAlert
                        v-if="detalle.reimpresion"
                        color="warning"
                        variant="subtle"
                        icon="i-lucide-copy"
                        title="Reimpresión"
                        :description="detalle.reimpresion_de ? `Sustituye la emisión ${detalle.reimpresion_de}: su rango se cruza con ella. Lleva folios nuevos.` : 'Su rango se cruza con una emisión anterior. Lleva folios nuevos.'"
                        :actions="detalle.reimpresion_de ? [{ label: `Ver emisión ${detalle.reimpresion_de}`, color: 'warning', variant: 'outline', onClick: () => abrirDetalle(detalle?.reimpresion_de ?? null) }] : undefined"
                        data-prueba="detalle-reimpresion"
                    />
                    <dl class="grid grid-cols-2 gap-3 text-sm">
                        <DatoFicha
                            etiqueta="Folios"
                            :valor="rangoFolios(detalle.folio_inicial, detalle.folio_final)"
                        />
                        <DatoFicha
                            etiqueta="Páginas"
                            :valor="String(detalle.paginas)"
                        />
                        <DatoFicha
                            etiqueta="Formato"
                            :valor="FORMATOS_EMISION[detalle.formato].etiqueta"
                        />
                        <DatoFicha
                            etiqueta="Tamaño"
                            :valor="formatearTamano(detalle.tamano)"
                        />
                        <DatoFicha
                            etiqueta="Filas"
                            :valor="String(detalle.filas)"
                        />
                        <DatoFicha
                            etiqueta="Emitida"
                            :valor="`${formatearFechaHora(detalle.generado_en)} · ${detalle.generado_por_nombre ?? 'Sistema'}`"
                        />
                    </dl>
                    <div class="flex flex-col gap-1">
                        <span class="text-xs font-medium text-muted">SHA-256 del archivo</span>
                        <code
                            class="break-all rounded-md bg-elevated p-2 font-mono text-xs text-default"
                            data-prueba="detalle-sha256"
                        >{{ detalle.sha256 }}</code>
                    </div>
                    <div class="flex flex-col gap-1">
                        <span class="text-xs font-medium text-muted">Último sello y hash de la cadena del periodo</span>
                        <code class="break-all rounded-md bg-elevated p-2 font-mono text-xs text-default">{{ detalle.ultimo_sello === null ? 'Sin sello' : `Sello ${detalle.ultimo_sello}` }} · {{ detalle.ultimo_hash ?? '—' }}</code>
                    </div>
                    <div
                        v-if="totalesDe(detalle).length"
                        class="flex flex-col gap-1"
                    >
                        <span class="text-xs font-medium text-muted">Totales del libro</span>
                        <ul class="grid grid-cols-2 gap-2 text-sm">
                            <li
                                v-for="t in totalesDe(detalle)"
                                :key="t.clave"
                                class="flex justify-between gap-2 rounded-md border border-default px-2 py-1"
                            >
                                <span class="text-muted">{{ etiquetaTotal(t.clave) }}</span>
                                <span class="font-medium tabular-nums">{{ formatearQuetzales(t.monto) }}</span>
                            </li>
                        </ul>
                    </div>
                    <ProblemaLibro
                        v-if="problemaDescarga"
                        :problema="problemaDescarga"
                        data-prueba="detalle-problema-descarga"
                    />
                    <UButton
                        label="Descargar archivo"
                        icon="i-lucide-download"
                        :loading="descargando === detalle.id"
                        class="self-start"
                        data-prueba="detalle-descargar"
                        @click="descargar(detalle)"
                    />
                </div>
            </template>
        </USlideover>
    </PanelPagina>
</template>
