<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { FormSubmitEvent, RadioGroupItem, SelectItem, StepperItem } from '@nuxt/ui'

/**
 * Alta de un servicio (`POST /servicios`, `servicios.crear`) en pocos pasos y con valores por
 * defecto: un solo router o un solo plan quedan elegidos, la IPv4 es automática (la API toma la
 * siguiente IP libre de las redes del router), la IPv6 sigue al plan, las credenciales PPP se
 * generan y la plantilla es la primera. El último paso es un resumen con «Cambiar» por grupo.
 *
 * Router sin RADIUS (`modo_seguridad = 'api'`, `utils/modoSeguridad.ts`, `contratos/pppoe-local.md`):
 * PPPoE se admite como secret local en el MikroTik, con su ayuda. Si el router no tiene credenciales
 * de la API, la API responde 422 `pppoe_local_requiere_api` en `router_id`: se avisa antes de enviar
 * y, si llega, se marca el router con el enlace a su ficha.
 *
 * Se usa en la página `/servicios/nuevo` y en un panel lateral de la ficha del cliente
 * (`cliente` dado: no se pide el cliente y no se sale de la ficha).
 */
const props = withDefaults(defineProps<{
    /** Cliente ya elegido (ficha del cliente): el paso «Cliente» no aparece. */
    cliente?: Cliente | null
    /** Id del cliente a cargar (página con `?cliente=`). */
    clienteId?: number
    /** Dentro de un panel lateral: sin la columna de resumen. */
    compacto?: boolean
}>(), {
    cliente: null,
    clienteId: undefined,
    compacto: false,
})

const emit = defineEmits<{
    creado: [servicio: Servicio]
    cancelar: []
}>()

const toast = useToast()
const { puede } = usePermisos()
const routersApi = useRouters()

const clienteFijo = computed(() => props.cliente !== null)
const clienteInicial = props.cliente?.id ?? props.clienteId

const formulario = useTemplateRef('formulario')
const estado = reactive<EntradaServicio>(entradaServicioVacia(clienteInicial))
const claveIdempotencia = nuevaClaveIdempotencia()
const enviando = ref(false)
const problema = ref<Problem | null>(null)
/** El operador escribió su propio usuario PPP: ya no se regenera al cambiar de cliente. */
const usuarioEditado = ref(false)

const cliente = shallowRef<Cliente | null>(props.cliente)
const routers = shallowRef<RouterNas[]>([])
const cargandoRouters = ref(true)
const planes = shallowRef<Plan[]>([])
const redes = shallowRef<RedIpv4[]>([])
const bloques = shallowRef<Ipv6Bloque[]>([])
const plantillas = shallowRef<PlantillaFacturacion[]>([])
const cargandoRouter = ref(false)
const problemaCatalogo = ref<Problem | null>(null)

/*
|--------------------------------------------------------------------------
| Pasos
|--------------------------------------------------------------------------
*/

type IdPaso = 'cliente' | 'conexion' | 'red' | 'instalacion' | 'resumen'

interface Paso extends StepperItem {
    id: IdPaso
    campos: (keyof EntradaServicio)[]
}

const conPppoe = computed(() => estado.tipo_conexion === 'pppoe')

const pasos = computed<Paso[]>(() => [
    ...(clienteFijo.value ? [] : [{ id: 'cliente' as const, title: 'Cliente', icon: 'i-lucide-user', campos: ['cliente_id'] as (keyof EntradaServicio)[] }]),
    { id: 'conexion', title: 'Conexión', description: 'Router, plan y tipo', icon: 'i-lucide-router', campos: ['router_id', 'plan_id', 'tipo_conexion'] },
    {
        id: 'red',
        title: conPppoe.value ? 'Red y PPPoE' : 'Red y equipo',
        description: 'IP, IPv6 y acceso',
        icon: 'i-lucide-network',
        campos: ['asignacion', 'red_id', 'ipv4', 'ipv6_modo', 'ipv6_duid', 'prefijo_delegado_v6', ...(conPppoe.value ? ['user_ppp', 'pass_ppp'] as const : ['mac', 'amarre_ip_mac'] as const)],
    },
    {
        id: 'instalacion',
        title: 'Instalación y cobro',
        description: 'Estado, lugar y plantilla',
        icon: 'i-lucide-receipt-text',
        campos: ['estado_inicial', 'fecha_instalacion', 'direccion', 'referencia', 'coordenadas', 'contacto_nombre', 'contacto_telefono', 'plantilla_facturacion_id', 'costo_override', 'excluir_firewall', ...(conPppoe.value ? ['mac'] as const : [])],
    },
    { id: 'resumen', title: 'Resumen', description: 'Revisa y crea', icon: 'i-lucide-list-checks', campos: [] },
])

const paso = ref(clienteInicial && !clienteFijo.value ? 1 : 0)
/** Paso más lejano alcanzado: los anteriores se pueden revisitar desde el stepper. */
const alcanzado = ref(paso.value)
const itemsStepper = computed(() => pasos.value.map((p, indice) => ({ ...p, value: indice, disabled: indice > alcanzado.value })))
const ultimo = computed(() => pasos.value.length - 1)
const pasoActual = computed(() => pasos.value[paso.value]?.id ?? 'resumen')

function irA(id: IdPaso) {
    const indice = pasos.value.findIndex(p => p.id === id)
    if (indice !== -1) {
        paso.value = indice
    }
}

/*
|--------------------------------------------------------------------------
| Derivados
|--------------------------------------------------------------------------
*/

const router = computed(() => routers.value.find(r => r.id === estado.router_id) ?? null)
const planesActivos = computed(() => planes.value.filter(p => p.activo))
const plan = computed(() => planes.value.find(p => p.id === estado.plan_id) ?? null)
const red = computed(() => redes.value.find(r => r.id === estado.red_id) ?? null)
const plantilla = computed(() => plantillas.value.find(p => p.id === estado.plantilla_facturacion_id) ?? null)
const soloIpv4 = computed(() => plan.value?.dual_stack === 'v4')
/** El router elegido no usa RADIUS: todo por su API REST (PPPoE como secrets locales). */
const routerSinRadius = computed(() => esSinRadius(router.value))
/** PPPoE en un router sin RADIUS y sin credenciales de la API: la API respondería 422. */
const faltanCredencialesApi = computed(() => conPppoe.value && pppoeSinCredencialesApi(router.value))
/** 422 `pppoe_local_requiere_api` de la API (puede llegar aunque el router leído tuviera credenciales). */
const credencialesRechazadas = computed(() => esPppoeLocalRequiereApi(problema.value))

