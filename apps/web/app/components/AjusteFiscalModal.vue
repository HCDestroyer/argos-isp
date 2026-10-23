<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { FormSubmitEvent, SelectItem } from '@nuxt/ui'

/**
 * Registra un ajuste fiscal del ISR (`POST /declaraciones/ajustes`, `declaraciones.ajustar`) de la empresa
 * activa: año, trimestre (cierre parcial) o anual, suma o resta, concepto y monto. 409 `ejercicio_cerrado`
 * en un ajuste anual de un año cerrado.
 */
const props = withDefaults(defineProps<{
    anio: number
    trimestre?: number | null
}>(), {
    trimestre: null,
})

const abierto = defineModel<boolean>('open', { default: false })
const emit = defineEmits<{ hecho: [ajuste: AjusteFiscal] }>()

const { puede } = usePermisos()
const formulario = useTemplateRef('formulario')
const idFormulario = useId()
const vacio = (): EntradaAjusteFiscal => ({ anio: props.anio, trimestre: props.trimestre, efecto: 'suma', concepto: '', monto: '' })
const estado = reactive<EntradaAjusteFiscal>(vacio())
const enviando = ref(false)
const problema = ref<Problem | null>(null)
let clave = nuevaClaveIdempotencia()

const anioActual = Number(hoyGuatemala().slice(0, 4))
const itemsAnio: SelectItem[] = [0, 1, 2, 3].map(n => ({ label: String(anioActual - n), value: anioActual - n }))
const itemsTrimestre: SelectItem[] = [
    { label: 'Anual (ISR anual)', value: 0 },
    ...[1, 2, 3, 4].map(n => ({ label: `${['1.er', '2.º', '3.er', '4.º'][n - 1]} trimestre (cierre parcial)`, value: n })),
]
const itemsEfecto: SelectItem[] = [
    { label: 'Suma a la renta (no deducible)', value: 'suma' },
    { label: 'Resta de la renta (exenta)', value: 'resta' },
]
const trimestreElegido = computed({
    get: () => estado.trimestre ?? 0,
    set: (valor: number) => {
        estado.trimestre = valor === 0 ? null : valor
    },
})

watch(abierto, (valor) => {
    if (valor) {
        Object.assign(estado, vacio())
        problema.value = null
        clave = nuevaClaveIdempotencia()
        formulario.value?.clear()
    }
})

async function enviar(evento: FormSubmitEvent<CuerpoAjusteFiscal>) {
    enviando.value = true
    problema.value = null
    const resultado = await useDeclaraciones().ajustar(evento.data, clave)
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
    problema.value = problemaDeclaracionLegible(resultado.problema)
    clave = nuevaClaveIdempotencia()
}
</script>

<template>
    <UModal
        v-model:open="abierto"
        title="Registrar ajuste fiscal"
        description="Lleva el resultado contable a la renta imponible del ISR. El borrador del periodo queda desactualizado."
        :dismissible="!enviando"
    >
        <template #body>
            <UForm
                :id="idFormulario"
                ref="formulario"
                :schema="esquemaAjusteFiscal"
                :state="estado"
                class="flex flex-col gap-4"
                @submit="enviar"
            >
                <div class="grid gap-4 sm:grid-cols-2">
                    <UFormField
                        label="Año"
                        name="anio"
                        required
                    >
                        <USelect
                            v-model="estado.anio"
                            :items="itemsAnio"
                            class="w-full"
                        />
                    </UFormField>
                    <UFormField
                        label="Periodo"
                        name="trimestre"
                    >
                        <USelect
                            v-model="trimestreElegido"
                            :items="itemsTrimestre"
                            class="w-full"
                            data-prueba="ajuste-trimestre"
                        />
                    </UFormField>
                    <UFormField
                        label="Efecto"
                        name="efecto"
                        required
                    >
                        <USelect
                            v-model="estado.efecto"
                            :items="itemsEfecto"
                            class="w-full"
                            data-prueba="ajuste-efecto"
                        />
                    </UFormField>
                    <UFormField
                        label="Monto"
                        name="monto"
                        required
                    >
                        <UInput
                            v-model="estado.monto"
                            inputmode="decimal"
                            placeholder="1500.00"
                            class="w-full"
                            data-prueba="ajuste-monto"
                        >
                            <template #leading>
                                <span class="text-sm text-muted">Q</span>
                            </template>
                        </UInput>
                    </UFormField>
                </div>
                <UFormField
                    label="Concepto"
                    name="concepto"
                    required
                    help="Cite el criterio que confirmó el contador."
                >
                    <UTextarea
                        v-model="estado.concepto"
                        :rows="2"
                        class="w-full"
                        data-prueba="ajuste-concepto"
                    />
                </UFormField>
                <ProblemaAlerta
                    v-if="problema"
                    :problema="problema"
                    data-prueba="ajuste-problema"
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
                    label="Registrar ajuste"
                    icon="i-lucide-plus"
                    :disabled="!puede('declaraciones.ajustar')"
                    :loading="enviando"
                    data-prueba="ajuste-confirmar"
                />
            </div>
        </template>
    </UModal>
</template>
