<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { FormError, FormSubmitEvent, TableColumn } from '@nuxt/ui'

/**
 * Configuración → Integraciones → Horus Flow (`contratos/horus.md` 1.2.0; API de A1 y A6). Estado
 * del conector (apagado por defecto) y su interruptor, enlace de conexión de 15 min y un uso (§1.4)
 * en los dos sentidos, conexión manual (URL, `hf_pat_`, receptores y secretos, §1.1–§1.3), token
 * `atk_` para que Horus lea de ArgosIsp (§1.2) y revocación de las vinculaciones de autologin
 * (§1.5). Los secretos nunca vuelven de la API: lo recién generado se ve una sola vez.
 */
definePageMeta({ permiso: 'horus.ver' })

useHead({ title: 'Horus Flow · Integraciones · ArgosIsp' })

const { puede } = usePermisos()
const horus = useHorus()
const toast = useToast()
const config = useRuntimeConfig()

const puedeConfigurar = computed(() => puede('horus.configurar'))

/* ---------- Conector ---------- */

const conector = shallowRef<ConectorHorus | null>(null)
const cargando = ref(false)
const problema = ref<Problem | null>(null)

const nuevoSecreto = (): Secreto => ({ accion: 'conservar', valor: '' })
const form = reactive({ url_base: '', webhook_salida_url: '' })
const secretos = reactive<{ token: Secreto, webhook_salida_secreto: Secreto }>({
    token: nuevoSecreto(),
    webhook_salida_secreto: nuevoSecreto(),
})
const estadoFormulario = computed<DatosConectorHorus>(() => ({
    url_base: form.url_base,
    webhook_salida_url: form.webhook_salida_url,
    token: secretos.token.accion === 'reemplazar' ? secretos.token.valor : '',
    webhook_salida_secreto: secretos.webhook_salida_secreto.accion === 'reemplazar' ? secretos.webhook_salida_secreto.valor : '',
}))

function tomar(datos: ConectorHorus) {
    conector.value = datos
    form.url_base = datos.url_base ?? ''
    form.webhook_salida_url = datos.webhook_salida_url ?? ''
    secretos.token = nuevoSecreto()
    secretos.webhook_salida_secreto = nuevoSecreto()
}

async function cargar() {
    cargando.value = true
    problema.value = null
    const resultado = await horus.conector()
    cargando.value = false
    if (resultado.ok) {
        tomar(resultado.data)
    }
    else {
        conector.value = null
        problema.value = resultado.problema
    }
}

/** Secreto del formulario para el `PUT`: sin tocar no viaja; "Borrar" manda `null`. */
function valorSecreto(secreto: Secreto): string | null | undefined {
    if (secreto.accion === 'borrar') {
        return null
    }
    return secreto.accion === 'reemplazar' && secreto.valor.trim() !== '' ? secreto.valor.trim() : undefined
}

const formulario = useTemplateRef<{ setErrors: (errores: FormError[]) => void }>('formulario')
const guardando = ref(false)
const problemaGuardar = ref<Problem | null>(null)
const conflicto = ref(false)

/** Lo que la API muestra una vez: el secreto del receptor de Argos, un enlace o un token. */
const unaVez = shallowRef<{ titulo: string, descripcion: string, valores: { etiqueta: string, valor: string }[], venceEn: string | null } | null>(null)
const unaVezAbierto = ref(false)

function mostrarUnaVez(datos: NonNullable<typeof unaVez.value>) {
    unaVez.value = datos
    unaVezAbierto.value = true
}

function urlReceptorArgos(datos: ConectorHorus): string {
    return datos.webhook_entrada_url ?? datos.webhook_entrada_ruta
}

function mostrarSecretoEntrada(datos: ConectorHorusGuardado) {
    if (!datos.webhook_entrada_secreto_nuevo) {
        return
    }
    mostrarUnaVez({
        titulo: 'Secreto del receptor de ArgosIsp',
        descripcion: 'Pégalo en Horus (Alertas → canal webhook) junto con la URL del receptor.',
        valores: [
            { etiqueta: 'URL del receptor', valor: urlReceptorArgos(datos) },
            { etiqueta: 'Secreto', valor: datos.webhook_entrada_secreto_nuevo },
        ],
        venceEn: null,
    })
}

