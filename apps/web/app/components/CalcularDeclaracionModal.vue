<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { FormSubmitEvent, SelectItem } from '@nuxt/ui'

/**
 * Calcula una versión de una declaración (`POST /declaraciones/calcular`, `declaraciones.calcular`)
 * desde los libros del mes de la empresa activa. Si la última versión ya está revisada o presentada la
 * API responde 409 y aquí se ofrece «Calcular sustitutiva» (su revisión liquida solo la diferencia).
 */
const props = withDefaults(defineProps<{
    impuesto?: ImpuestoDeclarable
    periodo?: string
    /** Empresa en el texto (con varias empresas); `null` no la nombra. */
    empresa?: string | null
}>(), {
    impuesto: 'iva_mensual',
    periodo: undefined,
    empresa: null,
})

const abierto = defineModel<boolean>('open', { default: false })
const emit = defineEmits<{ hecho: [declaracion: Declaracion] }>()

const { puede } = usePermisos()
const hoy = hoyGuatemala()
const esquema = esquemaCalcularDeclaracion(hoy)
const formulario = useTemplateRef('formulario')
const idFormulario = useId()
const estado = reactive<EntradaCalcularDeclaracion>({ impuesto: props.impuesto, periodo: props.periodo ?? mesPorDeclarar(hoy), sustitutiva: false })
const enviando = ref(false)
const problema = ref<Problem | null>(null)
let clave = nuevaClaveIdempotencia()

const itemsImpuesto: SelectItem[] = IMPUESTOS_DECLARABLES_ORDEN.map(i => ({ label: `${IMPUESTOS_DECLARABLES[i].etiqueta} (${IMPUESTOS_DECLARABLES[i].formulario})`, value: i }))

watch(abierto, (valor) => {
    if (!valor) {
        return
    }
    Object.assign(estado, { impuesto: props.impuesto, periodo: props.periodo ?? mesPorDeclarar(hoy), sustitutiva: false })
    problema.value = null
    clave = nuevaClaveIdempotencia()
    formulario.value?.clear()
})

async function enviar(cuerpo: CuerpoCalcularDeclaracion) {
    enviando.value = true
    problema.value = null
    const resultado = await useDeclaraciones().calcular(cuerpo, clave)
    enviando.value = false
    if (resultado.ok) {
        abierto.value = false
        emit('hecho', resultado.data)
        return
    }
    if (resultado.problema.status === 422 && codigoProblema(resultado.problema) === 'validacion') {
        formulario.value?.setErrors(erroresDeFormulario(resultado.problema))
        return
    }
    problema.value = resultado.problema
    // Otro intento lógico (p. ej. la sustitutiva): clave nueva.
    clave = nuevaClaveIdempotencia()
}

function calcular(evento: FormSubmitEvent<CuerpoCalcularDeclaracion>) {
    void enviar(evento.data)
}

function calcularSustitutiva() {
    estado.sustitutiva = true
    void enviar({ impuesto: estado.impuesto, periodo: estado.periodo, sustitutiva: true })
}
</script>

<template>
    <UModal
        v-model:open="abierto"
        title="Calcular declaración"
        :description="empresa ? `Borrador desde los libros del mes de ${empresa}.` : 'Borrador desde los libros de ventas y compras y las constancias de retención del mes.'"
        :dismissible="!enviando"
    >
        <template #body>
            <UForm
                :id="idFormulario"
                ref="formulario"
                :schema="esquema"
                :state="estado"
                class="flex flex-col gap-4"
                @submit="calcular"
            >
                <div class="grid gap-4 sm:grid-cols-2">
                    <UFormField
                        label="Impuesto"
                        name="impuesto"
                        required
                    >
                        <USelect
                            v-model="estado.impuesto"
                            :items="itemsImpuesto"
                            class="w-full"
                            data-prueba="calcular-impuesto"
                        />
                    </UFormField>
                    <UFormField
                        label="Mes"
                        name="periodo"
                        required
                    >
                        <UInput
                            v-model="estado.periodo"
                            type="month"
                            :max="hoy.slice(0, 7)"
                            class="w-full"
                            data-prueba="calcular-periodo"
                        />
                    </UFormField>
                </div>
                <p class="text-xs text-muted">
                    Cada cálculo es una versión nueva; las anteriores quedan en el historial. Nada se envía a la SAT.
                </p>
                <template v-if="problema">
                    <ProblemaAlerta
                        :problema="problemaDeclaracionLegible(problema)"
                        data-prueba="calcular-problema"
                    />
                    <UButton
                        v-if="pideSustitutiva(problema) && puede('declaraciones.calcular')"
                        label="Calcular sustitutiva"
                        icon="i-lucide-copy-plus"
                        color="warning"
                        variant="outline"
                        class="self-start"
                        :loading="enviando"
                        data-prueba="calcular-sustitutiva"
                        @click="calcularSustitutiva"
                    />
                </template>
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
                    label="Calcular"
                    icon="i-lucide-calculator"
                    :disabled="!puede('declaraciones.calcular')"
                    :loading="enviando"
                    data-prueba="calcular-confirmar"
                />
            </div>
        </template>
    </UModal>
</template>
