<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { FormSubmitEvent, RadioGroupItem } from '@nuxt/ui'

/**
 * Marca un requisito del checklist legal (`POST /lealtad/sorteos/:id/requisitos/:clave`,
 * `sorteos.marcar_requisito`). Cumplido o «No aplica» llevan evidencia (en esta fase, referencia o
 * texto; los archivos llegan con la segunda PR). Solo inserción: vale la última marca.
 */
const props = defineProps<{
    sorteoId: number
    requisito: RequisitoSorteo | null
}>()

const abierto = defineModel<boolean>('open', { default: false })

const emit = defineEmits<{
    hecho: [requisitos: RequisitoSorteo[]]
}>()

const formulario = useTemplateRef('formulario')
const estado = reactive<EntradaRequisitoSorteo>({ estado: 'cumplido', valor: '', evidencia: '', nota: '' })
const enviando = ref(false)
const problema = ref<Problem | null>(null)
let clave = nuevaClaveIdempotencia()

const visual = computed(() => (props.requisito ? REQUISITOS_SORTEO[props.requisito.clave] : null))
const itemsEstado: RadioGroupItem[] = Object.entries(ESTADOS_REQUISITO).map(([value, e]) => ({ label: e.etiqueta, value }))

watch(abierto, (valor) => {
    if (valor && props.requisito) {
        const r = props.requisito
        Object.assign(estado, {
            estado: r.estado === 'pendiente' ? 'cumplido' : r.estado,
            valor: r.valor ?? '',
            evidencia: r.evidencia ?? '',
            nota: r.nota ?? '',
        })
        problema.value = null
        clave = nuevaClaveIdempotencia()
    }
})

async function enviar(evento: FormSubmitEvent<EntradaRequisitoSorteo>) {
    if (!props.requisito) {
        return
    }
    enviando.value = true
    problema.value = null
    const datos = evento.data
    const resultado = await useSorteos().marcarRequisito(props.sorteoId, props.requisito.clave, {
        estado: datos.estado,
        valor: datos.valor || null,
        evidencia: datos.evidencia || null,
        nota: datos.nota || null,
    }, clave)
    enviando.value = false
    if (resultado.ok) {
        abierto.value = false
        emit('hecho', resultado.data)
        return
    }
    const errores = erroresDeFormulario(resultado.problema).filter(e => e.name && e.name in estado)
    if (errores.length) {
        formulario.value?.setErrors(errores)
        return
    }
    problema.value = resultado.problema
}
</script>

<template>
    <UModal
        v-model:open="abierto"
        :title="visual ? visual.etiqueta : 'Requisito'"
        :description="visual ? PASOS_REQUISITO[visual.para] : undefined"
        :dismissible="!enviando"
    >
        <template #body>
            <UForm
                v-if="visual"
                id="form-requisito-sorteo"
                ref="formulario"
                :schema="esquemaRequisitoSorteo"
                :state="estado"
                class="flex flex-col gap-4"
                @submit="enviar"
            >
                <UAlert
                    color="neutral"
                    variant="subtle"
                    icon="i-lucide-scale"
                    :title="visual.requisito"
                    :description="`Fuente: ${visual.fuente}. ${AVISO_REQUISITOS}`"
                />
                <UFormField
                    label="Estado"
                    name="estado"
                    required
                >
                    <URadioGroup
                        v-model="estado.estado"
                        :items="itemsEstado"
                        orientation="horizontal"
                    />
                </UFormField>
                <UFormField
                    :label="visual.valor ?? 'Valor'"
                    name="valor"
                    help="Número de resolución, de fianza, de recibo…"
                >
                    <UInput
                        v-model="estado.valor"
                        class="w-full"
                    />
                </UFormField>
                <UFormField
                    label="Evidencia"
                    name="evidencia"
                    :required="estado.estado !== 'pendiente'"
                    help="Referencia o texto: dónde consta (expediente, edición, recibo)."
                >
                    <UTextarea
                        v-model="estado.evidencia"
                        :rows="2"
                        autoresize
                        class="w-full"
                    />
                </UFormField>
                <UFormField
                    label="Nota"
                    name="nota"
                >
                    <UTextarea
                        v-model="estado.nota"
                        :rows="2"
                        autoresize
                        class="w-full"
                    />
                </UFormField>
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
                    form="form-requisito-sorteo"
                    label="Guardar marca"
                    icon="i-lucide-check"
                    :loading="enviando"
                />
            </div>
        </template>
    </UModal>
</template>
