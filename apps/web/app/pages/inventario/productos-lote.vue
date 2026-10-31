<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { FormSubmitEvent, SelectItem, TableColumn } from '@nuxt/ui'

/**
 * Alta de productos por lote (`POST /productos/lote`, `productos.crear_lote`; `contratos/inventario.md`
 * D.4): una tabla editable de hasta 500 filas que también se llena pegando desde Excel o un CSV. La
 * entrada a una bodega es opcional (saldo inicial; exige además `inventario.cargar_saldo_inicial`).
 * Todo o nada: los errores llegan por fila y se marcan en su celda; nada se crea si una falla.
 */
definePageMeta({ permiso: 'productos.crear_lote' })

useHead({ title: 'Alta de productos por lote · ArgosIsp' })

const toast = useToast()
const { puede } = usePermisos()
const puedeVer = computed(() => puede('inventario.ver'))
const puedeEntrada = computed(() => puede('inventario.cargar_saldo_inicial'))

const tipos = shallowRef<TipoProducto[]>([])
const bodegas = shallowRef<Bodega[]>([])
const problemaCatalogos = ref<Problem | null>(null)
const cargandoCatalogos = ref(false)

async function cargarCatalogos() {
    if (!puedeVer.value) {
        problemaCatalogos.value = { type: 'about:blank', title: 'Sin permiso', status: 403, detail: 'Falta el permiso inventario.ver para leer los tipos y las bodegas.' }
        return
    }
    cargandoCatalogos.value = true
    const [rTipos, rBodegas] = await Promise.all([useTiposProducto().activos(), useBodegas().activas()])
    cargandoCatalogos.value = false
    tipos.value = rTipos.ok ? rTipos.data : []
    bodegas.value = rBodegas.ok ? rBodegas.data : []
    problemaCatalogos.value = (!rTipos.ok ? rTipos.problema : null) ?? (!rBodegas.ok ? rBodegas.problema : null)
}
onMounted(cargarCatalogos)

const formulario = useTemplateRef('formulario')
const estado = reactive<EntradaLote>({ bodega_id: null, filas: [filaLoteVacia(), filaLoteVacia(), filaLoteVacia()] })
const enviando = ref(false)
const problema = ref<Problem | null>(null)
/** Una clave por lote: un reintento del mismo lote no crea nada dos veces (la API la exige). */
let clave = nuevaClaveIdempotencia()
watch(() => estado, () => {
    clave = nuevaClaveIdempotencia()
}, { deep: true })

type FilaTabla = { indice: number }
const filasTabla = computed<FilaTabla[]>(() => estado.filas.map((_, indice) => ({ indice })))

const itemsTipo = computed<SelectItem[]>(() => tipos.value.map(t => ({ label: t.nombre, value: t.codigo, description: `${SEGUIMIENTOS[t.seguimiento_defecto].etiqueta} · ${MODALIDADES[t.modalidad_defecto].etiqueta}` })))
const itemsBodega = computed<SelectItem[]>(() => [{ label: 'Sin entrada (solo crear los productos)', value: 0 }, ...bodegas.value.map(b => ({ label: b.nombre, value: b.id, icon: TIPOS_BODEGA[b.tipo].icono }))])
const tipoDe = (codigo: string) => tipos.value.find(t => t.codigo === codigo)
const seguimientoDe = (fila: FilaLote) => seguimientoFila(fila, tipoDe(fila.tipo)?.seguimiento_defecto)
function itemsModalidad(fila: FilaLote): SelectItem[] {
    const tipo = tipoDe(fila.tipo)
    const seguimiento = seguimientoDe(fila)
    return [
        { label: tipo ? `La del tipo (${MODALIDADES[tipo.modalidad_defecto].etiqueta})` : 'La del tipo', value: '' },
        ...(Object.keys(MODALIDADES) as ModalidadProducto[]).filter(m => modalidadCompatible(m, seguimiento)).map(m => ({ label: MODALIDADES[m].etiqueta, value: m })),
    ]
}

const columnas: TableColumn<FilaTabla>[] = [
    { id: 'n', header: '#', meta: { class: { td: 'w-0 text-muted tabular-nums' } } },
    { id: 'sku', header: 'SKU' },
    { id: 'nombre', header: 'Nombre' },
    { id: 'tipo', header: 'Tipo' },
    { id: 'modalidad', header: 'Modalidad' },
    { id: 'unidad', header: 'Unidad' },
    { id: 'precio', header: 'Precio venta' },
    { id: 'entrada', header: 'Entrada' },
    { id: 'quitar', header: '', meta: { class: { td: 'w-0' } } },
]

