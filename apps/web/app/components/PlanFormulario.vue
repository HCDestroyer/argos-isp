<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { FormSubmitEvent, SelectItem } from '@nuxt/ui'

/**
 * Alta y edición de un plan en su página (tablero RedPlanForm): 1 · Lo básico, 2 · Velocidad (en
 * Mbps, la API guarda kbps), 3 · Reparto (reuso, garantizado, prioridad y ráfaga), 4 · Dónde se
 * ofrece y 5 · Direcciones; a la derecha «Así queda» con lo que recibe el router, calculado por la
 * API (`POST /planes/vista-previa`, nunca en el panel). Los 422 al guardar se muestran junto a cada
 * campo. «Solo en algunos» deja el plan sin `global`: los routers se eligen en la ficha del plan.
 */
const props = withDefaults(defineProps<{
    /** Plan a editar; sin él, alta. */
    plan?: Plan | null
}>(), {
    plan: null,
})

/** El formulario vive en su página: siempre abierto mientras se ve. */
const abierto = ref(true)

const emit = defineEmits<{
    guardado: [plan: Plan]
    cancelar: []
}>()

/** Velocidades en Mbps en pantalla (la API guarda kbps): 0.512 Mbps = 512 kbps. */
type CampoKbps = 'bajada_kbps' | 'subida_kbps' | 'bajada_limitada_kbps' | 'subida_limitada_kbps' | 'rafaga_bajada_kbps' | 'rafaga_subida_kbps'
function enMbps(campo: CampoKbps) {
    return computed<number | null>({
        get: () => {
            const valor = estado[campo]
            return typeof valor === 'number' ? valor / 1000 : null
        },
        set: (valor) => {
            const kbps = typeof valor === 'number' ? Math.round(valor * 1000) : null
            if (campo === 'rafaga_bajada_kbps' || campo === 'rafaga_subida_kbps') {
                estado[campo] = kbps
            }
            else if (kbps !== null) {
                estado[campo] = kbps
            }
        },
    })
}
const bajadaMbps = enMbps('bajada_kbps')
const subidaMbps = enMbps('subida_kbps')
const bajadaLimitadaMbps = enMbps('bajada_limitada_kbps')
const subidaLimitadaMbps = enMbps('subida_limitada_kbps')
const rafagaBajadaMbps = enMbps('rafaga_bajada_kbps')
const rafagaSubidaMbps = enMbps('rafaga_subida_kbps')

const TIPOS_PLAN_LISTA = (['residencial', 'empresarial', 'dedicado'] as const).map(valor => ({ valor, etiqueta: TIPOS_PLAN[valor].etiqueta, icono: TIPOS_PLAN[valor].icono }))

