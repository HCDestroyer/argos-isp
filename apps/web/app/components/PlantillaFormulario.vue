<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { FormSubmitEvent, SelectItem } from '@nuxt/ui'

/**
 * Alta y edición de una plantilla de facturación (A3): ciclo, corte, mora, momento de certificar
 * con FEL y todas las reglas de promesas de pago, generales y por canal. Esquema espejo del
 * validador (`esquemaPlantilla`); los 422 de la API caen junto a su campo y el 409 ofrece cargar la
 * versión guardada. Lo editado no cambia las facturas ya emitidas.
 */
const props = withDefaults(defineProps<{
    /** Plantilla a editar; sin ella, alta. */
    plantilla?: PlantillaFacturacion | null
    /** Sin `plantillas.editar`: se ven todas las reglas pero no se guardan. */
    soloLectura?: boolean
}>(), {
    plantilla: null,
    soloLectura: false,
})

const abierto = defineModel<boolean>('open', { default: false })

const emit = defineEmits<{
    guardado: [plantilla: PlantillaFacturacion]
}>()

const formulario = useTemplateRef('formulario')
const estado = reactive<EntradaPlantilla>(entradaPlantillaVacia())
const base = shallowRef<PlantillaFacturacion | null>(null)
const enviando = ref(false)
const recargando = ref(false)
const problema = ref<Problem | null>(null)
const conflicto = ref(false)

watch(abierto, (valor) => {
    if (valor) {
        base.value = props.plantilla
        Object.assign(estado, props.plantilla ? entradaDesdePlantilla(props.plantilla) : entradaPlantillaVacia())
        problema.value = null
        conflicto.value = false
    }
}, { immediate: true })

const itemsCiclo: SelectItem[] = [
    { label: 'Día fijo del mes', value: 'dia_fijo', description: 'Todas las facturas el mismo día' },
    { label: 'Aniversario', value: 'aniversario', description: 'El día de instalación de cada servicio' },
]
const itemsMora: SelectItem[] = [
    { label: 'Sin mora', value: 'ninguna' },
    { label: 'Monto fijo', value: 'fija' },
    { label: 'Porcentaje de la factura', value: 'porcentaje' },
]
const itemsCertificar: SelectItem[] = (Object.keys(CERTIFICAR_AL) as CertificarAl[]).map(valor => ({ label: CERTIFICAR_AL[valor].etiqueta, value: valor, description: CERTIFICAR_AL[valor].descripcion }))

watch(() => estado.ciclo, (ciclo) => {
    if (ciclo === 'aniversario') {
        estado.dia = null
    }
    else if (estado.dia === null) {
        estado.dia = 1
    }
})

watch(() => estado.mora_tipo, (tipo) => {
    if (tipo === 'ninguna') {
        estado.mora_valor = '0.00'
        estado.mora_recurrente = false
    }
    else if (estado.mora_valor === '0.00') {
        estado.mora_valor = ''
    }
})

const exigirCumplimiento = computed({
    get: () => estado.reglas_promesa.cumplimiento_minimo_pct !== null,
    set: (valor: boolean) => {
        estado.reglas_promesa.cumplimiento_minimo_pct = valor ? (estado.reglas_promesa.cumplimiento_minimo_pct ?? 80) : null
    },
})

/** `UInputNumber` vacío llega como `undefined`/`NaN`: para la API es `null` (usa el general). */
function numeroONulo(valor: number | null | undefined): number | null {
    return typeof valor === 'number' && Number.isFinite(valor) ? valor : null
}

function nombreCanal(canal: CanalReglasPromesa): string {
    return CANALES_PROMESA[canal]
}

async function cargarActual() {
    if (!base.value) {
        return
    }
    recargando.value = true
    const resultado = await usePlantillas().ver(base.value.id)
    recargando.value = false
    if (!resultado.ok) {
        problema.value = resultado.problema
        return
    }
    base.value = resultado.data
    Object.assign(estado, entradaDesdePlantilla(resultado.data))
    problema.value = null
    conflicto.value = false
}

