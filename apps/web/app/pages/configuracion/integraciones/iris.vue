<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { FormError, FormSubmitEvent, TableColumn } from '@nuxt/ui'

/**
 * Configuración → Integraciones → Iris (`contratos/iris.md` §1 y §2.3; API de A1 y A6). Estado
 * del conector (apagado por defecto) y su interruptor, enlace de conexión de 15 min y un uso para
 * pegar en Iris (§1.3), configuración a mano (URL, `iris_pat_`, receptor y su secreto), tokens
 * `atk_` del usuario técnico Iris (§1.1) y los webhooks enviados a Iris. Los secretos nunca
 * vuelven de la API: lo recién generado se ve una sola vez.
 */
definePageMeta({ permiso: 'iris.ver' })

useHead({ title: 'Iris · Integraciones · ArgosIsp' })

const { puede } = usePermisos()
const iris = useIris()
const toast = useToast()
const config = useRuntimeConfig()

const puedeConfigurar = computed(() => puede('iris.configurar'))

/* ---------- Conector ---------- */

const conector = shallowRef<ConectorIris | null>(null)
const cargando = ref(false)
const problema = ref<Problem | null>(null)

const nuevoSecreto = (): Secreto => ({ accion: 'conservar', valor: '' })
const form = reactive({ url_base: '', webhook_salida_url: '' })
const secretos = reactive<{ token: Secreto, webhook_salida_secreto: Secreto }>({
    token: nuevoSecreto(),
    webhook_salida_secreto: nuevoSecreto(),
})
const estadoFormulario = computed<DatosConectorIris>(() => ({
    url_base: form.url_base,
    webhook_salida_url: form.webhook_salida_url,
    token: secretos.token.accion === 'reemplazar' ? secretos.token.valor : '',
    webhook_salida_secreto: secretos.webhook_salida_secreto.accion === 'reemplazar' ? secretos.webhook_salida_secreto.valor : '',
}))

function tomar(datos: ConectorIris) {
    conector.value = datos
    form.url_base = datos.url_base ?? ''
    form.webhook_salida_url = datos.webhook_salida_url ?? ''
    secretos.token = nuevoSecreto()
    secretos.webhook_salida_secreto = nuevoSecreto()
}