async function enviarCambios(cambios: Omit<CambiosConectorHorus, 'version'>, exito: string): Promise<boolean> {
    if (!conector.value) {
        return false
    }
    guardando.value = true
    problemaGuardar.value = null
    conflicto.value = false
    const resultado = await horus.guardar({ ...cambios, version: conector.value.version })
    guardando.value = false
    if (resultado.ok) {
        tomar(resultado.data)
        mostrarSecretoEntrada(resultado.data)
        toast.add({ title: exito, color: 'success', icon: 'i-lucide-circle-check' })
        return true
    }
    if (resultado.problema.status === 409) {
        conflicto.value = true
        return false
    }
    // Un 422 marca sus campos en el formulario y, además, se lee arriba (p. ej. `activo`).
    const errores = resultado.problema.errors ?? []
    formulario.value?.setErrors(erroresDeFormulario(resultado.problema))
    problemaGuardar.value = errores.length
        ? { ...resultado.problema, detail: errores.map(e => e.message).join(' · ') }
        : resultado.problema
    return false
}

async function guardar(evento: FormSubmitEvent<DatosConectorHorus>) {
    const cambios: Omit<CambiosConectorHorus, 'version'> = {
        url_base: evento.data.url_base || null,
        webhook_salida_url: evento.data.webhook_salida_url || null,
    }
    const token = valorSecreto(secretos.token)
    const secretoSalida = valorSecreto(secretos.webhook_salida_secreto)
    if (token !== undefined) {
        cambios.token = token
    }
    if (secretoSalida !== undefined) {
        cambios.webhook_salida_secreto = secretoSalida
    }
    await enviarCambios(cambios, 'Conexión guardada')
}

/** El interruptor guarda en el acto (con la `version` leída). */
const activo = computed<boolean>({
    get: () => conector.value?.activo ?? false,
    set: (valor) => {
        void enviarCambios({ activo: valor }, valor ? 'Integración con Horus activada' : 'Integración con Horus apagada')
    },
})

const regenerarAbierto = ref(false)
async function regenerarSecreto(): Promise<Resultado<ConectorHorusGuardado>> {
    if (!conector.value) {
        return { ok: false, problema: PROBLEMA_SIN_CONEXION }
    }
    const resultado = await horus.guardar({ version: conector.value.version, regenerar_secreto_entrada: true })
    if (resultado.ok) {
        tomar(resultado.data)
    }
    return resultado
}

/* ---------- Probar ---------- */

const probando = ref(false)
const prueba = shallowRef<ResultadoPruebaHorus | null>(null)
const problemaPrueba = ref<Problem | null>(null)

async function probar() {
    probando.value = true
    problemaPrueba.value = null
    const resultado = await horus.probar()
    probando.value = false
    prueba.value = resultado.ok ? resultado.data : null
    problemaPrueba.value = resultado.ok ? null : resultado.problema
    if (resultado.ok) {
        void cargar()
    }
}

/* ---------- Enlace de conexión (§1.4) ---------- */

const generandoEnlace = ref(false)
const problemaEnlace = ref<Problem | null>(null)

async function generarEnlace() {
    generandoEnlace.value = true
    problemaEnlace.value = null
    const resultado = await horus.generarEnlace()
    generandoEnlace.value = false
    if (!resultado.ok) {
        problemaEnlace.value = resultado.problema
        return
    }
    mostrarUnaVez({
        titulo: 'Enlace de conexión para Horus',
        descripcion: 'Pégalo en Horus → Administración → Integraciones → ArgosISP → Conectar con enlace.',
        valores: [{ etiqueta: 'Enlace', valor: resultado.data.enlace }],
        venceEn: resultado.data.vence_en,
    })
}

const estadoEnlace = reactive<{ enlace: string }>({ enlace: '' })
const conectando = ref(false)
const problemaConectar = ref<Problem | null>(null)

