<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { FormSubmitEvent, SelectItem, TableColumn } from '@nuxt/ui'
import Decimal from 'decimal.js'
import * as z from 'zod'

/**
 * Captura de un conteo físico (A3, fase C): producto por producto, lo contado (o las series
 * encontradas) contra lo esperado al capturar; capturar otra vez reemplaza la línea. Antes de
 * cerrar se ve la diferencia valorizada (faltante a 5.6.02, sobrante a 4.2.04). Permisos:
 * `inventario.contar`, `inventario.cerrar_conteo` e `inventario.cancelar_conteo`.
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

useHead(() => ({ title: `Conteo #${route.params.id} · ArgosIsp` }))

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
    const resultado = await useProductos().activos()
    productos.value = resultado.ok ? resultado.data.filter(p => p.empresa_id === conteo.value?.empresa_id) : []
})

const abierto = computed(() => conteo.value?.estado === 'abierto')
const faltante = computed(() => (conteo.value?.lineas ?? []).reduce((t, l) => (l.valor_diferencia && new Decimal(l.valor_diferencia).isNegative() ? t.plus(new Decimal(l.valor_diferencia).abs()) : t), new Decimal(0)))
const sobrante = computed(() => (conteo.value?.lineas ?? []).reduce((t, l) => (l.valor_diferencia && new Decimal(l.valor_diferencia).isPositive() ? t.plus(l.valor_diferencia) : t), new Decimal(0)))

type Linea = ConteoInventarioDetalle['lineas'][number]
const columnas: TableColumn<Linea>[] = [
    { accessorKey: 'producto_nombre', header: 'Producto', meta: { class: { td: 'whitespace-normal' } } },
    { accessorKey: 'esperado', header: 'Esperado', meta: { class: { th: 'text-right hidden sm:table-cell', td: 'text-right hidden sm:table-cell' } } },
    { accessorKey: 'contado', header: 'Contado', meta: { class: { th: 'text-right', td: 'text-right' } } },
    { accessorKey: 'diferencia', header: 'Diferencia', meta: { class: { th: 'text-right', td: 'text-right' } } },
]

/* Captura */
const esquema = z.object({
    producto_id: z.number({ message: 'Elige el producto' }).int().positive('Elige el producto'),
    contado: z.string().trim(),
    series: z.string(),
    costo_unitario: z.string().trim().refine(v => v === '' || /^\d{1,12}(\.\d{1,6})?$/.test(v), 'Monto con hasta 6 decimales'),
})
type Captura = z.input<typeof esquema>
const formulario = useTemplateRef('formulario')
const captura = reactive<Captura>({ producto_id: 0, contado: '', series: '', costo_unitario: '' })
const capturando = ref(false)
const problemaCaptura = ref<Problem | null>(null)
const elegido = computed(() => productos.value.find(p => p.id === captura.producto_id) ?? null)
const itemsProducto = computed<SelectItem[]>(() => productos.value.map(p => ({ label: `${p.nombre} · ${p.sku}`, value: p.id, description: SEGUIMIENTOS[p.seguimiento].etiqueta })))

