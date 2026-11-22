<script setup lang="ts">
import type { FormSubmitEvent } from '@nuxt/ui'

/**
 * «Reportar un problema» (`POST /portal/soporte/tickets`, contrato Iris 0.9.0 §11.4, A30): asunto,
 * qué pasa, categoría (de Iris), servicio y hasta 3 fotos o PDF. Página propia (más de 3 campos).
 *
 * - `?empresa=`: la empresa elegida en la sección Soporte (la API la valida con la sesión).
 * - `?contacto=&servicio=` (A46): reportar la falla de un servicio que la persona tiene a cargo; el
 *   servicio queda fijo y el ticket se abre en la cuenta del dueño.
 * - Con la sesión de «Ver mi cuenta» en `/corte` no hay adjuntos (§11.2).
 * - `Idempotency-Key`: la misma en los reintentos de un envío que no llegó.
 */
useHead({ title: 'Reportar un problema' })

const route = useRoute()
const toast = useToast()
const tickets = useTickets()
const soporte = useSoporte()
const { data: cuentaLeida } = useCuenta()
const aCargo = useACargo()

function numero(valor: unknown): number | undefined {
    const n = Number(Array.isArray(valor) ? valor[0] : valor)
    return Number.isSafeInteger(n) && n > 0 ? n : undefined
}
const empresaId = computed(() => numero(route.query.empresa))
const contactoId = computed(() => numero(route.query.contacto))
const servicioACargo = computed(() => {
    const id = numero(route.query.servicio)
    if (!contactoId.value || !id) {
        return null
    }
    const grupo = aCargo.lista.value?.find(a => a.contacto_id === contactoId.value)
    return grupo?.servicios.find(s => s.id === id) ?? null
})

const servicios = computed(() => {
    const todos = cuentaLeida.value?.ok ? cuentaLeida.value.data.servicios : []
    return todos.filter(s => s.estado !== 'retirado' && (!empresaId.value || s.empresa.id === empresaId.value))
})
const porIp = computed(() => soporte.disponibilidad.value?.sesion === 'ip')

const categorias = ref<{ label: string, value: number }[]>([])
const problemaCategorias = ref<string | null>(null)
async function cargarCategorias() {
    problemaCategorias.value = null
    const servicio = numero(route.query.servicio)
    const leidas = await tickets.categorias(
        empresaId.value,
        contactoId.value && servicio ? { contactoId: contactoId.value, servicioId: servicio } : undefined,
    )
    if (leidas.ok) {
        categorias.value = leidas.data.data.map(c => ({ label: c.nombre, value: c.id }))
    }
    else {
        problemaCategorias.value = mensajeProblema(leidas.problema)
    }
}
onMounted(cargarCategorias)

const estado = reactive<Partial<DatosTicket>>({ asunto: '', descripcion: '', categoria_id: undefined, servicio_id: undefined })
watch(servicios, (lista) => {
    if (estado.servicio_id === undefined && lista.length === 1) {
        estado.servicio_id = lista[0]!.id
    }
}, { immediate: true })

const archivos = ref<File[]>([])
const preparandoAdjuntos = ref(false)
const formulario = useTemplateRef('formulario')
const enviando = ref(false)
const error = ref<string | null>(null)
const creado = ref<TicketSoporte | null>(null)
let clave = claveIdempotencia()

async function enviar(evento: FormSubmitEvent<DatosTicket>) {
    if (preparandoAdjuntos.value || errorAdjuntos(archivos.value)) {
        return
    }
    enviando.value = true
    error.value = null
    const servicio = contactoId.value ? servicioACargo.value?.id : evento.data.servicio_id
    const respuesta = await tickets.abrir({
        asunto: evento.data.asunto,
        descripcion: evento.data.descripcion,
        ...(evento.data.categoria_id ? { categoria_id: evento.data.categoria_id } : {}),
        ...(servicio ? { servicio_id: servicio } : {}),
        ...(contactoId.value ? { contacto_id: contactoId.value } : empresaId.value ? { empresa_id: empresaId.value } : {}),
    }, porIp.value ? [] : archivos.value, clave)
    enviando.value = false
    if (!respuesta.ok) {
        // Sin respuesta de la API: el reintento lleva la misma clave.
        if (respuesta.problema.status !== 0) {
            clave = claveIdempotencia()
        }
        error.value = mensajeProblema(respuesta.problema)
        return
    }
    clave = claveIdempotencia()
    creado.value = respuesta.data
    toast.add({ title: `Recibimos tu reporte ${respuesta.data.numero}`, icon: 'i-lucide-check', color: 'success' })
}

const volver = computed(() => contactoId.value ? '/cuenta' : '/cuenta?seccion=soporte')
</script>

