<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { FormSubmitEvent } from '@nuxt/ui'

/**
 * Agrega una frase manual del DTE (pago directo, exportación…) o retira una (`activa: false`)
 * desde una fecha (`POST /fiscal/frases`, `fiscal.configurar`). Solo inserción: una frase nunca
 * se edita. Las del régimen no se agregan aquí (422 `frase_del_regimen`): salen del régimen.
 */
const props = withDefaults(defineProps<{
    /** Frase manual a retirar; sin ella, alta. */
    retirar?: FraseFiscal | null
}>(), {
    retirar: null,
})

const abierto = defineModel<boolean>('open', { default: false })
const emit = defineEmits<{ hecho: [frase: FraseFiscal] }>()

const { puede } = usePermisos()
const formulario = useTemplateRef('formulario')
const idFormulario = useId()
const hoy = hoyGuatemala()
const estado = reactive<EntradaFrase>({ tipo_frase: '', escenario: '', texto: '', tipos_dte: ['FACT'], vigente_desde: hoy, resolucion_numero: '', resolucion_fecha: '', motivo: '' })
const retiro = reactive<{ vigente_desde: string, motivo: string }>({ vigente_desde: hoy, motivo: '' })
const enviando = ref(false)
const problema = ref<Problem | null>(null)
let clave = nuevaClaveIdempotencia()

/**
 * Tipos de DTE de la localización vigente de la empresa (`tipos_dte` de
 * `GET /fiscal/empresas/:id/localizacion`, A3): el catálogo depende del paquete instalado.
 */
const catalogoDte = shallowRef<LocalizacionEmpresa['tipos_dte']>([])
const cargandoCatalogo = ref(false)
const problemaCatalogo = ref<Problem | null>(null)
const itemsDte = computed(() => catalogoDte.value.map(t => ({ label: `${t.codigo} · ${t.nombre}`, value: t.codigo })))

async function cargarCatalogo() {
    const empresaId = useEmpresaActiva().empresaId.value
    if (empresaId === null || !puede('fiscal.ver')) {
        return
    }
    cargandoCatalogo.value = true
    problemaCatalogo.value = null
    const resultado = await useLocalizacionFiscal().deEmpresa(empresaId)
    cargandoCatalogo.value = false
    catalogoDte.value = resultado.ok ? resultado.data.tipos_dte : []
    problemaCatalogo.value = resultado.ok ? null : resultado.problema
}

watch(abierto, (valor) => {
    if (!valor) {
        return
    }
    Object.assign(estado, { tipo_frase: '', escenario: '', texto: '', tipos_dte: ['FACT'], vigente_desde: hoy, resolucion_numero: '', resolucion_fecha: '', motivo: '' })
    Object.assign(retiro, { vigente_desde: hoy, motivo: '' })
    problema.value = null
    clave = nuevaClaveIdempotencia()
    formulario.value?.clear()
    if (!props.retirar && !catalogoDte.value.length) {
        void cargarCatalogo()
    }
})

async function ejecutar(cuerpo: CuerpoFrase) {
    enviando.value = true
    problema.value = null
    const resultado = await useFrasesFiscales().agregar(cuerpo, clave)
    enviando.value = false
    if (resultado.ok) {
        abierto.value = false
        emit('hecho', resultado.data)
        return
    }
    if (resultado.problema.status === 422 && resultado.problema.errors?.length) {
        formulario.value?.setErrors(erroresDeFormulario(resultado.problema).map(e => ({ ...e, name: e.name?.startsWith('tipos_dte') ? 'tipos_dte' : e.name })))
        if (codigoProblema(resultado.problema) !== 'validacion') {
            problema.value = problemaFiscalLegible(resultado.problema)
        }
        return
    }
    problema.value = problemaFiscalLegible(resultado.problema)
}

function agregar(evento: FormSubmitEvent<CuerpoFrase>) {
    void ejecutar(evento.data)
}

function confirmarRetiro(evento: FormSubmitEvent<{ vigente_desde: string, motivo: string }>) {
    const frase = props.retirar
    if (!frase || frase.tipo_frase === null || frase.escenario === null) {
        return
    }
    void ejecutar({ tipo_frase: frase.tipo_frase, escenario: frase.escenario, activa: false, vigente_desde: evento.data.vigente_desde, motivo: evento.data.motivo })
}
</script>

