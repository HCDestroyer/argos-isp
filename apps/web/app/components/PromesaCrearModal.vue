<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { FormSubmitEvent } from '@nuxt/ui'

/**
 * Crea una promesa de pago para un servicio (`POST /promesas`, `promesas.crear`). La promesa cubre
 * todo lo vencido (decisión del PM, 29 oct): nadie escribe el monto. Antes de crear, el modal lee
 * de `POST /promesas/simular` (`promesas.ver`) qué facturas cubriría, el total, el abono inicial
 * requerido y lo ya abonado, y la fecha límite. La API evalúa las reglas de la plantilla y responde
 * 201 aunque la rechace; el modal se queda abierto con el resultado de la evaluación.
 */
const props = defineProps<{
    servicio: Servicio
}>()

const abierto = defineModel<boolean>('open', { default: false })

const emit = defineEmits<{
    creada: [promesa: Promesa]
}>()

const { puede } = usePermisos()
const hoy = hoyGuatemala()
const esquema = esquemaPromesa(hoy)

const estado = reactive<{ vence: string, canal: 'operador' | 'supervisor' }>({ vence: '', canal: 'operador' })
const enviando = ref(false)
const problema = ref<Problem | null>(null)
const creada = shallowRef<Promesa | null>(null)
const formulario = useTemplateRef<{ setErrors: (errores: ReturnType<typeof erroresDeFormulario>) => void }>('formulario')
let clave = nuevaClaveIdempotencia()

/* Lo que cubriría (simulación sin fecha, por el canal elegido). */
const simulacion = shallowRef<SimulacionPromesa | null>(null)
const cargandoCobertura = ref(false)
const problemaCobertura = ref<Problem | null>(null)
let consulta = 0

const cobertura = computed(() => (simulacion.value ? coberturaDeSimulacion(simulacion.value) : null))
/** Sin cobertura leída no se crea: el formulario debe mostrar qué cubre antes. */
const motivo = computed(() => (simulacion.value ? motivoNoCreable(simulacion.value) : null))
const creable = computed(() => cobertura.value !== null && motivo.value === null && !cargandoCobertura.value)

/** Supervisor solo para quien aprueba promesas (sus límites son más amplios). */
const itemsCanal = computed(() => [
    { label: CANALES_PROMESA.operador, value: 'operador' },
    ...(puede('promesas.aprobar') ? [{ label: CANALES_PROMESA.supervisor, value: 'supervisor' }] : []),
])

async function cargarCobertura() {
    const actual = ++consulta
    problemaCobertura.value = null
    if (!puede('promesas.ver')) {
        simulacion.value = null
        problemaCobertura.value = problemaSinPermiso('promesas.ver')
        return
    }
    cargandoCobertura.value = true
    const resultado = await usePromesas().cobertura(props.servicio.id, estado.canal)
    if (actual !== consulta) {
        return
    }
    cargandoCobertura.value = false
    simulacion.value = resultado.ok ? resultado.data : null
    problemaCobertura.value = resultado.ok ? null : resultado.problema
    // El plazo por defecto (3 días) no pasa del último día que permite la plantilla.
    if (resultado.ok && estado.vence > resultado.data.limites.fecha_maxima && resultado.data.limites.fecha_maxima >= hoy) {
        estado.vence = resultado.data.limites.fecha_maxima
    }
}

watch(abierto, (valor) => {
    if (valor) {
        estado.vence = sumarDiasFecha(hoy, 3)
        estado.canal = 'operador'
        problema.value = null
        creada.value = null
        simulacion.value = null
        clave = nuevaClaveIdempotencia()
        void cargarCobertura()
    }
}, { immediate: true })

// El canal cambia los límites (plazo y fecha máxima).
watch(() => estado.canal, () => {
    if (abierto.value && !creada.value) {
        void cargarCobertura()
    }
})

async function enviar(evento: FormSubmitEvent<DatosFormularioPromesa>) {
    if (!creable.value) {
        return
    }
    enviando.value = true
    problema.value = null
    const resultado = await usePromesas().crear({
        servicio_id: props.servicio.id,
        vence_en: finDiaGuatemala(evento.data.vence),
        canal: evento.data.canal,
    }, clave)
    enviando.value = false
    if (resultado.ok) {
        creada.value = resultado.data
        emit('creada', resultado.data)
        return
    }
    problema.value = resultado.problema
    if (resultado.problema.status === 422) {
        formulario.value?.setErrors(erroresDeFormulario(resultado.problema).map(e => (e.name === 'vence_en' ? { ...e, name: 'vence' } : e)))
    }
}

