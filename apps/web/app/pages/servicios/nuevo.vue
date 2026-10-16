<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { FormSubmitEvent, RadioGroupItem, SelectItem, StepperItem } from '@nuxt/ui'

definePageMeta({ permiso: 'servicios.crear' })

useHead({ title: 'Nuevo servicio · ArgosIsp' })

const route = useRoute()
const toast = useToast()
const { puede } = usePermisos()
const routersApi = useRouters()

const clienteInicial = Number(route.query.cliente) || undefined

const formulario = useTemplateRef('formulario')
const estado = reactive<EntradaServicio>(entradaServicioVacia(clienteInicial))
const claveIdempotencia = nuevaClaveIdempotencia()
const enviando = ref(false)
const problema = ref<Problem | null>(null)
/** El operador escribió su propio usuario PPP: ya no se regenera al cambiar de cliente. */
const usuarioEditado = ref(false)

const cliente = shallowRef<Cliente | null>(null)
const routers = shallowRef<RouterNas[]>([])
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

interface Paso extends StepperItem {
    campos: (keyof EntradaServicio)[]
}

/** El quinto paso es "Credenciales PPP" en PPPoE y "Equipo" (MAC y amarre) sin PPPoE. */
const pasos = computed<Paso[]>(() => [
    { title: 'Cliente', icon: 'i-lucide-user', campos: ['cliente_id'] },
    { title: 'Router y plan', icon: 'i-lucide-router', campos: ['router_id', 'plan_id', 'tipo_conexion'] },
    { title: 'IPv4', icon: 'i-lucide-network', campos: ['asignacion', 'red_id', 'ipv4'] },
    { title: 'IPv6', icon: 'i-lucide-globe', campos: ['ipv6_modo', 'ipv6_duid', 'prefijo_delegado_v6'] },
    estado.tipo_conexion === 'pppoe'
        ? { title: 'Credenciales PPP', icon: 'i-lucide-key-round', campos: ['user_ppp', 'pass_ppp'] }
        : { title: 'Equipo', icon: 'i-lucide-cpu', campos: ['mac', 'amarre_ip_mac'] },
    { title: 'Facturación', icon: 'i-lucide-receipt-text', campos: ['plantilla_facturacion_id', 'costo_override', 'excluir_firewall', 'mac', 'direccion', 'coordenadas', 'fecha_instalacion'] },
    { title: 'Confirmar', icon: 'i-lucide-check', campos: [] },
])

const paso = ref(clienteInicial ? 1 : 0)
/** Paso más lejano alcanzado: los anteriores se pueden revisitar desde el stepper. */
const alcanzado = ref(paso.value)
const itemsStepper = computed(() => pasos.value.map((p, indice) => ({ ...p, value: indice, disabled: indice > alcanzado.value })))
const ultimo = 6

/*
|--------------------------------------------------------------------------
| Derivados
|--------------------------------------------------------------------------
*/

const router = computed(() => routers.value.find(r => r.id === estado.router_id) ?? null)
const plan = computed(() => planes.value.find(p => p.id === estado.plan_id) ?? null)
const red = computed(() => redes.value.find(r => r.id === estado.red_id) ?? null)
const plantilla = computed(() => plantillas.value.find(p => p.id === estado.plantilla_facturacion_id) ?? null)
const soloIpv4 = computed(() => plan.value?.dual_stack === 'v4')
const conPppoe = computed(() => estado.tipo_conexion === 'pppoe')

/** El esquema base más la regla que necesita las redes cargadas: la IP fija cae en la red elegida. */
const esquema = computed(() => esquemaServicio.superRefine((datos, ctx) => {
    const elegida = redes.value.find(r => r.id === datos.red_id)
    if (datos.asignacion === 'fija' && elegida && PATRON_IPV4.test(datos.ipv4) && !ipEnCidr(datos.ipv4, elegida.cidr)) {
        ctx.addIssue({ code: 'custom', path: ['ipv4'], message: `La IP no pertenece a ${elegida.cidr}` })
    }
    const elegido = planes.value.find(p => p.id === datos.plan_id)
    if (datos.tipo_conexion !== 'pppoe' && elegido?.dual_stack === 'v6') {
        ctx.addIssue({ code: 'custom', path: ['tipo_conexion'], message: 'Un servicio sin PPPoE necesita IPv4 y el plan es solo IPv6' })
    }
}))

