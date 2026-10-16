<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { FormSubmitEvent } from '@nuxt/ui'

/**
 * Crea una promesa de pago para un servicio (`POST /promesas`, `promesas.crear`). La API evalúa
 * las reglas de la plantilla y responde 201 aunque la rechace; el modal se queda abierto con el
 * resultado de la evaluación (qué regla aplicó y la decisión).
 */
const props = withDefaults(defineProps<{
    servicio: Servicio
    /** Monto sugerido (lo pendiente del servicio), si se pudo leer. */
    sugerido?: string | null
}>(), {
    sugerido: null,
})

const abierto = defineModel<boolean>('open', { default: false })

const emit = defineEmits<{
    creada: [promesa: Promesa]
}>()

const { puede } = usePermisos()
const hoy = hoyGuatemala()
const esquema = esquemaPromesa(hoy)

const estado = reactive<{ monto: string, vence: string, canal: 'operador' | 'supervisor' }>({ monto: '', vence: '', canal: 'operador' })
const enviando = ref(false)
const problema = ref<Problem | null>(null)
const creada = shallowRef<Promesa | null>(null)
const formulario = useTemplateRef<{ setErrors: (errores: ReturnType<typeof erroresDeFormulario>) => void }>('formulario')
let clave = nuevaClaveIdempotencia()

/** Supervisor solo para quien aprueba promesas (sus límites son más amplios). */
const itemsCanal = computed(() => [
    { label: CANALES_PROMESA.operador, value: 'operador' },
    ...(puede('promesas.aprobar') ? [{ label: CANALES_PROMESA.supervisor, value: 'supervisor' }] : []),
])

watch(abierto, (valor) => {
    if (valor) {
        estado.monto = props.sugerido ?? ''
        estado.vence = sumarDiasFecha(hoy, 3)
        estado.canal = 'operador'
        problema.value = null
        creada.value = null
        clave = nuevaClaveIdempotencia()
    }
})

// El pendiente llega después de abrir (estado de cuenta): se usa si aún no escribieron monto.
watch(() => props.sugerido, (valor) => {
    if (valor && abierto.value && !estado.monto && !creada.value) {
        estado.monto = valor
    }
})

async function enviar(evento: FormSubmitEvent<DatosFormularioPromesa>) {
    enviando.value = true
    problema.value = null
    const resultado = await usePromesas().crear({
        servicio_id: props.servicio.id,
        monto: evento.data.monto,
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
}
</script>

<template>
    <UModal
        v-model:open="abierto"
        :title="creada ? 'Resultado de la promesa' : 'Promesa de pago'"
        :description="etiquetaServicio(servicio)"
        :dismissible="!enviando"
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
                        :color="ESTADOS_PROMESA[creada.estado].color"
                        variant="subtle"
                        size="sm"
                    />
                </p>
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
                <div class="grid gap-4 sm:grid-cols-2">
                    <UFormField
                        label="Monto prometido"
                        name="monto"
                        required
                        :help="sugerido ? `Pendiente del servicio: ${formatearQuetzales(sugerido)}` : undefined"
                    >
                        <UInput
                            v-model="estado.monto"
                            inputmode="decimal"
                            placeholder="175.00"
                            autofocus
                            class="w-full"
                        >
                            <template #leading>
                                <span class="text-sm text-muted">Q</span>
                            </template>
                        </UInput>
                    </UFormField>

                    <UFormField
                        label="Pagará a más tardar"
                        name="vence"
                        required
                        help="Hasta el final de ese día (hora de Guatemala)."
                    >
                        <UInput
                            v-model="estado.vence"
                            type="date"
                            :min="hoy"
                            class="w-full"
                        />
                    </UFormField>
                </div>

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
                        label="Probar otra fecha o monto"
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
                    />
                </template>
            </div>
        </template>
    </UModal>
</template>
