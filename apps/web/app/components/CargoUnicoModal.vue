<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { FormSubmitEvent, SelectItem } from '@nuxt/ui'
import type Decimal from 'decimal.js'

/**
 * Cargo único manual (`POST /facturas/cargo-unico`, `facturas.emitir_cargo_unico`): instalación,
 * equipo, visita técnica… con conceptos del catálogo de la empresa (cuenta de ingreso e IVA), precio
 * con IVA y un descuento opcional por línea. Si todo queda descontado (Q 0.00) no hay factura sino
 * una **bonificación** (decisión del PM): pide motivo del catálogo, explicación y el permiso
 * `facturas.cargo_sin_costo`; sin él la API responde 403 y aquí se avisa antes.
 * Venta de inventario (A3, fase C; con `inventario.ver`): elegir un producto llena el concepto (el
 * suyo, si lo tiene), la descripción y el precio sugerido (`precio_venta`), pide la bodega de donde sale y, por serie, el equipo; la API
 * asienta el costo de ventas en la misma factura.
 */
const props = defineProps<{
    /** Del servicio (su empresa, cliente y días de gracia) o de un cliente sin servicio. */
    destino: { servicio: Servicio } | { cliente: Cliente, empresaId: number | null }
}>()

const abierto = defineModel<boolean>('open', { default: false })

const emit = defineEmits<{
    hecho: [resultado: CargoUnicoEmitido]
}>()

const { puede } = usePermisos()
const usuario = useUsuarioActual()
const formulario = useTemplateRef('formulario')
const estado = reactive<EntradaCargoUnico>(entradaCargoUnicoVacia())
const enviando = ref(false)
const problema = ref<Problem | null>(null)
let clave = nuevaClaveIdempotencia()

const conceptos = shallowRef<ConceptoCargo[]>([])
const motivos = shallowRef<MotivoSinCosto[]>([])
const cargandoListas = ref(false)
const problemaListas = ref<Problem | null>(null)

const empresaId = computed(() => ('servicio' in props.destino ? props.destino.servicio.empresa_id : props.destino.empresaId))
const titulo = computed(() => ('servicio' in props.destino ? props.destino.servicio.user_ppp : props.destino.cliente.nombre))
const puedeSinCosto = computed(() => puede('facturas.cargo_sin_costo'))
/** Un cargo sin servicio es de una empresa: con «Todas las empresas» no se sabe cuál (la API pide una). */
const sinEmpresa = computed(() => !('servicio' in props.destino) && props.destino.empresaId === null)

const itemsConcepto = computed<SelectItem[]>(() => conceptos.value
    .filter(c => empresaId.value === null || c.empresa_id === empresaId.value)
    .map(c => ({ label: c.nombre, value: c.id, description: `${c.cuenta_codigo}${c.gravable ? ' · con IVA' : ' · exento'}` })))
const itemsMotivo = computed<SelectItem[]>(() => motivos.value
    .filter(m => empresaId.value === null || m.empresa_id === empresaId.value)
    .map(m => ({ label: m.nombre, value: m.id })))

const total = computed(() => totalCargoUnico(estado.lineas))
const sinCosto = computed(() => total.value?.isZero() ?? false)

/* Inventario: productos, bodegas y equipos disponibles para vender. */
const productos = shallowRef<Producto[]>([])
const bodegas = shallowRef<Bodega[]>([])
const equiposPorLinea = ref<Record<number, SelectItem[]>>({})
const itemsProducto = computed<SelectItem[]>(() => [
    { label: 'Sin producto', value: 0 },
    ...productos.value.filter(p => empresaId.value === null || p.empresa_id === empresaId.value).map(p => ({ label: `${p.nombre} · ${p.sku}`, value: p.id, description: `${formatearCantidad(p.existencia, p.unidad)} en existencia` })),
])
const itemsBodega = computed<SelectItem[]>(() => bodegas.value.filter(b => empresaId.value === null || b.empresa_id === empresaId.value).map(b => ({ label: b.nombre, value: b.id })))

async function cargarInventario() {
    if (!puede('inventario.ver')) {
        return
    }
    const [p, b] = await Promise.all([useProductos().activos(), useBodegas().activas()])
    productos.value = p.ok ? p.data : []
    bodegas.value = b.ok ? b.data : []
}