/** Mínimo asegurado por cliente (el garantizado de la vista previa, o 100 / reuso). */
const garantizadoPct = computed(() => vistaPrevia.value?.garantizado_pct_efectivo ?? (estado.reuso ? 100 / estado.reuso : null))
function minimo(kbps: number | null | undefined): string {
    const pct = garantizadoPct.value
    return typeof kbps === 'number' && pct !== null ? formatearVelocidad(Math.round(kbps * Number(pct) / 100)) : '—'
}

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
    <div
        class="surface-card flex min-w-0 flex-col overflow-hidden rounded-[1.375rem]"
        data-prueba="plan-formulario"
    >
        <header class="flex items-center gap-3 border-b border-(--ax-borde) px-4 py-3 sm:px-5">
            <UButton
                icon="i-lucide-chevron-left"
                color="neutral"
                variant="ghost"
                class="rounded-full"
                aria-label="Atrás"
                @click="emit('cancelar')"
            />
            <div class="flex min-w-0 flex-1 flex-col">
                <h1 class="truncate text-lg font-bold tracking-[-0.02em] text-highlighted">
                    {{ plan ? `Editar plan · ${plan.nombre}` : 'Nuevo plan' }}
                </h1>
                <p class="truncate text-xs text-muted">
                    {{ plan ? 'Cambiar la velocidad se aplica a sus sesiones al guardar, sin desconectarlas.' : 'Velocidad, reparto y dónde se ofrece. Se puede cambiar después.' }}
                </p>
            </div>
            <AyudaBoton solo-icono />
        </header>

        <div class="grid min-w-0 xl:grid-cols-[minmax(0,1fr)_22rem]">
            <UForm
                id="form-plan"
                ref="formulario"
                :schema="esquemaPlan"
                :state="estado"
                class="min-w-0"
                @submit="enviar"
            >
                <FormularioSeccion
                    titulo="1 · Lo básico"
                    descripcion="Cómo se llama, a quién se vende y cuánto cuesta."
                >
                    <div class="grid gap-4 sm:grid-cols-2">
                        <UFormField
                            label="Nombre"
                            name="nombre"
                            required
                        >
                            <UInput
                                v-model="estado.nombre"
                                placeholder="Fibra 50"
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
                                <template #trailing>
                                    <span class="text-sm text-muted">Q</span>
                                </template>
                            </UInput>
                        </UFormField>
                        <UFormField
                            label="Tipo de plan"
                            name="tipo"
                            help="Solo cambia avisos y reportes."
                            class="sm:col-span-2"
                        >
                            <div
                                role="radiogroup"
                                aria-label="Tipo de plan"
                                class="flex flex-wrap gap-2"
                                data-prueba="plan-tipo"
                            >
                                <UButton
                                    v-for="opcion in TIPOS_PLAN_LISTA"
                                    :key="opcion.valor"
                                    role="radio"
                                    :aria-checked="estado.tipo === opcion.valor"
                                    :label="opcion.etiqueta"
                                    :icon="opcion.icono"
                                    :color="estado.tipo === opcion.valor ? 'primary' : 'neutral'"
                                    :variant="estado.tipo === opcion.valor ? 'soft' : 'outline'"
                                    class="rounded-xl"
                                    :class="estado.tipo === opcion.valor ? 'ring-1 ring-primary' : ''"
                                    @click="estado.tipo = opcion.valor"
                                />
                            </div>
                        </UFormField>
                    </div>
                </FormularioSeccion>

                <FormularioSeccion
                    titulo="2 · Velocidad"
                    descripcion="Lo que contrata el cliente y lo que recibe si cae en mora."
                >
                    <div class="grid gap-4 sm:grid-cols-2">
                        <UFormField
                            label="Bajada"
                            name="bajada_kbps"
                            required
                        >
                            <UFieldGroup
                                class="w-full"
                                size="xl"
                            >
                                <UInputNumber
                                    v-model="bajadaMbps"
                                    :min="0.001"
                                    :step="1"
                                    :format-options="{ maximumFractionDigits: 3, useGrouping: false }"
                                    :step-snapping="false"
                                    size="xl"
                                    class="w-full"
                                    :ui="{ base: 'text-xl font-semibold' }"
                                    data-prueba="plan-bajada"
                                />
                                <UBadge
                                    label="Mbps"
                                    color="neutral"
                                    variant="outline"
                                    class="shrink-0 text-muted"
                                />
                            </UFieldGroup>
                        </UFormField>
                        <UFormField
                            label="Subida"
                            name="subida_kbps"
                            required
                        >
                            <UFieldGroup
                                class="w-full"
                                size="xl"
                            >
                                <UInputNumber
                                    v-model="subidaMbps"
                                    :min="0.001"
                                    :step="1"
                                    :format-options="{ maximumFractionDigits: 3, useGrouping: false }"
                                    :step-snapping="false"
                                    size="xl"
                                    class="w-full"
                                    :ui="{ base: 'text-xl font-semibold' }"
                                />
                                <UBadge
                                    label="Mbps"
                                    color="neutral"
                                    variant="outline"
                                    class="shrink-0 text-muted"
                                />
                            </UFieldGroup>
                        </UFormField>
                        <UFormField
                            label="Bajada limitada"
                            name="bajada_limitada_kbps"
                            required
                            help="Cuando está en mora."
                        >
                            <UFieldGroup
                                class="w-full"
                            >
                                <UInputNumber
                                    v-model="bajadaLimitadaMbps"
                                    :min="0.001"
                                    :step="0.5"
                                    :format-options="{ maximumFractionDigits: 3, useGrouping: false }"
                                    :step-snapping="false"
                                    class="w-full"
                                />
                                <UBadge
                                    label="Mbps"
                                    color="neutral"
                                    variant="outline"
                                    class="shrink-0 text-muted"
                                />
                            </UFieldGroup>
                        </UFormField>
                        <UFormField
                            label="Subida limitada"
                            name="subida_limitada_kbps"
                            required
                        >
                            <UFieldGroup
                                class="w-full"
                            >
                                <UInputNumber
                                    v-model="subidaLimitadaMbps"
                                    :min="0.001"
                                    :step="0.5"
                                    :format-options="{ maximumFractionDigits: 3, useGrouping: false }"
                                    :step-snapping="false"
                                    class="w-full"
                                />
                                <UBadge
                                    label="Mbps"
                                    color="neutral"
                                    variant="outline"
                                    class="shrink-0 text-muted"
                                />
                            </UFieldGroup>
                        </UFormField>
                    </div>
                </FormularioSeccion>

                <FormularioSeccion
                    titulo="3 · Reparto"
                    descripcion="Cuántos clientes comparten la capacidad y qué mínimo tienen."
                >
                    <div class="flex flex-col gap-4">
                        <div class="grid gap-4 sm:grid-cols-3">
                            <UFormField
                                label="Reuso"
                                name="reuso"
                                required
                                help="1 = dedicado"
                            >
                                <UFieldGroup
                                    class="w-full"
                                >
                                    <UBadge
                                        label="1 :"
                                        color="neutral"
                                        variant="outline"
                                        class="shrink-0 text-muted"
                                    />
                                    <UInputNumber
                                        v-model="estado.reuso"
                                        :min="1"
                                        :max="64"
                                        :format-options="{ useGrouping: false }"
                                        :step-snapping="false"
                                        class="w-full"
                                        data-prueba="plan-reuso"
                                    />
                                </UFieldGroup>
                            </UFormField>
                            <UFormField
                                label="Garantizado"
                                name="garantizado_pct"
                                :help="estado.garantia_automatica ? `Automático: 100 / reuso${vistaPrevia ? ` = ${vistaPrevia.garantizado_pct_efectivo} %` : ''}` : `Hasta 100 / ${estado.reuso || 'reuso'} %`"
                            >
                                <div class="flex flex-col gap-2">
                                    <UFieldGroup
                                        class="w-full"
                                    >
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
                                        <UBadge
                                            label="%"
                                            color="neutral"
                                            variant="outline"
                                            class="shrink-0 text-muted"
                                        />
                                    </UFieldGroup>
                                    <USwitch
                                        v-model="estado.garantia_automatica"
                                        label="Automático"
                                    />
                                </div>
                            </UFormField>
                            <UFormField
                                label="Prioridad"
                                name="prioridad"
                                required
                                help="1 alta · 8 normal"
                            >
                                <USelect
                                    v-model="estado.prioridad"
                                    :items="PRIORIDADES"
                                    class="w-full"
                                />
                            </UFormField>
                        </div>
                        <div class="flex flex-col gap-3">
                            <USwitch
                                v-model="estado.con_rafaga"
                                label="Con ráfaga"
                                :description="estado.con_rafaga && estado.rafaga_bajada_kbps ? `Hasta ${formatearVelocidad(estado.rafaga_bajada_kbps)}${estado.rafaga_subida_kbps ? ` / ${formatearVelocidad(estado.rafaga_subida_kbps)}` : ''} por ${estado.rafaga_segundos} s al abrir páginas.` : 'Sin ráfaga: el servicio nunca pasa de la velocidad máxima.'"
                                size="lg"
                                data-prueba="plan-con-rafaga"
                            />
                            <div
                                v-if="estado.con_rafaga"
                                class="grid gap-4 sm:grid-cols-4"
                            >
                                <UFormField
                                    label="Ráfaga de bajada"
                                    name="rafaga_bajada_kbps"
                                >
                                    <UFieldGroup
                                        class="w-full"
                                    >
                                        <UInputNumber
                                            v-model="rafagaBajadaMbps"
                                            :min="0.001"
                                            :step="1"
                                            :format-options="{ maximumFractionDigits: 3, useGrouping: false }"
                                            :step-snapping="false"
                                            class="w-full"
                                            data-prueba="plan-rafaga-bajada"
                                        />
                                        <UBadge
                                            label="Mbps"
                                            color="neutral"
                                            variant="outline"
                                            class="shrink-0 text-muted"
                                        />
                                    </UFieldGroup>
                                </UFormField>
                                <UFormField
                                    label="Ráfaga de subida"
                                    name="rafaga_subida_kbps"
                                >
                                    <UFieldGroup
                                        class="w-full"
                                    >
                                        <UInputNumber
                                            v-model="rafagaSubidaMbps"
                                            :min="0.001"
                                            :step="1"
                                            :format-options="{ maximumFractionDigits: 3, useGrouping: false }"
                                            :step-snapping="false"
                                            class="w-full"
                                        />
                                        <UBadge
                                            label="Mbps"
                                            color="neutral"
                                            variant="outline"
                                            class="shrink-0 text-muted"
                                        />
                                    </UFieldGroup>
                                </UFormField>
                                <UFormField
                                    label="Umbral"
                                    name="rafaga_umbral_pct"
                                    required
                                >
                                    <UFieldGroup
                                        class="w-full"
                                    >
                                        <UInputNumber
                                            v-model="estado.rafaga_umbral_pct"
                                            :min="1"
                                            :max="99"
                                            :format-options="{ useGrouping: false }"
                                            :step-snapping="false"
                                            class="w-full"
                                        />
                                        <UBadge
                                            label="%"
                                            color="neutral"
                                            variant="outline"
                                            class="shrink-0 text-muted"
                                        />
                                    </UFieldGroup>
                                </UFormField>
                                <UFormField
                                    label="Tiempo"
                                    name="rafaga_segundos"
                                    required
                                >
                                    <UFieldGroup
                                        class="w-full"
                                    >
                                        <UInputNumber
                                            v-model="estado.rafaga_segundos"
                                            :min="1"
                                            :max="3600"
                                            :format-options="{ useGrouping: false }"
                                            :step-snapping="false"
                                            class="w-full"
                                        />
                                        <UBadge
                                            label="s"
                                            color="neutral"
                                            variant="outline"
                                            class="shrink-0 text-muted"
                                        />
                                    </UFieldGroup>
                                </UFormField>
                            </div>
                        </div>
                    </div>
                </FormularioSeccion>

                <FormularioSeccion
                    titulo="4 · Dónde se ofrece"
                    descripcion="En todos los routers o solo en algunos."
                >
                    <URadioGroup
                        :model-value="estado.global ? 'todos' : 'algunos'"
                        :items="[
                            { label: 'Todos los routers', value: 'todos', description: 'También los que conectes después.' },
                            { label: 'Solo en algunos', value: 'algunos', description: plan ? 'Eliges cuáles en la ficha del plan; en los demás no aparece.' : 'Al guardar eliges cuáles en la ficha del plan.' },
                        ]"
                        variant="card"
                        class="w-full"
                        :ui="{ fieldset: 'grid gap-3 sm:grid-cols-2', label: 'font-semibold' }"
                        data-prueba="plan-donde"
                        @update:model-value="valor => estado.global = valor === 'todos'"
                    />
                    <USwitch
                        v-model="estado.activo"
                        label="En venta (se ofrece en altas)"
                        class="mt-4"
                    />
                </FormularioSeccion>

                <FormularioSeccion
                    titulo="5 · Direcciones"
                    descripcion="IPv4, IPv6 y el tamaño de la red de su casa."
                >
                    <div class="grid gap-4 sm:grid-cols-2">
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
                            required
                        >
                            <USelect
                                v-model="estado.tamano_prefijo_delegado"
                                :items="itemsPrefijo"
                                class="w-full"
                            />
                        </UFormField>
                    </div>
                    <ProblemaAlerta
                        v-if="problema"
                        :problema="problema"
                        class="mt-4"
                        data-prueba="plan-error"
                    />
                </FormularioSeccion>
            </UForm>

            <!-- Así queda (lo calcula la API). -->
            <aside
                class="flex flex-col gap-3 border-t border-(--ax-borde) bg-(--ax-fondo)/40 p-4 sm:p-5 xl:border-t-0 xl:border-s"
                aria-label="Así queda"
                :aria-busy="cargandoVistaPrevia"
                data-prueba="vista-rate-limit"
            >
                <h2 class="text-xs font-semibold tracking-[0.06em] text-muted uppercase">
                    Así queda
                </h2>
                <div class="flex flex-col gap-3 rounded-2xl border border-(--ax-borde) bg-(--ax-tarjeta) p-4">
                    <div class="flex items-center justify-between gap-2">
                        <span class="flex min-w-0 items-center gap-2">
                            <span class="truncate font-semibold text-highlighted">{{ estado.nombre || 'Plan nuevo' }}</span>
                            <TipoPlanBadge :tipo="estado.tipo" />
                        </span>
                        <span class="font-bold text-highlighted">{{ /^\d+(\.\d{1,2})?$/.test(estado.precio.trim()) ? formatearQuetzales(estado.precio.trim()) : 'Q —' }}</span>
                    </div>
                    <div class="grid grid-cols-2 gap-2">
                        <div class="rounded-xl bg-(--ax-panel) px-3 py-2">
                            <span class="flex items-center gap-1 text-xs text-muted"><UIcon
                                name="i-lucide-arrow-down"
                                class="size-3.5"
                            />Bajada</span>
                            <span class="block text-lg font-bold text-highlighted">{{ estado.bajada_kbps ? formatearVelocidad(estado.bajada_kbps) : '—' }}</span>
                            <span class="text-xs text-muted">mínimo {{ minimo(estado.bajada_kbps) }}</span>
                        </div>
                        <div class="rounded-xl bg-(--ax-panel) px-3 py-2">
                            <span class="flex items-center gap-1 text-xs text-muted"><UIcon
                                name="i-lucide-arrow-up"
                                class="size-3.5"
                            />Subida</span>
                            <span class="block text-lg font-bold text-highlighted">{{ estado.subida_kbps ? formatearVelocidad(estado.subida_kbps) : '—' }}</span>
                            <span class="text-xs text-muted">mínimo {{ minimo(estado.subida_kbps) }}</span>
                        </div>
                    </div>
                </div>
                <div class="flex flex-col gap-2 rounded-2xl border border-(--ax-borde) bg-(--ax-tarjeta) p-4">
                    <span class="text-sm font-semibold text-highlighted">Cuando la red se llena</span>
                    <span class="text-xs text-muted">Con reuso 1:{{ estado.reuso || 'N' }}, {{ estado.reuso || 'N' }} clientes comparten {{ estado.bajada_kbps ? formatearVelocidad(estado.bajada_kbps) : 'la velocidad' }}. Cada uno tiene asegurado {{ minimo(estado.bajada_kbps) }}.</span>
                    <UProgress
                        :model-value="garantizadoPct === null ? 0 : Math.min(100, Number(garantizadoPct))"
                        size="md"
                        :aria-label="`Asegurado ${garantizadoPct === null ? '—' : Math.round(Number(garantizadoPct) * 10) / 10} %`"
                    />
                    <span class="flex justify-between text-xs text-muted">
                        <span>asegurado {{ garantizadoPct === null ? '—' : `${Math.round(Number(garantizadoPct) * 10) / 10} %` }}</span>
                        <span>hasta {{ estado.bajada_kbps ? formatearVelocidad(estado.bajada_kbps) : '—' }} si hay espacio</span>
                    </span>
                </div>
                <div class="flex flex-col gap-1 rounded-2xl border border-(--ax-borde) bg-(--ax-tarjeta) p-4">
                    <span class="text-sm font-semibold text-highlighted">En mora (limitado)</span>
                    <span class="text-xs text-muted">Navega a {{ estado.bajada_limitada_kbps ? formatearVelocidad(estado.bajada_limitada_kbps) : '—' }} / {{ estado.subida_limitada_kbps ? formatearVelocidad(estado.subida_limitada_kbps) : '—' }} hasta que pague o prometa.</span>
                </div>

                <div class="flex flex-col gap-1">
                    <span class="flex items-center justify-between text-xs text-muted">
                        Lo que recibe el router
                        <UIcon
                            v-if="cargandoVistaPrevia"
                            name="i-lucide-loader-circle"
                            class="size-3.5 animate-spin"
                        />
                    </span>
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
                    <USkeleton
                        v-else-if="!vistaPrevia"
                        class="h-9 w-full"
                    />
                    <template v-else>
                        <code
                            class="block rounded-lg bg-(--ax-panel) px-3 py-2 font-mono text-xs break-all text-highlighted"
                            :class="{ 'opacity-60': cargandoVistaPrevia }"
                            data-prueba="rate-limit-activo"
                        >{{ vistaPrevia.rate_limit }}</code>
                        <span class="text-xs text-muted">Limitado: <code
                            class="font-mono"
                            data-prueba="rate-limit-limitado"
                        >{{ vistaPrevia.rate_limit_limitado }}</code></span>
                        <ul class="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
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
                        class="flex flex-wrap items-center gap-2 pt-2 text-xs text-muted"
                    >
                        <span>Cola padre con</span>
                        <UInputNumber
                            v-model="activosEjemplo"
                            :min="1"
                            size="xs"
                            :format-options="{ useGrouping: false }"
                            :step-snapping="false"
                            class="w-20"
                            aria-label="Servicios activos de ejemplo"
                        />
                        <span
                            v-if="vistaPrevia"
                            data-prueba="vista-padre"
                        >activos: max-limit <strong class="font-mono text-default">{{ vistaPrevia.padre.max_limit }}</strong> · limit-at <strong class="font-mono text-default">{{ vistaPrevia.padre.limit_at }}</strong></span>
                        <span v-else>activos</span>
                    </div>
                </div>
                <p
                    v-if="plan"
                    class="flex items-start gap-1.5 rounded-xl border border-primary/30 bg-primary/5 px-3 py-2 text-xs text-primary"
                >
                    <UIcon
                        name="i-lucide-info"
                        class="mt-0.5 size-3.5 shrink-0"
                    />
                    Las sesiones abiertas toman la velocidad nueva al guardar, sin desconectarse.
                </p>
            </aside>
        </div>

        <footer class="sticky bottom-0 z-10 flex flex-wrap items-center justify-between gap-3 border-t border-(--ax-borde) bg-(--ax-tarjeta) px-4 py-3 sm:px-5">
            <span class="hidden text-sm text-muted sm:block">Los cambios quedan en la bitácora.</span>
            <span class="ms-auto flex flex-1 gap-2 sm:flex-none">
                <UButton
                    label="Cancelar"
                    color="neutral"
                    variant="ghost"
                    size="lg"
                    class="rounded-full"
                    :disabled="enviando"
                    @click="emit('cancelar')"
                />
                <UButton
                    type="submit"
                    form="form-plan"
                    :label="plan ? 'Guardar y aplicar' : 'Crear plan'"
                    :icon="ICONOS.guardar"
                    size="lg"
                    class="glow-brand flex-1 justify-center rounded-full sm:flex-none"
                    :loading="enviando"
                    data-prueba="guardar-plan"
                />
            </span>
        </footer>
    </div>
</template>
