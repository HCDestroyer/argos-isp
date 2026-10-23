<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { FormSubmitEvent } from '@nuxt/ui'

/**
 * Registra que una declaración revisada se presentó a la SAT (`POST /declaraciones/:id/marcar-presentada`,
 * `declaraciones.presentar`): número del formulario, fecha y boleta. ArgosIsp no envía nada a la SAT.
 */
const props = defineProps<{
    declaracion: Declaracion
}>()

const abierto = defineModel<boolean>('open', { default: false })
const emit = defineEmits<{ hecho: [declaracion: Declaracion], recalcular: [] }>()

const { puede } = usePermisos()
const hoy = hoyGuatemala()
const esquema = esquemaPresentarDeclaracion(hoy)
const formulario = useTemplateRef('formulario')
const idFormulario = useId()
const estado = reactive<EntradaPresentarDeclaracion>({ numero_formulario: '', fecha_presentacion: hoy, boleta: '' })
const enviando = ref(false)
const problema = ref<Problem | null>(null)
let clave = nuevaClaveIdempotencia()

watch(abierto, (valor) => {
    if (valor) {
        Object.assign(estado, { numero_formulario: '', fecha_presentacion: hoy, boleta: '' })
        problema.value = null
        clave = nuevaClaveIdempotencia()
        formulario.value?.clear()
    }
})

async function enviar(evento: FormSubmitEvent<CuerpoPresentarDeclaracion>) {
    enviando.value = true
    problema.value = null
    const resultado = await useDeclaraciones().marcarPresentada(props.declaracion.id, evento.data, clave)
    enviando.value = false
    if (resultado.ok) {
        abierto.value = false
        emit('hecho', resultado.data)
        return
    }
    const errores = erroresDeFormulario(resultado.problema)
    if (resultado.problema.status === 422 && errores.length) {
        formulario.value?.setErrors(errores)
        return
    }
    problema.value = resultado.problema
    clave = nuevaClaveIdempotencia()
}

function aRecalcular() {
    abierto.value = false
    emit('recalcular')
}
</script>

<template>
    <UModal
        v-model:open="abierto"
        title="Marcar presentada"
        :description="`${etiquetaImpuestoDeclaracion(declaracion.impuesto)} de ${etiquetaPeriodoDeclaracion(declaracion)} · versión ${declaracion.version}`"
        :dismissible="!enviando"
    >
        <template #body>
            <UForm
                :id="idFormulario"
                ref="formulario"
                :schema="esquema"
                :state="estado"
                class="flex flex-col gap-4"
                @submit="enviar"
            >
                <UAlert
                    color="info"
                    variant="subtle"
                    icon="i-lucide-info"
                    title="ArgosIsp no presenta nada a la SAT"
                    :description="`Presente la declaración en Declaraguate (${declaracion.formulario ?? 'formulario por confirmar con contador'}) y registre aquí el número del formulario, la fecha y la boleta. Solo queda constancia de que se presentó.`"
                    data-prueba="presentar-aviso"
                />
                <div class="grid gap-4 sm:grid-cols-2">
                    <UFormField
                        label="Número del formulario"
                        name="numero_formulario"
                        required
                        class="sm:col-span-2"
                    >
                        <UInput
                            v-model="estado.numero_formulario"
                            placeholder="2237-0004602217"
                            class="w-full font-mono"
                            data-prueba="presentar-numero"
                        />
                    </UFormField>
                    <UFormField
                        label="Fecha de presentación"
                        name="fecha_presentacion"
                        required
                    >
                        <UInput
                            v-model="estado.fecha_presentacion"
                            type="date"
                            :max="hoy"
                            class="w-full"
                            data-prueba="presentar-fecha"
                        />
                    </UFormField>
                    <UFormField
                        label="Boleta"
                        name="boleta"
                        hint="Opcional"
                    >
                        <UInput
                            v-model="estado.boleta"
                            class="w-full"
                        />
                    </UFormField>
                </div>
                <p
                    v-if="estado.fecha_presentacion > declaracion.vence_en"
                    class="text-sm text-warning"
                    data-prueba="presentar-tardia"
                >
                    Vencía el {{ formatearFecha(declaracion.vence_en) }}: el pago llevará la multa por presentación tardía.
                </p>
                <ProblemaDeclaracion
                    v-if="problema"
                    :problema="problema"
                    puede-recalcular
                    @recalcular="aRecalcular"
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
                    :form="idFormulario"
                    label="Marcar presentada"
                    icon="i-lucide-send"
                    :disabled="!puede('declaraciones.presentar')"
                    :loading="enviando"
                    data-prueba="presentar-confirmar"
                />
            </div>
        </template>
    </UModal>
</template>
