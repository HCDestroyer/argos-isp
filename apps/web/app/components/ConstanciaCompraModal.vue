<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { FormSubmitEvent, SelectItem } from '@nuxt/ui'

/**
 * Número de la constancia de una retención emitida en una compra (`POST /compras/:id/constancias`,
 * `compras.registrar`). No mueve el libro: la retención ya está en 2.1.04 o 2.1.05. Lo abre la ficha de
 * la compra, que comprueba el permiso.
 */
const props = defineProps<{
    compra: Compra
    /** Retenciones de la compra que todavía no tienen constancia. */
    retenciones: Compra['retenciones']
}>()

const abierto = defineModel<boolean>('open', { default: false })

const emit = defineEmits<{
    hecho: [constancia: ConstanciaRetencion]
}>()

const hoy = hoyGuatemala()
const formulario = useTemplateRef('formulario')
const esquema = esquemaConstancia(hoy)
const estado = reactive({ impuesto_codigo: '', numero: '', fecha: '' })
const enviando = ref(false)
const problema = ref<Problem | null>(null)
let clave = nuevaClaveIdempotencia()

const items = computed<SelectItem[]>(() => props.retenciones.map(r => ({ label: `${RETENCIONES_EMITIDAS[r.impuesto_codigo] ?? r.impuesto_codigo} · ${formatearQuetzales(r.monto)}`, value: r.impuesto_codigo })))

watch(abierto, (valor) => {
    if (valor) {
        Object.assign(estado, { impuesto_codigo: props.retenciones[0]?.impuesto_codigo ?? '', numero: '', fecha: '' })
        problema.value = null
        clave = nuevaClaveIdempotencia()
        formulario.value?.clear()
    }
})

async function enviar(evento: FormSubmitEvent<{ impuesto_codigo: string, numero: string, fecha: string }>) {
    enviando.value = true
    problema.value = null
    const resultado = await useCompras().registrarConstancia(props.compra.id, { impuesto_codigo: evento.data.impuesto_codigo, numero: evento.data.numero.trim(), ...(evento.data.fecha ? { fecha: evento.data.fecha } : {}) }, clave)
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
        title="Registrar constancia de retención"
        :description="`${documentoCompra(compra)} de ${compra.proveedor_nombre}. No mueve el libro: la retención ya está registrada.`"
        :dismissible="!enviando"
    >
        <template #body>
            <UForm
                id="form-constancia"
                ref="formulario"
                :schema="esquema"
                :state="estado"
                class="flex flex-col gap-4"
                @submit="enviar"
            >
                <UFormField
                    label="Retención"
                    name="impuesto_codigo"
                    required
                >
                    <USelect
                        v-model="estado.impuesto_codigo"
                        :items="items"
                        class="w-full"
                    />
                </UFormField>
                <div class="grid gap-4 sm:grid-cols-2">
                    <UFormField
                        label="Número de la constancia"
                        name="numero"
                        required
                    >
                        <UInput
                            v-model="estado.numero"
                            class="w-full"
                            data-prueba="constancia-numero"
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
                            :max="hoy"
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
                    form="form-constancia"
                    label="Registrar constancia"
                    icon="i-lucide-file-check-2"
                    :loading="enviando"
                    data-prueba="guardar-constancia"
                />
            </div>
        </template>
    </UModal>
</template>