/*
| Multiempresa: el servicio factura con una empresa (NIT). Sugerida como la API: la de la zona del
| cliente > la del router > la empresa activa. El operador puede elegir otra de las suyas. Con una
| sola empresa no se muestra ni se manda (la API usa la única).
*/
const { conSelector: variasEmpresas, empresas: empresasUsuario, empresaId: empresaActiva, nombre: nombreEmpresa } = useEmpresaActiva()
const zonas = shallowRef<Zona[]>([])
const empresaElegida = ref<string | null>(null)
const sugerencia = computed(() => sugerenciaEmpresa({
    zona: zonas.value.find(z => z.id === cliente.value?.zona_id) ?? null,
    router: router.value,
    activa: empresaActiva.value,
}))
const empresaServicio = computed<number | null>(() => (empresaElegida.value ? Number(empresaElegida.value) : sugerencia.value.empresaId))
const itemsEmpresa = computed(() => empresasUsuario.value.map(e => ({ label: e.nombre_comercial, value: String(e.id), description: e.nit ? `NIT ${e.nit}` : undefined })))

/** Nace «pendiente de instalación» (`estado_inicial`): no navega ni factura hasta activarlo. */
const nacePendiente = computed({
    get: () => estado.estado_inicial === 'pendiente_instalacion',
    set: (valor: boolean) => {
        estado.estado_inicial = valor ? 'pendiente_instalacion' : 'activo'
    },
})

/** El esquema base más la regla que necesita las redes cargadas: la IP fija cae en la red elegida. */
const esquema = computed(() => esquemaServicio.superRefine((datos, ctx) => {
    const elegida = redes.value.find(r => r.id === datos.red_id)
    if (datos.asignacion === 'fija' && elegida && PATRON_IPV4.test(datos.ipv4) && !ipEnCidr(datos.ipv4, elegida.cidr)) {
        ctx.addIssue({ code: 'custom', path: ['ipv4'], message: `Escribe una IP dentro de ${elegida.cidr} o elige otra red` })
    }
    const elegido = planes.value.find(p => p.id === datos.plan_id)
    if (datos.tipo_conexion !== 'pppoe' && elegido?.dual_stack === 'v6') {
        ctx.addIssue({ code: 'custom', path: ['tipo_conexion'], message: 'El plan es solo IPv6: elige PPPoE u otro plan con IPv4' })
    }
    // Espejo de `exigirPppoeAdmitido` (A2): 422 `pppoe_local_requiere_api` en `router_id`.
    const elegidoRouter = routers.value.find(r => r.id === datos.router_id)
    if (datos.tipo_conexion === 'pppoe' && pppoeSinCredencialesApi(elegidoRouter)) {
        ctx.addIssue({ code: 'custom', path: ['router_id'], message: MENSAJE_PPPOE_LOCAL_REQUIERE_API })
    }
}))

const itemsTipoConexion = computed<RadioGroupItem[]>(() => (Object.keys(TIPOS_CONEXION) as TipoConexion[]).map(tipo => ({
    label: TIPOS_CONEXION[tipo].etiqueta,
    value: tipo,
    description: tipo === 'pppoe' && routerSinRadius.value ? AYUDA_PPPOE_SIN_RADIUS : TIPOS_CONEXION[tipo].descripcion,
})))

const itemsRouter = computed<RadioGroupItem[]>(() => routers.value.map(r => ({
    label: r.nombre,
    value: r.id,
    description: `${r.host} · ${CONTROLES_VELOCIDAD[r.control_velocidad ?? (r.modo_velocidad === 'pcq' ? 'arbol_pcq' : 'simple')].etiqueta.toLowerCase()}${esSinRadius(r) ? ` · sin RADIUS${tieneCredencialesApi(r) ? '' : ' (sin credenciales de la API)'}` : ''}`,
})))

function textoPila(p: Plan): string {
    return p.dual_stack === 'ambos' ? 'IPv4 + IPv6' : p.dual_stack === 'v4' ? 'solo IPv4' : 'solo IPv6'
}

const itemsPlan = computed<RadioGroupItem[]>(() => planesActivos.value.map(p => ({
    label: `${p.nombre} · ${formatearQuetzales(p.precio)}`,
    value: p.id,
    description: `${formatearVelocidad(p.bajada_kbps)} ↓ / ${formatearVelocidad(p.subida_kbps)} ↑ · ${textoPila(p)}${p.global ? '' : ' · plan de este router'}`,
})))

const itemsAsignacion: RadioGroupItem[] = [
    { label: 'Automática', value: 'automatica', description: 'Se asigna la siguiente IP libre de las redes del router al crear el servicio.' },
    { label: 'IP fija', value: 'fija', description: 'Para IP pública o reglas por IP: la escribes tú.' },
]

function etiquetaRed(r: RedIpv4): string {
    return `${r.cidr} · ${r.tipo === 'pool' ? 'pool' : 'estática'}`
}

const itemsRed = computed<SelectItem[]>(() => redes.value.map(r => ({ label: etiquetaRed(r), value: r.id })))

/** Asignación automática: red opcional (`red_ipv4_id`); "cualquiera" = la API elige. */
const CUALQUIER_RED = 'cualquiera'
const itemsRedAutomatica = computed<SelectItem[]>(() => [
    { label: 'Cualquier red del router', value: CUALQUIER_RED },
    ...redes.value.map(r => ({ label: etiquetaRed(r), value: String(r.id) })),
])
const redAutomatica = computed({
    get: () => (estado.red_id === undefined ? CUALQUIER_RED : String(estado.red_id)),
    set: (valor: string) => {
        estado.red_id = valor === CUALQUIER_RED ? undefined : Number(valor)
    },
})

const ETIQUETAS_IPV6: Record<ModoIpv6, string> = {
    radius_servicio: 'Automática por servicio',
    radius_pool: 'Pool del router',
    duid: 'DHCPv6-PD por DUID',
    estatico: 'Prefijo estático',
    ninguno: 'Sin IPv6',
}

const itemsIpv6 = computed<RadioGroupItem[]>(() => {
    const delegado = plan.value ? `/${plan.value.tamano_prefijo_delegado}` : ''
    return [
        { label: ETIQUETAS_IPV6.radius_servicio, value: 'radius_servicio', description: conPppoe.value ? `Recomendado. ArgosIsp le da un /64 para el enlace y un ${delegado || 'prefijo'} para su red, desde los pools del router.` : 'Solo con PPPoE.', disabled: soloIpv4.value || !conPppoe.value },
        { label: ETIQUETAS_IPV6.radius_pool, value: 'radius_pool', description: conPppoe.value ? 'El router reparte desde su propio pool.' : 'Solo con PPPoE.', disabled: soloIpv4.value || !conPppoe.value },
        { label: ETIQUETAS_IPV6.duid, value: 'duid', description: 'Prefijo fijo para un equipo identificado por su DUID.', disabled: soloIpv4.value },
        { label: ETIQUETAS_IPV6.estatico, value: 'estatico', description: 'Prefijo delegado fijo, escrito a mano.', disabled: soloIpv4.value },
        { label: ETIQUETAS_IPV6.ninguno, value: 'ninguno', description: 'Solo IPv4.' },
    ]
})

