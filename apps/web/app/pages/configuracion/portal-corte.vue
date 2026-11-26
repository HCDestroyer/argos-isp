<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { FormSubmitEvent, RadioGroupItem } from '@nuxt/ui'

/**
 * Configuración · Red y portal (tablero OperConfigRed). Tres pestañas en la tarjeta:
 *
 * - **Portal de corte** (`GET`/`PUT /corte/configuracion`, A5): IPv4, IPv6 y puerto a los que el
 *   NAT de los routers manda a los suspendidos, y cómo se suspende la sesión. Una sola para la
 *   instalación. `version` 0 = nunca se guardó. Más la vigencia del código de identificación.
 * - **Caídas y fallas generales** y **Retiro, historial de IP y acceso**: los ajustes de operación
 *   (`GET`/`PUT /ajustes-operacion`, A1, decisiones 17, 19, 22, 28 y 31).
 *
 * «Ajustes para» elige «Todas las empresas» (global) o una empresa: lo de la empresa manda sobre
 * «Todas»; las claves solo globales se ven bloqueadas en una empresa. «Guardar» guarda lo que
 * cambió en las dos APIs.
 */
definePageMeta({ permiso: 'portal_corte.ver' })

useHead({ title: 'Red y portal · ArgosIsp' })

const { puede } = usePermisos()
const toast = useToast()

const config = shallowRef<PortalCorte | null>(null)
const cargando = ref(false)
const problema = ref<Problem | null>(null)

const formulario = useTemplateRef('formulario')
const idFormulario = useId()
const estado = reactive<EntradaPortalCorte>({ portal_v4: '', portal_v6: '', portal_puerto: 80, modo_suspension: 'desconectar' })
const enviando = ref(false)
const problemaGuardar = ref<Problem | null>(null)
/** Datos validados que esperan la confirmación de reescribir los routers. */
const pendiente = shallowRef<SalidaPortalCorte | null>(null)
const confirmar = ref(false)

/* Pestañas y alcance («Ajustes para»). */
type PestanaRed = 'corte' | 'caidas' | 'otros'
const route = useRoute()
const router = useRouter()
const pestanaRed = computed<PestanaRed>({
    get: () => (route.query.pestana === 'caidas' || route.query.pestana === 'otros' ? route.query.pestana : 'corte'),
    set: (valor) => {
        void router.replace({ query: { ...route.query, pestana: valor === 'corte' ? undefined : valor } })
    },
})
const pestanasRed = [
    { label: 'Portal de corte', value: 'corte', icon: 'i-lucide-ban' },
    { label: 'Caídas y fallas generales', value: 'caidas', icon: 'i-lucide-triangle-alert' },
    { label: 'Retiro, historial de IP y acceso', value: 'otros', icon: 'i-lucide-history' },
]
const { empresas: listaEmpresas } = useEmpresaActiva()
/** `null` = «Todas las empresas» (los ajustes globales). */
const ambito = ref<number | null>(null)

const editable = computed(() => puede('portal_corte.configurar') && ambito.value === null)
const sinGuardar = computed(() => config.value?.origen === 'entorno')
const sinCambios = computed(() => config.value !== null && JSON.stringify(entradaPortalCorte(config.value)) === JSON.stringify({ ...estado }))
const ayudaIpv4 = computed(() => (estado.portal_v4.trim() === ''
    ? ayudaIpv4Vacia(config.value?.portal_url ?? null)
    : 'Los routers mandan a los suspendidos a esta IP.'))
/** Cambió algo que reescribe las reglas de corte de los routers (IP o puerto). */
const cambiaRed = computed(() => config.value !== null && (estado.portal_v4.trim() !== (config.value.portal_v4 ?? '')
    || estado.portal_v6.trim() !== (config.value.portal_v6 ?? '') || estado.portal_puerto !== config.value.portal_puerto))
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