async function conectar(evento: FormSubmitEvent<DatosEnlaceHorus>) {
    conectando.value = true
    problemaConectar.value = null
    const resultado = await horus.conectarConEnlace(evento.data.enlace)
    conectando.value = false
    if (resultado.ok) {
        estadoEnlace.enlace = ''
        tomar(resultado.data)
        toast.add({ title: 'Conectado con Horus', description: 'El conector quedó apagado: actívalo cuando quieras empezar.', color: 'success', icon: 'i-lucide-link' })
        void cargarTokens()
        return
    }
    const codigo = codigoProblema(resultado.problema)
    problemaConectar.value = codigo === 'enlace_vencido'
        ? { ...resultado.problema, title: 'El enlace de Horus venció o ya se usó', detail: 'Los enlaces duran 15 minutos y sirven una vez. Genera otro en Horus.' }
        : resultado.problema
}

/* ---------- Tokens atk_ (§1.2) ---------- */

const tokens = shallowRef<TokenApi[]>([])
const cargandoTokens = ref(false)
const problemaTokens = ref<Problem | null>(null)

async function cargarTokens() {
    cargandoTokens.value = true
    problemaTokens.value = null
    const resultado = await horus.tokens()
    cargandoTokens.value = false
    tokens.value = resultado.ok ? resultado.data : []
    problemaTokens.value = resultado.ok ? null : resultado.problema
}

const columnasTokens: TableColumn<TokenApi>[] = [
    { accessorKey: 'nombre', header: 'Token', meta: { class: { td: 'whitespace-normal' } } },
    { accessorKey: 'created_at', header: 'Creado', meta: SOLO_ESCRITORIO },
    { accessorKey: 'ultimo_uso', header: 'Último uso', meta: SOLO_ESCRITORIO },
    { id: 'estado', header: 'Estado' },
    { id: 'acciones', header: '', meta: { class: { td: 'text-right w-0' } } },
]

const tokenAbierto = ref(false)
const estadoToken = reactive<{ nombre: string }>({ nombre: '' })
const generandoToken = ref(false)
const problemaToken = ref<Problem | null>(null)

function abrirToken() {
    estadoToken.nombre = ''
    problemaToken.value = null
    tokenAbierto.value = true
}

/** URL de la API de ArgosIsp que Horus guarda junto con el token. */
const urlArgos = computed(() => {
    const base = String(config.public.apiBase || '')
    return /^https?:\/\//.test(base) && !config.public.useFixtures ? base : window.location.origin
})

async function generarToken(evento: FormSubmitEvent<DatosTokenHorusFormulario>) {
    generandoToken.value = true
    problemaToken.value = null
    const resultado = await horus.generarToken(evento.data.nombre ? { nombre: evento.data.nombre } : {})
    generandoToken.value = false
    if (!resultado.ok) {
        problemaToken.value = resultado.problema
        return
    }
    tokenAbierto.value = false
    void cargarTokens()
    mostrarUnaVez({
        titulo: 'Token de ArgosIsp para Horus',
        descripcion: 'Pégalo en Horus junto con la URL de ArgosIsp. Solo puede resolver IPs, ver clientes y servicios y pedir autologin.',
        valores: [
            { etiqueta: 'Token', valor: resultado.data.token },
            { etiqueta: 'URL de ArgosIsp', valor: urlArgos.value },
        ],
        venceEn: null,
    })
}

const tokenARevocar = shallowRef<TokenApi | null>(null)
const revocarTokenAbierto = ref(false)

function pedirRevocar(token: TokenApi) {
    tokenARevocar.value = token
    revocarTokenAbierto.value = true
}

function revocarToken(): Promise<Resultado<TokenApi>> {
    return tokenARevocar.value ? horus.revocarToken(tokenARevocar.value.id) : Promise.resolve({ ok: false, problema: PROBLEMA_SIN_CONEXION })
}

function alRevocarToken(token: TokenApi) {
    toast.add({ title: 'Token revocado', description: `${token.nombre}: Horus ya no puede leer con él.`, color: 'success', icon: 'i-lucide-circle-check' })
    void cargarTokens()
}

/* ---------- Vinculaciones (§1.5) ---------- */

const revocarVinculacionesAbierto = ref(false)

function revocarVinculaciones(): Promise<Resultado<RevocacionVinculaciones>> {
    return useVinculaciones().revocar({ conector: 'horus' })
}

function alRevocarVinculaciones(resultado: RevocacionVinculaciones) {
    toast.add({
        title: resultado.revocadas === 1 ? '1 vinculación revocada' : `${resultado.revocadas} vinculaciones revocadas`,
        description: 'La próxima vez que entren desde Horus tendrán que iniciar sesión en ArgosIsp.',
        color: 'success',
        icon: 'i-lucide-circle-check',
    })
}

