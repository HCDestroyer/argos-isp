<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { FormSubmitEvent, SelectItem } from '@nuxt/ui'
import Decimal from 'decimal.js'

/**
 * Nuevo traslado (tablero NuevoBodegas; el panel «Nuevo traslado» va en su tarjeta propia porque es
 * un formulario largo con «Atrás»). `POST /inventario/traslados/enviar`, `inventario.crear_traslado`: origen y
 * destino (bodega o técnico) y líneas con productos por cantidad y equipos por serie. Los equipos se
 * buscan o se escanean por serie o MAC (un lector de código de barras «teclea» y manda Enter). Todo o
 * nada: 409 `existencia_insuficiente` o `unidad_*` de la primera línea que falle, y no sale nada.
 */
definePageMeta({ permiso: 'inventario.crear_traslado' })

useHead({ title: 'Nuevo traslado · ArgosIsp' })

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
const route = useRoute()
onMounted(async () => {
    await cargarCatalogos()
    const origen = Number(route.query.origen)
    if (Number.isInteger(origen) && bodegas.value.some(b => b.id === origen)) {
        estado.bodega_origen_id = origen
    }
})

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

/** Lo que quedará en el origen después de enviar: aviso si baja del mínimo. */
function quedaBajoMinimo(productoId: number, cantidad: string): boolean {
    const e = existenciaDe(productoId)
    if (!e?.existencia_minima || !/^\d+(\.\d+)?$/.test(cantidad)) {
        return false
    }
    return new Decimal(e.cantidad).minus(cantidad).lessThan(e.existencia_minima)
}

