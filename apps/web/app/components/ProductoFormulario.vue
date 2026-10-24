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

watch(abierto, (valor) => {
    if (valor) {
        Object.assign(estado, entradaProducto(props.producto))
        problema.value = null
        clave = nuevaClaveIdempotencia()
    }
}, { immediate: true })

const conMovimientos = computed(() => props.producto !== null && !new Decimal(props.producto.existencia).isZero())
const itemsTipo: SelectItem[] = Object.entries(TIPOS_PRODUCTO).map(([value, label]) => ({ label, value }))
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
                    >
                        <USelect
                            v-model="estado.tipo"
                            :items="itemsTipo"
                            class="w-full"
                            data-prueba="producto-tipo"
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
                    v-if="estado.seguimiento === 'serie'"
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
                    help="Con IVA. Lo sugiere el cargo único al vender el producto; vacío = sin precio."
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
