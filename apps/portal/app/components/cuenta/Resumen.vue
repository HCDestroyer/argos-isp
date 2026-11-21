<script setup lang="ts">
import Decimal from 'decimal.js'

/**
 * Banner de bienvenida de `/cuenta` (sistema visual: degradado índigo → cian con texto blanco, AA
 * en todo el recorrido): saludo, total pendiente y cuándo vence, el estado más urgente de los servicios como
 * pastilla (icono + texto) y la acción principal «Pagar factura». «Actualizar» es la alternativa de un
 * toque a jalar para actualizar. En las demás secciones va compacto, sin «Pagar».
 * Todo se encoge sin scroll horizontal: el nombre se recorta y el monto nunca se parte.
 */
const props = withDefaults(defineProps<{
    nombre: string
    montoAdeudado: string
    estado: EstadoServicio | null
    actualizando: boolean
    /** Inicio: más aire y la acción «Pagar factura». */
    destacado?: boolean
    /** La factura pendiente más urgente (`proximoVencimiento`): «vence el …» o «vencida desde …». */
    proxima?: { vence_en: string, vencida: boolean } | null
}>(), {
    destacado: false,
    proxima: null,
})

const emit = defineEmits<{
    actualizar: []
}>()

const conSaldo = computed(() => new Decimal(props.montoAdeudado).greaterThan(0))
const presentacion = computed(() => props.estado ? ESTADOS_SERVICIO[props.estado] : null)
</script>

<template>
    <section
        class="ax-banner"
        :class="props.destacado ? 'p-5 sm:p-7' : 'p-4 sm:px-5'"
        aria-label="Resumen de tu cuenta"
        data-testid="resumen-cuenta"
    >
        <div class="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
            <div class="min-w-0 flex-1">
                <p class="ax-banner-suave truncate text-sm">
                    Hola, <span class="font-semibold">{{ props.nombre }}</span>
                </p>
                <p
                    class="flex flex-wrap items-baseline gap-x-2"
                    :class="props.destacado ? 'mt-2' : 'mt-0.5'"
                >
                    <span class="ax-banner-suave text-xs">Total pendiente</span>
                    <span
                        class="font-semibold tracking-[-0.02em] whitespace-nowrap tabular-nums"
                        :class="props.destacado ? 'text-3xl sm:text-4xl' : 'text-2xl'"
                        data-testid="saldo-cuenta"
                    >{{ formatearQuetzales(props.montoAdeudado) }}</span>
                </p>
                <p
                    v-if="props.destacado && props.proxima && conSaldo"
                    class="ax-banner-suave mt-0.5 text-sm"
                    data-testid="banner-vence"
                >
                    {{ props.proxima.vencida ? 'Vencida desde el' : 'Por pagar · vence el' }} {{ formatearFecha(props.proxima.vence_en) }}
                </p>
                <p
                    v-if="presentacion"
                    :class="props.destacado ? 'mt-3' : 'mt-1.5'"
                >
                    <span class="ax-banner-pastilla">
                        <UIcon
                            :name="presentacion.icono"
                            class="size-3.5"
                            aria-hidden="true"
                        />
                        {{ presentacion.etiqueta }}
                    </span>
                </p>
            </div>
            <div class="flex shrink-0 items-center gap-2">
                <UButton
                    :icon="props.actualizando ? undefined : 'i-lucide-refresh-cw'"
                    :loading="props.actualizando"
                    :label="props.actualizando ? 'Actualizando…' : 'Actualizar'"
                    color="neutral"
                    variant="ghost"
                    size="sm"
                    class="ax-banner-boton rounded-full"
                    data-testid="actualizar-cuenta"
                    @click="emit('actualizar')"
                />
                <UButton
                    v-if="props.destacado && conSaldo"
                    label="Pagar factura"
                    icon="i-lucide-credit-card"
                    color="neutral"
                    size="lg"
                    to="/cuenta?seccion=pagar"
                    class="ax-banner-accion rounded-full px-5 font-semibold"
                    data-testid="banner-pagar"
                />
            </div>
        </div>
        <span
            class="sr-only"
            role="status"
        >{{ props.actualizando ? 'Actualizando tu cuenta' : '' }}</span>
    </section>
</template>
