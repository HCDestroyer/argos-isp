<script setup lang="ts">
/**
 * Subir comprobante de pago: página propia (criterio del PM: un formulario con archivo y vista
 * previa necesita su espacio y su URL, no un modal). Se llega desde `/corte` (cliente por IP) y desde
 * `/cuenta` (con sesión), y «Listo» o «Volver» regresan al mismo lugar.
 *
 * Query: `servicio` y `empresa` (los del grupo de `/cuenta`; en `/corte` los decide la IP) y
 * `volver` (`/corte` o `/cuenta?seccion=pagar`; cualquier otra cosa vuelve a `/corte`). El
 * comprobante enviado queda en `useComprobanteEnviado` para que `/corte` lo muestre y vigile el estado.
 */
const route = useRoute()
const { nombre: nombreEmpresa } = useEmpresa()

function entero(valor: unknown): number | undefined {
    const texto = Array.isArray(valor) ? valor[0] : valor
    return typeof texto === 'string' && /^[1-9]\d{0,15}$/.test(texto) ? Number(texto) : undefined
}

const servicioId = computed(() => entero(route.query.servicio))
const empresaId = computed(() => entero(route.query.empresa))
const volver = computed(() => route.query.volver === '/cuenta?seccion=pagar' ? '/cuenta?seccion=pagar' : '/corte')

const enviadoAqui = useComprobanteEnviado()

function enviado(comprobante: ComprobantePortal) {
    enviadoAqui.value = comprobante
}

useHead({ title: computed(() => `Subir comprobante · ${nombreEmpresa.value}`) })
</script>

<template>
    <div class="flex flex-col gap-4">
        <UButton
            :to="volver"
            label="Volver"
            icon="i-lucide-arrow-left"
            color="neutral"
            variant="ghost"
            class="-ms-3 self-start"
            data-testid="comprobante-volver"
        />
        <div class="flex items-start gap-3">
            <PortalPastilla
                icono="i-lucide-upload"
                tamano="lg"
            />
            <div class="min-w-0">
                <h1 class="text-2xl font-semibold text-highlighted">
                    Subir comprobante de pago
                </h1>
                <p class="mt-1 text-sm text-muted">
                    Lo revisamos y, al aprobarlo, abonamos el pago a tu cuenta y reactivamos tu servicio.
                </p>
            </div>
        </div>
        <UCard>
            <ComprobanteFormulario
                :servicio-id="servicioId"
                :empresa-id="empresaId"
                @enviado="enviado"
                @listo="navigateTo(volver)"
            />
        </UCard>
    </div>
</template>
