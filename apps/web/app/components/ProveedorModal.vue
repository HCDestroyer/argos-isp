<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { FormSubmitEvent, SelectItem } from '@nuxt/ui'

/**
 * Alta (`POST /proveedores`) o edición (`PUT /proveedores/:id`, con `version`) de un proveedor, ambas con
 * `proveedores.editar`. El documento y el país no se editan; en la edición solo viaja lo que cambió.
 */
const props = withDefaults(defineProps<{
    /** Con proveedor, edita; sin él, crea. */
    proveedor?: Proveedor | null
}>(), {
    proveedor: null,
})

const abierto = defineModel<boolean>('open', { default: false })

const emit = defineEmits<{
    hecho: [proveedor: Proveedor]
}>()

const formulario = useTemplateRef('formulario')
const edicion = computed(() => props.proveedor !== null)
const esquema = computed(() => esquemaProveedor(edicion.value))
const estado = reactive<EntradaProveedor>(proveedorVacio())
const enviando = ref(false)
const problema = ref<Problem | null>(null)
let clave = nuevaClaveIdempotencia()

const itemsDocumento: SelectItem[] = Object.entries(DOCUMENTOS_PROVEEDOR).map(([value, label]) => ({ label, value }))
const itemsTipo: SelectItem[] = Object.entries(TIPOS_PROVEEDOR).map(([value, label]) => ({ label, value }))
const itemsRegimen: SelectItem[] = [
    { label: 'Sin indicar', value: 'ninguno' },
    { label: 'Sobre utilidades', value: 'utilidades' },
    { label: 'Opcional simplificado (se le retiene ISR)', value: 'opcional_simplificado' },
    { label: 'Pequeño contribuyente', value: 'pequeno_contribuyente' },
]

watch(abierto, (valor) => {
    if (valor) {
        Object.assign(estado, proveedorVacio(props.proveedor ?? undefined))
        problema.value = null
        clave = nuevaClaveIdempotencia()
        formulario.value?.clear()
    }
})

async function enviar(evento: FormSubmitEvent<EntradaProveedor>) {
    enviando.value = true
    problema.value = null
    const resultado = props.proveedor
        ? await useProveedores().editar(props.proveedor.id, cuerpoEditarProveedor(evento.data, props.proveedor), clave)
        : await useProveedores().crear(cuerpoProveedorCompra(evento.data), clave)
    enviando.value = false
    if (resultado.ok) {
        abierto.value = false
        emit('hecho', resultado.data)
        return
    }
    const errores = erroresDeFormulario(resultado.problema)
    if (resultado.problema.status === 422 && errores.length && errores.every(e => e.name && e.name in estado)) {
        formulario.value?.setErrors(errores)
        return
    }
    problema.value = problemaCompraLegible(resultado.problema)
    clave = nuevaClaveIdempotencia()
}
</script>

<template>
    <UModal
        v-model:open="abierto"
        :title="edicion ? `Editar ${proveedor?.nombre}` : 'Nuevo proveedor'"
        :description="edicion ? 'El documento y el país no se editan. Queda en la bitácora con el cambio de cada campo.' : 'Con NIT (dígito verificador), CUI o identificación extranjera. Sus compras al crédito llevan su auxiliar en 2.1.03.'"
        :dismissible="!enviando"
    >
        <template #body>
            <UForm
                id="form-proveedor"
                ref="formulario"
                :schema="esquema"
                :state="estado"
                class="flex flex-col gap-4"
                @submit="enviar"
            >
                <div class="grid gap-4 sm:grid-cols-2">
                    <UFormField
                        label="Documento"
                        name="tipo_documento"
                    >
                        <USelect
                            v-model="estado.tipo_documento"
                            :items="itemsDocumento"
                            :disabled="edicion"
                            class="w-full"
                        />
                    </UFormField>
                    <UFormField
                        label="Número"
                        name="nit"
                        :required="!edicion"
                        :help="edicion ? undefined : 'Con o sin guion: 1234567-8'"
                    >
                        <UInput
                            v-model="estado.nit"
                            :disabled="edicion"
                            class="w-full"
                            data-prueba="proveedor-nit"
                        />
                    </UFormField>
                    <UFormField
                        label="Nombre o razón social"
                        name="nombre"
                        required
                        class="sm:col-span-2"
                    >
                        <UInput
                            v-model="estado.nombre"
                            class="w-full"
                            data-prueba="proveedor-nombre"
                        />
                    </UFormField>
                    <UFormField
                        label="Tipo"
                        name="tipo"
                    >
                        <USelect
                            v-model="estado.tipo"
                            :items="itemsTipo"
                            class="w-full"
                        />
                    </UFormField>
                    <UFormField
                        label="Régimen del ISR"
                        name="regimen_isr"
                        help="Al régimen opcional simplificado se le retiene ISR."
                    >
                        <USelect
                            v-model="estado.regimen_isr"
                            :items="itemsRegimen"
                            class="w-full"
                        />
                    </UFormField>
                    <UFormField
                        label="Días de crédito"
                        name="dias_credito"
                        help="Plazo por defecto de sus compras al crédito."
                    >
                        <UInputNumber
                            v-model="estado.dias_credito"
                            :min="0"
                            :max="365"
                            class="w-full"
                        />
                    </UFormField>
                    <UFormField
                        name="agente_retencion_iva"
                        class="self-end"
                    >
                        <UCheckbox
                            v-model="estado.agente_retencion_iva"
                            label="Es agente de retención de IVA"
                            description="No se le retiene IVA."
                        />
                    </UFormField>
                    <UFormField
                        label="Teléfono"
                        name="telefono"
                    >
                        <UInput
                            v-model="estado.telefono"
                            class="w-full"
                        />
                    </UFormField>
                    <UFormField
                        label="Correo"
                        name="correo"
                    >
                        <UInput
                            v-model="estado.correo"
                            type="email"
                            class="w-full"
                        />
                    </UFormField>
                    <UFormField
                        label="Dirección"
                        name="direccion"
                        class="sm:col-span-2"
                    >
                        <UInput
                            v-model="estado.direccion"
                            class="w-full"
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
                    form="form-proveedor"
                    :label="edicion ? 'Guardar cambios' : 'Crear proveedor'"
                    icon="i-lucide-check"
                    :loading="enviando"
                    data-prueba="guardar-proveedor"
                />
            </div>
        </template>
    </UModal>
</template>
