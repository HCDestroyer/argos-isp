<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { FormSubmitEvent, SelectItem } from '@nuxt/ui'
import Decimal from 'decimal.js'

/**
 * Una operación del inventario (A3, `contratos/inventario.md` §5): saldo inicial, consumo,
 * traslado, ajuste o baja. Por cantidad pide cuánto; por serie, los equipos (o la serie/MAC del
 * que entra). Muestra la existencia y el costo promedio de la bodega antes de confirmar. Una
 * `Idempotency-Key` por apertura; 409 `existencia_insuficiente` y los 422 se ven aquí y nada cambia.
 */
const props = withDefaults(defineProps<{
    operacion: OperacionInventario
    productos: Producto[]
    bodegas: Bodega[]
    /** Producto y bodega ya elegidos (desde una fila de existencias). */
    productoId?: number | null
    bodegaId?: number | null
}>(), {
    productoId: null,
    bodegaId: null,
})

const abierto = defineModel<boolean>('open', { default: false })
const emit = defineEmits<{ hecho: [operacion: OperacionInventario] }>()

const formulario = useTemplateRef('formulario')
const estado = reactive<EntradaOperacion>(operacionVacia(props.operacion))
const enviando = ref(false)
const problema = ref<Problem | null>(null)
let clave = nuevaClaveIdempotencia()

const info = computed(() => OPERACIONES_INVENTARIO[estado.operacion])
const producto = computed(() => props.productos.find(p => p.id === estado.producto_id) ?? null)
const porSerie = computed(() => producto.value?.seguimiento === 'serie')

watch(abierto, (valor) => {
    if (valor) {
        Object.assign(estado, operacionVacia(props.operacion), {
            producto_id: props.productoId ?? 0,
            bodega_id: props.bodegaId ?? (props.bodegas.length === 1 ? props.bodegas[0]?.id ?? 0 : 0),
        })
        problema.value = null
        clave = nuevaClaveIdempotencia()
    }
}, { immediate: true })

watch(producto, (p) => {
    estado.seguimiento = p?.seguimiento ?? 'cantidad'
    estado.unidad_ids = []
    if (p?.seguimiento === 'serie' && estado.operacion === 'ajuste') {
        estado.cantidad = '1'
    }
})

const itemsProducto = computed<SelectItem[]>(() => props.productos.map(p => ({ label: `${p.nombre} · ${p.sku}`, value: p.id })))
type OpcionBodega = { label: string, value: number, icon: string }
const itemsBodega = computed<OpcionBodega[]>(() => props.bodegas.map(b => ({ label: b.tipo === 'tecnico' ? `${b.nombre} (técnico)` : b.nombre, value: b.id, icon: TIPOS_BODEGA[b.tipo].icono })))
const itemsDestino = computed<OpcionBodega[]>(() => itemsBodega.value.filter(i => i.value !== estado.bodega_id))
const itemsCausa: SelectItem[] = Object.entries(CAUSAS_BAJA).map(([value, label]) => ({ label, value }))
const itemsSentido: SelectItem[] = [
    { label: 'Entra un equipo (sobrante)', value: '1' },
    { label: 'Sale un equipo (faltante)', value: '-1' },
]

/* Existencia y equipos disponibles en la bodega elegida */
const existencia = shallowRef<ExistenciaInventario | null>(null)
const unidades = shallowRef<UnidadInventario[]>([])
const cargandoBodega = ref(false)

async function leerBodega() {
    existencia.value = null
    unidades.value = []
    if (!estado.producto_id || !estado.bodega_id) {
        return
    }
    cargandoBodega.value = true
    const [saldo, equipos] = await Promise.all([
        useInventario().existencias({ producto_id: estado.producto_id, bodega_id: estado.bodega_id }),
        porSerie.value ? useUnidadesInventario().listar({ producto_id: estado.producto_id, bodega_id: estado.bodega_id, limit: 200 }) : null,
    ])
    cargandoBodega.value = false
    existencia.value = saldo.ok ? saldo.data.data[0] ?? null : null
    const utiles: UnidadInventario['estado'][] = estado.operacion === 'traslado' || estado.operacion === 'baja' || estado.operacion === 'ajuste' ? ['disponible', 'en_reparacion'] : ['disponible']
    unidades.value = equipos?.ok ? equipos.data.data.filter(u => utiles.includes(u.estado)) : []
}

watch(() => [estado.producto_id, estado.bodega_id, abierto.value], () => {
    if (abierto.value) {
        void leerBodega()
    }
})

const itemsUnidad = computed<SelectItem[]>(() => unidades.value.map(u => ({
    label: identificacionUnidad(u),
    value: u.id,
    description: `${ESTADOS_UNIDAD[u.estado].etiqueta} · ${CONDICIONES_UNIDAD[u.condicion]} · ${formatearQuetzales(u.costo)}`,
})))
const unidadUnica = computed<number | undefined>({
    get: () => estado.unidad_ids[0],
    set: (valor) => {
        estado.unidad_ids = typeof valor === 'number' ? [valor] : []
    },
})

