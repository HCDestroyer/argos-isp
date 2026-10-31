<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { FormSubmitEvent, SelectItem } from '@nuxt/ui'
import Decimal from 'decimal.js'

/**
 * Nueva orden de traslado (`POST /inventario/traslados/enviar`, `inventario.crear_traslado`): origen y
 * destino (bodega o técnico) y líneas con productos por cantidad y equipos por serie. Los equipos se
 * buscan o se escanean por serie o MAC (un lector de código de barras «teclea» y manda Enter). Todo o
 * nada: 409 `existencia_insuficiente` o `unidad_*` de la primera línea que falle, y no sale nada.
 */
definePageMeta({ permiso: 'inventario.crear_traslado' })

useHead({ title: 'Nueva orden de traslado · ArgosIsp' })

const toast = useToast()
const { puede } = usePermisos()
/** Para leer lo que hay en el origen y volver a la lista (la orden se crea con `inventario.crear_traslado`). */
const puedeVer = computed(() => puede('inventario.ver'))

const formulario = useTemplateRef('formulario')
const estado = reactive<EntradaNuevaOrden>(nuevaOrdenVacia())
const enviando = ref(false)
const problema = ref<Problem | null>(null)
const clave = nuevaClaveIdempotencia()

const bodegas = shallowRef<Bodega[]>([])
const productos = shallowRef<Producto[]>([])
const problemaCatalogos = ref<Problem | null>(null)
const cargandoCatalogos = ref(false)

async function cargarCatalogos() {
    cargandoCatalogos.value = true
    const [rBodegas, rProductos] = await Promise.all([useBodegas().activas(), useProductos().activos()])
    cargandoCatalogos.value = false
    problemaCatalogos.value = (!rBodegas.ok ? rBodegas.problema : null) ?? (!rProductos.ok ? rProductos.problema : null)
    bodegas.value = rBodegas.ok ? rBodegas.data : []
    productos.value = rProductos.ok ? rProductos.data : []
}
onMounted(cargarCatalogos)

type OpcionBodega = { label: string, value: number, icon: string, description?: string }
const itemsBodega = computed<OpcionBodega[]>(() => bodegas.value.map(b => ({
    label: b.tipo === 'tecnico' ? (b.usuario_nombre ?? b.nombre) : b.nombre,
    value: b.id,
    icon: TIPOS_BODEGA[b.tipo].icono,
    description: b.tipo === 'tecnico' ? `Técnico · ${b.nombre}` : 'Bodega',
})))
const itemsDestino = computed(() => itemsBodega.value.filter(i => i.value !== estado.bodega_origen_id))

/* Lo que hay en el origen */
const existencias = shallowRef<ExistenciaInventario[]>([])
const unidades = shallowRef<UnidadInventario[]>([])
const problemaOrigen = ref<Problem | null>(null)
const cargandoOrigen = ref(false)

async function leerOrigen() {
    existencias.value = []
    unidades.value = []
    problemaOrigen.value = null
    if (!estado.bodega_origen_id || !puedeVer.value) {
        return
    }
    cargandoOrigen.value = true
    const [rExistencias, rUnidades] = await Promise.all([
        useInventario().existencias({ bodega_id: estado.bodega_origen_id, limit: 200 }),
        useUnidadesInventario().listar({ bodega_id: estado.bodega_origen_id, limit: 200 }),
    ])
    cargandoOrigen.value = false
    problemaOrigen.value = (!rExistencias.ok ? rExistencias.problema : null) ?? (!rUnidades.ok ? rUnidades.problema : null)
    existencias.value = rExistencias.ok ? rExistencias.data.data : []
    unidades.value = rUnidades.ok ? rUnidades.data.data.filter(u => u.estado === 'disponible' || u.estado === 'en_reparacion') : []
}

watch(() => estado.bodega_origen_id, () => {
    estado.lineas = []
    void leerOrigen()
})

const conExistencia = computed(() => productos.value.filter(p => existencias.value.some(e => e.producto_id === p.id && new Decimal(e.cantidad).greaterThan(0))))
const itemsProducto = computed<SelectItem[]>(() => conExistencia.value
    .filter(p => !estado.lineas.some(l => l.producto_id === p.id))
    .map(p => ({ label: `${p.nombre} · ${p.sku}`, value: p.id, description: `Hay ${formatearCantidad(existencias.value.find(e => e.producto_id === p.id)?.cantidad, p.unidad)}` })))

const productoDe = (id: number) => productos.value.find(p => p.id === id) ?? null
const existenciaDe = (id: number) => existencias.value.find(e => e.producto_id === id) ?? null
const unidadesDe = (id: number) => unidades.value.filter(u => u.producto_id === id)

function agregarLinea(productoId: unknown) {
    const producto = typeof productoId === 'number' ? productoDe(productoId) : null
    if (!producto) {
        return
    }
    estado.lineas.push({ producto_id: producto.id, seguimiento: producto.seguimiento, cantidad: '', unidad_ids: [] })
}

