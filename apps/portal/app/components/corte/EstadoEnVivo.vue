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
 *
 * `estadoProveedor` es lo que dijo el proveedor en la URL de retorno (`?estado=pagado|fallido`):
 * se muestra de inmediato ("Tu pago fue aprobado" / "Tu pago no se completó") mientras llega el
 * webhook. Lo que diga el cobro en la API (`pago.estado` distinto de `pendiente`) manda siempre.
 */
const props = withDefaults(defineProps<{
    vigilando?: boolean
    agotado?: boolean
    /** La página volvió de la pasarela con `?pago=<id>`. */
    pagoEnCurso?: boolean
    /** Último estado leído del cobro (null mientras no se lee). */
    pago?: PagoEnLinea | null
    /** `?estado=` con que volvió de la pasarela (null si no vino o no se reconoce). */
    estadoProveedor?: EstadoRetornoPago | null
    /** `GET /portal/pagos/en-linea/:id` respondió 404. */
    pagoNoEncontrado?: boolean
    /** Las últimas consultas de estado (o del pago) fallaron: sin red, API caída o 429. */
    sinRespuesta?: boolean
}>(), {
    vigilando: false,
    agotado: false,
    pagoEnCurso: false,
    pago: null,
    estadoProveedor: null,
    pagoNoEncontrado: false,
    sinRespuesta: false,
})

const emit = defineEmits<{
    revisar: []
    descartarPago: []
}>()

/**
 * Estado del pago que se muestra: el del cobro en la API si ya no está pendiente; si sigue
 * pendiente (el webhook no llegó), lo que dijo el proveedor al volver (`confirmando` = aprobado
 * por el proveedor, aún sin registrar).
 */
const estadoPago = computed<EstadoPagoVisible | null>(() => {
    if (!props.pagoEnCurso) {
        return null
    }
    const enApi = props.pago?.estado ?? 'pendiente'
    if (enApi !== 'pendiente') {
        return enApi
    }
    if (props.estadoProveedor === 'fallido') {
        return 'fallido'
    }
    return props.estadoProveedor === 'pagado' ? 'confirmando' : 'pendiente'
})
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
            :color="ESTADOS_PAGO_EN_LINEA.fallido.color"
            variant="subtle"
            :icon="ESTADOS_PAGO_EN_LINEA.fallido.icono"
            title="Tu pago no se completó"
            description="El proveedor de pagos rechazó la operación y no se hizo ningún cobro. Intenta de nuevo con otra tarjeta o paga por depósito."
            :actions="accionDescartar"
            role="alert"
            data-testid="pago-fallido"
        />

        <UAlert
            v-else-if="estadoPago === 'expirado'"
            :color="ESTADOS_PAGO_EN_LINEA.expirado.color"
            variant="subtle"
            :icon="ESTADOS_PAGO_EN_LINEA.expirado.icono"
            title="El enlace de pago venció"
            description="No se hizo ningún cobro. Vuelve a tocar «Pagar en línea» para empezar de nuevo."
            :actions="accionDescartar"
            role="alert"
            data-testid="pago-expirado"
        />

        <UAlert
            v-else-if="vigilando && sinRespuesta"
            color="warning"
            variant="subtle"
            icon="i-lucide-wifi-off"
            title="No logramos consultar tu servicio"
            description="El sistema no responde en este momento. Seguimos intentando; no hace falta que recargues."
            data-testid="estado-sin-respuesta"
        />

        <UAlert
            v-else-if="agotado && sinRespuesta"
            color="error"
            variant="subtle"
            icon="i-lucide-cloud-off"
            title="No pudimos consultar el estado de tu servicio"
            description="El sistema no respondió. Si ya pagaste, tu pago no se pierde: intenta de nuevo en unos minutos o comunícate con soporte."
            :actions="[{ label: 'Reintentar', icon: 'i-lucide-refresh-cw', color: 'error', variant: 'outline', onClick: () => emit('revisar') }]"
            role="alert"
            data-testid="estado-sin-respuesta-agotado"
        />

        <UAlert
            v-else-if="vigilando && estadoPago === 'pendiente'"
            :color="ESTADOS_PAGO_EN_LINEA.pendiente.color"
            variant="subtle"
            icon="i-lucide-loader-circle"
            title="Procesando tu pago…"
            description="Esperamos la confirmación del proveedor de pagos. No cierres esta página: se actualiza sola."
            :actions="accionVolver"
            :ui="{ icon: 'animate-spin' }"
            data-testid="pago-procesando"
        />

        <UAlert
            v-else-if="vigilando && estadoPago === 'confirmando'"
            :color="ESTADOS_PAGO_EN_LINEA.confirmando.color"
            variant="subtle"
            icon="i-lucide-loader-circle"
            title="Tu pago fue aprobado"
            description="Estamos registrándolo y reactivando tu servicio. No cierres esta página: se actualiza sola."
            :ui="{ icon: 'animate-spin' }"
            data-testid="pago-aprobado"
        />

        <UAlert
            v-else-if="vigilando && estadoPago === 'pagado'"
            :color="ESTADOS_PAGO_EN_LINEA.pagado.color"
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
            :color="ESTADOS_PAGO_EN_LINEA.pagado.color"
            variant="subtle"
            :icon="ESTADOS_PAGO_EN_LINEA.pagado.icono"
            :title="`Recibimos tu pago de ${montoEnTexto(pago?.monto)}`"
            description="Tu servicio aún no aparece activo: puede quedar saldo pendiente. Revisa de nuevo o comunícate con soporte."
            :actions="[{ label: 'Revisar de nuevo', icon: 'i-lucide-refresh-cw', color: 'neutral', variant: 'outline', onClick: () => emit('revisar') }]"
            data-testid="pago-recibido-sin-servicio"
        />

        <UAlert
            v-else-if="agotado && estadoPago === 'confirmando'"
            color="warning"
            variant="subtle"
            icon="i-lucide-clock"
            title="Tu pago fue aprobado, pero aún no lo vemos registrado"
            description="No vuelvas a pagar: puede tardar unos minutos. Revisa de nuevo o comunícate con soporte."
            :actions="[{ label: 'Revisar de nuevo', icon: 'i-lucide-refresh-cw', color: 'neutral', variant: 'outline', onClick: () => emit('revisar') }]"
            data-testid="pago-aprobado-sin-confirmar"
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
