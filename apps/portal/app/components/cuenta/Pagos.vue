<script setup lang="ts">
/**
 * Pagos del cliente, con los depósitos que siguen en verificación: una lista (tabla en escritorio)
 * y el detalle de cada pago (a qué facturas se abonó) en un drawer, sin salir de la lista.
 */
const { items, cargando, cargado, problema, hayMas, recargar, cargarMas } = usePagos()

onMounted(recargar)

type Pago = (typeof items.value)[number]
const detalle = ref<Pago | null>(null)
const verDetalle = ref(false)
function abrir(pago: Pago) {
    detalle.value = pago
    verDetalle.value = true
}

function aplicado(pago: Pago): string | undefined {
    if (pago.aplicaciones.length > 0) {
        return `Abonado a ${pago.aplicaciones.length === 1 ? 'la factura' : 'las facturas'} ${pago.aplicaciones.map(a => a.factura_id).join(', ')}`
    }
    return pago.estado === 'pendiente_verificacion' ? 'Lo revisamos y lo aplicamos a tus facturas' : undefined
}

const ICONOS_METODO: Record<Pago['metodo'], string> = {
    caja: 'i-lucide-store',
    pasarela: 'i-lucide-credit-card',
    deposito: 'i-lucide-landmark',
    transferencia: 'i-lucide-arrow-left-right',
    ach: 'i-lucide-arrow-left-right',
    remesa: 'i-lucide-send',
    agente: 'i-lucide-store',
    debito: 'i-lucide-repeat',
}
</script>

<template>
    <CuentaEstadoLista
        :cargando="cargando"
        :cargado="cargado"
        :problema="problema"
        :vacia="items.length === 0"
        :hay-mas="hayMas"
        texto-vacio="No tienes pagos registrados"
        icono-vacio="i-lucide-credit-card"
        @reintentar="recargar"
        @cargar-mas="cargarMas"
    >
        <PortalLista :columnas="{ concepto: 'Pago', monto: 'Monto', estado: 'Estado' }">
            <PortalFila
                v-for="pago in items"
                :key="pago.id"
                :titulo="METODOS_PAGO[pago.metodo]"
                :subtitulo="`${formatearFechaHora(pago.created_at)}${pago.referencia ? ` · Ref. ${pago.referencia}` : ''}`"
                :icono="ICONOS_METODO[pago.metodo]"
                :tono="tonoDeColor(ESTADOS_PAGO[pago.estado].color)"
                :monto="formatearQuetzales(pago.monto)"
                :estado="ESTADOS_PAGO[pago.estado]"
                interactiva
                data-testid="pago"
                @abrir="abrir(pago)"
            >
                <template #acciones>
                    <UButton
                        icon="i-lucide-chevron-right"
                        color="neutral"
                        variant="ghost"
                        size="sm"
                        class="ax-pista"
                        data-pista="Ver detalle"
                        :aria-label="`Ver detalle del pago de ${formatearQuetzales(pago.monto)}`"
                        data-testid="ver-pago"
                        @click="abrir(pago)"
                    />
                </template>
                <p
                    v-if="aplicado(pago)"
                    class="text-xs text-muted"
                >
                    {{ aplicado(pago) }}
                </p>
            </PortalFila>
        </PortalLista>

        <PortalDetalle
            v-if="detalle"
            v-model:open="verDetalle"
            :titulo="`Pago de ${formatearQuetzales(detalle.monto)}`"
            :descripcion="`${METODOS_PAGO[detalle.metodo]} · ${ESTADOS_PAGO[detalle.estado].etiqueta}`"
            :icono="ICONOS_METODO[detalle.metodo]"
            :tono="tonoDeColor(ESTADOS_PAGO[detalle.estado].color)"
            :datos="[
                { etiqueta: 'Fecha', valor: formatearFechaHora(detalle.created_at) },
                { etiqueta: 'Método', valor: METODOS_PAGO[detalle.metodo] },
                ...(detalle.referencia ? [{ etiqueta: 'Referencia', valor: detalle.referencia, mono: true, copiable: true }] : []),
                { etiqueta: 'Monto', valor: formatearQuetzales(detalle.monto) },
            ]"
        >
            <p
                v-if="aplicado(detalle)"
                class="text-sm text-muted"
            >
                {{ aplicado(detalle) }}.
            </p>
        </PortalDetalle>
    </CuentaEstadoLista>
</template>
