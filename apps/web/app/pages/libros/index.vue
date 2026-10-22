<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { SelectItem, TabsItem } from '@nuxt/ui'

/**
 * Libros legales (A3, fase 6 PR D): vista previa «Borrador sin folio» del Diario, Mayor, Ventas y
 * Compras de cualquier rango (tabla con las filas de total y saldo en negrita, o el PDF con la marca de
 * agua embebido) y descarga en CSV, Excel o PDF; los folios de cada libro (`GET /libros/folios`); y la
 * emisión oficial con folio (`libros.emitir`), con confirmación porque gasta folios. Sin empresa
 * elegida («Todas») no hay libro que mostrar: se pide elegirla. Con un error, «Reintentar» y nada
 * inventado.
 */
definePageMeta({ permiso: 'libros.ver' })

useHead({ title: 'Libros legales · ArgosIsp' })

const route = useRoute()
const router = useRouter()
const toast = useToast()
const { puede } = usePermisos()
const { conSelector, empresaId, empresas, nombre: nombreEmpresa } = useEmpresaActiva()

/** La empresa del libro: la elegida o, con una sola, esa. Con «Todas», ninguna. */
const empresa = computed<number | null>(() => empresaId.value ?? (conSelector.value ? null : (empresas.value[0]?.id ?? null)))
const sinEmpresa = computed(() => empresa.value === null)

const hoy = hoyGuatemala()
const mesAnterior = mesesRecientes(hoy, 2)[1] ?? hoy.slice(0, 7)

function textoQuery(valor: unknown): string {
    return typeof valor === 'string' ? valor : ''
}

const FECHA = /^\d{4}-\d{2}-\d{2}$/
const libro = ref<LibroEmitible>(esLibroEmitible(route.query.libro) ? route.query.libro : 'diario')
const desde = ref(FECHA.test(textoQuery(route.query.desde)) ? textoQuery(route.query.desde) : primerDiaMes(mesAnterior))
const hasta = ref(FECHA.test(textoQuery(route.query.hasta)) ? textoQuery(route.query.hasta) : ultimoDiaMes(mesAnterior))

const itemsLibro: TabsItem[] = LIBROS_EMITIBLES.map(l => ({ label: LIBROS[l].etiqueta, value: l, icon: LIBROS[l].icono }))

/** Mes rápido: pone el rango en el primer y último día del mes. */
const PERSONALIZADO = 'personalizado'
const itemsMes: SelectItem[] = [...mesesRecientes(hoy, 24).map(m => ({ label: etiquetaPeriodo(m), value: m })), { label: 'Personalizado', value: PERSONALIZADO }]
const mes = computed<string>({
    get: () => (desde.value.endsWith('-01') && hasta.value === ultimoDiaMes(desde.value) ? desde.value.slice(0, 7) : PERSONALIZADO),
    set: (valor) => {
        if (valor !== PERSONALIZADO) {
            desde.value = primerDiaMes(valor)
            hasta.value = ultimoDiaMes(valor)
        }
    },
})

const errorRango = computed(() => {
    const revision = esquemaVistaPrevia.safeParse({ desde: desde.value, hasta: hasta.value })
    return revision.success ? null : (revision.error.issues[0]?.message ?? 'Rango inválido')
})

function query(): QueryVistaPrevia {
    return { empresa_id: empresa.value ?? undefined, desde: desde.value, hasta: hasta.value }
}

/* Folios por libro. */
const folios = shallowRef<FoliosLibro[]>([])
const cargandoFolios = ref(false)
const problemaFolios = ref<Problem | null>(null)

async function cargarFolios() {
    if (empresa.value === null) {
        return
    }
    cargandoFolios.value = true
    const resultado = await useLibros().folios(empresa.value)
    cargandoFolios.value = false
    folios.value = resultado.ok ? resultado.data : []
    problemaFolios.value = resultado.ok ? null : resultado.problema
}

const foliosEmitibles = computed(() => LIBROS_EMITIBLES.map(l => folios.value.find(f => f.libro === l)).filter((f): f is FoliosLibro => !!f))

/* Vista previa (JSON). */
const reporte = shallowRef<ReporteLibroCualquiera | null>(null)
const cargando = ref(false)
const problema = ref<Problem | null>(null)
let pedido = 0

