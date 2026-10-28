<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'

/**
 * «Activar instalación» (`POST /servicios/:id/activar-instalacion`, `servicios.activar_instalacion`,
 * `contratos/instalacion.md` §2): pasa un servicio pendiente a `activo` e inicia la facturación.
 * Manda la `version` leída y una `Idempotency-Key` por apertura (reintentar tras un error de red no
 * activa dos veces). 409 y 422 `servicio_no_pendiente` se muestran con «Recargar servicio»; los 422
 * por campo quedan en su campo.
 */
const props = defineProps<{
    servicio: Servicio
}>()

const abierto = defineModel<boolean>('open', { default: false })

const emit = defineEmits<{
    hecho: [servicio: Servicio]
    recargado: [servicio: Servicio]
}>()

const formulario = useTemplateRef('formulario')
const estado = reactive<EntradaActivarInstalacion>(entradaActivarInstalacion())
/** La fecha con que abrió el modal: si no se toca, no se manda y la API usa su hora. */
let instaladoPorDefecto = estado.instalado_en
const enviando = ref(false)
const recargando = ref(false)
const problema = ref<Problem | null>(null)
const rechazo = computed(() => (problema.value ? rechazoActivacion(problema.value) : null))
let claveIdempotencia = nuevaClaveIdempotencia()

const esquema = computed(() => esquemaActivarInstalacion(Date.now(), Date.parse(props.servicio.created_at)))

watch(abierto, (valor) => {
    if (valor) {
        Object.assign(estado, entradaActivarInstalacion())
        instaladoPorDefecto = estado.instalado_en
        problema.value = null
        claveIdempotencia = nuevaClaveIdempotencia()
    }
})

async function confirmar() {
    enviando.value = true
    problema.value = null
    const cuerpo = cuerpoActivarInstalacion(estado, props.servicio.version, instaladoPorDefecto)
    const resultado = await useServicios().activarInstalacion(props.servicio.id, cuerpo, claveIdempotencia)
    enviando.value = false
    if (resultado.ok) {
        abierto.value = false
        emit('hecho', resultado.data)
        return
    }
    problema.value = resultado.problema
    if (resultado.problema.status === 422) {
        formulario.value?.setErrors(erroresDeFormulario(resultado.problema))
    }
}

/** Tras un 409 o un `servicio_no_pendiente`: relee el servicio con su versión y estado actuales. */
async function recargar() {
    recargando.value = true
    const resultado = await useServicios().ver(props.servicio.id)
    recargando.value = false
    if (!resultado.ok) {
        problema.value = resultado.problema
        return
    }
    problema.value = null
    // Una clave nueva: la anterior quedó con la respuesta del intento rechazado.
    claveIdempotencia = nuevaClaveIdempotencia()
    emit('recargado', resultado.data)
    if (!esPendienteInstalacion(resultado.data)) {
        abierto.value = false
    }
}
</script>

<template>
    <UModal
        v-model:open="abierto"
        title="Activar instalación"
        :description="etiquetaServicio(servicio)"
        :dismissible="!enviando"
    >
        <template #body>
            <UForm
                id="form-activar-instalacion"
                ref="formulario"
                :schema="esquema"
                :state="estado"
                class="flex flex-col gap-4"
                data-prueba="form-activar-instalacion"
                @submit="confirmar"
            >
                <UAlert
                    color="info"
                    variant="subtle"
                    icon="i-lucide-hard-hat"
                    description="El servicio pasa a activo: el router le da navegación completa y la facturación arranca desde la fecha de instalación."
                />

                <UFormField
                    label="Instalado el"
                    name="instalado_en"
                    required
                    help="Hora de Guatemala. Por defecto, ahora; no puede ser futura ni anterior al alta del servicio."
                >
                    <UInput
                        v-model="estado.instalado_en"
                        type="datetime-local"
                        class="w-full"
                        data-prueba="instalado-en"
                    />
                </UFormField>

                <UCollapsible
                    class="flex flex-col gap-3"
                    :ui="{ content: 'pt-3' }"
                >
                    <UButton
                        label="Datos de planta (opcional)"
                        icon="i-lucide-cable"
                        trailing-icon="i-lucide-chevron-down"
                        color="neutral"
                        variant="ghost"
                        class="self-start"
                        data-prueba="abrir-planta"
                    />
                    <template #content>
                        <div class="grid gap-4 sm:grid-cols-2">
                            <UFormField
                                v-for="campo in CAMPOS_PLANTA"
                                :key="campo"
                                :label="ETIQUETAS_PLANTA[campo]"
                                :name="`planta.${campo}`"
                                :help="campo === 'potencia_dbm' ? 'En dBm, por ejemplo -19.40' : undefined"
                            >
                                <UInput
                                    v-model="estado.planta[campo]"
                                    :inputmode="campo === 'potencia_dbm' ? 'decimal' : undefined"
                                    class="w-full"
                                    :data-prueba="`planta-${campo}`"
                                >
                                    <template
                                        v-if="campo === 'potencia_dbm'"
                                        #trailing
                                    >
                                        <span class="text-xs text-muted">dBm</span>
                                    </template>
                                </UInput>
                            </UFormField>
                        </div>
                    </template>
                </UCollapsible>

                <UAlert
                    v-if="rechazo"
                    color="error"
                    variant="subtle"
                    icon="i-lucide-circle-alert"
                    :title="rechazo.titulo"
                    :description="rechazo.detalle"
                    :actions="[{ label: 'Recargar servicio', icon: 'i-lucide-rotate-cw', color: 'error', variant: 'outline', loading: recargando, onClick: recargar }]"
                    data-prueba="rechazo-activacion"
                />
                <ProblemaAlerta
                    v-else-if="problema"
                    :problema="problema"
                />
            </UForm>
        </template>

        <template #footer>
            <div class="flex w-full justify-end gap-2">
                <UButton
                    label="Cancelar"
                    color="neutral"
                    variant="ghost"
                    :disabled="enviando"
                    @click="abierto = false"
                />
                <UButton
                    type="submit"
                    form="form-activar-instalacion"
                    label="Activar instalación"
                    icon="i-lucide-circle-check"
                    color="success"
                    :loading="enviando"
                    :disabled="rechazo !== null"
                    data-prueba="confirmar-activar-instalacion"
                />
            </div>
        </template>
    </UModal>
</template>