function quitarLinea(indice: number) {
    estado.lineas.splice(indice, 1)
}

/* Escanear o escribir una serie o MAC: agrega el equipo a su línea (y la crea si falta) */
const codigo = ref('')
const avisoCodigo = ref<string | null>(null)
const buscando = ref(false)

async function agregarPorCodigo() {
    const texto = codigo.value.trim()
    avisoCodigo.value = null
    if (!texto || !estado.bodega_origen_id || !puedeVer.value) {
        return
    }
    let unidad = buscarUnidadPorCodigo(unidades.value, texto)
    if (!unidad) {
        buscando.value = true
        const resultado = await useUnidadesInventario().listar({ bodega_id: estado.bodega_origen_id, q: texto, limit: 5 })
        buscando.value = false
        unidad = resultado.ok ? buscarUnidadPorCodigo(resultado.data.data.filter(u => u.estado === 'disponible' || u.estado === 'en_reparacion'), texto) : undefined
        if (unidad && !unidades.value.some(u => u.id === unidad?.id)) {
            unidades.value = [...unidades.value, unidad]
        }
    }
    if (!unidad) {
        avisoCodigo.value = `No hay un equipo disponible con la serie o MAC «${texto}» en el origen`
        return
    }
    let linea = estado.lineas.find(l => l.producto_id === unidad.producto_id)
    if (!linea) {
        estado.lineas.push({ producto_id: unidad.producto_id, seguimiento: 'serie', cantidad: '', unidad_ids: [] })
        linea = estado.lineas.at(-1)
    }
    if (linea && !linea.unidad_ids.includes(unidad.id)) {
        linea.unidad_ids.push(unidad.id)
    }
    codigo.value = ''
}

const resumen = computed(() => estado.lineas.reduce((total, l) => total + (l.seguimiento === 'serie' ? l.unidad_ids.length : 0), 0))

async function enviar(evento: FormSubmitEvent<SalidaNuevaOrden>) {
    enviando.value = true
    problema.value = null
    const resultado = await useOrdenesTraslado().enviar(cuerpoNuevaOrden(evento.data), clave)
    enviando.value = false
    if (resultado.ok) {
        toast.add({ title: `Orden N.º ${resultado.data.numero} enviada`, description: 'Queda en tránsito hasta que el destino la reciba.', icon: 'i-lucide-truck', color: 'success' })
        await navigateTo(puedeVer.value ? `/inventario/traslados/${resultado.data.id}` : '/')
        return
    }
    const errores = erroresDeFormulario(resultado.problema)
    if (errores.length) {
        formulario.value?.setErrors(errores)
    }
    problema.value = resultado.problema
}
</script>

