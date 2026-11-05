<script setup lang="ts">
import { z } from 'zod'
import type { FormSubmitEvent } from '@nuxt/ui'

/**
 * «Acepta avisos por WhatsApp» en "Mi cuenta" (contrato Iris 0.6.0 §6.4). Los avisos por WhatsApp
 * salen de la mensajería de Iris; el permiso se registra allá (A6 lo encola) y aquí se ve lo último
 * que sabe Argos, incluida una baja que el cliente dio en el chat.
 *
 * - Solo se muestra si `whatsapp.activo` está encendido para alguna empresa del cliente (`visible`).
 * - Con el conector Iris apagado (`disponible: false`) o si la API falla: error con «Reintentar» y
 *   ninguna casilla (no se pinta un estado que no se pudo leer).
 * - La casilla refleja lo que respondió la API, no lo que se pidió: al cambiarla se manda el POST y
 *   la casilla toma el estado de la respuesta. Si falla, error con «Reintentar» (misma
 *   `Idempotency-Key` si no hubo respuesta; nueva si la API respondió).
 */
const whatsapp = useWhatsapp()
const toast = useToast()

/** Espejo de `registrarWhatsappValidator` del backend. */
const esquema = z.object({
    estado: z.enum(['acepta', 'baja']),
})
type EntradaWhatsapp = z.infer<typeof esquema>

const cargando = ref(true)
const guardando = ref(false)
/** Último cambio que no se pudo guardar (para «Reintentar»). */
const fallido = ref<{ estado: EstadoContactoWhatsapp, mensaje: string } | null>(null)
let clave = claveIdempotencia()

const datos = computed(() => whatsapp.estado.value)
const acepta = computed(() => datos.value?.estado === 'acepta')
const formulario = reactive<EntradaWhatsapp>({ estado: 'baja' })

watch(datos, (actual) => {
    formulario.estado = actual?.estado === 'acepta' ? 'acepta' : 'baja'
}, { immediate: true })

const nombresEmpresas = computed(() => (datos.value?.empresas ?? []).map(e => e.nombre_comercial).join(', '))

async function cargar() {
    cargando.value = true
    await whatsapp.cargar()
    cargando.value = false
}

onMounted(cargar)

async function guardar(evento: FormSubmitEvent<EntradaWhatsapp>) {
    guardando.value = true
    fallido.value = null
    const resultado = await whatsapp.registrar(evento.data.estado, clave)
    guardando.value = false
    if (!resultado.ok) {
        // Sin conexión se reintenta con la misma clave; con respuesta de la API, otra.
        if (resultado.problema.status !== 0) {
            clave = claveIdempotencia()
        }
        fallido.value = { estado: evento.data.estado, mensaje: mensajeProblema(resultado.problema) }
        formulario.estado = acepta.value ? 'acepta' : 'baja'
        return
    }
    clave = claveIdempotencia()
    toast.add({
        title: resultado.data.estado === 'acepta' ? 'Avisos por WhatsApp activados' : 'Ya no te avisaremos por WhatsApp',
        icon: 'i-lucide-check',
        color: resultado.data.estado === 'acepta' ? 'success' : 'neutral',
    })
}

const form = useTemplateRef('form')

/** Al marcar o quitar la casilla se envía el formulario (UForm valida contra el esquema). */
function cambiar(valor: boolean | 'indeterminate') {
    formulario.estado = valor === true ? 'acepta' : 'baja'
    void form.value?.submit()
}

function reintentarGuardar() {
    const pendiente = fallido.value
    if (pendiente) {
        cambiar(pendiente.estado === 'acepta')
    }
}

/** La última marca hecha en Argos no llegó a Iris: se vuelve a mandar la misma elección. */
function reenviar() {
    if (datos.value?.estado) {
        cambiar(datos.value.estado === 'acepta')
    }
}
</script>