/** IPv6 abierta para cambiar el modo (por defecto se muestra solo el resumen). */
const cambiarIpv6 = ref(false)

const itemsPlantilla = computed<SelectItem[]>(() => [
    { label: 'Sin plantilla', value: null },
    ...plantillas.value.map(p => ({ label: p.nombre, value: p.id })),
])

/** Precio especial o excepción de firewall: el grupo de excepciones nace abierto si hay alguna. */
const conExcepciones = ref(false)

const precioEfectivo = computed(() => estado.costo_override?.trim() || plan.value?.precio || null)

const textoIpv4 = computed(() => (estado.asignacion === 'fija' ? (estado.ipv4 || '—') : (red.value ? `Automática de ${red.value.cidr}` : 'Automática (siguiente IP libre)')))

const textoIpv6 = computed(() => {
    if (estado.ipv6_modo === 'radius_servicio' && plan.value) {
        return `/64 de enlace + /${plan.value.tamano_prefijo_delegado} delegado`
    }
    return ETIQUETAS_IPV6[estado.ipv6_modo]
})

/*
|--------------------------------------------------------------------------
| Carga de catálogos
|--------------------------------------------------------------------------
*/

async function cargarCliente(id: number) {
    const resultado = puede('clientes.ver') ? await useClientes().ver(id) : { ok: false as const, problema: problemaSinPermiso('clientes.ver') }
    if (resultado.ok) {
        alElegirCliente(resultado.data)
    }
    else {
        problemaCatalogo.value = resultado.problema
        paso.value = 0
        alcanzado.value = 0
    }
}

function alElegirCliente(elegido: Cliente) {
    cliente.value = elegido
    estado.cliente_id = elegido.id
    if (!usuarioEditado.value) {
        estado.user_ppp = generarUsuarioPpp(elegido.nombre)
    }
    estado.direccion ||= elegido.direccion ?? ''
    estado.referencia ||= elegido.referencia ?? ''
    estado.coordenadas ||= elegido.coordenadas ?? ''
}

async function alCambiarRouter(id: number) {
    estado.plan_id = 0
    estado.red_id = undefined
    planes.value = []
    redes.value = []
    bloques.value = []
    if (!id) {
        return
    }
    cargandoRouter.value = true
    const [resultadoPlanes, resultadoRedes, resultadoBloques] = await Promise.all([
        routersApi.planes(id),
        puede('redes.ver') ? routersApi.redesIpv4(id) : null,
        puede('ipv6.ver') ? routersApi.ipv6Bloques(id) : null,
    ])
    cargandoRouter.value = false
    if (estado.router_id !== id) {
        return
    }
    if (resultadoPlanes.ok) {
        planes.value = resultadoPlanes.data
        // Un solo plan disponible: queda elegido.
        const activos = resultadoPlanes.data.filter(p => p.activo)
        if (activos.length === 1 && activos[0]) {
            estado.plan_id = activos[0].id
        }
    }
    else {
        problemaCatalogo.value = resultadoPlanes.problema
    }
    redes.value = resultadoRedes?.ok ? resultadoRedes.data : []
    bloques.value = resultadoBloques?.ok ? resultadoBloques.data : []
}

watch(() => estado.router_id, alCambiarRouter)

watch(soloIpv4, (valor) => {
    if (valor) {
        estado.ipv6_modo = 'ninguno'
    }
    else if (estado.ipv6_modo === 'ninguno' && conPppoe.value) {
        estado.ipv6_modo = 'radius_servicio'
    }
})

// Sin PPPoE no hay RADIUS: el modo IPv6 por RADIUS pasa a "Sin IPv6"; con PPPoE no hay amarre.
watch(() => estado.tipo_conexion, (tipo) => {
    if (tipo !== 'pppoe' && modoIpv6PorRadius(estado.ipv6_modo)) {
        estado.ipv6_modo = 'ninguno'
    }
    if (tipo === 'pppoe') {
        estado.amarre_ip_mac = false
        if (estado.ipv6_modo === 'ninguno' && !soloIpv4.value) {
            estado.ipv6_modo = 'radius_servicio'
        }
    }
})

onMounted(async () => {
    if (props.cliente) {
        alElegirCliente(props.cliente)
    }
    const [resultadoRouters, resultadoPlantillas, resultadoZonas] = await Promise.all([
        routersApi.listar({ activo: true }),
        puede('plantillas.ver') ? usePlantillas().listar() : null,
        variasEmpresas.value && puede('zonas.ver') ? useZonas().listar() : null,
        clienteInicial && !props.cliente ? cargarCliente(clienteInicial) : null,
    ])
    cargandoRouters.value = false
    if (resultadoZonas?.ok) {
        zonas.value = resultadoZonas.data
    }
    if (resultadoRouters.ok) {
        routers.value = resultadoRouters.data.data
        // Un solo router: queda elegido (y con él sus planes).
        if (routers.value.length === 1 && routers.value[0] && !estado.router_id) {
            estado.router_id = routers.value[0].id
        }
    }
    else {
        problemaCatalogo.value = resultadoRouters.problema
    }
    if (resultadoPlantillas?.ok) {
        plantillas.value = resultadoPlantillas.data
        estado.plantilla_facturacion_id ??= resultadoPlantillas.data[0]?.id ?? null
    }
})

/*
|--------------------------------------------------------------------------
| Navegación y envío
|--------------------------------------------------------------------------
*/

async function siguiente() {
    const campos = pasos.value[paso.value]?.campos ?? []
    const valido = campos.length === 0 || await formulario.value?.validate({ name: campos, silent: true })
    if (valido === false) {
        return
    }
    paso.value = Math.min(paso.value + 1, ultimo.value)
    alcanzado.value = Math.max(alcanzado.value, paso.value)
}

function anterior() {
    paso.value = Math.max(paso.value - 1, 0)
}

function regenerarUsuario() {
    usuarioEditado.value = false
    estado.user_ppp = generarUsuarioPpp(cliente.value?.nombre ?? '')
}

function regenerarClave() {
    estado.pass_ppp = generarClavePpp()
}