function agregarFila() {
    if (estado.filas.length < MAXIMO_FILAS_LOTE) {
        estado.filas.push(filaLoteVacia(tipos.value.find(t => t.codigo === 'material')?.codigo ?? tipos.value[0]?.codigo ?? 'material'))
    }
}

function quitarFila(indice: number) {
    estado.filas.splice(indice, 1)
}

/* Pegar desde Excel o CSV */
const pegarAbierto = ref(false)
const textoPegado = ref('')
const avisoPegado = ref<string | null>(null)

function agregarPegado() {
    const nuevas = filasDesdeTexto(textoPegado.value, tipos.value)
    if (!nuevas.length) {
        avisoPegado.value = 'No se encontró ninguna fila'
        return
    }
    const actuales = estado.filas.filter(f => !filaLoteEnBlanco(f))
    const todas = [...actuales, ...nuevas]
    estado.filas = todas.slice(0, MAXIMO_FILAS_LOTE)
    pegarAbierto.value = false
    textoPegado.value = ''
    avisoPegado.value = null
    toast.add({ title: `${nuevas.length} ${nuevas.length === 1 ? 'fila agregada' : 'filas agregadas'}`, description: todas.length > MAXIMO_FILAS_LOTE ? `Se quedan las primeras ${MAXIMO_FILAS_LOTE}.` : 'Revisa el tipo de cada una antes de crear.', icon: 'i-lucide-clipboard-paste', color: 'info' })
}

async function leerArchivo(archivo: unknown) {
    if (archivo instanceof File) {
        textoPegado.value = await archivo.text()
    }
}

/* Crear */
const filasConError = ref<number[]>([])
const creados = shallowRef<Producto[]>([])

async function crear(evento: FormSubmitEvent<EntradaLote>) {
    const datos = { ...evento.data, bodega_id: evento.data.bodega_id || null, filas: evento.data.filas }
    enviando.value = true
    problema.value = null
    filasConError.value = []
    const resultado = await useProductos().crearLote(cuerpoLote(datos, tipos.value), clave)
    enviando.value = false
    if (resultado.ok) {
        creados.value = resultado.data.data
        toast.add({ title: `${resultado.data.data.length} productos creados`, description: resultado.data.movimientos.length ? `Con ${resultado.data.movimientos.length} entradas de saldo inicial.` : undefined, icon: 'i-lucide-circle-check', color: 'success' })
        estado.filas = [filaLoteVacia()]
        return
    }
    const errores = erroresDeFormulario(resultado.problema).map(e => ({ ...e, name: e.name ? campoFilaLote(e.name) : e.name }))
    filasConError.value = [...new Set(errores.flatMap(e => /^filas\.(\d+)\./.exec(e.name ?? '')?.[1] ?? []).map(Number))]
    const delDetalle = filaDeDetalle(resultado.problema.detail)
    if (delDetalle !== null) {
        filasConError.value = [...new Set([...filasConError.value, delDetalle])]
    }
    if (errores.length) {
        formulario.value?.setErrors(errores)
    }
    problema.value = resultado.problema
}

function enviarLote() {
    estado.filas = estado.filas.filter(f => !filaLoteEnBlanco(f))
    if (!estado.filas.length) {
        estado.filas = [filaLoteVacia()]
    }
    void formulario.value?.submit()
}
</script>

