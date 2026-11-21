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

/** Los pasos, al lado del formulario en escritorio y debajo en pantallas angostas. */
const PASOS = [
    { icono: 'i-lucide-landmark', titulo: 'Paga en el banco', texto: 'Depósito, transferencia o ACH a una de nuestras cuentas.' },
    { icono: 'i-lucide-camera', titulo: 'Toma la foto', texto: 'Que se lean el monto, la fecha y la referencia.' },
    { icono: 'i-lucide-upload', titulo: 'Súbela aquí', texto: 'La revisamos con el estado de cuenta del banco.' },
    { icono: 'i-lucide-wifi', titulo: 'Listo', texto: 'Al aprobarla se abona a tus facturas y, si estabas suspendido, vuelve tu servicio.' },
] as const
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
        <div class="grid gap-6 lg:grid-cols-3 lg:items-start">
            <UCard class="min-w-0 lg:col-span-2">
                <ComprobanteFormulario
                    :servicio-id="servicioId"
                    :empresa-id="empresaId"
                    @enviado="enviado"
                    @listo="navigateTo(volver)"
                />
            </UCard>
            <aside
                class="ax-tarjeta flex flex-col gap-4 p-5"
                aria-labelledby="comprobante-pasos"
            >
                <h2
                    id="comprobante-pasos"
                    class="flex items-center gap-1 font-semibold text-highlighted"
                >
                    Cómo funciona
                    <PortalAyuda clave="comprobante" />
                </h2>
                <ol class="flex flex-col gap-4">
                    <li
                        v-for="(paso, indice) in PASOS"
                        :key="paso.titulo"
                        class="flex items-start gap-3"
                    >
                        <PortalPastilla
                            :icono="paso.icono"
                            tamano="sm"
                        />
                        <span class="min-w-0">
                            <span class="block text-sm font-medium text-highlighted">{{ indice + 1 }}. {{ paso.titulo }}</span>
                            <span class="block text-xs text-muted">{{ paso.texto }}</span>
                        </span>
                    </li>
                </ol>
            </aside>
        </div>
    </div>
</template>
