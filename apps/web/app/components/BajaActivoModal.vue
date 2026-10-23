<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { FormSubmitEvent, SelectItem } from '@nuxt/ui'

/**
 * Baja de un activo fijo (`POST /activos/:id/dar-de-baja`, `activos.dar_de_baja`): deprecia lo pendiente
 * hasta el mes anterior a la baja y registra el asiento. Venta: precio sin IVA a una cuenta bancaria, con
 * la ganancia o pérdida contra el valor en libros. Retiro: el valor en libros va a pérdida. La abre la
 * ficha del activo, que comprueba el permiso.
 */
const props = defineProps<{
    activo: ActivoFijo
}>()

const abierto = defineModel<boolean>('open', { default: false })

const emit = defineEmits<{
    hecho: [activo: ActivoFijo]
}>()

const { puede } = usePermisos()
const hoy = hoyGuatemala()
const formulario = useTemplateRef('formulario')
const esquema = computed(() => esquemaBajaActivo(hoy, props.activo.fecha_alta))
const estado = reactive<EntradaBajaActivo>({ tipo: 'retiro', motivo: '', fecha: '', precio_venta: '', cuenta_bancaria_id: null })
const enviando = ref(false)
const problema = ref<Problem | null>(null)
let clave = nuevaClaveIdempotencia()

const cuentas = shallowRef<CuentaBancaria[]>([])
const itemsTipo: SelectItem[] = [{ label: 'Retiro (pérdida o desecho)', value: 'retiro' }, { label: 'Venta', value: 'venta' }]
const itemsCuenta = computed<SelectItem[]>(() => cuentas.value.filter(c => c.activa && c.moneda === 'GTQ').map(c => ({ label: `${c.banco_nombre} · ${c.alias}`, value: c.id, description: c.numero })))

watch(abierto, async (valor) => {
    if (valor) {
        Object.assign(estado, { tipo: 'retiro', motivo: '', fecha: '', precio_venta: '', cuenta_bancaria_id: null })
        problema.value = null
        clave = nuevaClaveIdempotencia()
        formulario.value?.clear()
        const resultado = puede('cuentas_bancarias.ver') ? await useCuentasBancarias().listar({ activa: true }) : null
        cuentas.value = resultado?.ok ? resultado.data : []
    }
})

async function enviar(evento: FormSubmitEvent<EntradaBajaActivo>) {
    enviando.value = true
    problema.value = null
    const resultado = await useActivos().darDeBaja(props.activo.id, cuerpoBajaActivo(evento.data), clave)
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
        :title="`Dar de baja: ${activo.descripcion}`"
        :description="`Valor en libros: ${formatearQuetzales(activo.valor_libros)}. Se registra la depreciación pendiente y el asiento de la baja; no se puede deshacer.`"
        :dismissible="!enviando"
    >
        <template #body>
            <UForm
                id="form-baja-activo"
                ref="formulario"
                :schema="esquema"
                :state="estado"
                class="flex flex-col gap-4"
                @submit="enviar"
            >
                <div class="grid gap-4 sm:grid-cols-2">
                    <UFormField
                        label="Tipo de baja"
                        name="tipo"
                        required
                    >
                        <USelect
                            v-model="estado.tipo"
                            :items="itemsTipo"
                            class="w-full"
                            data-prueba="baja-tipo"
                        />
                    </UFormField>
                    <UFormField
                        label="Fecha"
                        name="fecha"
                        help="Vacía: hoy."
                    >
                        <UInput
                            v-model="estado.fecha"
                            type="date"
                            :min="activo.fecha_alta"
                            :max="hoy"
                            class="w-full"
                        />
                    </UFormField>
                    <template v-if="estado.tipo === 'venta'">
                        <UFormField
                            label="Precio de venta"
                            name="precio_venta"
                            required
                            help="Sin IVA."
                        >
                            <UInput
                                v-model="estado.precio_venta"
                                inputmode="decimal"
                                class="w-full"
                            />
                        </UFormField>
                        <UFormField
                            label="Cuenta que recibe"
                            name="cuenta_bancaria_id"
                            required
                        >
                            <USelect
                                v-model="estado.cuenta_bancaria_id"
                                :items="itemsCuenta"
                                placeholder="Elige la cuenta"
                                class="w-full"
                            />
                        </UFormField>
                    </template>
                    <UFormField
                        label="Motivo"
                        name="motivo"
                        required
                        class="sm:col-span-2"
                    >
                        <UTextarea
                            v-model="estado.motivo"
                            :rows="2"
                            placeholder="Ej.: dañado sin reparación"
                            class="w-full"
                            data-prueba="baja-motivo"
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
                    form="form-baja-activo"
                    label="Dar de baja"
                    icon="i-lucide-archive"
                    color="error"
                    :loading="enviando"
                    data-prueba="confirmar-baja"
                />
            </div>
        </template>
    </UModal>
</template>
