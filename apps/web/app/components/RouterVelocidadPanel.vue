<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { FormSubmitEvent } from '@nuxt/ui'
import type { EstrategiasRouter, MatrizControlVelocidad } from '~/types/controlVelocidad'
import * as z from 'zod'

/**
 * Pestaña «Velocidad» de la ficha del router (tablero RedRouterFicha): el tipo de conexión del
 * router (`RouterTipoConexion`), cómo se limita a cada cliente con 3 opciones a la vista y «Ver las
 * otras» (decisión del PM), cómo se reparte, el tipo de cola con su «?», y a la derecha los extras,
 * la capacidad del enlace y «Ver vista previa del cambio»: nada se aplica sin la vista previa de la
 * API (`EstrategiaVelocidadModal` con lo editado aquí, `routers.cambiar_control_velocidad`). Las
 * excepciones heredadas por plan salen arriba con «Unificar».
 */
const props = defineProps<{
    router: RouterNas
}>()

const emit = defineEmits<{
    actualizado: [router: RouterNas]
}>()

const toast = useToast()
const { puede } = usePermisos()

const matriz = shallowRef<MatrizControlVelocidad | null>(null)
const problemaMatriz = ref<Problem | null>(null)
const estrategias = ref<EstrategiasRouter>(estrategiasDeRouter(props.router))
const cambio = computed(() => JSON.stringify(estrategias.value) !== JSON.stringify(estrategiasDeRouter(props.router)))
const puedeCambiar = computed(() => puede('routers.cambiar_control_velocidad'))

async function cargarMatriz() {
    const resultado = await useControlVelocidad().matriz()
    matriz.value = resultado.ok ? resultado.data : null
    problemaMatriz.value = resultado.ok ? null : resultado.problema
}

watch(() => [props.router.id, props.router.version], () => {
    estrategias.value = estrategiasDeRouter(props.router)
    capacidad.capacidad_bajada_kbps = props.router.capacidad_bajada_kbps ?? null
    capacidad.capacidad_subida_kbps = props.router.capacidad_subida_kbps ?? null
})

/* Planes con excepción propia (se unifican: el modo es uno por router). */
const planes = shallowRef<PlanEfectivo[]>([])
async function cargarPlanes() {
    if (!puede('planes.ver')) {
        return
    }
    const resultado = await useRouters().planes(props.router.id)
    planes.value = resultado.ok ? resultado.data : []
}
const conExcepcion = computed(() => planes.value.filter(p => tieneExcepcion(p.implementacion?.estrategia_velocidad)))

onMounted(() => void Promise.all([cargarMatriz(), cargarPlanes()]))

async function recargarRouter() {
    const resultado = await useRouters().ver(props.router.id)
    if (resultado.ok) {
        emit('actualizado', resultado.data)
    }
}

async function alUnificar() {
    await recargarRouter()
    await cargarPlanes()
}

const vistaPreviaAbierta = ref(false)

function alCambiar(router: RouterNas) {
    emit('actualizado', router)
    void cargarPlanes()
}

function deshacer() {
    estrategias.value = estrategiasDeRouter(props.router)
}

/* Capacidad del enlace (`PUT /routers/:id`, `routers.editar`, con `version`), en Mbps como el tablero. */
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
const capacidadCambio = computed(() => capacidad.capacidad_bajada_kbps !== (props.router.capacidad_bajada_kbps ?? null) || capacidad.capacidad_subida_kbps !== (props.router.capacidad_subida_kbps ?? null))

async function guardarCapacidad(evento: FormSubmitEvent<DatosCapacidad>) {
    guardando.value = true
    problemaCapacidad.value = null
    const resultado = await useRouters().editar(props.router.id, { version: props.router.version, ...evento.data })
    guardando.value = false
    if (!resultado.ok) {
        const errores = erroresDeFormulario(resultado.problema)
        if (errores.length) {
            formulario.value?.setErrors(errores)
        }
        problemaCapacidad.value = errores.length ? null : resultado.problema
        return
    }
    emit('actualizado', resultado.data)
    toast.add({ title: 'Capacidad guardada', description: `${resultado.data.nombre}: el techo de la cola padre global se actualiza en el router.`, icon: 'i-lucide-circle-check', color: 'success' })
}
</script>

