<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { FormSubmitEvent, SelectItem } from '@nuxt/ui'
import Decimal from 'decimal.js'

/**
 * Alta y edición de un producto del inventario (A3): SKU, nombre, unidad, tipo, seguimiento (por
 * cantidad o por serie; no cambia si ya tiene movimientos), clase de activo para el comodato,
 * cuentas propias de costo y consumo, existencia mínima y precio de venta (con IVA, el que sugiere
 * el cargo único). Al editar va la `version` (409).
 */
const props = withDefaults(defineProps<{
    producto?: Producto | null
}>(), {
    producto: null,
})

const abierto = defineModel<boolean>('open', { default: false })
const emit = defineEmits<{ guardado: [producto: Producto] }>()

const formulario = useTemplateRef('formulario')
const estado = reactive<EntradaProducto>(entradaProducto(null))
const enviando = ref(false)
const problema = ref<Problem | null>(null)
let clave = nuevaClaveIdempotencia()

/* Tipos del catálogo (D.2): sin leerlos no se puede elegir el tipo */
const tipos = shallowRef<TipoProducto[]>([])
const problemaTipos = ref<Problem | null>(null)
const cargandoTipos = ref(false)

async function cargarTipos() {
    cargandoTipos.value = true
    const resultado = await useTiposProducto().activos()
    cargandoTipos.value = false
    tipos.value = resultado.ok ? resultado.data : []
    problemaTipos.value = resultado.ok ? null : resultado.problema
}

watch(abierto, (valor) => {
    if (valor) {
        Object.assign(estado, entradaProducto(props.producto))
        problema.value = null
        clave = nuevaClaveIdempotencia()
        void cargarTipos()
    }
}, { immediate: true })

/** Un producto nuevo toma el seguimiento y la modalidad del tipo (luego se pueden cambiar). */
function elegirTipo(codigo: unknown) {
    if (typeof codigo !== 'string') {
        return
    }
    estado.tipo = codigo
    const tipo = tipos.value.find(t => t.codigo === codigo)
    if (tipo && !props.producto) {
        estado.seguimiento = tipo.seguimiento_defecto
        estado.modalidad = tipo.modalidad_defecto
    }
}

watch(() => estado.seguimiento, (seguimiento) => {
    if (!modalidadCompatible(estado.modalidad, seguimiento)) {
        estado.modalidad = seguimiento === 'serie' ? 'comodato' : 'consumible_gasto'
    }
})

const conMovimientos = computed(() => props.producto !== null && !new Decimal(props.producto.existencia).isZero())
const itemsTipo = computed<SelectItem[]>(() => {
    const items: SelectItem[] = tipos.value.map(t => ({ label: t.nombre, value: t.codigo, description: `${SEGUIMIENTOS[t.seguimiento_defecto].etiqueta} · ${MODALIDADES[t.modalidad_defecto].etiqueta}` }))
    // El tipo actual aunque esté desactivado (los productos que ya lo usan siguen igual).
    if (props.producto && !tipos.value.some(t => t.codigo === props.producto?.tipo)) {
        items.push({ label: nombreTipoProducto(props.producto), value: props.producto.tipo })
    }
    return items
})
const itemsModalidad = computed<SelectItem[]>(() => (Object.keys(MODALIDADES) as ModalidadProducto[])
    .filter(m => modalidadCompatible(m, estado.seguimiento))
    .map(m => ({ label: MODALIDADES[m].etiqueta, value: m, description: MODALIDADES[m].descripcion, icon: MODALIDADES[m].icono })))
const itemsSeguimiento: SelectItem[] = (Object.keys(SEGUIMIENTOS) as Producto['seguimiento'][]).map(s => ({ label: SEGUIMIENTOS[s].etiqueta, value: s, description: SEGUIMIENTOS[s].descripcion, icon: SEGUIMIENTOS[s].icono }))
const itemsClase: SelectItem[] = Object.entries(CLASES_ACTIVO).map(([value, label]) => ({ label, value }))

