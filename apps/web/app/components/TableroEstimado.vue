<script setup lang="ts">
import type { Schema } from '@argosisp/contracts'

/**
 * Estimado de una declaración del periodo en curso (`EstimadoDeclaracion`): el impuesto determinado y
 * lo que habría que pagar, con los datos de hoy (las mismas cifras que el borrador). Enlaza la última
 * versión de la declaración del periodo o, sin ella, el cálculo del borrador. Las notas del cálculo van
 * con «confirmar con contador».
 */
const props = withDefaults(defineProps<{
    estimado: Schema<'EstimadoDeclaracion'>
    /** Título propio (p. ej. «Anual a la fecha»); por defecto, el impuesto. */
    titulo?: string
}>(), {
    titulo: undefined,
})

const { puede } = usePermisos()

const impuesto = computed(() => (esImpuestoDeclarable(props.estimado.impuesto) ? props.estimado.impuesto : null))
const etiqueta = computed(() => props.titulo ?? (impuesto.value ? etiquetaImpuestoDeclaracion(impuesto.value) : props.estimado.impuesto))
const periodo = computed(() => (impuesto.value ? etiquetaPeriodoDeclaracion({ impuesto: impuesto.value, periodo_desde: props.estimado.periodo_desde }) : props.estimado.periodo))

/** Etiqueta de un total según las secciones de la ficha de la declaración. */
function etiquetaTotal(clave: string): string {
    const filas = impuesto.value ? seccionesTotales(impuesto.value).flatMap(s => s.filas) : []
    return filas.find(f => f.clave === clave)?.etiqueta ?? clave
}

const cifras = computed(() => {
    const claves = [impuesto.value ? CLAVE_DETERMINADO[impuesto.value] : null, 'a_pagar']
        .filter((c, i, todas): c is string => c !== null && todas.indexOf(c) === i && props.estimado.totales[c] !== undefined)
    return claves.map(clave => ({ clave, etiqueta: etiquetaTotal(clave), valor: props.estimado.totales[clave] ?? null }))
})

const declaracion = computed(() => props.estimado.declaracion)
const estadoDeclaracion = computed(() => {
    const estado = declaracion.value?.estado
    return estado && estado in ESTADOS_DECLARACION ? ESTADOS_DECLARACION[estado as EstadoDeclaracion] : null
})
</script>

<template>
    <div
        class="flex flex-col gap-2"
        :data-estimado="estimado.impuesto"
    >
        <div class="flex flex-wrap items-baseline justify-between gap-x-2">
            <p class="text-sm font-medium text-highlighted">
                {{ etiqueta }} · {{ periodo }}
            </p>
            <p
                v-if="estimado.formulario"
                class="font-mono text-xs text-muted"
            >
                {{ estimado.formulario }}
            </p>
        </div>

        <dl class="grid grid-cols-2 gap-2">
            <DatoFicha
                v-for="cifra in cifras"
                :key="cifra.clave"
                :etiqueta="cifra.etiqueta"
                :data-total="cifra.clave"
            >
                <span class="font-semibold tabular-nums">{{ formatearQuetzales(cifra.valor) }}</span>
            </DatoFicha>
        </dl>

        <div class="flex flex-wrap items-center gap-2">
            <template v-if="declaracion">
                <UBadge
                    :color="estadoDeclaracion?.color ?? 'neutral'"
                    variant="subtle"
                    :icon="estadoDeclaracion?.icono"
                    :label="`Versión ${declaracion.version} · ${estadoDeclaracion?.etiqueta ?? declaracion.estado}`"
                />
                <UBadge
                    v-if="!declaracion.al_dia"
                    color="warning"
                    variant="subtle"
                    icon="i-lucide-refresh-cw"
                    label="Datos cambiados desde el borrador"
                    data-prueba="estimado-desactualizada"
                />
                <UButton
                    v-if="puede('declaraciones.ver')"
                    :to="`/declaraciones/${declaracion.id}`"
                    label="Ver declaración"
                    icon="i-lucide-file-spreadsheet"
                    color="neutral"
                    variant="link"
                    size="sm"
                    class="px-0"
                    data-prueba="estimado-declaracion"
                />
            </template>
            <template v-else>
                <UBadge
                    color="neutral"
                    variant="subtle"
                    label="Sin borrador"
                />
                <UButton
                    v-if="impuesto && puede('declaraciones.calcular') && puede('declaraciones.ver')"
                    :to="`/declaraciones?calcular=${impuesto}&periodo=${estimado.periodo}`"
                    label="Calcular borrador"
                    icon="i-lucide-calculator"
                    color="neutral"
                    variant="link"
                    size="sm"
                    class="px-0"
                    data-prueba="estimado-calcular"
                />
            </template>
        </div>

        <div
            v-if="estimado.notas.length"
            class="rounded-md bg-elevated/50 p-2"
            data-prueba="estimado-notas"
        >
            <UBadge
                color="warning"
                variant="subtle"
                icon="i-lucide-user-check"
                label="Confirmar con contador"
                size="sm"
            />
            <ul class="mt-1.5 flex list-disc flex-col gap-1 pl-4 text-xs text-muted">
                <li
                    v-for="nota in estimado.notas"
                    :key="nota"
                >
                    {{ nota }}
                </li>
            </ul>
        </div>
    </div>
</template>
