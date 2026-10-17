<script setup lang="ts">
/**
 * Resultado de la evaluación de una promesa (`resultado_evaluacion`, `Schema<'EvaluacionPromesa'>`
 * de A3): decisión, la regla que decidió (null si se aprobó), el motivo, las reglas revisadas en
 * orden (terminan en la que decidió) con lo medido y el límite, la deuda, el historial y, si los
 * hay, la aprobación y el cierre. Sin evaluación solo se ve la decisión que da el estado.
 */
const props = withDefaults(defineProps<{
    promesa: Promesa
    /** Solo la decisión y la regla, para filas de tabla. */
    compacta?: boolean
}>(), {
    compacta: false,
})

const lectura = computed(() => leerEvaluacion(props.promesa))
const evaluacion = computed(() => lectura.value.evaluacion)
const decision = computed(() => (lectura.value.decision ? DECISIONES[lectura.value.decision] : null))
const ultimo = computed(() => ultimoPaso(evaluacion.value))
const datos = computed(() => (evaluacion.value ? datosEvaluacion(evaluacion.value) : []))

function limiteDe(regla: ReglaEvaluada): string | null {
    const valor = textoValorRegla(regla.valor)
    const limite = textoValorRegla(regla.limite)
    if (valor === null && limite === null) {
        return null
    }
    return [valor !== null ? `medido ${valor}` : null, limite !== null ? `límite ${limite}` : null].filter(Boolean).join(' · ')
}
</script>

<template>
    <div
        v-if="compacta"
        class="flex min-w-0 flex-col gap-0.5"
        data-prueba="evaluacion-compacta"
    >
        <span
            v-if="ultimo"
            class="line-clamp-2 text-xs whitespace-normal text-highlighted"
            data-prueba="ultimo-paso"
        >{{ ultimo }}</span>
        <span
            v-if="evaluacion?.regla"
            class="truncate text-xs text-muted"
        >{{ etiquetaRegla(evaluacion.regla) }}</span>
        <span
            v-if="evaluacion"
            class="line-clamp-2 text-xs whitespace-normal text-muted"
        >{{ evaluacion.motivo }}</span>
        <span
            v-else
            class="text-xs text-dimmed"
        >Sin detalle de la evaluación</span>
    </div>

    <section
        v-else
        class="flex flex-col gap-3 rounded-lg border border-default p-4"
        aria-label="Resultado de la evaluación"
        data-prueba="evaluacion"
    >
        <div class="flex flex-wrap items-center gap-2">
            <UBadge
                v-if="decision"
                :label="decision.etiqueta"
                :icon="decision.icono"
                :color="decision.color"
                variant="solid"
                data-prueba="decision"
            />
            <span
                v-if="evaluacion?.regla"
                class="text-sm text-highlighted"
                data-prueba="regla"
            >
                Regla: <strong>{{ etiquetaRegla(evaluacion.regla) }}</strong>{{ ' ' }}<span class="font-mono text-xs text-muted">({{ evaluacion.regla }})</span>
            </span>
        </div>

        <template v-if="evaluacion">
            <p
                class="text-sm text-default"
                data-prueba="motivo-evaluacion"
            >
                {{ evaluacion.motivo }}
            </p>

            <ul
                v-if="evaluacion.reglas.length"
                class="flex flex-col gap-1.5"
                aria-label="Reglas revisadas"
                data-prueba="reglas-evaluadas"
            >
                <li
                    v-for="regla in evaluacion.reglas"
                    :key="regla.regla"
                    class="flex items-start gap-2 text-sm"
                    :data-regla="regla.regla"
                >
                    <UIcon
                        :name="regla.ok ? 'i-lucide-circle-check' : 'i-lucide-circle-x'"
                        class="mt-0.5 size-4 shrink-0"
                        :class="regla.ok ? 'text-success' : 'text-error'"
                    />
                    <span class="flex min-w-0 flex-col">
                        <span>{{ etiquetaRegla(regla.regla) }}: <span class="text-muted">{{ regla.detalle }}</span></span>
                        <span
                            v-if="limiteDe(regla) || etiquetaOrigenRegla(regla.origen)"
                            class="text-xs text-dimmed"
                        >{{ [limiteDe(regla), etiquetaOrigenRegla(regla.origen)].filter(Boolean).join(' · ') }}</span>
                    </span>
                </li>
            </ul>

            <dl class="grid gap-2 sm:grid-cols-2">
                <DatoFicha
                    v-for="dato in datos"
                    :key="dato.clave"
                    :etiqueta="dato.etiqueta"
                    :valor="dato.valor"
                />
            </dl>
        </template>
        <p
            v-else
            class="text-sm text-muted"
        >
            La API no devolvió el detalle de la evaluación.
        </p>
    </section>
</template>
