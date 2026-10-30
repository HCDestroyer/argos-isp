<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { EstrategiasPlan, MatrizControlVelocidad, VistaPreviaEstrategia } from '~/types/controlVelocidad'

/**
 * Excepción de velocidad del plan en un router (`POST /planes/:id/routers/:routerId/estrategia-velocidad`,
 * `routers.cambiar_control_velocidad`, `contratos/control-velocidad.md` §2 y §4): las mismas capas
 * que el router, cada una con «Heredar del router». Antes de aplicar, la vista previa del router con
 * esta excepción. Sin capas propias se manda `null` (hereda todo). Un plan global sin implementación
 * en el router se manda sin `version`: la API crea la fila solo con la estrategia.
 */
const props = defineProps<{
    plan: Plan
    routerId: number
    /** La implementación del plan en el router (su `version` y la excepción guardada), si existe. */
    implementacion: PlanRouter | null
}>()

const abierto = defineModel<boolean>('open', { default: false })

const emit = defineEmits<{
    guardado: []
}>()

const toast = useToast()

const router = shallowRef<RouterNas | null>(null)
const matriz = shallowRef<MatrizControlVelocidad | null>(null)
const problemaCarga = ref<Problem | null>(null)
const excepcion = ref<EstrategiasPlan | null>(null)
const paso = ref<'editar' | 'revisar'>('editar')
const vista = shallowRef<VistaPreviaEstrategia | null>(null)
const problema = ref<Problem | null>(null)
const errores = ref<Record<string, string[]>>({})
const cargando = ref(false)
const aplicando = ref(false)

async function cargar() {
    problemaCarga.value = null
    const [r, m] = await Promise.all([useRouters().ver(props.routerId), useControlVelocidad().matriz()])
    router.value = r.ok ? r.data : null
    matriz.value = m.ok ? m.data : null
    problemaCarga.value = !r.ok ? r.problema : !m.ok ? m.problema : null
}

watch(abierto, (valor) => {
    if (!valor) {
        return
    }
    excepcion.value = clonarEstrategia(props.implementacion?.estrategia_velocidad ?? null)
    paso.value = 'editar'
    vista.value = null
    problema.value = null
    errores.value = {}
    void cargar()
}, { immediate: true })

function recibirProblema(recibido: Problem) {
    problema.value = recibido
    errores.value = recibido.status === 422 ? erroresPorCapa(recibido.errors ?? []) : {}
    if (recibido.status === 422) {
        paso.value = 'editar'
    }
}

async function revisar() {
    cargando.value = true
    problema.value = null
    errores.value = {}
    const resultado = await useControlVelocidad().vistaPrevia(props.routerId, { planes: [{ plan_id: props.plan.id, estrategia_velocidad: excepcion.value }] })
    cargando.value = false
    if (!resultado.ok) {
        recibirProblema(resultado.problema)
        return
    }
    vista.value = resultado.data
    paso.value = 'revisar'
}

async function aplicar() {
    aplicando.value = true
    const resultado = await useControlVelocidad().cambiarPlan(props.plan.id, props.routerId, {
        ...(props.implementacion ? { version: props.implementacion.version } : {}),
        estrategia_velocidad: excepcion.value,
    })
    aplicando.value = false
    if (!resultado.ok) {
        recibirProblema(resultado.problema)
        return
    }
    abierto.value = false
    toast.add({ title: excepcion.value ? 'Excepción de velocidad guardada' : 'El plan vuelve a heredar del router', description: `${props.plan.nombre} en ${router.value?.nombre ?? `el router ${props.routerId}`}`, icon: 'i-lucide-circle-check', color: 'success' })
    emit('guardado')
}
</script>

<template>
    <UModal
        v-model:open="abierto"
        :title="`Velocidad de ${plan.nombre} en ${router?.nombre ?? `el router ${routerId}`}`"
        description="Por defecto el plan usa lo que eligió el router. Cambia solo las capas que este plan necesite distintas."
        :dismissible="!aplicando"
        :ui="{ content: 'sm:max-w-3xl' }"
    >
        <template #body>
            <div
                class="flex flex-col gap-4"
                data-prueba="estrategia-plan"
            >
                <ProblemaAlerta
                    v-if="problemaCarga"
                    :problema="problemaCarga"
                    :reintentar="cargar"
                />
                <USkeleton
                    v-else-if="!router || !matriz"
                    class="h-64 w-full"
                />
                <template v-else-if="paso === 'editar'">
                    <UAlert
                        v-if="problema && problema.status === 422"
                        color="error"
                        variant="subtle"
                        icon="i-lucide-circle-alert"
                        title="Algunas capas no combinan"
                        :description="(problema.errors ?? []).map(e => e.message).join(' · ')"
                    />
                    <ProblemaAlerta
                        v-else-if="problema"
                        :problema="problema"
                    />
                    <EstrategiaVelocidadEditor
                        v-model:excepcion="excepcion"
                        :matriz="matriz"
                        :version="router.routeros_version ?? null"
                        :router="estrategiasDeRouter(router)"
                        :errores="errores"
                    />
                </template>
                <template v-else-if="vista">
                    <EstrategiaVistaPrevia :vista="vista" />
                    <ProblemaAlerta
                        v-if="problema"
                        :problema="problema"
                    />
                </template>
            </div>
        </template>
        <template #footer>
            <div class="flex w-full justify-end gap-2">
                <UButton
                    :label="paso === 'revisar' ? 'Volver a editar' : 'Cancelar'"
                    color="neutral"
                    variant="ghost"
                    :disabled="aplicando"
                    @click="paso === 'revisar' ? (paso = 'editar') : (abierto = false)"
                />
                <UButton
                    v-if="paso === 'editar'"
                    label="Revisar cambios"
                    icon="i-lucide-eye"
                    :loading="cargando"
                    :disabled="!router || !matriz"
                    data-prueba="revisar-estrategia-plan"
                    @click="revisar"
                />
                <UButton
                    v-else
                    label="Aplicar"
                    icon="i-lucide-check"
                    :loading="aplicando"
                    :disabled="!vista?.valida"
                    data-prueba="aplicar-estrategia-plan"
                    @click="aplicar"
                />
            </div>
        </template>
    </UModal>
</template>
