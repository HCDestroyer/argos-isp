<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { FormSubmitEvent, SelectItem, TableColumn } from '@nuxt/ui'
import Decimal from 'decimal.js'
import * as z from 'zod'

/**
 * Conteo físico (tablero NuevoConteo, A3 fase C): «Lo contado» con todo lo que hay en la bodega
 * (sistema, contado, diferencia y su valor) y las pastillas «Todos / Con diferencia / Sin contar».
 * Lo contado de un producto por cantidad se escribe en su fila y se guarda al salir del campo o con
 * Enter (capturar otra vez reemplaza la línea); los equipos por serie se escanean («Escanear
 * series»). A la derecha, «Antes de cerrar» con el faltante, el sobrante y el ajuste neto; cerrar
 * ajusta el kardex y la contabilidad (faltante a 5.6.02, sobrante a 4.2.04) y pide confirmación.
 * Permisos: `inventario.contar`, `inventario.cerrar_conteo` e `inventario.cancelar_conteo`.
 */
definePageMeta({ permiso: 'inventario.ver' })

const route = useRoute()
const toast = useToast()
const { puede } = usePermisos()
const conteoId = computed(() => Number(route.params.id))

const conteo = shallowRef<ConteoInventarioDetalle | null>(null)
const cargando = ref(true)
const problema = ref<Problem | null>(null)
const productos = shallowRef<Producto[]>([])
const existencias = shallowRef<ExistenciaInventario[]>([])

