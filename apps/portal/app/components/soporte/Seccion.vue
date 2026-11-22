<script setup lang="ts">
import type { TabsItem } from '@nuxt/ui'

/**
 * Sección «Soporte» de `/cuenta` (contrato Iris 0.9.0 §11, A30 y A31; diseño `NuevoPortal`): una
 * tarjeta con pestañas segmentadas «Mis tickets» y «Solicitudes» dentro de la misma tarjeta.
 *
 * - Tickets: «Reportar un problema» y la lista con su estado (ícono, texto y color). Con la sesión de
 *   «Ver mi cuenta» en `/corte` (`ip`) la lista no trae asunto y no se abre el detalle.
 * - Solicitudes (solo con `capacidades.solicitudes_servicio` y sesión `documento`): las cuatro
 *   opciones del tablero y «Mis solicitudes» con su `estado_cliente`.
 * - Si Iris está apagado, es anterior a 0.9.0 o no responde: el error con «Reintentar» y nada más.
 */
const props = defineProps<{
    /** servicios de la cuenta: de aquí salen las empresas para elegir con varias */
    servicios: readonly ServicioCuenta[]
}>()

const soporte = useSoporte()
const tickets = useTickets()
const solicitudes = useSolicitudes()
const route = useRoute()

const empresas = computed(() => {
    const ids = soporte.disponibilidad.value?.empresas ?? []
    return ids.map(id => ({
        id,
        nombre: props.servicios.find(s => s.empresa.id === id)?.empresa.nombre_comercial ?? `Empresa ${id}`,
    }))
})
const empresaElegida = ref<number | undefined>(undefined)
const empresaId = computed(() => empresas.value.some(e => e.id === empresaElegida.value)
    ? empresaElegida.value
    : empresas.value[0]?.id)

const porIp = computed(() => soporte.disponibilidad.value?.sesion === 'ip')
const conSolicitudes = computed(() => soporte.disponibilidad.value?.capacidades?.solicitudes_servicio === true && !porIp.value)

const pestanas = computed<TabsItem[]>(() => [
    { label: 'Mis tickets', value: 'tickets', icon: 'i-lucide-life-buoy', slot: 'tickets' as const },
    ...(conSolicitudes.value
        ? [{ label: 'Solicitudes', value: 'solicitudes', icon: 'i-lucide-circle-plus', slot: 'solicitudes' as const }]
        : []),
])
const pestana = ref(route.query.pestana === 'solicitudes' ? 'solicitudes' : 'tickets')

const listaTickets = shallowRef(tickets.lista(empresaId.value))
const listaSolicitudes = shallowRef(solicitudes.lista(empresaId.value))

async function cargar() {
    if (!soporte.disponible.value) {
        return
    }
    listaTickets.value = tickets.lista(empresaId.value)
    await listaTickets.value.recargar()
    if (conSolicitudes.value) {
        listaSolicitudes.value = solicitudes.lista(empresaId.value)
        await listaSolicitudes.value.recargar()
    }
}

watch([() => soporte.disponible.value, empresaId], () => {
    void cargar()
}, { immediate: true })

function rutaNuevo(): string {
    return empresaId.value ? `/soporte/nuevo?empresa=${empresaId.value}` : '/soporte/nuevo'
}
function rutaTicket(ticket: TicketSoporte): string {
    return `/soporte/${ticket.id}${empresaId.value ? `?empresa=${empresaId.value}` : ''}`
}
function rutaSolicitud(tipo: TipoSolicitud): string {
    return `/solicitudes/nueva?tipo=${tipo}${empresaId.value ? `&empresa=${empresaId.value}` : ''}`
}

async function reintentar() {
    await soporte.recargar()
    await cargar()
}
</script>

