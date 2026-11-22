<script setup lang="ts">
/** Promesas de pago del cliente (solo lectura; se solicitan desde la página de corte). */
const { items, cargando, cargado, problema, hayMas, recargar, cargarMas } = usePromesas()

onMounted(recargar)
</script>

<template>
    <CuentaEstadoLista
        :cargando="cargando"
        :cargado="cargado"
        :problema="problema"
        :vacia="items.length === 0"
        :hay-mas="hayMas"
        texto-vacio="No tienes promesas de pago"
        icono-vacio="i-lucide-calendar-check"
        @reintentar="recargar"
        @cargar-mas="cargarMas"
    >
        <PortalLista :columnas="{ concepto: 'Promesa', monto: 'Monto', estado: 'Estado' }">
            <PortalFila
                v-for="promesa in items"
                :key="promesa.id"
                :titulo="`Pagar ${formatearQuetzales(promesa.monto)}`"
                :subtitulo="`A más tardar el ${formatearFechaHora(promesa.vence_en)}`"
                icono="i-lucide-calendar-check"
                :tono="tonoDeColor(ESTADOS_PROMESA[promesa.estado].color)"
                :monto="formatearQuetzales(promesa.monto)"
                :estado="ESTADOS_PROMESA[promesa.estado]"
                data-testid="promesa"
            >
                <p
                    v-if="promesa.regla_cumplimiento === 'facturas' && promesa.facturas.length > 0"
                    class="text-xs text-muted"
                    data-testid="promesa-cubre-facturas"
                >
                    {{ textoCoberturaPromesa(promesa.facturas.length) }}
                </p>
            </PortalFila>
        </PortalLista>
    </CuentaEstadoLista>
</template>
