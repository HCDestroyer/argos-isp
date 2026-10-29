<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { Form, FormSubmitEvent } from '@nuxt/ui'
import Decimal from 'decimal.js'

/**
 * Solicitar una promesa de pago (tarea 4), en `/corte` (servicio por IP) y en `/cuenta`
 * (`servicioId` con la sesión del portal).
 *
 * Al abrir lee los límites (`GET /portal/promesas/condiciones`) y los muestra antes de enviar.
 * La promesa cubre todo lo vencido: el cliente solo elige la fecha; el monto y las facturas que
 * cubre los calcula Argos (`monto_promesa`, `facturas`) y se cumple cuando todas quedan pagadas.
 * La decisión es del backend: aprobada cierra el modal y la página sigue con el estado en vivo;
 * rechazada y pendiente se muestran aquí con el motivo en palabras del cliente. "Cambiar fecha"
 * solo aparece si la regla que rechazó se cumple con otra fecha (`corregible`); si no (cupo,
 * historial, deuda), se ofrece el contacto.
 *
 * `Idempotency-Key`: la misma clave en los reintentos de un envío que no llegó (sin conexión); una
 * nueva cuando la API respondió.
 */
const props = withDefaults(defineProps<{
    servicioId?: number
}>(), {
    servicioId: undefined,
})

const emit = defineEmits<{
    resultado: [promesa: PromesaSolicitada]
}>()

const open = defineModel<boolean>('open', { default: false })

const { condiciones: leerCondiciones, solicitar } = useSolicitudPromesa()

const cargando = ref(false)
const condiciones = ref<CondicionesPromesa | null>(null)
const problemaCondiciones = ref<Problem | null>(null)
const resultado = ref<PromesaSolicitada | null>(null)
const errorEnvio = ref<string | null>(null)
const enviando = ref(false)
const formulario = useTemplateRef<Form<DatosPromesa>>('formulario')

const estado = reactive<DatosPromesa>({ vence_el: '' })
let clave = claveIdempotencia()

const esquema = computed(() => esquemaPromesa(condiciones.value ?? {
    fecha_minima: null,
    fecha_maxima: null,
}))
/** Solo se ofrece con algo vencido que cubrir. */
const conVencido = computed(() => hayVencidoQuePrometer(condiciones.value))
const plazo = computed(() => condiciones.value ? textoPlazo(condiciones.value) : null)
/** Lo que hay que pagar antes de prometer (de `limitesPromesa()` de A3): mientras sea > 0 no se envía. */
const pagoPrevio = computed(() => {
    const previo = condiciones.value?.pago_previo
    return previo && new Decimal(previo).greaterThan(0) ? previo : null
})

async function cargar() {
    cargando.value = true
    problemaCondiciones.value = null
    resultado.value = null
    errorEnvio.value = null
    const leido = await leerCondiciones(props.servicioId)
    cargando.value = false
    if (!leido.ok) {
        condiciones.value = null
        problemaCondiciones.value = leido.problema
        return
    }
    condiciones.value = leido.data
    estado.vence_el = leido.data.fecha_maxima ?? ''
    clave = claveIdempotencia()
}

watch(open, (abierto) => {
    if (abierto) {
        void cargar()
    }
}, { immediate: true })

async function enviar(evento: FormSubmitEvent<DatosPromesa>) {
    enviando.value = true
    errorEnvio.value = null
    const respuesta = await solicitar({
        vence_el: evento.data.vence_el,
        ...(props.servicioId ? { servicio_id: props.servicioId } : {}),
    }, clave)
    enviando.value = false

    if (!respuesta.ok) {
        const { problema } = respuesta
        // Sin respuesta de la API: el reintento lleva la misma clave.
        if (problema.status !== 0) {
            clave = claveIdempotencia()
        }
        const errores = erroresDeFormulario(problema)
            .map(error => error.name === 'vence_en' ? { ...error, name: 'vence_el' } : error)
            .filter(error => error.name === 'vence_el')
        if (errores.length > 0) {
            formulario.value?.setErrors(errores)
        }
        else {
            errorEnvio.value = mensajeProblema(problema)
        }
        return
    }

    clave = claveIdempotencia()
    emit('resultado', respuesta.data)
    if (respuesta.data.resultado === 'aprobada') {
        open.value = false
        return
    }
    resultado.value = respuesta.data
}

