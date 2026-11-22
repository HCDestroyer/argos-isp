<script setup lang="ts">
/**
 * Comprobantes de depósito del cliente (tarea 5), en la pestaña Pagos de `/cuenta`: estado de
 * cada uno (en revisión, aprobado o rechazado con el motivo), el detalle en un drawer y el botón para
 * subir otro (página propia `/comprobante`, que vuelve aquí).
 */
const props = withDefaults(defineProps<{
    servicioId?: number
    /** Empresa del servicio: sus cuentas son las de destino. */
    empresaId?: number
}>(), {
    servicioId: undefined,
    empresaId: undefined,
})

const { items, cargando, cargado, problema, hayMas, recargar, cargarMas } = useComprobantes()

onMounted(recargar)

/** Detalle del comprobante en un drawer, sin salir de la lista. */
const detalle = ref<ComprobantePortal | null>(null)
const verDetalle = ref(false)
function abrir(comprobante: ComprobantePortal) {
    detalle.value = comprobante
    verDetalle.value = true
}
</script>

<template>
    <section
        class="flex flex-col gap-3"
        aria-labelledby="titulo-comprobantes"
    >
        <div class="flex items-center justify-between gap-3">
            <h2
                id="titulo-comprobantes"
                class="flex items-center gap-1 text-sm font-semibold text-highlighted"
            >
                Comprobantes enviados
                <PortalAyuda clave="comprobante" />
            </h2>
            <UButton
                label="Subir comprobante"
                icon="i-lucide-upload"
                size="sm"
                color="neutral"
                variant="outline"
                :to="rutaComprobante(props.servicioId, props.empresaId)"
                data-testid="cuenta-subir-comprobante"
            />
        </div>

        <CuentaEstadoLista
            :cargando="cargando"
            :cargado="cargado"
            :problema="problema"
            :vacia="items.length === 0"
            :hay-mas="hayMas"
            texto-vacio="¿Pagaste por depósito o transferencia? Sube aquí la foto del comprobante."
            icono-vacio="i-lucide-upload"
            @reintentar="recargar"
            @cargar-mas="cargarMas"
        >
            <PortalLista :columnas="{ concepto: 'Comprobante', monto: 'Monto', estado: 'Estado' }">
                <PortalFila
                    v-for="comprobante in items"
                    :key="comprobante.id"
                    :titulo="`${NOMBRE_METODO[comprobante.metodo]} · ${formatearFecha(comprobante.fecha_deposito)}`"
                    :subtitulo="`${comprobante.cuenta_destino} · Ref. ${comprobante.referencia}`"
                    icono="i-lucide-file-check"
                    :tono="tonoDeColor(ESTADOS_COMPROBANTE[comprobante.estado].color)"
                    :monto="formatearQuetzales(comprobante.monto)"
                    :estado="ESTADOS_COMPROBANTE[comprobante.estado]"
                    interactiva
                    data-testid="comprobante"
                    @abrir="abrir(comprobante)"
                >
                    <template #acciones>
                        <UButton
                            icon="i-lucide-chevron-right"
                            color="neutral"
                            variant="ghost"
                            size="sm"
                            class="ax-pista"
                            data-pista="Ver detalle"
                            :aria-label="`Ver detalle del comprobante ${comprobante.referencia}`"
                            @click="abrir(comprobante)"
                        />
                    </template>
                    <UAlert
                        v-if="comprobante.estado === 'rechazado'"
                        color="error"
                        variant="subtle"
                        icon="i-lucide-circle-x"
                        title="No pudimos aprobarlo"
                        :description="comprobante.motivo_rechazo ?? 'Comunícate con nosotros para saber por qué.'"
                        data-testid="comprobante-motivo"
                    />
                </PortalFila>
            </PortalLista>
        </CuentaEstadoLista>

        <PortalDetalle
            v-if="detalle"
            v-model:open="verDetalle"
            :titulo="`Comprobante de ${formatearQuetzales(detalle.monto)}`"
            :descripcion="ESTADOS_COMPROBANTE[detalle.estado].etiqueta"
            icono="i-lucide-file-check"
            :tono="tonoDeColor(ESTADOS_COMPROBANTE[detalle.estado].color)"
            :datos="[
                { etiqueta: NOMBRE_METODO[detalle.metodo], valor: detalle.cuenta_destino },
                { etiqueta: 'Referencia', valor: detalle.referencia, mono: true, copiable: true },
                { etiqueta: 'Fecha del pago', valor: formatearFecha(detalle.fecha_deposito) },
                { etiqueta: 'Enviado', valor: formatearFechaHora(detalle.created_at) },
                { etiqueta: 'Monto', valor: formatearQuetzales(detalle.monto) },
            ]"
        >
            <UAlert
                v-if="detalle.estado === 'rechazado'"
                color="error"
                variant="subtle"
                icon="i-lucide-circle-x"
                title="No pudimos aprobarlo"
                :description="detalle.motivo_rechazo ?? 'Comunícate con nosotros para saber por qué.'"
            />
        </PortalDetalle>
    </section>
</template>
