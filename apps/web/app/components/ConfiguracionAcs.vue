<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { FormSubmitEvent } from '@nuxt/ui'

/**
 * Configuración › Integraciones › ACS (GenieACS) (tableros PendAcs y PendAcsMovil): el ACS de la
 * empresa activa, independiente de SmartOLT. Vista con conexión, última prueba y qué hace el ACS
 * (interruptor de PPPoE por ACS), «Encendido» y «Probar conexión»; sin configurar, apagado y falla
 * con su aviso. «Editar» abre el formulario en su propia ruta (`?ver=acs&accion=editar`). La clave
 * y el certificado nunca vuelven (`CampoSecreto`).
 */
const emit = defineEmits<{ cambio: [acs: ConfigAcs] }>()

const route = useRoute()
const toast = useToast()
const { puede } = usePermisos()
const { eleccion, empresaId, empresa } = useEmpresaActiva()
const enTodas = computed(() => eleccion.value === 'todas' || empresaId.value === null)

const acs = shallowRef<ConfigAcs | null>(null)
const problema = ref<Problem | null>(null)
const cargando = ref(false)
const probando = ref(false)
const guardando = ref(false)
const editando = computed(() => route.query.accion === 'editar' && puede('acs.configurar'))
const presentacion = computed(() => (acs.value ? estadoAcs(acs.value) : null))
const sinConfigurar = computed(() => acs.value !== null && (acs.value.version === 0 || !acs.value.url))

const AVISO = 'Sin ACS no se configuran Wi-Fi ni PPPoE de la ONU.'

function rellenar(datos: ConfigAcs) {
    acs.value = datos
    emit('cambio', datos)
    Object.assign(estado, { url: datos.url ?? '', usuario: datos.usuario ?? '', pppoe_por_acs: datos.pppoe_por_acs })
    Object.assign(secretos, { clave: nuevoSecreto(), ca: nuevoSecreto() })
}

async function cargar() {
    problema.value = null
    if (enTodas.value) {
        acs.value = null
        return
    }
    cargando.value = true
    const r = await useAcs().ver()
    cargando.value = false
    problema.value = r.ok ? null : r.problema
    if (r.ok) {
        rellenar(r.data)
    }
}

/** Un cambio corto (encender, PPPoE por ACS) sin pasar por el formulario. */
async function cambiar(cambios: CambiosAcs, mensaje: string) {
    if (!acs.value) {
        return
    }
    guardando.value = true
    const r = await useAcs().guardar(acs.value.version, cambios)
    guardando.value = false
    if (!r.ok) {
        toast.add({ title: r.problema.title, description: r.problema.detail, icon: 'i-lucide-circle-alert', color: 'error' })
        void cargar()
        return
    }
    rellenar(r.data)
    toast.add({ title: mensaje, icon: 'i-lucide-circle-check', color: 'success' })
}

async function probar() {
    probando.value = true
    const r = await useAcs().probar()
    probando.value = false
    if (!r.ok) {
        toast.add({ title: r.problema.title, description: r.problema.detail, icon: 'i-lucide-circle-alert', color: 'error' })
        return
    }
    rellenar(r.data.config)
    toast.add(r.data.ok
        ? { title: 'El ACS respondió', description: r.data.latencia_ms !== null ? `Respondió en ${r.data.latencia_ms} ms.` : undefined, icon: 'i-lucide-plug-zap', color: 'success' }
        : { title: 'El ACS no respondió', description: r.data.error ?? undefined, icon: 'i-lucide-circle-alert', color: 'error' })
}

/* Formulario (página: `?accion=editar`). */
const formulario = useTemplateRef('formulario')
const idFormulario = useId()
const estado = reactive<EntradaAcs>({ url: '', usuario: '', pppoe_por_acs: false })
const nuevoSecreto = (): Secreto => ({ accion: 'conservar', valor: '' })
const secretos = reactive({ clave: nuevoSecreto(), ca: nuevoSecreto() })
const problemaGuardar = ref<Problem | null>(null)

