<script setup lang="ts">
/**
 * Resultado de la evaluación de una promesa (`resultado_evaluacion`): decisión (aprobada,
 * rechazada, pendiente), qué regla decidió y por qué, y cada verificación que hizo la API.
 */
const props = withDefaults(defineProps<{
    promesa: Promesa
    /** Solo la decisión y la regla, para filas de tabla. */
    compacta?: boolean
}>(), {
    compacta: false,
})

const evaluacion = computed(() => leerEvaluacion(props.promesa))
const decision = computed(() => (evaluacion.value.decision ? DECISIONES[evaluacion.value.decision] : null))
</script>

<template>
    <div
        v-if="compacta"
        class="flex min-w-0 flex-col gap-0.5"
        data-prueba="evaluacion-compacta"
    >
        <span
            v-if="evaluacion.regla"
            class="truncate text-xs text-muted"
        >{{ etiquetaRegla(evaluacion.regla) }}</span>
        <span
            v-if="evaluacion.motivo"
            class="line-clamp-2 text-xs whitespace-normal text-muted"
        >{{ evaluacion.motivo }}</span>
        <span
            v-if="!evaluacion.regla && !evaluacion.motivo"
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
                v-if="evaluacion.regla"
                class="text-sm text-highlighted"
                data-prueba="regla"
            >
                Regla: <strong>{{ etiquetaRegla(evaluacion.regla) }}</strong>{{ ' ' }}<span class="font-mono text-xs text-muted">({{ evaluacion.regla }})</span>
            </span>
        </div>
        <p
            v-if="evaluacion.motivo"
            class="text-sm text-default"
            data-prueba="motivo-evaluacion"
        >
            {{ evaluacion.motivo }}
        </p>
        <p
            v-if="!evaluacion.regla && !evaluacion.motivo && !evaluacion.verificaciones.length"
            class="text-sm text-muted"
        >
            La API no devolvió el detalle de la evaluación.
        </p>

        <ul
            v-if="evaluacion.verificaciones.length"
            class="flex flex-col gap-1.5"
        >
            <li
                v-for="verificacion in evaluacion.verificaciones"
                :key="verificacion.regla"
                class="flex items-start gap-2 text-sm"
            >
                <UIcon
                    :name="verificacion.cumple ? 'i-lucide-circle-check' : 'i-lucide-circle-x'"
                    class="mt-0.5 size-4 shrink-0"
                    :class="verificacion.cumple ? 'text-success' : 'text-error'"
                />
                <span>
                    {{ etiquetaRegla(verificacion.regla) }}<template v-if="verificacion.detalle">: <span class="text-muted">{{ verificacion.detalle }}</span></template>
                </span>
            </li>
        </ul>

        <dl
            v-if="evaluacion.otros.length"
            class="grid gap-2 sm:grid-cols-2"
        >
            <DatoFicha
                v-for="otro in evaluacion.otros"
                :key="otro.clave"
                :etiqueta="otro.clave"
                :valor="otro.valor"
                mono
            />
        </dl>
    </section>
</template>