onMounted(() => {
    void cargar()
    void cargarTokens()
})

/** `ConfigurarHorus` no enciende el conector sin URL de Horus y código `hf_pat_`. */
const listoParaActivar = computed(() => conector.value !== null && conector.value.url_base !== null && conector.value.token !== null)

const presentacionConector = computed(() => (conector.value?.activo
    ? { etiqueta: 'Activa', color: 'success' as const, icono: 'i-lucide-plug-zap' }
    : { etiqueta: 'Apagada', color: 'neutral' as const, icono: 'i-lucide-power-off' }))
const enPausa = computed(() => {
    const hasta = conector.value?.salud.pausa_hasta
    return hasta && new Date(hasta).getTime() > Date.now() ? hasta : null
})
</script>

<template>
    <PanelPagina
        id="integracion-horus"
        titulo="Horus Flow"
        icono="i-lucide-radar"
    >
        <template #acciones>
            <UButton
                v-if="puede('horus.probar') && conector && conector.version > 0"
                label="Probar conexión"
                icon="i-lucide-activity"
                color="neutral"
                variant="outline"
                :loading="probando"
                data-prueba="probar-horus"
                @click="probar"
            />
        </template>

        <div class="mx-auto flex w-full max-w-4xl flex-col gap-4">
            <ProblemaAlerta
                v-if="problema"
                :problema="problema"
                :reintentar="cargar"
                :reintentando="cargando"
            />
            <div
                v-else-if="!conector"
                class="flex flex-col gap-4"
            >
                <USkeleton class="h-32 w-full" />
                <USkeleton class="h-48 w-full" />
            </div>

            <template v-else>
                <UAlert
                    v-if="conflicto"
                    color="warning"
                    variant="subtle"
                    icon="i-lucide-git-compare"
                    title="Alguien más cambió el conector"
                    description="Tus cambios no se guardaron. Recarga y vuelve a aplicarlos."
                    :actions="[{ label: 'Recargar', color: 'warning', variant: 'outline', onClick: cargar }]"
                />
                <ProblemaAlerta
                    v-if="problemaGuardar"
                    :problema="problemaGuardar"
                />
                <UAlert
                    v-if="conector.errores_cifrado.length"
                    color="error"
                    variant="subtle"
                    icon="i-lucide-key-round"
                    title="Hay secretos que no se pueden leer"
                    :description="`Cambió la clave de cifrado del servidor. Vuelve a escribir: ${conector.errores_cifrado.join(', ')}.`"
                />

                <!-- Estado -->
                <section
                    class="surface-card flex flex-col gap-4 p-4 sm:p-6"
                    aria-labelledby="titulo-estado-horus"
                    data-prueba="estado-horus"
                >
                    <div class="flex flex-wrap items-center justify-between gap-3">
                        <div class="flex flex-col gap-1">
                            <h2
                                id="titulo-estado-horus"
                                class="flex items-center gap-2 text-base font-semibold text-highlighted"
                            >
                                Integración con Horus
                                <UBadge
                                    :label="presentacionConector.etiqueta"
                                    :icon="presentacionConector.icono"
                                    :color="presentacionConector.color"
                                    variant="subtle"
                                    data-prueba="estado-conector"
                                />
                            </h2>
                            <p class="text-sm text-muted">
                                Apagada no hay llamadas a Horus ni webhooks. Nada del cobro, el corte o el AAA espera a Horus.
                            </p>
                        </div>
                        <USwitch
                            v-model="activo"
                            :disabled="!puedeConfigurar || guardando || conector.version === 0 || (!conector.activo && !listoParaActivar)"
                            :label="conector.activo ? 'Activa' : 'Apagada'"
                            aria-label="Activar la integración con Horus"
                            data-prueba="interruptor-horus"
                        />
                    </div>
                    <p
                        v-if="conector.version === 0"
                        class="text-sm text-muted"
                    >
                        Todavía no se conectó: usa un enlace de conexión o la conexión manual.
                    </p>
                    <p
                        v-else-if="!conector.activo && !listoParaActivar"
                        class="text-sm text-muted"
                        data-prueba="falta-para-activar"
                    >
                        Para encenderla hacen falta la URL de Horus y el código de conexión (hf_pat_).
                    </p>

                    <dl class="grid gap-4 sm:grid-cols-3">
                        <DatoFicha
                            etiqueta="Último éxito"
                            :valor="conector.salud.ultimo_exito_en ? formatearFechaHora(conector.salud.ultimo_exito_en) : null"
                        />
                        <DatoFicha
                            etiqueta="Fallos seguidos"
                            :valor="conector.salud.fallos_seguidos"
                        />
                        <DatoFicha
                            etiqueta="Conectado por enlace"
                            :valor="conector.conectado_por_enlace_en ? formatearFechaHora(conector.conectado_por_enlace_en) : null"
                        />
                    </dl>
                    <UAlert
                        v-if="conector.salud.ultimo_error"
                        :color="enPausa ? 'warning' : 'neutral'"
                        variant="subtle"
                        icon="i-lucide-cloud-alert"
                        :title="enPausa ? `En pausa hasta las ${formatearHora(enPausa)} (espera tras fallos)` : 'Último error con Horus'"
                        :description="`${conector.salud.ultimo_error}${conector.salud.ultimo_error_en ? ` · ${formatearFechaHora(conector.salud.ultimo_error_en)}` : ''}`"
                        data-prueba="error-horus"
                    />

                    <div
                        v-if="prueba || problemaPrueba || conector.ultima_prueba.en"
                        role="status"
                        class="flex flex-col gap-2"
                        data-prueba="resultado-prueba-horus"
                    >
                        <ProblemaAlerta
                            v-if="problemaPrueba"
                            :problema="problemaPrueba"
                        />
                        <template v-else-if="prueba">
                            <UAlert
                                :color="prueba.api.ok ? 'success' : 'error'"
                                variant="subtle"
                                :icon="prueba.api.ok ? 'i-lucide-circle-check' : 'i-lucide-circle-x'"
                                :title="prueba.api.ok ? `Lectura de Horus correcta${prueba.api.latencia_ms !== null ? ` (${prueba.api.latencia_ms} ms)` : ''}` : 'Horus no respondió a la lectura'"
                                :description="prueba.api.error ?? undefined"
                            />
                            <UAlert
                                v-if="prueba.webhook"
                                :color="prueba.webhook.ok ? 'success' : 'error'"
                                variant="subtle"
                                :icon="prueba.webhook.ok ? 'i-lucide-circle-check' : 'i-lucide-circle-x'"
                                :title="prueba.webhook.ok ? 'Ping firmado al receptor de Horus correcto' : 'El receptor de Horus rechazó el ping'"
                                :description="prueba.webhook.error ?? undefined"
                            />
                        </template>
                        <p
                            v-else-if="conector.ultima_prueba.en"
                            class="text-sm text-muted"
                        >
                            Última prueba {{ formatearFechaHora(conector.ultima_prueba.en) }}:
                            {{ conector.ultima_prueba.ok ? 'correcta' : `falló${conector.ultima_prueba.error ? ` (${conector.ultima_prueba.error})` : ''}` }}
                        </p>
                    </div>
                </section>

                <!-- Enlace de conexión -->
                <section
                    v-if="puedeConfigurar"
                    class="surface-card flex flex-col gap-4 p-4 sm:p-6"
                    aria-labelledby="titulo-enlace-horus"
                >
                    <div>
                        <h2
                            id="titulo-enlace-horus"
                            class="flex items-center gap-2 text-base font-semibold text-highlighted"
                        >
                            <UIcon
                                name="i-lucide-link"
                                class="size-5"
                            />
                            Conectar con un enlace
                        </h2>
                        <p class="text-sm text-muted">
                            Un enlace intercambia en un paso los tokens y los secretos de los dos sentidos. Dura 15 minutos y sirve una vez.
                        </p>
                    </div>
                    <div class="grid gap-4 sm:grid-cols-2 [&>*]:min-w-0">
                        <div class="flex flex-col gap-2">
                            <h3 class="text-sm font-medium text-highlighted">
                                Generar enlace para Horus
                            </h3>
                            <p class="text-sm text-muted">
                                Lo generas aquí y lo pegas en Horus.
                            </p>
                            <UButton
                                label="Generar enlace de conexión"
                                icon="i-lucide-link-2"
                                color="neutral"
                                variant="outline"
                                class="self-start"
                                :loading="generandoEnlace"
                                data-prueba="generar-enlace"
                                @click="generarEnlace"
                            />
                            <ProblemaAlerta
                                v-if="problemaEnlace"
                                :problema="problemaEnlace"
                            />
                        </div>
                        <UForm
                            :schema="esquemaEnlaceHorus"
                            :state="estadoEnlace"
                            class="flex flex-col gap-2"
                            @submit="conectar"
                        >
                            <UFormField
                                name="enlace"
                                label="Enlace generado en Horus"
                            >
                                <UInput
                                    v-model="estadoEnlace.enlace"
                                    placeholder="https://horus…/conectar#…"
                                    autocomplete="off"
                                    class="w-full font-mono"
                                    data-prueba="enlace-horus"
                                />
                            </UFormField>
                            <UButton
                                type="submit"
                                label="Conectar"
                                icon="i-lucide-plug"
                                class="self-start"
                                :loading="conectando"
                                data-prueba="conectar-enlace"
                            />
                            <ProblemaAlerta
                                v-if="problemaConectar"
                                :problema="problemaConectar"
                            />
                        </UForm>
                    </div>
                </section>

                <!-- Conexión manual -->
                <section
                    class="surface-card flex flex-col gap-4 p-4 sm:p-6"
                    aria-labelledby="titulo-manual-horus"
                >
                    <div>
                        <h2
                            id="titulo-manual-horus"
                            class="flex items-center gap-2 text-base font-semibold text-highlighted"
                        >
                            <UIcon
                                name="i-lucide-sliders-horizontal"
                                class="size-5"
                            />
                            Conexión manual
                        </h2>
                        <p class="text-sm text-muted">
                            Alternativa al enlace: copia los datos de Horus a mano.
                        </p>
                    </div>
                    <UForm
                        ref="formulario"
                        :schema="esquemaConectorHorus"
                        :state="estadoFormulario"
                        :disabled="!puedeConfigurar"
                        class="grid gap-4 sm:grid-cols-2 [&>*]:min-w-0"
                        @submit="guardar"
                    >
                        <UFormField
                            name="url_base"
                            label="URL de Horus"
                            description="Sin /api/v1"
                            class="sm:col-span-2"
                        >
                            <UInput
                                v-model="form.url_base"
                                placeholder="https://horus.isp.gt"
                                autocomplete="off"
                                class="w-full font-mono"
                                data-prueba="url-horus"
                            />
                        </UFormField>
                        <CampoSecreto
                            v-model="secretos.token"
                            :guardado="conector?.token ?? null"
                            etiqueta="Código de conexión de Horus (hf_pat_)"
                            nombre="token"
                            placeholder="hf_pat_…"
                            :disabled="!puedeConfigurar"
                            class="sm:col-span-2"
                        />
                        <UFormField
                            name="webhook_salida_url"
                            label="Receptor de Horus"
                            description="URL que muestra Horus para los avisos de ArgosIsp"
                            class="sm:col-span-2"
                        >
                            <UInput
                                v-model="form.webhook_salida_url"
                                placeholder="https://horus.isp.gt/api/v1/integrations/argosisp/webhook/…"
                                autocomplete="off"
                                class="w-full font-mono"
                            />
                        </UFormField>
                        <CampoSecreto
                            v-model="secretos.webhook_salida_secreto"
                            :guardado="conector?.webhook_salida_secreto ?? null"
                            etiqueta="Secreto del receptor de Horus"
                            nombre="webhook_salida_secreto"
                            :disabled="!puedeConfigurar"
                            class="sm:col-span-2"
                        />

                        <div class="flex flex-col gap-2 border-t border-default pt-4 sm:col-span-2">
                            <h3 class="text-sm font-medium text-highlighted">
                                Receptor de ArgosIsp (para pegar en Horus)
                            </h3>
                            <dl class="grid gap-3 sm:grid-cols-2">
                                <DatoFicha
                                    etiqueta="URL del receptor"
                                    :valor="conector ? urlReceptorArgos(conector) : null"
                                    mono
                                />
                                <DatoFicha etiqueta="Secreto">
                                    <UBadge
                                        :label="conector?.webhook_entrada_secreto ? 'Generado' : 'Sin generar'"
                                        :icon="conector?.webhook_entrada_secreto ? 'i-lucide-lock' : 'i-lucide-lock-open'"
                                        color="neutral"
                                        variant="subtle"
                                        size="sm"
                                    />
                                </DatoFicha>
                            </dl>
                            <p
                                v-if="!conector?.webhook_entrada_url"
                                class="text-xs text-muted"
                            >
                                La API no conoce su URL pública (API_PUBLIC_URL): antepón el dominio de ArgosIsp a la ruta.
                            </p>
                            <UButton
                                v-if="puedeConfigurar && conector && conector.version > 0"
                                :label="conector?.webhook_entrada_secreto ? 'Regenerar secreto' : 'Generar secreto'"
                                icon="i-lucide-refresh-cw"
                                color="neutral"
                                variant="outline"
                                size="sm"
                                class="self-start"
                                @click="regenerarAbierto = true"
                            />
                        </div>

                        <div
                            v-if="puedeConfigurar"
                            class="flex justify-end sm:col-span-2"
                        >
                            <UButton
                                type="submit"
                                label="Guardar conexión"
                                icon="i-lucide-check"
                                class="glow-brand"
                                :loading="guardando"
                                data-prueba="guardar-horus"
                            />
                        </div>
                    </UForm>
                </section>
            </template>

            <!-- Tokens atk_ para Horus -->
            <section
                class="surface-card flex flex-col gap-4 p-4 sm:p-6"
                aria-labelledby="titulo-tokens-horus"
            >
                <div class="flex flex-wrap items-start justify-between gap-2">
                    <div>
                        <h2
                            id="titulo-tokens-horus"
                            class="flex items-center gap-2 text-base font-semibold text-highlighted"
                        >
                            <UIcon
                                name="i-lucide-key-round"
                                class="size-5"
                            />
                            Token de ArgosIsp para Horus
                        </h2>
                        <p class="text-sm text-muted">
                            Lo que usa Horus para leer de ArgosIsp. El enlace de conexión lo genera solo.
                        </p>
                    </div>
                    <UButton
                        v-if="puede('horus.generar_token')"
                        label="Generar token"
                        icon="i-lucide-plus"
                        color="neutral"
                        variant="outline"
                        data-prueba="generar-token-horus"
                        @click="abrirToken"
                    />
                </div>
                <ProblemaAlerta
                    v-if="problemaTokens"
                    :problema="problemaTokens"
                    :reintentar="cargarTokens"
                    :reintentando="cargandoTokens"
                />
                <UTable
                    v-else
                    :data="tokens"
                    :columns="columnasTokens"
                    :loading="cargandoTokens"
                    data-prueba="tabla-tokens-horus"
                >
                    <template #nombre-cell="{ row }">
                        <div class="flex flex-col">
                            <span class="text-sm font-medium text-highlighted">{{ row.original.nombre }}</span>
                            <span class="text-xs text-muted sm:hidden">Creado {{ formatearFechaHora(row.original.created_at) }}</span>
                        </div>
                    </template>
                    <template #created_at-cell="{ row }">
                        {{ formatearFechaHora(row.original.created_at) }}
                    </template>
                    <template #ultimo_uso-cell="{ row }">
                        {{ row.original.ultimo_uso ? formatearFechaHora(row.original.ultimo_uso) : 'Nunca' }}
                    </template>
                    <template #estado-cell="{ row }">
                        <UBadge
                            :label="row.original.revocado_en ? 'Revocado' : 'Vigente'"
                            :icon="row.original.revocado_en ? 'i-lucide-ban' : 'i-lucide-circle-check'"
                            :color="row.original.revocado_en ? 'neutral' : 'success'"
                            variant="subtle"
                            size="sm"
                        />
                    </template>
                    <template #acciones-cell="{ row }">
                        <UButton
                            v-if="puede('horus.revocar_token') && !row.original.revocado_en"
                            label="Revocar"
                            icon="i-lucide-ban"
                            color="error"
                            variant="ghost"
                            size="sm"
                            :aria-label="`Revocar ${row.original.nombre}`"
                            :data-prueba="`revocar-token-${row.original.id}`"
                            @click="pedirRevocar(row.original)"
                        />
                    </template>
                    <template #empty>
                        <UEmpty
                            icon="i-lucide-key-round"
                            title="Todavía no hay tokens para Horus"
                            variant="naked"
                        />
                    </template>
                </UTable>
            </section>

            <!-- Vinculaciones -->
            <section
                v-if="puede('vinculaciones.revocar')"
                class="surface-card flex flex-col gap-3 p-4 sm:p-6"
                aria-labelledby="titulo-vinculaciones-horus"
            >
                <h2
                    id="titulo-vinculaciones-horus"
                    class="flex items-center gap-2 text-base font-semibold text-highlighted"
                >
                    <UIcon
                        name="i-lucide-users-round"
                        class="size-5"
                    />
                    Autologin desde Horus
                </h2>
                <p class="text-sm text-muted">
                    Cada usuario vincula su cuenta de Horus iniciando sesión en ArgosIsp la primera vez. Revocar obliga a todos a volver a hacerlo; ninguno pierde su usuario.
                </p>
                <UButton
                    label="Revocar todas las vinculaciones"
                    icon="i-lucide-unlink"
                    color="error"
                    variant="outline"
                    class="self-start"
                    data-prueba="revocar-vinculaciones"
                    @click="revocarVinculacionesAbierto = true"
                />
            </section>
        </div>

        <ValorUnaVezModal
            v-if="unaVez"
            v-model:open="unaVezAbierto"
            :titulo="unaVez.titulo"
            :descripcion="unaVez.descripcion"
            :valores="unaVez.valores"
            :vence-en="unaVez.venceEn"
            @cerrado="unaVez = null"
        />

        <UModal
            v-model:open="tokenAbierto"
            title="Generar token para Horus"
            description="Un token nuevo no revoca los anteriores."
            :dismissible="!generandoToken"
        >
            <template #body>
                <UForm
                    id="formulario-token-horus"
                    :schema="esquemaTokenHorus"
                    :state="estadoToken"
                    class="flex flex-col gap-4"
                    @submit="generarToken"
                >
                    <UFormField
                        name="nombre"
                        label="Nombre"
                        help="Opcional. Para reconocerlo en la lista."
                    >
                        <UInput
                            v-model="estadoToken.nombre"
                            placeholder="Horus producción"
                            class="w-full"
                        />
                    </UFormField>
                    <ProblemaAlerta
                        v-if="problemaToken"
                        :problema="problemaToken"
                    />
                </UForm>
            </template>
            <template #footer>
                <div class="flex w-full justify-end gap-2">
                    <UButton
                        label="Cancelar"
                        color="neutral"
                        variant="ghost"
                        :disabled="generandoToken"
                        @click="tokenAbierto = false"
                    />
                    <UButton
                        type="submit"
                        form="formulario-token-horus"
                        label="Generar"
                        icon="i-lucide-key-round"
                        :loading="generandoToken"
                        data-prueba="confirmar-token-horus"
                    />
                </div>
            </template>
        </UModal>

        <ConfirmacionModal
            v-model:open="revocarTokenAbierto"
            titulo="Revocar token de Horus"
            :efecto="`Horus deja de poder leer de ArgosIsp con «${tokenARevocar?.nombre ?? ''}» de inmediato.`"
            confirmar="Revocar"
            :ejecutar="revocarToken"
            @hecho="alRevocarToken"
        />
        <ConfirmacionModal
            v-model:open="regenerarAbierto"
            titulo="Regenerar el secreto del receptor"
            efecto="Los avisos que Horus firme con el secreto anterior se rechazarán hasta que pegues el nuevo en Horus."
            confirmar="Regenerar"
            icono="i-lucide-refresh-cw"
            color="warning"
            :ejecutar="regenerarSecreto"
            @hecho="mostrarSecretoEntrada"
        />
        <ConfirmacionModal
            v-model:open="revocarVinculacionesAbierto"
            titulo="Revocar las vinculaciones con Horus"
            efecto="Todos los usuarios tendrán que iniciar sesión en ArgosIsp la próxima vez que entren desde Horus."
            confirmar="Revocar todas"
            icono="i-lucide-unlink"
            :ejecutar="revocarVinculaciones"
            @hecho="alRevocarVinculaciones"
        />
    </PanelPagina>
</template>