function elegirProducto(indice: number, valor: unknown) {
    const linea = estado.lineas[indice]
    if (!linea) {
        return
    }
    const producto = productos.value.find(p => p.id === valor) ?? null
    linea.producto_id = producto?.id ?? null
    linea.seguimiento = producto?.seguimiento ?? null
    linea.unidad_id = null
    if (producto) {
        linea.concepto_id = producto.concepto_cargo_id ?? linea.concepto_id
        linea.descripcion = linea.descripcion || producto.nombre
        // precio de venta sugerido (A3, con IVA); el operador lo puede cambiar
        if (producto.precio_venta) {
            linea.precio_unitario = producto.precio_venta
        }
        if (producto.seguimiento === 'serie') {
            linea.cantidad = '1'
        }
    }
    void cargarEquipos(indice)
}

async function cargarEquipos(indice: number) {
    const linea = estado.lineas[indice]
    if (!linea?.producto_id || linea.seguimiento !== 'serie' || !linea.bodega_id) {
        return
    }
    const resultado = await useUnidadesInventario().listar({ producto_id: linea.producto_id, bodega_id: linea.bodega_id, estado: 'disponible', limit: 200 })
    equiposPorLinea.value = { ...equiposPorLinea.value, [indice]: resultado.ok ? resultado.data.data.map(u => ({ label: identificacionUnidad(u), value: u.id, description: CONDICIONES_UNIDAD[u.condicion] })) : [] }
}

async function cargarListas() {
    void cargarInventario()
    cargandoListas.value = true
    problemaListas.value = null
    const todas = usuario.value?.alcance_global === true
    const [rConceptos, rMotivos] = await Promise.all([
        puede('facturas.ver') ? useCargoUnico().conceptos(todas) : null,
        puede('facturas.ver') && puedeSinCosto.value ? useCargoUnico().motivos(todas) : null,
    ])
    cargandoListas.value = false
    conceptos.value = rConceptos?.ok ? rConceptos.data : []
    motivos.value = rMotivos?.ok ? rMotivos.data : []
    problemaListas.value = (rConceptos && !rConceptos.ok ? rConceptos.problema : null) ?? (rMotivos && !rMotivos.ok ? rMotivos.problema : null)
}

watch(abierto, (valor) => {
    if (valor) {
        Object.assign(estado, entradaCargoUnicoVacia())
        problema.value = null
        clave = nuevaClaveIdempotencia()
        void cargarListas()
    }
}, { immediate: true })

function agregarLinea() {
    estado.lineas.push(lineaCargoVacia())
}

function quitarLinea(indice: number) {
    estado.lineas.splice(indice, 1)
}

function netoLinea(linea: EntradaLineaCargo): Decimal | null {
    return totalesLineaCargo(linea)?.neto ?? null
}

async function enviar(evento: FormSubmitEvent<EntradaCargoUnico>) {
    enviando.value = true
    problema.value = null
    const destino = 'servicio' in props.destino
        ? { servicio_id: props.destino.servicio.id }
        : { cliente_id: props.destino.cliente.id, empresa_id: props.destino.empresaId }
    const resultado = await useCargoUnico().emitir(cuerpoCargoUnico(destino, esquemaCargoUnico.parse(evento.data)), clave)
    enviando.value = false
    if (resultado.ok) {
        abierto.value = false
        emit('hecho', resultado.data)
        return
    }
    const errores = erroresDeFormulario(resultado.problema).filter(e => e.name && /^(vence_en|motivo_sin_costo_id|motivo_sin_costo_texto|lineas\.\d+\.\w+)$/.test(e.name))
    if (errores.length) {
        formulario.value?.setErrors(errores.map(e => ({ ...e, name: e.name?.replace(/\.descuentos\.\d+\.monto$/, '.descuento') })))
    }
    problema.value = resultado.problema
}
</script>