const itemsTipoConexion: RadioGroupItem[] = (Object.keys(TIPOS_CONEXION) as TipoConexion[]).map(tipo => ({
    label: TIPOS_CONEXION[tipo].etiqueta,
    value: tipo,
    description: TIPOS_CONEXION[tipo].descripcion,
}))

const itemsRouter = computed<RadioGroupItem[]>(() => routers.value.map(r => ({
    label: r.nombre,
    value: r.id,
    description: `${r.host} · ${CONTROLES_VELOCIDAD[r.control_velocidad ?? (r.modo_velocidad === 'pcq' ? 'arbol_pcq' : 'simple')].etiqueta.toLowerCase()}`,
})))

const itemsPlan = computed<RadioGroupItem[]>(() => planes.value.filter(p => p.activo).map(p => ({
    label: `${p.nombre} · ${formatearQuetzales(p.precio)}`,
    value: p.id,
    description: `${formatearVelocidad(p.bajada_kbps)} ↓ / ${formatearVelocidad(p.subida_kbps)} ↑ · ${p.dual_stack === 'ambos' ? 'IPv4 + IPv6' : p.dual_stack === 'v4' ? 'solo IPv4' : 'solo IPv6'}${p.global ? '' : ' · plan de este router'}`,
})))

const itemsAsignacion: RadioGroupItem[] = [
    { label: 'Automática', value: 'automatica', description: 'La API toma la siguiente IP libre de las redes del router.' },
    { label: 'IP fija', value: 'fija', description: 'Para clientes con IP pública o reglas por IP.' },
]

const itemsRed = computed<SelectItem[]>(() => redes.value.map(r => ({
    label: `${r.cidr} · ${r.tipo === 'pool' ? 'pool' : 'estática'}`,
    value: r.id,
})))

/** Asignación automática: red opcional (`red_ipv4_id`); "cualquiera" = la API elige. */
const CUALQUIER_RED = 'cualquiera'
const itemsRedAutomatica = computed<SelectItem[]>(() => [
    { label: 'Cualquier red del router', value: CUALQUIER_RED },
    ...redes.value.map(r => ({ label: `${r.cidr} · ${r.tipo === 'pool' ? 'pool' : 'estática'}`, value: String(r.id) })),
])
const redAutomatica = computed({
    get: () => (estado.red_id === undefined ? CUALQUIER_RED : String(estado.red_id)),
    set: (valor: string) => {
        estado.red_id = valor === CUALQUIER_RED ? undefined : Number(valor)
    },
})

const itemsIpv6 = computed<RadioGroupItem[]>(() => {
    const delegado = plan.value ? `/${plan.value.tamano_prefijo_delegado}` : ''
    return [
        { label: 'RADIUS por servicio', value: 'radius_servicio', description: conPppoe.value ? `Prefijo de enlace /64 y delegado ${delegado} asignados por ArgosIsp desde los pools del router.` : 'Solo con PPPoE (necesita RADIUS).', disabled: soloIpv4.value || !conPppoe.value },
        { label: 'Pool del router', value: 'radius_pool', description: conPppoe.value ? 'El router asigna desde su pool (Framed-IPv6-Pool).' : 'Solo con PPPoE (necesita RADIUS).', disabled: soloIpv4.value || !conPppoe.value },
        { label: 'DHCPv6-PD por DUID', value: 'duid', description: 'Prefijo estático para un equipo identificado por su DUID.', disabled: soloIpv4.value },
        { label: 'Prefijo estático', value: 'estatico', description: 'Prefijo delegado fijo, escrito a mano.', disabled: soloIpv4.value },
        { label: 'Sin IPv6', value: 'ninguno', description: 'Solo IPv4.' },
    ]
})

const itemsPlantilla = computed<SelectItem[]>(() => [
    { label: 'Sin plantilla', value: null },
    ...plantillas.value.map(p => ({ label: p.nombre, value: p.id })),
])

const ETIQUETAS_IPV6: Record<ModoIpv6, string> = {
    radius_servicio: 'RADIUS por servicio',
    radius_pool: 'Pool del router',
    duid: 'DHCPv6-PD por DUID',
    estatico: 'Prefijo estático',
    ninguno: 'Sin IPv6',
}

const precioEfectivo = computed(() => estado.costo_override?.trim() || plan.value?.precio || null)

