<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'

/**
 * Permiso de contacto por WhatsApp en la ficha del cliente (contrato Iris 0.6.0 §6.4, A6):
 * `GET /notificaciones/whatsapp/clientes/:id`. Muestra si acepta, la baja que dio en el chat de
 * Iris (origen `iris_cliente`, `iris_agente` o `iris_vigente`), si el canal está disponible y si
 * el último cambio ya llegó a Iris. Con error, el error con «Reintentar»: nunca un estado supuesto.
 */
const props = defineProps<{
    clienteId: number
}>()

const estado = shallowRef<WhatsappCliente | null>(null)
const cargando = ref(false)
const problema = ref<Problem | null>(null)

const contacto = computed(() => estado.value?.contacto ?? null)
const presentacion = computed(() => presentacionContactoWhatsapp(contacto.value))
const consentimiento = computed(() => estado.value?.ultimo_consentimiento ?? null)

async function cargar() {
    cargando.value = true
    problema.value = null
    const resultado = await useConsentimientosWhatsapp().estadoCliente(props.clienteId)
    cargando.value = false
    estado.value = resultado.ok ? resultado.data : null
    problema.value = resultado.ok ? null : resultado.problema
}

watch(() => props.clienteId, cargar)
onMounted(cargar)

defineExpose({ cargar })
</script>

<template>
    <UPageCard
        title="WhatsApp"
        description="Avisos por la mensajería de Iris. El registro del permiso vive en Iris."
        icon="i-lucide-message-circle"
        variant="subtle"
        data-prueba="cliente-whatsapp"
    >
        <ProblemaAlerta
            v-if="problema"
            :problema="problema"
            :reintentar="cargar"
            :reintentando="cargando"
        />
        <USkeleton
            v-else-if="!estado"
            class="h-12 w-full"
        />
        <div
            v-else
            class="flex flex-col gap-3"
        >
            <div class="flex flex-wrap items-center gap-2">
                <UBadge
                    :label="presentacion.etiqueta"
                    :icon="presentacion.icono"
                    :color="presentacion.color"
                    variant="subtle"
                    data-prueba="whatsapp-contacto"
                />
                <span
                    v-if="contacto"
                    class="text-xs text-muted"
                >{{ detalleContactoWhatsapp(contacto) }}</span>
            </div>
            <UAlert
                v-if="bajaDesdeIris(contacto)"
                color="warning"
                variant="subtle"
                icon="i-lucide-message-circle-off"
                title="El cliente pidió no recibir avisos por WhatsApp"
                description="La baja llegó de Iris y manda sobre cualquier alta anterior. El correo y Telegram de Argos siguen igual."
                data-prueba="whatsapp-baja-iris"
            />
            <p
                v-if="!estado.canal.disponible"
                class="flex items-start gap-1.5 text-xs text-muted"
                data-prueba="whatsapp-no-disponible"
            >
                <UIcon
                    name="i-lucide-info"
                    class="mt-0.5 size-3.5 shrink-0"
                />
                <span>Hoy no sale ningún aviso por WhatsApp{{ estado.canal.motivo ? `: ${estado.canal.motivo}` : '' }}.</span>
            </p>
            <div
                v-if="consentimiento"
                class="flex flex-wrap items-center gap-2 text-xs text-muted"
            >
                <UBadge
                    :label="ENTREGAS_CONSENTIMIENTO[consentimiento.entrega].etiqueta"
                    :icon="ENTREGAS_CONSENTIMIENTO[consentimiento.entrega].icono"
                    :color="ENTREGAS_CONSENTIMIENTO[consentimiento.entrega].color"
                    variant="outline"
                    size="sm"
                    data-prueba="whatsapp-entrega"
                />
                <span>Último cambio: {{ consentimiento.estado === 'acepta' ? 'acepta' : 'baja' }} · {{ formatearFechaHora(consentimiento.ocurrido_en) }}</span>
                <span
                    v-if="consentimiento.ultimo_error"
                    class="text-error"
                >{{ consentimiento.ultimo_error }}</span>
            </div>
        </div>
    </UPageCard>
</template>