<template>
    <UModal
        v-model:open="abierto"
        title="Cargo único"
        :description="`${titulo} · instalación, equipo, visita técnica…`"
        :dismissible="!enviando"
        :ui="{ content: 'sm:max-w-2xl' }"
    >
        <template #body>
            <UForm
                id="form-cargo-unico"
                ref="formulario"
                :schema="esquemaCargoUnico"
                :state="estado"
                class="flex flex-col gap-4"
                @submit="enviar"
            >
                <UAlert
                    v-if="sinEmpresa"
                    color="warning"
                    variant="subtle"
                    icon="i-lucide-building-2"
                    title="Elija la empresa"
                    description="Un cargo sin servicio se emite en la empresa activa: elija una en el selector de empresas (no «Todas»)."
                    data-prueba="cargo-sin-empresa"
                />
                <ProblemaAlerta
                    v-if="problemaListas"
                    :problema="problemaListas"
                    :reintentar="cargarListas"
                    :reintentando="cargandoListas"
                />
                <div
                    v-for="(linea, indice) in estado.lineas"
                    :key="indice"
                    class="flex flex-col gap-3 rounded-lg border border-default p-3"
                    :data-linea-cargo="indice + 1"
                >
                    <div class="flex items-center justify-between gap-2">
                        <span class="text-sm font-medium text-highlighted">Línea {{ indice + 1 }}</span>
                        <div class="flex items-center gap-2">
                            <span
                                v-if="netoLinea(linea)"
                                class="text-sm tabular-nums text-muted"
                            >{{ formatearQuetzales(netoLinea(linea)) }}</span>
                            <UButton
                                v-if="estado.lineas.length > 1"
                                icon="i-lucide-trash-2"
                                color="error"
                                variant="ghost"
                                size="sm"
                                :aria-label="`Quitar la línea ${indice + 1}`"
                                @click="quitarLinea(indice)"
                            />
                        </div>
                    </div>
                    <div class="grid gap-3 sm:grid-cols-6">
                        <UFormField
                            label="Concepto"
                            :name="`lineas.${indice}.concepto_id`"
                            required
                            class="sm:col-span-6"
                        >
                            <USelect
                                :model-value="linea.concepto_id ?? undefined"
                                :items="itemsConcepto"
                                :loading="cargandoListas"
                                placeholder="Del catálogo de la empresa"
                                class="w-full"
                                :data-prueba="`cargo-concepto-${indice + 1}`"
                                @update:model-value="linea.concepto_id = typeof $event === 'number' ? $event : null"
                            />
                        </UFormField>
                        <template v-if="productos.length">
                            <UFormField
                                label="Producto del inventario"
                                :name="`lineas.${indice}.producto_id`"
                                help="Opcional: sale de la bodega con su costo."
                                class="sm:col-span-6"
                            >
                                <USelectMenu
                                    :model-value="linea.producto_id ?? 0"
                                    :items="itemsProducto"
                                    value-key="value"
                                    class="w-full"
                                    :data-prueba="`cargo-producto-${indice + 1}`"
                                    @update:model-value="elegirProducto(indice, $event)"
                                />
                            </UFormField>
                            <UFormField
                                v-if="linea.producto_id"
                                label="Bodega"
                                :name="`lineas.${indice}.bodega_id`"
                                required
                                class="sm:col-span-3"
                            >
                                <USelect
                                    :model-value="linea.bodega_id ?? undefined"
                                    :items="itemsBodega"
                                    placeholder="De dónde sale"
                                    class="w-full"
                                    :data-prueba="`cargo-bodega-${indice + 1}`"
                                    @update:model-value="linea.bodega_id = typeof $event === 'number' ? $event : null; cargarEquipos(indice)"
                                />
                            </UFormField>
                            <UFormField
                                v-if="linea.producto_id && linea.seguimiento === 'serie'"
                                label="Equipo"
                                :name="`lineas.${indice}.unidad_id`"
                                required
                                class="sm:col-span-3"
                            >
                                <USelectMenu
                                    :model-value="linea.unidad_id ?? undefined"
                                    :items="equiposPorLinea[indice] ?? []"
                                    value-key="value"
                                    placeholder="Serie o MAC"
                                    class="w-full"
                                    :data-prueba="`cargo-unidad-${indice + 1}`"
                                    @update:model-value="linea.unidad_id = typeof $event === 'number' ? $event : null"
                                />
                            </UFormField>
                        </template>
                        <UFormField
                            label="Descripción"
                            :name="`lineas.${indice}.descripcion`"
                            class="sm:col-span-6"
                        >
                            <UInput
                                v-model="linea.descripcion"
                                placeholder="Opcional: lo que verá el cliente"
                                class="w-full"
                            />
                        </UFormField>
                        <UFormField
                            label="Cantidad"
                            :name="`lineas.${indice}.cantidad`"
                            class="sm:col-span-2"
                        >
                            <UInput
                                v-model="linea.cantidad"
                                inputmode="decimal"
                                class="w-full"
                            />
                        </UFormField>
                        <UFormField
                            label="Precio con IVA"
                            :name="`lineas.${indice}.precio_unitario`"
                            required
                            class="sm:col-span-2"
                        >
                            <UInput
                                v-model="linea.precio_unitario"
                                inputmode="decimal"
                                placeholder="150.00"
                                class="w-full"
                                :data-prueba="`cargo-precio-${indice + 1}`"
                            >
                                <template #leading>
                                    <span class="text-sm text-muted">Q</span>
                                </template>
                            </UInput>
                        </UFormField>
                        <UFormField
                            label="Descuento"
                            :name="`lineas.${indice}.descuento`"
                            class="sm:col-span-2"
                        >
                            <UInput
                                v-model="linea.descuento"
                                inputmode="decimal"
                                placeholder="0.00"
                                class="w-full"
                                :data-prueba="`cargo-descuento-${indice + 1}`"
                            >
                                <template #leading>
                                    <span class="text-sm text-muted">Q</span>
                                </template>
                            </UInput>
                        </UFormField>
                        <UFormField
                            v-if="linea.descuento.trim()"
                            label="Por qué se descuenta"
                            :name="`lineas.${indice}.descuento_concepto`"
                            required
                            class="sm:col-span-6"
                        >
                            <UInput
                                v-model="linea.descuento_concepto"
                                placeholder="Ej.: promoción de instalación gratis"
                                class="w-full"
                                :data-prueba="`cargo-descuento-concepto-${indice + 1}`"
                            />
                        </UFormField>
                    </div>
                </div>
                <UButton
                    label="Agregar línea"
                    icon="i-lucide-plus"
                    color="neutral"
                    variant="ghost"
                    size="sm"
                    class="self-start"
                    @click="agregarLinea"
                />

                <div class="grid gap-4 sm:grid-cols-2">
                    <UFormField
                        label="Vence"
                        name="vence_en"
                        help="Vacío: hoy más los días de gracia del servicio."
                    >
                        <UInput
                            v-model="estado.vence_en"
                            type="date"
                            class="w-full"
                        />
                    </UFormField>
                    <div class="flex flex-col justify-end gap-0.5 sm:items-end">
                        <span class="text-xs text-muted">Total con IVA</span>
                        <span
                            class="text-xl font-semibold tabular-nums text-highlighted"
                            data-prueba="cargo-total"
                        >{{ total ? formatearQuetzales(total) : '—' }}</span>
                    </div>
                </div>

                <template v-if="sinCosto">
                    <UAlert
                        :color="puedeSinCosto ? 'info' : 'warning'"
                        variant="subtle"
                        icon="i-lucide-hand-heart"
                        title="Sin costo: será una bonificación, no una factura"
                        :description="puedeSinCosto
                            ? 'Con todo descontado no se emite factura (nunca una de Q 0.00): queda como bonificación con su motivo, el valor bruto regalado y un asiento interno, sin IVA ni DTE.'
                            : 'Registrar un cargo sin costo pide el permiso facturas.cargo_sin_costo. Pida a quien lo tenga que lo emita, o deje un precio por cobrar.'"
                        data-prueba="cargo-sin-costo"
                    />
                    <template v-if="puedeSinCosto">
                        <UFormField
                            label="Motivo"
                            name="motivo_sin_costo_id"
                            required
                        >
                            <USelect
                                :model-value="estado.motivo_sin_costo_id ?? undefined"
                                :items="itemsMotivo"
                                :loading="cargandoListas"
                                placeholder="Del catálogo de la empresa"
                                class="w-full"
                                data-prueba="cargo-motivo"
                                @update:model-value="estado.motivo_sin_costo_id = typeof $event === 'number' ? $event : null"
                            />
                        </UFormField>
                        <UFormField
                            label="Explicación"
                            name="motivo_sin_costo_texto"
                            required
                        >
                            <UTextarea
                                v-model="estado.motivo_sin_costo_texto"
                                :rows="2"
                                autoresize
                                placeholder="Ej.: instalación regalada por la campaña de octubre"
                                class="w-full"
                                data-prueba="cargo-motivo-texto"
                            />
                        </UFormField>
                    </template>
                </template>

                <ProblemaAlerta
                    v-if="problema"
                    :problema="problema"
                    data-prueba="cargo-problema"
                />
            </UForm>
        </template>
        <template #footer>
            <div class="flex w-full justify-end gap-2">
                <UButton
                    label="Cancelar"
                    color="neutral"
                    variant="ghost"
                    :disabled="enviando"
                    @click="abierto = false"
                />
                <UButton
                    type="submit"
                    form="form-cargo-unico"
                    :label="sinCosto ? 'Registrar bonificación' : 'Emitir cargo'"
                    :icon="sinCosto ? 'i-lucide-hand-heart' : 'i-lucide-receipt'"
                    :loading="enviando"
                    :disabled="sinEmpresa || (sinCosto && !puedeSinCosto)"
                    data-prueba="emitir-cargo"
                />
            </div>
        </template>
    </UModal>
</template>