async function copiar(texto: string, que: string) {
    try {
        await navigator.clipboard.writeText(texto)
        toast.add({ title: `${que} copiado`, color: 'neutral', icon: 'i-lucide-clipboard-check' })
    }
    catch {
        toast.add({ title: 'No se pudo copiar', color: 'warning' })
    }
}

/** Primer paso que contiene alguno de los campos con error (para un 422 de la API). */
function pasoDeCampo(campo: string): number {
    const indice = pasos.value.findIndex(p => p.campos.includes(campo as keyof EntradaServicio))
    return indice === -1 ? ultimo.value : indice
}

async function alEnviar(evento: FormSubmitEvent<SalidaServicio>) {
    enviando.value = true
    problema.value = null
    const cuerpo = cuerpoServicio(evento.data, { omitirPlantilla: !puede('plantillas.ver') })
    if (variasEmpresas.value && empresaServicio.value !== null) {
        cuerpo.empresa_id = empresaServicio.value
    }
    const resultado = await useServicios().crear(cuerpo, claveIdempotencia)
    enviando.value = false
    if (resultado.ok) {
        toast.add({
            title: esPendienteInstalacion(resultado.data) ? 'Servicio creado, pendiente de instalación' : 'Servicio creado',
            description: `${TIPOS_CONEXION[tipoConexionDe(resultado.data)].corta} · ${etiquetaServicio(resultado.data)}${resultado.data.user_ppp && resultado.data.ipv4 ? ` · ${resultado.data.ipv4}` : ''}`,
            color: 'success',
            icon: 'i-lucide-circle-check',
        })
        avisarAdvertencias(toast, resultado.data.warnings, 'Servicio creado con advertencias')
        emit('creado', resultado.data)
        return
    }
    problema.value = resultado.problema
    if (resultado.problema.status === 422) {
        const errores = erroresDeFormulario(resultado.problema)
        formulario.value?.setErrors(errores)
        const primero = errores.find(error => error.name)?.name
        if (primero) {
            paso.value = pasoDeCampo(primero)
        }
    }
}
</script>