function abrirEditar() {
    void navigateTo({ query: { ...route.query, ver: 'acs', accion: 'editar' } })
}

function cerrarEditar() {
    problemaGuardar.value = null
    if (acs.value) {
        rellenar(acs.value)
    }
    void navigateTo({ query: { ...route.query, accion: undefined } })
}

async function guardar(evento: FormSubmitEvent<SalidaAcs>) {
    if (!acs.value) {
        return
    }
    guardando.value = true
    problemaGuardar.value = null
    const cambios: CambiosAcs = { url: evento.data.url, usuario: evento.data.usuario || null, pppoe_por_acs: evento.data.pppoe_por_acs }
    const clave = secretoEnCuerpo(secretos.clave)
    const ca = secretoEnCuerpo(secretos.ca)
    if (clave !== undefined) {
        cambios.clave = clave
    }
    if (ca !== undefined) {
        cambios.ca = ca
    }
    if (acs.value.version === 0) {
        cambios.activo = true
    }
    const r = await useAcs().guardar(acs.value.version, cambios)
    guardando.value = false
    if (!r.ok) {
        problemaGuardar.value = r.problema
        if (r.problema.status === 422) {
            formulario.value?.setErrors(erroresDeFormulario(r.problema))
        }
        return
    }
    rellenar(r.data)
    toast.add({ title: 'ACS guardado', description: 'Prueba la conexión para que Argos lo use.', icon: 'i-lucide-circle-check', color: 'success' })
    void navigateTo({ query: { ...route.query, accion: undefined } })
}

watch(empresaId, cargar)
onMounted(cargar)
</script>

