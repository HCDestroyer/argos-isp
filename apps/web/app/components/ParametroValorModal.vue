<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { FormError, FormSubmitEvent, SelectItem } from '@nuxt/ui'

/**
 * Valor nuevo de un parámetro fiscal con su vigencia (`POST /fiscal/parametros/:clave/valores`,
 * `fiscal.editar_parametros`). Nunca se edita una fila: se inserta otra desde `vigente_desde` y lo
 * anterior sigue igual. Una `Idempotency-Key` por apertura. 422 por campo junto al campo;
 * `vigencia_duplicada`, `vigencia_en_periodo_bloqueado` y `parametro_no_editable` abajo, legibles.
 */
const props = withDefaults(defineProps<{
    parametro: ParametroFiscal | null
    /** Valor propuesto para un sí/no (las banderas abren con el contrario del vigente). */
    propuesto?: boolean | null
}>(), {
    propuesto: null,
})

const abierto = defineModel<boolean>('open', { default: false })
const emit = defineEmits<{ hecho: [valor: ValorParametroCreado] }>()

const { alcanceGlobal } = useEmpresaActiva()
const { puede } = usePermisos()
const formulario = useTemplateRef('formulario')
const idFormulario = useId()
const hoy = hoyGuatemala()
const estado = reactive<EntradaValorParametro>({ valor: '', booleano: false, vigente_desde: hoy, motivo: '', global: false })
const enviando = ref(false)
const problema = ref<Problem | null>(null)
let clave = nuevaClaveIdempotencia()

const esquema = computed(() => esquemaValorParametro(props.parametro ?? { tipo: 'texto', opciones: null, minimo: null, maximo: null }))
const itemsOpciones = computed<SelectItem[]>(() => (props.parametro?.opciones ?? []).map(opcion => ({
    label: props.parametro?.clave === 'regimen' ? etiquetaRegimen(opcion) : opcion.replace(/_/g, ' '),
    value: opcion,
})))
/** Valor global: solo con alcance global y si el parámetro no es de cada empresa (alcance E). */
const admiteGlobal = computed(() => alcanceGlobal.value && props.parametro?.alcance === 'G')
const ayudaValor = computed(() => {
    const p = props.parametro
    if (!p) {
        return undefined
    }
    const rango = [p.minimo !== null ? `mínimo ${Number(p.minimo)}` : null, p.maximo !== null ? `máximo ${Number(p.maximo)}` : null].filter(Boolean).join(', ')
    const porTipo: Partial<Record<ParametroFiscal['tipo'], string>> = {
        porcentaje: 'Por ciento, sin el signo (12.00 = 12 %)',
        monto: 'En quetzales, con hasta 2 decimales',
        json: 'JSON con la misma forma que el valor del paquete',
    }
    return [porTipo[p.tipo], rango].filter(Boolean).join(' · ') || undefined
})

function reiniciar() {
    const p = props.parametro
    estado.valor = p ? textoDesdeValor(p, p.valor) : ''
    estado.booleano = props.propuesto ?? (p?.valor === true)
    estado.vigente_desde = hoy
    estado.motivo = ''
    estado.global = false
    problema.value = null
    clave = nuevaClaveIdempotencia()
    formulario.value?.clear()
}

watch(abierto, (valor) => {
    if (valor) {
        reiniciar()
    }
})

/** `valor.otros` (forma de un json) se muestra en el campo `valor`. */
function erroresCampo(p: Problem): FormError[] {
    return erroresDeFormulario(p)
        .filter(error => error.name)
        .map(error => ({ ...error, name: error.name?.startsWith('valor') ? 'valor' : error.name, message: error.name?.startsWith('valor.') ? `${error.name.slice(6)}: ${error.message}` : error.message }))
        .filter(error => ['valor', 'vigente_desde', 'motivo'].includes(error.name ?? ''))
}

