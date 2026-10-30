<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { FormSubmitEvent, SelectItem } from '@nuxt/ui'

/**
 * Alta (`POST /qos/perfiles/:id/clases`) o edición (`PUT /qos/clases/:id`, con `version`) de una
 * clase de QoS (`contratos/qos.md` §1). Reglas de coincidencia (protocolo, puertos de destino y
 * origen, DSCP, lista de destino) o, para descargas pesadas, `bytes_minimo` y de qué clases toma
 * las conexiones. La clase «resto» solo cambia nombre, prioridad y porcentajes. Los 422 van junto a
 * su campo (`reglas.0.puertos_destino`); los del perfil (costo, máximo de clases), arriba. 409 por
 * nombre repetido junto al nombre; 409 por versión, con «Recargar». Permiso: `qos.gestionar`.
 */
const props = defineProps<{
    perfilId: number
    /** null = clase nueva. */
    clase: ClaseQos | null
    /** Clases del perfil: orígenes de las descargas y orden sugerido. */
    clases: ClaseQos[]
}>()

const abierto = defineModel<boolean>('open', { default: false })
const emit = defineEmits<{
    guardado: [clase: ClaseQos, nueva: boolean]
    recargar: []
}>()

const idFormulario = useId()
const formulario = useTemplateRef('formulario')
const esResto = computed(() => props.clase?.es_resto ?? false)
const esquema = computed(() => esquemaClaseQos(esResto.value))
const ordenSugerido = computed(() => Math.max(0, ...props.clases.filter(c => !c.es_resto && !esDescargaQos(c)).map(c => c.orden)) + 1)
const estado = reactive<EntradaClaseQos>(entradaClaseQos(null, 1))
const enviando = ref(false)
const problema = ref<Problem | null>(null)
const generales = ref<string[]>([])
let claveIdempotencia = nuevaClaveIdempotencia()

watch(abierto, (valor) => {
    if (valor) {
        Object.assign(estado, entradaClaseQos(props.clase, ordenSugerido.value))
        problema.value = null
        generales.value = []
        claveIdempotencia = nuevaClaveIdempotencia()
    }
}, { immediate: true })

const itemsProtocolo: SelectItem[] = ([CUALQUIERA, ...PROTOCOLOS_QOS] as const).map(p => ({ label: ETIQUETAS_PROTOCOLO[p], value: p }))
const itemsPrioridad: SelectItem[] = Array.from({ length: 8 }, (_, i) => ({ label: i === 0 ? '1 · primero' : i === 7 ? '8 · último' : String(i + 1), value: i + 1 }))
const itemsTipo = [
    { label: 'Por reglas', value: false, description: 'Protocolo, puertos, DSCP o lista de destino del primer paquete.' },
    { label: 'Descargas pesadas', value: true, description: 'Conexiones que ya pasaron cierta cantidad de bytes, tomadas de otras clases.' },
]

/** Orígenes posibles de una clase de descargas: activas, por reglas o resto, distintas de ella. */
const itemsOrigen = computed(() => props.clases
    .filter(c => c.activa && !esDescargaQos(c) && c.id !== props.clase?.id)
    .map(c => ({ label: c.nombre, value: c.id })))

const conPuertos = (protocolo: ProtocoloFormulario) => protocolo === 'tcp' || protocolo === 'udp'

function agregarRegla() {
    estado.reglas = [...estado.reglas, reglaVacia()]
}

function quitarRegla(indice: number) {
    estado.reglas = estado.reglas.filter((_, i) => i !== indice)
}

async function enviar(evento: FormSubmitEvent<SalidaClaseQos>) {
    enviando.value = true
    problema.value = null
    generales.value = []
    const resultado = props.clase
        ? await useQos().editarClase(props.clase.id, cambiosClaseQos(evento.data, props.clase))
        : await useQos().crearClase(props.perfilId, cuerpoClaseQos(evento.data), claveIdempotencia)
    enviando.value = false
    if (resultado.ok) {
        abierto.value = false
        emit('guardado', resultado.data, props.clase === null)
        return
    }
    const recibido = resultado.problema
    if (recibido.type.endsWith(':qos_nombre_duplicado')) {
        formulario.value?.setErrors([{ name: 'nombre', message: recibido.detail ?? 'El perfil ya tiene una clase con ese nombre' }])
        return
    }
    if (recibido.status === 422) {
        const separados = separarErroresQos(recibido.errors ?? [])
        formulario.value?.setErrors(separados.campos)
        generales.value = separados.generales
        if (separados.campos.length && !separados.generales.length) {
            return
        }
    }
    problema.value = recibido
}