/*
 * Lo que acompaña al portal de corte en el tablero OperConfigRed: routers que identifican por
 * código, contraseña inicial del portal y nodos. Cada lectura con su propio error; sin permiso no se
 * pide ni se muestra.
 */
const routersCodigo = shallowRef<RouterNas[] | null>(null)
const problemaRouters = ref<Problem | null>(null)
const contrasena = shallowRef<PortalContrasenaDefecto | null>(null)
const problemaContrasena = ref<Problem | null>(null)
const nodos = shallowRef<NodoPortal[] | null>(null)
const problemaNodos = ref<Problem | null>(null)

async function cargarRouters() {
    const resultado = await useRouters().listar()
    routersCodigo.value = resultado.ok ? resultado.data.data.filter(r => r.corte_identificacion === 'codigo') : null
    problemaRouters.value = resultado.ok ? null : resultado.problema
}

async function cargarContrasena() {
    const resultado = await usePortalContrasena().verDefecto()
    contrasena.value = resultado.ok ? resultado.data : null
    problemaContrasena.value = resultado.ok ? null : resultado.problema
}

async function cargarNodos() {
    const resultado = await useNodosPortal().listar()
    nodos.value = resultado.ok ? resultado.data.data.filter(n => !n.revocado_en) : null
    problemaNodos.value = resultado.ok ? null : resultado.problema
}

/* Ajustes de operación del alcance elegido. */
const verAjustes = computed(() => puede('ajustes_operacion.ver'))
const editaAjustes = computed(() => puede('ajustes_operacion.editar'))
const ajustes = shallowRef<AjustesOperacion | null>(null)
const cargandoAjustes = ref(false)
const problemaAjustes = ref<Problem | null>(null)
const problemaGuardarAjustes = ref<Problem | null>(null)
const guardandoAjustes = ref(false)
const valores = reactive<Record<string, ValorAjusteOperacion>>({})
const formCorteAj = useTemplateRef('formCorteAj')
const formCaidas = useTemplateRef('formCaidas')
const formOtros = useTemplateRef('formOtros')

const definicion = (clave: ClaveAjusteOperacion) => ajustes.value?.definiciones.find(d => d.clave === clave) ?? null
const esquemaAjustes = computed(() => (ajustes.value ? esquemaAjustesOperacion(ajustes.value.definiciones) : esquemaAjustesOperacion([])))

function rellenarAjustes(datos: AjustesOperacion) {
    ajustes.value = datos
    for (const clave of Object.keys(valores)) {
        Reflect.deleteProperty(valores, clave)
    }
    for (const def of datos.definiciones) {
        valores[def.clave] = valorAjuste(def, datos.efectivo[def.clave])
    }
    for (const f of [formCorteAj.value, formCaidas.value, formOtros.value]) {
        f?.clear()
    }
}

async function cargarAjustes() {
    if (!verAjustes.value) {
        return
    }
    cargandoAjustes.value = true
    const pedido = ambito.value
    const r = await useAjustesOperacion().ver(pedido)
    if (pedido !== ambito.value) {
        return
    }
    cargandoAjustes.value = false
    problemaAjustes.value = r.ok ? null : r.problema
    problemaGuardarAjustes.value = null
    if (r.ok) {
        rellenarAjustes(r.data)
    }
    else {
        ajustes.value = null
    }
}

watch(ambito, () => {
    ajustes.value = null
    void cargarAjustes()
})

/** Lo que cambió y se puede guardar en este alcance (en una empresa, solo las claves por empresa). */
const cambiosAj = computed(() => {
    const datos = ajustes.value
    if (!datos || !editaAjustes.value) {
        return {}
    }
    const permitidos = datos.definiciones.filter(d => ambito.value === null || d.por_empresa).map(d => d.clave)
    const cambios = cambiosAjustes(datos.efectivo, valores)
    return Object.fromEntries(Object.entries(cambios).filter(([clave]) => permitidos.includes(clave)))
})
const hayCambiosAj = computed(() => Object.keys(cambiosAj.value).length > 0)
const propio = (clave: string) => ambito.value !== null && ajustes.value !== null && clave in ajustes.value.empresa

