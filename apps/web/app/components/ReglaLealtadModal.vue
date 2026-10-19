<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { FormSubmitEvent, SelectItem } from '@nuxt/ui'

/**
 * Alta y edición de una regla para ganar puntos (`POST`/`PUT /lealtad/reglas`,
 * `lealtad.configurar`). El formulario muestra las condiciones del tipo elegido (la unión por `tipo`
 * del OpenAPI) y una vista previa con el valor del programa (`valor_punto` y `valor_pasivo_punto`).
 */
const props = withDefaults(defineProps<{
    programa: ProgramaLealtad
    regla?: ReglaLealtad | null
}>(), {
    regla: null,
})

const abierto = defineModel<boolean>('open', { default: false })

const emit = defineEmits<{
    hecho: [regla: ReglaLealtad]
}>()

const formulario = useTemplateRef('formulario')
const estado = reactive<EntradaReglaLealtad>(entradaReglaLealtadVacia())
const enviando = ref(false)
const problema = ref<Problem | null>(null)
let clave = nuevaClaveIdempotencia()

const itemsTipo: SelectItem[] = Object.entries(TIPOS_REGLA_LEALTAD).map(([value, t]) => ({ label: t.etiqueta, value, icon: t.icono, description: t.descripcion }))
const itemsPeriodo: SelectItem[] = [{ label: 'Por mes', value: 'mes' }, { label: 'Por año', value: 'anio' }]
const itemsEstados = ESTADOS_SERVICIO_ANTIGUEDAD.map(e => ({ label: ESTADOS_SERVICIO[e].etiqueta, value: e }))
const vista = computed(() => vistaPreviaRegla(estado, props.programa))

watch(abierto, (valor) => {
    if (valor) {
        Object.assign(estado, props.regla ? entradaDeReglaLealtad(props.regla) : entradaReglaLealtadVacia())
        problema.value = null
        clave = nuevaClaveIdempotencia()
    }
})

async function enviar(evento: FormSubmitEvent<SalidaReglaLealtad>) {
    enviando.value = true
    problema.value = null
    const resultado = props.regla
        ? await useReglasLealtad().editar(props.regla.id, cuerpoEdicionReglaLealtad(props.regla, evento.data))
        : await useReglasLealtad().crear(cuerpoReglaLealtad(props.programa.id, evento.data), clave)
    enviando.value = false
    if (resultado.ok) {
        abierto.value = false
        emit('hecho', resultado.data)
        return
    }
    // `condiciones.racha.periodos` → `racha_periodos`; `condiciones.cada_meses` → `cada_meses`.
    const errores = erroresDeFormulario(resultado.problema).map(e => ({ ...e, name: e.name?.replace(/^condiciones\./, '').replace('.', '_') }))
    formulario.value?.setErrors(errores.filter(e => e.name && Object.hasOwn(estado, e.name)))
    problema.value = resultado.problema
}
</script>