function recargar() {
    abierto.value = false
    emit('recargar')
}
</script>

<template>
    <UModal
        v-model:open="abierto"
        :title="clase ? `Editar ${clase.nombre}` : 'Nueva clase'"
        :description="clase ? `Versión ${clase.version}${esResto ? ' · lo que no coincide con otra clase' : ''}` : 'Se agrega activa; los routers que usan el perfil se reconcilian solos.'"
        :dismissible="!enviando"
        :ui="{ content: 'sm:max-w-2xl' }"
    >
        <template #body>
            <UForm
                :id="idFormulario"
                ref="formulario"
                :schema="esquema"
                :state="estado"
                class="flex flex-col gap-4"
                data-prueba="form-clase-qos"
                @submit="enviar"
            >
                <UAlert
                    v-if="generales.length"
                    color="error"
                    variant="subtle"
                    icon="i-lucide-circle-alert"
                    title="El perfil no quedaría válido"
                    :description="generales.join(' · ')"
                    data-prueba="clase-errores-perfil"
                />
                <ProblemaAlerta
                    v-if="problema"
                    :problema="problema"
                    :reintentar="problema.status === 409 ? recargar : undefined"
                    data-prueba="clase-problema"
                />

                <div class="grid gap-4 sm:grid-cols-[minmax(0,1fr)_8rem]">
                    <UFormField
                        label="Nombre"
                        name="nombre"
                        required
                    >
                        <UInput
                            v-model="estado.nombre"
                            placeholder="Videollamadas"
                            class="w-full"
                            data-prueba="clase-nombre"
                        />
                    </UFormField>
                    <UFormField
                        v-if="!esResto && !estado.descargas"
                        label="Orden"
                        name="orden"
                        required
                        help="La primera que coincide gana."
                    >
                        <UInputNumber
                            v-model="estado.orden"
                            :min="1"
                            :max="1000"
                            class="w-full"
                            data-prueba="clase-orden"
                        />
                    </UFormField>
                </div>

                <div class="grid gap-4 sm:grid-cols-3">
                    <UFormField
                        label="Prioridad"
                        name="prioridad"
                        required
                        help="1 pasa primero cuando hay cuello."
                    >
                        <USelect
                            v-model="estado.prioridad"
                            :items="itemsPrioridad"
                            class="w-full"
                            data-prueba="clase-prioridad"
                        />
                    </UFormField>
                    <UFormField
                        label="Garantizado (%)"
                        name="garantizado_pct"
                        help="Del plan; la suma de las activas ≤ 100 %."
                    >
                        <UInputNumber
                            v-model="estado.garantizado_pct"
                            :min="0"
                            :max="100"
                            class="w-full"
                            data-prueba="clase-garantizado"
                        />
                    </UFormField>
                    <UFormField
                        label="Tope (%)"
                        name="tope_pct"
                        help="Vacío: sin tope."
                    >
                        <UInputNumber
                            v-model="estado.tope_pct"
                            :min="1"
                            :max="100"
                            class="w-full"
                            data-prueba="clase-tope"
                        />
                    </UFormField>
                </div>

                <template v-if="!esResto">
                    <UFormField
                        label="Qué toma esta clase"
                        name="descargas"
                    >
                        <URadioGroup
                            v-model="estado.descargas"
                            :items="itemsTipo"
                            variant="card"
                            orientation="horizontal"
                            class="w-full"
                            :ui="{ fieldset: 'grid gap-2 sm:grid-cols-2' }"
                            data-prueba="clase-tipo"
                        />
                    </UFormField>

                    <div
                        v-if="estado.descargas"
                        class="grid gap-4 sm:grid-cols-2"
                    >
                        <UFormField
                            label="Desde (bytes)"
                            name="bytes_minimo"
                            required
                            :help="estado.bytes_minimo ? `Una conexión pasa aquí al superar ${formatearBytes(estado.bytes_minimo)} (los dos sentidos).` : 'Ej.: 10000000 = 10 MB.'"
                        >
                            <UInputNumber
                                v-model="estado.bytes_minimo"
                                :min="1"
                                :step="1_000_000"
                                :format-options="{ useGrouping: false }"
                                :step-snapping="false"
                                class="w-full"
                                data-prueba="clase-bytes"
                            />
                        </UFormField>
                        <UFormField
                            label="Toma las conexiones de"
                            name="reclasifica_de"
                            required
                        >
                            <USelectMenu
                                v-model="estado.reclasifica_de"
                                :items="itemsOrigen"
                                value-key="value"
                                multiple
                                placeholder="Web y Resto"
                                class="w-full"
                                data-prueba="clase-origenes"
                            />
                        </UFormField>
                    </div>

                    <UFormField
                        :label="estado.descargas ? 'Reglas (opcionales)' : 'Reglas'"
                        name="reglas"
                        :required="!estado.descargas"
                        description="Una conexión entra si cumple cualquiera de las reglas; dentro de una regla, todo lo escrito. Se mira el primer paquete (cliente → Internet): «destino» es el servidor."
                    >
                        <div
                            class="flex flex-col gap-3"
                            data-prueba="clase-reglas"
                        >
                            <div
                                v-for="(regla, indice) in estado.reglas"
                                :key="indice"
                                class="surface-card flex flex-col gap-3 p-3"
                                :data-regla="indice"
                            >
                                <div class="flex items-center justify-between gap-2">
                                    <span class="text-xs font-medium text-muted">Regla {{ indice + 1 }}</span>
                                    <UButton
                                        icon="i-lucide-trash-2"
                                        color="neutral"
                                        variant="ghost"
                                        size="xs"
                                        :aria-label="`Quitar la regla ${indice + 1}`"
                                        @click="quitarRegla(indice)"
                                    />
                                </div>
                                <div class="grid gap-3 sm:grid-cols-3">
                                    <UFormField
                                        label="Protocolo"
                                        :name="`reglas.${indice}.protocolo`"
                                    >
                                        <USelect
                                            v-model="regla.protocolo"
                                            :items="itemsProtocolo"
                                            class="w-full"
                                            :data-prueba="`regla-protocolo-${indice}`"
                                        />
                                    </UFormField>
                                    <UFormField
                                        label="Puertos de destino"
                                        :name="`reglas.${indice}.puertos_destino`"
                                        :hint="conPuertos(regla.protocolo) ? undefined : 'Solo TCP/UDP'"
                                    >
                                        <UInput
                                            v-model="regla.puertos_destino"
                                            placeholder="5060-5061,10000-20000"
                                            :disabled="!conPuertos(regla.protocolo)"
                                            class="w-full font-mono"
                                            :data-prueba="`regla-puertos-destino-${indice}`"
                                        />
                                    </UFormField>
                                    <UFormField
                                        label="Puertos de origen"
                                        :name="`reglas.${indice}.puertos_origen`"
                                        :hint="conPuertos(regla.protocolo) ? undefined : 'Solo TCP/UDP'"
                                    >
                                        <UInput
                                            v-model="regla.puertos_origen"
                                            :disabled="!conPuertos(regla.protocolo)"
                                            class="w-full font-mono"
                                            :data-prueba="`regla-puertos-origen-${indice}`"
                                        />
                                    </UFormField>
                                </div>
                                <div class="grid gap-3 sm:grid-cols-[8rem_minmax(0,1fr)]">
                                    <UFormField
                                        label="DSCP"
                                        :name="`reglas.${indice}.dscp`"
                                        hint="0–63"
                                    >
                                        <UInputNumber
                                            v-model="regla.dscp"
                                            :min="0"
                                            :max="63"
                                            class="w-full"
                                            :data-prueba="`regla-dscp-${indice}`"
                                        />
                                    </UFormField>
                                    <UFormField
                                        label="Lista de destino"
                                        :name="`reglas.${indice}.lista_destino`"
                                        help="address-list que mantienes en el router (IPv4 e IPv6)."
                                    >
                                        <UInput
                                            v-model="regla.lista_destino"
                                            placeholder="argosisp-qos-streaming"
                                            class="w-full font-mono"
                                            :data-prueba="`regla-lista-${indice}`"
                                        />
                                    </UFormField>
                                </div>
                            </div>
                            <UButton
                                v-if="estado.reglas.length < QOS_MAX_REGLAS"
                                label="Agregar regla"
                                icon="i-lucide-plus"
                                color="neutral"
                                variant="outline"
                                size="sm"
                                class="self-start"
                                data-prueba="agregar-regla"
                                @click="agregarRegla"
                            />
                        </div>
                    </UFormField>
                </template>
            </UForm>
        </template>
        <template #footer>
            <div class="flex w-full justify-end gap-2">
                <UButton
                    label="Cancelar"
                    color="neutral"
                    variant="ghost"
                    :disabled="enviando"
                    @click="abierto = false"
                />
                <UButton
                    type="submit"
                    :form="idFormulario"
                    :label="clase ? 'Guardar' : 'Crear clase'"
                    icon="i-lucide-save"
                    :loading="enviando"
                    data-prueba="guardar-clase"
                />
            </div>
        </template>
    </UModal>
</template>