function erroresAjustes(problema: Problem) {
    return (problema.errors ?? []).map(e => ({ name: e.field.replace(/^valores\./, ''), message: e.message }))
}

async function enviarAjustes(cambios: ValoresAjustesOperacion, texto: string) {
    guardandoAjustes.value = true
    problemaGuardarAjustes.value = null
    const r = await useAjustesOperacion().guardar(ambito.value, cambios)
    guardandoAjustes.value = false
    if (!r.ok) {
        problemaGuardarAjustes.value = r.problema
        if (r.problema.status === 422) {
            const errores = erroresAjustes(r.problema)
            for (const f of [formCorteAj.value, formCaidas.value, formOtros.value]) {
                f?.setErrors(errores)
            }
        }
        return false
    }
    rellenarAjustes(r.data)
    toast.add({ title: texto, description: ambito.value === null ? 'Para todas las empresas.' : `Solo para ${nombreAmbito.value}.`, icon: 'i-lucide-circle-check', color: 'success' })
    return true
}

function heredar(clave: string) {
    void enviarAjustes({ [clave]: null }, 'Vuelve a usar el ajuste de «Todas»')
}

const nombreAmbito = computed(() => listaEmpresas.value.find(e => e.id === ambito.value)?.nombre_comercial ?? 'todas las empresas')

/** Pestaña donde está una clave (para llevar al usuario al error). */
function pestanaDe(clave: string): PestanaRed {
    return clave.startsWith('caidas.') || clave.startsWith('falla_general.') ? 'caidas' : clave === 'codigo_corte.vigencia_min' ? 'corte' : 'otros'
}

/** «Guardar»: valida los ajustes y guarda lo que cambió del portal y de los ajustes. */
async function guardarTodo() {
    if (hayCambiosAj.value) {
        const validos = await Promise.all([formCorteAj.value, formCaidas.value, formOtros.value].map(f => f?.validate({ silent: true }) ?? true))
        if (validos.some(v => v === false)) {
            const clave = Object.keys(cambiosAj.value)[0]
            const conError = [formCorteAj, formCaidas, formOtros].findIndex(f => f.value?.getErrors().length)
            pestanaRed.value = conError >= 0 ? (['corte', 'caidas', 'otros'] as const)[conError]! : pestanaDe(clave ?? '')
            return
        }
    }
    const portalCambio = editable.value && config.value !== null && (!sinCambios.value || sinGuardar.value)
    if (hayCambiosAj.value) {
        const ok = await enviarAjustes(cambiosAj.value, 'Ajustes guardados')
        if (!ok) {
            return
        }
    }
    if (portalCambio && (!sinCambios.value || sinGuardar.value)) {
        await formulario.value?.submit()
    }
}

function descartar() {
    if (config.value) {
        rellenar(config.value)
    }
    if (ajustes.value) {
        rellenarAjustes(ajustes.value)
    }
}

const ejemploFalla = computed(() => {
    const modo = String(valores['falla_general.modo'] ?? 'porcentaje')
    const umbral = Number(valores['falla_general.umbral'] ?? 0)
    const minimo = Number(valores['falla_general.minimo_servicios'] ?? 0)
    const ventana = Number(valores['falla_general.ventana_min'] ?? 0)
    if (!umbral || !minimo || !ventana) {
        return null
    }
    return { total: 400, caidos: umbralFallaGeneral(400, modo, umbral, minimo), ventana }
})

function reintentarGuardar() {
    void formulario.value?.submit()
}

onMounted(() => {
    void cargar()
    void cargarAjustes()
    if (puede('routers.ver')) {
        void cargarRouters()
    }
    if (puede('empresa.ver')) {
        void cargarContrasena()
    }
    if (puede('nodos_portal.administrar')) {
        void cargarNodos()
    }
})
</script>

