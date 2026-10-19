<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'

/**
 * Configuración · Notificaciones (A6, `contratos/multiempresa.md`): correo (SMTP) y Telegram desde
 * el panel, la global y la de cada empresa (hereda la global o tiene la suya). Interruptores por
 * canal y por tipo de aviso. Los secretos nunca vuelven (`***`): se reemplazan o se borran. "Enviar
 * prueba" muestra el error real del servidor SMTP o de la Bot API.
 */
definePageMeta({ permiso: 'notificaciones.ver' })

useHead({ title: 'Notificaciones · ArgosIsp' })

const { puede } = usePermisos()
const { empresas: empresasMe } = useEmpresaActiva()
const toast = useToast()
const route = useRoute()
const router = useRouter()

const GLOBAL = 'global'
const puedeConfigurar = computed(() => puede('notificaciones.configurar'))
const puedeProbar = computed(() => puede('notificaciones.probar'))

/** Empresas para elegir: las de `GET /empresas` (con `empresas.ver`) o las del usuario. */
const empresas = shallowRef<{ id: number, nombre_comercial: string }[]>([])
const ambito = computed<string>({
    get: () => (typeof route.query.empresa === 'string' && /^\d+$/.test(route.query.empresa) ? route.query.empresa : GLOBAL),
    set: valor => void router.replace({ query: { ...route.query, empresa: valor === GLOBAL ? undefined : valor } }),
})
const empresaId = computed<number | null>(() => (ambito.value === GLOBAL ? null : Number(ambito.value)))
const itemsAmbito = computed(() => [
    { label: 'Global (todas las empresas)', value: GLOBAL, icon: 'i-lucide-globe' },
    ...empresas.value.map(e => ({ label: e.nombre_comercial, value: String(e.id), icon: 'i-lucide-building-2' })),
])

const config = shallowRef<ConfiguracionNotificaciones | null>(null)
const form = ref<FormularioNotificaciones | null>(null)
const cargando = ref(false)
const problema = ref<Problem | null>(null)
const guardando = ref(false)
const problemaGuardar = ref<Problem | null>(null)
const conflicto = ref(false)

const origen = computed(() => (config.value ? etiquetaOrigen(config.value) : null))
/** Con "hereda" el formulario propio de la empresa se deshabilita (rige la global). */
const bloqueado = computed(() => !puedeConfigurar.value || (empresaId.value !== null && form.value?.hereda === true))

async function cargarEmpresas() {
    if (puede('empresas.ver')) {
        const resultado = await useEmpresas().listar(true)
        empresas.value = resultado.ok ? resultado.data : empresasMe.value
        return
    }
    empresas.value = empresasMe.value
}

async function cargar() {
    cargando.value = true
    problema.value = null
    conflicto.value = false
    problemaGuardar.value = null
    const resultado = await useNotificaciones().ver(empresaId.value)
    cargando.value = false
    config.value = resultado.ok ? resultado.data : null
    form.value = resultado.ok ? formularioNotificaciones(resultado.data) : null
    problema.value = resultado.ok ? null : resultado.problema
}

onMounted(() => {
    void cargarEmpresas()
    void cargar()
})
watch(empresaId, cargar)

async function guardar() {
    if (!form.value || !config.value || errorListaCorreos(form.value.correo.contabilidad)) {
        return
    }
    guardando.value = true
    problemaGuardar.value = null
    conflicto.value = false
    const resultado = await useNotificaciones().guardar(empresaId.value, cuerpoNotificaciones(form.value, config.value.version, empresaId.value !== null))
    guardando.value = false
    if (resultado.ok) {
        config.value = resultado.data
        form.value = formularioNotificaciones(resultado.data)
        toast.add({ title: 'Configuración guardada', description: 'El envío usa los cambios desde ya.', color: 'success', icon: 'i-lucide-circle-check' })
        return
    }
    if (resultado.problema.status === 409) {
        conflicto.value = true
        return
    }
    problemaGuardar.value = resultado.problema
}

