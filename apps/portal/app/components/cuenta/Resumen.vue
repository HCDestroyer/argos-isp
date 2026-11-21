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
    /** Facturas vencidas (`proximoVencimiento`): se dicen junto al vencimiento, no en otra tarjeta. */
    vencidas?: number
}>(), {
    destacado: false,
    proxima: null,
    vencidas: 0,
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
        <!--
            En el teléfono todo se apila (saludo, monto, vencimiento; estado y «Actualizar» en una
            fila que hace wrap; «Pagar factura» a lo ancho). Desde 640 px el texto va a la izquierda y
            las acciones a la derecha. Nada se recorta: el nombre largo hace wrap.
        -->
        <div class="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between sm:gap-6">
            <div class="min-w-0">
                <p
                    class="ax-banner-suave text-sm break-words"
                    data-testid="banner-saludo"
                >
                    Hola, <span class="font-semibold">{{ props.nombre }}</span>
                </p>
                <p
                    class="flex flex-wrap items-baseline gap-x-2"
                    :class="props.destacado ? 'mt-2' : 'mt-0.5'"
                >
                    <span
                        class="ax-banner-suave text-xs whitespace-nowrap"
                        data-testid="banner-total-etiqueta"
                    >Total pendiente</span>
                    <span
                        class="font-semibold tracking-[-0.02em] whitespace-nowrap tabular-nums"
                        :class="props.destacado ? 'text-3xl sm:text-4xl' : 'text-2xl'"
                        data-testid="saldo-cuenta"
                    >{{ formatearQuetzales(props.montoAdeudado) }}</span>
                </p>
                <p
                    v-if="props.destacado && props.proxima && conSaldo"
                    class="ax-banner-suave mt-0.5 text-sm whitespace-nowrap"
                    data-testid="banner-vence"
                >
                    {{ props.proxima.vencida ? 'Vencida desde el' : 'Por pagar · vence el' }} {{ formatearFecha(props.proxima.vence_en) }}
                </p>
                <p
                    v-if="props.destacado && props.vencidas > 0"
                    class="ax-banner-suave text-sm whitespace-nowrap"
                    data-testid="banner-vencidas"
                >
                    {{ props.vencidas === 1 ? '1 factura vencida' : `${props.vencidas} facturas vencidas` }}
                </p>
            </div>
            <div class="flex flex-col gap-3 sm:shrink-0 sm:items-end">
                <div class="flex flex-wrap items-center gap-x-3 gap-y-2">
                    <span
                        v-if="presentacion"
                        class="ax-banner-pastilla"
                        data-testid="banner-estado"
                    >
                        <UIcon
                            :name="presentacion.icono"
                            class="size-3.5"
                            aria-hidden="true"
                        />
                        {{ presentacion.etiqueta }}
                    </span>
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
                </div>
                <UButton
                    v-if="props.destacado && conSaldo"
                    label="Pagar factura"
                    icon="i-lucide-credit-card"
                    color="neutral"
                    size="lg"
                    to="/cuenta?seccion=pagar"
                    class="ax-banner-accion w-full rounded-full px-5 font-semibold sm:w-auto"
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