<template>
    <ConfiguracionMarco
        id="configuracion-portal-corte"
    >
        <template
            v-if="verAjustes && listaEmpresas.length > 1"
            #alcance
        >
            <div
                class="flex flex-wrap items-center gap-2"
                data-prueba="ajustes-para"
            >
                <span class="text-sm text-muted">Ajustes para</span>
                <UButton
                    label="Todas las empresas"
                    icon="i-lucide-globe"
                    :color="ambito === null ? 'primary' : 'neutral'"
                    :variant="ambito === null ? 'solid' : 'outline'"
                    :aria-pressed="ambito === null"
                    data-ambito="todas"
                    @click="ambito = null"
                />
                <UButton
                    v-for="empresa in listaEmpresas"
                    :key="empresa.id"
                    :label="empresa.nombre_comercial"
                    icon="i-lucide-building"
                    :color="ambito === empresa.id ? 'primary' : 'neutral'"
                    :variant="ambito === empresa.id ? 'solid' : 'outline'"
                    :aria-pressed="ambito === empresa.id"
                    :data-ambito="empresa.id"
                    @click="ambito = empresa.id"
                />
                <span class="text-xs text-muted">Lo que cambies en una empresa manda sobre «Todas»</span>
            </div>
        </template>

        <template
            v-if="verAjustes"
            #cabecera
        >
            <UTabs
                v-model="pestanaRed"
                :items="pestanasRed"
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
                data-prueba="pestanas-red"
            />
        </template>

        <ProblemaAlerta
            v-if="problemaGuardarAjustes && problemaGuardarAjustes.status !== 422"
            :problema="problemaGuardarAjustes"
            :reintentar="guardarTodo"
            :reintentando="guardandoAjustes"
        />

        <!-- Caídas y fallas generales -->
        <div
            v-if="verAjustes"
            v-show="pestanaRed === 'caidas'"
            class="flex flex-col gap-4"
            data-prueba="pestana-caidas"
        >
            <ProblemaAlerta
                v-if="problemaAjustes"
                :problema="problemaAjustes"
                :reintentar="cargarAjustes"
                :reintentando="cargandoAjustes"
            />
            <USkeleton
                v-else-if="!ajustes"
                class="h-56"
            />
            <UForm
                v-else
                ref="formCaidas"
                :schema="esquemaAjustes"
                :state="valores"
                :disabled="guardandoAjustes"
                class="grid items-start gap-4 xl:grid-cols-2"
            >
                <ConfiguracionBloque
                    titulo="Caídas repetidas de un servicio"
                    icono="i-lucide-activity"
                >
                    <template
                        v-for="clave in (['caidas.activo', 'caidas.umbral', 'caidas.ventana_min'] as const)"
                        :key="clave"
                    >
                        <AjusteOperacionFila
                            v-if="definicion(clave)"
                            v-model="valores[clave]!"
                            :definicion="definicion(clave)!"
                            :empresa-id="ambito"
                            :propio="propio(clave)"
                            :editable="editaAjustes"
                            @heredar="heredar(clave)"
                        />
                    </template>
                    <template #pie>
                        De fábrica: 3 caídas en 60 minutos. Si el servicio está en una falla general, no se abre su ticket: va al ticket general.
                    </template>
                </ConfiguracionBloque>
                <ConfiguracionBloque
                    titulo="Falla general"
                    icono="i-lucide-triangle-alert"
                >
                    <template
                        v-for="clave in (['falla_general.activo', 'falla_general.modo', 'falla_general.umbral', 'falla_general.minimo_servicios', 'falla_general.ventana_min'] as const)"
                        :key="clave"
                    >
                        <AjusteOperacionFila
                            v-if="definicion(clave)"
                            v-model="valores[clave]!"
                            :definicion="clave === 'falla_general.umbral' && valores['falla_general.modo'] === 'cantidad' ? { ...definicion(clave)!, descripcion: 'Servicios caídos del router, OLT, PON o zona' } : definicion(clave)!"
                            :empresa-id="ambito"
                            :propio="propio(clave)"
                            :editable="editaAjustes"
                            @heredar="heredar(clave)"
                        />
                    </template>
                    <UAlert
                        v-if="ejemploFalla"
                        color="primary"
                        variant="subtle"
                        icon="i-lucide-info"
                        class="mt-2"
                        :description="`Ejemplo: con un router de ${ejemploFalla.total} servicios, se abre si se caen ${ejemploFalla.caidos} o más en ${ejemploFalla.ventana} ${ejemploFalla.ventana === 1 ? 'minuto' : 'minutos'}.`"
                        data-prueba="ejemplo-falla"
                    />
                </ConfiguracionBloque>
            </UForm>
        </div>

        <!-- Retiro, historial de IP y acceso -->
        <div
            v-if="verAjustes"
            v-show="pestanaRed === 'otros'"
            class="flex flex-col gap-4"
            data-prueba="pestana-otros"
        >
            <ProblemaAlerta
                v-if="problemaAjustes"
                :problema="problemaAjustes"
                :reintentar="cargarAjustes"
                :reintentando="cargandoAjustes"
            />
            <USkeleton
                v-else-if="!ajustes"
                class="h-56"
            />
            <UForm
                v-else
                ref="formOtros"
                :schema="esquemaAjustes"
                :state="valores"
                :disabled="guardandoAjustes"
                class="grid items-start gap-4 xl:grid-cols-2"
            >
                <div class="flex min-w-0 flex-col gap-4">
                    <ConfiguracionBloque
                        titulo="Retiro de servicios"
                        icono="i-lucide-power"
                    >
                        <AjusteOperacionFila
                            v-if="definicion('retiro.orden_iris')"
                            v-model="valores['retiro.orden_iris']!"
                            :definicion="definicion('retiro.orden_iris')!"
                            :empresa-id="ambito"
                            :propio="false"
                            :editable="editaAjustes"
                        />
                    </ConfiguracionBloque>
                    <ConfiguracionBloque
                        titulo="Quién tenía una IP"
                        icono="i-lucide-network"
                    >
                        <AjusteOperacionFila
                            v-if="definicion('ip_historial.retencion_dias')"
                            v-model="valores['ip_historial.retencion_dias']!"
                            :definicion="definicion('ip_historial.retencion_dias')!"
                            :empresa-id="ambito"
                            :propio="false"
                            :editable="editaAjustes"
                        />
                        <template #pie>
                            Argos busca en sus propias sesiones. Lo más viejo lo guarda Horus: la búsqueda te lleva allá.
                        </template>
                    </ConfiguracionBloque>
                </div>
                <ConfiguracionBloque
                    titulo="Acceso al panel"
                    icono="i-lucide-lock"
                >
                    <AjusteOperacionFila
                        v-if="definicion('auth.recuperar_contrasena')"
                        v-model="valores['auth.recuperar_contrasena']!"
                        :definicion="definicion('auth.recuperar_contrasena')!"
                        :empresa-id="ambito"
                        :propio="false"
                        :editable="editaAjustes"
                    />
                </ConfiguracionBloque>
            </UForm>
        </div>

        <ProblemaAlerta
            v-if="pestanaRed === 'corte' && problema"
            :problema="problema"
            :reintentar="cargar"
            :reintentando="cargando"
        />
        <div
            v-else-if="pestanaRed === 'corte' && !config"
            class="flex flex-col gap-3"
        >
            <USkeleton class="h-10" />
            <USkeleton class="h-56" />
        </div>
        <template v-else-if="pestanaRed === 'corte' && config">
            <UAlert
                v-if="sinGuardar"
                color="info"
                variant="subtle"
                icon="i-lucide-server"
                title="Valores iniciales del servidor, todavía no guardados"
                :description="editable ? 'Así funciona hoy. Revísalos y guarda para fijarlos aquí; desde entonces solo se cambian en esta pantalla.' : 'Así funciona hoy. Un administrador puede revisarlos y guardarlos aquí.'"
                data-prueba="portal-corte-sin-guardar"
            />
            <UAlert
                v-if="!editable"
                color="neutral"
                variant="subtle"
                icon="i-lucide-lock"
                :title="ambito === null ? 'Solo lectura' : 'El portal de corte es para todas las empresas'"
                :description="ambito === null ? 'Solo un administrador puede cambiar esta configuración.' : 'Cámbialo en «Todas las empresas». Aquí solo se ajusta la vigencia del código de esta empresa.'"
            />

            <div class="grid gap-4 xl:grid-cols-2">
                <div class="flex min-w-0 flex-col gap-4">
                    <UForm
                        :id="idFormulario"
                        ref="formulario"
                        :schema="esquemaPortalCorte"
                        :state="estado"
                        :disabled="!editable || enviando"
                        class="flex flex-col gap-4"
                        data-prueba="form-portal-corte"
                        @submit="alEnviar"
                    >
                        <ConfiguracionBloque
                            titulo="Portal de corte · a dónde van los suspendidos"
                            icono="i-lucide-ban"
                        >
                            <div class="flex flex-col gap-4 py-2">
                                <div class="grid gap-3 sm:grid-cols-3">
                                    <UFormField
                                        label="IPv4 del portal"
                                        name="portal_v4"
                                        :help="ayudaIpv4"
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
                                        label="IPv6 (opcional)"
                                        name="portal_v6"
                                        help="Vacía: un suspendido pasa a IPv4."
                                    >
                                        <UInput
                                            v-model="estado.portal_v6"
                                            placeholder="2001:db8::20"
                                            autocomplete="off"
                                            class="w-full font-mono"
                                            data-prueba="portal-corte-v6"
                                        />
                                    </UFormField>
                                    <UFormField
                                        label="Puerto"
                                        name="portal_puerto"
                                        required
                                        help="80, u 8088 con el puerto dedicado."
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
                                <UFormField
                                    label="Al suspender un servicio"
                                    name="modo_suspension"
                                    help="Aplica desde la siguiente suspensión; los servicios ya suspendidos siguen como están."
                                >
                                    <URadioGroup
                                        v-model="estado.modo_suspension"
                                        :items="itemsModo"
                                        variant="card"
                                        class="w-full"
                                        :ui="{ fieldset: 'grid gap-2 sm:grid-cols-2' }"
                                        data-prueba="portal-corte-modo"
                                    />
                                </UFormField>
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
                            </div>
                        </ConfiguracionBloque>
                    </UForm>

                    <ConfiguracionBloque
                        titulo="Cómo se identifica al cliente cortado"
                        icono="i-lucide-id-card"
                    >
                        <ConfiguracionFila
                            :etiqueta="CORTE_IDENTIFICACION.ip.etiqueta"
                            :ayuda="CORTE_IDENTIFICACION.ip.descripcion"
                            fuerte
                        >
                            <UIcon
                                :name="CORTE_IDENTIFICACION.ip.icono"
                                class="size-4 text-muted"
                            />
                        </ConfiguracionFila>
                        <ConfiguracionFila
                            :etiqueta="CORTE_IDENTIFICACION.codigo.etiqueta"
                            :ayuda="CORTE_IDENTIFICACION.codigo.descripcion"
                            fuerte
                        >
                            <UIcon
                                :name="CORTE_IDENTIFICACION.codigo.icono"
                                class="size-4 text-muted"
                            />
                        </ConfiguracionFila>
                        <ConfiguracionFila
                            v-if="puede('routers.ver')"
                            etiqueta="Routers que usan código"
                            ayuda="Se elige en la ficha de cada router."
                        >
                            <ProblemaAlerta
                                v-if="problemaRouters"
                                :problema="problemaRouters"
                                :reintentar="cargarRouters"
                            />
                            <span
                                v-else-if="routersCodigo"
                                data-prueba="routers-codigo"
                            >{{ routersCodigo.length ? routersCodigo.map(r => r.nombre).join(' · ') : 'Ninguno' }}</span>
                            <USkeleton
                                v-else
                                class="h-4 w-32"
                            />
                            <UButton
                                label="Cambiar"
                                variant="link"
                                size="sm"
                                class="p-0"
                                to="/routers"
                            />
                        </ConfiguracionFila>
                        <template v-if="verAjustes">
                            <ProblemaAlerta
                                v-if="problemaAjustes"
                                :problema="problemaAjustes"
                                :reintentar="cargarAjustes"
                                :reintentando="cargandoAjustes"
                            />
                            <USkeleton
                                v-else-if="!ajustes"
                                class="h-12 w-full"
                            />
                            <UForm
                                v-else-if="definicion('codigo_corte.vigencia_min')"
                                ref="formCorteAj"
                                :schema="esquemaAjustes"
                                :state="valores"
                                :disabled="guardandoAjustes"
                            >
                                <AjusteOperacionFila
                                    v-model="valores['codigo_corte.vigencia_min']!"
                                    :definicion="definicion('codigo_corte.vigencia_min')!"
                                    :empresa-id="ambito"
                                    :propio="propio('codigo_corte.vigencia_min')"
                                    :editable="editaAjustes"
                                    @heredar="heredar('codigo_corte.vigencia_min')"
                                />
                            </UForm>
                        </template>
                    </ConfiguracionBloque>
                </div>

                <div class="flex min-w-0 flex-col gap-4">
                    <ConfiguracionBloque
                        titulo="Portal del cliente"
                        icono="i-lucide-globe"
                    >
                        <ConfiguracionFila
                            etiqueta="Dirección"
                            :valor="config.portal_url"
                            mono
                        />
                        <ConfiguracionFila
                            v-if="puede('empresa.ver')"
                            etiqueta="Contraseña inicial"
                            ayuda="La que recibe un cliente sin contraseña propia"
                            fuerte
                        >
                            <ProblemaAlerta
                                v-if="problemaContrasena"
                                :problema="problemaContrasena"
                                :reintentar="cargarContrasena"
                            />
                            <UBadge
                                v-else-if="contrasena"
                                :label="contrasena.configurada ? 'Configurada' : 'Sin configurar'"
                                :icon="contrasena.configurada ? 'i-lucide-lock' : 'i-lucide-lock-open'"
                                :color="contrasena.configurada ? 'success' : 'warning'"
                                variant="subtle"
                                size="sm"
                            />
                            <UButton
                                label="Cambiar"
                                variant="link"
                                size="sm"
                                class="p-0"
                                to="/configuracion/portal-contrasena"
                                data-prueba="portal-contrasena-abrir"
                            />
                        </ConfiguracionFila>
                        <ConfiguracionFila
                            etiqueta="Pago en línea"
                            ayuda="Con la pasarela de los proveedores de cobro"
                            fuerte
                        >
                            <UButton
                                v-if="puede('bancos.ver')"
                                label="Abrir"
                                variant="link"
                                size="sm"
                                class="p-0"
                                to="/configuracion/proveedores-cobro"
                            />
                        </ConfiguracionFila>
                        <ConfiguracionFila
                            etiqueta="Promesas desde el portal"
                            ayuda="Según la plantilla de facturación del servicio"
                            fuerte
                        >
                            <UButton
                                v-if="puede('plantillas.ver')"
                                label="Abrir"
                                variant="link"
                                size="sm"
                                class="p-0"
                                to="/plantillas"
                            />
                        </ConfiguracionFila>
                    </ConfiguracionBloque>

                    <ConfiguracionBloque
                        v-if="puede('nodos_portal.administrar')"
                        titulo="Nodos del portal"
                        icono="i-lucide-server"
                        accion="Agregar nodo"
                        accion-a="/configuracion/nodos-portal"
                    >
                        <ProblemaAlerta
                            v-if="problemaNodos"
                            :problema="problemaNodos"
                            :reintentar="cargarNodos"
                        />
                        <template v-else-if="nodos">
                            <ConfiguracionFila
                                v-for="nodo in nodos"
                                :key="nodo.id"
                                :etiqueta="nodo.nombre"
                                :ayuda="nodo.ultimo_uso ? `Último uso ${formatearFechaHora(nodo.ultimo_uso)}` : 'Sin uso todavía'"
                            >
                                <UBadge
                                    label="Activo"
                                    icon="i-lucide-circle-check"
                                    color="success"
                                    variant="subtle"
                                    size="sm"
                                />
                            </ConfiguracionFila>
                            <p
                                v-if="!nodos.length"
                                class="py-2 text-sm text-muted"
                            >
                                Sin nodos remotos: el portal corre en el servidor de Argos.
                            </p>
                        </template>
                        <template #pie>
                            Cada nodo sirve la página de corte cerca de sus routers.
                        </template>
                    </ConfiguracionBloque>

                    <ConfiguracionBloque
                        titulo="Página de corte de cada empresa"
                        icono="i-lucide-building-2"
                        descripcion="Cada empresa decide si su cliente suspendido ve la página de corte de Argos o una propia."
                    >
                        <ConfiguracionFila
                            v-if="puede('empresas.ver')"
                            etiqueta="URL de corte por empresa"
                        >
                            <UButton
                                label="Abrir"
                                variant="link"
                                size="sm"
                                class="p-0"
                                to="/configuracion/empresas"
                                data-prueba="portal-corte-empresas"
                            />
                        </ConfiguracionFila>
                    </ConfiguracionBloque>

                    <ConfiguracionBloque
                        v-if="puede('inventario.configurar')"
                        titulo="Inventario de equipos"
                        icono="i-lucide-hexagon"
                    >
                        <ConfiguracionFila
                            etiqueta="Firma al recibir y lectura de compras con IA"
                        >
                            <UButton
                                label="Abrir"
                                variant="link"
                                size="sm"
                                class="p-0"
                                to="/configuracion/inventario"
                            />
                        </ConfiguracionFila>
                    </ConfiguracionBloque>
                </div>
            </div>
        </template>

        <template
            v-if="config || ajustes"
            #pie
        >
            <span
                class="me-auto flex items-center gap-1.5 text-sm text-muted"
                data-prueba="portal-corte-aviso-routers"
            >
                <UIcon
                    name="i-lucide-triangle-alert"
                    class="size-4 shrink-0 text-warning"
                />
                Cambiar la IP o el puerto reescribe las reglas de corte en todos los routers.
                <template v-if="config?.updated_at && !sinGuardar">
                    <span data-prueba="portal-corte-guardado">Guardado el {{ formatearFechaHora(config.updated_at) }}.</span>
                </template>
            </span>
            <template v-if="editable || editaAjustes">
                <UButton
                    label="Descartar"
                    color="neutral"
                    variant="ghost"
                    :disabled="(sinCambios && !hayCambiosAj) || enviando || guardandoAjustes"
                    @click="descartar"
                />
                <UButton
                    :label="editable && sinGuardar && sinCambios && !hayCambiosAj ? 'Guardar estos valores' : editable && cambiaRed ? 'Guardar y actualizar routers' : 'Guardar'"
                    icon="i-lucide-check"
                    :loading="enviando || guardandoAjustes"
                    :disabled="!(editable && (sinGuardar || !sinCambios)) && !hayCambiosAj"
                    class="glow-brand"
                    data-prueba="portal-corte-guardar"
                    @click="guardarTodo"
                />
            </template>
        </template>

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
                        :icon="ICONOS.cancelar"
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
    </ConfiguracionMarco>
</template>
