<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { FormSubmitEvent } from '@nuxt/ui'

/**
 * SmartOLT o GenieACS de la empresa activa (A6, `GET`/`PUT /integraciones/equipos` y `POST
 * …/probar`; CLAUDE.md §14: un ACS y una OLT por empresa, en su propio servidor). Las dos comparten
 * la misma configuración y `version`: esta tarjeta edita la parte de un sistema y conserva la otra.
 * Los secretos se guardan cifrados y nunca vuelven (`CampoSecreto`). «Probar conexión» prueba lo
 * guardado y deja el resultado; de él sale lo que Iris puede pedir (capacidades).
 */
const props = defineProps<{
    sistema: SistemaEquipos
}>()

const emit = defineEmits<{ cambio: [config: ConfigEquipos] }>()

const { puede } = usePermisos()
const toast = useToast()
const { eleccion, empresaId, empresa } = useEmpresaActiva()
const enTodas = computed(() => eleccion.value === 'todas' || empresaId.value === null)

const config = shallowRef<ConfigEquipos | null>(null)
const cargando = ref(false)
const problema = ref<Problem | null>(null)
const pideEmpresa = computed(() => enTodas.value || (problema.value !== null && codigoProblema(problema.value) === 'empresa_requerida'))
const editable = computed(() => puede('smartolt.editar_instancia'))

const formulario = useTemplateRef('formulario')
const idFormulario = useId()
const estado = reactive<EntradaEquipos>({ activo: false, smartolt_url: '', genieacs_url: '', genieacs_usuario: '', pppoe_por_acs: false, perfiles: [] })
const nuevoSecreto = (): Secreto => ({ accion: 'conservar', valor: '' })
const secretos = reactive({ smartolt_token: nuevoSecreto(), genieacs_clave: nuevoSecreto(), genieacs_ca: nuevoSecreto() })
const enviando = ref(false)
const problemaGuardar = ref<Problem | null>(null)
const probando = ref(false)
const prueba = shallowRef<PruebaEquipos | null>(null)

const parte = computed(() => (config.value ? config.value[props.sistema] : null))
const presentacion = computed(() => (config.value ? estadoEquipos(config.value, props.sistema) : null))
const sinCambios = computed(() => config.value === null
    || (JSON.stringify(entradaEquipos(config.value)) === JSON.stringify({ ...estado, perfiles: estado.perfiles.map(p => ({ ...p })) })
        && Object.values(secretos).every(s => s.accion === 'conservar')))

function rellenar(datos: ConfigEquipos) {
    config.value = datos
    Object.assign(estado, entradaEquipos(datos))
    Object.assign(secretos, { smartolt_token: nuevoSecreto(), genieacs_clave: nuevoSecreto(), genieacs_ca: nuevoSecreto() })
    formulario.value?.clear()
    emit('cambio', datos)
}

async function cargar() {
    problemaGuardar.value = null
    prueba.value = null
    if (enTodas.value) {
        config.value = null
        problema.value = null
        return
    }
    cargando.value = true
    const r = await useEquiposIntegracion().ver()
    cargando.value = false
    problema.value = r.ok ? null : r.problema
    if (r.ok) {
        rellenar(r.data)
    }
    else {
        config.value = null
    }
}

async function guardar(evento: FormSubmitEvent<SalidaEquipos>) {
    if (!config.value) {
        return
    }
    enviando.value = true
    problemaGuardar.value = null
    const cambios: CambiosConfigEquipos = {
        activo: evento.data.activo,
        smartolt_url: evento.data.smartolt_url,
        genieacs_url: evento.data.genieacs_url,
        genieacs_usuario: evento.data.genieacs_usuario,
        pppoe_por_acs: evento.data.pppoe_por_acs,
        perfiles: evento.data.perfiles,
    }
    const token = secretoEnCuerpo(secretos.smartolt_token)
    const clave = secretoEnCuerpo(secretos.genieacs_clave)
    const ca = secretoEnCuerpo(secretos.genieacs_ca)
    if (token !== undefined) {
        cambios.smartolt_token = token
    }
    if (clave !== undefined) {
        cambios.genieacs_clave = clave
    }
    if (ca !== undefined) {
        cambios.genieacs_ca = ca
    }
    const r = await useEquiposIntegracion().guardar(config.value.version, cambios)
    enviando.value = false
    if (!r.ok) {
        problemaGuardar.value = r.problema
        if (r.problema.status === 422) {
            formulario.value?.setErrors(erroresDeFormulario(r.problema))
        }
        return
    }
    rellenar(r.data)
    toast.add({ title: `${props.sistema === 'smartolt' ? 'SmartOLT' : 'GenieACS'} guardado`, description: 'Prueba la conexión para que Iris pueda usarlo.', icon: 'i-lucide-circle-check', color: 'success' })
}

