<script setup lang="ts">
/**
 * Aviso del estado en vivo en `/corte`: mientras se consulta `GET /portal/estado`, cuando pasan
 * los 2 min sin ver el servicio activo, y en reposo un botón para que el cliente pida revisar
 * (por ejemplo, después de pagar en caja o en el banco).
 *
 * Al volver de la pasarela (`/corte?pago=<id>`, `pagoEnCurso`) habla del pago: "Procesando tu
 * pago…" mientras el cobro está pendiente, "Recibimos tu pago" cuando el webhook lo confirmó, y un
 * error claro si la pasarela lo rechazó, venció o no existe. "Ya tienes servicio" lo muestra la
 * página al ver `activo`.
 */
const props = withDefaults(defineProps<{
    vigilando?: boolean
    agotado?: boolean
    /** La página volvió de la pasarela con `?pago=<id>`. */
    pagoEnCurso?: boolean
    /** Último estado leído del cobro (null mientras no se lee). */
    pago?: PagoEnLinea | null
    /** `GET /portal/pagos/en-linea/:id` respondió 404. */
    pagoNoEncontrado?: boolean
}>(), {
    vigilando: false,
    agotado: false,
    pagoEnCurso: false,
    pago: null,
    pagoNoEncontrado: false,
})

const emit = defineEmits<{
    revisar: []
    descartarPago: []
}>()

const estadoPago = computed(() => props.pagoEnCurso ? props.pago?.estado ?? 'pendiente' : null)
/** Mientras el cobro sigue pendiente, volver a la página del proveedor (si el cliente salió sin pagar). */
const accionVolver = computed(() => props.pago?.url_pago
    ? [{ label: 'Volver a la página de pago', icon: 'i-lucide-external-link', color: 'neutral' as const, variant: 'outline' as const, to: props.pago.url_pago, external: true }]
    : [])
const accionDescartar = [{ label: 'Entendido', color: 'neutral' as const, variant: 'outline' as const, onClick: () => emit('descartarPago') }]
</script>

<template>
    <div
        aria-live="polite"
        data-testid="estado-en-vivo"
    >
        <UAlert
            v-if="pagoEnCurso && pagoNoEncontrado"
            color="warning"
            variant="subtle"
            icon="i-lucide-search-x"
            title="No encontramos ese pago"
            description="Si pagaste desde otra conexión, entra a tu cuenta para verlo. Si se te cobró, comunícate con soporte."
            :actions="accionDescartar"
            data-testid="pago-no-encontrado"
        />

        <UAlert
            v-else-if="estadoPago === 'fallido'"
            color="error"
            variant="subtle"
            icon="i-lucide-credit-card"
            title="Tu pago no se completó"
            description="El proveedor de pagos rechazó la operación y no se hizo ningún cobro. Intenta de nuevo con otra tarjeta o paga por depósito."
            :actions="accionDescartar"
            role="alert"
            data-testid="pago-fallido"
        />

        <UAlert
            v-else-if="estadoPago === 'expirado'"
            color="error"
            variant="subtle"
            icon="i-lucide-timer-off"
            title="El enlace de pago venció"
            description="No se hizo ningún cobro. Vuelve a tocar «Pagar en línea» para empezar de nuevo."
            :actions="accionDescartar"
            role="alert"
            data-testid="pago-expirado"
        />

        <UAlert
            v-else-if="vigilando && estadoPago === 'pendiente'"
            color="info"
            variant="subtle"
            icon="i-lucide-loader-circle"
            title="Procesando tu pago…"
            description="Esperamos la confirmación del proveedor de pagos. No cierres esta página: se actualiza sola."
            :actions="accionVolver"
            :ui="{ icon: 'animate-spin' }"
            data-testid="pago-procesando"
        />

        <UAlert
            v-else-if="vigilando && estadoPago === 'pagado'"
            color="success"
            variant="subtle"
            icon="i-lucide-loader-circle"
            :title="`Recibimos tu pago de ${montoEnTexto(pago?.monto)}`"
            description="Estamos reactivando tu servicio. Esta página se actualiza sola."
            :ui="{ icon: 'animate-spin' }"
            data-testid="pago-recibido"
        />

        <UAlert
            v-else-if="vigilando"
            color="info"
            variant="subtle"
            icon="i-lucide-loader-circle"
            title="Revisando tu servicio"
            description="Esta página se actualiza sola en cuanto tu servicio vuelva a estar activo."
            :ui="{ icon: 'animate-spin' }"
        />

        <UAlert
            v-else-if="agotado && estadoPago === 'pagado'"
            color="success"
            variant="subtle"
            icon="i-lucide-circle-check"
            :title="`Recibimos tu pago de ${montoEnTexto(pago?.monto)}`"
            description="Tu servicio aún no aparece activo: puede quedar saldo pendiente. Revisa de nuevo o comunícate con soporte."
            :actions="[{ label: 'Revisar de nuevo', icon: 'i-lucide-refresh-cw', color: 'neutral', variant: 'outline', onClick: () => emit('revisar') }]"
            data-testid="pago-recibido-sin-servicio"
        />

        <UAlert
            v-else-if="agotado && estadoPago === 'pendiente'"
            color="neutral"
            variant="subtle"
            icon="i-lucide-clock"
            title="Aún no recibimos la confirmación de tu pago"
            description="Si ya pagaste, puede tardar unos minutos. Revisa de nuevo o comunícate con soporte."
            :actions="[{ label: 'Revisar de nuevo', icon: 'i-lucide-refresh-cw', color: 'neutral', variant: 'outline', onClick: () => emit('revisar') }, ...accionVolver]"
            data-testid="pago-sin-confirmar"
        />

        <UAlert
            v-else-if="agotado"
            color="neutral"
            variant="subtle"
            icon="i-lucide-clock"
            title="Aún no vemos tu servicio activo"
            description="Si ya pagaste, puede tardar unos minutos. Revisa de nuevo o comunícate con soporte."
            :actions="[{ label: 'Revisar de nuevo', icon: 'i-lucide-refresh-cw', color: 'neutral', variant: 'outline', onClick: () => emit('revisar') }]"
        />

        <UButton
            v-else
            label="Ya pagué: revisar mi servicio"
            icon="i-lucide-refresh-cw"
            color="neutral"
            variant="link"
            block
            @click="emit('revisar')"
        />
    </div>
</template>
