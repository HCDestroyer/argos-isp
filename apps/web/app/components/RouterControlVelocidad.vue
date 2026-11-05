<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { FormSubmitEvent } from '@nuxt/ui'
import type { Aplicacion, TipoConexionVelocidad } from '~/types/controlVelocidad'
import * as z from 'zod'
import { APLICACIONES, EXTRAS, TIPOS_CONEXION_VELOCIDAD } from '~/types/controlVelocidad'

/**
 * Control de velocidad del router, al frente de su ficha (pedido del PM, núcleo de routers): el modo
 * único del router como tarjetas (qué crea en el MikroTik, costo en CPU y cuándo conviene), «Cambiar
 * modo» con vista previa antes de aplicar (`EstrategiaVelocidadModal`, `routers.cambiar_control_velocidad`,
 * `contratos/control-velocidad.md` §4), el aviso de excepciones heredadas por plan con «Unificar»
 * (`RouterExcepcionesAviso`), la capacidad del enlace (`PUT /routers/:id`, `routers.editar`, con
 * `version`) y el rate-limit efectivo de cada plan. Se usa en la pestaña de la ficha y en el
 * panel lateral de la lista de routers (`compacto`).
 */
const props = withDefaults(defineProps<{
    router: RouterNas
    /** Una sola columna (panel lateral). */
    compacto?: boolean
}>(), {
    compacto: false,
})

const emit = defineEmits<{
    actualizado: [router: RouterNas]
}>()

const toast = useToast()
const { puede } = usePermisos()

const actual = shallowRef<RouterNas>(props.router)
watch(() => props.router, (router) => {
    actual.value = router
    capacidad.capacidad_bajada_kbps = router.capacidad_bajada_kbps ?? null
    capacidad.capacidad_subida_kbps = router.capacidad_subida_kbps ?? null
})

/* Modo del router: una tarjeta por tipo de conexión con su aplicación y sus capas. */
const estrategias = computed(() => estrategiasDeRouter(actual.value))

interface TarjetaModo {
    tipo: TipoConexionVelocidad
    aplicacion: Aplicacion
    resumen: string
    capas: string[]
}

const tarjetas = computed<TarjetaModo[]>(() => TIPOS_CONEXION_VELOCIDAD.map((tipo) => {
    const estrategia = estrategias.value[tipo]
    return {
        tipo,
        aplicacion: estrategia.aplicacion,
        resumen: resumenEstrategia(estrategia),
        capas: [
            `Agrupación: ${OPCIONES_PADRE[estrategia.padre].etiqueta}`,
            `Cola: ${OPCIONES_TIPO_COLA[estrategia.tipo_cola].etiqueta}`,
            ...EXTRAS.filter(extra => estrategia.extras[extra]).map(extra => OPCIONES_EXTRA[extra].etiqueta),
        ],
    }
}))

/** Los modos que el router no usa, para comparar. */
const otrosModos = computed(() => APLICACIONES.filter(a => !tarjetas.value.some(t => t.aplicacion === a)))
const compararAbierto = ref(false)

const editorAbierto = ref(false)
const reconciliarAbierto = ref(false)

function alCambiarEstrategia(router: RouterNas) {
    actual.value = router
    emit('actualizado', router)
    void cargarPlanes()
}

/* Capacidad del enlace. */
const esquemaCapacidad = z.object({
    capacidad_bajada_kbps: z.number().int('Solo kbps enteros').min(1, 'Al menos 1 kbps').max(100_000_000, 'Máximo 100 000 000 kbps').nullable(),
    capacidad_subida_kbps: z.number().int('Solo kbps enteros').min(1, 'Al menos 1 kbps').max(100_000_000, 'Máximo 100 000 000 kbps').nullable(),
})
type DatosCapacidad = z.output<typeof esquemaCapacidad>
const capacidad = reactive<DatosCapacidad>({
    capacidad_bajada_kbps: props.router.capacidad_bajada_kbps ?? null,
    capacidad_subida_kbps: props.router.capacidad_subida_kbps ?? null,
})
const formulario = useTemplateRef('formulario')
const guardando = ref(false)
const problemaCapacidad = ref<Problem | null>(null)