function corregir() {
    resultado.value = null
}
</script>

<template>
    <UModal
        v-model:open="open"
        title="Solicitar promesa de pago"
        description="Elige el día en que vas a pagar. Si se aprueba, tu servicio se reactiva de inmediato."
    >
        <template #body>
            <div
                v-if="cargando"
                class="flex flex-col gap-3"
            >
                <USkeleton class="h-16 w-full" />
                <USkeleton class="h-10 w-full" />
                <USkeleton class="h-10 w-full" />
            </div>

            <UAlert
                v-else-if="problemaCondiciones"
                color="error"
                variant="subtle"
                icon="i-lucide-cloud-off"
                title="No pudimos revisar si puedes pedir una promesa"
                :description="mensajeProblema(problemaCondiciones)"
                :actions="[{ label: 'Reintentar', icon: 'i-lucide-refresh-cw', color: 'error', variant: 'outline', onClick: () => cargar() }]"
                data-testid="promesa-error-condiciones"
            />

            <div
                v-else-if="resultado"
                class="flex flex-col gap-4"
                aria-live="polite"
            >
                <UAlert
                    v-if="resultado.resultado === 'rechazada'"
                    color="error"
                    variant="subtle"
                    icon="i-lucide-circle-x"
                    title="No pudimos aprobar tu promesa"
                    :description="resultado.motivo"
                    data-testid="promesa-rechazada"
                />
                <UAlert
                    v-else
                    color="warning"
                    variant="subtle"
                    icon="i-lucide-hourglass"
                    title="Tu promesa está pendiente de aprobación"
                    :description="resultado.motivo"
                    data-testid="promesa-pendiente"
                />
                <p
                    v-if="resultado.resultado === 'pendiente_aprobacion'"
                    class="text-sm text-muted"
                >
                    Prometiste pagar {{ montoEnTexto(resultado.monto) }} (todo lo vencido) a más tardar el
                    {{ formatearFecha(resultado.vence_en) }}. Tu servicio se reactiva en cuanto la aprueben.
                </p>
                <div class="flex flex-col gap-2 sm:flex-row-reverse">
                    <UButton
                        v-if="resultado.resultado === 'rechazada' && resultado.corregible"
                        label="Cambiar fecha"
                        icon="i-lucide-pencil"
                        size="lg"
                        block
                        data-testid="promesa-corregir"
                        @click="corregir"
                    />
                    <UButton
                        v-else-if="resultado.resultado === 'rechazada'"
                        label="Contactar a la oficina"
                        icon="i-lucide-phone"
                        to="/contacto"
                        size="lg"
                        block
                        data-testid="promesa-contacto"
                        @click="open = false"
                    />
                    <UButton
                        :label="resultado.resultado === 'rechazada' ? 'Cerrar' : 'Listo'"
                        color="neutral"
                        :variant="resultado.resultado === 'rechazada' ? 'outline' : 'solid'"
                        size="lg"
                        block
                        @click="open = false"
                    />
                </div>
            </div>

            <UAlert
                v-else-if="condiciones && condiciones.disponible && !conVencido"
                color="neutral"
                variant="subtle"
                icon="i-lucide-info"
                title="No necesitas una promesa de pago"
                description="No tienes facturas vencidas. Las que no han vencido se pagan en su fecha."
                data-testid="promesa-sin-vencido"
            />

            <UAlert
                v-else-if="condiciones && !condiciones.disponible"
                color="neutral"
                variant="subtle"
                icon="i-lucide-info"
                title="No puedes solicitar una promesa ahora"
                :description="condiciones.promesa_abierta
                    ? `${condiciones.motivo} Pagarás ${montoEnTexto(condiciones.promesa_abierta.monto)} a más tardar el ${formatearFecha(condiciones.promesa_abierta.vence_en)}.`
                    : condiciones.motivo ?? undefined"
                data-testid="promesa-no-disponible"
            />

            <div
                v-else-if="condiciones"
                class="flex flex-col gap-4"
            >
                <ul
                    class="flex flex-col gap-2 rounded-lg border border-default p-3 text-sm"
                    data-testid="promesa-limites"
                >
                    <li
                        v-if="plazo"
                        class="flex gap-2"
                    >
                        <UIcon
                            name="i-lucide-calendar-clock"
                            class="mt-0.5 size-4 shrink-0 text-muted"
                        />
                        <span>Fecha de pago: {{ plazo }}</span>
                    </li>
                    <li
                        v-if="condiciones.abono_inicial"
                        class="flex gap-2"
                    >
                        <UIcon
                            name="i-lucide-hand-coins"
                            class="mt-0.5 size-4 shrink-0 text-muted"
                        />
                        <span>
                            Antes de prometer debes abonar el {{ condiciones.abono_inicial.porcentaje }}% de tu deuda
                            ({{ montoEnTexto(condiciones.abono_inicial.requerido) }}); llevas
                            {{ montoEnTexto(condiciones.abono_inicial.abonado) }}<template v-if="condiciones.abono_inicial.faltante !== '0.00'">
                                y te faltan {{ montoEnTexto(condiciones.abono_inicial.faltante) }}</template>.
                        </span>
                    </li>
                    <li
                        v-if="condiciones.deuda_maxima"
                        class="flex gap-2"
                    >
                        <UIcon
                            name="i-lucide-scale"
                            class="mt-0.5 size-4 shrink-0 text-muted"
                        />
                        <span>Saldo vencido máximo para prometer: {{ montoEnTexto(condiciones.deuda_maxima.maximo) }}</span>
                    </li>
                    <li
                        v-if="condiciones.requiere_aprobacion"
                        class="flex gap-2"
                    >
                        <UIcon
                            name="i-lucide-user-check"
                            class="mt-0.5 size-4 shrink-0 text-muted"
                        />
                        <span>Un asesor revisa la solicitud antes de aprobarla.</span>
                    </li>
                </ul>

                <div
                    class="flex flex-col gap-3 rounded-lg bg-elevated p-3"
                    data-testid="promesa-cubre"
                >
                    <p class="font-medium text-highlighted">
                        Prometes pagar {{ montoEnTexto(condiciones.monto_promesa) }} (todo lo vencido)
                    </p>
                    <ul
                        class="flex flex-col gap-1 text-sm"
                        aria-label="Facturas que cubre la promesa"
                    >
                        <li
                            v-for="factura in condiciones.facturas"
                            :key="factura.factura_id"
                            class="flex items-baseline justify-between gap-3"
                            data-testid="promesa-factura"
                        >
                            <span class="min-w-0">
                                {{ conceptoCubierta(factura) }}
                                <span class="text-muted">· venció el {{ formatearFecha(factura.vence_en) }}</span>
                            </span>
                            <span class="shrink-0 tabular-nums text-highlighted">{{ montoEnTexto(factura.monto) }}</span>
                        </li>
                    </ul>
                    <p class="text-sm text-muted">
                        Tu promesa se cumple cuando pagas todas estas facturas a más tardar el día que elijas.
                        Si solo pagas una parte, la promesa no se cumple.
                    </p>
                </div>

                <UAlert
                    v-if="pagoPrevio"
                    color="warning"
                    variant="subtle"
                    icon="i-lucide-triangle-alert"
                    :title="`Antes de prometer debes pagar ${montoEnTexto(pagoPrevio)}`"
                    :description="textoPagoPrevio(condiciones)"
                    data-testid="promesa-falta-abono"
                />

                <UAlert
                    v-if="errorEnvio"
                    color="error"
                    variant="subtle"
                    icon="i-lucide-circle-alert"
                    :title="errorEnvio"
                    data-testid="promesa-error-envio"
                />

                <UForm
                    ref="formulario"
                    :schema="esquema"
                    :state="estado"
                    class="flex flex-col gap-4"
                    @submit="enviar"
                >
                    <UFormField
                        label="¿Qué día vas a pagar?"
                        name="vence_el"
                        help="Mantienes tu servicio hasta ese día; paga todo lo vencido a más tardar en esa fecha."
                        required
                    >
                        <UInput
                            v-model="estado.vence_el"
                            type="date"
                            :min="condiciones.fecha_minima ?? undefined"
                            :max="condiciones.fecha_maxima ?? undefined"
                            size="xl"
                            class="w-full"
                        />
                    </UFormField>
                    <UButton
                        type="submit"
                        label="Solicitar promesa"
                        icon="i-lucide-hand-coins"
                        size="xl"
                        block
                        :loading="enviando"
                        :disabled="pagoPrevio !== null"
                        data-testid="promesa-enviar"
                    />
                </UForm>
            </div>
        </template>
    </UModal>
</template>
