<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { VistaPreviaUnificarVelocidad } from '~/types/controlVelocidad'

/**
 * Modo único por router (decisión del PM, `contratos/control-velocidad.md` §11): ya no hay
 * excepciones de velocidad por plan. Si el router trae excepciones heredadas, este aviso las nombra
 * y «Unificar» abre la vista previa (`GET /routers/:id/vista-previa-unificar-velocidad`): qué planes
 * cambian y en qué capas, qué se crea y se borra y cuántas sesiones reconectan. Aplicar es
 * `POST /routers/:id/unificar-control-velocidad` (`routers.unificar_control_velocidad`, solo admin)
 * con los planes que se vieron; si cambiaron, 409 `excepciones_cambiaron` y se vuelve a leer.
 */
const props = defineProps<{
    router: RouterNas
    /** Planes del router con excepción propia (`implementacion.estrategia_velocidad`). */
    planes: PlanEfectivo[]
}>()

const emit = defineEmits<{
    unificado: []
}>()

const { puede } = usePermisos()
const toast = useToast()

const abierto = ref(false)
const vista = shallowRef<VistaPreviaUnificarVelocidad | null>(null)
const problema = ref<Problem | null>(null)
const problemaAplicar = ref<Problem | null>(null)
const cargando = ref(false)
const aplicando = ref(false)
const reconectar = ref(false)
const confirmaReconectar = ref(false)
const motivo = ref('')
let clave = nuevaClaveIdempotencia()

const puedeUnificar = computed(() => puede('routers.unificar_control_velocidad'))
const nombres = computed(() => props.planes.map(p => p.nombre))
const titulo = computed(() => props.planes.length === 1
    ? '1 plan tiene su propia velocidad en este router'
    : `${props.planes.length} planes tienen su propia velocidad en este router`)

const CAPAS: Record<VistaPreviaUnificarVelocidad['planes'][number]['capas'][number], string> = {
    aplicacion: 'cómo se limita',
    padre: 'agrupación',
    tipo_cola: 'tipo de cola',
    extras: 'extras',
}

async function revisar() {
    cargando.value = true
    problema.value = null
    const resultado = await useControlVelocidad().vistaPreviaUnificar(props.router.id, reconectar.value)
    cargando.value = false
    vista.value = resultado.ok ? resultado.data : null
    problema.value = resultado.ok ? null : resultado.problema
}

function abrir() {
    vista.value = null
    reconectar.value = false
    confirmaReconectar.value = false
    motivo.value = ''
    problemaAplicar.value = null
    clave = nuevaClaveIdempotencia()
    abierto.value = true
    void revisar()
}

watch(reconectar, () => {
    confirmaReconectar.value = false
    if (abierto.value) {
        void revisar()
    }
})

const puedeAplicar = computed(() => Boolean(vista.value?.vista_previa.valida) && (!reconectar.value || confirmaReconectar.value))

async function aplicar() {
    const actual = vista.value
    if (!actual) {
        return
    }
    aplicando.value = true
    problemaAplicar.value = null
    const resultado = await useControlVelocidad().unificar(props.router.id, {
        planes: actual.planes.map(p => p.plan_id),
        ...(reconectar.value ? { reconectar: true } : {}),
        ...(motivo.value.trim().length >= 3 ? { motivo: motivo.value.trim() } : {}),
    }, clave)
    aplicando.value = false
    if (!resultado.ok) {
        problemaAplicar.value = resultado.problema
        // Las excepciones cambiaron desde la vista previa: se vuelve a leer con una clave nueva.
        if (resultado.problema.status === 409) {
            clave = nuevaClaveIdempotencia()
            await revisar()
        }
        return
    }
    abierto.value = false
    const total = resultado.data.planes.length
    toast.add({
        title: `${props.router.nombre}: un solo modo de velocidad`,
        description: total === 1 ? '1 plan dejó su velocidad propia. Se aplica por lotes.' : `${total} planes dejaron su velocidad propia. Se aplica por lotes.`,
        icon: 'i-lucide-circle-check',
        color: 'success',
    })
    emit('unificado')
}
</script>

