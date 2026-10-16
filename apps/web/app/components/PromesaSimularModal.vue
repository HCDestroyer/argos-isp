<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { FormSubmitEvent, SelectItem } from '@nuxt/ui'

/**
 * Simulador de promesas (`POST /promesas/simular`, `promesas.ver`): evalúa todas las reglas de la
 * plantilla para un servicio, monto, fecha y canal sin crear nada. Muestra regla por regla qué
 * aplica y por qué, y después ofrece "Crear con estos datos" (`POST /promesas`, `promesas.crear`).
 */
const props = withDefaults(defineProps<{
    /** Servicio ya elegido (ficha del servicio); sin él se elige cliente y servicio. */
    servicio?: Servicio | null
    /** Cliente con el que empieza la búsqueda de servicio (p. ej. el filtro de `/promesas`). */
    clienteInicial?: Cliente | null
}>(), {
    servicio: null,
    clienteInicial: null,
})

const abierto = defineModel<boolean>('open', { default: false })

const emit = defineEmits<{
    creada: [promesa: Promesa]
}>()

const { puede } = usePermisos()
const hoy = hoyGuatemala()
const formulario = useTemplateRef('formulario')

const estado = reactive<EntradaSimulacion>({ servicio_id: 0, monto: '', vence: '', canal: 'operador' })
const simulando = ref(false)
const problema = ref<Problem | null>(null)
const simulacion = shallowRef<SimulacionPromesa | null>(null)

const creando = ref(false)
const problemaCreacion = ref<Problem | null>(null)
const creada = shallowRef<Promesa | null>(null)
let clave = nuevaClaveIdempotencia()

/* Elegir servicio cuando el modal se abre desde /promesas. */
const clienteId = ref(0)
const clienteElegido = shallowRef<Cliente | null>(null)
const servicios = shallowRef<Servicio[]>([])
const problemaServicios = ref<Problem | null>(null)
const itemsServicio = computed<SelectItem[]>(() => servicios.value
    .filter(s => s.estado !== 'retirado')
    .map(s => ({ label: `${etiquetaServicio(s)} · ${nombrePlan(s)}`, value: s.id, description: ESTADOS_SERVICIO[s.estado].etiqueta })))
const servicioActual = computed(() => props.servicio ?? servicios.value.find(s => s.id === estado.servicio_id) ?? null)

const itemsCanal: SelectItem[] = Object.entries(CANALES_PROMESA).map(([value, label]) => ({ label, value }))

watch(clienteId, async (id) => {
    servicios.value = []
    problemaServicios.value = null
    if (!props.servicio) {
        estado.servicio_id = 0
    }
    if (!id) {
        return
    }
    const resultado = await useServicios().listar({ cliente_id: id })
    servicios.value = resultado.ok ? resultado.data.data : []
    problemaServicios.value = resultado.ok ? null : resultado.problema
    const vigentes = servicios.value.filter(s => s.estado !== 'retirado')
    if (vigentes.length === 1) {
        estado.servicio_id = vigentes[0]?.id ?? 0
    }
})

watch(abierto, (valor) => {
    if (!valor) {
        return
    }
    Object.assign(estado, { servicio_id: props.servicio?.id ?? 0, monto: '', vence: '', canal: puede('promesas.aprobar') ? 'supervisor' : 'operador' })
    if (!props.servicio) {
        clienteElegido.value = props.clienteInicial
        clienteId.value = props.clienteInicial?.id ?? 0
    }
    simulacion.value = null
    problema.value = null
    creada.value = null
    problemaCreacion.value = null
}, { immediate: true })

// Cambiar un dato invalida la simulación: crear solo con lo que se simuló.
watch(() => [estado.servicio_id, estado.monto, estado.vence, estado.canal], () => {
    if (simulacion.value && !creada.value) {
        simulacion.value = null
        problemaCreacion.value = null
    }
})

async function simular(evento: FormSubmitEvent<SalidaSimulacion>) {
    simulando.value = true
    problema.value = null
    const resultado = await usePromesas().simular(cuerpoSimulacion(evento.data))
    simulando.value = false
    if (resultado.ok) {
        simulacion.value = resultado.data
        clave = nuevaClaveIdempotencia()
        return
    }
    simulacion.value = null
    problema.value = resultado.problema
    if (resultado.problema.status === 422) {
        formulario.value?.setErrors(erroresDeFormulario(resultado.problema).map(e => (e.name === 'vence_en' ? { ...e, name: 'vence' } : e)))
    }
}

const decision = computed(() => (simulacion.value ? DECISIONES[decisionSimulacion(simulacion.value.resultado)] : null))
const creable = computed(() => simulacion.value !== null && puede('promesas.crear') && creableDesdeSimulacion(simulacion.value))
const validacionesFallidas = computed(() => simulacion.value?.validaciones.filter(v => !v.ok) ?? [])

