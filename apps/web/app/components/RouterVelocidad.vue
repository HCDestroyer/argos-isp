<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { FormSubmitEvent } from '@nuxt/ui'
import * as z from 'zod'

/**
 * Control de velocidad de un router: capacidad del enlace (`PUT /routers/:id`, `routers.editar`,
 * con `version`), el resumen de la estrategia por capas de cada tipo de conexión y el editor
 * (`EstrategiaVelocidadModal`, `routers.cambiar_control_velocidad`, `contratos/control-velocidad.md`).
 * Muestra el rate-limit efectivo de cada plan.
 */
const props = defineProps<{
    router: RouterNas
}>()

const abierto = defineModel<boolean>('open', { default: false })

const emit = defineEmits<{
    actualizado: [router: RouterNas]
}>()

const toast = useToast()
const { puede } = usePermisos()

const actual = shallowRef<RouterNas>(props.router)

/* Capacidad del enlace. */
const esquemaCapacidad = z.object({
    capacidad_bajada_kbps: z.number().int('Solo kbps enteros').min(1, 'Al menos 1 kbps').max(100_000_000, 'Máximo 100 000 000 kbps').nullable(),
    capacidad_subida_kbps: z.number().int('Solo kbps enteros').min(1, 'Al menos 1 kbps').max(100_000_000, 'Máximo 100 000 000 kbps').nullable(),
})
type DatosCapacidad = z.output<typeof esquemaCapacidad>
const capacidad = reactive<DatosCapacidad>({ capacidad_bajada_kbps: null, capacidad_subida_kbps: null })
const formulario = useTemplateRef('formulario')
const guardando = ref(false)
const problemaCapacidad = ref<Problem | null>(null)

/* Planes efectivos en el router (rate-limit que calcula la API). */
const planes = shallowRef<PlanEfectivo[]>([])
const problemaPlanes = ref<Problem | null>(null)
const cargandoPlanes = ref(false)

async function cargarPlanes() {
    if (!puede('planes.ver')) {
        return
    }
    cargandoPlanes.value = true
    const resultado = await useRouters().planes(actual.value.id)
    cargandoPlanes.value = false
    planes.value = resultado.ok ? resultado.data : []
    problemaPlanes.value = resultado.ok ? null : resultado.problema
}

async function recargarRouter() {
    const resultado = await useRouters().ver(actual.value.id)
    if (resultado.ok) {
        actual.value = resultado.data
        capacidad.capacidad_bajada_kbps = resultado.data.capacidad_bajada_kbps ?? null
        capacidad.capacidad_subida_kbps = resultado.data.capacidad_subida_kbps ?? null
        problemaCapacidad.value = null
    }
}

watch(abierto, (valor) => {
    if (!valor) {
        return
    }
    actual.value = props.router
    capacidad.capacidad_bajada_kbps = props.router.capacidad_bajada_kbps ?? null
    capacidad.capacidad_subida_kbps = props.router.capacidad_subida_kbps ?? null
    problemaCapacidad.value = null
    void cargarPlanes()
}, { immediate: true })

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

/*
 * Control de velocidad por capas (`contratos/control-velocidad.md`): se edita en
 * `EstrategiaVelocidadModal` con vista previa; aquí solo el resumen por tipo de conexión.
 */
const estrategias = computed(() => estrategiasDeRouter(actual.value))
const editorAbierto = ref(false)
const reconciliarAbierto = ref(false)

function alCambiarEstrategia(router: RouterNas) {
    actual.value = router
    emit('actualizado', router)
}
</script>

<template>
    <USlideover
        v-model:open="abierto"
        :title="`Velocidad · ${actual.nombre}`"
        :description="`${actual.host} · NAS ${actual.nas_ip}`"
        :ui="{ content: 'sm:max-w-xl' }"
    >
        <template #body>
            <div class="flex flex-col gap-6">
                <section
                    class="flex flex-col gap-3"
                    aria-labelledby="titulo-control"
                >
                    <h3
                        id="titulo-control"
                        class="text-sm font-medium text-highlighted"
                    >
                        Control de velocidad
                    </h3>
                    <div class="surface-card flex flex-col gap-3 p-4">
                        <ul
                            class="flex flex-col gap-2"
                            data-prueba="control-actual"
                        >
                            <li
                                v-for="tipo in TIPOS_CONEXION_VELOCIDAD"
                                :key="tipo"
                                class="flex flex-col"
                                :data-tipo="tipo"
                            >
                                <span class="text-xs text-muted">{{ ETIQUETAS_TIPO_CONEXION[tipo] }}</span>
                                <span class="text-sm text-highlighted">{{ resumenEstrategia(estrategias[tipo]) }}</span>
                            </li>
                        </ul>
                        <p class="text-xs text-muted">
                            Cada plan puede tener su excepción en este router (Planes → ficha del plan → Routers).
                        </p>
                        <UButton
                            v-if="puede('routers.cambiar_control_velocidad')"
                            label="Editar control de velocidad"
                            icon="i-lucide-sliders-horizontal"
                            color="neutral"
                            variant="outline"
                            class="self-start"
                            data-prueba="abrir-cambio-control"
                            @click="editorAbierto = true"
                        />
                        <p
                            v-else
                            class="text-xs text-muted"
                        >
                            Solo un administrador cambia el control de velocidad.
                        </p>
                        <p
                            class="text-xs text-muted"
                            data-prueba="routeros-version"
                        >
                            {{ actual.routeros_version ? `RouterOS ${actual.routeros_version}` : 'Versión de RouterOS desconocida: se lee al reconciliar o al probar la conexión.' }}
                        </p>
                        <UButton
                            v-if="puede('routeros.reconciliar')"
                            label="Reconciliar ahora"
                            icon="i-lucide-refresh-cw"
                            color="neutral"
                            variant="outline"
                            class="self-start"
                            data-prueba="abrir-reconciliar"
                            @click="reconciliarAbierto = true"
                        />
                    </div>
                </section>

                <section
                    class="flex flex-col gap-3"
                    aria-labelledby="titulo-capacidad"
                >
                    <h3
                        id="titulo-capacidad"
                        class="text-sm font-medium text-highlighted"
                    >
                        Capacidad del enlace
                    </h3>
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
                        <p class="text-xs text-muted">
                            Techo de la cola padre global: en árbol PCQ limita la suma de todos los planes.
                        </p>
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
                            :loading="guardando"
                            class="self-start"
                            data-prueba="guardar-capacidad"
                        />
                    </UForm>
                </section>

                <section
                    v-if="puede('planes.ver')"
                    class="flex flex-col gap-3"
                    aria-labelledby="titulo-planes-router"
                >
                    <h3
                        id="titulo-planes-router"
                        class="text-sm font-medium text-highlighted"
                    >
                        Rate-limit de cada plan en este router
                    </h3>
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
                        v-else-if="!planes.length"
                        class="text-sm text-muted"
                    >
                        Ningún plan disponible en este router.
                    </p>
                    <ul
                        v-else
                        class="flex flex-col divide-y divide-default surface-card"
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
                    <p class="text-xs text-muted">
                        Calculado por la API con las excepciones del router.
                    </p>
                </section>
            </div>

            <EstrategiaVelocidadModal
                v-if="puede('routers.cambiar_control_velocidad')"
                v-model:open="editorAbierto"
                :router="actual"
                @actualizado="alCambiarEstrategia"
            />
            <RouterReconciliarModal
                v-if="puede('routeros.reconciliar')"
                v-model:open="reconciliarAbierto"
                :router="actual"
                @reconciliado="recargarRouter"
            />
        </template>
    </USlideover>
</template>