const pideSerieNueva = computed(() => porSerie.value && (estado.operacion === 'saldo_inicial' || (estado.operacion === 'ajuste' && !estado.cantidad.startsWith('-'))))
const pideUnaUnidad = computed(() => porSerie.value && (estado.operacion === 'baja' || (estado.operacion === 'ajuste' && estado.cantidad.startsWith('-'))))
const pideCosto = computed(() => estado.operacion === 'saldo_inicial' || estado.operacion === 'ajuste')
const pideFecha = computed(() => estado.operacion === 'saldo_inicial' || estado.operacion === 'consumo' || estado.operacion === 'ajuste')

async function enviar(evento: FormSubmitEvent<SalidaOperacion>) {
    enviando.value = true
    problema.value = null
    const pedido = cuerpoOperacion(evento.data)
    const inventario = useInventario()
    let resultado: Resultado<unknown>
    switch (pedido.operacion) {
        case 'saldo_inicial':
            resultado = await inventario.saldoInicial(pedido.cuerpo, clave)
            break
        case 'consumo':
            resultado = await inventario.consumir(pedido.cuerpo, clave)
            break
        case 'traslado':
            resultado = await inventario.trasladar(pedido.cuerpo, clave)
            break
        case 'ajuste':
            resultado = await inventario.ajustar(pedido.cuerpo, clave)
            break
        case 'baja':
            resultado = await inventario.darDeBaja(pedido.cuerpo, clave)
            break
    }
    enviando.value = false
    if (resultado.ok) {
        abierto.value = false
        emit('hecho', estado.operacion)
        return
    }
    const errores = erroresDeFormulario(resultado.problema).map(e => ({ ...e, name: e.name === 'bodega_origen_id' ? 'bodega_id' : (e.name?.startsWith('unidad.') ? e.name.slice('unidad.'.length) : e.name) }))
    if (errores.length) {
        formulario.value?.setErrors(errores)
    }
    problema.value = resultado.problema
}
</script>

