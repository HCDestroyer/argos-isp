<script setup lang="ts">
/**
 * Comprobantes de depósito del cliente (tarea 5), en la pestaña Pagos de `/cuenta`: estado de
 * cada uno (en revisión, aprobado o rechazado con el motivo) y el botón para subir otro.
 */
const props = withDefaults(defineProps<{
    servicioId?: number
}>(), {
    servicioId: undefined,
})

const emit = defineEmits<{
    enviado: [comprobante: ComprobantePortal]
}>()

const { items, cargando, cargado, problema, hayMas, recargar, cargarMas } = useComprobantes()
const verSubir = ref(false)

onMounted(recargar)

async function enviado(comprobante: ComprobantePortal) {
    emit('enviado', comprobante)
    await recargar()
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
                class="text-sm font-semibold text-highlighted"
            >
                Comprobantes enviados
            </h2>
            <UButton
                label="Subir comprobante"
                icon="i-lucide-upload"
                size="sm"
                data-testid="cuenta-subir-comprobante"
                @click="verSubir = true"
            />
        </div>

        <CuentaEstadoLista
            :cargando="cargando"
            :cargado="cargado"
            :problema="problema"
            :vacia="items.length === 0"
            :hay-mas="hayMas"
            texto-vacio="¿Pagaste por depósito o transferencia? Sube aquí la foto del comprobante."
            icono-vacio="i-lucide-file-up"
            @reintentar="recargar"
            @cargar-mas="cargarMas"
        >
            <UCard
                v-for="comprobante in items"
                :key="comprobante.id"
                data-testid="comprobante"
                :ui="{ body: 'p-4 sm:p-4' }"
            >
                <div class="flex items-start justify-between gap-3">
                    <div class="min-w-0">
                        <p class="font-medium text-highlighted">
                            {{ NOMBRE_METODO[comprobante.metodo] }} · {{ formatearFecha(comprobante.fecha_deposito) }}
                        </p>
                        <p class="truncate text-xs text-muted">
                            {{ comprobante.cuenta_destino }}
                        </p>
                        <p class="text-xs break-all text-muted">
                            Ref. {{ comprobante.referencia }}
                        </p>
                    </div>
                    <UBadge
                        :label="ESTADOS_COMPROBANTE[comprobante.estado].etiqueta"
                        :color="ESTADOS_COMPROBANTE[comprobante.estado].color"
                        :icon="ESTADOS_COMPROBANTE[comprobante.estado].icono"
                        variant="subtle"
                        class="shrink-0"
                    />
                </div>
                <div class="mt-3 flex items-end justify-between gap-3">
                    <p class="text-xs text-muted">
                        Enviado el {{ formatearFechaHora(comprobante.created_at) }}
                    </p>
                    <p class="font-semibold tabular-nums text-highlighted">
                        {{ formatearQuetzales(comprobante.monto) }}
                    </p>
                </div>
                <UAlert
                    v-if="comprobante.estado === 'rechazado'"
                    color="error"
                    variant="subtle"
                    icon="i-lucide-circle-x"
                    title="No pudimos aprobarlo"
                    :description="comprobante.motivo_rechazo ?? 'Comunícate con nosotros para saber por qué.'"
                    class="mt-3"
                    data-testid="comprobante-motivo"
                />
            </UCard>
        </CuentaEstadoLista>

        <ComprobanteSubir
            v-model:open="verSubir"
            :servicio-id="props.servicioId"
            @enviado="enviado"
        />
    </section>
</template>