async function capturar(evento: FormSubmitEvent<z.output<typeof esquema>>) {
    const serie = elegido.value?.seguimiento === 'serie'
    if (!serie && !/^\d{1,11}(\.\d{1,3})?$/.test(evento.data.contado)) {
        formulario.value?.setErrors([{ name: 'contado', message: 'Cantidad contada, hasta 3 decimales (0 si no hay)' }])
        return
    }
    capturando.value = true
    problemaCaptura.value = null
    const resultado = await useConteosInventario().capturar(conteoId.value, {
        producto_id: evento.data.producto_id,
        ...(serie ? { series: partirSeries(evento.data.series) } : { contado: evento.data.contado }),
        costo_unitario: evento.data.costo_unitario || null,
    })
    capturando.value = false
    if (!resultado.ok) {
        const errores = erroresDeFormulario(resultado.problema)
        if (errores.length) {
            formulario.value?.setErrors(errores)
        }
        problemaCaptura.value = resultado.problema
        return
    }
    conteo.value = resultado.data
    Object.assign(captura, { producto_id: 0, contado: '', series: '', costo_unitario: '' })
    toast.add({ title: 'Línea capturada', icon: 'i-lucide-circle-check', color: 'success' })
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
</script>

<template>
    <PanelPagina
        id="inventario-conteo"
        :titulo="conteo ? `Conteo #${conteo.id} · ${conteo.bodega_nombre}` : 'Conteo'"
        icono="i-lucide-clipboard-list"
    >
        <template #acciones>
            <UButton
                to="/inventario/conteos"
                icon="i-lucide-arrow-left"
                label="Conteos"
                color="neutral"
                variant="ghost"
                class="hidden sm:inline-flex"
            />
        </template>

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
            class="flex flex-col gap-6"
        >
            <section class="surface-card flex flex-col gap-4 p-4 sm:p-6">
                <div class="flex flex-wrap items-center gap-2">
                    <UBadge
                        :label="ESTADOS_CONTEO[conteo.estado].etiqueta"
                        :icon="ESTADOS_CONTEO[conteo.estado].icono"
                        :color="ESTADOS_CONTEO[conteo.estado].color"
                        variant="subtle"
                        data-prueba="conteo-estado"
                    />
                    <span class="text-sm text-muted">Corte {{ formatearFecha(conteo.fecha_corte) }}<template v-if="conteo.motivo">
                        · {{ conteo.motivo }}
                    </template></span>
                </div>
                <dl class="grid grid-cols-2 gap-4 sm:grid-cols-3">
                    <DatoFicha
                        etiqueta="Productos contados"
                        :valor="conteo.lineas.length"
                    />
                    <DatoFicha
                        :etiqueta="abierto ? 'Faltante si se cierra' : 'Faltante ajustado'"
                        :valor="formatearQuetzales(abierto ? faltante.toFixed(2) : conteo.faltante)"
                        data-prueba="conteo-faltante"
                    />
                    <DatoFicha
                        :etiqueta="abierto ? 'Sobrante si se cierra' : 'Sobrante ajustado'"
                        :valor="formatearQuetzales(abierto ? sobrante.toFixed(2) : conteo.sobrante)"
                        data-prueba="conteo-sobrante"
                    />
                </dl>
                <div
                    v-if="abierto"
                    class="flex flex-wrap gap-2"
                >
                    <UButton
                        v-if="puede('inventario.cerrar_conteo')"
                        label="Cerrar conteo"
                        icon="i-lucide-clipboard-check"
                        :disabled="!conteo.lineas.length"
                        data-prueba="conteo-cerrar"
                        @click="pedirCierre"
                    />
                    <UButton
                        v-if="puede('inventario.cancelar_conteo')"
                        label="Cancelar conteo"
                        icon="i-lucide-clipboard-x"
                        color="neutral"
                        variant="outline"
                        data-prueba="conteo-cancelar"
                        @click="cancelarAbierto = true"
                    />
                </div>
            </section>

            <section
                v-if="abierto && puede('inventario.contar')"
                class="surface-card flex flex-col gap-4 p-4 sm:p-6"
                aria-label="Capturar"
            >
                <h2 class="text-base font-semibold text-highlighted">
                    Capturar
                </h2>
                <UForm
                    ref="formulario"
                    :schema="esquema"
                    :state="captura"
                    class="grid gap-4 sm:grid-cols-2"
                    @submit="capturar"
                >
                    <UFormField
                        label="Producto"
                        name="producto_id"
                        required
                        class="sm:col-span-2"
                    >
                        <USelectMenu
                            :model-value="captura.producto_id || undefined"
                            :items="itemsProducto"
                            value-key="value"
                            placeholder="Busca por nombre o SKU"
                            class="w-full"
                            data-prueba="captura-producto"
                            @update:model-value="v => captura.producto_id = typeof v === 'number' ? v : 0"
                        />
                    </UFormField>
                    <UFormField
                        v-if="elegido?.seguimiento === 'serie'"
                        label="Series o MAC encontradas"
                        name="series"
                        help="Una por línea; pega la lista o escanéalas."
                        class="sm:col-span-2"
                    >
                        <UTextarea
                            v-model="captura.series"
                            :rows="4"
                            autoresize
                            class="w-full font-mono"
                            data-prueba="captura-series"
                        />
                    </UFormField>
                    <UFormField
                        v-else
                        label="Contado"
                        name="contado"
                        :help="elegido ? `En ${elegido.unidad}` : undefined"
                        required
                    >
                        <UInput
                            v-model="captura.contado"
                            inputmode="decimal"
                            class="w-full"
                            data-prueba="captura-contado"
                        />
                    </UFormField>
                    <UFormField
                        label="Costo del sobrante"
                        name="costo_unitario"
                        help="Solo si sobra algo sin existencia."
                    >
                        <UInput
                            v-model="captura.costo_unitario"
                            inputmode="decimal"
                            class="w-full"
                        >
                            <template #leading>
                                <span class="text-sm text-muted">Q</span>
                            </template>
                        </UInput>
                    </UFormField>
                    <ProblemaAlerta
                        v-if="problemaCaptura"
                        :problema="problemaCaptura"
                        class="sm:col-span-2"
                    />
                    <div class="sm:col-span-2">
                        <UButton
                            type="submit"
                            label="Capturar línea"
                            icon="i-lucide-check"
                            :loading="capturando"
                            data-prueba="captura-guardar"
                        />
                    </div>
                </UForm>
            </section>

            <UTable
                :data="conteo.lineas"
                :columns="columnas"
                :ui="{ td: 'py-3' }"
                data-prueba="tabla-conteo-lineas"
            >
                <template #producto_nombre-cell="{ row }">
                    <div
                        class="flex min-w-0 flex-col gap-0.5"
                        :data-linea="row.original.producto_sku"
                    >
                        <span class="text-sm font-medium text-highlighted">{{ row.original.producto_nombre }}</span>
                        <span class="font-mono text-xs text-muted">{{ row.original.producto_sku }}<template v-if="row.original.series.length">
                            · {{ row.original.series.length }} series
                        </template></span>
                        <span
                            v-if="row.original.movimientos_desde_captura > 0"
                            class="flex items-center gap-1 text-xs text-warning"
                        >
                            <UIcon
                                name="i-lucide-info"
                                class="size-3.5"
                            />
                            {{ row.original.movimientos_desde_captura }} movimientos después de capturar (no cuentan como diferencia)
                        </span>
                        <span class="text-xs text-muted sm:hidden">Esperado {{ formatearCantidad(row.original.esperado_captura ?? row.original.esperado) }}</span>
                    </div>
                </template>
                <template #esperado-cell="{ row }">
                    <span class="text-sm tabular-nums">{{ formatearCantidad(row.original.esperado_captura ?? row.original.esperado) }}</span>
                </template>
                <template #contado-cell="{ row }">
                    <span class="text-sm font-medium tabular-nums">{{ formatearCantidad(row.original.contado) }}</span>
                </template>
                <template #diferencia-cell="{ row }">
                    <div class="flex flex-col items-end text-sm tabular-nums">
                        <span
                            :class="new Decimal(row.original.diferencia).isNegative() ? 'text-error' : (new Decimal(row.original.diferencia).isZero() ? 'text-muted' : 'text-success')"
                            class="font-medium"
                        >{{ new Decimal(row.original.diferencia).isPositive() ? '+' : '' }}{{ formatearCantidad(row.original.diferencia) }}</span>
                        <span
                            v-if="row.original.valor_diferencia"
                            class="text-xs text-muted"
                        >{{ formatearQuetzales(row.original.valor_diferencia) }}</span>
                    </div>
                </template>
                <template #empty>
                    <UEmpty
                        icon="i-lucide-clipboard-list"
                        title="Sin líneas"
                        :description="abierto ? 'Captura lo contado de cada producto.' : 'Este conteo no capturó productos.'"
                        variant="naked"
                    />
                </template>
            </UTable>
        </div>

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
                        color="neutral"
                        variant="ghost"
                        :disabled="cerrando"
                        @click="cerrarAbierto = false"
                    />
                    <UButton
                        label="Cerrar y ajustar"
                        icon="i-lucide-clipboard-check"
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