function otra() {
    creada.value = null
    problema.value = null
    clave = nuevaClaveIdempotencia()
    void cargarCobertura()
}
</script>

<template>
    <UModal
        v-model:open="abierto"
        :title="creada ? 'Resultado de la promesa' : 'Promesa de pago'"
        :description="etiquetaServicio(servicio)"
        :dismissible="!enviando"
        :ui="{ content: 'sm:max-w-xl' }"
    >
        <template #body>
            <div
                v-if="creada"
                class="flex flex-col gap-4"
                data-prueba="promesa-creada"
            >
                <p class="text-sm text-default">
                    Promesa #{{ creada.id }} por <strong>{{ formatearQuetzales(creada.monto) }}</strong>, vence
                    {{ formatearFechaHora(creada.vence_en) }} ·
                    <UBadge
                        :label="ESTADOS_PROMESA[creada.estado].etiqueta"
                        :icon="ESTADOS_PROMESA[creada.estado].icono"
                        :color="ESTADOS_PROMESA[creada.estado].color"
                        variant="subtle"
                        size="sm"
                    />
                </p>
                <PromesaCumplimiento :promesa="creada" />
                <EvaluacionPromesa :promesa="creada" />
            </div>

            <UForm
                v-else
                id="form-promesa"
                ref="formulario"
                :schema="esquema"
                :state="estado"
                class="flex flex-col gap-4"
                @submit="enviar"
            >
                <ProblemaAlerta
                    v-if="problemaCobertura"
                    :problema="problemaCobertura"
                    :reintentar="cargarCobertura"
                    :reintentando="cargandoCobertura"
                />
                <USkeleton
                    v-else-if="!cobertura"
                    class="h-32 w-full"
                />
                <PromesaCobertura
                    v-else
                    :cobertura="cobertura"
                    :class="cargandoCobertura ? 'opacity-60' : ''"
                />

                <div class="grid gap-4 sm:grid-cols-2">
                    <UFormField
                        label="Pagará a más tardar"
                        name="vence"
                        required
                        :help="cobertura ? `Hasta el final de ese día (hora de Guatemala); el último posible es el ${formatearFecha(cobertura.fechaMaxima)}.` : 'Hasta el final de ese día (hora de Guatemala).'"
                    >
                        <UInput
                            v-model="estado.vence"
                            type="date"
                            :min="hoy"
                            class="w-full"
                        />
                    </UFormField>

                    <UFormField
                        label="Canal"
                        name="canal"
                        help="Las reglas de la plantilla cambian según el canal."
                    >
                        <USelect
                            v-model="estado.canal"
                            :items="itemsCanal"
                            class="w-full"
                        />
                    </UFormField>
                </div>

                <p
                    v-if="motivo"
                    class="flex items-start gap-2 text-sm text-muted"
                    data-prueba="motivo-no-creable"
                >
                    <UIcon
                        name="i-lucide-info"
                        class="mt-0.5 size-4 shrink-0"
                    />
                    <span>{{ motivo }}</span>
                </p>

                <ProblemaAlerta
                    v-if="problema"
                    :problema="problema"
                />
            </UForm>
        </template>

        <template #footer>
            <div class="flex w-full justify-end gap-2">
                <template v-if="creada">
                    <UButton
                        v-if="creada.estado === 'rechazada'"
                        label="Probar otra fecha"
                        icon="i-lucide-rotate-ccw"
                        color="neutral"
                        variant="outline"
                        @click="otra"
                    />
                    <UButton
                        label="Listo"
                        @click="abierto = false"
                    />
                </template>
                <template v-else>
                    <UButton
                        label="Cancelar"
                        color="neutral"
                        variant="ghost"
                        :disabled="enviando"
                        @click="abierto = false"
                    />
                    <UButton
                        type="submit"
                        form="form-promesa"
                        label="Crear promesa"
                        icon="i-lucide-calendar-clock"
                        :loading="enviando"
                        :disabled="!creable"
                        :title="motivo ?? undefined"
                        data-prueba="crear-promesa"
                    />
                </template>
            </div>
        </template>
    </UModal>
</template>
