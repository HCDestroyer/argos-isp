<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { FormSubmitEvent } from '@nuxt/ui'

/**
 * Agrega un feriado o retira uno vigente (`activo: false`) con `POST /fiscal/feriados`
 * (`fiscal.configurar`, alcance global). Solo inserción: nada se edita ni se borra. La confirmación
 * avisa que se recalcula el calendario fiscal de todas las empresas en la misma operación.
 */
const props = withDefaults(defineProps<{
    /** Feriado vigente a retirar; sin él, alta. */
    retirar?: FeriadoFiscal | null
    /** Año que se está viendo: la fecha propuesta cae en él. */
    anio: number
}>(), {
    retirar: null,
})

const abierto = defineModel<boolean>('open', { default: false })
const emit = defineEmits<{ hecho: [feriado: FeriadoAgregado] }>()

const { puede } = usePermisos()
const formulario = useTemplateRef('formulario')
const idFormulario = useId()
const estado = reactive<EntradaFeriado>({ fecha: '', nombre: '', motivo: '' })
const retiro = reactive<{ motivo: string }>({ motivo: '' })
const enviando = ref(false)
const problema = ref<Problem | null>(null)
let clave = nuevaClaveIdempotencia()

watch(abierto, (valor) => {
    if (!valor) {
        return
    }
    const hoy = hoyGuatemala()
    Object.assign(estado, { fecha: hoy.startsWith(String(props.anio)) ? hoy : `${props.anio}-01-01`, nombre: '', motivo: '' })
    retiro.motivo = ''
    problema.value = null
    clave = nuevaClaveIdempotencia()
    formulario.value?.clear()
})

async function ejecutar(cuerpo: CuerpoFeriado) {
    enviando.value = true
    problema.value = null
    const resultado = await useFeriadosFiscales().agregar(cuerpo, clave)
    enviando.value = false
    if (resultado.ok) {
        abierto.value = false
        emit('hecho', resultado.data)
        return
    }
    if (resultado.problema.status === 422 && resultado.problema.errors?.length) {
        formulario.value?.setErrors(erroresDeFormulario(resultado.problema))
        if (codigoProblema(resultado.problema) === 'validacion') {
            return
        }
    }
    problema.value = problemaCalendarioLegible(resultado.problema)
}

function agregar(evento: FormSubmitEvent<CuerpoFeriado>) {
    void ejecutar(evento.data)
}

function confirmarRetiro(evento: FormSubmitEvent<{ motivo: string }>) {
    if (!props.retirar) {
        return
    }
    void ejecutar({ fecha: props.retirar.fecha, activo: false, motivo: evento.data.motivo })
}
</script>

<template>
    <UModal
        v-model:open="abierto"
        :title="retirar ? 'Retirar feriado' : 'Agregar feriado'"
        :description="retirar ? `${retirar.nombre} · ${diaSemana(retirar.fecha)} ${formatearFecha(retirar.fecha)}` : 'Día inhábil para los plazos fiscales de todas las empresas.'"
        :dismissible="!enviando"
    >
        <template #body>
            <div class="flex flex-col gap-4">
                <UAlert
                    color="warning"
                    variant="subtle"
                    icon="i-lucide-refresh-cw"
                    title="Recalcula el calendario de todas las empresas"
                    :description="retirar
                        ? 'La fecha vuelve a ser hábil: los vencimientos sin presentar que se habían corrido por este feriado regresan a ella. Las presentadas no cambian.'
                        : 'Los vencimientos sin presentar que caigan ese día (o cuenten días hábiles por él) corren al siguiente día hábil, en todas las empresas. Las presentadas no cambian.'"
                    data-prueba="feriado-aviso-recalculo"
                />

                <UForm
                    v-if="retirar"
                    :id="idFormulario"
                    ref="formulario"
                    :schema="esquemaRetiroFeriado"
                    :state="retiro"
                    class="flex flex-col gap-4"
                    @submit="confirmarRetiro"
                >
                    <UFormField
                        label="Motivo"
                        name="motivo"
                        required
                        help="Queda en la bitácora junto con tu usuario. El retiro es una fila nueva: el alta no se borra."
                    >
                        <UTextarea
                            v-model="retiro.motivo"
                            :rows="2"
                            class="w-full"
                            data-prueba="feriado-motivo"
                        />
                    </UFormField>
                </UForm>

                <UForm
                    v-else
                    :id="idFormulario"
                    ref="formulario"
                    :schema="esquemaFeriado"
                    :state="estado"
                    class="flex flex-col gap-4"
                    @submit="agregar"
                >
                    <UFormField
                        label="Fecha"
                        name="fecha"
                        required
                    >
                        <UInput
                            v-model="estado.fecha"
                            type="date"
                            class="w-full"
                            data-prueba="feriado-fecha"
                        />
                    </UFormField>
                    <UFormField
                        label="Nombre"
                        name="nombre"
                        required
                        hint="Ej. Día de la Revolución"
                    >
                        <UInput
                            v-model="estado.nombre"
                            class="w-full"
                            data-prueba="feriado-nombre"
                        />
                    </UFormField>
                    <UFormField
                        label="Motivo"
                        name="motivo"
                        required
                        help="Cite la fuente (decreto, acuerdo gubernativo) que confirmó el contador. Queda en la bitácora."
                    >
                        <UTextarea
                            v-model="estado.motivo"
                            :rows="2"
                            class="w-full"
                            data-prueba="feriado-motivo"
                        />
                    </UFormField>
                </UForm>

                <ProblemaAlerta
                    v-if="problema"
                    :problema="problema"
                    data-prueba="feriado-problema"
                />
            </div>
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
                    :label="retirar ? 'Retirar y recalcular' : 'Agregar y recalcular'"
                    :disabled="!puede('fiscal.configurar')"
                    :icon="retirar ? 'i-lucide-flag-off' : 'i-lucide-flag'"
                    :color="retirar ? 'error' : 'primary'"
                    :loading="enviando"
                    data-prueba="feriado-confirmar"
                />
            </div>
        </template>
    </UModal>
</template>
