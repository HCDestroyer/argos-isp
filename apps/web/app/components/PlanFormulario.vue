<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { FormSubmitEvent, SelectItem } from '@nuxt/ui'

/**
 * Alta y edición de un plan con su modelo de velocidad (`contratos/velocidad.md`): reuso 1:N,
 * garantía (CIR), ráfaga y prioridad, con la vista previa del `Mikrotik-Rate-Limit` que calcula la
 * API (`POST /planes/vista-previa`). Los 422 al guardar se muestran junto a cada campo.
 */
const props = withDefaults(defineProps<{
    /** Plan a editar; sin él, alta. */
    plan?: Plan | null
}>(), {
    plan: null,
})

const abierto = defineModel<boolean>('open', { default: false })

const emit = defineEmits<{
    guardado: [plan: Plan]
}>()

const toast = useToast()
const formulario = useTemplateRef('formulario')
const estado = reactive<EntradaPlan>(entradaPlanVacia())
const enviando = ref(false)
const problema = ref<Problem | null>(null)
const activosEjemplo = ref<number | null>(20)

watch(abierto, (valor) => {
    if (valor) {
        Object.assign(estado, props.plan ? entradaDesdePlan(props.plan) : entradaPlanVacia())
        problema.value = null
    }
}, { immediate: true })

const itemsDualStack: SelectItem[] = [
    { label: 'IPv4 e IPv6', value: 'ambos' },
    { label: 'Solo IPv4', value: 'v4' },
    { label: 'Solo IPv6', value: 'v6' },
]
const itemsPrefijo: SelectItem[] = [64, 56, 48].map(n => ({ label: `/${n}`, value: n }))

/*
 * Vista previa del rate-limit: la calcula la API (`POST /planes/vista-previa`) 400 ms después del
 * último cambio. Solo se muestra la respuesta de la última petición; con 422 se ven las reglas que
 * fallan y con cualquier otro error, el aviso con "Reintentar". Nunca se muestra una cadena
 * calculada en el panel.
 */
const ESPERA_VISTA_PREVIA_MS = 400
const vistaPrevia = shallowRef<VistaPreviaVelocidad | null>(null)
const erroresVistaPrevia = ref<string[]>([])
const problemaVistaPrevia = ref<Problem | null>(null)
const cargandoVistaPrevia = ref(false)
const cuerpoVista = computed(() => cuerpoVistaPrevia(estado, activosEjemplo.value))
let temporizadorVista: ReturnType<typeof setTimeout> | undefined
let solicitudVista = 0

async function pedirVistaPrevia() {
    const cuerpo = cuerpoVista.value
    const actual = ++solicitudVista
    if (!cuerpo) {
        vistaPrevia.value = null
        erroresVistaPrevia.value = []
        problemaVistaPrevia.value = null
        cargandoVistaPrevia.value = false
        return
    }
    cargandoVistaPrevia.value = true
    const resultado = await usePlanes().vistaPrevia(cuerpo)
    if (actual !== solicitudVista) {
        return
    }
    cargandoVistaPrevia.value = false
    if (resultado.ok) {
        vistaPrevia.value = resultado.data
        erroresVistaPrevia.value = []
        problemaVistaPrevia.value = null
        return
    }
    vistaPrevia.value = null
    const porCampo = resultado.problema.status === 422 ? (resultado.problema.errors ?? []).map(e => e.message) : []
    erroresVistaPrevia.value = porCampo
    problemaVistaPrevia.value = porCampo.length ? null : resultado.problema
}

watch(cuerpoVista, () => {
    clearTimeout(temporizadorVista)
    if (!abierto.value) {
        return
    }
    cargandoVistaPrevia.value = cuerpoVista.value !== null
    temporizadorVista = setTimeout(() => void pedirVistaPrevia(), ESPERA_VISTA_PREVIA_MS)
}, { deep: true })

watch(abierto, (valor) => {
    clearTimeout(temporizadorVista)
    if (valor) {
        void pedirVistaPrevia()
    }
}, { immediate: true })

onBeforeUnmount(() => clearTimeout(temporizadorVista))

function ayudaKbps(valor: number | null | undefined): string | undefined {
    return typeof valor === 'number' && valor > 0 ? formatearVelocidad(valor) : undefined
}