/** Crea con exactamente el monto, el vencimiento y el canal simulados (los que eligió la API si se dejaron vacíos). */
async function crear() {
    const datos = simulacion.value
    if (!datos || !creable.value || (datos.canal !== 'operador' && datos.canal !== 'supervisor')) {
        return
    }
    creando.value = true
    problemaCreacion.value = null
    const resultado = await usePromesas().crear({ servicio_id: datos.servicio_id, monto: datos.monto, vence_en: datos.vence_en, canal: datos.canal }, clave)
    creando.value = false
    if (!resultado.ok) {
        problemaCreacion.value = resultado.problema
        return
    }
    creada.value = resultado.data
    emit('creada', resultado.data)
}
</script>

<template>
    <UModal
        v-model:open="abierto"
        :title="creada ? 'Promesa creada' : 'Simular promesa de pago'"
        :description="servicioActual ? `${etiquetaServicio(servicioActual)} · ${nombreCliente(servicioActual)}` : 'No crea nada: muestra qué decidirían las reglas de la plantilla.'"
        :dismissible="!simulando && !creando"
        :ui="{ content: 'sm:max-w-2xl' }"
    >
        <template #body>
            <div
                v-if="creada"
                class="flex flex-col gap-4"
                data-prueba="simulador-creada"
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

            <div
                v-else
                class="flex flex-col gap-4"
            >
                <UForm
                    id="form-simular-promesa"
                    ref="formulario"
                    :schema="esquemaSimulacion"
                    :state="estado"
                    class="flex flex-col gap-4"
                    @submit="simular"
                >
                    <template v-if="!servicio">
                        <UFormField label="Cliente">
                            <ClienteSelector
                                v-model="clienteId"
                                :seleccionado="clienteElegido"
                                class="w-full"
                                @elegido="clienteElegido = $event"
                            />
                        </UFormField>
                        <ProblemaAlerta
                            v-if="problemaServicios"
                            :problema="problemaServicios"
                        />
                        <UFormField
                            v-else-if="clienteId"
                            label="Servicio"
                            name="servicio_id"
                            required
                        >
                            <USelect
                                v-model="estado.servicio_id"
                                :items="itemsServicio"
                                placeholder="Elige el servicio"
                                class="w-full"
                                data-prueba="simulador-servicio"
                            />
                        </UFormField>
                    </template>

                    <div class="grid gap-4 sm:grid-cols-3">
                        <UFormField
                            label="Monto"
                            name="monto"
                            help="Vacío: la deuda pendiente."
                        >
                            <UInput
                                v-model="estado.monto"
                                inputmode="decimal"
                                placeholder="Deuda pendiente"
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
                            help="Vacío: mañana."
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
                        >
                            <USelect
                                v-model="estado.canal"
                                :items="itemsCanal"
                                class="w-full"
                                data-prueba="simulador-canal"
                            />
                        </UFormField>
                    </div>

                    <ProblemaAlerta
                        v-if="problema"
                        :problema="problema"
                    />
                </UForm>

                <section
                    v-if="simulacion"
                    class="flex flex-col gap-4"
                    aria-label="Resultado de la simulación"
                    data-prueba="simulacion"
                >
                    <div class="flex flex-col gap-2 rounded-lg border border-default p-4">
                        <div class="flex flex-wrap items-center gap-2">
                            <UBadge
                                v-if="decision"
                                :label="decision.etiqueta"
                                :icon="decision.icono"
                                :color="decision.color"
                                variant="solid"
                                data-prueba="simulacion-decision"
                            />
                            <span
                                v-if="simulacion.regla"
                                class="text-sm text-highlighted"
                                data-prueba="simulacion-regla"
                            >
                                Decide: <strong>{{ etiquetaRegla(simulacion.regla) }}</strong>
                            </span>
                        </div>
                        <p class="text-sm text-default">
                            {{ simulacion.motivo }}
                        </p>
                        <p class="text-xs text-muted">
                            {{ formatearQuetzales(simulacion.monto) }} · vence {{ formatearFechaHora(simulacion.vence_en) }} · canal {{ CANALES_PROMESA[simulacion.canal] }}
                        </p>
                    </div>

                    <UAlert
                        v-if="validacionesFallidas.length"
                        color="error"
                        variant="subtle"
                        icon="i-lucide-circle-alert"
                        title="Crear con estos datos daría error"
                        :description="validacionesFallidas.map(v => v.detalle).join(' · ')"
                        data-prueba="simulacion-validaciones"
                    />
                    <UAlert
                        v-if="simulacion.suspension_manual"
                        color="warning"
                        variant="subtle"
                        icon="i-lucide-hand"
                        title="Suspendido a mano"
                        description="La promesa quedaría activa pero no reactivaría el servicio: un operador lo suspendió."
                    />

                    <dl class="grid grid-cols-2 gap-3 rounded-lg bg-elevated p-3 text-sm sm:grid-cols-4">
                        <DatoFicha
                            etiqueta="Deuda pendiente"
                            :valor="formatearQuetzales(simulacion.deuda.pendiente)"
                        />
                        <DatoFicha
                            etiqueta="Vencida"
                            :valor="`${formatearQuetzales(simulacion.deuda.vencida)} (${simulacion.deuda.facturas_vencidas})`"
                        />
                        <DatoFicha
                            etiqueta="Último día posible"
                            :valor="formatearFecha(simulacion.limites.fecha_maxima)"
                        />
                        <DatoFicha
                            etiqueta="Promesas del periodo"
                            :valor="cupoPeriodo(simulacion.limites)"
                        />
                        <DatoFicha
                            v-if="!abonoFaltante(simulacion.limites).isZero()"
                            etiqueta="Abono que falta"
                            :valor="formatearQuetzales(abonoFaltante(simulacion.limites))"
                        />
                        <DatoFicha
                            v-if="simulacion.historial.cumplimiento_pct !== null"
                            etiqueta="Cumplimiento reciente"
                            :valor="`${simulacion.historial.cumplimiento_pct} % (${simulacion.historial.cumplidas} de ${simulacion.historial.resueltas})`"
                        />
                    </dl>

                    <ol
                        class="flex flex-col divide-y divide-default rounded-lg border border-default"
                        aria-label="Reglas evaluadas, en orden"
                        data-prueba="simulacion-reglas"
                    >
                        <li
                            v-for="regla in simulacion.reglas"
                            :key="regla.regla"
                            class="flex gap-3 px-3 py-2.5"
                            :class="regla.regla === simulacion.regla ? 'bg-elevated/60' : ''"
                            :data-prueba="`regla-${regla.regla}`"
                            :data-estado="estadoRegla(regla)"
                        >
                            <UIcon
                                :name="ESTADOS_REGLA[estadoRegla(regla)].icono"
                                :class="['mt-0.5 size-4 shrink-0', ESTADOS_REGLA[estadoRegla(regla)].clase]"
                            />
                            <div class="flex min-w-0 flex-1 flex-col gap-0.5">
                                <div class="flex flex-wrap items-center gap-x-2 gap-y-1">
                                    <span
                                        class="text-sm font-medium"
                                        :class="estadoRegla(regla) === 'no_aplica' ? 'text-muted' : 'text-highlighted'"
                                    >{{ etiquetaRegla(regla.regla) }}</span>
                                    <span class="sr-only">{{ ESTADOS_REGLA[estadoRegla(regla)].etiqueta }}</span>
                                    <UBadge
                                        v-if="regla.regla === simulacion.regla"
                                        label="Decide"
                                        :color="decision?.color ?? 'neutral'"
                                        variant="subtle"
                                        size="sm"
                                    />
                                    <UBadge
                                        v-if="origenRegla(regla)"
                                        :label="origenRegla(regla) ?? ''"
                                        color="neutral"
                                        variant="outline"
                                        size="sm"
                                    />
                                </div>
                                <span class="text-xs text-muted">{{ regla.detalle }}</span>
                            </div>
                        </li>
                    </ol>

                    <p
                        v-if="puede('promesas.crear') && !creable && !validacionesFallidas.length"
                        class="text-xs text-muted"
                        data-prueba="simulacion-no-creable"
                    >
                        <template v-if="simulacion.resultado === 'rechazada'">
                            Con estos datos la promesa se rechazaría: cambia la fecha, el monto o el canal y vuelve a simular.
                        </template>
                        <template v-else>
                            Desde el panel se crean promesas con canal Operador o Supervisor; las del portal y la IA las crea el cliente o el agente.
                        </template>
                    </p>
                    <ProblemaAlerta
                        v-if="problemaCreacion"
                        :problema="problemaCreacion"
                    />
                </section>
            </div>
        </template>

        <template #footer>
            <div class="flex w-full flex-wrap justify-end gap-2">
                <UButton
                    v-if="creada"
                    label="Listo"
                    @click="abierto = false"
                />
                <template v-else>
                    <UButton
                        label="Cerrar"
                        color="neutral"
                        variant="ghost"
                        :disabled="simulando || creando"
                        @click="abierto = false"
                    />
                    <UButton
                        type="submit"
                        form="form-simular-promesa"
                        :label="simulacion ? 'Volver a simular' : 'Simular'"
                        icon="i-lucide-flask-conical"
                        :color="simulacion ? 'neutral' : 'primary'"
                        :variant="simulacion ? 'outline' : 'solid'"
                        :loading="simulando"
                        data-prueba="simular"
                    />
                    <UButton
                        v-if="creable"
                        label="Crear con estos datos"
                        icon="i-lucide-calendar-clock"
                        :loading="creando"
                        data-prueba="crear-simulada"
                        @click="crear"
                    />
                </template>
            </div>
        </template>
    </UModal>
</template>
