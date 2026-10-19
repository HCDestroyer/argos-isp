<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { FormSubmitEvent, SelectItem } from '@nuxt/ui'

/**
 * Alta y edición de un proveedor de cobro (`POST`/`PUT /cobros/proveedores`, `cobros.configurar`).
 * La fecha de corte es hoy o futura; al editar se puede mover o desactivar el proveedor mientras no
 * tenga pagos (con pagos la API responde 409 `proveedor_con_pagos` y se muestra aquí).
 */
const props = withDefaults(defineProps<{
    proveedor?: ProveedorCobro | null
}>(), {
    proveedor: null,
})

const abierto = defineModel<boolean>('open', { default: false })

const emit = defineEmits<{
    hecho: [proveedor: ProveedorCobro]
}>()

const formulario = useTemplateRef('formulario')
const hoy = hoyGuatemala()
const esquema = computed(() => esquemaProveedorCobro(hoy, props.proveedor?.desde ?? null))
const estado = reactive<EntradaProveedorCobro>(entradaProveedorVacia())
const enviando = ref(false)
const problema = ref<Problem | null>(null)
let clave = nuevaClaveIdempotencia()

const editando = computed(() => props.proveedor !== null)
const itemsMetodo: SelectItem[] = Object.entries(METODOS_PROVEEDOR).map(([value, m]) => ({ label: m.etiqueta, value, description: m.descripcion, icon: m.icono }))

watch(abierto, (valor) => {
    if (valor) {
        Object.assign(estado, props.proveedor ? entradaDeProveedor(props.proveedor) : entradaProveedorVacia())
        problema.value = null
        clave = nuevaClaveIdempotencia()
    }
})

async function enviar(evento: FormSubmitEvent<SalidaProveedorCobro>) {
    enviando.value = true
    problema.value = null
    const resultado = props.proveedor
        ? await useProveedoresCobro().editar(props.proveedor.id, cuerpoEdicionProveedor(props.proveedor, evento.data), clave)
        : await useProveedoresCobro().crear(cuerpoProveedor(evento.data), clave)
    enviando.value = false
    if (resultado.ok) {
        abierto.value = false
        emit('hecho', resultado.data)
        return
    }
    const errores = erroresDeFormulario(resultado.problema)
    formulario.value?.setErrors(errores)
    const campos = new Set(Object.keys(estado))
    if (!errores.length || errores.some(e => !e.name || !campos.has(e.name))) {
        problema.value = resultado.problema
    }
}
</script>

<template>
    <UModal
        v-model:open="abierto"
        :title="editando ? `Editar ${proveedor?.nombre}` : 'Nuevo proveedor de cobro'"
        description="Desde la fecha de corte sus pagos van a la subcuenta 1.1.10.NN por el bruto y se cierran con la liquidación."
        :dismissible="!enviando"
    >
        <template #body>
            <UForm
                id="form-proveedor-cobro"
                ref="formulario"
                :schema="esquema"
                :state="estado"
                class="flex flex-col gap-4"
                @submit="enviar"
            >
                <div class="grid gap-4 sm:grid-cols-2">
                    <UFormField
                        label="Método"
                        name="metodo"
                        required
                    >
                        <USelect
                            v-model="estado.metodo"
                            :items="itemsMetodo"
                            :disabled="editando"
                            class="w-full"
                        />
                    </UFormField>
                    <UFormField
                        v-if="estado.metodo === 'pasarela'"
                        label="Pasarela"
                        name="pasarela"
                        help="El nombre que trae el pago (falsa, recurrente…)."
                    >
                        <UInput
                            v-model="estado.pasarela"
                            placeholder="recurrente"
                            :disabled="editando"
                            class="w-full"
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
                            placeholder="Pasarela en línea"
                            class="w-full"
                            data-prueba="proveedor-nombre"
                        />
                    </UFormField>
                    <UFormField
                        label="Banco donde liquida"
                        name="cuenta_id"
                        required
                        class="sm:col-span-2"
                        help="Cuenta que recibe el neto de cada liquidación."
                    >
                        <CuentaBancoSelect
                            v-model="estado.cuenta_id"
                            placeholder="Elige la cuenta"
                        />
                    </UFormField>
                    <UFormField
                        label="Fecha de corte"
                        name="desde"
                        :help="editando ? 'Solo se mueve mientras el proveedor no tenga pagos.' : 'Vacía: hoy. Los pagos anteriores siguen contra el banco.'"
                    >
                        <UInput
                            v-model="estado.desde"
                            type="date"
                            :min="hoy"
                            class="w-full"
                        />
                    </UFormField>
                    <UFormField
                        v-if="editando"
                        label="Estado"
                        name="activo"
                    >
                        <USwitch
                            v-model="estado.activo"
                            :label="estado.activo ? 'Activo' : 'Inactivo: sus pagos nuevos vuelven al banco'"
                        />
                    </UFormField>
                </div>

                <ProblemaAlerta
                    v-if="problema"
                    :problema="problema"
                    data-prueba="proveedor-error"
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
                    form="form-proveedor-cobro"
                    :label="editando ? 'Guardar' : 'Crear proveedor'"
                    icon="i-lucide-save"
                    :loading="enviando"
                    data-prueba="proveedor-guardar"
                />
            </div>
        </template>
    </UModal>
</template>
