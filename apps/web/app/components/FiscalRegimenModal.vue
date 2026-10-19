<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { FormSubmitEvent } from '@nuxt/ui'

/**
 * Régimen de ISR de la empresa (`POST /fiscal/regimen`, `fiscal.cambiar_regimen`). La primera
 * configuración admite cualquier fecha (la inscripción); un cambio rige el 1 de enero de un año
 * futuro con el aviso a la SAT de diciembre (422 `regimen_fuera_de_plazo`). Sus frases cambian solas.
 */
const props = defineProps<{
    /** Régimen vigente hoy. */
    actual: RegimenFiscal | null
    /** Sin un régimen puesto por un usuario: primera configuración. */
    primera: boolean
}>()

const abierto = defineModel<boolean>('open', { default: false })
const emit = defineEmits<{ hecho: [resultado: RegimenCambiado] }>()

const { puede } = usePermisos()
const formulario = useTemplateRef('formulario')
const idFormulario = useId()
const hoy = hoyGuatemala()
const proximoEnero = `${Number(hoy.slice(0, 4)) + 1}-01-01`
const estado = reactive<EntradaRegimen>({ regimen: 'utilidades', vigente_desde: hoy, aviso_numero: '', aviso_fecha: '', motivo: '' })
const enviando = ref(false)
const problema = ref<Problem | null>(null)
let clave = nuevaClaveIdempotencia()

const esquema = computed(() => esquemaRegimen(props.primera, hoy))
const itemsRegimen = Object.entries(REGIMENES_FISCALES).map(([value, r]) => ({ label: r.etiqueta, value, description: r.descripcion }))

watch(abierto, (valor) => {
    if (!valor) {
        return
    }
    const otro = (Object.keys(REGIMENES_FISCALES) as RegimenFiscal[]).find(r => r !== props.actual) ?? 'utilidades'
    Object.assign(estado, {
        regimen: props.primera ? (props.actual ?? 'utilidades') : otro,
        vigente_desde: props.primera ? hoy : proximoEnero,
        aviso_numero: '',
        aviso_fecha: '',
        motivo: '',
    })
    problema.value = null
    clave = nuevaClaveIdempotencia()
    formulario.value?.clear()
})

/** `aviso_sat.fecha` de la API va en el campo `aviso_fecha` del formulario. */
const CAMPOS: Record<string, keyof EntradaRegimen> = { 'aviso_sat': 'aviso_numero', 'aviso_sat.numero': 'aviso_numero', 'aviso_sat.fecha': 'aviso_fecha' }

async function enviar(evento: FormSubmitEvent<CuerpoRegimen>) {
    enviando.value = true
    problema.value = null
    const resultado = await useParametrosFiscales().cambiarRegimen(evento.data, clave)
    enviando.value = false
    if (resultado.ok) {
        abierto.value = false
        emit('hecho', resultado.data)
        return
    }
    const campos = resultado.problema.status === 422
        ? erroresDeFormulario(resultado.problema).map(e => ({ ...e, name: (e.name && CAMPOS[e.name]) ?? e.name }))
                .filter(e => ['regimen', 'vigente_desde', 'aviso_numero', 'aviso_fecha', 'motivo'].includes(e.name ?? ''))
        : []
    if (campos.length) {
        formulario.value?.setErrors(campos)
    }
    if (!campos.length || codigoProblema(resultado.problema) === 'regimen_fuera_de_plazo') {
        problema.value = problemaFiscalLegible(resultado.problema)
    }
}
</script>

<template>
    <UModal
        v-model:open="abierto"
        :title="primera ? 'Configurar régimen' : 'Cambiar régimen'"
        description="Régimen del impuesto sobre la renta de la empresa."
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
                    color="warning"
                    variant="subtle"
                    icon="i-lucide-scale"
                    :title="primera ? 'Primera configuración' : 'Cambio de régimen (LAT, art. 51)'"
                    :description="AVISO_REGIMEN"
                    data-prueba="aviso-regimen"
                />

                <UFormField
                    label="Régimen"
                    name="regimen"
                    required
                >
                    <USelect
                        v-model="estado.regimen"
                        :items="itemsRegimen"
                        class="w-full"
                    />
                </UFormField>
                <UFormField
                    label="Vigente desde"
                    name="vigente_desde"
                    required
                    :help="primera ? 'La fecha de inscripción en el régimen.' : `Solo el 1 de enero de un año futuro (p. ej. ${proximoEnero}).`"
                >
                    <UInput
                        v-model="estado.vigente_desde"
                        type="date"
                        class="w-full"
                    />
                </UFormField>
                <div class="grid gap-4 sm:grid-cols-2">
                    <UFormField
                        label="Aviso a la SAT"
                        name="aviso_numero"
                        :required="!primera"
                        :hint="primera ? 'Opcional' : undefined"
                    >
                        <UInput
                            v-model="estado.aviso_numero"
                            placeholder="Número del aviso"
                            class="w-full"
                        />
                    </UFormField>
                    <UFormField
                        label="Fecha del aviso"
                        name="aviso_fecha"
                        :required="!primera"
                        :help="primera ? undefined : 'Presentado en diciembre del año anterior.'"
                    >
                        <UInput
                            v-model="estado.aviso_fecha"
                            type="date"
                            :max="hoy"
                            class="w-full"
                        />
                    </UFormField>
                </div>
                <UFormField
                    label="Motivo"
                    name="motivo"
                    hint="Opcional"
                >
                    <UTextarea
                        v-model="estado.motivo"
                        :rows="2"
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
                    :form="idFormulario"
                    :label="primera ? 'Guardar régimen' : 'Cambiar régimen'"
                    :disabled="!puede('fiscal.cambiar_regimen')"
                    icon="i-lucide-check"
                    :loading="enviando"
                />
            </div>
        </template>
    </UModal>
</template>