<template>
    <USlideover
        v-model:open="abierto"
        :title="info.etiqueta"
        :description="info.descripcion"
        :dismissible="!enviando"
        :ui="{ content: 'sm:max-w-lg' }"
    >
        <template #body>
            <UForm
                id="form-movimiento-inventario"
                ref="formulario"
                :schema="esquemaOperacion"
                :state="estado"
                class="flex flex-col gap-4"
                @submit="enviar"
            >
                <UFormField
                    label="Producto"
                    name="producto_id"
                    required
                >
                    <USelectMenu
                        :model-value="estado.producto_id || undefined"
                        :items="itemsProducto"
                        value-key="value"
                        placeholder="Busca por nombre o SKU"
                        class="w-full"
                        data-prueba="mov-producto"
                        @update:model-value="v => estado.producto_id = typeof v === 'number' ? v : 0"
                    />
                </UFormField>
                <div class="grid gap-4 sm:grid-cols-2">
                    <UFormField
                        :label="estado.operacion === 'traslado' ? 'Desde' : 'Bodega'"
                        name="bodega_id"
                        required
                    >
                        <USelect
                            :model-value="estado.bodega_id || undefined"
                            :items="itemsBodega"
                            placeholder="Elige la bodega"
                            class="w-full"
                            data-prueba="mov-bodega"
                            @update:model-value="v => estado.bodega_id = typeof v === 'number' ? v : 0"
                        />
                    </UFormField>
                    <UFormField
                        v-if="estado.operacion === 'traslado'"
                        label="Hacia"
                        name="bodega_destino_id"
                        required
                    >
                        <USelect
                            :model-value="estado.bodega_destino_id ?? undefined"
                            :items="itemsDestino"
                            placeholder="Bodega o técnico"
                            class="w-full"
                            data-prueba="mov-destino"
                            @update:model-value="v => estado.bodega_destino_id = typeof v === 'number' ? v : null"
                        />
                    </UFormField>
                </div>

                <p
                    v-if="producto && estado.bodega_id"
                    class="text-sm text-muted"
                    data-prueba="mov-existencia"
                >
                    <template v-if="cargandoBodega">
                        Leyendo la existencia…
                    </template>
                    <template v-else-if="existencia">
                        Hay {{ formatearCantidad(existencia.cantidad, producto.unidad) }} · valor {{ formatearQuetzales(existencia.valor) }}<template v-if="existencia.costo_promedio">
                            · promedio {{ formatearQuetzales(new Decimal(existencia.costo_promedio).toFixed(2)) }} c/u
                        </template>
                    </template>
                    <template v-else>
                        Sin existencia en esta bodega.
                    </template>
                </p>

                <UFormField
                    v-if="porSerie && estado.operacion === 'ajuste'"
                    label="Ajuste"
                    name="cantidad"
                >
                    <USelect
                        v-model="estado.cantidad"
                        :items="itemsSentido"
                        class="w-full"
                        data-prueba="mov-sentido"
                    />
                </UFormField>
                <UFormField
                    v-if="!porSerie"
                    :label="estado.operacion === 'ajuste' ? 'Cantidad (+ entra, − sale)' : 'Cantidad'"
                    name="cantidad"
                    :help="producto ? `En ${producto.unidad}` : undefined"
                    required
                >
                    <UInput
                        v-model="estado.cantidad"
                        inputmode="decimal"
                        :placeholder="estado.operacion === 'ajuste' ? '-2 o 5' : '10'"
                        class="w-full"
                        data-prueba="mov-cantidad"
                    />
                </UFormField>
                <div
                    v-if="pideSerieNueva"
                    class="grid gap-4 sm:grid-cols-2"
                >
                    <UFormField
                        label="Serie"
                        name="serie"
                    >
                        <UInput
                            v-model="estado.serie"
                            class="w-full font-mono"
                            data-prueba="mov-serie"
                        />
                    </UFormField>
                    <UFormField
                        label="MAC"
                        name="mac"
                    >
                        <UInput
                            v-model="estado.mac"
                            placeholder="AA:BB:CC:DD:EE:FF"
                            class="w-full font-mono"
                            data-prueba="mov-mac"
                        />
                    </UFormField>
                </div>
                <UFormField
                    v-if="porSerie && estado.operacion === 'traslado'"
                    label="Equipos"
                    name="unidad_ids"
                    :help="unidades.length ? undefined : 'No hay equipos disponibles en esta bodega.'"
                    required
                >
                    <USelectMenu
                        v-model="estado.unidad_ids"
                        :items="itemsUnidad"
                        value-key="value"
                        multiple
                        placeholder="Busca por serie o MAC"
                        class="w-full"
                        data-prueba="mov-unidades"
                    />
                </UFormField>
                <UFormField
                    v-if="pideUnaUnidad"
                    label="Equipo"
                    name="unidad_ids"
                    required
                >
                    <USelectMenu
                        v-model="unidadUnica"
                        :items="itemsUnidad"
                        value-key="value"
                        placeholder="Busca por serie o MAC"
                        class="w-full"
                        data-prueba="mov-unidad"
                    />
                </UFormField>

                <div
                    v-if="pideCosto || pideFecha"
                    class="grid gap-4 sm:grid-cols-2"
                >
                    <UFormField
                        v-if="pideCosto"
                        :label="porSerie && estado.operacion === 'saldo_inicial' ? 'Costo del equipo' : 'Costo unitario'"
                        name="costo_unitario"
                        :help="estado.operacion === 'ajuste' ? 'Solo si entra sin existencia (si no, va al promedio).' : undefined"
                        :required="estado.operacion === 'saldo_inicial'"
                    >
                        <UInput
                            v-model="estado.costo_unitario"
                            inputmode="decimal"
                            class="w-full"
                            data-prueba="mov-costo"
                        >
                            <template #leading>
                                <span class="text-sm text-muted">Q</span>
                            </template>
                        </UInput>
                    </UFormField>
                    <UFormField
                        v-if="pideFecha"
                        label="Fecha"
                        name="fecha"
                        help="Vacío = hoy."
                    >
                        <UInput
                            v-model="estado.fecha"
                            type="date"
                            class="w-full"
                            data-prueba="mov-fecha"
                        />
                    </UFormField>
                </div>
                <UFormField
                    v-if="estado.operacion === 'consumo'"
                    label="Servicio (opcional)"
                    name="servicio_id"
                    help="El número del servicio donde se instaló."
                >
                    <UInputNumber
                        :model-value="estado.servicio_id ?? undefined"
                        :min="1"
                        :format-options="{ useGrouping: false }"
                        class="w-full"
                        @update:model-value="v => estado.servicio_id = typeof v === 'number' ? v : null"
                    />
                </UFormField>
                <UFormField
                    v-if="estado.operacion === 'baja'"
                    label="Causa"
                    name="causa"
                >
                    <USelect
                        v-model="estado.causa"
                        :items="itemsCausa"
                        class="w-full"
                        data-prueba="mov-causa"
                    />
                </UFormField>
                <UFormField
                    label="Motivo"
                    name="motivo"
                    :required="estado.operacion === 'ajuste' || estado.operacion === 'baja'"
                >
                    <UTextarea
                        v-model="estado.motivo"
                        :rows="2"
                        autoresize
                        class="w-full"
                        data-prueba="mov-motivo"
                    />
                </UFormField>
                <ProblemaAlerta
                    v-if="problema"
                    :problema="problema"
                    data-prueba="mov-error"
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
                    form="form-movimiento-inventario"
                    :label="info.confirmar"
                    :icon="info.icono"
                    :color="estado.operacion === 'baja' ? 'error' : 'primary'"
                    :loading="enviando"
                    data-prueba="mov-confirmar"
                />
            </div>
        </template>
    </USlideover>
</template>
