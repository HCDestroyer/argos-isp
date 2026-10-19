<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { FormSubmitEvent } from '@nuxt/ui'

/**
 * Versión nueva de un impuesto (`POST /fiscal/impuestos/:codigo/versiones`,
 * `fiscal.editar_parametros`): otra tasa o inactivo desde una fecha. La tasa va **en positivo**;
 * el signo (−1 en las retenciones) es del impuesto y se muestra al lado. Lo demás (cálculo,
 * cuentas, cuadrículas) se copia de la versión vigente.
 */
const props = defineProps<{
    impuesto: ImpuestoFiscal | null
}>()

const abierto = defineModel<boolean>('open', { default: false })
const emit = defineEmits<{ hecho: [impuesto: ImpuestoFiscal] }>()

const { alcanceGlobal } = useEmpresaActiva()
const { puede } = usePermisos()
const formulario = useTemplateRef('formulario')
const idFormulario = useId()
const hoy = hoyGuatemala()
const estado = reactive<EntradaVersionImpuesto>({ tasa: '', activo: true, vigente_desde: hoy, motivo: '', global: false })
const enviando = ref(false)
const problema = ref<Problem | null>(null)
let clave = nuevaClaveIdempotencia()

const retencion = computed(() => props.impuesto?.signo === -1)

watch(abierto, (valor) => {
    if (valor) {
        estado.tasa = props.impuesto?.tasa ?? ''
        estado.activo = props.impuesto?.activo ?? true
        estado.vigente_desde = hoy
        estado.motivo = ''
        estado.global = false
        problema.value = null
        clave = nuevaClaveIdempotencia()
        formulario.value?.clear()
    }
})

async function enviar(evento: FormSubmitEvent<CuerpoVersionImpuesto>) {
    if (!props.impuesto) {
        return
    }
    enviando.value = true
    problema.value = null
    const resultado = await useImpuestosFiscales().agregarVersion(props.impuesto.codigo, evento.data, clave)
    enviando.value = false
    if (resultado.ok) {
        abierto.value = false
        emit('hecho', resultado.data)
        return
    }
    const campos = resultado.problema.status === 422
        ? erroresDeFormulario(resultado.problema).filter(e => ['tasa', 'vigente_desde', 'motivo'].includes(e.name ?? ''))
        : []
    if (campos.length) {
        formulario.value?.setErrors(campos)
    }
    // Junto al campo basta para la validación; una regla fiscal (mes cerrado…) se explica abajo.
    if (!campos.length || !MOTIVOS_SOLO_CAMPO.includes(codigoProblema(resultado.problema) ?? '')) {
        problema.value = problemaFiscalLegible(resultado.problema)
    }
}
</script>

<template>
    <UModal
        v-model:open="abierto"
        :title="impuesto ? `Nueva versión · ${impuesto.codigo}` : 'Nueva versión'"
        :description="impuesto?.nombre"
        :dismissible="!enviando"
    >
        <template #body>
            <UForm
                v-if="impuesto"
                :id="idFormulario"
                ref="formulario"
                :schema="esquemaVersionImpuesto"
                :state="estado"
                class="flex flex-col gap-4"
                @submit="enviar"
            >
                <p class="text-sm text-muted">
                    Vigente: <span class="font-mono font-medium text-highlighted">{{ tasaConSigno(impuesto) }}</span>
                    desde {{ formatearFecha(impuesto.vigente_desde) }} · {{ CALCULOS_IMPUESTO[impuesto.calculo] }}<template v-if="impuesto.base_impuesto">
                        de {{ impuesto.base_impuesto }}
                    </template>
                </p>

                <UFormField
                    label="Tasa"
                    name="tasa"
                    required
                    :help="retencion ? 'Retención: escribe la tasa en positivo; el signo menos ya es del impuesto.' : 'Por ciento, con hasta 6 decimales.'"
                >
                    <UInput
                        v-model="estado.tasa"
                        inputmode="decimal"
                        class="w-full font-mono"
                        autocomplete="off"
                    >
                        <template
                            v-if="retencion"
                            #leading
                        >
                            <span
                                class="font-mono text-sm text-muted"
                                aria-label="Signo menos de la retención"
                            >−</span>
                        </template>
                        <template #trailing>
                            <span class="text-sm text-muted">%</span>
                        </template>
                    </UInput>
                </UFormField>

                <UFormField
                    name="activo"
                    :help="estado.activo ? undefined : 'Inactivo: deja de aplicar desde la fecha; lo anterior se conserva.'"
                >
                    <USwitch
                        v-model="estado.activo"
                        label="Activo"
                    />
                </UFormField>

                <UFormField
                    label="Vigente desde"
                    name="vigente_desde"
                    required
                    help="Lo anterior a esta fecha no cambia. No puede caer en un mes cerrado."
                >
                    <UInput
                        v-model="estado.vigente_desde"
                        type="date"
                        class="w-full"
                    />
                </UFormField>

                <UFormField
                    v-if="alcanceGlobal"
                    name="global"
                    help="Una versión global aplica a todas las empresas que no tengan una propia."
                >
                    <USwitch
                        v-model="estado.global"
                        label="Versión global (toda la instalación)"
                    />
                </UFormField>

                <UFormField
                    label="Motivo"
                    name="motivo"
                    required
                    help="Queda en la bitácora junto con tu usuario."
                >
                    <UTextarea
                        v-model="estado.motivo"
                        :rows="2"
                        placeholder="Ej.: Decreto 4-2027, nueva tasa"
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
                    label="Guardar versión"
                    :disabled="!puede('fiscal.editar_parametros')"
                    icon="i-lucide-check"
                    :loading="enviando"
                />
            </div>
        </template>
    </UModal>
</template>
