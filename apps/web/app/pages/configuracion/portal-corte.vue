<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { FormSubmitEvent, RadioGroupItem } from '@nuxt/ui'

/**
 * Configuración · Portal de corte (`GET`/`PUT /corte/configuracion`, A5): IPv4, IPv6 y puerto a los
 * que el NAT de los routers manda la navegación de los suspendidos, y cómo se suspende la sesión
 * (desconectar o CoA). Una sola para la instalación; la página por empresa es su `url_corte`.
 * `version` 0 = nunca se guardó (valores iniciales del servidor). Ver con `portal_corte.ver`,
 * guardar con `portal_corte.configurar`; 409 con «Recargar».
 */
definePageMeta({ permiso: 'portal_corte.ver' })

useHead({ title: 'Portal de corte · Configuración · ArgosIsp' })

const { puede } = usePermisos()
const toast = useToast()

const config = shallowRef<PortalCorte | null>(null)
const cargando = ref(false)
const problema = ref<Problem | null>(null)

const formulario = useTemplateRef('formulario')
const estado = reactive<EntradaPortalCorte>({ portal_v4: '', portal_v6: '', portal_puerto: 80, modo_suspension: 'desconectar' })
const enviando = ref(false)
const problemaGuardar = ref<Problem | null>(null)
/** Datos validados que esperan la confirmación de reescribir los routers. */
const pendiente = shallowRef<SalidaPortalCorte | null>(null)
const confirmar = ref(false)

const editable = computed(() => puede('portal_corte.configurar'))
const sinGuardar = computed(() => config.value?.origen === 'entorno')
const sinCambios = computed(() => config.value !== null && JSON.stringify(entradaPortalCorte(config.value)) === JSON.stringify({ ...estado }))
const ayudaIpv4 = computed(() => (estado.portal_v4.trim() === ''
    ? ayudaIpv4Vacia(config.value?.portal_url ?? null)
    : 'Los routers mandan a los suspendidos a esta IP.'))
const sinDestino = computed(() => estado.portal_v4.trim() === '' && ipv4Deducida(config.value?.portal_url ?? null) === null)

const itemsModo = computed<RadioGroupItem[]>(() => (Object.keys(MODOS_SUSPENSION) as ModoSuspension[]).map(modo => ({
    label: MODOS_SUSPENSION[modo].etiqueta,
    description: MODOS_SUSPENSION[modo].descripcion,
    value: modo,
})))

function rellenar(datos: PortalCorte) {
    config.value = datos
    Object.assign(estado, entradaPortalCorte(datos))
    formulario.value?.clear()
}

async function cargar() {
    cargando.value = true
    const resultado = await usePortalCorte().ver()
    cargando.value = false
    problema.value = resultado.ok ? null : resultado.problema
    if (resultado.ok) {
        problemaGuardar.value = null
        rellenar(resultado.data)
    }
}

function alEnviar(evento: FormSubmitEvent<SalidaPortalCorte>) {
    if (!config.value) {
        return
    }
    if (cambiaReglasRouters(config.value, evento.data)) {
        pendiente.value = evento.data
        confirmar.value = true
        return
    }
    void guardar(evento.data)
}

async function guardar(datos: SalidaPortalCorte) {
    if (!config.value) {
        return
    }
    const antes = config.value
    enviando.value = true
    problemaGuardar.value = null
    const resultado = await usePortalCorte().configurar({ ...datos, version: antes.version })
    enviando.value = false
    confirmar.value = false
    pendiente.value = null
    if (!resultado.ok) {
        problemaGuardar.value = resultado.problema
        if (resultado.problema.status === 422) {
            formulario.value?.setErrors(erroresDeFormulario(resultado.problema))
        }
        return
    }
    rellenar(resultado.data)
    toast.add({
        title: 'Portal de corte guardado',
        description: cambiaReglasRouters(antes, datos)
            ? 'Los routers se están actualizando con la nueva dirección.'
            : 'El cambio aplica desde la siguiente suspensión.',
        icon: 'i-lucide-circle-check',
        color: 'success',
    })
}

