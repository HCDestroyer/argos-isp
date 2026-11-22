<script setup lang="ts">
import type { FormSubmitEvent } from '@nuxt/ui'

/**
 * Un ticket del cliente (contrato Iris 0.9.0 §11.3 y §11.5, A30): estado, mensajes públicos (nunca
 * notas internas ni datos del personal), responder con fotos o PDF y «Ya quedó, cerrar» cuando
 * soporte lo marcó resuelto. Si Iris no responde, el error con «Reintentar» y nada inventado.
 */

const route = useRoute()
const toast = useToast()
const tickets = useTickets()

const ticketId = computed(() => Number(route.params.id))
function numero(valor: unknown): number | undefined {
    const n = Number(Array.isArray(valor) ? valor[0] : valor)
    return Number.isSafeInteger(n) && n > 0 ? n : undefined
}
const empresaId = computed(() => numero(route.query.empresa))
/** Servicio a cargo (A46, §11.10): `?contacto=&servicio=`; solo sus propios tickets se abren aquí. */
const aCargo = computed<ACargoTicket | undefined>(() => {
    const contactoId = numero(route.query.contacto)
    const servicioId = numero(route.query.servicio)
    return contactoId && servicioId ? { contactoId, servicioId } : undefined
})
const volver = computed(() => aCargo.value ? '/cuenta' : '/cuenta?seccion=soporte')

const ticket = ref<TicketSoporte | null>(null)
const problema = ref<ReturnType<typeof mensajeProblema> | null>(null)
const sinSesion = ref(false)
const cargando = ref(true)
const mensajes = shallowRef(tickets.mensajes(ticketId.value, empresaId.value, aCargo.value))

useHead({ title: computed(() => ticket.value ? `Ticket ${ticket.value.numero}` : 'Ticket') })

async function cargar() {
    cargando.value = true
    problema.value = null
    const leido = await tickets.ver(ticketId.value, empresaId.value, aCargo.value)
    cargando.value = false
    if (!leido.ok) {
        if (esSinSesion(leido.problema)) {
            sinSesion.value = true
            await navigateTo('/entrar')
            return
        }
        problema.value = mensajeProblema(leido.problema)
        return
    }
    ticket.value = leido.data
    mensajes.value = tickets.mensajes(ticketId.value, empresaId.value, aCargo.value)
    await mensajes.value.recargar()
}
onMounted(cargar)

const estadoTicket = computed(() => ticket.value ? ESTADOS_TICKET[ticket.value.estado] : null)
const cerrado = computed(() => ticket.value?.estado === 'cerrado')

const respuesta = reactive<Partial<DatosRespuesta>>({ cuerpo: '' })
const archivos = ref<File[]>([])
const enviando = ref(false)
const errorRespuesta = ref<string | null>(null)
let clave = claveIdempotencia()

async function responder(evento: FormSubmitEvent<DatosRespuesta>) {
    if (!ticket.value || errorAdjuntos(archivos.value)) {
        return
    }
    enviando.value = true
    errorRespuesta.value = null
    const r = await tickets.responder(ticket.value.id, {
        cuerpo: evento.data.cuerpo,
        ...(ticket.value.version ? { version: ticket.value.version } : {}),
        ...(aCargo.value
            ? { contacto_id: aCargo.value.contactoId, servicio_id: aCargo.value.servicioId }
            : empresaId.value ? { empresa_id: empresaId.value } : {}),
    }, archivos.value, clave)
    enviando.value = false
    if (!r.ok) {
        if (r.problema.status !== 0) {
            clave = claveIdempotencia()
        }
        errorRespuesta.value = mensajeProblema(r.problema)
        reintento.value = 'responder'
        return
    }
    reintento.value = null
    clave = claveIdempotencia()
    ticket.value = r.data.ticket
    respuesta.cuerpo = ''
    archivos.value = []
    await mensajes.value.recargar()
    toast.add({ title: 'Mensaje enviado', icon: 'i-lucide-check', color: 'success' })
}

/** Lo último que falló al enviar, para «Reintentar» (responder reenvía con la misma clave). */
const reintento = ref<'responder' | 'confirmar' | null>(null)
const formulario = useTemplateRef('formulario')
function reintentar() {
    if (reintento.value === 'confirmar') {
        void confirmar()
    }
    else {
        formulario.value?.submit()
    }
}

const confirmando = ref(false)
async function confirmar() {
    if (!ticket.value?.version) {
        return
    }
    confirmando.value = true
    errorRespuesta.value = null
    const r = await tickets.confirmar(ticket.value.id, ticket.value.version, empresaId.value, aCargo.value)
    confirmando.value = false
    if (!r.ok) {
        errorRespuesta.value = mensajeProblema(r.problema)
        reintento.value = 'confirmar'
        return
    }
    reintento.value = null
    ticket.value = r.data
    toast.add({ title: 'Gracias, cerramos tu ticket', icon: 'i-lucide-circle-check', color: 'success' })
}
</script>

