<script setup lang="ts">
/**
 * Tickets de un servicio a cargo (A46, contrato Iris 0.12.1 §11.10): los que abrió la persona se ven
 * completos y se abren; los demás del servicio solo con número, estado, categoría y fechas (Iris no
 * manda el asunto), sin abrirse. Si Iris responde un error, el error con «Reintentar».
 */
const props = defineProps<{
    contactoId: number
    servicioId: number
}>()

const tickets = useTickets()
const lista = tickets.lista(undefined, { contactoId: props.contactoId, servicioId: props.servicioId })
onMounted(() => lista.recargar())

function ruta(ticket: TicketSoporte): string | undefined {
    return ticket.asunto === null
        ? undefined
        : `/soporte/${ticket.id}?contacto=${props.contactoId}&servicio=${props.servicioId}`
}
</script>

<template>
    <div
        class="flex flex-col gap-2"
        data-testid="a-cargo-tickets"
    >
        <h3 class="text-xs font-semibold text-muted">
            Tickets de este servicio
        </h3>
        <CuentaEstadoLista
            :cargando="lista.cargando.value"
            :cargado="lista.cargado.value"
            :problema="lista.problema.value"
            :vacia="lista.items.value.length === 0"
            :hay-mas="lista.hayMas.value"
            texto-vacio="Sin tickets abiertos."
            icono-vacio="i-lucide-life-buoy"
            @reintentar="lista.recargar()"
            @cargar-mas="lista.cargarMas()"
        >
            <ul class="flex flex-col divide-y divide-default">
                <li
                    v-for="ticket in lista.items.value"
                    :key="ticket.id"
                >
                    <SoporteFilaTicket
                        :ticket="ticket"
                        :to="ruta(ticket)"
                    />
                </li>
            </ul>
        </CuentaEstadoLista>
    </div>
</template>