<template>
    <section
        v-if="cargando && !datos && !whatsapp.problema.value"
        class="flex flex-col gap-3 rounded-lg border border-default p-3"
        aria-busy="true"
        aria-label="Cargando avisos por WhatsApp"
        data-testid="whatsapp-cargando"
    >
        <USkeleton class="h-5 w-40" />
        <USkeleton class="h-10 w-full" />
    </section>

    <section
        v-else-if="whatsapp.problema.value && !datos"
        class="rounded-lg border border-default p-3"
        aria-labelledby="titulo-whatsapp"
        data-testid="whatsapp-error"
    >
        <h2
            id="titulo-whatsapp"
            class="sr-only"
        >
            Avisos por WhatsApp
        </h2>
        <UAlert
            color="error"
            variant="subtle"
            icon="i-lucide-circle-alert"
            title="No pudimos leer tus avisos por WhatsApp"
            :description="mensajeProblema(whatsapp.problema.value)"
            :actions="[{ label: 'Reintentar', icon: 'i-lucide-refresh-cw', color: 'error', variant: 'outline', loading: cargando, onClick: () => cargar() }]"
        />
    </section>

    <section
        v-else-if="datos?.visible"
        class="flex flex-col gap-3 rounded-lg border border-default p-3"
        aria-labelledby="titulo-whatsapp"
        data-testid="whatsapp"
    >
        <div class="flex items-center justify-between gap-3">
            <h2
                id="titulo-whatsapp"
                class="flex min-w-0 items-center gap-2 text-sm font-semibold text-highlighted"
            >
                <UIcon
                    name="i-lucide-message-circle"
                    class="size-4 shrink-0 text-primary"
                    aria-hidden="true"
                />
                <span class="truncate">Avisos por WhatsApp</span>
            </h2>
            <UBadge
                v-if="datos.disponible && acepta && datos.entrega !== 'fallido'"
                label="Activos"
                icon="i-lucide-check"
                color="success"
                variant="subtle"
                data-testid="whatsapp-activos"
            />
        </div>

        <UAlert
            v-if="whatsapp.problema.value"
            color="error"
            variant="subtle"
            icon="i-lucide-circle-alert"
            title="No pudimos actualizar tus avisos por WhatsApp"
            :description="mensajeProblema(whatsapp.problema.value)"
            :actions="[{ label: 'Reintentar', icon: 'i-lucide-refresh-cw', color: 'error', variant: 'outline', loading: cargando, onClick: () => cargar() }]"
            data-testid="whatsapp-error-recarga"
        />

        <template v-else-if="!datos.disponible">
            <UAlert
                color="warning"
                variant="subtle"
                icon="i-lucide-cloud-off"
                title="WhatsApp no disponible"
                :description="datos.motivo ?? 'Los avisos por WhatsApp no están disponibles en este momento.'"
                :actions="[{ label: 'Reintentar', icon: 'i-lucide-refresh-cw', color: 'warning', variant: 'outline', loading: cargando, onClick: () => cargar() }]"
                data-testid="whatsapp-no-disponible"
            />
        </template>

        <template v-else>
            <UAlert
                v-if="datos.baja_de_iris"
                color="info"
                variant="subtle"
                icon="i-lucide-message-circle-off"
                title="Te diste de baja desde el chat de WhatsApp"
                :description="`${datos.ocurrido_en ? `El ${formatearFechaHora(datos.ocurrido_en)} pediste` : 'Pediste'} no recibir más avisos por WhatsApp. Si quieres volver a recibirlos, marca la casilla.`"
                data-testid="whatsapp-baja-iris"
            />

            <UForm
                ref="form"
                :schema="esquema"
                :state="formulario"
                @submit="guardar"
            >
                <UCheckbox
                    :model-value="formulario.estado === 'acepta'"
                    name="estado"
                    label="Acepto recibir avisos por WhatsApp"
                    :description="nombresEmpresas
                        ? `Avisos de cobro, pagos y servicio de ${nombresEmpresas}. Puedes darte de baja cuando quieras, aquí o escribiendo BAJA en el chat.`
                        : 'Avisos de cobro, pagos y servicio. Puedes darte de baja cuando quieras, aquí o escribiendo BAJA en el chat.'"
                    :disabled="guardando"
                    size="lg"
                    data-testid="whatsapp-casilla"
                    @update:model-value="cambiar"
                />
            </UForm>

            <p
                class="flex items-center gap-2 text-xs text-muted"
                role="status"
                data-testid="whatsapp-estado"
            >
                <UIcon
                    v-if="guardando"
                    name="i-lucide-loader-circle"
                    class="size-4 animate-spin"
                    aria-hidden="true"
                />
                <template v-if="guardando">
                    Guardando tu elección…
                </template>
                <template v-else-if="datos.estado === null">
                    No recibes avisos por WhatsApp. Marca la casilla si quieres recibirlos.
                </template>
                <template v-else-if="datos.entrega === 'pendiente'">
                    {{ acepta ? 'Activados' : 'Desactivados' }}{{ datos.ocurrido_en ? ` el ${formatearFechaHora(datos.ocurrido_en)}` : '' }}. Lo estamos confirmando con WhatsApp.
                </template>
                <template v-else-if="!datos.baja_de_iris">
                    {{ acepta ? 'Activados' : 'Desactivados' }}{{ datos.ocurrido_en ? ` el ${formatearFechaHora(datos.ocurrido_en)}` : '' }}.
                </template>
            </p>

            <UAlert
                v-if="fallido"
                color="error"
                variant="subtle"
                icon="i-lucide-circle-alert"
                title="No pudimos guardar tu elección"
                :description="fallido.mensaje"
                :actions="[{ label: 'Reintentar', icon: 'i-lucide-refresh-cw', color: 'error', variant: 'outline', loading: guardando, onClick: () => reintentarGuardar() }]"
                data-testid="whatsapp-error-guardar"
            />
            <UAlert
                v-else-if="datos.entrega === 'fallido'"
                color="error"
                variant="subtle"
                icon="i-lucide-circle-alert"
                title="Tu elección no llegó a WhatsApp"
                description="No pudimos registrarla en el servicio de mensajería. Vuelve a enviarla."
                :actions="[{ label: 'Reintentar', icon: 'i-lucide-refresh-cw', color: 'error', variant: 'outline', loading: guardando, onClick: () => reenviar() }]"
                data-testid="whatsapp-entrega-fallida"
            />
        </template>
    </section>
</template>
