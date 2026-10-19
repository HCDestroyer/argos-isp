<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'

/**
 * Credencial de un adicional (`GET …/:asignacionId/credencial`, `servicios.ver_credencial_adicional`):
 * se pide al abrir (cada consulta queda en la bitácora), se ve con "Copiar" y el modal se cierra
 * solo a los `segundos` (30 por defecto). Al cerrarse se olvida: nunca se guarda.
 */
const props = withDefaults(defineProps<{
    servicioId: number
    asignacion: AdicionalServicio
    /** Segundos a la vista (por defecto `SEGUNDOS_CREDENCIAL_VISIBLE`). */
    segundos?: number
}>(), {
    segundos: SEGUNDOS_CREDENCIAL_VISIBLE,
})

const abierto = defineModel<boolean>('open', { default: false })
const emit = defineEmits<{ consultado: [] }>()

const toast = useToast()
const dato = shallowRef<CredencialAdicional | null>(null)
const cargando = ref(false)
const problema = ref<Problem | null>(null)
const restante = ref(props.segundos)
let reloj: ReturnType<typeof setInterval> | undefined

function detener() {
    clearInterval(reloj)
    reloj = undefined
}

function iniciarCuenta() {
    detener()
    restante.value = props.segundos
    reloj = setInterval(() => {
        restante.value -= 1
        if (restante.value <= 0) {
            abierto.value = false
        }
    }, 1000)
}

async function consultar() {
    cargando.value = true
    problema.value = null
    const resultado = await useAdicionalesServicio().credencial(props.servicioId, props.asignacion.id)
    cargando.value = false
    if (!resultado.ok) {
        problema.value = resultado.problema
        return
    }
    dato.value = resultado.data
    emit('consultado')
    iniciarCuenta()
}

watch(abierto, (valor) => {
    detener()
    dato.value = null
    problema.value = null
    if (valor) {
        void consultar()
    }
}, { immediate: true })
onBeforeUnmount(detener)

async function copiar(etiqueta: string, valor: string) {
    try {
        await navigator.clipboard.writeText(valor)
        toast.add({ title: `${etiqueta} copiado`, color: 'neutral', icon: 'i-lucide-clipboard-check' })
    }
    catch {
        toast.add({ title: 'No se pudo copiar', description: 'Selecciona el texto y cópialo a mano.', color: 'warning', icon: 'i-lucide-clipboard-x' })
    }
}
</script>

<template>
    <UModal
        v-model:open="abierto"
        :title="`Credencial de ${asignacion.adicional_nombre}`"
        description="Cada consulta queda registrada en la bitácora."
    >
        <template #body>
            <div
                class="flex flex-col gap-4"
                data-prueba="credencial-adicional"
            >
                <ProblemaAlerta
                    v-if="problema"
                    :problema="problema"
                    :reintentar="consultar"
                    :reintentando="cargando"
                />
                <USkeleton
                    v-else-if="cargando || !dato"
                    class="h-20 w-full"
                />
                <template v-else>
                    <dl class="flex flex-col gap-3">
                        <div
                            v-if="dato.identificador"
                            class="flex flex-col gap-0.5"
                        >
                            <dt class="text-xs font-medium text-muted">
                                Identificador
                            </dt>
                            <dd class="flex items-center gap-1 font-mono text-sm text-highlighted">
                                <span class="break-all">{{ dato.identificador }}</span>
                                <UButton
                                    icon="i-lucide-copy"
                                    color="neutral"
                                    variant="ghost"
                                    size="xs"
                                    aria-label="Copiar identificador"
                                    @click="copiar('Identificador', dato.identificador)"
                                />
                            </dd>
                        </div>
                        <div class="flex flex-col gap-0.5">
                            <dt class="text-xs font-medium text-muted">
                                Credencial
                            </dt>
                            <dd class="flex items-center gap-1 font-mono text-sm text-highlighted">
                                <span
                                    class="break-all"
                                    data-prueba="credencial-valor"
                                >{{ dato.credencial }}</span>
                                <UButton
                                    icon="i-lucide-copy"
                                    color="neutral"
                                    variant="ghost"
                                    size="xs"
                                    aria-label="Copiar credencial"
                                    @click="copiar('Credencial', dato.credencial)"
                                />
                            </dd>
                        </div>
                    </dl>
                    <UProgress
                        :model-value="restante"
                        :max="segundos"
                        size="xs"
                        color="neutral"
                        aria-label="Tiempo antes de ocultarse"
                    />
                    <p
                        class="text-xs text-muted"
                        data-prueba="credencial-restante"
                    >
                        Se oculta sola en {{ restante }} s.
                    </p>
                </template>
            </div>
        </template>
        <template #footer>
            <div class="flex w-full justify-end">
                <UButton
                    label="Ocultar"
                    icon="i-lucide-eye-off"
                    color="neutral"
                    variant="outline"
                    data-prueba="ocultar-credencial"
                    @click="abierto = false"
                />
            </div>
        </template>
    </UModal>
</template>