const codigo = computed(() => (conteo.value ? `C-${String(conteo.value.id).padStart(3, '0')}` : ''))
useHead(() => ({ title: `Conteo ${codigo.value || `#${route.params.id}`} · ArgosIsp` }))

async function cargar() {
    cargando.value = true
    problema.value = null
    const resultado = await useConteosInventario().ver(conteoId.value)
    cargando.value = false
    conteo.value = resultado.ok ? resultado.data : null
    problema.value = resultado.ok ? null : resultado.problema
}

onMounted(async () => {
    await cargar()
    if (!conteo.value) {
        return
    }
    const [p, e] = await Promise.all([useProductos().activos(), useInventario().existencias({ bodega_id: conteo.value.bodega_id, limit: 200 })])
    productos.value = p.ok ? p.data.filter(x => x.empresa_id === conteo.value?.empresa_id) : []
    existencias.value = e.ok ? e.data.data : []
})

const abierto = computed(() => conteo.value?.estado === 'abierto')
const puedeContar = computed(() => abierto.value && puede('inventario.contar'))
const faltante = computed(() => (conteo.value?.lineas ?? []).reduce((t, l) => (l.valor_diferencia && new Decimal(l.valor_diferencia).isNegative() ? t.plus(new Decimal(l.valor_diferencia).abs()) : t), new Decimal(0)))
const sobrante = computed(() => (conteo.value?.lineas ?? []).reduce((t, l) => (l.valor_diferencia && new Decimal(l.valor_diferencia).isPositive() ? t.plus(l.valor_diferencia) : t), new Decimal(0)))
const totalFaltante = computed(() => (abierto.value ? faltante.value : new Decimal(conteo.value?.faltante ?? 0)))
const totalSobrante = computed(() => (abierto.value ? sobrante.value : new Decimal(conteo.value?.sobrante ?? 0)))
const neto = computed(() => totalSobrante.value.minus(totalFaltante.value))

type Linea = ConteoInventarioDetalle['lineas'][number]

/** Una fila por producto: lo capturado o, si aún no se cuenta, lo que dice el sistema hoy. */
interface Fila {
    producto_id: number
    nombre: string
    sku: string
    serie: boolean
    sistema: string
    linea: Linea | null
}

const productosExtra = ref<number[]>([])

const filas = computed<Fila[]>(() => {
    const lineas = conteo.value?.lineas ?? []
    const resultado: Fila[] = lineas.map(l => ({ producto_id: l.producto_id, nombre: l.producto_nombre, sku: l.producto_sku, serie: l.seguimiento === 'serie', sistema: l.esperado, linea: l }))
    if (abierto.value) {
        for (const e of existencias.value) {
            if (!resultado.some(f => f.producto_id === e.producto_id) && new Decimal(e.cantidad).greaterThan(0)) {
                const p = productos.value.find(x => x.id === e.producto_id)
                resultado.push({ producto_id: e.producto_id, nombre: e.producto_nombre, sku: e.producto_sku, serie: p?.seguimiento === 'serie', sistema: e.cantidad, linea: null })
            }
        }
        for (const id of productosExtra.value) {
            const p = productos.value.find(x => x.id === id)
            if (p && !resultado.some(f => f.producto_id === id)) {
                resultado.push({ producto_id: id, nombre: p.nombre, sku: p.sku, serie: p.seguimiento === 'serie', sistema: '0', linea: null })
            }
        }
    }
    return resultado
})

type Pastilla = 'todos' | 'diferencia' | 'sin_contar'
const pastilla = ref<Pastilla>('todos')
const conDiferencia = computed(() => filas.value.filter(f => f.linea && !new Decimal(f.linea.diferencia).isZero()))
const sinContar = computed(() => filas.value.filter(f => !f.linea))
const visibles = computed(() => (pastilla.value === 'diferencia' ? conDiferencia.value : pastilla.value === 'sin_contar' ? sinContar.value : filas.value))

const columnas: TableColumn<Fila>[] = [
    { id: 'producto', header: 'Producto', meta: { class: { td: 'whitespace-normal' } } },
    { id: 'sistema', header: 'Sistema', meta: { class: { th: 'text-end', td: 'text-end' } } },
    { id: 'contado', header: 'Contado' },
    { id: 'diferencia', header: 'Diferencia' },
    { id: 'valor', header: 'Valor', meta: { class: { th: 'text-end hidden sm:table-cell', td: 'text-end hidden sm:table-cell' } } },
]

/* Captura en la fila (por cantidad) */
const borradores = reactive<Record<number, string | undefined>>({})
const costos = reactive<Record<number, string | undefined>>({})
const guardando = ref<number | null>(null)
const errorFila = reactive<Record<number, string | undefined>>({})

function valorContado(f: Fila): string {
    return borradores[f.producto_id] ?? (f.linea ? formatearCantidad(f.linea.contado).replaceAll(',', '') : '')
}

async function capturarFila(f: Fila) {
    const texto = (borradores[f.producto_id] ?? '').trim()
    if (borradores[f.producto_id] === undefined || (f.linea && new Decimal(f.linea.contado).equals(texto || '-1'))) {
        return
    }
    if (!/^\d{1,11}(\.\d{1,3})?$/.test(texto)) {
        errorFila[f.producto_id] = 'Cantidad contada (0 si no hay)'
        return
    }
    errorFila[f.producto_id] = undefined
    guardando.value = f.producto_id
    const costo = (costos[f.producto_id] ?? '').trim()
    const resultado = await useConteosInventario().capturar(conteoId.value, { producto_id: f.producto_id, contado: texto, costo_unitario: /^\d{1,12}(\.\d{1,6})?$/.test(costo) ? costo : null })
    guardando.value = null
    if (!resultado.ok) {
        errorFila[f.producto_id] = resultado.problema.detail ?? resultado.problema.title
        return
    }
    conteo.value = resultado.data
    borradores[f.producto_id] = undefined
}

/* Escanear series (por serie) */
const esquemaSeries = z.object({
    producto_id: z.number({ message: 'Elige el producto' }).int().positive('Elige el producto'),
    series: z.string().trim().min(1, 'Escanea o pega las series encontradas'),
})
const seriesAbierto = ref(false)
const seriesEstado = reactive<{ producto_id: number, series: string }>({ producto_id: 0, series: '' })
const capturandoSeries = ref(false)
const problemaSeries = ref<Problem | null>(null)
const itemsSerie = computed<SelectItem[]>(() => productos.value.filter(p => p.seguimiento === 'serie').map(p => ({ label: `${p.nombre} · ${p.sku}`, value: p.id })))

function abrirSeries(productoId = 0) {
    const linea = conteo.value?.lineas.find(l => l.producto_id === productoId)
    Object.assign(seriesEstado, { producto_id: productoId, series: linea?.series.join('\n') ?? '' })
    problemaSeries.value = null
    seriesAbierto.value = true
}

async function capturarSeries(evento: FormSubmitEvent<z.output<typeof esquemaSeries>>) {
    capturandoSeries.value = true
    problemaSeries.value = null
    const resultado = await useConteosInventario().capturar(conteoId.value, { producto_id: evento.data.producto_id, series: partirSeries(evento.data.series), costo_unitario: null })
    capturandoSeries.value = false
    if (!resultado.ok) {
        problemaSeries.value = resultado.problema
        return
    }
    conteo.value = resultado.data
    seriesAbierto.value = false
    toast.add({ title: 'Series capturadas', icon: 'i-lucide-circle-check', color: 'success' })
}

/** Lo contado de un producto por serie: «42 ✓ escaneadas» o «17 · falta 2231500455». */
function textoSeries(f: Fila): string {
    if (!f.linea) {
        return 'Sin escanear'
    }
    const n = formatearCantidad(f.linea.contado)
    return new Decimal(f.linea.diferencia).isZero() ? `${n} ✓ escaneadas` : `${n} · ${new Decimal(f.linea.diferencia).isNegative() ? 'faltan' : 'sobran'} ${formatearCantidad(new Decimal(f.linea.diferencia).abs().toString())}`
}

const otrosProductos = computed<SelectItem[]>(() => productos.value.filter(p => !filas.value.some(f => f.producto_id === p.id)).map(p => ({ label: `${p.nombre} · ${p.sku}`, value: p.id })))

function agregarOtro(valor: unknown) {
    if (typeof valor === 'number' && !productosExtra.value.includes(valor)) {
        productosExtra.value = [...productosExtra.value, valor]
    }
}

/* Cerrar y cancelar */
const cerrarAbierto = ref(false)
const cerrando = ref(false)
const problemaCierre = ref<Problem | null>(null)
let claveCierre = nuevaClaveIdempotencia()

function pedirCierre() {
    problemaCierre.value = null
    claveCierre = nuevaClaveIdempotencia()
    cerrarAbierto.value = true
}

async function cerrar() {
    if (!conteo.value) {
        return
    }
    cerrando.value = true
    problemaCierre.value = null
    const resultado = await useConteosInventario().cerrar(conteo.value, claveCierre)
    cerrando.value = false
    if (!resultado.ok) {
        problemaCierre.value = resultado.problema
        return
    }
    conteo.value = resultado.data
    cerrarAbierto.value = false
    toast.add({ title: 'Conteo cerrado', description: `Faltante ${formatearQuetzales(resultado.data.faltante)} · sobrante ${formatearQuetzales(resultado.data.sobrante)}`, icon: 'i-lucide-clipboard-check', color: 'success' })
}

const cancelarAbierto = ref(false)

function cancelar(motivo: string, clave: string): Promise<Resultado<ConteoInventarioDetalle>> {
    return useConteosInventario().cancelar(conteoId.value, motivo, clave)
}

function alCancelar(cancelado: ConteoInventarioDetalle) {
    conteo.value = cancelado
    toast.add({ title: 'Conteo cancelado', icon: 'i-lucide-circle-check', color: 'success' })
}

function hojaParaContar() {
    window.print()
}

const colorDiferencia = (d: string) => (new Decimal(d).isZero() ? 'success' : new Decimal(d).isNegative() ? 'error' : 'warning')
const signo = (d: Decimal) => (d.isNegative() ? '− ' : d.isPositive() ? '+ ' : '')
</script>

<template>
    <PanelPagina
        id="inventario-conteo"
        :titulo="conteo ? `Conteo ${codigo} · ${conteo.bodega_nombre}` : 'Conteo'"
        icono="i-lucide-clipboard-list"
        encabezado-propio
    >
        <div
            class="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between"
            data-prueba="encabezado-conteo"
        >
            <div class="flex min-w-0 flex-wrap items-center gap-2">
                <h1 class="text-xl font-bold tracking-[-0.02em] text-highlighted sm:text-[1.75rem]">
                    {{ conteo ? `Conteo ${codigo} · ${conteo.bodega_nombre}` : 'Conteo' }}
                </h1>
                <UBadge
                    v-if="conteo"
                    :label="ESTADOS_CONTEO[conteo.estado].etiqueta"
                    :icon="ESTADOS_CONTEO[conteo.estado].icono"
                    :color="conteo.estado === 'abierto' ? 'warning' : ESTADOS_CONTEO[conteo.estado].color"
                    variant="subtle"
                    class="rounded-full"
                    data-prueba="conteo-estado"
                />
                <span
                    v-if="conteo"
                    class="text-sm text-muted"
                >{{ formatearFechaCorta(conteo.created_at) }} {{ formatearHora(conteo.created_at) }}{{ conteo.motivo ? ` · ${conteo.motivo}` : '' }}</span>
                <AyudaBoton solo-icono />
            </div>
            <div class="flex flex-wrap gap-2 print:hidden">
                <UButton
                    v-if="puedeContar"
                    label="Escanear series"
                    icon="i-lucide-scan-barcode"
                    color="neutral"
                    variant="outline"
                    class="boton-flotante rounded-full"
                    data-prueba="conteo-escanear"
                    @click="abrirSeries()"
                />
                <UButton
                    label="Hoja para contar"
                    icon="i-lucide-printer"
                    color="neutral"
                    variant="outline"
                    class="boton-flotante rounded-full"
                    @click="hojaParaContar"
                />
            </div>
        </div>

        <USkeleton
            v-if="cargando && !conteo"
            class="h-40 w-full"
        />
        <ProblemaAlerta
            v-else-if="problema"
            :problema="problema"
            :reintentar="cargar"
            :reintentando="cargando"
        />
        <div
            v-else-if="conteo"
            class="grid min-h-0 flex-1 gap-4 lg:grid-cols-[1fr_22rem]"
        >
            <section class="surface-card flex min-h-0 min-w-0 flex-col overflow-auto rounded-2xl">
                <div class="flex flex-wrap items-center gap-2 p-3 sm:px-4">
                    <h2 class="me-2 text-lg font-semibold text-highlighted">
                        Lo contado
                    </h2>
                    <UButton
                        v-for="p in ([['todos', 'Todos', null], ['diferencia', 'Con diferencia', conDiferencia.length], ['sin_contar', 'Sin contar', null]] as const)"
                        :key="p[0]"
                        :label="p[1]"
                        :color="pastilla === p[0] ? 'primary' : 'neutral'"
                        :variant="pastilla === p[0] ? 'solid' : 'outline'"
                        :aria-pressed="pastilla === p[0]"
                        size="sm"
                        class="rounded-full"
                        @click="pastilla = p[0]"
                    >
                        <template
                            v-if="p[2]"
                            #trailing
                        >
                            <UBadge
                                :label="String(p[2])"
                                size="sm"
                                color="neutral"
                                variant="soft"
                            />
                        </template>
                    </UButton>
                    <USelectMenu
                        v-if="puedeContar && otrosProductos.length"
                        :items="otrosProductos"
                        value-key="value"
                        icon="i-lucide-plus"
                        placeholder="Contar otro producto"
                        class="w-full sm:ms-auto sm:w-56"
                        aria-label="Contar un producto que no está en la lista"
                        data-prueba="captura-producto"
                        @update:model-value="agregarOtro"
                    />
                </div>
                <UTable
                    :data="visibles"
                    :columns="columnas"
                    sticky
                    :ui="{ thead: 'bg-(--ax-cabecera-tabla)', th: 'text-xs', td: 'py-3' }"
                    data-prueba="tabla-conteo-lineas"
                >
                    <template #producto-cell="{ row }">
                        <div
                            class="flex flex-col"
                            :data-linea="row.original.sku"
                        >
                            <span class="font-semibold text-highlighted">{{ row.original.nombre }}{{ row.original.serie ? ' (serie)' : '' }}</span>
                            <span class="font-mono text-xs text-muted">{{ row.original.sku }}</span>
                        </div>
                    </template>
                    <template #sistema-cell="{ row }">
                        <span class="tabular-nums text-muted">{{ formatearCantidad(row.original.sistema) }}</span>
                    </template>
                    <template #contado-cell="{ row }">
                        <template v-if="row.original.serie">
                            <UButton
                                v-if="puedeContar"
                                :label="textoSeries(row.original)"
                                icon="i-lucide-scan-barcode"
                                color="neutral"
                                variant="outline"
                                size="sm"
                                class="max-w-44 rounded-lg text-start whitespace-normal"
                                @click="abrirSeries(row.original.producto_id)"
                            />
                            <span
                                v-else
                                class="text-sm"
                            >{{ textoSeries(row.original) }}</span>
                        </template>
                        <template v-else>
                            <UInput
                                v-if="puedeContar"
                                :model-value="valorContado(row.original)"
                                inputmode="decimal"
                                :placeholder="row.original.linea ? undefined : 'Contar'"
                                :loading="guardando === row.original.producto_id"
                                :color="errorFila[row.original.producto_id] ? 'error' : 'primary'"
                                :highlight="Boolean(errorFila[row.original.producto_id])"
                                class="w-32"
                                :aria-label="`Contado de ${row.original.nombre}`"
                                :title="errorFila[row.original.producto_id]"
                                data-prueba="captura-contado"
                                @update:model-value="v => borradores[row.original.producto_id] = String(v)"
                                @change="capturarFila(row.original)"
                                @keydown.enter.prevent="capturarFila(row.original)"
                            />
                            <span
                                v-else
                                class="tabular-nums"
                            >{{ row.original.linea ? formatearCantidad(row.original.linea.contado) : '—' }}</span>
                            <UInput
                                v-if="puedeContar && new Decimal(row.original.sistema).isZero()"
                                :model-value="costos[row.original.producto_id] ?? row.original.linea?.costo_unitario ?? ''"
                                inputmode="decimal"
                                placeholder="Costo c/u"
                                size="sm"
                                class="mt-1 w-32"
                                :aria-label="`Costo del sobrante de ${row.original.nombre}`"
                                title="Solo si sobra algo de un producto que no tenía existencia"
                                @update:model-value="v => costos[row.original.producto_id] = String(v)"
                            />
                            <p
                                v-if="row.original.linea?.movimientos_desde_captura"
                                class="pt-1 text-xs text-muted"
                            >
                                {{ row.original.linea.movimientos_desde_captura }} {{ row.original.linea.movimientos_desde_captura === 1 ? 'movimiento' : 'movimientos' }} después de capturar (no cuentan)
                            </p>
                            <p
                                v-if="errorFila[row.original.producto_id]"
                                class="pt-1 text-xs text-error"
                            >
                                {{ errorFila[row.original.producto_id] }}
                            </p>
                        </template>
                    </template>
                    <template #diferencia-cell="{ row }">
                        <UBadge
                            v-if="row.original.linea"
                            :label="`${signo(new Decimal(row.original.linea.diferencia))}${formatearCantidad(new Decimal(row.original.linea.diferencia).abs().toString())}`"
                            :color="colorDiferencia(row.original.linea.diferencia)"
                            variant="subtle"
                            size="sm"
                            class="rounded-full tabular-nums"
                        />
                        <span
                            v-else
                            class="text-xs text-muted"
                        >Sin contar</span>
                    </template>
                    <template #valor-cell="{ row }">
                        <span
                            v-if="row.original.linea?.valor_diferencia && !new Decimal(row.original.linea.valor_diferencia).isZero()"
                            class="font-semibold tabular-nums"
                            :class="new Decimal(row.original.linea.valor_diferencia).isNegative() ? 'text-error' : 'text-success'"
                        >{{ signo(new Decimal(row.original.linea.valor_diferencia)) }}{{ formatearQuetzales(new Decimal(row.original.linea.valor_diferencia).abs().toFixed(2)) }}</span>
                    </template>
                    <template #empty>
                        <UEmpty
                            icon="i-lucide-clipboard-list"
                            :title="pastilla === 'todos' ? 'Sin productos' : 'Nada aquí'"
                            :description="abierto ? 'La bodega no tiene existencias; usa «Contar otro producto».' : 'Este conteo no capturó productos.'"
                            variant="naked"
                        />
                    </template>
                </UTable>
            </section>

            <aside
                class="surface-card flex h-fit flex-col gap-3 rounded-2xl p-4 print:hidden"
                aria-label="Antes de cerrar"
            >
                <h2 class="text-lg font-semibold text-highlighted">
                    {{ abierto ? 'Antes de cerrar' : 'Ajuste del conteo' }}
                </h2>
                <dl class="flex flex-col gap-2 text-sm">
                    <div class="flex justify-between">
                        <dt class="text-muted">
                            Faltante
                        </dt>
                        <dd
                            class="font-semibold tabular-nums text-error"
                            data-prueba="conteo-faltante"
                        >
                            − {{ formatearQuetzales(totalFaltante.toFixed(2)) }}
                        </dd>
                    </div>
                    <div class="flex justify-between">
                        <dt class="text-muted">
                            Sobrante
                        </dt>
                        <dd
                            class="font-semibold tabular-nums text-success"
                            data-prueba="conteo-sobrante"
                        >
                            + {{ formatearQuetzales(totalSobrante.toFixed(2)) }}
                        </dd>
                    </div>
                    <div class="flex justify-between border-t border-(--ax-borde) pt-2">
                        <dt class="font-semibold text-highlighted">
                            Ajuste neto
                        </dt>
                        <dd
                            class="font-bold tabular-nums"
                            :class="neto.isNegative() ? 'text-error' : 'text-success'"
                        >
                            {{ signo(neto) }}{{ formatearQuetzales(neto.abs().toFixed(2)) }}
                        </dd>
                    </div>
                </dl>
                <p class="text-xs text-muted">
                    {{ abierto ? 'Al cerrar se ajusta el kardex y la contabilidad con estos montos. Un equipo por serie que falta queda dado de baja.' : `Cerrado el ${formatearFechaHora(conteo.cerrado_en)}.` }}
                </p>
                <template v-if="abierto">
                    <UButton
                        v-if="puede('inventario.cerrar_conteo')"
                        label="Cerrar conteo y ajustar"
                        :icon="ICONOS.guardar"
                        color="success"
                        size="lg"
                        block
                        class="rounded-full"
                        :disabled="!conteo.lineas.length"
                        data-prueba="conteo-cerrar"
                        @click="pedirCierre"
                    />
                    <UButton
                        v-if="puede('inventario.cancelar_conteo')"
                        label="Cancelar conteo"
                        icon="i-lucide-clipboard-x"
                        color="error"
                        variant="ghost"
                        size="sm"
                        block
                        data-prueba="conteo-cancelar"
                        @click="cancelarAbierto = true"
                    />
                </template>
            </aside>
        </div>

        <UModal
            v-model:open="seriesAbierto"
            title="Escanear series"
            description="Escanea o pega la serie o MAC de cada equipo encontrado; capturar otra vez reemplaza la lista."
            :dismissible="!capturandoSeries"
        >
            <template #body>
                <UForm
                    id="form-series-conteo"
                    :schema="esquemaSeries"
                    :state="seriesEstado"
                    class="flex flex-col gap-4"
                    @submit="capturarSeries"
                >
                    <UFormField
                        label="Producto"
                        name="producto_id"
                        required
                    >
                        <USelectMenu
                            :model-value="seriesEstado.producto_id || undefined"
                            :items="itemsSerie"
                            value-key="value"
                            placeholder="Elige el producto"
                            class="w-full"
                            @update:model-value="v => seriesEstado.producto_id = typeof v === 'number' ? v : 0"
                        />
                    </UFormField>
                    <UFormField
                        label="Series o MAC encontradas"
                        name="series"
                        help="Una por línea."
                        required
                    >
                        <UTextarea
                            v-model="seriesEstado.series"
                            :rows="6"
                            class="w-full font-mono"
                            data-prueba="captura-series"
                        />
                    </UFormField>
                    <ProblemaAlerta
                        v-if="problemaSeries"
                        :problema="problemaSeries"
                        con-errores
                    />
                </UForm>
            </template>
            <template #footer>
                <div class="flex w-full justify-end gap-2">
                    <UButton
                        label="Cancelar"
                        :icon="ICONOS.cancelar"
                        color="neutral"
                        variant="ghost"
                        :disabled="capturandoSeries"
                        @click="seriesAbierto = false"
                    />
                    <UButton
                        type="submit"
                        form="form-series-conteo"
                        label="Guardar lo escaneado"
                        :icon="ICONOS.guardar"
                        :loading="capturandoSeries"
                        data-prueba="captura-guardar"
                    />
                </div>
            </template>
        </UModal>

        <UModal
            v-model:open="cerrarAbierto"
            title="Cerrar conteo"
            description="Se ajustan solo los productos contados; no se puede volver a cerrar."
            :dismissible="!cerrando"
        >
            <template #body>
                <div
                    class="flex flex-col gap-3 text-sm"
                    data-prueba="cierre-resumen"
                >
                    <p>Faltante a mermas (5.6.02): <span class="font-semibold tabular-nums">{{ formatearQuetzales(faltante.toFixed(2)) }}</span></p>
                    <p>Sobrante a 4.2.04: <span class="font-semibold tabular-nums">{{ formatearQuetzales(sobrante.toFixed(2)) }}</span></p>
                    <p
                        v-if="sinContar.length"
                        class="text-muted"
                    >
                        {{ sinContar.length }} {{ sinContar.length === 1 ? 'producto quedó' : 'productos quedaron' }} sin contar y no se ajustan.
                    </p>
                    <ProblemaAlerta
                        v-if="problemaCierre"
                        :problema="problemaCierre"
                    />
                </div>
            </template>
            <template #footer>
                <div class="flex w-full justify-end gap-2">
                    <UButton
                        label="Volver"
                        :icon="ICONOS.volver"
                        color="neutral"
                        variant="ghost"
                        :disabled="cerrando"
                        @click="cerrarAbierto = false"
                    />
                    <UButton
                        label="Cerrar y ajustar"
                        icon="i-lucide-clipboard-check"
                        color="success"
                        :loading="cerrando"
                        data-prueba="cierre-confirmar"
                        @click="cerrar"
                    />
                </div>
            </template>
        </UModal>
        <AccionMotivoModal
            v-model:open="cancelarAbierto"
            titulo="Cancelar conteo"
            efecto="El conteo queda cancelado sin ajustes; la bodega puede abrir otro."
            confirmar="Cancelar conteo"
            icono="i-lucide-clipboard-x"
            :ejecutar="cancelar"
            @hecho="alCancelar"
        />
    </PanelPagina>
</template>