async function recargarRouter() {
    const resultado = await useRouters().ver(actual.value.id)
    if (resultado.ok) {
        actual.value = resultado.data
        capacidad.capacidad_bajada_kbps = resultado.data.capacidad_bajada_kbps ?? null
        capacidad.capacidad_subida_kbps = resultado.data.capacidad_subida_kbps ?? null
        problemaCapacidad.value = null
        emit('actualizado', resultado.data)
    }
}

async function guardarCapacidad(evento: FormSubmitEvent<DatosCapacidad>) {
    guardando.value = true
    problemaCapacidad.value = null
    const resultado = await useRouters().editar(actual.value.id, { version: actual.value.version, ...evento.data })
    guardando.value = false
    if (!resultado.ok) {
        const errores = erroresDeFormulario(resultado.problema)
        if (errores.length) {
            formulario.value?.setErrors(errores)
        }
        problemaCapacidad.value = errores.length ? null : resultado.problema
        return
    }
    actual.value = resultado.data
    emit('actualizado', resultado.data)
    toast.add({ title: 'Capacidad guardada', description: `${actual.value.nombre}: el techo de la cola padre global se actualiza en el router.`, icon: 'i-lucide-circle-check', color: 'success' })
}

/* Planes efectivos en el router (rate-limit que calcula la API) y sus excepciones heredadas. */
const planes = shallowRef<PlanEfectivo[]>([])
const problemaPlanes = ref<Problem | null>(null)
const cargandoPlanes = ref(false)
const planesLeidos = ref(false)

async function cargarPlanes() {
    if (!puede('planes.ver')) {
        return
    }
    cargandoPlanes.value = true
    const resultado = await useRouters().planes(actual.value.id)
    cargandoPlanes.value = false
    planesLeidos.value = resultado.ok
    planes.value = resultado.ok ? resultado.data : []
    problemaPlanes.value = resultado.ok ? null : resultado.problema
}

onMounted(cargarPlanes)
watch(() => props.router.id, () => void cargarPlanes())

const conExcepcion = computed(() => planes.value.filter(p => tieneExcepcion(p.implementacion?.estrategia_velocidad)))
</script>