<template>
    <div
        class="grid gap-4 xl:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]"
        data-prueba="router-velocidad-panel"
    >
        <div class="flex min-w-0 flex-col gap-4">
            <RouterExcepcionesAviso
                v-if="conExcepcion.length"
                :router="router"
                :planes="conExcepcion"
                @unificado="alUnificar"
            />
            <RouterTipoConexion
                :router="router"
                @actualizado="emit('actualizado', $event)"
            />
            <RedTarjeta
                titulo="Control de velocidad"
                icono="i-lucide-gauge"
            >
                <ProblemaAlerta
                    v-if="problemaMatriz"
                    :problema="problemaMatriz"
                    :reintentar="cargarMatriz"
                />
                <USkeleton
                    v-else-if="!matriz"
                    class="h-48 w-full"
                />
                <EstrategiaVelocidadEditor
                    v-else
                    v-model:estrategias="estrategias"
                    :matriz="matriz"
                    :version="router.routeros_version ?? null"
                    :router="estrategiasDeRouter(router)"
                    :sin-radius="esSinRadius(router)"
                    :tipo-fijo="router.tipo_conexion"
                    partes="capas"
                />
            </RedTarjeta>
        </div>

        <div class="flex min-w-0 flex-col gap-4">
            <RedTarjeta
                v-if="matriz"
                titulo="Extras"
                icono="i-lucide-zap"
            >
                <EstrategiaVelocidadEditor
                    v-model:estrategias="estrategias"
                    :matriz="matriz"
                    :version="router.routeros_version ?? null"
                    :router="estrategiasDeRouter(router)"
                    :sin-radius="esSinRadius(router)"
                    :tipo-fijo="router.tipo_conexion"
                    partes="extras"
                />
            </RedTarjeta>

            <RedTarjeta
                titulo="Capacidad del enlace"
                icono="i-lucide-arrow-up-down"
            >
                <UForm
                    ref="formulario"
                    :schema="esquemaCapacidad"
                    :state="capacidad"
                    :disabled="!puede('routers.editar')"
                    class="flex flex-col gap-3"
                    @submit="guardarCapacidad"
                >
                    <div class="grid grid-cols-2 gap-3">
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
                        Es el techo del router. Vacío = sin techo (con aviso).
                    </p>
                    <ProblemaAlerta
                        v-if="problemaCapacidad"
                        :problema="problemaCapacidad"
                        :reintentar="problemaCapacidad.status === 409 ? recargarRouter : undefined"
                    />
                    <UButton
                        v-if="puede('routers.editar') && capacidadCambio"
                        type="submit"
                        label="Guardar capacidad"
                        :icon="ICONOS.guardar"
                        color="neutral"
                        variant="outline"
                        :loading="guardando"
                        class="self-start rounded-full"
                        data-prueba="guardar-capacidad"
                    />
                </UForm>
            </RedTarjeta>

            <RouterQos
                v-if="puede('qos.ver')"
                :router="router"
                @actualizado="emit('actualizado', $event)"
                @recargar="recargarRouter"
            />

            <section
                class="flex flex-col gap-3 rounded-2xl border border-(--ax-borde) bg-(--ax-panel) p-4"
                aria-labelledby="titulo-antes-guardar"
            >
                <h2
                    id="titulo-antes-guardar"
                    class="flex items-center gap-2 text-xs font-semibold tracking-[0.06em] text-muted uppercase"
                >
                    <UIcon
                        name="i-lucide-eye"
                        class="size-4"
                    />
                    Antes de guardar verás
                </h2>
                <p class="text-sm text-default">
                    Qué se crea, cambia o borra en el router · cuántas sesiones reciben el cambio al instante · cuántas lo toman al reconectar.
                </p>
                <p class="flex items-center gap-2 rounded-xl border border-success/30 bg-success/10 px-3 py-2 text-sm font-medium text-success">
                    <UIcon
                        name="i-lucide-check"
                        class="size-4 shrink-0"
                    />
                    Nunca se corta a un cliente por cambiar el modo.
                </p>
                <UButton
                    v-if="puedeCambiar"
                    label="Ver vista previa del cambio"
                    icon="i-lucide-eye"
                    size="lg"
                    block
                    class="glow-brand rounded-full"
                    :disabled="!cambio"
                    data-prueba="ver-vista-previa-velocidad"
                    @click="vistaPreviaAbierta = true"
                />
                <UButton
                    v-if="cambio"
                    label="Deshacer lo editado"
                    icon="i-lucide-undo-2"
                    color="neutral"
                    variant="ghost"
                    size="sm"
                    class="self-center"
                    @click="deshacer"
                />
                <p
                    v-if="!puedeCambiar"
                    class="text-xs text-muted"
                >
                    Cambiar el modo pide el permiso «routers.cambiar_control_velocidad».
                </p>
                <p
                    v-else-if="!cambio"
                    class="text-xs text-muted"
                >
                    Cambia algo a la izquierda para ver qué pasaría en el router.
                </p>
            </section>
        </div>

        <EstrategiaVelocidadModal
            v-if="puedeCambiar"
            v-model:open="vistaPreviaAbierta"
            :router="router"
            :propuesta="estrategias"
            @actualizado="alCambiar"
        />
    </div>
</template>