async function probar() {
    probando.value = true
    const r = await useEquiposIntegracion().probar()
    probando.value = false
    if (!r.ok) {
        toast.add({ title: r.problema.title, description: r.problema.detail, icon: 'i-lucide-circle-alert', color: 'error' })
        return
    }
    prueba.value = r.data
    const resultado = r.data[props.sistema]
    toast.add(resultado?.ok
        ? { title: 'Conexión correcta', description: resultado.latencia_ms !== null ? `Respondió en ${resultado.latencia_ms} ms.` : undefined, icon: 'i-lucide-plug-zap', color: 'success' }
        : { title: 'No se pudo conectar', description: resultado?.error ?? 'Guarda primero la dirección.', icon: 'i-lucide-circle-alert', color: 'error' })
    // Lo guardado no cambió (la prueba solo deja su resultado): se relee para el estado y la versión.
    const leida = await useEquiposIntegracion().ver()
    if (leida.ok && config.value) {
        config.value = leida.data
        emit('cambio', leida.data)
    }
}

/* Perfiles de autorización de SmartOLT (OLT + plan → preset). */
const planes = shallowRef<Plan[]>([])
const olts = computed(() => prueba.value?.smartolt?.olts ?? [])
const itemsPlanes = computed(() => [{ label: 'Cualquier plan', value: 0 }, ...planes.value.map(p => ({ label: p.nombre, value: p.id }))])
const itemsPon = [{ label: 'GPON', value: 'gpon' }, { label: 'EPON', value: 'epon' }]

function agregarPerfil() {
    estado.perfiles = [...estado.perfiles, { smartolt_olt_id: olts.value[0]?.id ?? '', plan_id: null, authorization_preset_id: 1, pon_type: 'gpon' }]
}

function quitarPerfil(indice: number) {
    estado.perfiles = estado.perfiles.filter((_, i) => i !== indice)
}

function nombreOlt(id: string): string {
    return olts.value.find(o => o.id === id)?.name ?? `OLT ${id}`
}

watch(empresaId, cargar)
onMounted(async () => {
    void cargar()
    if (props.sistema === 'smartolt' && puede('planes.ver')) {
        const r = await usePlanes().listar()
        planes.value = r.ok ? r.data.data : []
    }
})
</script>