<template>
    <div
        class="flex flex-col gap-6"
        data-prueba="router-velocidad"
    >
        <RouterSeccion
            id-titulo="titulo-control"
            titulo="Control de velocidad"
            icono="i-lucide-gauge"
            descripcion="Un solo modo por router: todos sus servicios se limitan con la misma lógica. Cambiarlo muestra antes qué se crea, qué se borra y cuántas sesiones reconectan."
        >
            <template #acciones>
                <UButton
                    v-if="puede('routers.cambiar_control_velocidad')"
                    label="Cambiar modo"
                    icon="i-lucide-sliders-horizontal"
                    data-prueba="abrir-cambio-control"
                    @click="editorAbierto = true"
                />
                <UButton
                    v-if="puede('routers.reconciliar')"
                    label="Reconciliar ahora"
                    icon="i-lucide-refresh-cw"
                    color="neutral"
                    variant="outline"
                    data-prueba="abrir-reconciliar"
                    @click="reconciliarAbierto = true"
                />
            </template>

            <RouterExcepcionesAviso
                v-if="conExcepcion.length"
                :router="actual"
                :planes="conExcepcion"
                @unificado="alCambiarEstrategia"
            />

            <ul
                class="grid gap-3"
                :class="compacto ? '' : 'lg:grid-cols-3'"
                data-prueba="control-actual"
            >
                <li
                    v-for="tarjeta in tarjetas"
                    :key="tarjeta.tipo"
                    class="flex flex-col gap-3 rounded-lg border border-default bg-default p-4"
                    :data-tipo="tarjeta.tipo"
                >
                    <div class="flex items-start gap-3">
                        <span class="flex size-9 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                            <UIcon
                                :name="DETALLE_APLICACION[tarjeta.aplicacion].icono"
                                class="size-5"
                            />
                        </span>
                        <div class="flex min-w-0 flex-col">
                            <span class="text-xs font-medium tracking-wide text-muted uppercase">{{ ETIQUETAS_TIPO_CONEXION[tarjeta.tipo] }}</span>
                            <span class="text-sm font-semibold text-highlighted">{{ OPCIONES_APLICACION[tarjeta.aplicacion].etiqueta }}</span>
                        </div>
                    </div>
                    <p class="text-sm text-default">
                        {{ OPCIONES_APLICACION[tarjeta.aplicacion].explicacion }}
                    </p>
                    <dl class="flex flex-col gap-2 text-xs">
                        <div class="flex flex-col gap-0.5">
                            <dt class="font-medium text-highlighted">
                                Qué crea en el MikroTik
                            </dt>
                            <dd class="text-muted">
                                {{ DETALLE_APLICACION[tarjeta.aplicacion].crea }}
                            </dd>
                        </div>
                        <div class="flex flex-col gap-0.5">
                            <dt class="font-medium text-highlighted">
                                Cuándo conviene
                            </dt>
                            <dd class="text-muted">
                                {{ DETALLE_APLICACION[tarjeta.aplicacion].conviene }}
                            </dd>
                        </div>
                    </dl>
                    <div class="mt-auto flex flex-wrap items-center gap-1.5">
                        <UBadge
                            :label="COSTOS_CPU[DETALLE_APLICACION[tarjeta.aplicacion].cpu].etiqueta"
                            icon="i-lucide-cpu"
                            :color="COSTOS_CPU[DETALLE_APLICACION[tarjeta.aplicacion].cpu].color"
                            variant="subtle"
                            size="sm"
                            :title="DETALLE_APLICACION[tarjeta.aplicacion].cpuPorque"
                        />
                        <UBadge
                            v-for="capa in tarjeta.capas"
                            :key="capa"
                            :label="capa"
                            color="neutral"
                            variant="subtle"
                            size="sm"
                        />
                    </div>
                    <p class="sr-only">
                        {{ tarjeta.resumen }}
                    </p>
                </li>
            </ul>

            <div class="flex flex-col gap-1 text-xs text-muted">
                <p data-prueba="routeros-version">
                    {{ actual.routeros_version ? `RouterOS ${actual.routeros_version}` : 'Versión de RouterOS desconocida: se lee al reconciliar o al probar la conexión.' }}
                </p>
                <p v-if="!puede('routers.cambiar_control_velocidad')">
                    Solo un administrador cambia el control de velocidad.
                </p>
            </div>

            <UCollapsible
                v-if="otrosModos.length"
                v-model:open="compararAbierto"
            >
                <UButton
                    label="Comparar con los otros modos"
                    :trailing-icon="compararAbierto ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'"
                    color="neutral"
                    variant="ghost"
                    size="sm"
                    data-prueba="comparar-modos"
                />
                <template #content>
                    <ul
                        class="grid gap-2 pt-2"
                        :class="compacto ? '' : 'sm:grid-cols-2'"
                    >
                        <li
                            v-for="aplicacion in otrosModos"
                            :key="aplicacion"
                            class="flex flex-col gap-1.5 rounded-lg border border-dashed border-default p-3"
                            :data-modo="aplicacion"
                        >
                            <span class="flex items-center gap-2 text-sm font-medium text-highlighted">
                                <UIcon
                                    :name="DETALLE_APLICACION[aplicacion].icono"
                                    class="size-4 text-muted"
                                />
                                {{ OPCIONES_APLICACION[aplicacion].etiqueta }}
                                <UBadge
                                    :label="COSTOS_CPU[DETALLE_APLICACION[aplicacion].cpu].etiqueta"
                                    :color="COSTOS_CPU[DETALLE_APLICACION[aplicacion].cpu].color"
                                    variant="subtle"
                                    size="sm"
                                />
                            </span>
                            <span class="text-xs text-muted">{{ DETALLE_APLICACION[aplicacion].crea }}</span>
                            <span class="text-xs text-muted">{{ DETALLE_APLICACION[aplicacion].conviene }}</span>
                        </li>
                    </ul>
                </template>
            </UCollapsible>
        </RouterSeccion>

        <div
            class="grid gap-6"
            :class="compacto ? '' : 'lg:grid-cols-2'"
        >
            <RouterSeccion
                id-titulo="titulo-capacidad"
                titulo="Capacidad del enlace"
                icono="i-lucide-arrow-down-up"
                descripcion="Techo de la cola padre global: con techo del router o árbol limita la suma de todos los planes."
            >
                <UForm
                    id="form-capacidad"
                    ref="formulario"
                    :schema="esquemaCapacidad"
                    :state="capacidad"
                    :disabled="!puede('routers.editar')"
                    class="flex flex-col gap-3"
                    @submit="guardarCapacidad"
                >
                    <div class="grid gap-4 sm:grid-cols-2">
                        <UFormField
                            label="Bajada (kbps)"
                            name="capacidad_bajada_kbps"
                            :help="capacidad.capacidad_bajada_kbps ? formatearVelocidad(capacidad.capacidad_bajada_kbps) : 'Vacía: sin techo.'"
                        >
                            <UInputNumber
                                v-model="capacidad.capacidad_bajada_kbps"
                                :min="1"
                                :step="1000"
                                :format-options="{ useGrouping: false }"
                                :step-snapping="false"
                                class="w-full"
                                data-prueba="capacidad-bajada"
                            />
                        </UFormField>
                        <UFormField
                            label="Subida (kbps)"
                            name="capacidad_subida_kbps"
                            :help="capacidad.capacidad_subida_kbps ? formatearVelocidad(capacidad.capacidad_subida_kbps) : 'Vacía: sin techo.'"
                        >
                            <UInputNumber
                                v-model="capacidad.capacidad_subida_kbps"
                                :min="1"
                                :step="1000"
                                :format-options="{ useGrouping: false }"
                                :step-snapping="false"
                                class="w-full"
                            />
                        </UFormField>
                    </div>
                    <ProblemaAlerta
                        v-if="problemaCapacidad"
                        :problema="problemaCapacidad"
                        :reintentar="problemaCapacidad.status === 409 ? recargarRouter : undefined"
                    />
                    <UButton
                        v-if="puede('routers.editar')"
                        type="submit"
                        label="Guardar capacidad"
                        icon="i-lucide-save"
                        color="neutral"
                        variant="outline"
                        :loading="guardando"
                        class="self-start"
                        data-prueba="guardar-capacidad"
                    />
                </UForm>
            </RouterSeccion>

            <RouterSeccion
                v-if="puede('planes.ver')"
                id-titulo="titulo-planes-router"
                titulo="Velocidad de cada plan"
                icono="i-lucide-layers"
                descripcion="Rate-limit que calcula la API con el modo del router."
            >
                <ProblemaAlerta
                    v-if="problemaPlanes"
                    :problema="problemaPlanes"
                    :reintentar="cargarPlanes"
                    :reintentando="cargandoPlanes"
                />
                <USkeleton
                    v-else-if="cargandoPlanes && !planes.length"
                    class="h-24 w-full"
                />
                <p
                    v-else-if="planesLeidos && !planes.length"
                    class="text-sm text-muted"
                >
                    Ningún plan disponible en este router.
                </p>
                <ul
                    v-else-if="planes.length"
                    class="flex flex-col divide-y divide-default rounded-lg border border-default"
                    data-prueba="planes-router"
                >
                    <li
                        v-for="plan in planes"
                        :key="plan.id"
                        class="flex flex-col gap-0.5 px-3 py-2"
                    >
                        <span class="text-sm font-medium text-highlighted">{{ plan.nombre }}</span>
                        <span class="font-mono text-xs break-all">{{ plan.rate_limit }}</span>
                        <span class="font-mono text-xs break-all text-muted">Limitado: {{ plan.rate_limit_limitado }}</span>
                    </li>
                </ul>
            </RouterSeccion>
        </div>

        <EstrategiaVelocidadModal
            v-if="puede('routers.cambiar_control_velocidad')"
            v-model:open="editorAbierto"
            :router="actual"
            @actualizado="alCambiarEstrategia"
        />
        <RouterReconciliarModal
            v-if="puede('routers.reconciliar')"
            v-model:open="reconciliarAbierto"
            :router="actual"
        />
    </div>
</template>