<template>
    <PanelPagina
        id="inventario-traslado-nuevo"
        titulo="Nueva orden de traslado"
        icono="i-lucide-truck"
    >
        <template #acciones>
            <UButton
                v-if="puedeVer"
                label="Órdenes"
                icon="i-lucide-arrow-left"
                color="neutral"
                variant="ghost"
                to="/inventario/traslados"
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
            id="form-orden-traslado"
            ref="formulario"
            :schema="esquemaNuevaOrden"
            :state="estado"
            class="mx-auto flex w-full max-w-4xl flex-col gap-5"
            @submit="enviar"
        >
            <div class="grid gap-4 sm:grid-cols-2">
                <UFormField
                    label="Desde"
                    name="bodega_origen_id"
                    required
                >
                    <USelectMenu
                        :model-value="estado.bodega_origen_id || undefined"
                        :items="itemsBodega"
                        value-key="value"
                        placeholder="Bodega o técnico que envía"
                        class="w-full"
                        data-prueba="orden-origen"
                        @update:model-value="v => estado.bodega_origen_id = typeof v === 'number' ? v : 0"
                    />
                </UFormField>
                <UFormField
                    label="Hacia"
                    name="bodega_destino_id"
                    required
                >
                    <USelectMenu
                        :model-value="estado.bodega_destino_id || undefined"
                        :items="itemsDestino"
                        value-key="value"
                        placeholder="Bodega o técnico que recibe"
                        class="w-full"
                        data-prueba="orden-destino"
                        @update:model-value="v => estado.bodega_destino_id = typeof v === 'number' ? v : 0"
                    />
                </UFormField>
            </div>
            <UFormField
                label="Motivo"
                name="motivo"
                help="Opcional: sale en el PDF y en el kardex."
            >
                <UInput
                    v-model="estado.motivo"
                    placeholder="Para las instalaciones de la semana"
                    class="w-full"
                    data-prueba="orden-motivo"
                />
            </UFormField>

            <ProblemaAlerta
                v-if="problemaOrigen"
                :problema="problemaOrigen"
                :reintentar="leerOrigen"
                :reintentando="cargandoOrigen"
            />
            <UCard
                v-else-if="estado.bodega_origen_id"
                :ui="{ body: 'flex flex-col gap-4' }"
            >
                <template #header>
                    <div class="flex flex-col gap-1">
                        <h2 class="text-sm font-semibold text-highlighted">
                            Líneas
                        </h2>
                        <p class="text-xs text-muted">
                            Un producto por línea. Los equipos por serie se agregan escaneando o escribiendo su serie o MAC.
                        </p>
                    </div>
                </template>
                <div class="grid gap-3 sm:grid-cols-2">
                    <UFormField
                        label="Agregar producto"
                        name="agregar"
                    >
                        <USelectMenu
                            :items="itemsProducto"
                            value-key="value"
                            :loading="cargandoOrigen"
                            placeholder="Busca por nombre o SKU"
                            class="w-full"
                            data-prueba="orden-agregar-producto"
                            @update:model-value="agregarLinea"
                        />
                    </UFormField>
                    <UFormField
                        label="Escanear serie o MAC"
                        name="codigo"
                        :error="avisoCodigo ?? undefined"
                    >
                        <UInput
                            v-model="codigo"
                            icon="i-lucide-scan-barcode"
                            placeholder="Escanea o escribe y pulsa Enter"
                            autocomplete="off"
                            :loading="buscando"
                            class="w-full font-mono"
                            data-prueba="orden-escanear"
                            @keydown.enter.prevent="agregarPorCodigo"
                        />
                    </UFormField>
                </div>

                <UEmpty
                    v-if="!estado.lineas.length"
                    icon="i-lucide-package"
                    title="Sin líneas"
                    description="Agrega un producto o escanea un equipo."
                    variant="naked"
                />
                <div
                    v-for="(linea, i) in estado.lineas"
                    :key="linea.producto_id"
                    class="flex flex-col gap-3 rounded-md border border-default p-3"
                    :data-linea-orden="productoDe(linea.producto_id)?.sku"
                >
                    <div class="flex items-start justify-between gap-2">
                        <div class="flex min-w-0 flex-col">
                            <span class="text-sm font-medium text-highlighted">{{ productoDe(linea.producto_id)?.nombre }}</span>
                            <span class="font-mono text-xs text-muted">
                                {{ productoDe(linea.producto_id)?.sku }} · Hay {{ formatearCantidad(existenciaDe(linea.producto_id)?.cantidad, productoDe(linea.producto_id)?.unidad) }}
                            </span>
                        </div>
                        <UButton
                            icon="i-lucide-trash-2"
                            color="neutral"
                            variant="ghost"
                            size="sm"
                            :aria-label="`Quitar ${productoDe(linea.producto_id)?.nombre ?? 'línea'}`"
                            @click="quitarLinea(i)"
                        />
                    </div>
                    <UFormField
                        :name="`lineas.${i}.producto_id`"
                        class="hidden"
                    />
                    <UFormField
                        v-if="linea.seguimiento === 'cantidad'"
                        label="Cantidad"
                        :name="`lineas.${i}.cantidad`"
                        required
                    >
                        <UInput
                            v-model="linea.cantidad"
                            inputmode="decimal"
                            class="w-full sm:w-48"
                            data-prueba="orden-cantidad"
                        >
                            <template #trailing>
                                <span class="text-xs text-muted">{{ productoDe(linea.producto_id)?.unidad }}</span>
                            </template>
                        </UInput>
                    </UFormField>
                    <UFormField
                        v-else
                        label="Equipos"
                        :name="`lineas.${i}.unidad_ids`"
                        required
                    >
                        <USelectMenu
                            v-model="linea.unidad_ids"
                            :items="unidadesDe(linea.producto_id).map(u => ({ label: identificacionUnidad(u), value: u.id, description: `${ESTADOS_UNIDAD[u.estado].etiqueta} · ${CONDICIONES_UNIDAD[u.condicion]}` }))"
                            value-key="value"
                            multiple
                            placeholder="Elige o escanea los equipos"
                            class="w-full"
                            data-prueba="orden-unidades"
                        />
                    </UFormField>
                </div>
                <UFormField name="lineas" />
            </UCard>

            <ProblemaAlerta
                v-if="problema"
                :problema="problema"
                con-errores
            />
            <div class="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-end">
                <span
                    v-if="estado.lineas.length"
                    class="text-xs text-muted sm:mr-auto"
                >{{ estado.lineas.length }} {{ estado.lineas.length === 1 ? 'línea' : 'líneas' }}{{ resumen ? ` · ${resumen} ${resumen === 1 ? 'equipo' : 'equipos'}` : '' }}</span>
                <UButton
                    v-if="puedeVer"
                    label="Cancelar"
                    color="neutral"
                    variant="ghost"
                    to="/inventario/traslados"
                    :disabled="enviando"
                />
                <UButton
                    type="submit"
                    label="Enviar orden"
                    icon="i-lucide-send"
                    :loading="enviando"
                    data-prueba="orden-enviar"
                />
            </div>
        </UForm>
    </PanelPagina>
</template>