async function cargar() {
    if (empresa.value === null || errorRango.value) {
        reporte.value = null
        return
    }
    const actual = ++pedido
    cargando.value = true
    const resultado = await useLibros().vistaPrevia(libro.value, query())
    if (actual !== pedido) {
        return
    }
    cargando.value = false
    reporte.value = resultado.ok ? resultado.data : null
    problema.value = resultado.ok ? null : resultado.problema
    if (vista.value === 'pdf') {
        void cargarPdf()
    }
}

const rangoAplicado = computed(() => {
    const filtros = reporte.value?.filtros ?? {}
    const d = typeof filtros.desde === 'string' ? filtros.desde : null
    const h = typeof filtros.hasta === 'string' ? filtros.hasta : null
    return d && h ? `Del ${formatearFecha(d)} al ${formatearFecha(h)}` : null
})

/* PDF del borrador, embebido (`Content-Disposition: inline`). */
const vista = ref<'tabla' | 'pdf'>('tabla')
const itemsVista: TabsItem[] = [
    { label: 'Tabla', value: 'tabla', icon: 'i-lucide-table' },
    { label: 'PDF', value: 'pdf', icon: 'i-lucide-file-text' },
]
const urlPdf = ref<string | null>(null)
const cargandoPdf = ref(false)
const problemaPdf = ref<Problem | null>(null)

function liberarPdf() {
    if (urlPdf.value) {
        URL.revokeObjectURL(urlPdf.value)
        urlPdf.value = null
    }
}

async function cargarPdf() {
    if (empresa.value === null || errorRango.value) {
        return
    }
    cargandoPdf.value = true
    problemaPdf.value = null
    const resultado = await useLibros().borrador(libro.value, query(), 'pdf')
    cargandoPdf.value = false
    liberarPdf()
    if (!resultado.ok) {
        problemaPdf.value = resultado.problema
        return
    }
    const blob = resultado.data.type ? resultado.data : new Blob([resultado.data], { type: 'application/pdf' })
    urlPdf.value = URL.createObjectURL(blob)
}

watch(vista, (valor) => {
    if (valor === 'pdf' && !urlPdf.value) {
        void cargarPdf()
    }
})

/* Descargas del borrador. */
const descargando = ref<FormatoVistaPrevia | null>(null)

async function descargar(formato: FormatoVistaPrevia) {
    if (descargando.value || empresa.value === null || errorRango.value) {
        return
    }
    descargando.value = formato
    const resultado = await useLibros().borrador(libro.value, query(), formato)
    descargando.value = null
    if (!resultado.ok) {
        toast.add({ title: 'No se pudo descargar el borrador', description: resultado.problema.detail ?? resultado.problema.title, icon: 'i-lucide-circle-alert', color: 'error' })
        return
    }
    guardarBlob(resultado.data, nombreBorrador(libro.value, desde.value, hasta.value, formato))
}

/* Emisión. */
const emitiendo = ref(false)
const ultimaEmision = shallowRef<EmisionLibro | null>(null)
const descargandoEmision = ref(false)
const problemaDescarga = ref<Problem | null>(null)

function alEmitir(emision: EmisionLibro) {
    ultimaEmision.value = emision
    problemaDescarga.value = null
    toast.add({
        title: emision.reimpresion ? 'Reimpresión emitida' : 'Libro emitido',
        description: `${LIBROS[emision.libro].legal} · ${periodoEmision(emision.desde, emision.hasta)} · ${rangoFolios(emision.folio_inicial, emision.folio_final)}`,
        icon: 'i-lucide-stamp',
        color: 'success',
    })
    void cargarFolios()
}

async function descargarEmision(emision: EmisionLibro) {
    descargandoEmision.value = true
    problemaDescarga.value = null
    const resultado = await useLibros().archivoEmision(emision.id)
    descargandoEmision.value = false
    if (!resultado.ok) {
        problemaDescarga.value = resultado.problema
        return
    }
    guardarBlob(resultado.data, nombreArchivoEmision(emision))
}

watch([libro, desde, hasta], () => {
    void router.replace({ query: { ...route.query, libro: libro.value, desde: desde.value, hasta: hasta.value } })
    liberarPdf()
    void cargar()
})

onMounted(() => {
    void cargarFolios()
    void cargar()
})
onBeforeUnmount(liberarPdf)
</script>