async function enviar(evento: FormSubmitEvent<SalidaPlan>) {
    enviando.value = true
    problema.value = null
    const resultado = props.plan
        ? await usePlanes().editar(props.plan.id, cambiosPlan(evento.data, props.plan.version))
        : await usePlanes().crear(cuerpoPlan(evento.data))
    enviando.value = false
    if (resultado.ok) {
        abierto.value = false
        emit('guardado', resultado.data)
        // Tipo de plan (A1): `dedicado` asimétrico o compartido se guarda igual, con aviso.
        avisarAdvertencias(toast, resultado.data.warnings, 'Plan guardado con advertencias')
        return
    }
    // 409 `plan_duplicado` (A1): es del nombre, se muestra junto al campo.
    if (resultado.problema.type.endsWith(':plan_duplicado')) {
        formulario.value?.setErrors([{ name: 'nombre', message: resultado.problema.detail ?? 'Ya existe un plan con ese nombre' }])
        return
    }
    const errores = erroresDeFormulario(resultado.problema)
    if (errores.length) {
        formulario.value?.setErrors(errores)
    }
    const campos = new Set(Object.keys(estado))
    if (!errores.length || errores.some(e => !e.name || !campos.has(e.name))) {
        problema.value = resultado.problema
    }
}
</script>

