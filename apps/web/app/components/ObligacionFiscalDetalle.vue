<script setup lang="ts">
/**
 * Detalle de una obligación del calendario fiscal: periodo, vencimiento y cómo se calculó (el
 * parámetro de plazo, su valor y nivel, y si caía en inhábil y corrió al siguiente hábil), el
 * formulario (o «por confirmar con contador») y el estado con su motivo. Enlaza su declaración
 * (`declaracion_id`, fase 7 PR B) o, en IVA y pequeño contribuyente sin calcular, lleva a calcularla.
 */
const props = defineProps<{
    obligacion: ObligacionFiscal
    /** Nombre de la empresa (consolidado); `null` no la muestra. */
    empresa?: string | null
}>()

const estado = computed(() => estadoVisible(props.obligacion))
const regla = computed(() => reglaVencimiento(props.obligacion))
const dias = computed(() => textoDiasRestantes(props.obligacion))
const motivo = computed(() => motivoObligacion(props.obligacion.motivo_estado))
const { puede } = usePermisos()
/** El periodo como lo pide `POST /declaraciones/calcular`: `AAAA-MM`, `AAAA-Tn` o `AAAA`. */
const periodo = computed(() => periodoDeclaracion({ impuesto: props.obligacion.impuesto, periodo_desde: props.obligacion.periodo_desde }))
const calculable = computed(() => esImpuestoDeclarable(props.obligacion.impuesto) && props.obligacion.estado !== 'no_aplica' && props.obligacion.declaracion_id === null)
const nivel = computed(() => {
    const valor = regla.value.nivel
    return valor && valor in NIVELES_FISCALES ? NIVELES_FISCALES[valor as keyof typeof NIVELES_FISCALES].etiqueta : valor
})
</script>

<template>
    <div
        class="flex flex-col gap-4"
        data-prueba="obligacion-detalle"
    >
        <div class="flex flex-wrap items-center gap-2">
            <UBadge
                :label="estado.etiqueta"
                :icon="estado.icono"
                :color="estado.color"
                variant="subtle"
                data-prueba="detalle-estado"
            />
            <UBadge
                v-if="dias"
                :label="dias"
                :color="colorDiasRestantes(obligacion)"
                variant="outline"
                data-prueba="detalle-dias"
            />
        </div>

        <div
            v-if="puede('declaraciones.ver') && (obligacion.declaracion_id !== null || (calculable && puede('declaraciones.calcular')))"
            class="flex flex-wrap gap-2"
        >
            <UButton
                v-if="obligacion.declaracion_id !== null"
                label="Ver declaración"
                icon="i-lucide-file-spreadsheet"
                size="sm"
                :to="`/declaraciones/${obligacion.declaracion_id}`"
                data-prueba="detalle-declaracion"
            />
            <UButton
                v-else
                label="Calcular borrador"
                icon="i-lucide-calculator"
                size="sm"
                :to="`/declaraciones?calcular=${obligacion.impuesto}&periodo=${periodo}`"
                data-prueba="detalle-calcular"
            />
        </div>

        <UAlert
            v-if="obligacion.estado === 'no_aplica'"
            color="neutral"
            variant="subtle"
            icon="i-lucide-circle-slash"
            title="No aplica"
            :description="motivo ?? 'Sin motivo registrado'"
            data-prueba="detalle-motivo"
        />
        <UAlert
            v-else-if="esRectificativa(obligacion)"
            color="warning"
            variant="subtle"
            icon="i-lucide-file-diff"
            title="Rectificativa por presentar"
            description="Una sustitutiva de un mes anterior cambió el remanente que arrastra este mes: su declaración se rectificó y hay que presentarla de nuevo en Declaraguate."
            data-prueba="detalle-rectificativa"
        />
        <UAlert
            v-else-if="obligacion.vencida"
            color="error"
            variant="subtle"
            icon="i-lucide-alarm-clock-off"
            title="Vencida sin presentar"
            description="El plazo pasó y la declaración no consta como presentada. El sistema no presenta nada a la SAT: preséntela en Declaraguate."
        />

        <dl class="grid grid-cols-2 gap-3 text-sm">
            <DatoFicha
                etiqueta="Periodo"
                :valor="periodoObligacion(obligacion)"
            />
            <DatoFicha
                etiqueta="Fechas del periodo"
                :valor="`${formatearFecha(obligacion.periodo_desde)} – ${formatearFecha(obligacion.periodo_hasta)}`"
            />
            <DatoFicha
                etiqueta="Vence"
                :valor="`${diaSemana(obligacion.vence_en)} ${formatearFecha(obligacion.vence_en)}`"
            />
            <DatoFicha etiqueta="Formulario">
                <span
                    v-if="obligacion.formulario"
                    class="font-mono"
                >{{ obligacion.formulario }}</span>
                <UBadge
                    v-else
                    label="Por confirmar con contador"
                    icon="i-lucide-user-check"
                    color="warning"
                    variant="subtle"
                    size="sm"
                    data-prueba="detalle-formulario-por-confirmar"
                />
            </DatoFicha>
            <DatoFicha
                v-if="empresa"
                etiqueta="Empresa"
                :valor="empresa"
            />
            <DatoFicha
                etiqueta="Periodicidad"
                :valor="PERIODICIDADES_OBLIGACION[obligacion.periodicidad]"
            />
        </dl>

        <UPageCard
            title="Cómo se calculó el vencimiento"
            variant="subtle"
            data-prueba="detalle-regla"
        >
            <div class="flex flex-col gap-2 text-sm">
                <p class="text-highlighted">
                    {{ regla.plazo }}
                </p>
                <p
                    v-if="regla.corrido && regla.venceBase"
                    class="text-muted"
                    data-prueba="detalle-corrido"
                >
                    Caía el {{ diaSemana(regla.venceBase) }} {{ formatearFecha(regla.venceBase) }} (inhábil): corrido al siguiente día hábil, {{ formatearFecha(obligacion.vence_en) }}.
                </p>
                <p
                    v-if="regla.parametro"
                    class="text-xs text-muted"
                >
                    Parámetro <span class="font-mono">{{ regla.parametro }}</span><template v-if="nivel">
                        · nivel {{ nivel }}
                    </template><template v-if="regla.vigenteDesde">
                        · vigente desde {{ formatearFecha(regla.vigenteDesde) }}
                    </template>
                </p>
            </div>
        </UPageCard>

        <p class="text-xs text-muted">
            Versión {{ obligacion.version }} · actualizada {{ formatearFechaHora(obligacion.updated_at) }}
        </p>
    </div>
</template>