<template>
    <PanelPagina
        id="libros-legales"
        titulo="Libros legales"
        icono="i-lucide-book-marked"
    >
        <div class="flex flex-col gap-6">
            <LibrosNavegacion />

            <UAlert
                v-if="sinEmpresa"
                color="warning"
                variant="subtle"
                icon="i-lucide-building-2"
                title="Elija una empresa"
                description="Cada libro es de una empresa (NIT): con «Todas» no hay libro que mostrar ni emitir. Elija la empresa en el selector de arriba."
                data-prueba="libros-sin-empresa"
            />

            <template v-else>
                <section
                    class="flex flex-col gap-3"
                    aria-label="Folios por libro"
                >
                    <div class="flex flex-wrap items-center justify-between gap-2">
                        <h3 class="text-base font-semibold text-highlighted">
                            Folios
                        </h3>
                        <UButton
                            v-if="puede('libros.habilitar')"
                            to="/libros/habilitaciones"
                            label="Habilitaciones"
                            icon="i-lucide-book-plus"
                            color="neutral"
                            variant="outline"
                            size="sm"
                        />
                    </div>
                    <ProblemaAlerta
                        v-if="problemaFolios"
                        :problema="problemaFolios"
                        :reintentar="cargarFolios"
                        :reintentando="cargandoFolios"
                    />
                    <USkeleton
                        v-else-if="cargandoFolios && !folios.length"
                        class="h-24 w-full"
                    />
                    <ul
                        v-else
                        class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
                    >
                        <li
                            v-for="f in foliosEmitibles"
                            :key="f.libro"
                            class="flex flex-col gap-1 rounded-lg border p-3"
                            :class="f.libro === libro ? 'border-primary/50 bg-primary/5' : 'border-default'"
                            :data-libro="f.libro"
                            data-prueba="folios-libro"
                        >
                            <span class="flex items-center justify-between gap-2">
                                <span class="flex items-center gap-2 text-sm font-medium text-highlighted">
                                    <UIcon
                                        :name="LIBROS[f.libro].icono"
                                        class="size-4 shrink-0"
                                    />
                                    {{ LIBROS[f.libro].etiqueta }}
                                </span>
                                <UBadge
                                    :label="estadoFolios(f).etiqueta"
                                    :color="estadoFolios(f).color"
                                    variant="subtle"
                                    size="sm"
                                    data-prueba="folios-estado"
                                />
                            </span>
                            <span
                                class="text-base font-semibold tabular-nums"
                                :class="f.siguiente === null ? 'text-muted' : 'text-highlighted'"
                                data-prueba="folios-siguiente"
                            >{{ f.siguiente === null ? 'Sin folios habilitados' : `Siguiente folio: ${f.siguiente}` }}</span>
                            <span
                                v-if="f.ultimo_habilitado !== null"
                                class="text-xs text-muted"
                            >Habilitados {{ f.primero }}–{{ f.ultimo_habilitado }} · usados hasta {{ f.ultimo_usado ?? '—' }}</span>
                        </li>
                    </ul>
                </section>

                <section
                    class="flex flex-col gap-3"
                    aria-label="Vista previa"
                >
                    <UTabs
                        v-model="libro"
                        :items="itemsLibro"
                        :content="false"
                        size="sm"
                        class="w-full"
                        :ui="{ list: 'overflow-x-auto' }"
                        data-prueba="libros-libro"
                    />
                    <p class="text-sm text-muted">
                        {{ LIBROS[libro].descripcion }}
                    </p>

                    <div class="grid gap-3 sm:grid-cols-3">
                        <UFormField label="Mes">
                            <USelect
                                v-model="mes"
                                :items="itemsMes"
                                class="w-full"
                                data-prueba="libros-mes"
                            />
                        </UFormField>
                        <UFormField label="Desde">
                            <UInput
                                v-model="desde"
                                type="date"
                                class="w-full"
                                data-prueba="libros-desde"
                            />
                        </UFormField>
                        <UFormField
                            label="Hasta"
                            :error="errorRango ?? undefined"
                        >
                            <UInput
                                v-model="hasta"
                                type="date"
                                class="w-full"
                                data-prueba="libros-hasta"
                            />
                        </UFormField>
                    </div>

                    <div class="flex flex-wrap items-center justify-between gap-2">
                        <div class="flex flex-wrap items-center gap-2">
                            <UBadge
                                label="Borrador sin folio"
                                color="warning"
                                variant="subtle"
                                icon="i-lucide-file-pen-line"
                                data-prueba="libros-borrador"
                            />
                            <span
                                v-if="rangoAplicado"
                                class="text-sm text-muted"
                                data-prueba="libros-rango"
                            >{{ rangoAplicado }}</span>
                        </div>
                        <div class="flex flex-wrap gap-2">
                            <UButton
                                label="CSV"
                                icon="i-lucide-file-down"
                                color="neutral"
                                variant="outline"
                                size="sm"
                                :loading="descargando === 'csv'"
                                :disabled="!!errorRango"
                                data-prueba="borrador-csv"
                                @click="descargar('csv')"
                            />
                            <UButton
                                label="Excel"
                                icon="i-lucide-file-spreadsheet"
                                color="neutral"
                                variant="outline"
                                size="sm"
                                :loading="descargando === 'xlsx'"
                                :disabled="!!errorRango"
                                data-prueba="borrador-xlsx"
                                @click="descargar('xlsx')"
                            />
                            <UButton
                                label="PDF"
                                icon="i-lucide-file-text"
                                color="neutral"
                                variant="outline"
                                size="sm"
                                :loading="descargando === 'pdf'"
                                :disabled="!!errorRango"
                                data-prueba="borrador-pdf"
                                @click="descargar('pdf')"
                            />
                            <UButton
                                v-if="puede('libros.emitir')"
                                label="Emitir con folio"
                                icon="i-lucide-stamp"
                                size="sm"
                                data-prueba="abrir-emitir"
                                @click="emitiendo = true"
                            />
                        </div>
                    </div>

                    <UAlert
                        v-if="ultimaEmision"
                        color="success"
                        variant="subtle"
                        icon="i-lucide-stamp"
                        :title="`${ultimaEmision.reimpresion ? 'Reimpresión' : 'Emisión'} ${ultimaEmision.id} · ${rangoFolios(ultimaEmision.folio_inicial, ultimaEmision.folio_final)}`"
                        :description="`${LIBROS[ultimaEmision.libro].legal} · ${periodoEmision(ultimaEmision.desde, ultimaEmision.hasta)} · ${ultimaEmision.paginas} ${ultimaEmision.paginas === 1 ? 'página' : 'páginas'} en ${FORMATOS_EMISION[ultimaEmision.formato].etiqueta}${ultimaEmision.reimpresion_de ? ` · sustituye la emisión ${ultimaEmision.reimpresion_de}` : ''}`"
                        :actions="[
                            { label: 'Descargar', icon: 'i-lucide-download', color: 'success', variant: 'outline', loading: descargandoEmision, onClick: () => descargarEmision(ultimaEmision!) },
                            { label: 'Ver en emisiones', icon: 'i-lucide-arrow-right', color: 'neutral', variant: 'ghost', to: `/libros/emisiones?emision=${ultimaEmision.id}` },
                        ]"
                        data-prueba="libros-emitido"
                    />
                    <ProblemaLibro
                        v-if="problemaDescarga"
                        :problema="problemaDescarga"
                    />

                    <UTabs
                        v-model="vista"
                        :items="itemsVista"
                        :content="false"
                        variant="link"
                        size="sm"
                        data-prueba="libros-vista"
                    />

                    <template v-if="vista === 'tabla'">
                        <ProblemaAlerta
                            v-if="problema"
                            :problema="problema"
                            :reintentar="cargar"
                            :reintentando="cargando"
                        />
                        <USkeleton
                            v-else-if="!reporte"
                            class="h-64 w-full"
                        />
                        <LibroTabla
                            v-else
                            :reporte="reporte"
                            :cargando="cargando"
                            :titulo="LIBROS[libro].legal"
                        />
                    </template>
                    <template v-else>
                        <ProblemaAlerta
                            v-if="problemaPdf"
                            :problema="problemaPdf"
                            :reintentar="cargarPdf"
                            :reintentando="cargandoPdf"
                        />
                        <USkeleton
                            v-else-if="cargandoPdf || !urlPdf"
                            class="aspect-[11/8.5] w-full"
                        />
                        <iframe
                            v-else
                            :src="urlPdf"
                            :title="`${LIBROS[libro].legal}, borrador sin folio (PDF)`"
                            class="h-[32rem] w-full rounded-md border border-default bg-elevated lg:h-[40rem]"
                            data-prueba="libros-pdf"
                        />
                    </template>
                </section>
            </template>
        </div>

        <EmitirLibroModal
            v-if="puede('libros.emitir') && empresa !== null"
            v-model:open="emitiendo"
            :libro="libro"
            :empresa-id="empresa"
            :empresa="conSelector ? nombreEmpresa(empresa) : null"
            :desde-inicial="desde.slice(0, 7)"
            :hasta-inicial="hasta.slice(0, 7)"
            @hecho="alEmitir"
        />
    </PanelPagina>
</template>
