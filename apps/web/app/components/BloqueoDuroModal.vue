<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { FormSubmitEvent } from '@nuxt/ui'

/**
 * Bloqueo duro (`POST /libro/bloqueos/duro`, `libro.bloquear_duro`). Es irreversible: después nada se
 * registra con fecha hasta ese día, ni con excepción, y ningún mes se reabre. Por eso pide escribir
 * exactamente «BLOQUEO DURO hasta AAAA-MM-DD» con la misma fecha (422 `confirmacion_invalida` si no).
 * La API exige además los meses cerrados, los DTE certificados y los extractos conciliados hasta esa
 * fecha (422 `bloqueo_duro_requisitos`, con cada faltante).
 */
const props = defineProps<{
    empresaId: number
    empresa?: string | null
    vigentes: BloqueosEmpresa['vigentes']
}>()

const abierto = defineModel<boolean>('open', { default: false })
const emit = defineEmits<{ hecho: [bloqueo: BloqueoLibro] }>()

const formulario = useTemplateRef('formulario')
const enviando = ref(false)
const problema = ref<Problem | null>(null)
let clave = nuevaClaveIdempotencia()

interface Entrada {
    hasta: string
    motivo: string
    confirmacion: string
}

const estado = reactive<Entrada>({ hasta: '', motivo: '', confirmacion: '' })
const hoy = hoyGuatemala()
const esquema = computed(() => esquemaDuro(props.vigentes, hoy))
const frase = computed(() => (estado.hasta ? confirmacionDuro(estado.hasta) : null))
const coincide = computed(() => !!frase.value && estado.confirmacion === frase.value)

watch(abierto, (valor) => {
    if (valor) {
        Object.assign(estado, { hasta: '', motivo: '', confirmacion: '' })
        problema.value = null
        clave = nuevaClaveIdempotencia()
    }
})

async function enviar(evento: FormSubmitEvent<Entrada>) {
    enviando.value = true
    problema.value = null
    const d = evento.data
    const resultado = await useBloqueosLibro().bloquearDuro({ empresa_id: props.empresaId, hasta: d.hasta, motivo: d.motivo, confirmacion: d.confirmacion }, clave)
    enviando.value = false
    if (resultado.ok) {
        abierto.value = false
        emit('hecho', resultado.data)
        return
    }
    const errores = erroresDeFormulario(resultado.problema).filter(e => e.name === 'hasta' || e.name === 'motivo' || e.name === 'confirmacion')
    if (errores.length) {
        formulario.value?.setErrors(errores)
    }
    problema.value = problemaBloqueoLegible(resultado.problema)
}
</script>

<template>
    <UModal
        v-model:open="abierto"
        title="Bloqueo duro"
        :description="empresa ?? undefined"
        :dismissible="!enviando"
    >
        <template #body>
            <UForm
                id="form-bloqueo-duro"
                ref="formulario"
                :schema="esquema"
                :state="estado"
                class="flex flex-col gap-4"
                @submit="enviar"
            >
                <UAlert
                    color="error"
                    variant="subtle"
                    icon="i-lucide-shield-alert"
                    title="No se puede deshacer"
                    description="Nada con fecha hasta ese día entra al libro, ni con una excepción, y ningún mes se reabre. Antes deben estar cerrados los meses, certificados los DTE y conciliados los extractos hasta esa fecha."
                />
                <UFormField
                    label="Bloquear para siempre hasta"
                    name="hasta"
                    required
                    :help="vigentes.duro ? `El duro vigente es ${formatearFecha(vigentes.duro)}: solo avanza.` : 'Aún no hay bloqueo duro.'"
                >
                    <UInput
                        v-model="estado.hasta"
                        type="date"
                        :max="hoy"
                        :min="vigentes.duro ?? undefined"
                        class="w-full"
                        data-prueba="duro-hasta"
                    />
                </UFormField>
                <UFormField
                    label="Motivo"
                    name="motivo"
                    required
                >
                    <UTextarea
                        v-model="estado.motivo"
                        :rows="2"
                        autoresize
                        class="w-full"
                        data-prueba="duro-motivo"
                    />
                </UFormField>
                <UFormField
                    label="Confirmación"
                    name="confirmacion"
                    required
                    :help="frase ? `Escriba exactamente: ${frase}` : 'Primero elija la fecha.'"
                >
                    <UInput
                        v-model="estado.confirmacion"
                        :disabled="!frase"
                        :placeholder="frase ?? undefined"
                        autocomplete="off"
                        class="w-full font-mono"
                        data-prueba="duro-confirmacion"
                    />
                </UFormField>
                <ProblemaAlerta
                    v-if="problema"
                    :problema="problema"
                    data-prueba="duro-problema"
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
                    form="form-bloqueo-duro"
                    label="Aplicar bloqueo duro"
                    icon="i-lucide-shield-alert"
                    color="error"
                    :disabled="!coincide"
                    :loading="enviando"
                    data-prueba="confirmar-duro"
                />
            </div>
        </template>
    </UModal>
</template>
