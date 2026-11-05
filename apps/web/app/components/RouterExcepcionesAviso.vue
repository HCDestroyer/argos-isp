<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { VistaPreviaEstrategia } from '~/types/controlVelocidad'

/**
 * Modo único por router (decisión del PM, núcleo de routers): ya no hay excepciones de velocidad por
 * plan. Si el router trae excepciones heredadas, este aviso las nombra y «Unificar» abre la vista
 * previa de pasarlas al modo del router (`POST /routers/:id/vista-previa-estrategia` con
 * `planes: { <id>: null }`): qué planes cambian, qué se crea y se borra y cuántas sesiones
 * reconectan. Aplicar es la acción de A1 `routers.unificar_control_velocidad`
 * (`contratos/control-velocidad.md`); mientras la API no la publique, el botón queda deshabilitado
 * con el porqué (`.claude/integration/a4.md`).
 */
const props = defineProps<{
    router: RouterNas
    /** Planes del router con excepción propia (`implementacion.estrategia_velocidad`). */
    planes: PlanEfectivo[]
}>()

defineEmits<{
    unificado: [router: RouterNas]
}>()

const { puede } = usePermisos()

const abierto = ref(false)
const vista = shallowRef<VistaPreviaEstrategia | null>(null)
const problema = ref<Problem | null>(null)
const cargando = ref(false)

const nombres = computed(() => props.planes.map(p => p.nombre))
const titulo = computed(() => props.planes.length === 1
    ? '1 plan tiene su propia velocidad en este router'
    : `${props.planes.length} planes tienen su propia velocidad en este router`)

/** `Unificar control de velocidad` aún no está en la API (A1). */
const UNIFICAR_DISPONIBLE = false

async function revisar() {
    cargando.value = true
    problema.value = null
    const planes = props.planes.map(p => ({ plan_id: p.id, estrategia_velocidad: null }))
    const resultado = await useControlVelocidad().vistaPrevia(props.router.id, { planes })
    cargando.value = false
    vista.value = resultado.ok ? resultado.data : null
    problema.value = resultado.ok ? null : resultado.problema
}

function abrir() {
    vista.value = null
    abierto.value = true
    void revisar()
}

function nombrePlan(id: number): string {
    return props.planes.find(p => p.id === id)?.nombre ?? `Plan ${id}`
}

const planesQueCambian = computed(() => vista.value?.planes ?? [])
</script>

<template>
    <div>
        <UAlert
            color="warning"
            variant="subtle"
            icon="i-lucide-split"
            :title="titulo"
            :actions="puede('routers.cambiar_control_velocidad') ? [{ label: 'Unificar', icon: 'i-lucide-merge', color: 'warning', variant: 'solid', onClick: abrir }] : []"
            data-prueba="excepciones-heredadas"
        >
            <template #description>
                <p>
                    {{ nombres.join(', ') }}. Ahora cada router usa un solo modo: unificar pasa esos planes al modo del router, con vista previa antes de aplicar.
                </p>
            </template>
        </UAlert>

        <UModal
            v-model:open="abierto"
            :title="`Unificar el control de velocidad · ${router.nombre}`"
            description="Los planes con velocidad propia pasan al modo del router. Nada se escribe hasta confirmar."
            :ui="{ content: 'sm:max-w-3xl' }"
        >
            <template #body>
                <div
                    class="flex flex-col gap-4"
                    data-prueba="unificar-modal"
                >
                    <ProblemaAlerta
                        v-if="problema"
                        :problema="problema"
                        :reintentar="revisar"
                        :reintentando="cargando"
                    />
                    <USkeleton
                        v-else-if="cargando || !vista"
                        class="h-48 w-full"
                    />
                    <template v-else>
                        <section
                            class="flex flex-col gap-2"
                            aria-labelledby="titulo-planes-unificar"
                        >
                            <h3
                                id="titulo-planes-unificar"
                                class="text-sm font-medium text-highlighted"
                            >
                                Planes que cambian ({{ planesQueCambian.length }})
                            </h3>
                            <ul
                                class="flex flex-col divide-y divide-default rounded-lg border border-default"
                                data-prueba="unificar-planes"
                            >
                                <li
                                    v-for="plan in planesQueCambian"
                                    :key="plan.plan_id"
                                    class="flex flex-col gap-0.5 px-3 py-2"
                                    :data-plan="plan.plan_id"
                                >
                                    <span class="text-sm font-medium text-highlighted">{{ nombrePlan(plan.plan_id) }}</span>
                                    <span class="text-xs text-muted">Deja su velocidad propia y sigue el modo del router.</span>
                                </li>
                            </ul>
                        </section>
                        <EstrategiaVistaPrevia :vista="vista" />
                        <UAlert
                            v-if="vista.sesiones_conservan > 0"
                            color="info"
                            variant="subtle"
                            icon="i-lucide-plug"
                            :title="`${vista.sesiones_conservan.toLocaleString('es-GT')} ${vista.sesiones_conservan === 1 ? 'sesión PPPoE reconecta' : 'sesiones PPPoE reconectan'} con el modo del router`"
                            description="RouterOS no deja cambiar la cola de una sesión abierta: esos clientes siguen como estaban hasta que su equipo vuelva a marcar. Nadie se queda sin internet."
                            data-prueba="unificar-reconectan"
                        />
                    </template>
                </div>
            </template>
            <template #footer>
                <div class="flex w-full flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
                    <p
                        v-if="!UNIFICAR_DISPONIBLE"
                        class="text-xs text-muted sm:mr-auto"
                        data-prueba="unificar-pendiente"
                    >
                        Aplicar se habilita cuando la API publique «Unificar control de velocidad».
                    </p>
                    <div class="flex justify-end gap-2">
                        <UButton
                            label="Cerrar"
                            color="neutral"
                            variant="ghost"
                            @click="abierto = false"
                        />
                        <UButton
                            label="Unificar"
                            icon="i-lucide-merge"
                            :disabled="!UNIFICAR_DISPONIBLE || !vista?.valida"
                            data-prueba="unificar-confirmar"
                        />
                    </div>
                </div>
            </template>
        </UModal>
    </div>
</template>
