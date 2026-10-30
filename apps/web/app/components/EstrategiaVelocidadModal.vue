<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { EstrategiasRouter, MatrizControlVelocidad, VistaPreviaEstrategia } from '~/types/controlVelocidad'

/**
 * Cambiar la estrategia de velocidad del router por capas (`contratos/control-velocidad.md` §4):
 * 1. Editar: una estrategia por tipo de conexión (`EstrategiaVelocidadEditor`), con lo que la
 *    matriz no admite deshabilitado.
 * 2. Revisar: vista previa de la API (qué se crea, cambia y borra, sesiones con CoA y las que
 *    conservan lo anterior hasta reconectar) y, como opción avanzada con confirmación,
 *    «Reconectar ahora».
 * 3. Aplicar: `POST /routers/:id/cambiar-estrategia-velocidad` con `version`; 409 recarga.
 * Permiso: `routers.cambiar_control_velocidad` (quien lo abre lo comprobó).
 */
const props = defineProps<{
    router: RouterNas
}>()

const abierto = defineModel<boolean>('open', { default: false })

const emit = defineEmits<{
    actualizado: [router: RouterNas]
}>()

const toast = useToast()

const matriz = shallowRef<MatrizControlVelocidad | null>(null)
const problemaMatriz = ref<Problem | null>(null)
const estrategias = ref<EstrategiasRouter>(estrategiasDeRouter(props.router))
const paso = ref<'editar' | 'revisar'>('editar')
const vista = shallowRef<VistaPreviaEstrategia | null>(null)
const problema = ref<Problem | null>(null)
const errores = ref<Record<string, string[]>>({})
const cargando = ref(false)
const aplicando = ref(false)
const motivo = ref('')
const reconectar = ref(false)
const confirmaReconectar = ref(false)
const avanzadas = ref(false)

const version = computed(() => props.router.routeros_version ?? null)
const cambio = computed(() => JSON.stringify(estrategias.value) !== JSON.stringify(estrategiasDeRouter(props.router)))

async function cargarMatriz() {
    const resultado = await useControlVelocidad().matriz()
    matriz.value = resultado.ok ? resultado.data : null
    problemaMatriz.value = resultado.ok ? null : resultado.problema
}

