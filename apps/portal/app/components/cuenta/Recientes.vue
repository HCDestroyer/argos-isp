<script setup lang="ts">
/**
 * Lo último del inicio de `/cuenta`: las facturas y los pagos más recientes (las mismas listas de
 * «Facturas» y «Pagar», recortadas) con «Ver todas». En escritorio va en la columna lateral; en
 * pantallas angostas, debajo de los servicios. Cada lista tiene su error con «Reintentar».
 */
const facturas = useFacturas()
const pagos = usePagos()

onMounted(() => {
    void facturas.recargar()
    void pagos.recargar()
})

const ultimasFacturas = computed(() => facturas.items.value.slice(0, 4))
const ultimosPagos = computed(() => pagos.items.value.slice(0, 3))
</script>

<template>
    <div
        class="flex flex-col gap-6"
        data-testid="recientes"
    >
        <CuentaEstadoLista
            :cargando="facturas.cargando.value"
            :cargado="facturas.cargado.value"
            :problema="facturas.problema.value"
            :vacia="facturas.items.value.length === 0"
            :hay-mas="false"
            texto-vacio="No tienes facturas"
            icono-vacio="i-lucide-receipt"
            @reintentar="facturas.recargar()"
        >
            <PortalLista
                titulo="Mis facturas"
                nivel="h2"
            >
                <template #acciones>
                    <UButton
                        label="Ver todas"
                        trailing-icon="i-lucide-chevron-right"
                        color="neutral"
                        variant="ghost"
                        size="sm"
                        to="/cuenta?seccion=facturas"
                        data-testid="ver-todas-facturas"
                    />
                </template>
                <PortalFila
                    v-for="factura in ultimasFacturas"
                    :key="factura.id"
                    :titulo="conceptoFactura(factura)"
                    :subtitulo="`vence ${formatearFecha(factura.vence_en)}`"
                    :icono="factura.tipo === 'mora' ? 'i-lucide-receipt-text' : 'i-lucide-receipt'"
                    :tono="tonoDeColor(presentacionFactura(factura).color)"
                    :monto="formatearQuetzales(factura.total)"
                    :estado="presentacionFactura(factura)"
                    data-testid="factura-reciente"
                />
            </PortalLista>
        </CuentaEstadoLista>

        <CuentaEstadoLista
            :cargando="pagos.cargando.value"
            :cargado="pagos.cargado.value"
            :problema="pagos.problema.value"
            :vacia="pagos.items.value.length === 0"
            :hay-mas="false"
            texto-vacio="No tienes pagos registrados"
            icono-vacio="i-lucide-credit-card"
            @reintentar="pagos.recargar()"
        >
            <PortalLista
                titulo="Mis pagos"
                nivel="h2"
            >
                <template #acciones>
                    <UButton
                        label="Ver todos"
                        trailing-icon="i-lucide-chevron-right"
                        color="neutral"
                        variant="ghost"
                        size="sm"
                        to="/cuenta?seccion=pagar"
                        data-testid="ver-todos-pagos"
                    />
                </template>
                <PortalFila
                    v-for="pago in ultimosPagos"
                    :key="pago.id"
                    :titulo="METODOS_PAGO[pago.metodo]"
                    :subtitulo="formatearFechaHora(pago.created_at)"
                    icono="i-lucide-credit-card"
                    :tono="tonoDeColor(ESTADOS_PAGO[pago.estado].color)"
                    :monto="formatearQuetzales(pago.monto)"
                    :estado="ESTADOS_PAGO[pago.estado]"
                    data-testid="pago-reciente"
                />
            </PortalLista>
        </CuentaEstadoLista>
    </div>
</template>