/*
|--------------------------------------------------------------------------
| Carga de catálogos
|--------------------------------------------------------------------------
*/

async function cargarCliente(id: number) {
    const resultado = await useClientes().ver(id)
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
    const [resultadoRouters, resultadoPlantillas] = await Promise.all([
        routersApi.listar({ activo: true }),
        puede('plantillas.ver') ? usePlantillas().listar() : null,
        clienteInicial ? cargarCliente(clienteInicial) : null,
    ])
    if (resultadoRouters.ok) {
        routers.value = resultadoRouters.data.data
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
    paso.value = Math.min(paso.value + 1, ultimo)
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
    return indice === -1 ? ultimo : indice
}

async function alEnviar(evento: FormSubmitEvent<SalidaServicio>) {
    enviando.value = true
    problema.value = null
    const resultado = await useServicios().crear(cuerpoServicio(evento.data, { omitirPlantilla: !puede('plantillas.ver') }), claveIdempotencia)
    enviando.value = false
    if (resultado.ok) {
        toast.add({
            title: 'Servicio creado',
            description: `${TIPOS_CONEXION[tipoConexionDe(resultado.data)].corta} · ${etiquetaServicio(resultado.data)}${resultado.data.user_ppp && resultado.data.ipv4 ? ` · ${resultado.data.ipv4}` : ''}`,
            color: 'success',
            icon: 'i-lucide-circle-check',
        })
        await navigateTo(`/clientes/${resultado.data.cliente_id}?tab=servicios`)
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
    <PanelPagina
        id="servicio-nuevo"
        titulo="Nuevo servicio"
        icono="i-lucide-wifi"
    >
        <template #acciones>
            <UButton
                v-if="cliente"
                :to="`/clientes/${cliente.id}`"
                icon="i-lucide-arrow-left"
                :label="cliente.nombre"
                color="neutral"
                variant="ghost"
                class="hidden max-w-64 sm:inline-flex"
                :ui="{ label: 'truncate' }"
            />
        </template>

        <UForm
            ref="formulario"
            :schema="esquema"
            :state="estado"
            :validate-on="['input']"
            class="mx-auto flex w-full max-w-3xl flex-col gap-6"
            @submit="alEnviar"
        >
            <UStepper
                v-model="paso"
                :items="itemsStepper"
                size="sm"
                class="w-full"
                :ui="{
                    title: 'hidden md:block',
                    description: 'hidden',
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
            <UAlert
                v-else-if="problema"
                color="error"
                variant="subtle"
                icon="i-lucide-circle-alert"
                title="La API rechazó algunos datos"
                description="Corrige los campos marcados y vuelve a crear el servicio."
            />

            <UPageCard
                :title="pasos[paso]?.title"
                :icon="pasos[paso]?.icon"
                variant="subtle"
            >
                <!-- 1 · Cliente -->
                <div
                    v-show="paso === 0"
                    class="flex flex-col gap-4"
                >
                    <UFormField
                        name="cliente_id"
                        label="Cliente"
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

                <!-- 2 · Router y plan -->
                <div
                    v-show="paso === 1"
                    class="flex flex-col gap-6"
                >
                    <UFormField
                        name="router_id"
                        label="Router"
                        required
                    >
                        <URadioGroup
                            v-model="estado.router_id"
                            :items="itemsRouter"
                            variant="card"
                            class="w-full"
                            :ui="{ fieldset: 'grid gap-2 sm:grid-cols-2' }"
                        />
                    </UFormField>

                    <UFormField
                        v-if="estado.router_id"
                        name="plan_id"
                        label="Plan disponible en este router"
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
                            title="Este router no tiene planes implementados"
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

                    <UFormField
                        name="tipo_conexion"
                        label="Tipo de conexión"
                        required
                    >
                        <URadioGroup
                            v-model="estado.tipo_conexion"
                            :items="itemsTipoConexion"
                            variant="card"
                            class="w-full"
                            :ui="{ fieldset: 'grid gap-2 sm:grid-cols-3' }"
                            data-prueba="tipo-conexion"
                        />
                    </UFormField>
                </div>

                <!-- 3 · IPv4 -->
                <div
                    v-show="paso === 2"
                    class="flex flex-col gap-4"
                >
                    <UAlert
                        v-if="!conPppoe"
                        color="neutral"
                        variant="subtle"
                        icon="i-lucide-info"
                        :title="`${TIPOS_CONEXION[estado.tipo_conexion].etiqueta}: la IPv4 es obligatoria`"
                        description="Automática de una red del router o fija. Sin redes IPv4 en el router la API rechaza el alta."
                    />
                    <UFormField
                        name="asignacion"
                        label="Asignación de IPv4"
                    >
                        <URadioGroup
                            v-model="estado.asignacion"
                            :items="itemsAsignacion"
                            variant="card"
                            class="w-full"
                            :ui="{ fieldset: 'grid gap-2 sm:grid-cols-2' }"
                        />
                    </UFormField>

                    <div
                        v-if="estado.asignacion === 'fija'"
                        class="grid gap-4 sm:grid-cols-2"
                    >
                        <UFormField
                            name="red_id"
                            label="Red"
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
                            :description="red ? `Dentro de ${red.cidr}` : undefined"
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
                            description="Sin elegir, la API toma la siguiente IP libre de cualquier red del router."
                            class="sm:max-w-sm"
                        >
                            <USelect
                                v-model="redAutomatica"
                                :items="itemsRedAutomatica"
                                class="w-full"
                                aria-label="Red de la que asignar la IP"
                            />
                        </UFormField>
                        <p class="text-sm text-muted">
                            Redes de {{ router?.nombre ?? 'el router' }}:
                        </p>
                        <div class="flex flex-wrap gap-2">
                            <UBadge
                                v-for="r in redes"
                                :key="r.id"
                                :label="`${r.cidr} · ${r.tipo === 'pool' ? 'pool' : 'estática'}`"
                                color="neutral"
                                variant="outline"
                                class="font-mono"
                            />
                            <span
                                v-if="!redes.length"
                                class="text-sm text-muted"
                            >{{ puede('redes.ver') ? 'El router no tiene redes IPv4 registradas.' : 'Sin permiso redes.ver para verlas.' }}</span>
                        </div>
                    </div>
                </div>

                <!-- 4 · IPv6 -->
                <div
                    v-show="paso === 3"
                    class="flex flex-col gap-4"
                >
                    <UAlert
                        v-if="soloIpv4"
                        color="neutral"
                        variant="subtle"
                        icon="i-lucide-info"
                        :title="`${plan?.nombre ?? 'El plan'} es solo IPv4`"
                    />
                    <UAlert
                        v-else-if="(estado.ipv6_modo === 'radius_servicio' || estado.ipv6_modo === 'radius_pool') && !bloques.length && puede('ipv6.ver')"
                        color="warning"
                        variant="subtle"
                        icon="i-lucide-triangle-alert"
                        title="El router no tiene bloques IPv6"
                        description="Registra un bloque y sus pools en Routers, o elige otro modo."
                    />

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
                        required
                    >
                        <UInput
                            v-model="estado.prefijo_delegado_v6"
                            placeholder="2803:d100:1000:100::/56"
                            class="w-full font-mono"
                        />
                    </UFormField>

                    <div
                        v-if="bloques.length && !soloIpv4"
                        class="flex flex-wrap items-center gap-2 text-sm text-muted"
                    >
                        Bloques del router:
                        <UBadge
                            v-for="b in bloques"
                            :key="b.id"
                            :label="b.prefijo"
                            color="neutral"
                            variant="outline"
                            class="font-mono"
                        />
                    </div>
                </div>

                <!-- 5 · Credenciales (PPPoE) o equipo (WISP) -->
                <div
                    v-show="paso === 4 && !conPppoe"
                    class="flex flex-col gap-4"
                    data-prueba="paso-equipo"
                >
                    <p class="text-sm text-muted">
                        Sin PPPoE no hay usuario ni contraseña: el router identifica al cliente por su IP{{ estado.tipo_conexion === 'dhcp_fija' ? ' y su MAC' : '' }}.
                    </p>
                    <div class="grid gap-4 sm:grid-cols-2">
                        <UFormField
                            name="mac"
                            label="MAC del equipo"
                            :required="estado.tipo_conexion === 'dhcp_fija' || estado.amarre_ip_mac"
                            :description="estado.tipo_conexion === 'dhcp_fija' ? 'El lease estático se crea con esta MAC.' : 'Obligatoria si amarras la IP a la MAC.'"
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
                            description="ARP estático en el router: solo esa MAC puede usar la IP."
                        >
                            <UCheckbox
                                v-model="estado.amarre_ip_mac"
                                label="Amarrar la IP a la MAC"
                                data-prueba="amarre-ip-mac"
                            />
                        </UFormField>
                    </div>
                </div>

                <div
                    v-show="paso === 4 && conPppoe"
                    class="grid gap-4 sm:grid-cols-2"
                >
                    <UFormField
                        name="user_ppp"
                        label="Usuario PPP"
                        description="Generado a partir del nombre; puedes cambiarlo."
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
                        description="Visible para dictarla en la instalación."
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

                <!-- 6 · Facturación e instalación -->
                <div
                    v-show="paso === 5"
                    class="flex flex-col gap-6"
                >
                    <div class="grid gap-4 sm:grid-cols-2">
                        <UFormField
                            v-if="puede('plantillas.ver')"
                            name="plantilla_facturacion_id"
                            label="Plantilla de facturación"
                            class="sm:col-span-2"
                        >
                            <USelect
                                v-model="estado.plantilla_facturacion_id"
                                :items="itemsPlantilla"
                                class="w-full"
                            />
                        </UFormField>

                        <dl
                            v-if="plantilla"
                            class="grid grid-cols-2 gap-x-6 gap-y-3 rounded-md border border-default p-3 sm:col-span-2 sm:grid-cols-4"
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

                    <div class="flex flex-col gap-4">
                        <h3 class="text-sm font-semibold text-highlighted">
                            Excepciones a la plantilla
                        </h3>
                        <div class="grid gap-4 sm:grid-cols-2">
                            <UFormField
                                name="costo_override"
                                label="Precio especial"
                                :description="plan ? `Precio del plan: ${formatearQuetzales(plan.precio)}` : undefined"
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
                                description="No aplicar reglas de corte en el router para este servicio."
                            >
                                <USwitch
                                    v-model="estado.excluir_firewall"
                                    label="Excluir del firewall"
                                />
                            </UFormField>
                        </div>
                    </div>

                    <div class="flex flex-col gap-4">
                        <h3 class="text-sm font-semibold text-highlighted">
                            Instalación
                        </h3>
                        <div class="grid gap-4 sm:grid-cols-2">
                            <UFormField
                                name="fecha_instalacion"
                                label="Fecha de instalación"
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
                            >
                                <UInput
                                    v-model="estado.mac"
                                    placeholder="4C:5E:0C:12:34:56"
                                    class="w-full font-mono"
                                />
                            </UFormField>
                            <UFormField
                                name="direccion"
                                label="Dirección de instalación"
                            >
                                <UInput
                                    v-model="estado.direccion"
                                    class="w-full"
                                />
                            </UFormField>
                            <UFormField
                                name="coordenadas"
                                label="Coordenadas"
                            >
                                <UInput
                                    v-model="estado.coordenadas"
                                    placeholder="14.6349,-90.5069"
                                    class="w-full"
                                />
                            </UFormField>
                        </div>
                    </div>
                </div>

                <!-- 7 · Confirmar -->
                <dl
                    v-show="paso === ultimo"
                    class="grid gap-x-8 gap-y-5 sm:grid-cols-2"
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
                        etiqueta="Precio mensual"
                        :valor="formatearQuetzales(precioEfectivo)"
                    />
                    <DatoFicha
                        etiqueta="IPv4"
                        :valor="estado.asignacion === 'fija' ? estado.ipv4 : (red ? `Automática de ${red.cidr}` : 'Automática')"
                        mono
                    />
                    <DatoFicha
                        etiqueta="IPv6"
                        :valor="ETIQUETAS_IPV6[estado.ipv6_modo]"
                    />
                    <DatoFicha
                        etiqueta="Tipo de conexión"
                        :valor="TIPOS_CONEXION[estado.tipo_conexion].etiqueta"
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
                    <DatoFicha
                        etiqueta="Plantilla"
                        :valor="puede('plantillas.ver') ? (plantilla?.nombre ?? 'Sin plantilla') : 'La plantilla por defecto'"
                    />
                    <DatoFicha
                        etiqueta="Firewall"
                        :valor="estado.excluir_firewall ? 'Excluido' : 'Normal'"
                    />
                </dl>
            </UPageCard>

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
                <span v-else />

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
                    icon="i-lucide-check"
                    :loading="enviando"
                />
            </div>
        </UForm>
    </PanelPagina>
</template>