watch(abierto, (valor) => {
    if (!valor) {
        return
    }
    estrategias.value = estrategiasDeRouter(props.router)
    paso.value = 'editar'
    vista.value = null
    problema.value = null
    errores.value = {}
    motivo.value = ''
    reconectar.value = false
    confirmaReconectar.value = false
    avanzadas.value = false
    void cargarMatriz()
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
    const resultado = await useControlVelocidad().vistaPrevia(props.router.id, { estrategia_velocidad: estrategias.value, reconectar: reconectar.value })
    cargando.value = false
    if (!resultado.ok) {
        recibirProblema(resultado.problema)
        return
    }
    vista.value = resultado.data
    paso.value = 'revisar'
}

// «Reconectar ahora» cambia cuántas sesiones se desconectan: se vuelve a pedir la vista previa.
watch(reconectar, (valor) => {
    confirmaReconectar.value = false
    if (paso.value === 'revisar') {
        void revisar()
    }
    if (!valor) {
        confirmaReconectar.value = false
    }
})

async function aplicar() {
    aplicando.value = true
    problema.value = null
    const resultado = await useControlVelocidad().cambiarRouter(props.router.id, {
        version: props.router.version,
        estrategia_velocidad: estrategias.value,
        ...(motivo.value.trim() ? { motivo: motivo.value.trim() } : {}),
        ...(reconectar.value ? { reconectar: true } : {}),
    })
    aplicando.value = false
    if (!resultado.ok) {
        recibirProblema(resultado.problema)
        return
    }
    abierto.value = false
    toast.add({
        title: `${props.router.nombre}: control de velocidad cambiado`,
        description: reconectar.value ? 'Se aplica por lotes y las sesiones PPPoE reconectan.' : 'Se aplica por lotes; las sesiones PPPoE ya conectadas cambian al reconectar.',
        icon: 'i-lucide-circle-check',
        color: 'success',
    })
    emit('actualizado', resultado.data)
}

const puedeAplicar = computed(() => vista.value?.valida && (!reconectar.value || confirmaReconectar.value))
</script>

<template>
    <UModal
        v-model:open="abierto"
        :title="`Control de velocidad · ${router.nombre}`"
        :description="paso === 'editar' ? 'Elige cómo se limita a los clientes según el tipo de conexión. Las opciones que no combinan se ven deshabilitadas con el porqué.' : 'Revisa qué cambia en el router antes de aplicar. Nada se escribe hasta confirmar.'"
        :dismissible="!aplicando"
        :ui="{ content: 'sm:max-w-3xl' }"
    >
        <template #body>
            <div
                class="flex flex-col gap-4"
                data-prueba="estrategia-modal"
            >
                <ProblemaAlerta
                    v-if="problemaMatriz"
                    :problema="problemaMatriz"
                    :reintentar="cargarMatriz"
                />
                <USkeleton
                    v-else-if="!matriz"
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
                        data-prueba="estrategia-errores"
                    />
                    <ProblemaAlerta
                        v-else-if="problema"
                        :problema="problema"
                    />
                    <EstrategiaVelocidadEditor
                        v-model:estrategias="estrategias"
                        :matriz="matriz"
                        :version="version"
                        :router="estrategiasDeRouter(router)"
                        :errores="errores"
                        :sin-radius="esSinRadius(router)"
                    />
                </template>
                <template v-else-if="vista">
                    <EstrategiaVistaPrevia :vista="vista" />
                    <UAlert
                        v-if="vista.sesiones_conservan > 0 && !reconectar"
                        color="info"
                        variant="subtle"
                        icon="i-lucide-plug"
                        :title="`${vista.sesiones_conservan.toLocaleString('es-GT')} ${vista.sesiones_conservan === 1 ? 'sesión PPPoE conserva' : 'sesiones PPPoE conservan'} lo anterior hasta reconectar`"
                        description="RouterOS no deja cambiar la cola de una sesión abierta: esos clientes siguen como estaban hasta que su equipo vuelva a marcar. Nadie se queda sin internet."
                        data-prueba="aviso-conservan"
                    />
                    <UCollapsible v-model:open="avanzadas">
                        <UButton
                            label="Opciones avanzadas"
                            :trailing-icon="avanzadas ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'"
                            color="neutral"
                            variant="ghost"
                            size="sm"
                            data-prueba="abrir-avanzadas"
                        />
                        <template #content>
                            <div class="flex flex-col gap-3 pt-2">
                                <UCheckbox
                                    v-model="reconectar"
                                    label="Reconectar ahora"
                                    description="Desconecta las sesiones PPPoE por lotes para que entren ya con lo nuevo. Cada cliente se queda sin internet unos segundos."
                                    data-prueba="reconectar"
                                />
                                <UAlert
                                    v-if="reconectar"
                                    color="error"
                                    variant="subtle"
                                    icon="i-lucide-unplug"
                                    :title="`Se desconectarán ${vista.sesiones_a_desconectar.toLocaleString('es-GT')} ${vista.sesiones_a_desconectar === 1 ? 'sesión' : 'sesiones'}`"
                                    data-prueba="aviso-reconectar"
                                >
                                    <template #description>
                                        <UCheckbox
                                            v-model="confirmaReconectar"
                                            label="Entiendo que esos clientes se quedan sin internet unos segundos"
                                            class="mt-2"
                                            data-prueba="confirma-reconectar"
                                        />
                                    </template>
                                </UAlert>
                            </div>
                        </template>
                    </UCollapsible>
                    <UFormField
                        label="Motivo"
                        hint="Opcional"
                        help="Queda en la bitácora del router."
                    >
                        <UTextarea
                            v-model="motivo"
                            :rows="2"
                            placeholder="Ej.: CAKE para bajar la latencia en horas pico"
                            class="w-full"
                        />
                    </UFormField>
                    <ProblemaAlerta
                        v-if="problema"
                        :problema="problema"
                        data-prueba="aplicar-error"
                    />
                </template>
            </div>
        </template>
        <template #footer>
            <div class="flex w-full justify-end gap-2">
                <UButton
                    v-if="paso === 'revisar'"
                    label="Volver a editar"
                    icon="i-lucide-chevron-left"
                    color="neutral"
                    variant="ghost"
                    :disabled="aplicando"
                    @click="paso = 'editar'"
                />
                <UButton
                    v-else
                    label="Cancelar"
                    color="neutral"
                    variant="ghost"
                    @click="abierto = false"
                />
                <UButton
                    v-if="paso === 'editar'"
                    label="Revisar cambios"
                    icon="i-lucide-eye"
                    :loading="cargando"
                    :disabled="!matriz || !cambio"
                    data-prueba="revisar-estrategia"
                    @click="revisar"
                />
                <UButton
                    v-else
                    label="Aplicar"
                    icon="i-lucide-check"
                    :color="reconectar ? 'error' : 'primary'"
                    :loading="aplicando || cargando"
                    :disabled="!puedeAplicar"
                    data-prueba="aplicar-estrategia"
                    @click="aplicar"
                />
            </div>
        </template>
    </UModal>
</template>