<template>
    <div
        class="flex flex-col gap-4"
        data-testid="soporte-ticket"
    >
        <div>
            <UButton
                :label="aCargo ? 'Inicio' : 'Mis tickets'"
                icon="i-lucide-arrow-left"
                color="neutral"
                variant="ghost"
                :to="volver"
            />
        </div>

        <template v-if="cargando">
            <USkeleton class="h-28 w-full" />
            <USkeleton class="h-40 w-full" />
        </template>

        <UAlert
            v-else-if="problema"
            color="error"
            variant="subtle"
            icon="i-lucide-cloud-off"
            title="No pudimos cargar el ticket"
            :description="problema"
            :actions="[{ label: 'Reintentar', icon: 'i-lucide-refresh-cw', color: 'error', variant: 'outline', onClick: cargar }]"
            data-testid="ticket-problema"
        />

        <template v-else-if="ticket && estadoTicket">
            <UCard :ui="{ body: 'p-4 sm:p-6' }">
                <div class="flex flex-col gap-3">
                    <div class="flex items-start gap-3">
                        <div class="min-w-0 flex-1">
                            <p class="text-xs text-muted">
                                {{ ticket.numero }}<template v-if="ticket.categoria">
                                    · {{ ticket.categoria.nombre }}
                                </template>
                            </p>
                            <h1 class="text-lg font-semibold break-words text-highlighted">
                                {{ ticket.asunto ?? `Ticket ${ticket.numero}` }}
                            </h1>
                        </div>
                        <UBadge
                            :label="estadoTicket.etiqueta"
                            :color="estadoTicket.color"
                            :icon="estadoTicket.icono"
                            variant="subtle"
                            class="shrink-0"
                            data-testid="ticket-estado"
                        />
                    </div>
                    <UAlert
                        v-if="ticket.afectado_por_incidente"
                        color="warning"
                        variant="subtle"
                        icon="i-lucide-radio-tower"
                        title="Estamos trabajando en una falla en tu zona"
                        description="Tu reporte está ligado a esa falla: te avisamos cuando quede resuelta."
                    />
                    <UAlert
                        v-if="ticket.puede_confirmar"
                        color="success"
                        variant="subtle"
                        icon="i-lucide-circle-check"
                        title="Soporte lo marcó como resuelto"
                        description="Si ya funciona, confírmalo. Si sigue fallando, respóndenos abajo y lo reabrimos."
                        :actions="[{ label: 'Ya quedó, cerrar', icon: 'i-lucide-check', color: 'success', loading: confirmando, onClick: confirmar }]"
                        data-testid="ticket-confirmar"
                    />
                </div>
            </UCard>

            <UCard :ui="{ body: 'p-4 sm:p-6' }">
                <h2 class="mb-3 text-sm font-semibold text-highlighted">
                    Mensajes
                </h2>
                <CuentaEstadoLista
                    :cargando="mensajes.cargando.value"
                    :cargado="mensajes.cargado.value"
                    :problema="mensajes.problema.value"
                    :vacia="mensajes.items.value.length === 0"
                    :hay-mas="mensajes.hayMas.value"
                    texto-vacio="Sin mensajes por ahora."
                    icono-vacio="i-lucide-messages-square"
                    @reintentar="mensajes.recargar()"
                    @cargar-mas="mensajes.cargarMas()"
                >
                    <ol
                        class="flex flex-col gap-3"
                        data-testid="ticket-mensajes"
                    >
                        <li
                            v-for="mensaje in mensajes.items.value"
                            :key="mensaje.id"
                            class="flex flex-col gap-1 rounded-xl p-3"
                            :class="mensaje.autor_tipo === 'cliente' ? 'ms-6 bg-primary/10' : 'me-6 bg-elevated'"
                        >
                            <p class="text-xs text-muted">
                                {{ mensaje.autor_tipo === 'cliente' ? 'Tú' : mensaje.autor_nombre }} · {{ formatearFechaHora(mensaje.creado_en) }}
                            </p>
                            <p class="text-sm break-words whitespace-pre-line text-default">
                                {{ mensaje.cuerpo }}
                            </p>
                            <div
                                v-if="mensaje.adjuntos.length > 0"
                                class="flex flex-wrap gap-2"
                            >
                                <UButton
                                    v-for="adjunto in mensaje.adjuntos"
                                    :key="adjunto.id"
                                    :label="adjunto.nombre"
                                    :icon="adjunto.mime === 'application/pdf' ? 'i-lucide-file-text' : 'i-lucide-image'"
                                    :href="tickets.urlAdjunto(ticket.id, adjunto.id, empresaId, aCargo)"
                                    external
                                    download
                                    size="sm"
                                    color="neutral"
                                    variant="outline"
                                    class="max-w-full"
                                />
                            </div>
                        </li>
                    </ol>
                </CuentaEstadoLista>
            </UCard>

            <UCard
                v-if="!cerrado"
                :ui="{ body: 'p-4 sm:p-6' }"
            >
                <UForm
                    ref="formulario"
                    :schema="esquemaRespuesta"
                    :state="respuesta"
                    class="flex flex-col gap-4"
                    @submit="responder"
                >
                    <UAlert
                        v-if="errorRespuesta"
                        color="error"
                        variant="subtle"
                        icon="i-lucide-circle-alert"
                        :title="errorRespuesta"
                        :actions="[{ label: 'Reintentar', icon: 'i-lucide-refresh-cw', color: 'error', variant: 'outline', onClick: reintentar }]"
                        data-testid="ticket-error"
                    />
                    <UFormField
                        label="Responder"
                        name="cuerpo"
                    >
                        <UTextarea
                            v-model="respuesta.cuerpo"
                            :rows="3"
                            autoresize
                            placeholder="Escribe tu mensaje"
                            class="w-full"
                            data-testid="ticket-respuesta"
                        />
                    </UFormField>
                    <SoporteAdjuntos v-model="archivos" />
                    <UButton
                        type="submit"
                        label="Enviar"
                        icon="i-lucide-send"
                        size="lg"
                        block
                        :loading="enviando"
                        data-testid="ticket-responder"
                    />
                </UForm>
            </UCard>
            <p
                v-else
                class="text-center text-sm text-muted"
            >
                Este ticket está cerrado. Si vuelve a fallar, reporta un problema nuevo.
            </p>
        </template>
    </div>
</template>