<template>
    <UModal
        v-model:open="abierto"
        :title="retirar ? 'Retirar frase' : 'Agregar frase'"
        :description="retirar ? retirar.texto : 'Frase manual del DTE (p. ej. exención, pago directo). Las del régimen se calculan solas.'"
        :dismissible="!enviando"
    >
        <template #body>
            <UForm
                v-if="retirar"
                :id="idFormulario"
                ref="formulario"
                :schema="esquemaRetiroFrase"
                :state="retiro"
                class="flex flex-col gap-4"
                @submit="confirmarRetiro"
            >
                <UAlert
                    color="neutral"
                    variant="subtle"
                    icon="i-lucide-calendar-x"
                    :description="`La frase ${retirar.tipo_frase}-${retirar.escenario} deja de ir en los DTE desde la fecha; los ya emitidos no cambian.`"
                />
                <UFormField
                    label="Deja de aplicar desde"
                    name="vigente_desde"
                    required
                >
                    <UInput
                        v-model="retiro.vigente_desde"
                        type="date"
                        class="w-full"
                    />
                </UFormField>
                <UFormField
                    label="Motivo"
                    name="motivo"
                    required
                    help="Queda en la bitácora junto con tu usuario."
                >
                    <UTextarea
                        v-model="retiro.motivo"
                        :rows="2"
                        class="w-full"
                    />
                </UFormField>
                <ProblemaAlerta
                    v-if="problema"
                    :problema="problema"
                />
            </UForm>

            <UForm
                v-else
                :id="idFormulario"
                ref="formulario"
                :schema="esquemaFrase"
                :state="estado"
                class="flex flex-col gap-4"
                @submit="agregar"
            >
                <div class="grid gap-4 sm:grid-cols-2">
                    <UFormField
                        label="Tipo de frase (SAT)"
                        name="tipo_frase"
                        required
                    >
                        <UInput
                            v-model="estado.tipo_frase"
                            inputmode="numeric"
                            class="w-full font-mono"
                        />
                    </UFormField>
                    <UFormField
                        label="Escenario"
                        name="escenario"
                        required
                    >
                        <UInput
                            v-model="estado.escenario"
                            inputmode="numeric"
                            class="w-full font-mono"
                        />
                    </UFormField>
                </div>
                <UFormField
                    label="Texto"
                    name="texto"
                    required
                >
                    <UTextarea
                        v-model="estado.texto"
                        :rows="2"
                        class="w-full"
                    />
                </UFormField>
                <UFormField
                    label="Tipos de DTE"
                    name="tipos_dte"
                    required
                >
                    <ProblemaAlerta
                        v-if="problemaCatalogo"
                        :problema="problemaCatalogo"
                        :reintentar="cargarCatalogo"
                        :reintentando="cargandoCatalogo"
                    />
                    <USelectMenu
                        v-else
                        v-model="estado.tipos_dte"
                        :items="itemsDte"
                        :loading="cargandoCatalogo"
                        value-key="value"
                        multiple
                        class="w-full"
                        aria-label="Tipos de DTE"
                    />
                </UFormField>
                <UFormField
                    label="Vigente desde"
                    name="vigente_desde"
                    required
                >
                    <UInput
                        v-model="estado.vigente_desde"
                        type="date"
                        class="w-full"
                    />
                </UFormField>
                <div class="grid gap-4 sm:grid-cols-2">
                    <UFormField
                        label="Resolución SAT"
                        name="resolucion_numero"
                        hint="Opcional"
                    >
                        <UInput
                            v-model="estado.resolucion_numero"
                            class="w-full"
                        />
                    </UFormField>
                    <UFormField
                        label="Fecha de la resolución"
                        name="resolucion_fecha"
                    >
                        <UInput
                            v-model="estado.resolucion_fecha"
                            type="date"
                            class="w-full"
                        />
                    </UFormField>
                </div>
                <UFormField
                    label="Motivo"
                    name="motivo"
                    required
                    help="Queda en la bitácora junto con tu usuario."
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
                    :label="retirar ? 'Retirar frase' : 'Agregar frase'"
                    :disabled="!puede('fiscal.configurar')"
                    :icon="retirar ? 'i-lucide-calendar-x' : 'i-lucide-plus'"
                    :color="retirar ? 'error' : 'primary'"
                    :loading="enviando"
                />
            </div>
        </template>
    </UModal>
</template>