async function enviar(evento: FormSubmitEvent<SalidaProducto>) {
    enviando.value = true
    problema.value = null
    const cuerpo = cuerpoProducto(evento.data)
    const resultado = props.producto
        ? await useProductos().editar(props.producto.id, { ...cuerpo, version: props.producto.version })
        : await useProductos().crear(cuerpo, clave)
    enviando.value = false
    if (resultado.ok) {
        abierto.value = false
        emit('guardado', resultado.data)
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
    <USlideover
        v-model:open="abierto"
        :title="producto ? `Editar ${producto.nombre}` : 'Nuevo producto'"
        description="Lo que el ISP compra, guarda, presta o vende."
        :dismissible="!enviando"
        :ui="{ content: 'sm:max-w-lg' }"
    >
        <template #body>
            <UForm
                id="form-producto"
                ref="formulario"
                :schema="esquemaProducto"
                :state="estado"
                class="flex flex-col gap-4"
                @submit="enviar"
            >
                <div class="grid gap-4 sm:grid-cols-3">
                    <UFormField
                        label="SKU"
                        name="sku"
                        required
                    >
                        <UInput
                            v-model="estado.sku"
                            class="w-full font-mono"
                            data-prueba="producto-sku"
                        />
                    </UFormField>
                    <UFormField
                        label="Nombre"
                        name="nombre"
                        required
                        class="sm:col-span-2"
                    >
                        <UInput
                            v-model="estado.nombre"
                            class="w-full"
                            data-prueba="producto-nombre"
                        />
                    </UFormField>
                </div>
                <div class="grid gap-4 sm:grid-cols-2">
                    <UFormField
                        label="Tipo"
                        name="tipo"
                        required
                    >
                        <USelect
                            :model-value="estado.tipo"
                            :items="itemsTipo"
                            :loading="cargandoTipos"
                            class="w-full"
                            data-prueba="producto-tipo"
                            @update:model-value="elegirTipo"
                        />
                    </UFormField>
                    <UFormField
                        label="Unidad de medida"
                        name="unidad"
                        help="unidad, metro, caja…"
                    >
                        <UInput
                            v-model="estado.unidad"
                            class="w-full"
                            data-prueba="producto-unidad"
                        />
                    </UFormField>
                </div>
                <UFormField
                    label="Seguimiento"
                    name="seguimiento"
                    :help="conMovimientos ? 'Tiene existencias: el seguimiento ya no cambia.' : undefined"
                >
                    <USelect
                        v-model="estado.seguimiento"
                        :items="itemsSeguimiento"
                        :disabled="conMovimientos"
                        class="w-full"
                        data-prueba="producto-seguimiento"
                    />
                </UFormField>
                <UFormField
                    label="Modalidad"
                    name="modalidad"
                    :help="MODALIDADES[estado.modalidad].descripcion + (producto ? ' Cambiarla afecta solo lo que se registre después.' : '')"
                >
                    <USelect
                        v-model="estado.modalidad"
                        :items="itemsModalidad"
                        class="w-full"
                        data-prueba="producto-modalidad"
                    />
                </UFormField>
                <UFormField
                    v-if="estado.seguimiento === 'serie' && estado.modalidad === 'comodato'"
                    label="Clase de activo al prestarlo"
                    name="clase_activo"
                    help="En comodato pasa a activo fijo de esta clase y se deprecia."
                >
                    <USelect
                        v-model="estado.clase_activo"
                        :items="itemsClase"
                        class="w-full"
                    />
                </UFormField>
                <UFormField
                    label="Precio de venta"
                    name="precio_venta"
                    :help="estado.modalidad === 'consumible_cobro' ? 'Con IVA. Es el precio del cargo único al consumirlo con un servicio; sin precio, quien consume debe escribirlo.' : 'Con IVA. Lo sugiere el cargo único al vender el producto; vacío = sin precio.'"
                    :required="estado.modalidad === 'consumible_cobro'"
                >
                    <UInput
                        v-model="estado.precio_venta"
                        inputmode="decimal"
                        placeholder="0.00"
                        class="w-full sm:w-48"
                        data-prueba="producto-precio"
                    >
                        <template #leading>
                            <span class="text-sm text-muted">Q</span>
                        </template>
                    </UInput>
                </UFormField>
                <div class="grid gap-4 sm:grid-cols-3">
                    <UFormField
                        label="Existencia mínima"
                        name="existencia_minima"
                        help="Vacío = sin aviso."
                    >
                        <UInput
                            v-model="estado.existencia_minima"
                            inputmode="decimal"
                            class="w-full"
                            data-prueba="producto-minimo"
                        />
                    </UFormField>
                    <UFormField
                        label="Cuenta de costo"
                        name="cuenta_costo"
                        help="Vacío = 5.6.01"
                    >
                        <UInput
                            v-model="estado.cuenta_costo"
                            placeholder="5.6.01"
                            class="w-full font-mono"
                        />
                    </UFormField>
                    <UFormField
                        label="Cuenta de consumo"
                        name="cuenta_consumo"
                        help="Vacío = 5.2.07"
                    >
                        <UInput
                            v-model="estado.cuenta_consumo"
                            placeholder="5.2.07"
                            class="w-full font-mono"
                        />
                    </UFormField>
                </div>
                <ProblemaAlerta
                    v-if="problemaTipos"
                    :problema="problemaTipos"
                    :reintentar="cargarTipos"
                    :reintentando="cargandoTipos"
                />
                <ProblemaAlerta
                    v-if="problema"
                    :problema="problema"
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
                    form="form-producto"
                    :label="producto ? 'Guardar cambios' : 'Crear producto'"
                    icon="i-lucide-check"
                    :loading="enviando"
                    data-prueba="producto-guardar"
                />
            </div>
        </template>
    </USlideover>
</template>
