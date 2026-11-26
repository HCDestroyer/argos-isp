<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { AvisoPagoWhatsapp } from '~/composables/useAvisoPagoWhatsapp'
import { envioEnCurso, presentacionEnvioPago } from '~/utils/avisoPago'

/**
 * Estado del comprobante por WhatsApp en la pantalla de éxito del cobro. El mensaje lo manda Iris
 * (`pago_recibido`, al `pago.registrado`, contrato Iris §6): aquí solo se lee en qué va. Con el canal
 * o la plantilla apagados no hay botón; solo quien configura ve a dónde encenderlo. Mientras el
 * envío está en cola o aún no se programa se vuelve a leer unas veces (sondeo corto, no una caché).
 * Reenviar no existe en la API todavía (`.claude/integration/a4.md`).
 */
const props = defineProps<{ pagoId: number }>()

const { puede } = usePermisos()
const aviso = shallowRef<AvisoPagoWhatsapp | null>(null)
const problema = ref<Problem | null>(null)
const cargando = ref(false)
const lecturas = ref(0)
const MAXIMO_LECTURAS = 6
const ESPERA_MS = 2500
let temporizador: ReturnType<typeof setTimeout> | null = null

async function cargar() {
    if (temporizador) {
        clearTimeout(temporizador)
        temporizador = null
    }
    cargando.value = true
    const resultado = await useAvisoPagoWhatsapp().ver(props.pagoId)
    cargando.value = false
    lecturas.value += 1
    if (!resultado.ok) {
        problema.value = resultado.problema
        return
    }
    problema.value = null
    aviso.value = resultado.data
    if (envioEnCurso(resultado.data) && lecturas.value < MAXIMO_LECTURAS) {
        temporizador = setTimeout(cargar, ESPERA_MS)
    }
}

function reintentar() {
    lecturas.value = 0
    cargar()
}

watch(() => props.pagoId, reintentar)
onMounted(cargar)
onBeforeUnmount(() => {
    if (temporizador) {
        clearTimeout(temporizador)
    }
})

const activo = computed(() => aviso.value !== null && aviso.value.canal.disponible && aviso.value.plantilla_activa)
const presentacion = computed(() => (aviso.value?.envio ? presentacionEnvioPago(aviso.value.envio) : null))
const sinProgramar = computed(() => activo.value && aviso.value?.envio === null && lecturas.value >= MAXIMO_LECTURAS)
</script>

<template>
    <div
        class="w-full text-start"
        data-prueba="recibo-whatsapp-estado"
    >
        <ProblemaAlerta
            v-if="problema"
            :problema="problema"
            :reintentar="reintentar"
            :reintentando="cargando"
        />
        <template v-else-if="aviso">
            <p
                v-if="!activo"
                class="text-xs text-muted"
                data-prueba="whatsapp-apagado"
            >
                <template v-if="puede('notificaciones.configurar') && puede('notificaciones.ver')">
                    Envío por WhatsApp: actívalo en
                    <ULink
                        to="/configuracion/notificaciones"
                        class="underline"
                    >Configuración › Notificaciones</ULink>.
                </template>
            </p>
            <p
                v-else-if="presentacion && aviso.envio"
                class="flex flex-wrap items-center gap-1.5 text-xs"
                data-prueba="whatsapp-envio"
                :data-estado="aviso.envio.estado"
            >
                <UBadge
                    :label="presentacion.etiqueta"
                    :color="presentacion.color"
                    :icon="presentacion.icono"
                    variant="subtle"
                />
                <span
                    v-if="aviso.envio.estado === 'fallido' && aviso.envio.error"
                    class="text-muted"
                >{{ aviso.envio.error }}</span>
                <span
                    v-else-if="aviso.envio.estado === 'omitido' && aviso.envio.motivo"
                    class="text-muted"
                >{{ aviso.envio.motivo }}</span>
            </p>
            <p
                v-else-if="sinProgramar"
                class="text-xs text-muted"
                data-prueba="whatsapp-sin-aviso"
            >
                Este pago no generó aviso por WhatsApp.
            </p>
            <p
                v-else
                class="flex items-center gap-1.5 text-xs text-muted"
                data-prueba="whatsapp-programando"
            >
                <UIcon
                    name="i-lucide-loader-circle"
                    class="size-3.5 animate-spin"
                />
                Preparando el comprobante por WhatsApp…
            </p>
        </template>
    </div>
</template>