<template>
    <PanelPagina
        id="inventario-productos-lote"
        titulo="Alta de productos por lote"
        icono="i-lucide-sheet"
    >
        <template #acciones>
            <UButton
                v-if="puedeVer"
                label="Productos"
                icon="i-lucide-arrow-left"
                color="neutral"
                variant="ghost"
                class="hidden sm:inline-flex"
                to="/inventario/productos"
            />
        </template>

        <ProblemaAlerta
            v-if="problemaCatalogos"
            :problema="problemaCatalogos"
            :reintentar="cargarCatalogos"
            :reintentando="cargandoCatalogos"
        />
        <UForm
            v-else
            ref="formulario"
            :schema="esquemaLote"
            :state="estado"
            :validate-on="['change']"
            class="flex flex-col gap-4"
            @submit="crear"
        >
            <div class="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
                <UFormField
                    v-if="puedeEntrada"
                    label="Entrada a una bodega (opcional)"
                    name="bodega_id"
                    help="Saldo inicial de lo que ya hay: la cantidad y el costo de cada fila, o sus series."
                    class="w-full lg:max-w-md"
                >
                    <USelect
                        :model-value="estado.bodega_id ?? 0"
                        :items="itemsBodega"
                        class="w-full"
                        data-prueba="lote-bodega"
                        @update:model-value="v => estado.bodega_id = typeof v === 'number' && v > 0 ? v : null"
                    />
                </UFormField>
                <div class="flex flex-wrap gap-2">
                    <UButton
                        label="Pegar desde Excel o CSV"
                        icon="i-lucide-clipboard-paste"
                        color="neutral"
                        variant="outline"
                        data-prueba="lote-pegar"
                        @click="pegarAbierto = true"
                    />
                    <UButton
                        label="Agregar fila"
                        icon="i-lucide-plus"
                        color="neutral"
                        variant="outline"
                        :disabled="estado.filas.length >= MAXIMO_FILAS_LOTE"
                        data-prueba="lote-agregar"
                        @click="agregarFila"
                    />
                </div>
            </div>

            <UTable
                :data="filasTabla"
                :columns="columnas"
                :ui="{ td: 'py-2 align-top', th: 'whitespace-nowrap' }"
                class="rounded-md border border-default"
                data-prueba="tabla-lote"
            >
                <template #n-cell="{ row }">
                    <span
                        class="inline-flex items-center gap-1 pt-1.5 text-xs"
                        :class="filasConError.includes(row.original.indice) ? 'text-error' : ''"
                    >
                        <UIcon
                            v-if="filasConError.includes(row.original.indice)"
                            name="i-lucide-circle-alert"
                            class="size-3.5"
                        />
                        {{ row.original.indice + 1 }}
                    </span>
                </template>
                <template #sku-cell="{ row }">
                    <UFormField
                        :name="`filas.${row.original.indice}.sku`"
                        class="min-w-28"
                    >
                        <UInput
                            v-model="estado.filas[row.original.indice]!.sku"
                            class="w-full font-mono"
                            :aria-label="`SKU de la fila ${row.original.indice + 1}`"
                            data-prueba="lote-sku"
                        />
                    </UFormField>
                </template>
                <template #nombre-cell="{ row }">
                    <UFormField
                        :name="`filas.${row.original.indice}.nombre`"
                        class="min-w-48"
                    >
                        <UInput
                            v-model="estado.filas[row.original.indice]!.nombre"
                            class="w-full"
                            :aria-label="`Nombre de la fila ${row.original.indice + 1}`"
                            data-prueba="lote-nombre"
                        />
                    </UFormField>
                </template>
                <template #tipo-cell="{ row }">
                    <UFormField
                        :name="`filas.${row.original.indice}.tipo`"
                        class="min-w-36"
                    >
                        <USelect
                            v-model="estado.filas[row.original.indice]!.tipo"
                            :items="itemsTipo"
                            placeholder="Tipo"
                            class="w-full"
                            :aria-label="`Tipo de la fila ${row.original.indice + 1}`"
                            data-prueba="lote-tipo"
                        />
                    </UFormField>
                </template>
                <template #modalidad-cell="{ row }">
                    <UFormField
                        :name="`filas.${row.original.indice}.modalidad`"
                        class="min-w-36"
                    >
                        <USelect
                            v-model="estado.filas[row.original.indice]!.modalidad"
                            :items="itemsModalidad(estado.filas[row.original.indice]!)"
                            class="w-full"
                            :aria-label="`Modalidad de la fila ${row.original.indice + 1}`"
                        />
                    </UFormField>
                </template>
                <template #unidad-cell="{ row }">
                    <UFormField
                        :name="`filas.${row.original.indice}.unidad`"
                        class="min-w-24"
                    >
                        <UInput
                            v-model="estado.filas[row.original.indice]!.unidad"
                            placeholder="unidad"
                            class="w-full"
                            :aria-label="`Unidad de la fila ${row.original.indice + 1}`"
                        />
                    </UFormField>
                </template>
                <template #precio-cell="{ row }">
                    <UFormField
                        :name="`filas.${row.original.indice}.precio_venta`"
                        class="min-w-28"
                    >
                        <UInput
                            v-model="estado.filas[row.original.indice]!.precio_venta"
                            inputmode="decimal"
                            placeholder="0.00"
                            class="w-full"
                            :aria-label="`Precio de venta de la fila ${row.original.indice + 1}`"
                        />
                    </UFormField>
                </template>
                <template #entrada-cell="{ row }">
                    <div
                        v-if="estado.bodega_id"
                        class="flex min-w-56 flex-col gap-1"
                    >
                        <UFormField
                            v-if="seguimientoDe(estado.filas[row.original.indice]!) === 'serie'"
                            :name="`filas.${row.original.indice}.series`"
                        >
                            <UInput
                                v-model="estado.filas[row.original.indice]!.series"
                                placeholder="Series o MAC, separadas por coma"
                                class="w-full font-mono"
                                :aria-label="`Series de la fila ${row.original.indice + 1}`"
                                data-prueba="lote-series"
                            />
                        </UFormField>
                        <UFormField
                            v-else
                            :name="`filas.${row.original.indice}.cantidad`"
                        >
                            <UInput
                                v-model="estado.filas[row.original.indice]!.cantidad"
                                inputmode="decimal"
                                placeholder="Cantidad"
                                class="w-full"
                                :aria-label="`Cantidad de la fila ${row.original.indice + 1}`"
                                data-prueba="lote-cantidad"
                            />
                        </UFormField>
                        <UFormField :name="`filas.${row.original.indice}.costo_unitario`">
                            <UInput
                                v-model="estado.filas[row.original.indice]!.costo_unitario"
                                inputmode="decimal"
                                placeholder="Costo unitario"
                                class="w-full"
                                :aria-label="`Costo unitario de la fila ${row.original.indice + 1}`"
                                data-prueba="lote-costo"
                            >
                                <template #leading>
                                    <span class="text-xs text-muted">Q</span>
                                </template>
                            </UInput>
                        </UFormField>
                    </div>
                    <span
                        v-else
                        class="pt-1.5 text-xs text-muted"
                    >Sin entrada</span>
                </template>
                <template #quitar-cell="{ row }">
                    <UButton
                        icon="i-lucide-x"
                        color="neutral"
                        variant="ghost"
                        size="sm"
                        :disabled="estado.filas.length === 1"
                        :aria-label="`Quitar la fila ${row.original.indice + 1}`"
                        @click="quitarFila(row.original.indice)"
                    />
                </template>
            </UTable>
            <UFormField name="filas" />

            <ProblemaAlerta
                v-if="problema"
                :problema="problema"
                con-errores
            />
            <UAlert
                v-if="creados.length"
                color="success"
                variant="subtle"
                icon="i-lucide-circle-check"
                :title="`${creados.length} productos creados`"
                :description="creados.map(p => p.sku).join(', ')"
                data-prueba="lote-creados"
            />

            <div class="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-end">
                <span class="text-xs text-muted sm:mr-auto">{{ estado.filas.filter(f => !filaLoteEnBlanco(f)).length }} de {{ MAXIMO_FILAS_LOTE }} filas · todo o nada</span>
                <UButton
                    label="Crear productos"
                    icon="i-lucide-check"
                    :loading="enviando"
                    data-prueba="lote-crear"
                    @click="enviarLote"
                />
            </div>
        </UForm>

        <UModal
            v-model:open="pegarAbierto"
            title="Pegar desde Excel o CSV"
            description="Copia las celdas en Excel o abre un CSV. Columnas: SKU, nombre, tipo, unidad, modalidad, precio, cantidad, costo, series (la primera fila puede ser el encabezado)."
        >
            <template #body>
                <div class="flex flex-col gap-3">
                    <UTextarea
                        v-model="textoPegado"
                        :rows="8"
                        class="w-full font-mono"
                        placeholder="SKU, nombre, tipo, unidad, modalidad, precio, cantidad, costo, series"
                        aria-label="Filas pegadas"
                        data-prueba="lote-texto"
                    />
                    <UFileUpload
                        accept=".csv,text/csv,text/plain"
                        label="O elige un archivo CSV"
                        icon="i-lucide-file-spreadsheet"
                        layout="list"
                        class="w-full"
                        @update:model-value="leerArchivo"
                    />
                    <UAlert
                        v-if="avisoPegado"
                        color="warning"
                        variant="subtle"
                        :title="avisoPegado"
                    />
                </div>
            </template>
            <template #footer>
                <div class="flex w-full justify-end gap-2">
                    <UButton
                        label="Cancelar"
                        color="neutral"
                        variant="ghost"
                        @click="pegarAbierto = false"
                    />
                    <UButton
                        label="Agregar filas"
                        icon="i-lucide-clipboard-paste"
                        data-prueba="lote-agregar-pegado"
                        @click="agregarPegado"
                    />
                </div>
            </template>
        </UModal>
    </PanelPagina>
</template>