<template>
    <USlideover
        v-model:open="abierto"
        :title="plan ? `Editar ${plan.nombre}` : 'Nuevo plan'"
        description="Velocidades en kbps (1 Mbps = 1000 kbps). RouterOS recibe subida/bajada."
        :dismissible="!enviando"
        :ui="{ content: 'sm:max-w-2xl' }"
    >
        <template #body>
            <UForm
                id="form-plan"
                ref="formulario"
                :schema="esquemaPlan"
                :state="estado"
                class="flex flex-col gap-6"
                @submit="enviar"
            >
                <section class="grid gap-4 sm:grid-cols-2">
                    <UFormField
                        label="Nombre"
                        name="nombre"
                        required
                    >
                        <UInput
                            v-model="estado.nombre"
                            placeholder="Hogar 20 Mbps"
                            class="w-full"
                        />
                    </UFormField>
                    <UFormField
                        label="Precio mensual"
                        name="precio"
                        required
                    >
                        <UInput
                            v-model="estado.precio"
                            inputmode="decimal"
                            placeholder="175.00"
                            class="w-full"
                        >
                            <template #leading>
                                <span class="text-sm text-muted">Q</span>
                            </template>
                        </UInput>
                    </UFormField>
                    <UFormField
                        label="Tipo de plan"
                        name="tipo"
                        help="Solo cambia avisos y reportes: un dedicado suele ser 1:1 y simétrico."
                        class="sm:col-span-2"
                    >
                        <USelect
                            v-model="estado.tipo"
                            :items="ITEMS_TIPO_PLAN"
                            class="w-full"
                            data-prueba="plan-tipo"
                        />
                    </UFormField>
                </section>

                <section class="flex flex-col gap-3">
                    <h3 class="text-sm font-medium text-highlighted">
                        Velocidad máxima (MIR) y limitada
                    </h3>
                    <div class="grid gap-4 sm:grid-cols-2">
                        <UFormField
                            label="Bajada"
                            name="bajada_kbps"
                            required
                            :help="ayudaKbps(estado.bajada_kbps)"
                        >
                            <UInputNumber
                                v-model="estado.bajada_kbps"
                                :min="1"
                                :step="1000"
                                :format-options="{ useGrouping: false }"
                                :step-snapping="false"
                                class="w-full"
                                data-prueba="plan-bajada"
                            />
                        </UFormField>
                        <UFormField
                            label="Subida"
                            name="subida_kbps"
                            required
                            :help="ayudaKbps(estado.subida_kbps)"
                        >
                            <UInputNumber
                                v-model="estado.subida_kbps"
                                :min="1"
                                :step="1000"
                                :format-options="{ useGrouping: false }"
                                :step-snapping="false"
                                class="w-full"
                            />
                        </UFormField>
                        <UFormField
                            label="Bajada limitada"
                            name="bajada_limitada_kbps"
                            required
                            :help="ayudaKbps(estado.bajada_limitada_kbps)"
                        >
                            <UInputNumber
                                v-model="estado.bajada_limitada_kbps"
                                :min="1"
                                :step="256"
                                :format-options="{ useGrouping: false }"
                                :step-snapping="false"
                                class="w-full"
                            />
                        </UFormField>
                        <UFormField
                            label="Subida limitada"
                            name="subida_limitada_kbps"
                            required
                            :help="ayudaKbps(estado.subida_limitada_kbps)"
                        >
                            <UInputNumber
                                v-model="estado.subida_limitada_kbps"
                                :min="1"
                                :step="256"
                                :format-options="{ useGrouping: false }"
                                :step-snapping="false"
                                class="w-full"
                            />
                        </UFormField>
                    </div>
                </section>

                <section class="flex flex-col gap-3">
                    <h3 class="text-sm font-medium text-highlighted">
                        Reuso, garantía y prioridad
                    </h3>
                    <div class="grid gap-4 sm:grid-cols-3">
                        <UFormField
                            label="Reuso 1:N"
                            name="reuso"
                            required
                            help="1 = dedicado; 4 = cuatro clientes comparten la capacidad de uno."
                        >
                            <UInputNumber
                                v-model="estado.reuso"
                                :min="1"
                                :max="64"
                                :format-options="{ useGrouping: false }"
                                :step-snapping="false"
                                class="w-full"
                                data-prueba="plan-reuso"
                            />
                        </UFormField>
                        <UFormField
                            label="Garantizado (CIR)"
                            name="garantizado_pct"
                            :help="estado.garantia_automatica ? `Automático: 100 / reuso${vistaPrevia ? ` = ${vistaPrevia.garantizado_pct_efectivo} %` : ''}` : `Hasta 100 / ${estado.reuso || 'reuso'} % con reuso 1:${estado.reuso || 'N'}.`"
                        >
                            <div class="flex flex-col gap-2">
                                <USwitch
                                    v-model="estado.garantia_automatica"
                                    label="Automático"
                                />
                                <UInputNumber
                                    v-if="!estado.garantia_automatica"
                                    v-model="estado.garantizado_pct"
                                    :min="0.01"
                                    :max="100"
                                    :step="0.01"
                                    :format-options="{ maximumFractionDigits: 2, useGrouping: false }"
                                    :step-snapping="false"
                                    class="w-full"
                                    data-prueba="plan-garantizado"
                                />
                            </div>
                        </UFormField>
                        <UFormField
                            label="Prioridad"
                            name="prioridad"
                            required
                            help="Corporativos alta, residenciales 8."
                        >
                            <USelect
                                v-model="estado.prioridad"
                                :items="PRIORIDADES"
                                class="w-full"
                            />
                        </UFormField>
                    </div>
                </section>

                <section class="flex flex-col gap-3">
                    <div class="flex items-center justify-between gap-2">
                        <h3 class="text-sm font-medium text-highlighted">
                            Ráfaga (burst)
                        </h3>
                        <USwitch
                            v-model="estado.con_rafaga"
                            label="Con ráfaga"
                            data-prueba="plan-con-rafaga"
                        />
                    </div>
                    <p
                        v-if="!estado.con_rafaga"
                        class="text-xs text-muted"
                    >
                        Sin ráfaga: el servicio nunca pasa de la velocidad máxima.
                    </p>
                    <div
                        v-else
                        class="grid gap-4 sm:grid-cols-2"
                    >
                        <UFormField
                            label="Ráfaga de bajada"
                            name="rafaga_bajada_kbps"
                            :help="ayudaKbps(estado.rafaga_bajada_kbps) ?? 'Vacía: sin ráfaga de bajada.'"
                        >
                            <UInputNumber
                                v-model="estado.rafaga_bajada_kbps"
                                :min="1"
                                :step="1000"
                                :format-options="{ useGrouping: false }"
                                :step-snapping="false"
                                class="w-full"
                                data-prueba="plan-rafaga-bajada"
                            />
                        </UFormField>
                        <UFormField
                            label="Ráfaga de subida"
                            name="rafaga_subida_kbps"
                            :help="ayudaKbps(estado.rafaga_subida_kbps) ?? 'Vacía: sin ráfaga de subida.'"
                        >
                            <UInputNumber
                                v-model="estado.rafaga_subida_kbps"
                                :min="1"
                                :step="1000"
                                :format-options="{ useGrouping: false }"
                                :step-snapping="false"
                                class="w-full"
                            />
                        </UFormField>
                        <UFormField
                            label="Umbral"
                            name="rafaga_umbral_pct"
                            help="% de la velocidad máxima bajo el que vuelve a ganar ráfaga."
                        >
                            <UInputNumber
                                v-model="estado.rafaga_umbral_pct"
                                :min="1"
                                :max="99"
                                :format-options="{ useGrouping: false }"
                                :step-snapping="false"
                                class="w-full"
                            />
                        </UFormField>
                        <UFormField
                            label="Tiempo"
                            name="rafaga_segundos"
                            help="Segundos de promedio (burst-time)."
                        >
                            <UInputNumber
                                v-model="estado.rafaga_segundos"
                                :min="1"
                                :max="3600"
                                :format-options="{ useGrouping: false }"
                                :step-snapping="false"
                                class="w-full"
                            />
                        </UFormField>
                    </div>
                </section>

                <section
                    class="flex flex-col gap-3 surface-card p-4"
                    aria-label="Vista previa del rate-limit"
                    :aria-busy="cargandoVistaPrevia"
                    data-prueba="vista-rate-limit"
                >
                    <div class="flex flex-wrap items-center justify-between gap-2">
                        <h3 class="text-sm font-medium text-highlighted">
                            Vista previa del rate-limit
                        </h3>
                        <span class="flex items-center gap-1.5 text-xs text-muted">
                            <UIcon
                                v-if="cargandoVistaPrevia"
                                name="i-lucide-loader-circle"
                                class="size-3.5 animate-spin"
                            />
                            Calculada por la API, sin guardar
                        </span>
                    </div>
                    <p
                        v-if="!cuerpoVista"
                        class="text-sm text-muted"
                    >
                        Completa las velocidades para ver la cadena.
                    </p>
                    <UAlert
                        v-else-if="erroresVistaPrevia.length"
                        color="warning"
                        variant="subtle"
                        icon="i-lucide-triangle-alert"
                        title="La API rechaza estos valores"
                        :description="erroresVistaPrevia.join(' · ')"
                        data-prueba="vista-rate-limit-errores"
                    />
                    <ProblemaAlerta
                        v-else-if="problemaVistaPrevia"
                        :problema="problemaVistaPrevia"
                        :reintentar="pedirVistaPrevia"
                        :reintentando="cargandoVistaPrevia"
                    />
                    <p
                        v-else-if="!vistaPrevia"
                        class="text-sm text-muted"
                    >
                        Calculando…
                    </p>
                    <template v-else>
                        <dl
                            class="flex flex-col gap-2 text-sm"
                            :class="{ 'opacity-60': cargandoVistaPrevia }"
                        >
                            <div>
                                <dt class="text-xs text-muted">
                                    Activo
                                </dt>
                                <dd
                                    class="font-mono break-all text-highlighted"
                                    data-prueba="rate-limit-activo"
                                >
                                    {{ vistaPrevia.rate_limit }}
                                </dd>
                            </div>
                            <div>
                                <dt class="text-xs text-muted">
                                    Limitado (sin ráfaga)
                                </dt>
                                <dd
                                    class="font-mono break-all"
                                    data-prueba="rate-limit-limitado"
                                >
                                    {{ vistaPrevia.rate_limit_limitado }}
                                </dd>
                            </div>
                        </dl>
                        <ul class="grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-3">
                            <li
                                v-for="parte in partesRateLimit(vistaPrevia.rate_limit)"
                                :key="parte.etiqueta"
                                class="flex flex-col"
                            >
                                <span class="text-muted">{{ parte.etiqueta }}</span>
                                <span class="font-mono">{{ parte.valor }}</span>
                            </li>
                        </ul>
                    </template>
                    <div
                        v-if="cuerpoVista"
                        class="flex flex-wrap items-center gap-2 border-t border-default pt-3 text-xs text-muted"
                    >
                        <span>Cola padre del plan con</span>
                        <UInputNumber
                            v-model="activosEjemplo"
                            :min="1"
                            size="xs"
                            :format-options="{ useGrouping: false }"
                            :step-snapping="false"
                            class="w-24"
                            aria-label="Servicios activos de ejemplo"
                        />
                        <span
                            v-if="vistaPrevia"
                            data-prueba="vista-padre"
                        >activos: max-limit <strong class="font-mono text-default">{{ vistaPrevia.padre.max_limit }}</strong> · limit-at <strong class="font-mono text-default">{{ vistaPrevia.padre.limit_at }}</strong></span>
                        <span v-else>activos</span>
                    </div>
                </section>

                <section class="grid gap-4 sm:grid-cols-2">
                    <UFormField
                        label="IP"
                        name="dual_stack"
                    >
                        <USelect
                            v-model="estado.dual_stack"
                            :items="itemsDualStack"
                            class="w-full"
                        />
                    </UFormField>
                    <UFormField
                        label="Prefijo delegado IPv6"
                        name="tamano_prefijo_delegado"
                    >
                        <USelect
                            v-model="estado.tamano_prefijo_delegado"
                            :items="itemsPrefijo"
                            class="w-full"
                        />
                    </UFormField>
                    <USwitch
                        v-model="estado.global"
                        label="Global (disponible en todos los routers)"
                    />
                    <USwitch
                        v-model="estado.activo"
                        label="Activo (se ofrece en altas)"
                    />
                </section>

                <ProblemaAlerta
                    v-if="problema"
                    :problema="problema"
                    data-prueba="plan-error"
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
                    form="form-plan"
                    :label="plan ? 'Guardar cambios' : 'Crear plan'"
                    icon="i-lucide-save"
                    :loading="enviando"
                    data-prueba="plan-guardar"
                />
            </div>
        </template>
    </USlideover>
</template>
