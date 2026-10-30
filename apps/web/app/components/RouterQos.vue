<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { SelectItem } from '@nuxt/ui'

/**
 * «Prioridad por clases (QoS)» en la ficha del router (`contratos/qos.md` §2 y §4): el perfil que usa
 * (sin elegir, el predeterminado), su costo en este router y, con `qos.gestionar`, el selector
 * (`POST /routers/:id/qos-perfil` con `version`). Solo se ofrecen perfiles comunes o de la empresa
 * sugerida del router; la API igual responde 422 `qos_empresa` o `qos_costo` junto al selector y 409
 * si el router cambió. Si ningún tipo de conexión tiene el extra `qos`, lo dice: el perfil no se usa.
 */
const props = defineProps<{
    router: RouterNas
}>()

const emit = defineEmits<{
    actualizado: [router: RouterNas]
    recargar: []
}>()

const { puede } = usePermisos()
const toast = useToast()
/** Quien la ve ya tiene `qos.ver` (la ficha lo comprueba); los enlaces a los perfiles lo repiten. */
const verPerfiles = computed(() => puede('qos.ver'))

const PREDETERMINADO = 0
const perfiles = shallowRef<PerfilQos[]>([])
const efectivo = shallowRef<PerfilQosDetalle | null>(null)
const cargando = ref(false)
const problema = ref<Problem | null>(null)
const elegido = ref<number>(PREDETERMINADO)
const guardando = ref(false)
const problemaGuardar = ref<Problem | null>(null)
const errorCampo = ref<string | null>(null)

const predeterminado = computed(() => perfiles.value.find(p => p.predeterminado) ?? null)
const tiposConQos = computed(() => TIPOS_CONEXION_VELOCIDAD.filter(t => props.router.estrategia_velocidad[t].extras.qos))
const uso = computed(() => efectivo.value?.routers.find(r => r.router_id === props.router.id) ?? null)

async function cargar() {
    cargando.value = true
    problema.value = null
    const lista = await useQos().todos()
    if (!lista.ok) {
        cargando.value = false
        problema.value = lista.problema
        return
    }
    perfiles.value = lista.data
    const id = props.router.qos_perfil_id ?? predeterminado.value?.id ?? null
    const detalle = id === null ? null : await useQos().ver(id)
    cargando.value = false
    efectivo.value = detalle?.ok ? detalle.data : null
    problema.value = detalle && !detalle.ok ? detalle.problema : null
}

watch(() => [props.router.id, props.router.version], () => {
    elegido.value = props.router.qos_perfil_id ?? PREDETERMINADO
    problemaGuardar.value = null
    errorCampo.value = null
    void cargar()
}, { immediate: true })

const items = computed<SelectItem[]>(() => [
    { label: predeterminado.value && predeterminado.value.nombre !== 'Predeterminado' ? `Predeterminado (${predeterminado.value.nombre})` : 'Predeterminado', value: PREDETERMINADO },
    ...perfiles.value
        .filter(p => !p.predeterminado && (p.empresa_id === null || p.empresa_id === props.router.empresa_sugerida_id))
        .map(p => ({ label: p.nombre, value: p.id })),
])

const cambio = computed(() => elegido.value !== (props.router.qos_perfil_id ?? PREDETERMINADO))

async function guardar() {
    guardando.value = true
    problemaGuardar.value = null
    errorCampo.value = null
    const resultado = await useQos().asignarPerfil(props.router.id, { version: props.router.version, qos_perfil_id: elegido.value === PREDETERMINADO ? null : elegido.value })
    guardando.value = false
    if (resultado.ok) {
        toast.add({ title: `${resultado.data.nombre}: perfil de QoS cambiado`, description: tiposConQos.value.length ? 'El router se reconcilia solo.' : 'Se usará cuando prendas QoS en el control de velocidad.', icon: 'i-lucide-circle-check', color: 'success' })
        emit('actualizado', resultado.data)
        return
    }
    const campo = (resultado.problema.errors ?? []).filter(e => e.field === 'qos_perfil_id').map(e => e.message)
    if (campo.length) {
        errorCampo.value = campo.join(' · ')
        return
    }
    problemaGuardar.value = resultado.problema
}
</script>

<template>
    <section
        class="surface-card flex flex-col gap-4 p-4 sm:p-6"
        aria-labelledby="titulo-qos-router"
        data-prueba="router-qos"
    >
        <div class="flex flex-wrap items-center justify-between gap-2">
            <h2
                id="titulo-qos-router"
                class="text-base font-semibold text-highlighted"
            >
                Prioridad por clases (QoS)
            </h2>
            <UButton
                v-if="verPerfiles"
                to="/red/qos"
                label="Perfiles"
                icon="i-lucide-list-ordered"
                color="neutral"
                variant="ghost"
                size="sm"
            />
        </div>

        <p
            class="flex items-start gap-1.5 text-sm"
            :class="tiposConQos.length ? 'text-success' : 'text-muted'"
            data-prueba="qos-estado-router"
        >
            <UIcon
                :name="tiposConQos.length ? 'i-lucide-circle-check' : 'i-lucide-circle-off'"
                class="mt-0.5 size-4 shrink-0"
            />
            <span v-if="tiposConQos.length">Prendido en {{ tiposConQos.map(t => ETIQUETAS_TIPO_CONEXION[t]).join(', ') }}.</span>
            <span v-else>Apagado: se prende en el control de velocidad (árbol de colas con PCQ y FastTrack verificado). Cada plan puede tener su excepción.</span>
        </p>

        <ProblemaAlerta
            v-if="problema"
            :problema="problema"
            :reintentar="cargar"
            :reintentando="cargando"
        />
        <USkeleton
            v-else-if="cargando && !efectivo"
            class="h-16 w-full"
        />
        <template v-else>
            <div
                v-if="efectivo"
                class="flex flex-col gap-1"
            >
                <p class="text-sm">
                    Usa <ULink
                        :to="verPerfiles ? `/red/qos/${efectivo.id}` : undefined"
                        class="font-medium text-highlighted"
                        data-prueba="qos-perfil-router"
                    >{{ efectivo.nombre }}</ULink>
                    <span class="text-muted"> · {{ efectivo.clases.filter(c => c.activa).length }} clases activas</span>
                </p>
                <QosCosto
                    v-if="uso"
                    :uso="uso"
                />
            </div>

            <div
                v-if="puede('qos.gestionar')"
                class="flex flex-col gap-2 sm:flex-row sm:items-end"
            >
                <UFormField
                    label="Perfil de QoS"
                    :error="errorCampo ?? undefined"
                    help="Perfiles comunes o de la empresa sugerida del router."
                    class="w-full sm:max-w-sm"
                >
                    <USelect
                        v-model="elegido"
                        :items="items"
                        class="w-full"
                        data-prueba="qos-perfil-selector"
                    />
                </UFormField>
                <UButton
                    label="Guardar"
                    icon="i-lucide-save"
                    :loading="guardando"
                    :disabled="!cambio"
                    class="self-start sm:self-auto"
                    data-prueba="qos-perfil-guardar"
                    @click="guardar"
                />
            </div>
            <ProblemaAlerta
                v-if="problemaGuardar"
                :problema="problemaGuardar"
                :reintentar="problemaGuardar.status === 409 ? () => emit('recargar') : undefined"
            />
        </template>
    </section>
</template>
