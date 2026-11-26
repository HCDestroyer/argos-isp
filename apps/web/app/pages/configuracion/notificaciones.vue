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

/*
 * Tablero OperConfigNotificaciones: arriba los tres canales con su estado (tocar uno abre su
 * configuración en el panel de la derecha); a la izquierda, la tarjeta con las pestañas «Avisos a
 * clientes», «Alertas al equipo» y «Recordatorios». WhatsApp es de solo lectura con enlace a Iris
 * (decisión 26 del PM): sus textos los aprueba Meta y se cambian en Iris.
 */
type Canal = 'whatsapp' | 'correo' | 'telegram'
const canal = ref<Canal>('correo')
type PestanaAvisos = 'clientes' | 'equipo' | 'recordatorios'
const pestana = ref<PestanaAvisos>('clientes')
const itemsPestana = [
    { label: 'Avisos a clientes', value: 'clientes', icon: 'i-lucide-users' },
    { label: 'Alertas al equipo', value: 'equipo', icon: 'i-lucide-triangle-alert' },
    { label: 'Recordatorios', value: 'recordatorios', icon: 'i-lucide-clock' },
]

interface EstadoCanal { etiqueta: string, color: 'success' | 'neutral' | 'warning' }

const canales = computed<{ id: Canal, titulo: string, detalle: string, icono: string, tono: string, estado: EstadoCanal | null }[]>(() => {
    const actual = form.value
    return [
        {
            id: 'whatsapp',
            titulo: 'WhatsApp por Iris',
            detalle: 'Textos aprobados por Meta, en Iris',
            icono: 'i-lucide-message-square',
            tono: 'tono-exito',
            estado: actual ? (actual.whatsapp.activo ? { etiqueta: 'Encendido', color: 'success' } : { etiqueta: 'Apagado', color: 'neutral' }) : null,
        },
        {
            id: 'correo',
            titulo: 'Correo',
            detalle: actual?.correo.remitente || 'Servidor SMTP',
            icono: 'i-lucide-mail',
            tono: 'tono-exito',
            estado: actual ? (actual.correo.activo && actual.correo.host ? { etiqueta: 'Encendido', color: 'success' } : actual.correo.host ? { etiqueta: 'Apagado', color: 'neutral' } : { etiqueta: 'Sin configurar', color: 'warning' }) : null,
        },
        {
            id: 'telegram',
            titulo: 'Telegram',
            detalle: actual?.telegram.bot_nombre || 'Bot para avisos y alertas del equipo',
            icono: 'i-lucide-send',
            tono: 'tono-marca',
            estado: actual ? (config.value?.telegram.token ? { etiqueta: 'Configurado', color: 'success' } : { etiqueta: 'Sin configurar', color: 'neutral' }) : null,
        },
    ]
})
</script>

