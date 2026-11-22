<script setup lang="ts">
/**
 * «Está a cargo de» en el inicio (contrato Iris 0.10.1 §3.8, A46): servicios de otros clientes que
 * esta persona tiene a cargo como su contacto. Solo el código y el nombre del servicio, su estado y,
 * con el permiso «consultar», lo que debe; nunca el nombre ni los datos del titular. Con «reportar»
 * y un Iris con contrato ≥ 0.12.1, «Reportar una falla» abre el ticket en la cuenta del titular y
 * se listan los tickets de ese servicio (los suyos completos; los demás, reducidos). No aparece si
 * no tiene ninguno.
 */
const aCargo = useACargo()
const soporte = useSoporte()

/** Tickets de los servicios a cargo: Iris con contrato ≥ 0.12.1 (§11.10) y soporte disponible. */
const conTickets = computed(() => soporte.disponible.value && soporte.disponibilidad.value?.contactos === true)

const servicios = computed(() => (aCargo.lista.value ?? []).flatMap(grupo => grupo.servicios.map(servicio => ({
    servicio,
    contactoId: grupo.contacto_id,
    permisos: grupo.permisos,
}))))
</script>

<template>
    <UAlert
        v-if="aCargo.problema.value"
        color="error"
        variant="subtle"
        icon="i-lucide-cloud-off"
        title="No pudimos cargar los servicios a tu cargo"
        :description="mensajeProblema(aCargo.problema.value)"
        :actions="[{ label: 'Reintentar', icon: 'i-lucide-refresh-cw', color: 'error', variant: 'outline', onClick: () => aCargo.recargar() }]"
    />
    <section
        v-else-if="servicios.length > 0"
        class="ax-tarjeta flex flex-col p-4 sm:p-5"
        aria-labelledby="titulo-a-cargo"
        data-testid="a-cargo"
    >
        <div class="flex items-center gap-3">
            <PortalPastilla
                icono="i-lucide-users-round"
                tono="info"
            />
            <div class="min-w-0">
                <h2
                    id="titulo-a-cargo"
                    class="font-semibold text-highlighted"
                >
                    Está a tu cargo
                </h2>
                <p class="text-xs text-muted">
                    Servicios de otros titulares que te dejaron a cargo.
                </p>
            </div>
        </div>
        <div
            v-for="{ servicio, contactoId, permisos } in servicios"
            :key="`${contactoId}-${servicio.id}`"
            class="mt-4 border-t border-default pt-4"
            data-testid="a-cargo-servicio"
        >
            <div class="flex flex-wrap items-start gap-x-3 gap-y-2">
                <span class="flex size-10 shrink-0 items-center justify-center rounded-xl bg-secondary/10 text-secondary">
                    <UIcon
                        name="i-lucide-house"
                        class="size-5"
                    />
                </span>
                <div class="min-w-0 flex-1 basis-40">
                    <p class="font-medium break-words text-highlighted">
                        {{ nombreServicioACargo(servicio) }}
                    </p>
                    <p class="truncate text-xs text-muted">
                        {{ servicio.empresa.nombre_comercial }}
                    </p>
                </div>
                <EstadoServicioBadge
                    :estado="servicio.estado"
                    class="shrink-0"
                />
            </div>
            <div class="mt-3 flex flex-wrap items-center justify-between gap-3">
                <p
                    v-if="servicio.monto_adeudado !== null"
                    class="text-sm"
                >
                    <span class="text-muted">Por pagar</span>
                    <span class="ms-2 font-semibold tabular-nums text-highlighted">{{ formatearQuetzales(servicio.monto_adeudado) }}</span>
                </p>
                <p
                    v-else
                    class="text-xs text-muted"
                >
                    El titular no te dio permiso para ver el saldo.
                </p>
                <UButton
                    v-if="permisos.reportar && conTickets"
                    label="Reportar una falla"
                    icon="i-lucide-life-buoy"
                    color="neutral"
                    variant="outline"
                    size="sm"
                    :to="`/soporte/nuevo?contacto=${contactoId}&servicio=${servicio.id}`"
                    data-testid="a-cargo-reportar"
                />
            </div>
            <SoporteTicketsACargo
                v-if="conTickets && (permisos.reportar || permisos.consultar)"
                :contacto-id="contactoId"
                :servicio-id="servicio.id"
                class="mt-3"
            />
            <p
                v-if="permisos.pagar"
                class="mt-2 text-xs text-muted"
            >
                Para pagar, indica el código {{ servicio.codigo ?? servicio.id }} en caja o en tu depósito.
            </p>
        </div>
    </section>
</template>