<template>
    <UModal
        v-model:open="abierto"
        :title="regla ? `Editar regla · ${TIPOS_REGLA_LEALTAD[regla.tipo].etiqueta}` : 'Nueva regla'"
        :description="TIPOS_REGLA_LEALTAD[estado.tipo].descripcion"
        :dismissible="!enviando"
        :ui="{ content: 'sm:max-w-2xl' }"
    >
        <template #body>
            <UForm
                id="form-regla-lealtad"
                ref="formulario"
                :schema="esquemaReglaLealtad"
                :state="estado"
                class="flex flex-col gap-4"
                @submit="enviar"
            >
                <div class="grid gap-4 sm:grid-cols-2">
                    <UFormField
                        label="Tipo"
                        name="tipo"
                        required
                        :help="regla ? 'El tipo no se cambia: crea otra regla.' : undefined"
                    >
                        <USelect
                            v-model="estado.tipo"
                            :items="itemsTipo"
                            :disabled="Boolean(regla)"
                            class="w-full"
                            data-prueba="regla-tipo"
                        />
                    </UFormField>
                    <UFormField
                        label="Puntos"
                        name="puntos"
                        required
                    >
                        <UInputNumber
                            v-model="estado.puntos"
                            :min="0"
                            class="w-full"
                            data-prueba="regla-puntos"
                        />
                    </UFormField>

                    <template v-if="estado.tipo === 'pago_a_tiempo'">
                        <UFormField
                            label="Días antes del vencimiento"
                            name="dias_antes_vencimiento"
                            help="0: cuenta si se paga a más tardar el día que vence."
                        >
                            <UInputNumber
                                v-model="estado.dias_antes_vencimiento"
                                :min="0"
                                :max="365"
                                class="w-full"
                            />
                        </UFormField>
                        <UFormField
                            label="Monto mínimo de la factura"
                            name="monto_minimo"
                        >
                            <UInput
                                v-model="estado.monto_minimo"
                                inputmode="decimal"
                                placeholder="Sin mínimo"
                                class="w-full"
                            >
                                <template #leading>
                                    <span class="text-sm text-muted">Q</span>
                                </template>
                            </UInput>
                        </UFormField>
                        <USwitch
                            v-model="estado.solo_servicio"
                            label="Solo facturas de servicio (no la mora)"
                        />
                        <USwitch
                            v-model="estado.sin_promesa"
                            label="Sin promesa de pago"
                        />
                        <USwitch
                            v-model="estado.con_racha"
                            label="Bono por racha"
                            class="sm:col-span-2"
                        />
                        <template v-if="estado.con_racha">
                            <UFormField
                                label="Facturas seguidas a tiempo"
                                name="racha_periodos"
                            >
                                <UInputNumber
                                    v-model="estado.racha_periodos"
                                    :min="1"
                                    :max="120"
                                    class="w-full"
                                />
                            </UFormField>
                            <UFormField
                                label="Puntos extra"
                                name="racha_puntos_extra"
                            >
                                <UInputNumber
                                    v-model="estado.racha_puntos_extra"
                                    :min="1"
                                    class="w-full"
                                />
                            </UFormField>
                        </template>
                    </template>

                    <template v-else-if="estado.tipo === 'antiguedad'">
                        <UFormField
                            label="Cada cuántos meses"
                            name="cada_meses"
                        >
                            <UInputNumber
                                v-model="estado.cada_meses"
                                :min="1"
                                :max="240"
                                class="w-full"
                            />
                        </UFormField>
                        <UFormField
                            label="Estados que cuentan"
                            name="estados_validos"
                        >
                            <UCheckboxGroup
                                v-model="estado.estados_validos"
                                :items="itemsEstados"
                                orientation="horizontal"
                            />
                        </UFormField>
                        <USwitch
                            v-model="estado.con_limite_vencidas"
                            label="Sin facturas vencidas de más de"
                        />
                        <UFormField
                            v-if="estado.con_limite_vencidas"
                            label="Días"
                            name="sin_vencidas_mas_de_dias"
                        >
                            <UInputNumber
                                v-model="estado.sin_vencidas_mas_de_dias"
                                :min="0"
                                class="w-full"
                            />
                        </UFormField>
                    </template>

                    <template v-else-if="estado.tipo === 'referido'">
                        <UFormField
                            label="Facturas pagadas del referido"
                            name="facturas_pagadas_minimas"
                        >
                            <UInputNumber
                                v-model="estado.facturas_pagadas_minimas"
                                :min="1"
                                :max="60"
                                class="w-full"
                            />
                        </UFormField>
                        <UFormField
                            label="Plazo en días desde el alta"
                            name="dias_maximos"
                            help="Vacío: sin plazo."
                        >
                            <UInputNumber
                                v-model="estado.dias_maximos"
                                :min="1"
                                placeholder="Sin plazo"
                                class="w-full"
                            />
                        </UFormField>
                        <UFormField
                            label="Bono al cliente referido"
                            name="puntos_referido"
                        >
                            <UInputNumber
                                v-model="estado.puntos_referido"
                                :min="0"
                                class="w-full"
                            />
                        </UFormField>
                        <UFormField
                            label="Tope de referidos por cliente"
                            name="tope_por_referidor"
                            help="Vacío: sin tope."
                        >
                            <UInputNumber
                                v-model="estado.tope_por_referidor"
                                :min="1"
                                placeholder="Sin tope"
                                class="w-full"
                            />
                        </UFormField>
                    </template>

                    <template v-else>
                        <UFormField
                            label="Meses adelantados mínimos"
                            name="periodos_minimos"
                        >
                            <UInputNumber
                                v-model="estado.periodos_minimos"
                                :min="1"
                                :max="60"
                                class="w-full"
                            />
                        </UFormField>
                        <UFormField
                            label="Puntos por mes adelantado"
                            name="puntos_por_periodo"
                        >
                            <UInputNumber
                                v-model="estado.puntos_por_periodo"
                                :min="0"
                                class="w-full"
                            />
                        </UFormField>
                    </template>

                    <USwitch
                        v-model="estado.con_tope"
                        label="Tope de otorgamientos por cliente"
                        class="sm:col-span-2"
                    />
                    <template v-if="estado.con_tope">
                        <UFormField
                            label="Veces"
                            name="tope_por_cliente"
                        >
                            <UInputNumber
                                v-model="estado.tope_por_cliente"
                                :min="1"
                                class="w-full"
                            />
                        </UFormField>
                        <UFormField
                            label="Periodo"
                            name="periodo_tope"
                        >
                            <USelect
                                v-model="estado.periodo_tope"
                                :items="itemsPeriodo"
                                class="w-full"
                            />
                        </UFormField>
                    </template>
                    <UFormField
                        label="Vigente desde"
                        name="vigente_desde"
                        help="Vacío: hoy."
                    >
                        <UInput
                            v-model="estado.vigente_desde"
                            type="date"
                            class="w-full"
                        />
                    </UFormField>
                    <UFormField
                        label="Vigente hasta"
                        name="vigente_hasta"
                        help="Vacío: sin fin."
                    >
                        <UInput
                            v-model="estado.vigente_hasta"
                            type="date"
                            class="w-full"
                        />
                    </UFormField>
                    <USwitch
                        v-model="estado.activa"
                        :label="estado.activa ? 'Activa' : 'Inactiva'"
                    />
                </div>

                <section
                    class="flex flex-col gap-1 rounded-lg bg-elevated p-3 text-sm"
                    data-prueba="regla-vista-previa"
                >
                    <h3 class="font-medium text-highlighted">
                        Vista previa
                    </h3>
                    <p
                        v-for="linea in vista"
                        :key="linea.concepto"
                        class="flex flex-wrap justify-between gap-2"
                    >
                        <span class="text-muted">{{ linea.concepto }}</span>
                        <span class="tabular-nums">
                            {{ formatearPuntos(linea.puntos) }} · valen {{ formatearQuetzales(linea.valor) }}<template v-if="linea.pasivo">
                                · pasivo {{ formatearQuetzales(linea.pasivo) }}
                            </template>
                        </span>
                    </p>
                    <p class="text-xs text-muted">
                        Con el programa: Q {{ programa.valor_punto }} por punto<template v-if="programa.diferimiento">
                            y Q {{ programa.valor_pasivo_punto }} de pasivo por punto ({{ formatearPorcentaje(programa.canje_esperado_pct) }} % de canje esperado)
                        </template><template v-else>
                            , sin diferimiento (no lleva asientos)
                        </template>.
                    </p>
                </section>

                <ProblemaAlerta
                    v-if="problema"
                    :problema="problema"
                    data-prueba="regla-error"
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
                    form="form-regla-lealtad"
                    :label="regla ? 'Guardar' : 'Crear regla'"
                    icon="i-lucide-save"
                    :loading="enviando"
                    data-prueba="regla-guardar"
                />
            </div>
        </template>
    </UModal>
</template>
