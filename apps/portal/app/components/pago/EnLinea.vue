<script setup lang="ts">
/**
 * Botón "Pagar en línea" de `/corte` y `/cuenta` (semana 2).
 *
 * `POST /portal/pagos/iniciar` crea el cobro en la pasarela (A3) por lo vencido del servicio (o lo
 * pendiente si nada está vencido) y devuelve la página de pago del proveedor. Antes de ir, la URL
 * pasa a `/corte?pago=<id>`: al volver, el estado en vivo espera la confirmación del webhook.
 *
 * Habilitado solo si `GET /portal/empresa` dice `pago_en_linea` (hay pasarela). Mientras carga se
 * ve deshabilitado; sin pasarela, apagado con la alternativa (oficina o depósito).
 *
 * `Idempotency-Key`: la misma clave en los reintentos de un intento que no llegó (sin conexión);
 * una nueva cuando la API respondió.
 */
const props = withDefaults(defineProps<{
    /** Con la sesión del portal (`/cuenta`); sin él, el servicio de la IP de origen (`/corte`). */
    servicioId?: number
    /** id único del texto de ayuda (hay un botón en `/corte` y otro en `/cuenta`) */
    idAyuda?: string
    /** Empresa del servicio (`/cuenta`); sin ella, la que decide la API (la de la IP en `/corte`). */
    empresaId?: number
}>(), {
    servicioId: undefined,
    empresaId: undefined,
    idAyuda: 'pagar-en-linea-ayuda',
})

const { empresa, cargando } = useEmpresa({ empresaId: () => props.empresaId })
const { iniciar } = usePagoEnLinea()

const disponible = computed(() => empresa.value?.pago_en_linea === true)
const yendo = ref(false)
const error = ref<string | null>(null)
let clave = claveIdempotencia()

async function pagar() {
    yendo.value = true
    error.value = null
    const respuesta = await iniciar(props.servicioId ? { servicio_id: props.servicioId } : {}, clave)
    if (!respuesta.ok) {
        yendo.value = false
        if (respuesta.problema.status !== 0) {
            clave = claveIdempotencia()
        }
        error.value = mensajeProblema(respuesta.problema)
        return
    }
    const { id, url_pago: url } = respuesta.data
    if (!url) {
        yendo.value = false
        clave = claveIdempotencia()
        error.value = 'No pudimos abrir la página de pago. Intenta de nuevo en unos minutos.'
        return
    }
    // Se queda "cargando" hasta que el navegador cambie de página.
    salirALaPasarela({ id, url_pago: url })
}
</script>

<template>
    <div class="flex flex-col gap-2">
        <UButton
            data-testid="pagar-en-linea"
            label="Pagar en línea"
            icon="i-lucide-credit-card"
            :color="disponible || cargando ? 'primary' : 'neutral'"
            :variant="disponible || cargando ? 'solid' : 'soft'"
            size="xl"
            block
            :disabled="!disponible"
            :loading="yendo"
            :aria-describedby="props.idAyuda"
            @click="pagar"
        />
        <p
            :id="props.idAyuda"
            class="-mt-1 text-center text-xs text-muted"
        >
            <template v-if="disponible || cargando">
                Con tarjeta, en la página segura de nuestro proveedor de pagos.
            </template>
            <template v-else>
                El pago en línea no está disponible ahora. Paga en nuestra oficina o por depósito.
            </template>
        </p>
        <UAlert
            v-if="error"
            color="error"
            variant="subtle"
            icon="i-lucide-circle-alert"
            title="No pudimos iniciar el pago"
            :description="error"
            role="alert"
            data-testid="pagar-en-linea-error"
        />
    </div>
</template>