/** Prueba de un canal: el resultado (enviado o el error real) queda junto al botón. */
const destinoCorreo = ref('')
const destinoTelegram = ref('')
const probando = ref<'correo' | 'telegram' | null>(null)
const resultados = ref<Partial<Record<'correo' | 'telegram', { ok: true, prueba: ResultadoPruebaCanal } | { ok: false, problema: Problem }>>>({})

async function probar(canal: 'correo' | 'telegram') {
    probando.value = canal
    const destino = (canal === 'correo' ? destinoCorreo.value : destinoTelegram.value).trim()
    const resultado = await useNotificaciones().probar(empresaId.value, { canal, destino: destino || null })
    probando.value = null
    resultados.value = { ...resultados.value, [canal]: resultado.ok ? { ok: true, prueba: resultado.data } : { ok: false, problema: resultado.problema } }
}

watch(empresaId, () => {
    resultados.value = {}
})

const itemsTls = Object.entries(TLS_CORREO).map(([value, label]) => ({ label, value }))
</script>

<template>
    <PanelPagina
        id="notificaciones"
        titulo="Notificaciones"
        icono="i-lucide-bell-ring"
    >
        <template #acciones>
            <UButton
                v-if="puedeConfigurar && form"
                label="Guardar"
                icon="i-lucide-check"
                :loading="guardando"
                class="glow-brand"
                data-prueba="guardar-notificaciones"
                @click="guardar"
            />
        </template>

        <div class="mx-auto flex w-full max-w-4xl flex-col gap-4">
            <div class="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                <UFormField
                    label="Configuración de"
                    class="w-full sm:max-w-sm"
                >
                    <USelect
                        v-model="ambito"
                        :items="itemsAmbito"
                        class="w-full"
                        data-prueba="ambito-notificaciones"
                    />
                </UFormField>
                <UBadge
                    v-if="origen"
                    :label="origen.etiqueta"
                    :icon="origen.icono"
                    :color="origen.color"
                    variant="subtle"
                    class="self-start sm:self-auto"
                    data-prueba="origen-notificaciones"
                />
            </div>

            <ProblemaAlerta
                v-if="problema"
                :problema="problema"
                :reintentar="cargar"
                :reintentando="cargando"
            />
            <div
                v-else-if="!form || !config"
                class="flex flex-col gap-4"
            >
                <USkeleton class="h-40 w-full" />
                <USkeleton class="h-40 w-full" />
            </div>

            <template v-else>
                <UAlert
                    v-if="conflicto"
                    color="warning"
                    variant="subtle"
                    icon="i-lucide-git-compare"
                    title="Alguien más cambió esta configuración"
                    description="Tus cambios no se guardaron. Recarga y vuelve a aplicarlos."
                    :actions="[{ label: 'Recargar', color: 'warning', variant: 'outline', onClick: cargar }]"
                />
                <ProblemaAlerta
                    v-if="problemaGuardar"
                    :problema="problemaGuardar"
                />
                <UAlert
                    v-if="config.origen === 'entorno'"
                    color="info"
                    variant="subtle"
                    icon="i-lucide-server"
                    title="Rigen las variables de entorno"
                    description="Nunca se guardó desde el panel: estos son los valores del servidor. Al guardar, el panel pasa a mandar."
                />

                <section
                    v-if="empresaId !== null"
                    class="surface-card flex flex-col gap-2 p-4"
                    aria-label="Herencia"
                >
                    <USwitch
                        v-model="form.hereda"
                        :disabled="!puedeConfigurar"
                        label="Usar la configuración global"
                        description="Apágalo para que esta empresa tenga su propio servidor de correo, su bot y sus avisos."
                        data-prueba="hereda"
                    />
                </section>

                <section
                    class="surface-card flex flex-col gap-4 p-4 sm:p-6"
                    aria-labelledby="titulo-correo"
                >
                    <div class="flex flex-wrap items-center justify-between gap-2">
                        <h2
                            id="titulo-correo"
                            class="flex items-center gap-2 text-base font-semibold text-highlighted"
                        >
                            <UIcon
                                name="i-lucide-mail"
                                class="size-5"
                            />
                            Correo (SMTP)
                        </h2>
                        <USwitch
                            v-model="form.correo.activo"
                            :disabled="bloqueado"
                            label="Enviar correos"
                        />
                    </div>
                    <div class="grid gap-4 sm:grid-cols-6 [&>*]:min-w-0">
                        <UFormField
                            name="correo.host"
                            label="Servidor"
                            class="sm:col-span-4"
                        >
                            <UInput
                                v-model="form.correo.host"
                                :disabled="bloqueado"
                                placeholder="smtp.dominio.gt"
                                class="w-full font-mono"
                            />
                        </UFormField>
                        <UFormField
                            name="correo.puerto"
                            label="Puerto"
                            class="sm:col-span-2"
                        >
                            <UInput
                                v-model="form.correo.puerto"
                                :disabled="bloqueado"
                                inputmode="numeric"
                                placeholder="587"
                                class="w-full font-mono"
                            />
                        </UFormField>
                        <UFormField
                            name="correo.tls"
                            label="Cifrado"
                            class="sm:col-span-3"
                        >
                            <USelect
                                v-model="form.correo.tls"
                                :items="itemsTls"
                                :disabled="bloqueado"
                                class="w-full"
                            />
                        </UFormField>
                        <UFormField
                            name="correo.usuario"
                            label="Usuario"
                            class="sm:col-span-3"
                        >
                            <UInput
                                v-model="form.correo.usuario"
                                :disabled="bloqueado"
                                autocomplete="off"
                                class="w-full font-mono"
                            />
                        </UFormField>
                        <CampoSecreto
                            v-model="form.secretos.password"
                            :guardado="config.correo.password"
                            etiqueta="Contraseña"
                            nombre="correo.password"
                            :disabled="bloqueado"
                            class="sm:col-span-6"
                        />
                        <UFormField
                            name="correo.remitente"
                            label="Remitente"
                            class="sm:col-span-3"
                        >
                            <UInput
                                v-model="form.correo.remitente"
                                :disabled="bloqueado"
                                type="email"
                                placeholder="no-responder@dominio.gt"
                                class="w-full"
                            />
                        </UFormField>
                        <UFormField
                            name="correo.contabilidad"
                            label="Correo de contabilidad"
                            description="Avisos fiscales: integridad del libro, DTE rechazado, contingencia FEL y notas anuladas. Varios, separados por coma."
                            :error="errorListaCorreos(form.correo.contabilidad)"
                            class="sm:col-span-6"
                        >
                            <UInput
                                v-model="form.correo.contabilidad"
                                :disabled="bloqueado"
                                placeholder="contabilidad@dominio.gt, contador@despacho.gt"
                                class="w-full"
                                data-prueba="correo-contabilidad"
                            />
                        </UFormField>
                        <UFormField
                            name="correo.nombre_visible"
                            label="Nombre visible"
                            description="Lleva el nombre comercial de la empresa"
                            class="sm:col-span-3"
                        >
                            <UInput
                                v-model="form.correo.nombre_visible"
                                :disabled="bloqueado"
                                class="w-full"
                            />
                        </UFormField>
                    </div>

                    <div
                        v-if="puedeProbar"
                        class="flex flex-col gap-2 border-t border-default pt-4"
                    >
                        <p class="text-sm text-muted">
                            La prueba usa la configuración guardada (guarda primero si cambiaste algo).
                        </p>
                        <div class="flex flex-col gap-2 sm:flex-row">
                            <UInput
                                v-model="destinoCorreo"
                                type="email"
                                placeholder="correo@destino.gt"
                                aria-label="Correo de destino de la prueba"
                                class="w-full sm:max-w-sm"
                            />
                            <UButton
                                label="Enviar prueba"
                                icon="i-lucide-send"
                                color="neutral"
                                variant="outline"
                                :loading="probando === 'correo'"
                                class="justify-center"
                                data-prueba="probar-correo"
                                @click="probar('correo')"
                            />
                        </div>
                        <ResultadoPrueba :resultado="resultados.correo" />
                    </div>
                </section>

                <section
                    class="surface-card flex flex-col gap-4 p-4 sm:p-6"
                    aria-labelledby="titulo-telegram"
                >
                    <h2
                        id="titulo-telegram"
                        class="flex items-center gap-2 text-base font-semibold text-highlighted"
                    >
                        <UIcon
                            name="i-lucide-send"
                            class="size-5"
                        />
                        Telegram
                    </h2>
                    <div class="flex flex-col gap-3 sm:flex-row sm:gap-8">
                        <USwitch
                            v-model="form.telegram.clientes_activo"
                            :disabled="bloqueado"
                            label="Avisos a clientes"
                        />
                        <USwitch
                            v-if="empresaId === null"
                            v-model="form.telegram.alertas_activo"
                            :disabled="bloqueado"
                            label="Alertas al equipo"
                            description="Caídas del aaa, CoA fallidos…"
                        />
                    </div>
                    <div class="grid gap-4 sm:grid-cols-2 [&>*]:min-w-0">
                        <CampoSecreto
                            v-model="form.secretos.token"
                            :guardado="config.telegram.token"
                            etiqueta="Token del bot"
                            nombre="telegram.token"
                            placeholder="123456:ABC…"
                            :disabled="bloqueado"
                            class="sm:col-span-2"
                        />
                        <UFormField
                            name="telegram.bot_nombre"
                            label="Nombre del bot"
                        >
                            <UInput
                                v-model="form.telegram.bot_nombre"
                                :disabled="bloqueado"
                                placeholder="@ArgosNetBot"
                                class="w-full font-mono"
                            />
                        </UFormField>
                        <UFormField
                            name="telegram.chat_equipo"
                            label="Chat del equipo"
                        >
                            <UInput
                                v-model="form.telegram.chat_equipo"
                                :disabled="bloqueado"
                                placeholder="-1001234567890"
                                class="w-full font-mono"
                            />
                        </UFormField>
                        <CampoSecreto
                            v-model="form.secretos.webhook_secreto"
                            :guardado="config.telegram.webhook_secreto"
                            etiqueta="Secreto del webhook"
                            nombre="telegram.webhook_secreto"
                            :disabled="bloqueado"
                            class="sm:col-span-2"
                        />
                        <DatoFicha
                            v-if="config.telegram.webhook_ruta"
                            etiqueta="Ruta del webhook"
                            :valor="config.telegram.webhook_ruta"
                            mono
                            class="sm:col-span-2"
                        />
                    </div>

                    <div
                        v-if="puedeProbar"
                        class="flex flex-col gap-2 border-t border-default pt-4"
                    >
                        <div class="flex flex-col gap-2 sm:flex-row">
                            <UInput
                                v-model="destinoTelegram"
                                placeholder="Chat de destino (por defecto, el del equipo)"
                                aria-label="Chat de destino de la prueba"
                                class="w-full font-mono sm:max-w-sm"
                            />
                            <UButton
                                label="Enviar prueba"
                                icon="i-lucide-send"
                                color="neutral"
                                variant="outline"
                                :loading="probando === 'telegram'"
                                class="justify-center"
                                data-prueba="probar-telegram"
                                @click="probar('telegram')"
                            />
                        </div>
                        <ResultadoPrueba :resultado="resultados.telegram" />
                    </div>
                </section>

                <section
                    class="surface-card flex flex-col gap-4 p-4 sm:p-6"
                    aria-labelledby="titulo-avisos"
                >
                    <div>
                        <h2
                            id="titulo-avisos"
                            class="flex items-center gap-2 text-base font-semibold text-highlighted"
                        >
                            <UIcon
                                name="i-lucide-list-checks"
                                class="size-5"
                            />
                            Avisos
                        </h2>
                        <p class="text-sm text-muted">
                            Un aviso apagado no se envía por ningún canal y queda registrado como omitido.
                        </p>
                    </div>
                    <div class="grid gap-4 sm:grid-cols-2 [&>*]:min-w-0">
                        <USwitch
                            v-for="{ clave, aviso } in avisosDe(form.avisos)"
                            :key="clave"
                            v-model="form.avisos[clave]"
                            :disabled="bloqueado"
                            :label="aviso.etiqueta"
                            :description="aviso.descripcion"
                            :data-prueba="`aviso-${clave}`"
                        />
                    </div>
                </section>
            </template>
        </div>
    </PanelPagina>
</template>