<template>
    <section
        class="flex flex-col gap-4"
        aria-labelledby="titulo-soporte"
        data-testid="seccion-soporte"
    >
        <UCard :ui="{ body: 'p-4 sm:p-5' }">
            <div class="flex flex-wrap items-center gap-3">
                <span class="flex size-10 shrink-0 items-center justify-center rounded-xl bg-warning/10 text-warning">
                    <UIcon
                        name="i-lucide-life-buoy"
                        class="size-5"
                    />
                </span>
                <div class="min-w-0 flex-1">
                    <h2
                        id="titulo-soporte"
                        class="text-lg font-semibold text-highlighted"
                    >
                        Soporte
                    </h2>
                    <p class="text-sm text-muted">
                        Las respuestas llegan aquí y a tus avisos.
                    </p>
                </div>
                <UButton
                    v-if="soporte.disponible.value"
                    label="Reportar un problema"
                    icon="i-lucide-plus"
                    :to="rutaNuevo()"
                    class="max-sm:w-full"
                    data-testid="soporte-reportar"
                />
            </div>

            <div class="mt-4 flex flex-col gap-4">
                <template v-if="soporte.cargando.value && !soporte.disponibilidad.value">
                    <USkeleton class="h-10 w-full" />
                    <USkeleton class="h-20 w-full" />
                </template>

                <UAlert
                    v-else-if="soporte.problema.value || (soporte.disponibilidad.value && !soporte.disponible.value)"
                    color="error"
                    variant="subtle"
                    icon="i-lucide-cloud-off"
                    title="El soporte en línea no está disponible"
                    :description="soporte.problema.value ? mensajeProblema(soporte.problema.value) : (soporte.disponibilidad.value?.detalle ?? undefined)"
                    :actions="[{ label: 'Reintentar', icon: 'i-lucide-refresh-cw', color: 'error', variant: 'outline', onClick: reintentar }]"
                    data-testid="soporte-no-disponible"
                />

                <template v-else-if="soporte.disponible.value">
                    <UFormField
                        v-if="empresas.length > 1"
                        label="Empresa"
                    >
                        <USelect
                            :model-value="empresaId"
                            :items="empresas.map(e => ({ label: e.nombre, value: e.id }))"
                            class="w-full"
                            data-testid="soporte-empresa"
                            @update:model-value="empresaElegida = Number($event)"
                        />
                    </UFormField>

                    <UAlert
                        v-if="porIp"
                        color="info"
                        variant="subtle"
                        icon="i-lucide-info"
                        title="Entraste desde la página de corte"
                        description="Puedes reportar un problema y ver tus tickets. Para ver las respuestas o adjuntar fotos, entra con tu código o tu contraseña."
                    />

                    <UTabs
                        v-model="pestana"
                        :items="pestanas"
                        variant="pill"
                        color="neutral"
                        :content="false"
                        class="w-full"
                        :ui="{ list: 'bg-elevated rounded-lg', indicator: 'bg-default shadow-sm', trigger: 'data-[state=active]:text-highlighted min-h-11' }"
                        data-testid="soporte-pestanas"
                    />

                    <CuentaEstadoLista
                        v-if="pestana === 'tickets'"
                        :cargando="listaTickets.cargando.value"
                        :cargado="listaTickets.cargado.value"
                        :problema="listaTickets.problema.value"
                        :vacia="listaTickets.items.value.length === 0"
                        :hay-mas="listaTickets.hayMas.value"
                        texto-vacio="No tienes tickets. Si algo falla, repórtalo aquí."
                        icono-vacio="i-lucide-life-buoy"
                        @reintentar="listaTickets.recargar()"
                        @cargar-mas="listaTickets.cargarMas()"
                    >
                        <ul
                            class="flex flex-col divide-y divide-default"
                            data-testid="soporte-tickets"
                        >
                            <li
                                v-for="ticket in listaTickets.items.value"
                                :key="ticket.id"
                            >
                                <SoporteFilaTicket
                                    :ticket="ticket"
                                    :to="porIp ? undefined : rutaTicket(ticket)"
                                />
                            </li>
                        </ul>
                    </CuentaEstadoLista>

                    <div
                        v-else
                        class="flex flex-col gap-4"
                    >
                        <p class="text-sm text-muted">
                            Un asesor revisa tu solicitud y te contacta para confirmarla.
                        </p>
                        <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
                            <UButton
                                v-for="opcion in OPCIONES_SOLICITUD"
                                :key="opcion.tipo"
                                :to="rutaSolicitud(opcion.tipo)"
                                color="neutral"
                                variant="outline"
                                class="justify-start rounded-xl p-3 text-start"
                                :data-testid="`solicitar-${opcion.tipo}`"
                            >
                                <span class="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                                    <UIcon
                                        :name="opcion.icono"
                                        class="size-5"
                                    />
                                </span>
                                <span class="flex min-w-0 flex-col">
                                    <span class="font-semibold text-highlighted">{{ opcion.titulo }}</span>
                                    <span class="text-xs font-normal text-muted">{{ opcion.descripcion }}</span>
                                </span>
                            </UButton>
                        </div>

                        <h3 class="text-sm font-semibold text-highlighted">
                            Mis solicitudes
                        </h3>
                        <CuentaEstadoLista
                            :cargando="listaSolicitudes.cargando.value"
                            :cargado="listaSolicitudes.cargado.value"
                            :problema="listaSolicitudes.problema.value"
                            :vacia="listaSolicitudes.items.value.length === 0"
                            :hay-mas="listaSolicitudes.hayMas.value"
                            texto-vacio="No tienes solicitudes."
                            icono-vacio="i-lucide-clipboard-list"
                            @reintentar="listaSolicitudes.recargar()"
                            @cargar-mas="listaSolicitudes.cargarMas()"
                        >
                            <ul
                                class="flex flex-col divide-y divide-default"
                                data-testid="soporte-solicitudes"
                            >
                                <li
                                    v-for="solicitud in listaSolicitudes.items.value"
                                    :key="solicitud.id"
                                    class="flex items-center gap-3 py-3"
                                >
                                    <UIcon
                                        :name="ESTADOS_SOLICITUD[solicitud.estado_cliente].icono"
                                        class="size-5 shrink-0 text-muted"
                                    />
                                    <div class="min-w-0 flex-1">
                                        <p class="font-medium text-highlighted">
                                            {{ tituloSolicitud(solicitud.tipo) }}
                                        </p>
                                        <p class="truncate text-xs text-muted">
                                            {{ solicitud.numero }} · {{ haceCuanto(solicitud.actualizado_en) }}
                                        </p>
                                    </div>
                                    <UBadge
                                        :label="ESTADOS_SOLICITUD[solicitud.estado_cliente].etiqueta"
                                        :color="ESTADOS_SOLICITUD[solicitud.estado_cliente].color"
                                        variant="subtle"
                                        class="shrink-0"
                                    />
                                </li>
                            </ul>
                        </CuentaEstadoLista>
                    </div>
                </template>
            </div>
        </UCard>
    </section>
</template>