function reintentarGuardar() {
    void formulario.value?.submit()
}

onMounted(cargar)
</script>

<template>
    <PanelPagina
        id="configuracion-portal-corte"
        titulo="Portal de corte"
        icono="i-lucide-octagon-pause"
    >
        <div class="mx-auto flex w-full max-w-3xl flex-col gap-4">
            <ProblemaAlerta
                v-if="problema"
                :problema="problema"
                :reintentar="cargar"
                :reintentando="cargando"
            />
            <div
                v-else-if="!config"
                class="flex flex-col gap-3"
            >
                <USkeleton class="h-10" />
                <USkeleton class="h-56" />
            </div>
            <template v-else>
                <UAlert
                    v-if="sinGuardar"
                    color="info"
                    variant="subtle"
                    icon="i-lucide-server"
                    title="Valores iniciales del servidor, todavía no guardados"
                    :description="editable ? 'Así funciona hoy. Revísalos y guarda para fijarlos aquí; desde entonces solo se cambian en esta pantalla.' : 'Así funciona hoy. Un administrador puede revisarlos y guardarlos aquí.'"
                    data-prueba="portal-corte-sin-guardar"
                />
                <p
                    v-else-if="config.updated_at"
                    class="text-xs text-muted"
                    data-prueba="portal-corte-guardado"
                >
                    Guardado el {{ formatearFechaHora(config.updated_at) }}.
                </p>
                <UAlert
                    v-if="!editable"
                    color="neutral"
                    variant="subtle"
                    icon="i-lucide-lock"
                    title="Solo lectura"
                    description="Solo un administrador puede cambiar esta configuración."
                />

                <UForm
                    ref="formulario"
                    :schema="esquemaPortalCorte"
                    :state="estado"
                    :disabled="!editable || enviando"
                    class="flex flex-col gap-4"
                    @submit="alEnviar"
                >
                    <UPageCard
                        title="A dónde van los suspendidos"
                        description="Cuando un servicio está suspendido, los routers mandan su navegación web a esta dirección, donde está la página de corte."
                        variant="subtle"
                        :ui="{ container: 'gap-4 sm:p-5' }"
                    >
                        <div class="grid gap-4 sm:grid-cols-2">
                            <UFormField
                                label="IPv4 del portal"
                                name="portal_v4"
                                :help="ayudaIpv4"
                                class="sm:col-span-2"
                                :ui="{ help: sinDestino ? 'text-error' : undefined }"
                            >
                                <UInput
                                    v-model="estado.portal_v4"
                                    placeholder="Vacía = automática"
                                    inputmode="decimal"
                                    autocomplete="off"
                                    class="w-full font-mono"
                                    data-prueba="portal-corte-v4"
                                />
                            </UFormField>
                            <UFormField
                                label="IPv6 del portal (opcional)"
                                name="portal_v6"
                                help="Vacía: la navegación por IPv6 de un suspendido se corta y su equipo pasa a IPv4."
                            >
                                <UInput
                                    v-model="estado.portal_v6"
                                    placeholder="2803:d100::20"
                                    autocomplete="off"
                                    class="w-full font-mono"
                                    data-prueba="portal-corte-v6"
                                />
                            </UFormField>
                            <UFormField
                                label="Puerto"
                                name="portal_puerto"
                                required
                                help="80 normalmente; 8088 si el servidor de Argos usa el puerto dedicado a la página de corte."
                            >
                                <UInputNumber
                                    v-model="estado.portal_puerto"
                                    :min="1"
                                    :max="65535"
                                    :step="1"
                                    :format-options="{ useGrouping: false }"
                                    class="w-full"
                                    data-prueba="portal-corte-puerto"
                                />
                            </UFormField>
                        </div>
                        <UAlert
                            color="warning"
                            variant="subtle"
                            icon="i-lucide-triangle-alert"
                            title="Cambiar la IP o el puerto reescribe las reglas de corte en todos los routers"
                            description="Argos actualiza cada router con conexión al guardar. Un dato equivocado deja a los suspendidos sin ver la página de corte; compruébalo con «Probar conexión» en la ficha de un router."
                            data-prueba="portal-corte-aviso-routers"
                        />
                    </UPageCard>

                    <UPageCard
                        title="Al suspender un servicio"
                        description="Qué pasa con la conexión del cliente en el momento en que se suspende."
                        variant="subtle"
                        :ui="{ container: 'gap-4 sm:p-5' }"
                    >
                        <UFormField name="modo_suspension">
                            <URadioGroup
                                v-model="estado.modo_suspension"
                                :items="itemsModo"
                                variant="card"
                                class="w-full"
                                :ui="{ fieldset: 'grid gap-2' }"
                                data-prueba="portal-corte-modo"
                            />
                        </UFormField>
                        <p class="text-xs text-muted">
                            Aplica desde la siguiente suspensión; los servicios ya suspendidos siguen como están.
                        </p>
                    </UPageCard>

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
                        :reintentar="reintentarGuardar"
                        :reintentando="enviando"
                    />
                    <ProblemaAlerta
                        v-else-if="problemaGuardar"
                        :problema="problemaGuardar"
                    />

                    <div
                        v-if="editable"
                        class="flex flex-wrap justify-end gap-2"
                    >
                        <UButton
                            label="Descartar cambios"
                            color="neutral"
                            variant="ghost"
                            :disabled="sinCambios || enviando"
                            @click="config && rellenar(config)"
                        />
                        <UButton
                            type="submit"
                            :label="sinGuardar && sinCambios ? 'Guardar estos valores' : 'Guardar'"
                            icon="i-lucide-check"
                            :loading="enviando"
                            :disabled="!sinGuardar && sinCambios"
                            data-prueba="portal-corte-guardar"
                        />
                    </div>
                </UForm>

                <UPageCard
                    title="Página de corte de cada empresa"
                    description="Lo que ve el cliente suspendido lo decide cada empresa: la página de corte de Argos o una propia (URL de corte)."
                    variant="outline"
                    icon="i-lucide-building-2"
                    :ui="{ container: 'gap-3 sm:p-5' }"
                >
                    <UButton
                        v-if="puede('empresas.ver')"
                        label="Ver la URL de corte de cada empresa"
                        to="/configuracion/empresas"
                        icon="i-lucide-arrow-right"
                        trailing
                        color="neutral"
                        variant="outline"
                        class="self-start"
                        data-prueba="portal-corte-empresas"
                    />
                </UPageCard>
            </template>
        </div>

        <UModal
            v-model:open="confirmar"
            title="¿Actualizar las reglas de corte en todos los routers?"
            description="Cambiaste la IP o el puerto del portal."
        >
            <template #body>
                <div
                    class="flex flex-col gap-2 text-sm"
                    data-prueba="portal-corte-confirmar"
                >
                    <p>Al guardar, Argos reescribe la redirección de los suspendidos en cada router con conexión.</p>
                    <p
                        v-if="pendiente"
                        class="text-muted"
                    >
                        Nuevo destino: <span class="font-mono text-highlighted">{{ pendiente.portal_v4 ?? 'la IP de la dirección pública del portal' }}:{{ pendiente.portal_puerto }}</span><template v-if="pendiente.portal_v6">
                            · IPv6 <span class="font-mono text-highlighted">[{{ pendiente.portal_v6 }}]:{{ pendiente.portal_puerto }}</span>
                        </template>
                    </p>
                </div>
            </template>
            <template #footer>
                <div class="flex w-full flex-wrap justify-end gap-2">
                    <UButton
                        label="Cancelar"
                        color="neutral"
                        variant="ghost"
                        :disabled="enviando"
                        @click="confirmar = false"
                    />
                    <UButton
                        label="Guardar y actualizar routers"
                        icon="i-lucide-refresh-cw"
                        :loading="enviando"
                        data-prueba="portal-corte-confirmar-guardar"
                        @click="pendiente && guardar(pendiente)"
                    />
                </div>
            </template>
        </UModal>
    </PanelPagina>
</template>
