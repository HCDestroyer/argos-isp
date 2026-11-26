<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'

/**
 * Indicador de contabilidad (tablero PlanIndicadorAyuda; reemplaza a `ContaKpi`): el mismo patrón
 * para todo número de Finanzas, Cartera y Reportes.
 * 1. Nombre en palabras de todos. 2. «?» en la esquina: abre la ayuda sin salir de la pantalla.
 * 3. El número, uno solo y grande. 4. Estado con ícono, texto y color (nunca solo color).
 * 5. Una línea de contexto. 6. Con `to`, toda la tarjeta lleva al detalle (si hay permiso).
 * Cinco estados: bien, atención, urgente (`estado`), sin datos (`sinDatos`) y error con
 * «Reintentar» (`problema`, nunca una cifra inventada). `valor` null mientras carga (esqueleto).
 */
const props = withDefaults(defineProps<{
    /** Su ayuda «?»; sin clave no lleva ayuda. */
    clave?: ClaveIndicador
    /** Por defecto, el título de su ayuda. */
    titulo?: string
    icono: string
    tono?: string
    valor: string | null
    estado?: EstadoIndicador
    /** Texto de la pastilla de estado si no es el de fábrica («Vencido hace 3 días»). */
    etiquetaEstado?: string
    /** Pastilla de variación sin estado (un porcentaje): neutral, o bien/urgente por su tono. */
    variacion?: string
    tonoVariacion?: 'exito' | 'error' | 'neutral'
    detalle?: string
    /** Insignia junto al título (p. ej. «82 % del límite»). */
    insignia?: string
    problema?: Problem | null
    /** Sin datos todavía o no aplica: lo que se dice en lugar de la cifra. */
    sinDatos?: string
    tituloSinDatos?: string
    /** Hacia dónde lleva la tarjeta entera. */
    to?: string
}>(), {
    clave: undefined,
    titulo: undefined,
    tono: 'tono-marca',
    estado: undefined,
    etiquetaEstado: undefined,
    variacion: undefined,
    tonoVariacion: 'neutral',
    detalle: undefined,
    insignia: undefined,
    problema: null,
    sinDatos: undefined,
    tituloSinDatos: 'Aún sin datos',
    to: undefined,
})

const emit = defineEmits<{
    reintentar: []
}>()

const { puedeAbrir } = usePermisos()

const nombre = computed(() => props.titulo ?? (props.clave ? AYUDA_INDICADORES[props.clave].titulo : ''))
const enlace = computed(() => (props.to && puedeAbrir(props.to) ? props.to : undefined))

/** La pastilla: un estado con su ícono, o una variación (número) con el ícono de su tono. */
const pastilla = computed(() => {
    if (props.estado) {
        const e = ESTADOS_INDICADOR[props.estado]
        return { etiqueta: props.etiquetaEstado ?? e.etiqueta, icono: e.icono, color: e.color }
    }
    if (props.variacion) {
        const color = props.tonoVariacion === 'exito' ? 'success' : props.tonoVariacion === 'error' ? 'error' : 'neutral'
        return { etiqueta: props.variacion, icono: undefined, color } as const
    }
    return null
})
</script>

<template>
    <div
        class="surface-card relative flex min-w-0 flex-col gap-2 rounded-2xl p-4"
        :class="problema ? 'ring-1 ring-error/40' : enlace ? 'transition-colors hover:bg-(--ax-fila-hover)' : ''"
        data-prueba="kpi-conta"
        :data-estado="problema ? 'error' : sinDatos ? 'sin-datos' : valor === null ? 'cargando' : (estado ?? 'normal')"
    >
        <div class="flex min-w-0 items-center gap-2 border-b border-(--ax-borde) pb-2.5">
            <span
                class="pastilla-icono pastilla-tono size-7 shrink-0 rounded-lg"
                :class="problema ? 'tono-error' : tono"
            >
                <UIcon
                    :name="problema ? 'i-lucide-circle-x' : icono"
                    class="size-4"
                />
            </span>
            <ULink
                v-if="enlace"
                :to="enlace"
                class="min-w-0 flex-1 line-clamp-2 text-[0.8125rem] leading-tight font-medium text-default after:absolute after:inset-0 after:content-['']"
                data-prueba="kpi-enlace"
            >
                {{ nombre }}
            </ULink>
            <span
                v-else
                class="min-w-0 flex-1 line-clamp-2 text-[0.8125rem] leading-tight font-medium text-default"
            >{{ nombre }}</span>
            <UBadge
                v-if="insignia"
                :label="insignia"
                color="warning"
                variant="soft"
                size="sm"
            />
            <IndicadorAyuda
                v-if="clave"
                :clave="clave"
                class="relative z-10"
            />
        </div>

        <template v-if="problema">
            <span class="text-base font-semibold text-error">No se pudo leer</span>
            <UButton
                label="Reintentar"
                icon="i-lucide-refresh-cw"
                color="neutral"
                variant="link"
                size="xs"
                class="relative z-10 self-start px-0"
                @click="emit('reintentar')"
            />
        </template>
        <template v-else-if="sinDatos">
            <span class="text-base font-semibold text-muted">{{ tituloSinDatos }}</span>
            <span
                class="text-xs text-muted"
                data-prueba="kpi-sin-datos"
            >{{ sinDatos }}</span>
        </template>
        <USkeleton
            v-else-if="valor === null"
            class="h-8 w-32"
        />
        <template v-else>
            <span class="text-xl leading-tight font-bold tracking-[-0.02em] text-highlighted tabular-nums sm:text-[1.625rem]">{{ valor }}</span>
            <span
                v-if="pastilla || detalle"
                class="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted"
            >
                <UBadge
                    v-if="pastilla"
                    :label="pastilla.etiqueta"
                    :icon="pastilla.icono"
                    :color="pastilla.color"
                    variant="soft"
                    size="sm"
                    class="tabular-nums"
                    data-prueba="kpi-estado"
                />
                <span class="min-w-0">{{ detalle }}</span>
            </span>
        </template>
    </div>
</template>