<template>
    <div
        class="flex min-w-0 flex-col gap-4"
        :data-prueba="`equipos-${sistema}`"
    >
        <UAlert
            v-if="pideEmpresa"
            color="info"
            variant="subtle"
            icon="i-lucide-building"
            title="Elige una empresa"
            description="Cada empresa tiene su propio SmartOLT y su propio GenieACS: elige una en el selector de empresa de arriba."
            data-prueba="equipos-elige-empresa"
        />
        <ProblemaAlerta
            v-else-if="problema"
            :problema="problema"
            :reintentar="cargar"
            :reintentando="cargando"
        />
        <USkeleton
            v-else-if="!config || !parte || !presentacion"
            class="h-40 w-full"
        />
        <template v-else>
            <div class="flex flex-wrap items-center gap-2">
                <UBadge
                    :label="presentacion.etiqueta"
                    :icon="presentacion.icono"
                    :color="presentacion.color"
                    variant="subtle"
                    :data-prueba="`estado-${sistema}`"
                />
                <span
                    v-if="parte.probado_en"
                    class="text-xs text-muted"
                >Última prueba {{ formatearFechaHora(parte.probado_en) }}</span>
                <span class="text-xs text-muted">· {{ empresa?.nombre_comercial }}</span>
            </div>
            <UAlert
                v-if="parte.prueba_ok === false && parte.prueba_error"
                color="error"
                variant="subtle"
                icon="i-lucide-circle-alert"
                title="La última prueba falló"
                :description="parte.prueba_error"
                :data-prueba="`error-prueba-${sistema}`"
            />

            <UForm
                :id="idFormulario"
                ref="formulario"
                :schema="esquemaEquipos"
                :state="estado"
                :disabled="!editable || enviando"
                class="flex flex-col gap-4"
                @submit="guardar"
            >
                <USwitch
                    v-model="estado.activo"
                    label="Integración encendida en esta empresa"
                    description="SmartOLT y GenieACS se encienden juntos. Apagada, Iris no puede activar equipos desde la orden."
                    :data-prueba="`activo-${sistema}`"
                />

                <template v-if="sistema === 'smartolt'">
                    <UFormField
                        label="Dirección de SmartOLT"
                        name="smartolt_url"
                        help="La de tu cuenta, p. ej. https://miisp.smartolt.com."
                    >
                        <UInput
                            v-model="estado.smartolt_url"
                            placeholder="https://miisp.smartolt.com"
                            autocomplete="off"
                            class="w-full font-mono"
                            data-prueba="smartolt-url"
                        />
                    </UFormField>
                    <CampoSecreto
                        v-model="secretos.smartolt_token"
                        :guardado="config?.smartolt.token ?? null"
                        etiqueta="Token de la API"
                        nombre="smartolt_token"
                        placeholder="El token de SmartOLT"
                        :disabled="!editable"
                    />

                    <div class="flex flex-col gap-2">
                        <div class="flex items-center justify-between gap-2">
                            <span class="text-sm font-semibold text-highlighted">Perfiles de autorización</span>
                            <UButton
                                v-if="editable"
                                label="Agregar perfil"
                                icon="i-lucide-plus"
                                color="neutral"
                                variant="outline"
                                size="sm"
                                data-prueba="agregar-perfil"
                                @click="agregarPerfil"
                            />
                        </div>
                        <p class="text-xs text-muted">
                            Qué preset de SmartOLT usa cada OLT y plan al autorizar una ONU. «Probar conexión» trae la lista de OLT.
                        </p>
                        <p
                            v-if="!estado.perfiles.length"
                            class="text-sm text-muted"
                        >
                            Sin perfiles.
                        </p>
                        <div
                            v-for="(perfil, i) in estado.perfiles"
                            :key="i"
                            class="grid items-start gap-2 rounded-xl border border-(--ax-borde) p-2 sm:grid-cols-[1fr_1fr_7rem_6rem_auto]"
                            data-prueba="perfil"
                        >
                            <UFormField
                                :name="`perfiles.${i}.smartolt_olt_id`"
                                label="OLT"
                            >
                                <USelect
                                    v-if="olts.length"
                                    v-model="perfil.smartolt_olt_id"
                                    :items="olts.map(o => ({ label: o.name, value: o.id }))"
                                    class="w-full"
                                />
                                <UInput
                                    v-else
                                    v-model="perfil.smartolt_olt_id"
                                    :placeholder="perfil.smartolt_olt_id ? nombreOlt(perfil.smartolt_olt_id) : 'Id de la OLT'"
                                    class="w-full"
                                />
                            </UFormField>
                            <UFormField
                                :name="`perfiles.${i}.plan_id`"
                                label="Plan"
                            >
                                <USelect
                                    :model-value="perfil.plan_id ?? 0"
                                    :items="itemsPlanes"
                                    class="w-full"
                                    @update:model-value="v => perfil.plan_id = v ? Number(v) : null"
                                />
                            </UFormField>
                            <UFormField
                                :name="`perfiles.${i}.authorization_preset_id`"
                                label="Preset"
                            >
                                <UInputNumber
                                    v-model="perfil.authorization_preset_id"
                                    :min="1"
                                    :increment="false"
                                    :decrement="false"
                                    :format-options="{ useGrouping: false }"
                                    class="w-full"
                                />
                            </UFormField>
                            <UFormField
                                :name="`perfiles.${i}.pon_type`"
                                label="Tipo"
                            >
                                <USelect
                                    v-model="perfil.pon_type"
                                    :items="itemsPon"
                                    class="w-full"
                                />
                            </UFormField>
                            <UButton
                                v-if="editable"
                                icon="i-lucide-trash-2"
                                color="neutral"
                                variant="ghost"
                                class="sm:mt-6"
                                aria-label="Quitar este perfil"
                                @click="quitarPerfil(i)"
                            />
                        </div>
                    </div>
                </template>

                <template v-else>
                    <UFormField
                        label="Dirección del NBI de GenieACS"
                        name="genieacs_url"
                        help="En su propio servidor (o el proxy que lo protege), p. ej. https://acs.miisp.gt:7557."
                    >
                        <UInput
                            v-model="estado.genieacs_url"
                            placeholder="https://acs.miisp.gt:7557"
                            autocomplete="off"
                            class="w-full font-mono"
                            data-prueba="genieacs-url"
                        />
                    </UFormField>
                    <div class="grid gap-4 sm:grid-cols-2">
                        <UFormField
                            label="Usuario"
                            name="genieacs_usuario"
                        >
                            <UInput
                                v-model="estado.genieacs_usuario"
                                autocomplete="off"
                                class="w-full"
                                data-prueba="genieacs-usuario"
                            />
                        </UFormField>
                        <CampoSecreto
                            v-model="secretos.genieacs_clave"
                            :guardado="config?.genieacs.clave ?? null"
                            etiqueta="Clave"
                            nombre="genieacs_clave"
                            :disabled="!editable"
                        />
                    </div>
                    <CampoSecreto
                        v-model="secretos.genieacs_ca"
                        :guardado="config?.genieacs.ca ? '***' : null"
                        etiqueta="Certificado raíz propio del proxy (PEM, opcional)"
                        nombre="genieacs_ca"
                        placeholder="-----BEGIN CERTIFICATE-----"
                        :disabled="!editable"
                    />
                    <USwitch
                        v-model="estado.pppoe_por_acs"
                        label="Configurar el PPPoE en el equipo por TR-069"
                        description="Al aprovisionar, Argos escribe en el equipo el usuario y la clave PPPoE del servicio."
                    />
                </template>

                <ProblemaAlerta
                    v-if="problemaGuardar && problemaGuardar.status === 409"
                    :problema="problemaGuardar"
                    etiqueta-reintentar="Recargar"
                    :reintentar="cargar"
                    :reintentando="cargando"
                />
                <ProblemaAlerta
                    v-else-if="problemaGuardar && problemaGuardar.status !== 422"
                    :problema="problemaGuardar"
                />
            </UForm>

            <div class="flex flex-wrap items-center gap-2 border-t border-(--ax-borde) pt-3">
                <span class="me-auto text-xs text-muted">Las credenciales se guardan cifradas y nunca se vuelven a mostrar.</span>
                <UButton
                    v-if="puede('smartolt.probar_instancia')"
                    label="Probar conexión"
                    icon="i-lucide-plug-zap"
                    color="neutral"
                    variant="outline"
                    :loading="probando"
                    :disabled="!parte?.url || !sinCambios"
                    :title="!sinCambios ? 'Guarda primero: se prueba lo guardado.' : !parte?.url ? 'Escribe y guarda la dirección primero.' : undefined"
                    :data-prueba="`probar-${sistema}`"
                    @click="probar"
                />
                <UButton
                    v-if="editable"
                    type="submit"
                    :form="idFormulario"
                    label="Guardar"
                    icon="i-lucide-check"
                    :loading="enviando"
                    :disabled="sinCambios"
                    class="glow-brand"
                    :data-prueba="`guardar-${sistema}`"
                />
            </div>
        </template>
    </div>
</template>