async function cargar() {
    cargando.value = true
    problema.value = null
    const resultado = await iris.conector()
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

async function enviarCambios(cambios: Omit<CambiosConectorIris, 'version'>, exito: string): Promise<boolean> {
    if (!conector.value) {
        return false
    }
    guardando.value = true
    problemaGuardar.value = null
    conflicto.value = false
    const resultado = await iris.guardar({ ...cambios, version: conector.value.version })
    guardando.value = false
    if (resultado.ok) {
        tomar(resultado.data)
        toast.add({ title: exito, color: 'success', icon: 'i-lucide-circle-check' })
        void cargarEnvios()
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

async function guardar(evento: FormSubmitEvent<DatosConectorIris>) {
    const cambios: Omit<CambiosConectorIris, 'version'> = {
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
    await enviarCambios(cambios, 'Conexión con Iris guardada')
}

/** El interruptor guarda en el acto (con la `version` leída). */
const activo = computed<boolean>({
    get: () => conector.value?.activo ?? false,
    set: (valor) => {
        void enviarCambios({ activo: valor }, valor ? 'Integración con Iris activada' : 'Integración con Iris apagada')
    },
})

const listoParaActivar = computed(() => conector.value !== null && irisListoParaActivar(conector.value))
const presentacionConector = computed(() => (conector.value ? presentacionConectorIris(conector.value) : null))

/* ---------- Lo que se muestra una sola vez ---------- */

const unaVez = shallowRef<{ titulo: string, descripcion: string, valores: { etiqueta: string, valor: string }[], venceEn: string | null } | null>(null)
const unaVezAbierto = ref(false)

function mostrarUnaVez(datos: NonNullable<typeof unaVez.value>) {
    unaVez.value = datos
    unaVezAbierto.value = true
}

/* ---------- Enlace de conexión (§1.3) ---------- */

const generandoEnlace = ref(false)
const problemaEnlace = ref<Problem | null>(null)

async function generarEnlace() {
    generandoEnlace.value = true
    problemaEnlace.value = null
    const resultado = await iris.generarEnlace()
    generandoEnlace.value = false
    if (!resultado.ok) {
        problemaEnlace.value = resultado.problema
        return
    }
    mostrarUnaVez({
        titulo: 'Enlace de conexión para Iris',
        descripcion: INSTRUCCION_ENLACE_IRIS,
        valores: [{ etiqueta: 'Enlace', valor: resultado.data.enlace }],
        venceEn: resultado.data.vence_en,
    })
}

/* ---------- Tokens atk_ del usuario técnico Iris (§1.1) ---------- */

const tokens = shallowRef<TokenApi[]>([])
const cargandoTokens = ref(false)
const problemaTokens = ref<Problem | null>(null)

async function cargarTokens() {
    cargandoTokens.value = true
    problemaTokens.value = null
    const resultado = await iris.tokens()
    cargandoTokens.value = false
    tokens.value = resultado.ok ? resultado.data : []
    problemaTokens.value = resultado.ok ? null : resultado.problema
}

const tokenAbierto = ref(false)
const estadoToken = reactive<{ nombre: string }>({ nombre: '' })
const generandoToken = ref(false)
const problemaToken = ref<Problem | null>(null)

function abrirToken() {
    estadoToken.nombre = ''
    problemaToken.value = null
    tokenAbierto.value = true
}

/** URL de la API de ArgosIsp que Iris guarda junto con el token. */
const urlArgos = computed(() => {
    const base = String(config.public.apiBase || '')
    return /^https?:\/\//.test(base) && !config.public.useFixtures ? base : window.location.origin
})

async function generarToken(evento: FormSubmitEvent<DatosTokenIrisFormulario>) {
    generandoToken.value = true
    problemaToken.value = null
    const resultado = await iris.generarToken(evento.data.nombre ? { nombre: evento.data.nombre } : {})
    generandoToken.value = false
    if (!resultado.ok) {
        problemaToken.value = resultado.problema
        return
    }
    tokenAbierto.value = false
    void cargarTokens()
    mostrarUnaVez({
        titulo: 'Token de ArgosIsp para Iris',
        descripcion: 'Pégalo en Iris junto con la URL de ArgosIsp. Lleva solo los permisos del usuario técnico «Iris».',
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
    return tokenARevocar.value ? iris.revocarToken(tokenARevocar.value.id) : Promise.resolve({ ok: false, problema: PROBLEMA_SIN_CONEXION })
}

function alRevocarToken(token: TokenApi) {
    toast.add({ title: 'Token revocado', description: `${token.nombre}: Iris ya no puede usarlo.`, color: 'success', icon: 'i-lucide-circle-check' })
    void cargarTokens()
}

/* ---------- Envíos a Iris (§2.3) ---------- */

const LIMITE_ENVIOS = 20

const resumen = shallowRef<ResumenEnviosIris | null>(null)
const envios = shallowRef<EnvioIris[]>([])
const siguienteCursor = ref<string | null>(null)
const cargandoEnvios = ref(false)
const cargandoMas = ref(false)
const problemaEnvios = ref<Problem | null>(null)
const problemaMas = ref<Problem | null>(null)

async function cargarEnvios() {
    cargandoEnvios.value = true
    problemaEnvios.value = null
    problemaMas.value = null
    const [datosResumen, pagina] = await Promise.all([iris.resumenEnvios(), iris.envios({ limit: LIMITE_ENVIOS })])
    cargandoEnvios.value = false
    if (!datosResumen.ok || !pagina.ok) {
        // Sin resumen o sin lista no se muestra ninguno de los dos: nada de contadores en cero.
        resumen.value = null
        envios.value = []
        siguienteCursor.value = null
        problemaEnvios.value = datosResumen.ok ? (pagina.ok ? null : pagina.problema) : datosResumen.problema
        return
    }
    resumen.value = datosResumen.data
    envios.value = pagina.data.data
    siguienteCursor.value = pagina.data.nextCursor
}

async function cargarMasEnvios() {
    if (!siguienteCursor.value) {
        return
    }
    cargandoMas.value = true
    problemaMas.value = null
    const pagina = await iris.envios({ limit: LIMITE_ENVIOS, cursor: siguienteCursor.value })
    cargandoMas.value = false
    if (!pagina.ok) {
        problemaMas.value = pagina.problema
        return
    }
    envios.value = [...envios.value, ...pagina.data.data]
    siguienteCursor.value = pagina.data.nextCursor
}

const columnasEnvios: TableColumn<EnvioIris>[] = [
    { accessorKey: 'evento', header: 'Evento', meta: { class: { td: 'whitespace-normal' } } },
    { accessorKey: 'estado', header: 'Estado' },
    { accessorKey: 'intentos', header: 'Intentos', meta: SOLO_ESCRITORIO },
    { id: 'cuando', header: 'Cuándo', meta: SOLO_ESCRITORIO },
    { accessorKey: 'ultimo_error', header: 'Último error', meta: { class: { th: 'hidden md:table-cell', td: 'hidden md:table-cell whitespace-normal' } } },
]

/** Lo más útil de cada envío: cuándo salió, o cuándo se reintenta, o cuándo se creó. */
function cuandoEnvio(envio: EnvioIris): string {
    if (envio.enviado_en) {
        return `Enviado ${formatearFechaHora(envio.enviado_en)}`
    }
    if (envio.estado === 'pendiente' && envio.proximo_intento_en) {
        return `Reintento ${formatearFechaHora(envio.proximo_intento_en)}`
    }
    return `Creado ${formatearFechaHora(envio.created_at)}`
}

onMounted(() => {
    void cargar()
    void cargarTokens()
    void cargarEnvios()
})
</script>

<template>
    <PanelPagina
        id="integracion-iris"
        titulo="Iris"
        icono="i-lucide-clipboard-list"
    >
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

                <!-- Estado -->
                <section
                    class="surface-card flex flex-col gap-4 p-4 sm:p-6"
                    aria-labelledby="titulo-estado-iris"
                    data-prueba="estado-iris"
                >
                    <div class="flex flex-wrap items-center justify-between gap-3">
                        <div class="flex flex-col gap-1">
                            <h2
                                id="titulo-estado-iris"
                                class="flex items-center gap-2 text-base font-semibold text-highlighted"
                            >
                                Integración con Iris
                                <UBadge
                                    v-if="presentacionConector"
                                    :label="presentacionConector.etiqueta"
                                    :icon="presentacionConector.icono"
                                    :color="presentacionConector.color"
                                    variant="subtle"
                                    data-prueba="estado-conector-iris"
                                />
                            </h2>
                            <p class="text-sm text-muted">
                                Apagada no hay llamadas a Iris ni webhooks. Nada del cobro, el corte o el AAA espera a Iris.
                            </p>
                        </div>
                        <USwitch
                            v-model="activo"
                            :disabled="!puedeConfigurar || guardando || (!conector.activo && !listoParaActivar)"
                            :label="conector.activo ? 'Activa' : 'Apagada'"
                            aria-label="Activar la integración con Iris"
                            data-prueba="interruptor-iris"
                        />
                    </div>
                    <p
                        v-if="conector.version === 0"
                        class="text-sm text-muted"
                    >
                        Todavía no se conectó: genera un enlace de conexión o usa la configuración a mano.
                    </p>
                    <p
                        v-else-if="!conector.activo && !listoParaActivar"
                        class="text-sm text-muted"
                        data-prueba="falta-para-activar-iris"
                    >
                        Para encenderla hacen falta la URL de Iris y su token (iris_pat_).
                    </p>

                    <dl class="grid gap-4 sm:grid-cols-3">
                        <DatoFicha
                            etiqueta="URL de Iris"
                            :valor="conector.url_base"
                            mono
                        />
                        <DatoFicha
                            etiqueta="Conectado por enlace"
                            :valor="conector.conectado_por_enlace_en ? formatearFechaHora(conector.conectado_por_enlace_en) : null"
                        />
                        <DatoFicha
                            etiqueta="Id del conector"
                            :valor="conector.conector_id"
                            mono
                        />
                    </dl>
                </section>

                <!-- Enlace de conexión -->
                <section
                    v-if="puedeConfigurar"
                    class="surface-card flex flex-col gap-3 p-4 sm:p-6"
                    aria-labelledby="titulo-enlace-iris"
                >
                    <h2
                        id="titulo-enlace-iris"
                        class="flex items-center gap-2 text-base font-semibold text-highlighted"
                    >
                        <UIcon
                            name="i-lucide-link"
                            class="size-5"
                        />
                        Conectar con un enlace
                    </h2>
                    <p class="text-sm text-muted">
                        Iris lo canjea y recibe en un paso su token de ArgosIsp; ArgosIsp guarda la URL de Iris, su token y su receptor. El conector queda apagado hasta que lo actives. Un enlace nuevo anula los anteriores sin usar.
                    </p>
                    <UButton
                        label="Generar enlace de conexión"
                        icon="i-lucide-link-2"
                        color="neutral"
                        variant="outline"
                        class="self-start"
                        :loading="generandoEnlace"
                        data-prueba="generar-enlace-iris"
                        @click="generarEnlace"
                    />
                    <ProblemaAlerta
                        v-if="problemaEnlace"
                        :problema="problemaEnlace"
                        :reintentar="generarEnlace"
                        :reintentando="generandoEnlace"
                    />
                </section>

                <!-- Configuración a mano -->
                <section
                    class="surface-card flex flex-col gap-4 p-4 sm:p-6"
                    aria-labelledby="titulo-manual-iris"
                >
                    <div>
                        <h2
                            id="titulo-manual-iris"
                            class="flex items-center gap-2 text-base font-semibold text-highlighted"
                        >
                            <UIcon
                                name="i-lucide-sliders-horizontal"
                                class="size-5"
                            />
                            Configuración a mano
                        </h2>
                        <p class="text-sm text-muted">
                            Alternativa al enlace: copia los datos de Iris a mano.
                        </p>
                    </div>
                    <UForm
                        ref="formulario"
                        :schema="esquemaConectorIris"
                        :state="estadoFormulario"
                        :disabled="!puedeConfigurar"
                        class="grid gap-4 sm:grid-cols-2 [&>*]:min-w-0"
                        @submit="guardar"
                    >
                        <UFormField
                            name="url_base"
                            label="URL de Iris"
                            description="Sin /api/v1"
                            class="sm:col-span-2"
                        >
                            <UInput
                                v-model="form.url_base"
                                placeholder="https://iris.isp.gt"
                                autocomplete="off"
                                class="w-full font-mono"
                                data-prueba="url-iris"
                            />
                        </UFormField>
                        <CampoSecreto
                            v-model="secretos.token"
                            :guardado="conector?.token ?? null"
                            etiqueta="Token de Iris (iris_pat_)"
                            nombre="token"
                            placeholder="iris_pat_…"
                            :disabled="!puedeConfigurar"
                            class="sm:col-span-2"
                        />
                        <UFormField
                            name="webhook_salida_url"
                            label="Receptor de Iris"
                            description="URL que muestra Iris para los avisos de ArgosIsp"
                            class="sm:col-span-2"
                        >
                            <UInput
                                v-model="form.webhook_salida_url"
                                placeholder="https://iris.isp.gt/api/v1/integraciones/argosisp/webhook/…"
                                autocomplete="off"
                                class="w-full font-mono"
                                data-prueba="receptor-iris"
                            />
                        </UFormField>
                        <CampoSecreto
                            v-model="secretos.webhook_salida_secreto"
                            :guardado="conector?.webhook_salida_secreto ?? null"
                            etiqueta="Secreto del receptor de Iris"
                            nombre="webhook_salida_secreto"
                            :disabled="!puedeConfigurar"
                            class="sm:col-span-2"
                        />

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
                                data-prueba="guardar-iris"
                            />
                        </div>
                    </UForm>
                </section>
            </template>

            <!-- Tokens atk_ para Iris -->
            <section
                class="surface-card flex flex-col gap-4 p-4 sm:p-6"
                aria-labelledby="titulo-tokens-iris"
            >
                <div class="flex flex-wrap items-start justify-between gap-2">
                    <div>
                        <h2
                            id="titulo-tokens-iris"
                            class="flex items-center gap-2 text-base font-semibold text-highlighted"
                        >
                            <UIcon
                                name="i-lucide-key-round"
                                class="size-5"
                            />
                            Token de ArgosIsp para Iris
                        </h2>
                        <p class="text-sm text-muted">
                            Lo que usa Iris para leer y escribir en ArgosIsp como el usuario técnico «Iris». El enlace de conexión lo genera solo.
                        </p>
                    </div>
                    <UButton
                        v-if="puede('iris.generar_token')"
                        label="Generar token"
                        icon="i-lucide-plus"
                        color="neutral"
                        variant="outline"
                        data-prueba="generar-token-iris"
                        @click="abrirToken"
                    />
                </div>
                <ProblemaAlerta
                    v-if="problemaTokens"
                    :problema="problemaTokens"
                    :reintentar="cargarTokens"
                    :reintentando="cargandoTokens"
                />
                <TablaTokensIntegracion
                    v-else
                    :tokens="tokens"
                    :cargando="cargandoTokens"
                    :puede-revocar="puede('iris.revocar_token')"
                    vacio="Todavía no hay tokens para Iris"
                    data-prueba="tabla-tokens-iris"
                    @revocar="pedirRevocar"
                />
            </section>

            <!-- Envíos a Iris -->
            <section
                class="surface-card flex flex-col gap-4 p-4 sm:p-6"
                aria-labelledby="titulo-envios-iris"
                data-prueba="envios-iris"
            >
                <div class="flex flex-wrap items-start justify-between gap-2">
                    <div>
                        <h2
                            id="titulo-envios-iris"
                            class="flex items-center gap-2 text-base font-semibold text-highlighted"
                        >
                            <UIcon
                                name="i-lucide-send"
                                class="size-5"
                            />
                            Envíos recientes
                        </h2>
                        <p class="text-sm text-muted">
                            Avisos de ArgosIsp a Iris. Se reintentan a 1 min, 5 min, 30 min, 2 h y 12 h; después quedan como fallidos.
                        </p>
                    </div>
                    <UButton
                        label="Actualizar"
                        icon="i-lucide-refresh-cw"
                        color="neutral"
                        variant="ghost"
                        :loading="cargandoEnvios"
                        data-prueba="actualizar-envios-iris"
                        @click="cargarEnvios"
                    />
                </div>
                <ProblemaAlerta
                    v-if="problemaEnvios"
                    :problema="problemaEnvios"
                    :reintentar="cargarEnvios"
                    :reintentando="cargandoEnvios"
                />
                <div
                    v-else-if="!resumen"
                    class="flex flex-col gap-3"
                >
                    <USkeleton class="h-16 w-full" />
                    <USkeleton class="h-32 w-full" />
                </div>
                <template v-else>
                    <UAlert
                        v-if="!resumen.destino_configurado"
                        color="neutral"
                        variant="subtle"
                        icon="i-lucide-send-horizontal"
                        title="No se envía nada a Iris"
                        description="Hace falta el conector activo con el receptor de Iris y su secreto."
                        data-prueba="sin-destino-iris"
                    />
                    <dl
                        class="grid grid-cols-2 gap-4 sm:grid-cols-4"
                        data-prueba="resumen-envios-iris"
                    >
                        <DatoFicha
                            etiqueta="Pendientes"
                            :valor="resumen.pendientes"
                        />
                        <DatoFicha
                            etiqueta="Fallidos"
                            :valor="resumen.fallidos"
                        />
                        <DatoFicha
                            etiqueta="Último enviado"
                            :valor="resumen.ultimo_enviado_en ? formatearFechaHora(resumen.ultimo_enviado_en) : null"
                        />
                        <DatoFicha
                            etiqueta="Empresas"
                            :valor="textoAlcanceIris(resumen.alcance)"
                        />
                    </dl>
                    <UAlert
                        v-if="resumen.ultimo_fallo"
                        :color="resumen.ultimo_fallo.estado === 'fallido' ? 'error' : 'warning'"
                        variant="subtle"
                        icon="i-lucide-cloud-alert"
                        :title="`${resumen.ultimo_fallo.estado === 'fallido' ? 'Último fallo' : 'Reintentando'}: ${resumen.ultimo_fallo.evento} (${resumen.ultimo_fallo.intentos} ${resumen.ultimo_fallo.intentos === 1 ? 'intento' : 'intentos'})`"
                        :description="`${resumen.ultimo_fallo.ultimo_error ?? 'Sin detalle del error'} · ${formatearFechaHora(resumen.ultimo_fallo.en)}`"
                        data-prueba="ultimo-fallo-iris"
                    />
                    <UTable
                        :data="envios"
                        :columns="columnasEnvios"
                        :loading="cargandoEnvios"
                        data-prueba="tabla-envios-iris"
                    >
                        <template #evento-cell="{ row }">
                            <div class="flex flex-col">
                                <span class="font-mono text-sm text-highlighted">{{ row.original.evento }}</span>
                                <span class="text-xs text-muted sm:hidden">{{ cuandoEnvio(row.original) }}</span>
                            </div>
                        </template>
                        <template #estado-cell="{ row }">
                            <UBadge
                                :label="ESTADOS_ENVIO_IRIS[row.original.estado].etiqueta"
                                :icon="ESTADOS_ENVIO_IRIS[row.original.estado].icono"
                                :color="ESTADOS_ENVIO_IRIS[row.original.estado].color"
                                variant="subtle"
                                size="sm"
                            />
                        </template>
                        <template #cuando-cell="{ row }">
                            {{ cuandoEnvio(row.original) }}
                        </template>
                        <template #ultimo_error-cell="{ row }">
                            <span class="text-sm text-muted">{{ row.original.ultimo_error ?? '—' }}</span>
                        </template>
                        <template #empty>
                            <UEmpty
                                icon="i-lucide-send"
                                title="Todavía no se envió nada a Iris"
                                variant="naked"
                            />
                        </template>
                    </UTable>
                    <ProblemaAlerta
                        v-if="problemaMas"
                        :problema="problemaMas"
                        :reintentar="cargarMasEnvios"
                        :reintentando="cargandoMas"
                    />
                    <UButton
                        v-else-if="siguienteCursor"
                        label="Ver más"
                        icon="i-lucide-chevrons-down"
                        color="neutral"
                        variant="outline"
                        class="self-center"
                        :loading="cargandoMas"
                        data-prueba="mas-envios-iris"
                        @click="cargarMasEnvios"
                    />
                </template>
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
            title="Generar token para Iris"
            description="Un token nuevo no revoca los anteriores."
            :dismissible="!generandoToken"
        >
            <template #body>
                <UForm
                    id="formulario-token-iris"
                    :schema="esquemaTokenIris"
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
                            placeholder="Iris producción"
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
                        form="formulario-token-iris"
                        label="Generar"
                        icon="i-lucide-key-round"
                        :loading="generandoToken"
                        data-prueba="confirmar-token-iris"
                    />
                </div>
            </template>
        </UModal>

        <ConfirmacionModal
            v-model:open="revocarTokenAbierto"
            titulo="Revocar token de Iris"
            :efecto="`Iris deja de poder leer y escribir en ArgosIsp con «${tokenARevocar?.nombre ?? ''}» de inmediato.`"
            confirmar="Revocar"
            :ejecutar="revocarToken"
            @hecho="alRevocarToken"
        />
    </PanelPagina>
</template>