<template>
    <div
        class="flex flex-col gap-4"
        data-testid="soporte-nuevo"
    >
        <div>
            <UButton
                label="Atrás"
                icon="i-lucide-arrow-left"
                color="neutral"
                variant="ghost"
                :to="volver"
            />
        </div>

        <UCard :ui="{ body: 'p-4 sm:p-6' }">
            <div
                v-if="creado"
                class="flex flex-col items-center gap-3 py-4 text-center"
                data-testid="ticket-creado"
            >
                <span class="flex size-12 items-center justify-center rounded-full bg-success/10 text-success">
                    <UIcon
                        name="i-lucide-circle-check"
                        class="size-7"
                    />
                </span>
                <h1 class="text-lg font-semibold text-highlighted">
                    Recibimos tu reporte
                </h1>
                <p class="text-sm text-muted">
                    Tu número es <span class="font-semibold text-highlighted">{{ creado.numero }}</span>. Te avisaremos cuando soporte responda.
                </p>
                <UButton
                    v-if="!porIp && !contactoId"
                    label="Ver el ticket"
                    icon="i-lucide-arrow-right"
                    trailing
                    :to="`/soporte/${creado.id}${empresaId ? `?empresa=${empresaId}` : ''}`"
                    size="lg"
                    block
                />
                <UButton
                    label="Volver"
                    color="neutral"
                    variant="outline"
                    :to="volver"
                    size="lg"
                    block
                />
            </div>

            <div
                v-else
                class="flex flex-col gap-4"
            >
                <div>
                    <h1 class="text-lg font-semibold text-highlighted">
                        Reportar un problema
                    </h1>
                    <p class="text-sm text-muted">
                        Cuéntanos qué pasa. Un técnico de soporte te responde aquí.
                    </p>
                </div>

                <UAlert
                    v-if="contactoId && soporte.disponibilidad.value && !soporte.disponibilidad.value.contactos"
                    color="error"
                    variant="subtle"
                    icon="i-lucide-cloud-off"
                    title="Por ahora no puedes reportar fallas de los servicios a tu cargo"
                    description="Pídele al titular que lo reporte o llámanos."
                    :actions="[{ label: 'Reintentar', icon: 'i-lucide-refresh-cw', color: 'error', variant: 'outline', onClick: () => soporte.recargar() }]"
                />
                <UAlert
                    v-else-if="contactoId && servicioACargo"
                    color="info"
                    variant="subtle"
                    icon="i-lucide-users"
                    :title="`Servicio a tu cargo: ${nombreServicioACargo(servicioACargo)}`"
                    description="El reporte queda en la cuenta del titular de ese servicio."
                />
                <UAlert
                    v-else-if="contactoId && aCargo.lista.value"
                    color="error"
                    variant="subtle"
                    icon="i-lucide-circle-alert"
                    title="Ese servicio ya no está a tu cargo"
                />

                <UAlert
                    v-if="error"
                    color="error"
                    variant="subtle"
                    icon="i-lucide-circle-alert"
                    :title="error"
                    :actions="[{ label: 'Reintentar', icon: 'i-lucide-refresh-cw', color: 'error', variant: 'outline', onClick: () => formulario?.submit() }]"
                    data-testid="ticket-error"
                />

                <UForm
                    ref="formulario"
                    :schema="esquemaTicket"
                    :state="estado"
                    class="flex flex-col gap-4"
                    @submit="enviar"
                >
                    <UFormField
                        label="¿Qué pasa?"
                        name="asunto"
                        required
                    >
                        <UInput
                            v-model="estado.asunto"
                            placeholder="Por ejemplo: sin internet desde la mañana"
                            class="w-full"
                            data-testid="ticket-asunto"
                        />
                    </UFormField>
                    <UFormField
                        label="Cuéntanos más"
                        name="descripcion"
                        required
                        help="Desde cuándo, qué luces ves en el módem, si ya lo reiniciaste…"
                    >
                        <UTextarea
                            v-model="estado.descripcion"
                            :rows="5"
                            autoresize
                            class="w-full"
                            data-testid="ticket-descripcion"
                        />
                    </UFormField>
                    <UFormField
                        label="Tipo de problema"
                        name="categoria_id"
                        :error="problemaCategorias ?? undefined"
                    >
                        <USelect
                            v-model="estado.categoria_id"
                            :items="categorias"
                            placeholder="Elige uno (opcional)"
                            class="w-full"
                            data-testid="ticket-categoria"
                        />
                    </UFormField>
                    <UFormField
                        v-if="!contactoId && servicios.length > 1"
                        label="Servicio"
                        name="servicio_id"
                    >
                        <USelect
                            v-model="estado.servicio_id"
                            :items="servicios.map(s => ({ label: etiquetaServicio(s), value: s.id }))"
                            placeholder="¿En cuál servicio?"
                            class="w-full"
                            data-testid="ticket-servicio"
                        />
                    </UFormField>

                    <SoporteAdjuntos
                        v-if="!porIp"
                        v-model="archivos"
                        v-model:preparando="preparandoAdjuntos"
                    />

                    <UButton
                        type="submit"
                        label="Enviar reporte"
                        icon="i-lucide-send"
                        size="xl"
                        block
                        :loading="enviando"
                        :disabled="preparandoAdjuntos || Boolean(contactoId && (!servicioACargo || soporte.disponibilidad.value?.contactos === false))"
                        data-testid="ticket-enviar"
                    />
                </UForm>
            </div>
        </UCard>
    </div>
</template>
