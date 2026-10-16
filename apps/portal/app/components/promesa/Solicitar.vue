<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { Form, FormSubmitEvent } from '@nuxt/ui'
import Decimal from 'decimal.js'

/**
 * Solicitar una promesa de pago (tarea 4), en `/corte` (servicio por IP) y en `/cuenta`
 * (`servicioId` con la sesión del portal).
 *
 * Al abrir lee los límites (`GET /portal/promesas/condiciones`) y los muestra antes de enviar.
 * La decisión es del backend: aprobada cierra el modal y la página sigue con el estado en vivo;
 * rechazada y pendiente se muestran aquí con el motivo en palabras del cliente. "Cambiar fecha o
 * monto" solo aparece si la regla que rechazó se cumple con otra fecha (`corregible`); si no (cupo,
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

const estado = reactive<DatosPromesa>({ vence_el: '', monto: '' })
let clave = claveIdempotencia()

const esquema = computed(() => esquemaPromesa(condiciones.value ?? {
    fecha_minima: null,
    fecha_maxima: null,
    monto_maximo: null,
}))
const plazo = computed(() => condiciones.value ? textoPlazo(condiciones.value) : null)
const faltaAbono = computed(() => {
    const abono = condiciones.value?.abono_inicial
    return abono && new Decimal(abono.faltante).greaterThan(0) ? abono : null
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
    estado.monto = leido.data.monto_sugerido ?? ''
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
        monto: evento.data.monto,
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
            .filter(error => error.name === 'vence_el' || error.name === 'monto')
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
                    Prometiste pagar {{ montoEnTexto(resultado.monto) }} a más tardar el
                    {{ formatearFecha(resultado.vence_en) }}. Tu servicio se reactiva en cuanto la aprueben.
                </p>
                <div class="flex flex-col gap-2 sm:flex-row-reverse">
                    <UButton
                        v-if="resultado.resultado === 'rechazada' && resultado.corregible"
                        label="Cambiar fecha o monto"
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
                        v-if="condiciones.monto_maximo"
                        class="flex gap-2"
                    >
                        <UIcon
                            name="i-lucide-wallet"
                            class="mt-0.5 size-4 shrink-0 text-muted"
                        />
                        <span>Monto: hasta {{ montoEnTexto(condiciones.monto_maximo) }} (tu saldo pendiente)</span>
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
                            {{ montoEnTexto(condiciones.abono_inicial.abonado) }}.
                        </span>
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

                <UAlert
                    v-if="faltaAbono"
                    color="warning"
                    variant="subtle"
                    icon="i-lucide-triangle-alert"
                    :title="`Te falta abonar ${montoEnTexto(faltaAbono.faltante)}`"
                    description="Paga ese abono en oficina o por depósito y luego solicita la promesa."
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
                    <UFormField
                        label="¿Cuánto vas a pagar?"
                        name="monto"
                    >
                        <UInput
                            v-model="estado.monto"
                            inputmode="decimal"
                            autocomplete="off"
                            size="xl"
                            class="w-full"
                            :ui="{ leading: 'text-muted' }"
                        >
                            <template #leading>
                                <span class="text-sm text-muted">Q</span>
                            </template>
                        </UInput>
                    </UFormField>
                    <UButton
                        type="submit"
                        label="Solicitar promesa"
                        icon="i-lucide-hand-coins"
                        size="xl"
                        block
                        :loading="enviando"
                        data-testid="promesa-enviar"
                    />
                </UForm>
            </div>
        </template>
    </UModal>
</template>