/** Valor aproximado de lo que va (costo promedio del origen o costo de cada equipo). */
const valorTotal = computed(() => estado.lineas.reduce((total, l) => {
    if (l.seguimiento === 'serie') {
        return l.unidad_ids.reduce((t, id) => t.plus(unidades.value.find(u => u.id === id)?.costo ?? 0), total)
    }
    const promedio = existenciaDe(l.producto_id)?.costo_promedio
    return /^\d+(\.\d+)?$/.test(l.cantidad) && promedio ? total.plus(new Decimal(l.cantidad).times(promedio)) : total
}, new Decimal(0)))

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
        titulo="Nuevo traslado"
        icono="i-lucide-truck"
    >
        <template #acciones>
            <UButton
                v-if="puedeVer"
                label="Atrás"
                :icon="ICONOS.volver"
                color="neutral"
                variant="outline"
                class="boton-flotante rounded-full"
                to="/inventario/bodegas"
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
            class="surface-card mx-auto flex w-full max-w-2xl flex-col overflow-hidden rounded-2xl"
            @submit="enviar"
        >
            <div class="flex items-center gap-3 border-b border-(--ax-borde) p-4">
                <span class="pastilla-icono pastilla-tono tono-2 size-10 shrink-0 rounded-xl">
                    <UIcon
                        name="i-lucide-truck"
                        class="size-5"
                    />
                </span>
                <div class="flex min-w-0 flex-col">
                    <span class="font-semibold text-highlighted">Nuevo traslado</span>
                    <span class="text-xs text-muted">Sale ahora; queda «en tránsito» hasta que lo reciban</span>
                </div>
            </div>

            <div class="flex flex-col gap-4 p-4">
                <div class="grid items-end gap-3 sm:grid-cols-[1fr_auto_1fr]">
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
                    <UIcon
                        name="i-lucide-arrow-right"
                        class="mx-auto mb-2 hidden size-5 text-primary sm:block"
                    />
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

                <ProblemaAlerta
                    v-if="problemaOrigen"
                    :problema="problemaOrigen"
                    :reintentar="leerOrigen"
                    :reintentando="cargandoOrigen"
                />
                <section
                    v-else-if="estado.bodega_origen_id"
                    class="flex flex-col gap-2"
                >
                    <div class="flex flex-wrap items-baseline justify-between gap-2">
                        <span class="text-sm font-semibold text-highlighted">Qué va</span>
                        <span class="text-xs text-muted">Existencia en el origen al lado de cada uno</span>
                    </div>
                    <div class="grid gap-2 sm:grid-cols-2">
                        <USelectMenu
                            :items="itemsProducto"
                            value-key="value"
                            :loading="cargandoOrigen"
                            icon="i-lucide-search"
                            placeholder="Buscar producto"
                            class="w-full"
                            aria-label="Agregar producto"
                            data-prueba="orden-agregar-producto"
                            @update:model-value="agregarLinea"
                        />
                        <UFormField
                            name="codigo"
                            :error="avisoCodigo ?? undefined"
                        >
                            <UInput
                                v-model="codigo"
                                icon="i-lucide-scan-barcode"
                                placeholder="Escanear serie/MAC y Enter"
                                aria-label="Escanear serie o MAC"
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
                        title="Nada todavía"
                        description="Busca un producto o escanea un equipo."
                        variant="naked"
                    />
                    <ul
                        v-else
                        class="divide-y divide-(--ax-borde) rounded-xl border border-(--ax-borde)"
                    >
                        <li
                            v-for="(linea, i) in estado.lineas"
                            :key="linea.producto_id"
                            class="flex flex-col gap-2 p-3"
                            :data-linea-orden="productoDe(linea.producto_id)?.sku"
                        >
                            <div class="flex items-center gap-3">
                                <span class="pastilla-icono pastilla-tono tono-marca size-9 shrink-0 rounded-xl">
                                    <UIcon
                                        :name="linea.seguimiento === 'serie' ? 'i-lucide-barcode' : 'i-lucide-package'"
                                        class="size-4"
                                    />
                                </span>
                                <div class="flex min-w-0 flex-1 flex-col">
                                    <span class="font-semibold text-highlighted">{{ productoDe(linea.producto_id)?.nombre }}</span>
                                    <span
                                        class="text-xs"
                                        :class="linea.seguimiento === 'cantidad' && quedaBajoMinimo(linea.producto_id, linea.cantidad) ? 'text-warning' : 'text-muted'"
                                    >
                                        Hay {{ formatearCantidad(existenciaDe(linea.producto_id)?.cantidad, productoDe(linea.producto_id)?.unidad) }}{{ linea.seguimiento === 'cantidad' && quedaBajoMinimo(linea.producto_id, linea.cantidad) ? ' · quedará bajo el mínimo' : '' }}
                                    </span>
                                </div>
                                <UFormField
                                    v-if="linea.seguimiento === 'cantidad'"
                                    :name="`lineas.${i}.cantidad`"
                                    required
                                >
                                    <UInput
                                        v-model="linea.cantidad"
                                        inputmode="decimal"
                                        class="w-24 text-center"
                                        :aria-label="`Cantidad de ${productoDe(linea.producto_id)?.nombre ?? 'producto'}`"
                                        data-prueba="orden-cantidad"
                                    />
                                </UFormField>
                                <UButton
                                    icon="i-lucide-x"
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
                                v-if="linea.seguimiento === 'serie'"
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
                                    :aria-label="`Equipos de ${productoDe(linea.producto_id)?.nombre ?? 'producto'}`"
                                    data-prueba="orden-unidades"
                                />
                            </UFormField>
                        </li>
                    </ul>
                    <UFormField name="lineas" />
                </section>

                <UFormField
                    label="Motivo"
                    name="motivo"
                >
                    <UInput
                        v-model="estado.motivo"
                        placeholder="Reposición semanal"
                        class="w-full"
                        data-prueba="orden-motivo"
                    />
                </UFormField>
                <p class="flex items-start gap-1.5 text-xs text-muted">
                    <UIcon
                        name="i-lucide-circle-help"
                        class="mt-0.5 size-3.5 shrink-0"
                    />
                    El técnico confirma en Iris con su firma, aunque no tenga señal. Si falta algo al recibir, regresa a la bodega de origen.
                </p>
                <ProblemaAlerta
                    v-if="problema"
                    :problema="problema"
                    con-errores
                />
            </div>

            <div class="sticky bottom-0 flex flex-col-reverse gap-2 border-t border-(--ax-borde) bg-(--ax-tarjeta) p-4 sm:flex-row sm:items-center sm:justify-between">
                <span class="text-sm text-muted">
                    {{ estado.lineas.length }} {{ estado.lineas.length === 1 ? 'producto' : 'productos' }}{{ resumen ? ` · ${resumen} ${resumen === 1 ? 'equipo' : 'equipos'}` : '' }} · {{ formatearQuetzales(valorTotal.toFixed(2)) }}
                </span>
                <UButton
                    type="submit"
                    label="Enviar traslado"
                    icon="i-lucide-truck"
                    :loading="enviando"
                    class="justify-center rounded-full"
                    data-prueba="orden-enviar"
                />
            </div>
        </UForm>
    </PanelPagina>
</template>