<template>
    <section
        class="flex min-w-0 flex-col gap-4"
        data-prueba="acs"
    >
        <UAlert
            v-if="enTodas"
            color="info"
            variant="subtle"
            icon="i-lucide-building"
            title="Elige una empresa"
            description="Cada empresa tiene su propio ACS: elige una en el selector de empresa de arriba."
            data-prueba="acs-elige-empresa"
        />
        <ProblemaAlerta
            v-else-if="problema"
            :problema="problema"
            :reintentar="cargar"
            :reintentando="cargando"
        />
        <USkeleton
            v-else-if="!acs || !presentacion"
            class="h-48 w-full"
        />

        <!-- Formulario en su ruta (más de 3 campos). -->
        <div
            v-else-if="editando"
            class="flex min-w-0 flex-col"
            data-prueba="acs-formulario"
        >
            <div class="flex items-center gap-3 border-b border-(--ax-borde) pb-3">
                <UButton
                    icon="i-lucide-chevron-left"
                    color="neutral"
                    variant="outline"
                    class="rounded-full"
                    aria-label="Atrás"
                    @click="cerrarEditar"
                />
                <div>
                    <h2 class="text-lg font-bold text-highlighted">
                        {{ acs!.version === 0 ? 'Configurar ACS (GenieACS)' : 'Editar ACS (GenieACS)' }}
                    </h2>
                    <p class="text-sm text-muted">
                        {{ empresa?.nombre_comercial }} · un ACS por empresa
                    </p>
                </div>
            </div>
            <UForm
                :id="idFormulario"
                ref="formulario"
                :schema="esquemaAcs"
                :state="estado"
                :disabled="guardando"
                class="flex flex-col"
                @submit="guardar"
            >
                <div class="grid gap-4 border-b border-(--ax-borde) py-4 sm:grid-cols-[13rem_minmax(0,1fr)]">
                    <div>
                        <p class="text-sm font-semibold text-highlighted">
                            1 · Conexión
                        </p>
                        <p class="text-xs text-muted">
                            Dónde está tu GenieACS y con qué usuario entra Argos.
                        </p>
                    </div>
                    <div class="flex min-w-0 flex-col gap-3">
                        <UFormField
                            label="Dirección (URL)"
                            name="url"
                            required
                            help="Debe empezar con https://"
                        >
                            <UInput
                                v-model="estado.url"
                                icon="i-lucide-link"
                                placeholder="https://acs!.miisp.gt:7557"
                                autocomplete="off"
                                class="w-full font-mono"
                                data-prueba="acs-url"
                            />
                        </UFormField>
                        <div class="grid gap-3 sm:grid-cols-2">
                            <UFormField
                                label="Usuario"
                                name="usuario"
                            >
                                <UInput
                                    v-model="estado.usuario"
                                    autocomplete="off"
                                    class="w-full"
                                    data-prueba="acs-usuario"
                                />
                            </UFormField>
                            <CampoSecreto
                                v-model="secretos.clave"
                                :guardado="acs!.clave"
                                etiqueta="Clave"
                                nombre="clave"
                            />
                        </div>
                    </div>
                </div>
                <div class="grid gap-4 border-b border-(--ax-borde) py-4 sm:grid-cols-[13rem_minmax(0,1fr)]">
                    <div>
                        <p class="text-sm font-semibold text-highlighted">
                            2 · Certificado
                        </p>
                        <p class="text-xs text-muted">
                            Solo si tu servidor usa un certificado propio.
                        </p>
                    </div>
                    <CampoSecreto
                        v-model="secretos.ca"
                        :guardado="acs!.ca ? '***' : null"
                        etiqueta="Certificado propio (CA, PEM)"
                        nombre="ca"
                        placeholder="-----BEGIN CERTIFICATE-----"
                    />
                </div>
                <div class="grid gap-4 py-4 sm:grid-cols-[13rem_minmax(0,1fr)]">
                    <div>
                        <p class="text-sm font-semibold text-highlighted">
                            3 · PPPoE por ACS
                        </p>
                        <p class="text-xs text-muted">
                            Si lo enciendes, al aprovisionar una ONU el usuario y la clave PPPoE los pone el ACS.
                        </p>
                    </div>
                    <USwitch
                        v-model="estado.pppoe_por_acs"
                        label="Poner el PPPoE por ACS"
                        description="Apagado: Argos no toca el PPPoE de la ONU"
                        data-prueba="acs-pppoe"
                    />
                </div>
                <ProblemaAlerta
                    v-if="problemaGuardar && problemaGuardar.status !== 422"
                    :problema="problemaGuardar"
                    :etiqueta-reintentar="problemaGuardar.status === 409 ? 'Recargar' : undefined"
                    :reintentar="problemaGuardar.status === 409 ? cargar : undefined"
                />
            </UForm>
            <div class="flex flex-wrap items-center gap-2 border-t border-(--ax-borde) pt-3">
                <span class="me-auto text-xs text-muted">La clave se guarda cifrada y siempre se ve como «***».</span>
                <UButton
                    label="Cancelar"
                    color="neutral"
                    variant="ghost"
                    @click="cerrarEditar"
                />
                <UButton
                    type="submit"
                    :form="idFormulario"
                    label="Guardar"
                    icon="i-lucide-check"
                    :loading="guardando"
                    class="glow-brand"
                    data-prueba="acs-guardar"
                />
            </div>
        </div>

        <template v-else>
            <div class="flex flex-wrap items-start gap-3">
                <span class="pastilla-icono pastilla-tono tono-marca">
                    <UIcon
                        name="i-lucide-cpu"
                        class="size-5"
                    />
                </span>
                <div class="min-w-0 flex-1">
                    <h2 class="text-base font-bold text-highlighted">
                        ACS (GenieACS)
                    </h2>
                    <div class="my-1 flex flex-wrap items-center gap-1.5">
                        <UBadge
                            :label="presentacion!.etiqueta"
                            :icon="presentacion!.icono"
                            :color="presentacion!.color"
                            variant="subtle"
                            size="sm"
                            data-prueba="estado-acs"
                        />
                        <UBadge
                            :label="empresa?.nombre_comercial ?? ''"
                            icon="i-lucide-building"
                            color="neutral"
                            variant="subtle"
                            size="sm"
                        />
                    </div>
                    <p class="text-sm text-muted">
                        Un solo ACS por empresa · cambia el Wi-Fi y el PPPoE de la ONU
                    </p>
                </div>
                <template v-if="!sinConfigurar">
                    <USwitch
                        v-if="puede('acs.configurar')"
                        :model-value="acs!.activo"
                        label="Encendido"
                        :disabled="guardando"
                        data-prueba="acs-encendido"
                        @update:model-value="v => cambiar({ activo: v }, v ? 'ACS encendido' : 'ACS apagado')"
                    />
                    <UButton
                        v-if="puede('acs.probar')"
                        label="Probar conexión"
                        icon="i-lucide-refresh-cw"
                        :loading="probando"
                        class="glow-brand"
                        data-prueba="acs-probar"
                        @click="probar"
                    />
                </template>
            </div>

            <UAlert
                v-if="!sinConfigurar && acs!.activo && acs!.prueba_ok === false"
                color="error"
                variant="subtle"
                icon="i-lucide-triangle-alert"
                title="El ACS no respondió."
                description="Mientras no funcione no se cambia el Wi-Fi ni se pone el PPPoE por ACS; esos pedidos esperan y se reintentan solos. Revisa la dirección y que el servidor esté encendido."
                data-prueba="acs-aviso-falla"
            />
            <UAlert
                v-else-if="!sinConfigurar && !acs!.activo"
                color="warning"
                variant="subtle"
                icon="i-lucide-power"
                data-prueba="acs-aviso-apagado"
            >
                <template #description>
                    <b>El ACS está apagado.</b> <b>{{ AVISO }}</b> SmartOLT sigue autorizando las ONU y mostrando su estado, pero la red Wi-Fi y el usuario PPPoE se quedan como los dejó la plantilla de la OLT.
                </template>
            </UAlert>

            <div
                v-if="sinConfigurar"
                class="flex flex-col items-center gap-3 px-4 py-8 text-center"
                data-prueba="acs-sin-configurar"
            >
                <UAlert
                    color="warning"
                    variant="subtle"
                    icon="i-lucide-triangle-alert"
                    class="text-start"
                >
                    <template #description>
                        <b>{{ AVISO }}</b> SmartOLT sigue autorizando las ONU y mostrando su estado, pero la red Wi-Fi y el usuario PPPoE se quedan como los dejó la plantilla de la OLT.
                    </template>
                </UAlert>
                <span class="pastilla-icono pastilla-tono tono-marca size-16 rounded-2xl">
                    <UIcon
                        name="i-lucide-cpu"
                        class="size-8"
                    />
                </span>
                <p class="text-lg font-bold text-highlighted">
                    Esta empresa todavía no tiene ACS
                </p>
                <p class="max-w-md text-sm text-muted">
                    El ACS (GenieACS) es el servidor que cambia el Wi-Fi y el PPPoE de la ONU. Cada empresa tiene uno. Puedes usar SmartOLT sin él.
                </p>
                <UButton
                    v-if="puede('acs.configurar')"
                    label="Configurar ACS"
                    icon="i-lucide-cpu"
                    class="glow-brand"
                    data-prueba="acs-configurar"
                    @click="abrirEditar"
                />
            </div>

            <div
                v-else
                class="grid gap-3 lg:grid-cols-2"
            >
                <div class="flex flex-col gap-3">
                    <ConfiguracionBloque
                        titulo="Conexión"
                        icono="i-lucide-link"
                    >
                        <template #accion>
                            <UButton
                                v-if="puede('acs.configurar')"
                                label="Editar"
                                variant="link"
                                size="sm"
                                data-prueba="acs-editar"
                                @click="abrirEditar"
                            />
                        </template>
                        <ConfiguracionFila
                            etiqueta="Dirección (URL)"
                            :valor="acs!.url"
                            mono
                        />
                        <ConfiguracionFila
                            etiqueta="Usuario"
                            :valor="acs!.usuario ?? '—'"
                        />
                        <ConfiguracionFila etiqueta="Clave">
                            <span class="font-mono">{{ acs!.clave ?? 'Sin clave' }}</span>
                        </ConfiguracionFila>
                        <ConfiguracionFila etiqueta="Certificado propio (CA)">
                            <UBadge
                                :label="acs!.ca ? 'Guardado' : 'Ninguno'"
                                icon="i-lucide-shield"
                                color="neutral"
                                variant="subtle"
                                size="sm"
                            />
                        </ConfiguracionFila>
                    </ConfiguracionBloque>
                    <ConfiguracionBloque
                        titulo="Última prueba"
                        icono="i-lucide-clock"
                    >
                        <ConfiguracionFila etiqueta="Resultado">
                            <UBadge
                                :label="acs!.prueba_ok === true ? 'Probado' : acs!.prueba_ok === false ? 'Falla' : 'Sin probar'"
                                :icon="acs!.prueba_ok === true ? 'i-lucide-check' : acs!.prueba_ok === false ? 'i-lucide-triangle-alert' : 'i-lucide-clock'"
                                :color="acs!.prueba_ok === true ? 'success' : acs!.prueba_ok === false ? 'error' : 'neutral'"
                                variant="subtle"
                                size="sm"
                                data-prueba="acs-resultado"
                            />
                        </ConfiguracionFila>
                        <ConfiguracionFila
                            v-if="acs!.prueba_ok === false"
                            etiqueta="Qué pasó"
                        >
                            <span class="text-sm text-error">{{ acs!.prueba_error }}</span>
                        </ConfiguracionFila>
                        <ConfiguracionFila
                            v-else-if="acs!.prueba_latencia_ms !== null"
                            etiqueta="Respondió en"
                            :valor="`${acs!.prueba_latencia_ms} ms`"
                        />
                        <ConfiguracionFila
                            etiqueta="Cuándo"
                            :valor="cuandoPrueba(acs!.probado_en, acs!.probado_por)"
                        />
                    </ConfiguracionBloque>
                </div>
                <ConfiguracionBloque
                    titulo="Qué hace el ACS"
                    icono="i-lucide-wifi"
                >
                    <ConfiguracionFila
                        etiqueta="Cambiar el Wi-Fi de la ONU"
                        ayuda="Nombre y clave de la red, desde la ficha del servicio o Iris"
                        fuerte
                    >
                        <UBadge
                            :label="acs!.operativo ? 'Disponible' : 'No disponible'"
                            :icon="acs!.operativo ? 'i-lucide-check' : 'i-lucide-x'"
                            :color="acs!.operativo ? 'success' : 'neutral'"
                            variant="subtle"
                            size="sm"
                        />
                    </ConfiguracionFila>
                    <ConfiguracionFila
                        etiqueta="Ver el equipo"
                        ayuda="Firmware, nombre de red y último contacto"
                        fuerte
                    >
                        <UBadge
                            :label="acs!.operativo ? 'Disponible' : 'No disponible'"
                            :icon="acs!.operativo ? 'i-lucide-check' : 'i-lucide-x'"
                            :color="acs!.operativo ? 'success' : 'neutral'"
                            variant="subtle"
                            size="sm"
                        />
                    </ConfiguracionFila>
                    <ConfiguracionFila
                        etiqueta="PPPoE por ACS"
                        ayuda="Poner el usuario y la clave PPPoE de la ONU por el ACS al aprovisionar. Apagado: no se tocan."
                        fuerte
                    >
                        <USwitch
                            :model-value="acs!.pppoe_por_acs"
                            :disabled="!puede('acs.configurar') || guardando"
                            aria-label="PPPoE por ACS"
                            data-prueba="acs-pppoe-vista"
                            @update:model-value="v => cambiar({ pppoe_por_acs: v }, v ? 'PPPoE por ACS encendido' : 'PPPoE por ACS apagado')"
                        />
                    </ConfiguracionFila>
                    <UAlert
                        color="info"
                        variant="subtle"
                        icon="i-lucide-info"
                        class="mt-2"
                    >
                        <template #description>
                            El Wi-Fi y el PPPoE de la ONU se configuran <b>solo con ACS</b>. SmartOLT no los configura.
                        </template>
                    </UAlert>
                </ConfiguracionBloque>
            </div>
        </template>
    </section>
</template>