<template>
    <ConfiguracionMarco
        id="notificaciones"
        sin-tarjeta
    >
        <template #acciones>
            <UButton
                v-if="puede('notificaciones.ver')"
                label="Envíos recientes"
                icon="i-lucide-history"
                color="neutral"
                variant="outline"
                to="/notificaciones?tab=envios"
                data-prueba="envios-recientes"
            />
        </template>

        <div
            class="grid gap-3 sm:grid-cols-3"
            data-prueba="canales-notificaciones"
        >
            <UButton
                v-for="item in canales"
                :key="item.id"
                color="neutral"
                variant="ghost"
                class="surface-card flex min-w-0 items-center gap-3 rounded-2xl p-3 text-start"
                :class="canal === item.id ? 'ring-2 ring-primary' : ''"
                :aria-pressed="canal === item.id"
                :data-canal="item.id"
                @click="canal = item.id"
            >
                <span
                    class="pastilla-icono pastilla-tono"
                    :class="item.tono"
                >
                    <UIcon
                        :name="item.icono"
                        class="size-5"
                    />
                </span>
                <span class="flex min-w-0 flex-1 flex-col">
                    <span class="text-sm font-semibold text-highlighted">{{ item.titulo }}</span>
                    <span class="truncate text-xs text-muted">{{ item.detalle }}</span>
                </span>
                <UBadge
                    v-if="item.estado"
                    :label="item.estado.etiqueta"
                    :color="item.estado.color"
                    variant="subtle"
                    size="sm"
                />
            </UButton>
        </div>

        <ProblemaAlerta
            v-if="problema"
            :problema="problema"
            :reintentar="cargar"
            :reintentando="cargando"
        />

        <div class="grid min-w-0 gap-3.5 lg:min-h-0 lg:flex-1 xl:grid-cols-[minmax(0,1fr)_24rem]">
            <section class="surface-card flex min-w-0 flex-col rounded-2xl lg:min-h-0">
                <div class="flex flex-wrap items-center justify-between gap-2 border-b border-(--ax-borde) p-3 sm:px-4">
                    <UTabs
                        v-model="pestana"
                        :items="itemsPestana"
                        variant="pill"
                        color="neutral"
                        :content="false"
                        class="min-w-0 max-w-full"
                        :ui="{
                            list: 'w-auto max-w-full justify-start self-start overflow-x-auto rounded-xl bg-(--ax-panel) p-1',
                            indicator: 'rounded-lg bg-(--ax-tarjeta) shadow-sm ring ring-(--ax-borde)',
                            trigger: 'shrink-0 grow-0 rounded-lg px-3 text-muted data-[state=active]:text-primary',
                            leadingIcon: 'size-4',
                        }"
                        data-prueba="pestanas-notificaciones"
                    />
                    <div class="flex items-center gap-2">
                        <UBadge
                            v-if="origen"
                            :label="origen.etiqueta"
                            :icon="origen.icono"
                            :color="origen.color"
                            variant="subtle"
                            data-prueba="origen-notificaciones"
                        />
                        <USelect
                            v-model="ambito"
                            :items="itemsAmbito"
                            icon="i-lucide-building"
                            aria-label="Configuración de"
                            class="w-48"
                            data-prueba="ambito-notificaciones"
                        />
                    </div>
                </div>

                <div class="flex min-w-0 flex-col gap-4 p-4 lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
                    <div
                        v-if="!form || !config"
                        class="flex flex-col gap-3"
                    >
                        <USkeleton
                            v-if="!problema"
                            class="h-40 w-full"
                        />
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
                        <USwitch
                            v-if="empresaId !== null"
                            v-model="form.hereda"
                            :disabled="!puedeConfigurar"
                            label="Usar la configuración global"
                            description="Apágalo para que esta empresa tenga su propio servidor de correo, su bot y sus avisos."
                            data-prueba="hereda"
                        />

                        <div
                            v-if="pestana === 'clientes'"
                            class="flex flex-col"
                            data-prueba="avisos-clientes"
                        >
                            <p class="pb-2 text-sm text-muted">
                                Un aviso apagado no se envía por ningún canal y queda registrado como omitido.
                            </p>
                            <div
                                v-for="{ clave, aviso } in avisosDe(form.avisos)"
                                :key="clave"
                                class="flex items-center justify-between gap-3 border-t border-(--ax-borde) py-3"
                            >
                                <div class="flex min-w-0 flex-col">
                                    <span class="text-sm font-semibold text-highlighted">{{ aviso.etiqueta }}</span>
                                    <span class="text-xs text-muted">{{ aviso.descripcion }}</span>
                                    <span class="font-mono text-xs text-dimmed">{{ clave }}</span>
                                </div>
                                <USwitch
                                    v-model="form.avisos[clave]"
                                    :disabled="bloqueado"
                                    :aria-label="aviso.etiqueta"
                                    :data-prueba="`aviso-${clave}`"
                                />
                            </div>
                        </div>

                        <div
                            v-else-if="pestana === 'equipo'"
                            class="flex flex-col gap-4"
                            data-prueba="alertas-equipo"
                        >
                            <USwitch
                                v-if="empresaId === null"
                                v-model="form.telegram.alertas_activo"
                                :disabled="bloqueado"
                                label="Alertas al chat del equipo por Telegram"
                                description="Caídas del servidor RADIUS, CoA fallidos, routers sin respuesta…"
                            />
                            <UFormField
                                name="correo.contabilidad"
                                label="Correo de contabilidad"
                                description="Avisos fiscales: integridad del libro, DTE rechazado, contingencia FEL y notas anuladas. Varios, separados por coma."
                                :error="errorListaCorreos(form.correo.contabilidad)"
                            >
                                <UInput
                                    v-model="form.correo.contabilidad"
                                    :disabled="bloqueado"
                                    placeholder="contabilidad@dominio.gt, contador@despacho.gt"
                                    class="w-full"
                                    data-prueba="correo-contabilidad"
                                />
                            </UFormField>
                        </div>

                        <div
                            v-else
                            class="flex flex-col gap-3"
                            data-prueba="recordatorios"
                        >
                            <p class="text-sm text-muted">
                                Los recordatorios de pago (días antes de vencer y de la promesa) y el texto de cada aviso se editan en Plantillas de avisos, con vista previa de las variables.
                            </p>
                            <UButton
                                label="Abrir recordatorios"
                                icon="i-lucide-clock"
                                color="neutral"
                                variant="outline"
                                class="self-start"
                                to="/notificaciones?tab=recordatorios"
                            />
                            <UButton
                                label="Abrir plantillas de avisos"
                                icon="i-lucide-message-square-text"
                                color="neutral"
                                variant="outline"
                                class="self-start"
                                to="/notificaciones"
                            />
                        </div>
                    </template>
                </div>
                <div class="flex items-center gap-2 border-t border-(--ax-borde) px-4 py-3 text-xs text-muted">
                    <UIcon
                        name="i-lucide-info"
                        class="size-4 shrink-0"
                    />
                    Si el hecho nació en Iris (un pago por chat), Argos no avisa: lo hace Iris en la conversación.
                </div>
            </section>

            <section
                class="surface-card flex min-w-0 flex-col rounded-2xl lg:min-h-0"
                data-prueba="panel-canal"
            >
                <div class="flex min-w-0 flex-col gap-4 p-4 lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
                    <template v-if="form && config">
                        <div
                            v-if="canal === 'whatsapp'"
                            class="flex flex-col gap-4"
                            data-prueba="seccion-whatsapp"
                        >
                            <h2 class="flex items-center gap-2 text-sm font-semibold text-highlighted">
                                <UIcon
                                    name="i-lucide-message-circle"
                                    class="size-5"
                                />
                                WhatsApp por Iris
                            </h2>
                            <USwitch
                                v-model="form.whatsapp.activo"
                                :disabled="bloqueado"
                                label="Avisos a clientes por WhatsApp"
                                description="Salen por la mensajería de Iris: Iris tiene los textos aprobados por Meta, los permisos de contacto, el límite diario y el horario de silencio."
                                data-prueba="whatsapp-activo"
                            />
                            <UAlert
                                color="warning"
                                variant="subtle"
                                icon="i-lucide-triangle-alert"
                                description="En WhatsApp el texto debe estar aprobado por Meta. Las plantillas se ven y se cambian solo en Iris; aquí no se editan."
                            />
                            <p class="text-xs text-muted">
                                Necesita el conector con Iris activo y con contrato 0.6.0 o posterior; si no, cada aviso queda «omitido» con el motivo en la lista de envíos. Correo y Telegram siguen saliendo de Argos.
                            </p>
                            <UButton
                                v-if="puede('iris.ver')"
                                label="Ver el conector con Iris"
                                icon="i-lucide-external-link"
                                color="neutral"
                                variant="outline"
                                class="self-start"
                                to="/configuracion/integraciones/iris"
                            />
                        </div>
                        <div
                            v-else-if="canal === 'correo'"
                            class="flex flex-col gap-4"
                        >
                            <section
                                class="flex flex-col gap-4"
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
                                <div class="grid gap-4 sm:grid-cols-6 lg:grid-cols-2 [&>*]:min-w-0">
                                    <UFormField
                                        name="correo.host"
                                        label="Servidor"
                                        class="sm:col-span-4 lg:col-span-2"
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
                                        class="sm:col-span-2 lg:col-span-2"
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
                                        class="sm:col-span-3 lg:col-span-1"
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
                                        class="sm:col-span-3 lg:col-span-1"
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
                                        class="sm:col-span-6 lg:col-span-2"
                                    />
                                    <UFormField
                                        name="correo.remitente"
                                        label="Remitente"
                                        class="sm:col-span-3 lg:col-span-1"
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
                                        name="correo.nombre_visible"
                                        label="Nombre visible"
                                        description="Lleva el nombre comercial de la empresa"
                                        class="sm:col-span-3 lg:col-span-1"
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
                                    class="flex flex-col gap-2 border-t border-(--ax-borde) pt-4"
                                >
                                    <p class="text-sm text-muted">
                                        La prueba usa la configuración guardada (guarda primero si cambiaste algo).
                                    </p>
                                    <div class="flex flex-col gap-2">
                                        <UInput
                                            v-model="destinoCorreo"
                                            type="email"
                                            placeholder="correo@destino.gt"
                                            aria-label="Correo de destino de la prueba"
                                            class="w-full"
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
                        </div>
                        <div
                            v-else
                            class="flex flex-col gap-4"
                        >
                            <section
                                class="flex flex-col gap-4"
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
                                    class="flex flex-col gap-2 border-t border-(--ax-borde) pt-4"
                                >
                                    <div class="flex flex-col gap-2">
                                        <UInput
                                            v-model="destinoTelegram"
                                            placeholder="Chat de destino (por defecto, el del equipo)"
                                            aria-label="Chat de destino de la prueba"
                                            class="w-full font-mono"
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
                        </div>
                    </template>
                </div>
                <div
                    v-if="puedeConfigurar && form"
                    class="sticky bottom-0 flex items-center justify-end gap-2 rounded-b-2xl border-t border-(--ax-borde) bg-(--ax-tarjeta) px-4 py-3"
                >
                    <UButton
                        label="Guardar"
                        icon="i-lucide-check"
                        :loading="guardando"
                        class="glow-brand"
                        data-prueba="guardar-notificaciones"
                        @click="guardar"
                    />
                </div>
            </section>
        </div>
    </ConfiguracionMarco>
</template>