async function enviar(evento: FormSubmitEvent<SalidaPlantilla>) {
    enviando.value = true
    problema.value = null
    conflicto.value = false
    const resultado = base.value
        ? await usePlantillas().editar(base.value.id, cambiosPlantilla(evento.data, base.value))
        : await usePlantillas().crear(cuerpoPlantilla(evento.data))
    enviando.value = false
    if (resultado.ok) {
        abierto.value = false
        emit('guardado', resultado.data)
        return
    }
    conflicto.value = resultado.problema.status === 409
    const errores = erroresDeFormulario(resultado.problema)
    if (errores.length) {
        formulario.value?.setErrors(errores)
    }
    const campos = new Set(Object.keys(estado))
    if (!errores.length || errores.some(e => !e.name || !campos.has(e.name.split('.')[0] ?? ''))) {
        problema.value = resultado.problema
    }
}
</script>

<template>
    <USlideover
        v-model:open="abierto"
        :title="plantilla ? (soloLectura ? plantilla.nombre : `Editar ${plantilla.nombre}`) : 'Nueva plantilla de facturación'"
        description="Los cambios rigen para las facturas que se emitan desde ahora; las emitidas guardan sus reglas."
        :dismissible="!enviando"
        :ui="{ content: 'sm:max-w-3xl' }"
    >
        <template #body>
            <UForm
                id="form-plantilla"
                ref="formulario"
                :schema="esquemaPlantilla"
                :state="estado"
                :disabled="soloLectura"
                class="flex flex-col gap-8"
                data-prueba="form-plantilla"
                @submit="enviar"
            >
                <section class="grid gap-4 sm:grid-cols-2">
                    <UFormField
                        label="Nombre"
                        name="nombre"
                        required
                        class="sm:col-span-2"
                    >
                        <UInput
                            v-model="estado.nombre"
                            placeholder="Mensual día 5"
                            class="w-full"
                            data-prueba="plantilla-nombre"
                        />
                    </UFormField>
                    <USwitch
                        v-model="estado.por_defecto"
                        label="Plantilla por defecto"
                        description="La reciben los servicios creados sin plantilla. Solo una: marcar esta desmarca la anterior."
                        class="sm:col-span-2"
                        data-prueba="plantilla-por-defecto"
                    />
                </section>

                <section class="flex flex-col gap-3">
                    <h3 class="text-sm font-medium text-highlighted">
                        Ciclo de facturación
                    </h3>
                    <div class="grid gap-4 sm:grid-cols-2">
                        <UFormField
                            label="Ciclo"
                            name="ciclo"
                            required
                        >
                            <USelect
                                v-model="estado.ciclo"
                                :items="itemsCiclo"
                                class="w-full"
                                data-prueba="plantilla-ciclo"
                            />
                        </UFormField>
                        <UFormField
                            v-if="estado.ciclo === 'dia_fijo'"
                            label="Día de facturación"
                            name="dia"
                            help="Del 1 al 28, para que exista en todos los meses."
                            required
                        >
                            <UInputNumber
                                :model-value="estado.dia ?? undefined"
                                :min="1"
                                :max="28"
                                class="w-full"
                                data-prueba="plantilla-dia"
                                @update:model-value="v => estado.dia = numeroONulo(v)"
                            />
                        </UFormField>
                        <USwitch
                            v-model="estado.prorrateo"
                            label="Prorratear el primer periodo"
                            description="Cobra solo los días desde la instalación hasta el primer corte."
                            class="sm:col-span-2"
                        />
                    </div>
                </section>

                <section class="flex flex-col gap-3">
                    <h3 class="text-sm font-medium text-highlighted">
                        Corte por falta de pago
                    </h3>
                    <div class="grid gap-4 sm:grid-cols-2">
                        <UFormField
                            label="Días de gracia"
                            name="dias_gracia"
                            help="Días después del vencimiento antes de contar la factura como vencida."
                        >
                            <UInputNumber
                                v-model="estado.dias_gracia"
                                :min="0"
                                :max="90"
                                class="w-full"
                                data-prueba="plantilla-gracia"
                            />
                        </UFormField>
                        <UFormField
                            label="Hora del corte"
                            name="hora_corte"
                            help="Hora de Guatemala, 24 h."
                        >
                            <UInput
                                v-model="estado.hora_corte"
                                type="time"
                                class="w-full"
                                data-prueba="plantilla-hora"
                            />
                        </UFormField>
                        <UFormField
                            label="Facturas vencidas para limitar"
                            name="facturas_para_limitar"
                            help="0 = nunca limita la velocidad."
                        >
                            <UInputNumber
                                v-model="estado.facturas_para_limitar"
                                :min="0"
                                :max="24"
                                class="w-full"
                                data-prueba="plantilla-limitar"
                            />
                        </UFormField>
                        <UFormField
                            label="Facturas vencidas para suspender"
                            name="facturas_para_cortar"
                        >
                            <UInputNumber
                                v-model="estado.facturas_para_cortar"
                                :min="1"
                                :max="24"
                                class="w-full"
                                data-prueba="plantilla-cortar"
                            />
                        </UFormField>
                    </div>
                </section>

                <section class="flex flex-col gap-3">
                    <h3 class="text-sm font-medium text-highlighted">
                        Recargo por mora
                    </h3>
                    <div class="grid gap-4 sm:grid-cols-2">
                        <UFormField
                            label="Tipo"
                            name="mora_tipo"
                        >
                            <USelect
                                v-model="estado.mora_tipo"
                                :items="itemsMora"
                                class="w-full"
                                data-prueba="plantilla-mora-tipo"
                            />
                        </UFormField>
                        <UFormField
                            v-if="estado.mora_tipo !== 'ninguna'"
                            :label="estado.mora_tipo === 'fija' ? 'Monto' : 'Porcentaje'"
                            name="mora_valor"
                            required
                        >
                            <UInput
                                v-model="estado.mora_valor"
                                inputmode="decimal"
                                :placeholder="estado.mora_tipo === 'fija' ? '25.00' : '5'"
                                class="w-full"
                                data-prueba="plantilla-mora-valor"
                            >
                                <template
                                    v-if="estado.mora_tipo === 'fija'"
                                    #leading
                                >
                                    <span class="text-sm text-muted">Q</span>
                                </template>
                                <template
                                    v-else
                                    #trailing
                                >
                                    <span class="text-sm text-muted">%</span>
                                </template>
                            </UInput>
                        </UFormField>
                        <USwitch
                            v-if="estado.mora_tipo !== 'ninguna'"
                            v-model="estado.mora_recurrente"
                            label="Cobrar en cada periodo vencido"
                            description="Apagado: un solo recargo por factura."
                            class="sm:col-span-2"
                        />
                    </div>
                </section>

                <section class="flex flex-col gap-3">
                    <h3 class="text-sm font-medium text-highlighted">
                        Factura electrónica (FEL)
                    </h3>
                    <UFormField
                        label="Certificar"
                        name="certificar_al"
                        help="«Nunca» no se admite si la FEL es obligatoria para la empresa."
                    >
                        <USelect
                            v-model="estado.certificar_al"
                            :items="itemsCertificar"
                            class="w-full sm:w-80"
                            data-prueba="plantilla-certificar"
                        />
                    </UFormField>
                </section>

                <section
                    class="flex flex-col gap-4"
                    data-prueba="plantilla-reglas-promesa"
                >
                    <div class="flex flex-col gap-1">
                        <h3 class="text-sm font-medium text-highlighted">
                            Promesas de pago
                        </h3>
                        <p class="text-xs text-muted">
                            Las evalúa la API al crear cada promesa, en este orden. Los límites de un canal, si se escriben, reemplazan al general.
                        </p>
                    </div>
                    <USwitch
                        v-model="estado.reglas_promesa.habilitadas"
                        label="Permitir promesas de pago"
                        data-prueba="plantilla-promesas-habilitadas"
                    />
                    <div
                        v-if="estado.reglas_promesa.habilitadas"
                        class="flex flex-col gap-6"
                    >
                        <div class="grid gap-4 sm:grid-cols-2">
                            <UFormField
                                label="Promesas por periodo"
                                name="reglas_promesa.max_por_periodo"
                            >
                                <UInputNumber
                                    v-model="estado.reglas_promesa.max_por_periodo"
                                    :min="0"
                                    :max="12"
                                    class="w-full"
                                    data-prueba="plantilla-max-periodo"
                                />
                            </UFormField>
                            <UFormField
                                label="Con buen historial"
                                name="reglas_promesa.max_por_periodo_buen_historial"
                                help="Máximo si el cliente cumplió lo suficiente."
                            >
                                <UInputNumber
                                    v-model="estado.reglas_promesa.max_por_periodo_buen_historial"
                                    :min="0"
                                    :max="12"
                                    class="w-full"
                                    data-prueba="plantilla-max-buen-historial"
                                />
                            </UFormField>
                            <UFormField
                                label="Buen historial desde"
                                name="reglas_promesa.buen_historial_pct"
                                help="% de promesas cumplidas."
                            >
                                <UInputNumber
                                    v-model="estado.reglas_promesa.buen_historial_pct"
                                    :min="0"
                                    :max="100"
                                    class="w-full"
                                />
                            </UFormField>
                            <UFormField
                                label="Ventana del historial"
                                name="reglas_promesa.historial_ventana"
                                help="Últimas N promesas que se miran."
                            >
                                <UInputNumber
                                    v-model="estado.reglas_promesa.historial_ventana"
                                    :min="1"
                                    :max="50"
                                    class="w-full"
                                />
                            </UFormField>
                            <UFormField
                                label="Plazo máximo (días)"
                                name="reglas_promesa.plazo_max_dias"
                            >
                                <UInputNumber
                                    v-model="estado.reglas_promesa.plazo_max_dias"
                                    :min="1"
                                    :max="60"
                                    class="w-full"
                                    data-prueba="plantilla-plazo"
                                />
                            </UFormField>
                            <UFormField
                                label="Deuda vencida máxima"
                                name="reglas_promesa.deuda_maxima"
                                help="Vacío = sin límite."
                            >
                                <UInput
                                    v-model="estado.reglas_promesa.deuda_maxima"
                                    inputmode="decimal"
                                    placeholder="Sin límite"
                                    class="w-full"
                                    data-prueba="plantilla-deuda-maxima"
                                >
                                    <template #leading>
                                        <span class="text-sm text-muted">Q</span>
                                    </template>
                                </UInput>
                            </UFormField>
                            <UFormField
                                label="Abono inicial"
                                name="reglas_promesa.abono_inicial_pct"
                                help="% de la deuda que se paga antes (0 = no se exige)."
                            >
                                <UInputNumber
                                    v-model="estado.reglas_promesa.abono_inicial_pct"
                                    :min="0"
                                    :max="100"
                                    class="w-full"
                                />
                            </UFormField>
                            <UFormField
                                label="Antigüedad mínima (días)"
                                name="reglas_promesa.antiguedad_minima_dias"
                            >
                                <UInputNumber
                                    v-model="estado.reglas_promesa.antiguedad_minima_dias"
                                    :min="0"
                                    :max="3650"
                                    class="w-full"
                                />
                            </UFormField>
                            <UFormField
                                label="Días sin promesas tras incumplir"
                                name="reglas_promesa.bloqueo_tras_incumplida_dias"
                            >
                                <UInputNumber
                                    v-model="estado.reglas_promesa.bloqueo_tras_incumplida_dias"
                                    :min="0"
                                    :max="365"
                                    class="w-full"
                                />
                            </UFormField>
                            <div class="flex flex-col gap-2">
                                <USwitch
                                    v-model="exigirCumplimiento"
                                    label="Exigir cumplimiento mínimo"
                                    data-prueba="plantilla-exigir-cumplimiento"
                                />
                                <UFormField
                                    v-if="exigirCumplimiento"
                                    label="Cumplimiento mínimo (%)"
                                    name="reglas_promesa.cumplimiento_minimo_pct"
                                >
                                    <UInputNumber
                                        :model-value="estado.reglas_promesa.cumplimiento_minimo_pct ?? undefined"
                                        :min="0"
                                        :max="100"
                                        class="w-full"
                                        @update:model-value="v => estado.reglas_promesa.cumplimiento_minimo_pct = numeroONulo(v)"
                                    />
                                </UFormField>
                            </div>
                            <USwitch
                                v-model="estado.reglas_promesa.no_exceder_siguiente_facturacion"
                                label="Vencer antes de la siguiente factura"
                                class="sm:col-span-2"
                            />
                        </div>

                        <div class="flex flex-col gap-3">
                            <h4 class="text-sm font-medium text-highlighted">
                                Por canal
                            </h4>
                            <div class="grid gap-3 lg:grid-cols-2">
                                <UCard
                                    v-for="canal in CANALES_REGLAS"
                                    :key="canal"
                                    variant="subtle"
                                    :ui="{ body: 'flex flex-col gap-3 p-4 sm:p-4' }"
                                    :data-prueba="`plantilla-canal-${canal}`"
                                >
                                    <span class="text-sm font-medium text-highlighted">{{ nombreCanal(canal) }}</span>
                                    <USwitch
                                        v-model="estado.reglas_promesa.canales[canal].permitido"
                                        label="Permitido"
                                    />
                                    <template v-if="estado.reglas_promesa.canales[canal].permitido">
                                        <USwitch
                                            v-model="estado.reglas_promesa.canales[canal].requiere_aprobacion"
                                            label="Requiere aprobación"
                                            description="La promesa queda pendiente hasta que alguien con «promesas.aprobar» la apruebe."
                                            :data-prueba="`plantilla-canal-${canal}-aprobacion`"
                                        />
                                        <div class="grid gap-3 sm:grid-cols-3">
                                            <UFormField
                                                label="Plazo (días)"
                                                :name="`reglas_promesa.canales.${canal}.plazo_max_dias`"
                                            >
                                                <UInputNumber
                                                    :model-value="estado.reglas_promesa.canales[canal].plazo_max_dias ?? undefined"
                                                    :min="1"
                                                    :max="60"
                                                    :placeholder="`General: ${estado.reglas_promesa.plazo_max_dias}`"
                                                    class="w-full"
                                                    :data-prueba="`plantilla-canal-${canal}-plazo`"
                                                    @update:model-value="v => estado.reglas_promesa.canales[canal].plazo_max_dias = numeroONulo(v)"
                                                />
                                            </UFormField>
                                            <UFormField
                                                label="Por periodo"
                                                :name="`reglas_promesa.canales.${canal}.max_por_periodo`"
                                            >
                                                <UInputNumber
                                                    :model-value="estado.reglas_promesa.canales[canal].max_por_periodo ?? undefined"
                                                    :min="0"
                                                    :max="12"
                                                    :placeholder="`General: ${estado.reglas_promesa.max_por_periodo}`"
                                                    class="w-full"
                                                    @update:model-value="v => estado.reglas_promesa.canales[canal].max_por_periodo = numeroONulo(v)"
                                                />
                                            </UFormField>
                                            <UFormField
                                                label="Deuda máx."
                                                :name="`reglas_promesa.canales.${canal}.deuda_maxima`"
                                            >
                                                <UInput
                                                    v-model="estado.reglas_promesa.canales[canal].deuda_maxima"
                                                    inputmode="decimal"
                                                    placeholder="General"
                                                    class="w-full"
                                                />
                                            </UFormField>
                                        </div>
                                    </template>
                                </UCard>
                            </div>
                        </div>
                    </div>
                </section>

                <ProblemaAlerta
                    v-if="problema"
                    :problema="problema"
                    :reintentar="conflicto ? cargarActual : undefined"
                    :reintentando="recargando"
                    data-prueba="plantilla-error"
                />
                <p
                    v-if="conflicto"
                    class="text-xs text-muted"
                >
                    «Reintentar» carga la versión guardada; tus cambios sin guardar se pierden.
                </p>
            </UForm>
        </template>

        <template #footer>
            <div class="flex w-full justify-end gap-2">
                <UButton
                    :label="soloLectura ? 'Cerrar' : 'Cancelar'"
                    color="neutral"
                    variant="ghost"
                    :disabled="enviando"
                    @click="abierto = false"
                />
                <UButton
                    v-if="!soloLectura"
                    type="submit"
                    form="form-plantilla"
                    :label="plantilla ? 'Guardar cambios' : 'Crear plantilla'"
                    icon="i-lucide-save"
                    :loading="enviando"
                    data-prueba="plantilla-guardar"
                />
            </div>
        </template>
    </USlideover>
</template>