<template>
    <div>
        <UAlert
            color="warning"
            variant="subtle"
            icon="i-lucide-split"
            :title="titulo"
            :actions="puedeUnificar ? [{ label: 'Unificar', icon: 'i-lucide-merge', color: 'warning', variant: 'solid', onClick: abrir }] : []"
            data-prueba="excepciones-heredadas"
        >
            <template #description>
                <p>
                    {{ nombres.join(', ') }}. Ahora cada router usa un solo modo: unificar pasa esos planes al modo del router, con vista previa antes de aplicar.
                </p>
                <p
                    v-if="!puedeUnificar"
                    class="mt-1"
                >
                    Pide a un administrador que lo unifique (permiso «routers.unificar_control_velocidad»).
                </p>
            </template>
        </UAlert>

        <UModal
            v-model:open="abierto"
            :title="`Unificar el control de velocidad · ${router.nombre}`"
            description="Los planes con velocidad propia pasan al modo del router. Nada se escribe hasta confirmar."
            :dismissible="!aplicando"
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
                        v-else-if="!vista"
                        class="h-48 w-full"
                    />
                    <template v-else>
                        <UAlert
                            v-if="!vista.planes.length"
                            color="neutral"
                            variant="subtle"
                            icon="i-lucide-circle-check"
                            title="El router ya usa un solo modo"
                            description="No quedan planes con velocidad propia."
                            data-prueba="unificar-sin-planes"
                        />
                        <section
                            v-else
                            class="flex flex-col gap-2"
                            aria-labelledby="titulo-planes-unificar"
                        >
                            <h3
                                id="titulo-planes-unificar"
                                class="text-sm font-medium text-highlighted"
                            >
                                Planes que cambian ({{ vista.planes.length }})
                            </h3>
                            <ul
                                class="flex flex-col divide-y divide-default rounded-lg border border-default"
                                data-prueba="unificar-planes"
                            >
                                <li
                                    v-for="plan in vista.planes"
                                    :key="plan.plan_id"
                                    class="flex flex-col gap-1 px-3 py-2 sm:flex-row sm:items-center sm:justify-between"
                                    :data-plan="plan.plan_id"
                                >
                                    <div class="flex min-w-0 flex-col gap-0.5">
                                        <span class="text-sm font-medium text-highlighted">{{ plan.nombre }}</span>
                                        <span class="text-xs text-muted">Deja su {{ plan.capas.map(c => CAPAS[c]).join(', ') || 'velocidad' }} propio y sigue el modo del router: {{ resumenEstrategia(plan.a.pppoe) }}.</span>
                                    </div>
                                    <span class="shrink-0 text-xs text-muted tabular-nums">{{ plan.servicios.toLocaleString('es-GT') }} servicios · {{ plan.sesiones_abiertas.toLocaleString('es-GT') }} sesiones abiertas</span>
                                </li>
                            </ul>
                        </section>
                        <EstrategiaVistaPrevia :vista="vista.vista_previa" />
                        <UAlert
                            v-if="vista.vista_previa.sesiones_conservan > 0 && !reconectar"
                            color="info"
                            variant="subtle"
                            icon="i-lucide-plug"
                            :title="`${vista.vista_previa.sesiones_conservan.toLocaleString('es-GT')} ${vista.vista_previa.sesiones_conservan === 1 ? 'sesión PPPoE toma' : 'sesiones PPPoE toman'} el modo del router al reconectar`"
                            description="RouterOS no deja cambiar la cola de una sesión abierta: esos clientes siguen como estaban hasta que su equipo vuelva a marcar. Nadie se queda sin internet."
                            data-prueba="unificar-reconectan"
                        />
                        <template v-if="vista.planes.length && puedeUnificar">
                            <UCheckbox
                                v-model="reconectar"
                                label="Reconectar ahora"
                                description="Desconecta las sesiones PPPoE de esos planes por lotes para que entren ya con el modo del router. Cada cliente se queda sin internet unos segundos."
                                data-prueba="unificar-reconectar"
                            />
                            <UAlert
                                v-if="reconectar"
                                color="error"
                                variant="subtle"
                                icon="i-lucide-unplug"
                                :title="`Se desconectarán ${vista.vista_previa.sesiones_a_desconectar.toLocaleString('es-GT')} ${vista.vista_previa.sesiones_a_desconectar === 1 ? 'sesión' : 'sesiones'}`"
                            >
                                <template #description>
                                    <UCheckbox
                                        v-model="confirmaReconectar"
                                        label="Entiendo que esos clientes se quedan sin internet unos segundos"
                                        class="mt-2"
                                        data-prueba="unificar-confirma-reconectar"
                                    />
                                </template>
                            </UAlert>
                            <UFormField
                                label="Motivo"
                                hint="Opcional"
                                help="Queda en la bitácora del router."
                            >
                                <UTextarea
                                    v-model="motivo"
                                    :rows="2"
                                    placeholder="Ej.: un solo modo por router"
                                    class="w-full"
                                />
                            </UFormField>
                        </template>
                        <ProblemaAlerta
                            v-if="problemaAplicar"
                            :problema="problemaAplicar"
                            data-prueba="unificar-error"
                        />
                    </template>
                </div>
            </template>
            <template #footer>
                <div class="flex w-full justify-end gap-2">
                    <UButton
                        label="Cancelar"
                        color="neutral"
                        variant="ghost"
                        :disabled="aplicando"
                        @click="abierto = false"
                    />
                    <UButton
                        v-if="puedeUnificar && vista?.planes.length"
                        label="Unificar"
                        icon="i-lucide-merge"
                        :color="reconectar ? 'error' : 'primary'"
                        :loading="aplicando || cargando"
                        :disabled="!puedeAplicar"
                        data-prueba="unificar-confirmar"
                        @click="aplicar"
                    />
                </div>
            </template>
        </UModal>
    </div>
</template>