<template>
    <UForm
        ref="formulario"
        :schema="esquema"
        :state="estado"
        :validate-on="['input']"
        class="flex w-full flex-col gap-6"
        data-prueba="alta-servicio"
        @submit="alEnviar"
    >
        <UStepper
            v-model="paso"
            :items="itemsStepper"
            size="sm"
            class="w-full"
            :ui="{
                title: 'hidden md:block',
                description: compacto ? 'hidden' : 'hidden lg:block',
            }"
        />

        <ProblemaAlerta
            v-if="problemaCatalogo"
            :problema="problemaCatalogo"
        />
        <ProblemaAlerta
            v-if="problema && problema.status !== 422"
            :problema="problema"
        />
        <PppoeLocalSinApiAlerta
            v-else-if="credencialesRechazadas"
            :router-id="estado.router_id || null"
            :detalle="problema?.detail ?? null"
        />
        <UAlert
            v-else-if="problema"
            color="error"
            variant="subtle"
            icon="i-lucide-circle-alert"
            title="Hay datos por corregir"
            description="Corrige los campos marcados en rojo y vuelve a crear el servicio."
        />

        <div
            class="grid gap-6"
            :class="compacto ? '' : 'lg:grid-cols-[minmax(0,1fr)_18rem] lg:items-start'"
        >
            <UPageCard
                :title="pasos[paso]?.title"
                :icon="pasos[paso]?.icon"
                variant="subtle"
            >
                <!-- Cliente -->
                <div
                    v-show="pasoActual === 'cliente'"
                    class="flex flex-col gap-4"
                >
                    <UFormField
                        name="cliente_id"
                        label="Cliente"
                        help="Busca por nombre, NIT, teléfono, usuario PPP o IP."
                        required
                    >
                        <ClienteSelector
                            v-model="estado.cliente_id"
                            :seleccionado="cliente"
                            @elegido="alElegirCliente"
                        />
                    </UFormField>
                    <p
                        v-if="cliente"
                        class="text-sm text-muted"
                    >
                        {{ cliente.direccion ?? 'Sin dirección' }} · {{ cliente.telefono ?? 'sin teléfono' }}
                    </p>
                </div>

                <!-- Conexión: router, plan, tipo y empresa -->
                <div
                    v-show="pasoActual === 'conexion'"
                    class="flex flex-col gap-6"
                >
                    <UFormField
                        name="router_id"
                        label="Router"
                        help="El router donde se conecta el cliente: define los planes, las redes y los pools disponibles."
                        required
                    >
                        <div
                            v-if="cargandoRouters"
                            class="grid gap-2 sm:grid-cols-2"
                        >
                            <USkeleton
                                v-for="n in 2"
                                :key="n"
                                class="h-14 w-full"
                            />
                        </div>
                        <UEmpty
                            v-else-if="!itemsRouter.length && !problemaCatalogo"
                            icon="i-lucide-router"
                            title="No hay routers activos"
                            description="Registra un router en Red → Routers para poder dar de alta servicios."
                            variant="naked"
                        />
                        <URadioGroup
                            v-else
                            v-model="estado.router_id"
                            :items="itemsRouter"
                            variant="card"
                            class="w-full"
                            :ui="{ fieldset: compacto ? 'grid gap-2' : 'grid gap-2 sm:grid-cols-2' }"
                        />
                    </UFormField>

                    <UFormField
                        v-if="estado.router_id"
                        name="plan_id"
                        label="Plan"
                        help="Solo aparecen los planes disponibles en el router elegido."
                        required
                    >
                        <div
                            v-if="cargandoRouter"
                            class="flex flex-col gap-2"
                        >
                            <USkeleton
                                v-for="n in 3"
                                :key="n"
                                class="h-14 w-full"
                            />
                        </div>
                        <UEmpty
                            v-else-if="!itemsPlan.length"
                            icon="i-lucide-gauge"
                            title="Este router no tiene planes disponibles"
                            description="Agrega el plan al router en Red → Planes, o elige otro router."
                            variant="naked"
                        />
                        <URadioGroup
                            v-else
                            v-model="estado.plan_id"
                            :items="itemsPlan"
                            variant="card"
                            class="w-full"
                            :ui="{ fieldset: 'grid gap-2' }"
                        />
                    </UFormField>

                    <UAlert
                        v-if="routerSinRadius"
                        color="info"
                        variant="subtle"
                        icon="i-lucide-plug"
                        :title="`${router?.nombre ?? 'El router'} no usa RADIUS`"
                        description="Argos configura, limita y corta cada servicio por la API de RouterOS. PPPoE va como secret en el MikroTik: sin consumo de datos y los cambios rigen al reconectar."
                        data-prueba="router-sin-radius"
                    />
                    <PppoeLocalSinApiAlerta
                        v-if="faltanCredencialesApi && !credencialesRechazadas"
                        :router-id="estado.router_id || null"
                    />
                    <UFormField
                        name="tipo_conexion"
                        label="Tipo de conexión"
                        :help="routerSinRadius ? (conPppoe ? AYUDA_PPPOE_SIN_RADIUS : 'Sin PPPoE el router identifica al cliente por su IP (y su MAC con DHCP fija).') : 'PPPoE es lo habitual. Sin PPPoE el router identifica al cliente por su IP.'"
                        required
                    >
                        <URadioGroup
                            v-model="estado.tipo_conexion"
                            :items="itemsTipoConexion"
                            variant="card"
                            class="w-full"
                            :ui="{ fieldset: compacto ? 'grid gap-2' : 'grid gap-2 sm:grid-cols-3' }"
                            data-prueba="tipo-conexion"
                        />
                    </UFormField>

                    <UFormField
                        v-if="variasEmpresas"
                        name="empresa_id"
                        label="Empresa que factura"
                        :help="sugerencia.motivo && !empresaElegida ? `Sugerida ${sugerencia.motivo}.` : 'Las facturas de este servicio salen con el NIT de esta empresa.'"
                    >
                        <USelect
                            :model-value="empresaServicio === null ? undefined : String(empresaServicio)"
                            :items="itemsEmpresa"
                            placeholder="Elige la empresa"
                            class="w-full sm:max-w-sm"
                            data-prueba="empresa-servicio-nuevo"
                            @update:model-value="valor => empresaElegida = valor ? String(valor) : null"
                        />
                    </UFormField>
                </div>

                <!-- Red y acceso: IPv4, IPv6 y PPPoE o equipo -->
                <div
                    v-show="pasoActual === 'red'"
                    class="flex flex-col gap-6"
                >
                    <section class="flex flex-col gap-4">
                        <h3 class="text-sm font-semibold text-highlighted">
                            IPv4
                        </h3>
                        <UAlert
                            v-if="!conPppoe"
                            color="neutral"
                            variant="subtle"
                            icon="i-lucide-info"
                            :title="`${TIPOS_CONEXION[estado.tipo_conexion].etiqueta}: la IPv4 es obligatoria`"
                            description="Automática de una red del router o fija. Si el router no tiene redes IPv4, regístralas primero en Red → Routers."
                        />
                        <UFormField
                            name="asignacion"
                            label="Asignación"
                        >
                            <URadioGroup
                                v-model="estado.asignacion"
                                :items="itemsAsignacion"
                                variant="card"
                                class="w-full"
                                :ui="{ fieldset: compacto ? 'grid gap-2' : 'grid gap-2 sm:grid-cols-2' }"
                            />
                        </UFormField>

                        <div
                            v-if="estado.asignacion === 'fija'"
                            class="grid gap-4 sm:grid-cols-2"
                        >
                            <UFormField
                                name="red_id"
                                label="Red"
                                help="La red del router a la que pertenece la IP."
                                required
                            >
                                <USelect
                                    v-model="estado.red_id"
                                    :items="itemsRed"
                                    placeholder="Elige la red"
                                    class="w-full"
                                />
                            </UFormField>
                            <UFormField
                                name="ipv4"
                                label="IP fija"
                                :help="red ? `Dentro de ${red.cidr}.` : 'Elige primero la red.'"
                                required
                            >
                                <UInput
                                    v-model="estado.ipv4"
                                    inputmode="decimal"
                                    placeholder="100.64.10.50"
                                    class="w-full font-mono"
                                />
                            </UFormField>
                        </div>

                        <div
                            v-else
                            class="flex flex-col gap-2"
                        >
                            <UFormField
                                v-if="redes.length > 1"
                                name="red_id"
                                label="Red"
                                hint="Opcional"
                                help="Sin elegir, se toma la siguiente IP libre de cualquier red del router."
                                class="sm:max-w-sm"
                            >
                                <USelect
                                    v-model="redAutomatica"
                                    :items="itemsRedAutomatica"
                                    class="w-full"
                                    aria-label="Red de la que asignar la IP"
                                />
                            </UFormField>
                            <div class="flex flex-wrap items-center gap-2 text-sm text-muted">
                                <span>Redes de {{ router?.nombre ?? 'el router' }}:</span>
                                <UBadge
                                    v-for="r in redes"
                                    :key="r.id"
                                    :label="etiquetaRed(r)"
                                    color="neutral"
                                    variant="outline"
                                    class="font-mono"
                                />
                                <span v-if="!redes.length">{{ puede('redes.ver') ? 'el router no tiene redes IPv4 registradas.' : 'no tienes permiso para verlas.' }}</span>
                            </div>
                        </div>
                    </section>

                    <USeparator />

                    <section
                        class="flex flex-col gap-4"
                        data-prueba="alta-ipv6"
                    >
                        <div class="flex flex-wrap items-center justify-between gap-2">
                            <h3 class="text-sm font-semibold text-highlighted">
                                IPv6
                            </h3>
                            <UButton
                                v-if="!soloIpv4"
                                :label="cambiarIpv6 ? 'Usar lo recomendado' : 'Cambiar'"
                                :icon="cambiarIpv6 ? 'i-lucide-undo-2' : 'i-lucide-pencil'"
                                color="neutral"
                                variant="ghost"
                                size="xs"
                                data-prueba="cambiar-ipv6"
                                @click="cambiarIpv6 = !cambiarIpv6; if (!cambiarIpv6) estado.ipv6_modo = conPppoe ? 'radius_servicio' : 'ninguno'"
                            />
                        </div>
                        <p
                            v-if="soloIpv4"
                            class="text-sm text-muted"
                        >
                            {{ plan?.nombre ?? 'El plan' }} es solo IPv4: el servicio no recibe IPv6.
                        </p>
                        <template v-else-if="!cambiarIpv6">
                            <p class="text-sm">
                                <span class="font-medium text-highlighted">{{ ETIQUETAS_IPV6[estado.ipv6_modo] }}.</span>
                                <span
                                    v-if="estado.ipv6_modo === 'radius_servicio'"
                                    class="text-muted"
                                > Al conectarse recibe un /64 para el enlace con el router y un /{{ plan?.tamano_prefijo_delegado ?? 56 }} para su red, tomados de los pools IPv6 de {{ router?.nombre ?? 'el router' }}.</span>
                                <span
                                    v-else-if="estado.ipv6_modo === 'ninguno'"
                                    class="text-muted"
                                > Sin PPPoE la IPv6 automática no está disponible; usa «Cambiar» para un prefijo fijo.</span>
                            </p>
                            <UAlert
                                v-if="estado.ipv6_modo === 'radius_servicio' && !bloques.length && puede('ipv6.ver') && estado.router_id"
                                color="warning"
                                variant="subtle"
                                icon="i-lucide-triangle-alert"
                                title="El router no tiene bloques IPv6"
                                description="El servicio funcionará solo con IPv4 hasta que registres un bloque y sus pools en Red → Routers."
                            />
                        </template>
                        <template v-else>
                            <UFormField
                                name="ipv6_modo"
                                label="Modo IPv6"
                            >
                                <URadioGroup
                                    v-model="estado.ipv6_modo"
                                    :items="itemsIpv6"
                                    variant="card"
                                    class="w-full"
                                    :ui="{ fieldset: 'grid gap-2' }"
                                />
                            </UFormField>
                            <UFormField
                                v-if="estado.ipv6_modo === 'duid'"
                                name="ipv6_duid"
                                label="DUID del equipo"
                                help="Identifica al router del cliente en DHCPv6; está en la configuración del equipo."
                                required
                            >
                                <UInput
                                    v-model="estado.ipv6_duid"
                                    placeholder="00:03:00:01:4c:5e:0c:12:34:56"
                                    class="w-full font-mono"
                                />
                            </UFormField>
                            <UFormField
                                v-if="estado.ipv6_modo === 'estatico'"
                                name="prefijo_delegado_v6"
                                label="Prefijo delegado"
                                help="El prefijo que usará la red del cliente."
                                required
                            >
                                <UInput
                                    v-model="estado.prefijo_delegado_v6"
                                    placeholder="2803:d100:1000:100::/56"
                                    class="w-full font-mono"
                                />
                            </UFormField>
                        </template>
                    </section>

                    <USeparator />

                    <section
                        v-if="conPppoe"
                        class="flex flex-col gap-4"
                    >
                        <h3 class="text-sm font-semibold text-highlighted">
                            Credenciales PPPoE
                        </h3>
                        <div class="grid gap-4 sm:grid-cols-2">
                            <UFormField
                                name="user_ppp"
                                label="Usuario PPP"
                                help="Generado a partir del nombre; puedes cambiarlo. Se configura en el equipo del cliente."
                                required
                            >
                                <UFieldGroup class="w-full">
                                    <UInput
                                        v-model="estado.user_ppp"
                                        autocomplete="off"
                                        class="w-full font-mono"
                                        @update:model-value="usuarioEditado = true"
                                    />
                                    <UButton
                                        icon="i-lucide-refresh-cw"
                                        color="neutral"
                                        variant="outline"
                                        aria-label="Generar otro usuario"
                                        @click="regenerarUsuario"
                                    />
                                </UFieldGroup>
                            </UFormField>

                            <UFormField
                                name="pass_ppp"
                                label="Contraseña PPP"
                                help="Visible para dictarla en la instalación."
                                required
                            >
                                <UFieldGroup class="w-full">
                                    <UInput
                                        v-model="estado.pass_ppp"
                                        autocomplete="off"
                                        class="w-full font-mono"
                                    />
                                    <UButton
                                        icon="i-lucide-refresh-cw"
                                        color="neutral"
                                        variant="outline"
                                        aria-label="Generar otra contraseña"
                                        @click="regenerarClave"
                                    />
                                    <UButton
                                        icon="i-lucide-copy"
                                        color="neutral"
                                        variant="outline"
                                        aria-label="Copiar contraseña"
                                        @click="copiar(estado.pass_ppp, 'Contraseña')"
                                    />
                                </UFieldGroup>
                            </UFormField>
                        </div>
                    </section>

                    <section
                        v-else
                        class="flex flex-col gap-4"
                        data-prueba="paso-equipo"
                    >
                        <h3 class="text-sm font-semibold text-highlighted">
                            Equipo del cliente
                        </h3>
                        <p class="text-sm text-muted">
                            Sin PPPoE no hay usuario ni contraseña: el router identifica al cliente por su IP{{ estado.tipo_conexion === 'dhcp_fija' ? ' y su MAC' : '' }}.
                        </p>
                        <div class="grid gap-4 sm:grid-cols-2">
                            <UFormField
                                name="mac"
                                label="MAC del equipo"
                                :required="estado.tipo_conexion === 'dhcp_fija' || estado.amarre_ip_mac"
                                :help="estado.tipo_conexion === 'dhcp_fija' ? 'El lease estático del router se crea con esta MAC.' : 'Obligatoria si amarras la IP a la MAC.'"
                            >
                                <UInput
                                    v-model="estado.mac"
                                    placeholder="4C:5E:0C:12:34:56"
                                    class="w-full font-mono"
                                    data-prueba="mac-wisp"
                                />
                            </UFormField>
                            <UFormField
                                name="amarre_ip_mac"
                                label="Amarre IP-MAC"
                                help="ARP estático en el router: solo esa MAC puede usar la IP."
                            >
                                <UCheckbox
                                    v-model="estado.amarre_ip_mac"
                                    label="Amarrar la IP a la MAC"
                                    data-prueba="amarre-ip-mac"
                                />
                            </UFormField>
                        </div>
                    </section>
                </div>

                <!-- Instalación y cobro -->
                <div
                    v-show="pasoActual === 'instalacion'"
                    class="flex flex-col gap-6"
                >
                    <UFormField
                        name="estado_inicial"
                        :help="nacePendiente
                            ? 'Queda con usuario PPPoE, IP y plan para configurar el equipo, sin navegar ni facturar. La facturación arranca al usar «Activar instalación» en la ficha del servicio.'
                            : 'El servicio nace activo: navega en cuanto el equipo se conecte y se factura desde hoy.'"
                    >
                        <USwitch
                            v-model="nacePendiente"
                            label="Pendiente de instalación"
                            description="Actívalo si el técnico todavía no ha instalado el equipo."
                            data-prueba="nace-pendiente"
                        />
                    </UFormField>

                    <div class="grid gap-4 sm:grid-cols-2">
                        <UFormField
                            name="fecha_instalacion"
                            label="Fecha de instalación"
                            hint="Opcional"
                            help="Con ciclo de aniversario, la facturación toma este día."
                        >
                            <UInput
                                v-model="estado.fecha_instalacion"
                                type="date"
                                class="w-full"
                            />
                        </UFormField>
                        <UFormField
                            v-if="conPppoe"
                            name="mac"
                            label="MAC del equipo"
                            hint="Opcional"
                        >
                            <UInput
                                v-model="estado.mac"
                                placeholder="4C:5E:0C:12:34:56"
                                class="w-full font-mono"
                            />
                        </UFormField>
                    </div>

                    <section
                        class="flex flex-col gap-4"
                        data-prueba="alta-ubicacion-contacto"
                    >
                        <h3 class="text-sm font-semibold text-highlighted">
                            Ubicación y contacto en sitio
                        </h3>
                        <div class="grid gap-4 sm:grid-cols-2">
                            <UFormField
                                name="direccion"
                                label="Dirección de instalación"
                                help="Por defecto, la del cliente."
                                class="sm:col-span-2"
                            >
                                <UInput
                                    v-model="estado.direccion"
                                    class="w-full"
                                />
                            </UFormField>
                            <UFormField
                                name="referencia"
                                label="Referencia"
                                hint="Opcional"
                                help="Cómo llegar: lo lee el técnico en la orden. Por defecto, la del cliente."
                                class="sm:col-span-2"
                            >
                                <UTextarea
                                    v-model="estado.referencia"
                                    :rows="2"
                                    :maxlength="300"
                                    autoresize
                                    placeholder="Casa verde frente a la iglesia"
                                    class="w-full"
                                    data-prueba="alta-referencia"
                                />
                            </UFormField>
                            <UFormField
                                name="coordenadas"
                                label="Coordenadas"
                                hint="Opcional"
                                help="Para la visita del técnico."
                                class="sm:col-span-2"
                            >
                                <UInput
                                    v-model="estado.coordenadas"
                                    placeholder="14.6349,-90.5069"
                                    icon="i-lucide-locate"
                                    class="w-full"
                                />
                            </UFormField>
                            <UFormField
                                name="contacto_nombre"
                                label="Contacto en sitio"
                                hint="Opcional"
                                help="Quién recibe al técnico, si no es el cliente."
                            >
                                <UInput
                                    v-model="estado.contacto_nombre"
                                    :maxlength="200"
                                    icon="i-lucide-user-round"
                                    class="w-full"
                                    data-prueba="alta-contacto-nombre"
                                />
                            </UFormField>
                            <UFormField
                                name="contacto_telefono"
                                label="Teléfono del contacto"
                                hint="Opcional"
                            >
                                <UInput
                                    v-model="estado.contacto_telefono"
                                    type="tel"
                                    inputmode="tel"
                                    placeholder="5512 3344"
                                    icon="i-lucide-phone"
                                    class="w-full"
                                    data-prueba="alta-contacto-telefono"
                                />
                            </UFormField>
                        </div>
                    </section>

                    <USeparator />

                    <div class="flex flex-col gap-4">
                        <UFormField
                            v-if="puede('plantillas.ver')"
                            name="plantilla_facturacion_id"
                            label="Plantilla de facturación"
                            help="Define el día de cobro, los días de gracia, la mora y cuándo se limita o se corta."
                        >
                            <USelect
                                v-model="estado.plantilla_facturacion_id"
                                :items="itemsPlantilla"
                                class="w-full"
                            />
                        </UFormField>

                        <dl
                            v-if="plantilla"
                            class="grid grid-cols-2 gap-x-6 gap-y-3 rounded-md border border-default p-3"
                            :class="compacto ? '' : 'sm:grid-cols-4'"
                        >
                            <DatoFicha
                                etiqueta="Ciclo"
                                :valor="plantilla.ciclo === 'dia_fijo' ? `Día ${plantilla.dia} de cada mes` : 'Aniversario de instalación'"
                            />
                            <DatoFicha
                                etiqueta="Gracia"
                                :valor="`${plantilla.dias_gracia} días`"
                            />
                            <DatoFicha
                                etiqueta="Limita / corta con"
                                :valor="`${plantilla.facturas_para_limitar} / ${plantilla.facturas_para_cortar} avisos vencidos`"
                            />
                            <DatoFicha
                                etiqueta="Mora"
                                :valor="plantilla.mora_tipo === 'ninguna' ? 'Sin mora' : plantilla.mora_tipo === 'fija' ? formatearQuetzales(plantilla.mora_valor) : `${plantilla.mora_valor} %`"
                            />
                        </dl>
                    </div>

                    <UCollapsible
                        v-model:open="conExcepciones"
                        class="flex flex-col gap-4"
                    >
                        <UButton
                            label="Excepciones: precio especial y firewall"
                            :trailing-icon="conExcepciones ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'"
                            color="neutral"
                            variant="ghost"
                            class="self-start"
                            data-prueba="abrir-excepciones"
                        />
                        <template #content>
                            <div class="grid gap-4 pt-2 sm:grid-cols-2">
                                <UFormField
                                    name="costo_override"
                                    label="Precio especial"
                                    hint="Opcional"
                                    :help="plan ? `Vacío = precio del plan (${formatearQuetzales(plan.precio)}).` : 'Vacío = precio del plan.'"
                                >
                                    <UInput
                                        v-model="estado.costo_override"
                                        inputmode="decimal"
                                        placeholder="Usar precio del plan"
                                        class="w-full"
                                    >
                                        <template #leading>
                                            <span class="text-sm text-muted">Q</span>
                                        </template>
                                    </UInput>
                                </UFormField>

                                <UFormField
                                    name="excluir_firewall"
                                    label="Firewall"
                                    help="No aplicar las reglas de corte del router a este servicio."
                                >
                                    <USwitch
                                        v-model="estado.excluir_firewall"
                                        label="Excluir del firewall"
                                    />
                                </UFormField>
                            </div>
                        </template>
                    </UCollapsible>
                </div>

                <!-- Resumen -->
                <div
                    v-show="pasoActual === 'resumen'"
                    class="flex flex-col gap-4"
                    data-prueba="resumen-alta"
                >
                    <UAlert
                        v-if="nacePendiente"
                        color="info"
                        variant="subtle"
                        icon="i-lucide-hard-hat"
                        title="Nace pendiente de instalación"
                        description="No navega ni se factura hasta que lo actives desde su ficha."
                    />
                    <section
                        v-for="grupo in [
                            { id: 'conexion' as const, titulo: 'Conexión' },
                            { id: 'red' as const, titulo: conPppoe ? 'Red y PPPoE' : 'Red y equipo' },
                            { id: 'instalacion' as const, titulo: 'Instalación y cobro' },
                        ]"
                        :key="grupo.id"
                        class="flex flex-col gap-3 rounded-md border border-default p-3"
                    >
                        <div class="flex items-center justify-between gap-2">
                            <h3 class="text-sm font-semibold text-highlighted">
                                {{ grupo.titulo }}
                            </h3>
                            <UButton
                                label="Cambiar"
                                icon="i-lucide-pencil"
                                color="neutral"
                                variant="ghost"
                                size="xs"
                                :aria-label="`Cambiar ${grupo.titulo.toLowerCase()}`"
                                @click="irA(grupo.id)"
                            />
                        </div>
                        <dl
                            v-if="grupo.id === 'conexion'"
                            class="grid gap-x-6 gap-y-3 sm:grid-cols-2"
                        >
                            <DatoFicha
                                etiqueta="Cliente"
                                :valor="cliente?.nombre"
                            />
                            <DatoFicha
                                etiqueta="Router"
                                :valor="router?.nombre"
                            />
                            <DatoFicha
                                etiqueta="Plan"
                                :valor="plan ? `${plan.nombre} · ${formatearVelocidad(plan.bajada_kbps)} / ${formatearVelocidad(plan.subida_kbps)}` : null"
                            />
                            <DatoFicha
                                etiqueta="Tipo de conexión"
                                :valor="TIPOS_CONEXION[estado.tipo_conexion].etiqueta"
                            />
                            <DatoFicha
                                v-if="variasEmpresas"
                                etiqueta="Empresa que factura"
                                :valor="empresaServicio === null ? 'La sugerida por el sistema' : nombreEmpresa(empresaServicio)"
                            />
                        </dl>
                        <dl
                            v-else-if="grupo.id === 'red'"
                            class="grid gap-x-6 gap-y-3 sm:grid-cols-2"
                        >
                            <DatoFicha
                                etiqueta="IPv4"
                                :valor="textoIpv4"
                                mono
                            />
                            <DatoFicha
                                etiqueta="IPv6"
                                :valor="textoIpv6"
                            />
                            <template v-if="conPppoe">
                                <DatoFicha
                                    etiqueta="Usuario PPP"
                                    :valor="estado.user_ppp"
                                    mono
                                />
                                <DatoFicha
                                    etiqueta="Contraseña PPP"
                                    :valor="estado.pass_ppp"
                                    mono
                                />
                            </template>
                            <template v-else>
                                <DatoFicha
                                    etiqueta="MAC"
                                    :valor="estado.mac || 'Sin MAC'"
                                    mono
                                />
                                <DatoFicha
                                    etiqueta="Amarre IP-MAC"
                                    :valor="estado.amarre_ip_mac ? 'Sí (ARP estático)' : 'No'"
                                />
                            </template>
                        </dl>
                        <dl
                            v-else
                            class="grid gap-x-6 gap-y-3 sm:grid-cols-2"
                        >
                            <DatoFicha
                                etiqueta="Estado inicial"
                                data-prueba="resumen-estado-inicial"
                            >
                                <EstadoServicioBadge
                                    :estado="estado.estado_inicial"
                                    size="sm"
                                />
                            </DatoFicha>
                            <DatoFicha
                                etiqueta="Precio mensual"
                                :valor="formatearQuetzales(precioEfectivo)"
                            />
                            <DatoFicha
                                etiqueta="Plantilla"
                                :valor="puede('plantillas.ver') ? (plantilla?.nombre ?? 'Sin plantilla') : 'La plantilla por defecto'"
                            />
                            <DatoFicha
                                etiqueta="Dirección"
                                :valor="estado.direccion"
                            />
                            <DatoFicha
                                v-if="estado.referencia.trim()"
                                etiqueta="Referencia"
                                :valor="estado.referencia"
                            />
                            <DatoFicha
                                v-if="estado.contacto_nombre.trim() || estado.contacto_telefono.trim()"
                                etiqueta="Contacto en sitio"
                                :valor="[estado.contacto_nombre.trim(), estado.contacto_telefono.trim()].filter(Boolean).join(' · ')"
                                data-prueba="resumen-contacto"
                            />
                            <DatoFicha
                                v-if="estado.excluir_firewall"
                                etiqueta="Firewall"
                                valor="Excluido"
                            />
                        </dl>
                    </section>
                </div>
            </UPageCard>

            <!-- Resumen en vivo (escritorio, página completa) -->
            <aside
                v-if="!compacto"
                class="hidden flex-col gap-3 surface-card p-4 lg:sticky lg:top-4 lg:flex"
                aria-label="Resumen del servicio"
                data-prueba="resumen-vivo"
            >
                <h3 class="text-sm font-semibold text-highlighted">
                    Resumen
                </h3>
                <dl class="flex flex-col gap-3">
                    <DatoFicha
                        etiqueta="Cliente"
                        :valor="cliente?.nombre"
                    />
                    <DatoFicha
                        etiqueta="Router y plan"
                        :valor="router ? `${router.nombre}${plan ? ` · ${plan.nombre}` : ''}` : null"
                    />
                    <DatoFicha
                        etiqueta="IPv4"
                        :valor="textoIpv4"
                        mono
                    />
                    <DatoFicha
                        etiqueta="IPv6"
                        :valor="textoIpv6"
                    />
                    <DatoFicha
                        v-if="conPppoe"
                        etiqueta="Usuario PPP"
                        :valor="estado.user_ppp"
                        mono
                    />
                    <DatoFicha
                        etiqueta="Precio mensual"
                        :valor="precioEfectivo ? formatearQuetzales(precioEfectivo) : null"
                    />
                    <DatoFicha etiqueta="Estado inicial">
                        <EstadoServicioBadge
                            :estado="estado.estado_inicial"
                            size="sm"
                        />
                    </DatoFicha>
                </dl>
            </aside>
        </div>

        <div class="flex items-center justify-between gap-2">
            <UButton
                v-if="paso > 0"
                label="Anterior"
                icon="i-lucide-chevron-left"
                color="neutral"
                variant="ghost"
                :disabled="enviando"
                @click="anterior"
            />
            <UButton
                v-else
                label="Cancelar"
                color="neutral"
                variant="ghost"
                :disabled="enviando"
                @click="emit('cancelar')"
            />

            <div class="flex items-center gap-2">
                <UButton
                    v-if="paso < ultimo && alcanzado >= ultimo"
                    label="Ir al resumen"
                    color="neutral"
                    variant="outline"
                    class="hidden sm:inline-flex"
                    @click="irA('resumen')"
                />
                <UButton
                    v-if="paso < ultimo"
                    label="Siguiente"
                    trailing-icon="i-lucide-chevron-right"
                    @click="siguiente"
                />
                <UButton
                    v-else
                    type="submit"
                    label="Crear servicio"
                    class="glow-brand"
                    icon="i-lucide-check"
                    :loading="enviando"
                />
            </div>
        </div>
    </UForm>
</template>
