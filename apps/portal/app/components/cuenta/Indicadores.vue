<script setup lang="ts">
import type { Schema } from '@argosisp/contracts'

/**
 * Indicadores del inicio de `/cuenta`: saldo, próximo vencimiento, plan y puntos (este último solo
 * con el programa visible: `PuntosResumen`). Todo sale de `GET /portal/cuenta` ya leído; si la cuenta
 * no se pudo leer, la página no monta este bloque (nunca se calcula sobre datos vacíos).
 */
const props = defineProps<{
    cuenta: Schema<'PortalCuenta'>
}>()

const proxima = computed(() => proximoVencimiento(props.cuenta))

const servicios = computed(() => props.cuenta.servicios.filter(s => s.estado !== 'retirado'))
const plan = computed(() => {
    if (servicios.value.length === 0) {
        return { valor: 'Sin servicios', detalle: undefined }
    }
    if (servicios.value.length > 1) {
        return { valor: `${servicios.value.length} servicios`, detalle: servicios.value.map(s => s.plan ?? 'Servicio de internet').join(' · ') }
    }
    const unico = servicios.value[0]!
    return { valor: unico.plan ?? 'Servicio de internet', detalle: unico.direccion ?? undefined }
})
</script>

<template>
    <section
        aria-label="Indicadores de tu cuenta"
        class="grid grid-cols-1 gap-3 min-[480px]:grid-cols-2 lg:grid-cols-[repeat(auto-fit,minmax(12rem,1fr))]"
        data-testid="indicadores"
    >
        <PortalKpi
            etiqueta="Saldo pendiente"
            :valor="formatearQuetzales(props.cuenta.monto_adeudado)"
            :detalle="proxima?.vencidas ? (proxima.vencidas === 1 ? '1 factura vencida' : `${proxima.vencidas} facturas vencidas`) : 'Lo que debes hoy'"
            icono="i-lucide-credit-card"
            :tono="proxima?.vencidas ? 'error' : 'primary'"
            to="/cuenta?seccion=pagar"
            data-testid="kpi-saldo"
        />
        <PortalKpi
            :etiqueta="proxima?.vencidas ? 'Vencida desde' : 'Próximo vencimiento'"
            :valor="proxima ? formatearFecha(proxima.factura.vence_en) : 'Al día'"
            icono="i-lucide-calendar-clock"
            :tono="proxima?.vencidas ? 'error' : proxima ? 'warning' : 'success'"
            data-testid="kpi-vencimiento"
        >
            <template #detalle>
                <span class="inline-flex items-center gap-1">
                    {{ proxima ? `Factura ${proxima.factura.numero} · ${formatearQuetzales(proxima.factura.saldo)}` : 'Sin facturas pendientes' }}
                    <PortalAyuda clave="vencimiento" />
                </span>
            </template>
        </PortalKpi>
        <PortalKpi
            etiqueta="Mi plan"
            :valor="plan.valor"
            :detalle="plan.detalle"
            icono="i-lucide-wifi"
            data-testid="kpi-plan"
        />
        <PuntosResumen />
    </section>
</template>