async function enviar(evento: FormSubmitEvent<CuerpoValorParametro>) {
    const p = props.parametro
    if (!p) {
        return
    }
    enviando.value = true
    problema.value = null
    const resultado = await useParametrosFiscales().agregarValor(p.clave, evento.data, clave)
    enviando.value = false
    if (resultado.ok) {
        abierto.value = false
        emit('hecho', resultado.data)
        return
    }
    const campos = resultado.problema.status === 422 ? erroresCampo(resultado.problema) : []
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
        :title="parametro ? `Nuevo valor · ${parametro.clave}` : 'Nuevo valor'"
        :description="parametro?.descripcion"
        :dismissible="!enviando"
    >
        <template #body>
            <UForm
                v-if="parametro"
                :id="idFormulario"
                ref="formulario"
                :schema="esquema"
                :state="estado"
                class="flex flex-col gap-4"
                @submit="enviar"
            >
                <div class="flex flex-wrap items-center gap-2 text-sm text-muted">
                    <span>Vigente: <span class="font-medium text-highlighted">{{ formatearValorFiscal(parametro.tipo, parametro.valor, parametro.clave) }}</span></span>
                    <span v-if="parametro.vigente_desde">desde {{ formatearFecha(parametro.vigente_desde) }}</span>
                    <UBadge
                        v-if="parametro.nivel"
                        :label="NIVELES_FISCALES[parametro.nivel].etiqueta"
                        :color="NIVELES_FISCALES[parametro.nivel].color"
                        variant="subtle"
                        size="sm"
                    />
                </div>

                <UAlert
                    v-if="parametro.confirmar_contador"
                    :color="parametro.pendiente_confirmar ? 'warning' : 'neutral'"
                    variant="subtle"
                    icon="i-lucide-user-check"
                    :title="parametro.pendiente_confirmar ? 'Confirmar con contador' : 'En la lista «confirmar con contador»'"
                    :description="parametro.pendiente_confirmar
                        ? `${parametro.valor === null ? 'No hay valor' : 'El valor del paquete es provisional'}: no está verificado (${parametro.fuente}). Escribe el que confirme el contador.`
                        : `El valor vigente ya lo registró un usuario (${parametro.nivel ? NIVELES_FISCALES[parametro.nivel].etiqueta.toLowerCase() : 'empresa'}). Fuente original: ${parametro.fuente}.`"
                    data-prueba="aviso-contador"
                />

                <UFormField
                    label="Valor"
                    name="valor"
                    :required="parametro.tipo !== 'bool'"
                    :help="ayudaValor"
                >
                    <USwitch
                        v-if="parametro.tipo === 'bool'"
                        v-model="estado.booleano"
                        :label="estado.booleano ? 'Sí' : 'No'"
                    />
                    <USelect
                        v-else-if="parametro.tipo === 'enum'"
                        v-model="estado.valor"
                        :items="itemsOpciones"
                        class="w-full"
                    />
                    <UTextarea
                        v-else-if="parametro.tipo === 'json'"
                        v-model="estado.valor"
                        :rows="6"
                        autoresize
                        class="w-full font-mono text-xs"
                    />
                    <UInput
                        v-else-if="parametro.tipo === 'fecha'"
                        v-model="estado.valor"
                        type="date"
                        class="w-full"
                    />
                    <UInput
                        v-else
                        v-model="estado.valor"
                        :inputmode="parametro.tipo === 'texto' ? 'text' : 'decimal'"
                        :class="['w-full', parametro.tipo === 'texto' ? '' : 'font-mono']"
                        autocomplete="off"
                    >
                        <template
                            v-if="parametro.tipo === 'porcentaje' || parametro.tipo === 'monto'"
                            #trailing
                        >
                            <span class="text-sm text-muted">{{ parametro.tipo === 'porcentaje' ? '%' : 'Q' }}</span>
                        </template>
                    </UInput>
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
                    v-if="admiteGlobal"
                    name="global"
                    help="Un valor global aplica a todas las empresas que no tengan uno propio."
                >
                    <USwitch
                        v-model="estado.global"
                        label="Valor global (toda la instalación)"
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
                        placeholder="Ej.: confirmado con el contador según resolución SAT…"
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
                    label="Guardar valor"
                    :disabled="!puede('fiscal.editar_parametros')"
                    icon="i-lucide-check"
                    :loading="enviando"
                />
            </div>
        </template>
    </UModal>
</template>
