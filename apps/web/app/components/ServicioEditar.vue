<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { FormSubmitEvent, SelectItem } from '@nuxt/ui'

/**
 * Edición de un servicio desde su ficha (`PUT /servicios/:id`, `servicios.editar`, con
 * `version`): plan del mismo router, tipo de conexión PPPoE / IP estática / DHCP fija, MAC,
 * amarre IP-MAC, modo IPv6, IPv4 fija, contraseña PPPoE, ubicación y contacto en sitio (pedidos
 * A12–A14 de Iris), instalación y precio especial. Solo viaja lo que cambió; los 422 se muestran
 * junto a cada campo (el teléfono con `rule: 'telefono'`); los 409 de IP, prefijo o usuario PPPoE
 * (`ip_ocupada`, `ip_en_sesion`, `prefijo_ocupado`, `prefijo_en_sesion`, `user_ppp_duplicado`,
 * `user_ppp_en_sesion`; `conflictoEnCampo`) en su campo, y el 409 de versión ofrece recargar.
 *
 * IPv4: se cambia con el mismo selector del alta (`ServicioIpv4Fija`); en PPPoE además se quita
 * («usar el pool», `ipv4: null`). Credenciales de un PPPoE (`servicios.editar`, el permiso de la
 * ruta): usuario (409 `user_ppp_duplicado` en el campo) y contraseña. Cambiarlas desconecta la sesión
 * (A2: Disconnect con RADIUS; en un router `api`, secret reescrito y sesión quitada) y el cliente
 * vuelve a conectarse con las nuevas.
 *
 * Tipo de conexión (`contratos/tipo-conexion-router.md`): lo define el router y aquí no se elige.
 * Si el servicio difiere del tipo de su router (dato anterior a la regla), se ofrece pasarlo a ese.
 *
 * En un router sin RADIUS (`modo_seguridad = 'api'`) PPPoE va como secret local en el MikroTik
 * (`contratos/pppoe-local.md`), con su ayuda. Si el router no tiene credenciales de la API, pasar a
 * PPPoE (o cambiar un PPPoE) responde 422 `pppoe_local_requiere_api`: se avisa antes y al recibirlo.
 */
const props = defineProps<{
    servicio: Servicio
}>()

const abierto = defineModel<boolean>('open', { default: false })

const emit = defineEmits<{
    guardado: [servicio: Servicio]
}>()

const { puede } = usePermisos()
const toast = useToast()
const formulario = useTemplateRef('formulario')
const estado = reactive<EntradaEdicionServicio>(entradaEdicionDesde(props.servicio))
/** El teléfono guardado no se valida si no cambió (puede ser un dato viejo con otro formato). */
const esquema = computed(() => esquemaEdicionServicioPara(props.servicio, redes.value))
const enviando = ref(false)
const problema = ref<Problem | null>(null)
const planes = shallowRef<PlanEfectivo[]>([])
/** Router del servicio, para saber si usa RADIUS (sin `routers.ver` no se sabe: decide la API). */
const routerServicio = shallowRef<RouterNas | null>(null)
/** Servidores PPPoE del router (`red_acceso.ver`); vacío = router sin servidores. */
const servidores = shallowRef<ServidorPppoe[]>([])
/** Redes IPv4 del router (`redes.ver`), para elegir la IP nueva; sin permiso se escribe la IP sola. */
const redes = shallowRef<RedIpv4[]>([])
const claveVisible = ref(false)

watch(abierto, async (valor) => {
    if (!valor) {
        return
    }
    Object.assign(estado, entradaEdicionDesde(props.servicio))
    problema.value = null
    claveVisible.value = false
    const [resultadoPlanes, resultadoRouter, resultadoServidores, resultadoRedes] = await Promise.all([
        puede('planes.ver') ? useRouters().planes(props.servicio.router_id) : null,
        puede('routers.ver') ? useRouters().ver(props.servicio.router_id) : null,
        puede('red_acceso.ver') ? useRedAcceso().servidores(props.servicio.router_id) : null,
        puede('redes.ver') ? useRouters().redesIpv4(props.servicio.router_id) : null,
    ])
    planes.value = resultadoPlanes?.ok ? resultadoPlanes.data : []
    routerServicio.value = resultadoRouter?.ok ? resultadoRouter.data : null
    servidores.value = resultadoServidores?.ok ? resultadoServidores.data : []
    redes.value = resultadoRedes?.ok ? resultadoRedes.data : []
}, { immediate: true })

const conPppoe = computed(() => estado.tipo_conexion === 'pppoe')
const eraPppoe = computed(() => esPppoe(props.servicio))

/** Router sin RADIUS: PPPoE como secret local (sin consumo ni cambios al instante). */
const routerSinRadius = computed(() => esSinRadius(routerServicio.value))
/** PPPoE en un router sin RADIUS y sin credenciales de la API: la API respondería 422. */
const faltanCredencialesApi = computed(() => conPppoe.value && pppoeSinCredencialesApi(routerServicio.value))
const credencialesRechazadas = computed(() => esPppoeLocalRequiereApi(problema.value))

/** El tipo del router (sin `routers.ver` no se sabe y no se ofrece unificar). */
const tipoRouter = computed<TipoConexion | null>(() => routerServicio.value?.tipo_conexion ?? null)
/** El servicio no usa el tipo de su router: se puede pasar a él (unificar este servicio). */
const difiereDelRouter = computed(() => tipoRouter.value !== null && tipoRouter.value !== tipoConexionDe(props.servicio))
const pasarAlRouter = computed({
    get: () => tipoRouter.value !== null && estado.tipo_conexion === tipoRouter.value && difiereDelRouter.value,
    set: (valor: boolean) => {
        estado.tipo_conexion = valor && tipoRouter.value ? tipoRouter.value : tipoConexionDe(props.servicio)
    },
})

const itemsPlan = computed<SelectItem[]>(() => {
    const lista = planes.value.filter(p => p.activo || p.id === props.servicio.plan_id)
    if (!lista.some(p => p.id === props.servicio.plan_id)) {
        return [{ label: nombrePlan(props.servicio), value: props.servicio.plan_id }, ...lista.map(p => ({ label: p.nombre, value: p.id }))]
    }
    return lista.map(p => ({ label: `${p.nombre} · ${formatearVelocidad(p.bajada_kbps)} / ${formatearVelocidad(p.subida_kbps)}`, value: p.id }))
})

const itemsIpv6 = computed<SelectItem[]>(() => [
    { label: 'RADIUS por servicio', value: 'radius_servicio', disabled: !conPppoe.value },
    { label: 'Pool del router', value: 'radius_pool', disabled: !conPppoe.value },
    { label: 'DHCPv6-PD por DUID', value: 'duid' },
    { label: 'Prefijo estático', value: 'estatico' },
    { label: 'Sin IPv6', value: 'ninguno' },
])

watch(() => estado.tipo_conexion, (tipo) => {
    if (tipo !== 'pppoe' && modoIpv6PorRadius(estado.ipv6_modo)) {
        estado.ipv6_modo = 'ninguno'
    }
    if (tipo === 'pppoe') {
        estado.amarre_ip_mac = false
    }
})

/*
 * Servidor PPPoE (`contratos/red-acceso.md` §3): el del servicio, o elegir otro activo del router.
 * Con uno solo la API lo toma; con varios, 422 `servidor_pppoe_requerido` si no se elige.
 */
const itemsServidor = computed<SelectItem[]>(() => [
    ...(props.servicio.servidor_pppoe_id ? [] : [{ label: 'Que lo elija Argos por la red', value: 0 }]),
    ...servidores.value
        .filter(s => s.activo || s.id === props.servicio.servidor_pppoe_id)
        .map(s => ({ label: s.nombre, value: s.id, description: [s.vlan ? `VLAN ${s.vlan.vlan_id}` : s.interfaz, s.local_address ? `gateway ${s.local_address}${s.local_address_derivado ? ' (derivado)' : ''}` : 'sin red'].join(' · ') })),
])
const servidorElegido = computed(() => servidores.value.find(s => s.id === estado.servidor_pppoe_id) ?? null)
/** Gateway de solo lectura: el guardado mientras no cambie el servidor; si cambia, el del servidor nuevo. */
const sinCambioServidor = computed(() => estado.servidor_pppoe_id === (props.servicio.servidor_pppoe_id ?? 0))
const gatewayServicio = computed(() => (sinCambioServidor.value ? props.servicio.local_address : servidorElegido.value?.local_address) ?? null)
const gatewayDerivado = computed(() => Boolean(sinCambioServidor.value ? props.servicio.local_address_derivado : servidorElegido.value?.local_address_derivado))

/*
 * IPv4 fija: el plan solo IPv6 no lleva IPv4. Sin PPPoE es obligatoria (se cambia, no se quita);
 * en PPPoE sin IP fija la entrega el pool del router.
 */
const planElegido = computed(() => planes.value.find(p => p.id === estado.plan_id) ?? null)
const conIpv4 = computed(() => planElegido.value?.dual_stack !== 'v6')
const textoIpv4Actual = computed(() => props.servicio.ipv4 ?? (eraPppoe.value ? 'Sin IP fija: la entrega el pool del router' : 'Sin IPv4'))

/** La red de la IP actual (o la única del router), para empezar a escribir la nueva en ella. */
function redSugerida(): number | undefined {
    const actual = props.servicio.ipv4
    return (actual ? redes.value.find(r => ipEnCidr(actual, r.cidr))?.id : undefined)
        ?? (redes.value.length === 1 ? redes.value[0]?.id : undefined)
}

function cambiarIpv4() {
    estado.quitar_ipv4 = false
    estado.cambiar_ipv4 = true
    estado.ipv4 = ''
    estado.red_id = redSugerida()
}

// Las redes pueden llegar después de pulsar «Cambiar IP».
watch(redes, () => {
    if (estado.cambiar_ipv4 && estado.red_id === undefined) {
        estado.red_id = redSugerida()
    }
})

function mantenerIpv4() {
    estado.cambiar_ipv4 = false
    estado.red_id = undefined
    estado.ipv4 = props.servicio.ipv4 ?? ''
    formulario.value?.clear('ipv4')
    formulario.value?.clear('red_id')
}

/** «Quitar IP fija (usar el pool)»: solo PPPoE con IP fija (`ipv4: null`). */
const puedeQuitarIpv4 = computed(() => conPppoe.value && eraPppoe.value && Boolean(props.servicio.ipv4))

function quitarIpv4() {
    mantenerIpv4()
    estado.quitar_ipv4 = true
}

function deshacerQuitarIpv4() {
    estado.quitar_ipv4 = false
    formulario.value?.clear('ipv4')
}

/** Credenciales PPPoE: solo un PPPoE que sigue siéndolo; al pasar a PPPoE las genera la API. */
const editaClave = computed(() => eraPppoe.value && conPppoe.value && puede('servicios.editar'))
const cambianCredenciales = computed(() => estado.pass_ppp !== '' || (estado.user_ppp.trim() !== '' && estado.user_ppp.trim() !== (props.servicio.user_ppp ?? '')))

function generarClave() {
    estado.pass_ppp = generarClavePpp()
    claveVisible.value = true
}

/** Qué pasa con las credenciales al cambiar el tipo. */
const avisoTipo = computed(() => {
    if (eraPppoe.value && !conPppoe.value) {
        return 'Se borran el usuario y la contraseña PPP y se cierra su sesión: el router pasa a identificar al cliente por su IP.'
    }
    if (!eraPppoe.value && conPppoe.value) {
        return 'La API genera usuario y contraseña PPP; los verás en "Credenciales PPPoE" para configurarlos en el equipo.'
    }
    return null
})

async function enviar(evento: FormSubmitEvent<SalidaEdicionServicio>) {
    const cambios = cambiosServicio(evento.data, props.servicio)
    if (Object.keys(cambios).length === 1) {
        abierto.value = false
        return
    }
    enviando.value = true
    problema.value = null
    const resultado = await useServicios().editar(props.servicio.id, cambios)
    enviando.value = false
    if (resultado.ok) {
        abierto.value = false
        emit('guardado', resultado.data)
        // Tipo de plan (A1): advertencias que no bloquean, ya guardado.
        avisarAdvertencias(toast, resultado.data.warnings, 'Servicio guardado con advertencias')
        return
    }
    // 409 que no son de versión (IP, prefijo o usuario de otro servicio o de una sesión abierta): en su campo.
    const enCampo = conflictoEnCampo(resultado.problema)
    if (enCampo) {
        formulario.value?.setErrors([enCampo])
        return
    }
    const errores = erroresDeFormulario(resultado.problema)
    if (errores.length) {
        formulario.value?.setErrors(errores)
    }
    const campos = new Set(Object.keys(estado))
    if (!errores.length || errores.some(e => !e.name || !campos.has(e.name))) {
        problema.value = resultado.problema
    }
}

const recargando = ref(false)

/** 409 de versión: se lee el servicio otra vez y el formulario vuelve a lo guardado. */
async function recargar() {
    recargando.value = true
    const resultado = await useServicios().ver(props.servicio.id)
    recargando.value = false
    if (!resultado.ok) {
        problema.value = resultado.problema
        return
    }
    emit('guardado', resultado.data)
    Object.assign(estado, entradaEdicionDesde(resultado.data))
    problema.value = null
}

/** Falla de red o del servidor: se envía de nuevo lo mismo. */
function reenviar() {
    void formulario.value?.submit()
}

const accionProblema = computed(() => {
    const status = problema.value?.status ?? 0
    if (status === 409) {
        return { accion: recargar, etiqueta: 'Recargar' }
    }
    return status >= 500 || status === 0 ? { accion: reenviar, etiqueta: 'Reintentar' } : null
})
</script>

<template>
    <USlideover
        v-model:open="abierto"
        :title="`Editar ${etiquetaServicio(servicio)}`"
        :description="`${nombreCliente(servicio)} · ${nombreRouter(servicio)}`"
        :dismissible="!enviando"
        :ui="{ content: 'sm:max-w-xl' }"
    >
        <template #body>
            <UForm
                id="form-editar-servicio"
                ref="formulario"
                :schema="esquema"
                :state="estado"
                class="flex flex-col gap-6"
                @submit="enviar"
            >
                <UFormField
                    v-if="puede('planes.ver')"
                    name="plan_id"
                    required
                    label="Plan"
                    description="Planes disponibles en este router."
                >
                    <USelect
                        v-model="estado.plan_id"
                        :items="itemsPlan"
                        class="w-full"
                    />
                </UFormField>

                <UFormField
                    name="tipo_conexion"
                    label="Tipo de conexión"
                    :help="difiereDelRouter ? undefined : 'Lo define el router: se cambia en su ficha, para todos sus servicios.'"
                >
                    <div
                        class="flex flex-col gap-3 rounded-md border border-default p-3"
                        data-prueba="editar-tipo-conexion"
                    >
                        <div class="flex items-start gap-3">
                            <UIcon
                                :name="TIPOS_CONEXION[estado.tipo_conexion].icono"
                                class="mt-0.5 size-5 shrink-0 text-primary"
                            />
                            <div class="flex min-w-0 flex-col gap-0.5">
                                <span
                                    class="text-sm font-medium text-highlighted"
                                    data-prueba="editar-tipo-actual"
                                >{{ TIPOS_CONEXION[estado.tipo_conexion].etiqueta }}</span>
                                <span class="text-xs text-muted">{{ estado.tipo_conexion === 'pppoe' && routerSinRadius ? AYUDA_PPPOE_SIN_RADIUS : TIPOS_CONEXION[estado.tipo_conexion].descripcion }}</span>
                            </div>
                        </div>
                        <UCheckbox
                            v-if="difiereDelRouter && tipoRouter"
                            v-model="pasarAlRouter"
                            :label="`Pasar a ${TIPOS_CONEXION[tipoRouter].etiqueta}, el tipo de ${nombreRouter(servicio)}`"
                            description="Este servicio es de antes de que el tipo fuera uno por router: los demás servicios del router ya lo usan."
                            data-prueba="editar-pasar-tipo-router"
                        />
                    </div>
                </UFormField>
                <UAlert
                    v-if="avisoTipo"
                    color="warning"
                    variant="subtle"
                    icon="i-lucide-triangle-alert"
                    :description="avisoTipo"
                    data-prueba="aviso-tipo"
                />
                <PppoeLocalSinApiAlerta
                    v-if="faltanCredencialesApi && !credencialesRechazadas"
                    :router-id="servicio.router_id"
                />

                <UFormField
                    v-if="conPppoe && servidores.length"
                    name="servidor_pppoe_id"
                    label="Servidor PPPoE"
                    :help="servidores.length === 1 ? 'El único del router.' : 'Uno por VLAN: por dónde entra el cliente. Si su IP no es de la red del servidor nuevo, la API le da una de esa red.'"
                    data-prueba="editar-servidor-pppoe"
                >
                    <USelect
                        v-model="estado.servidor_pppoe_id"
                        :items="itemsServidor"
                        class="w-full"
                        data-prueba="editar-selector-servidor"
                    />
                    <p
                        class="mt-1.5 flex items-center gap-1.5 text-xs text-muted"
                        data-prueba="editar-gateway"
                    >
                        <UIcon
                            name="i-lucide-route"
                            class="size-3.5 shrink-0"
                        />
                        Gateway (local-address): <span class="font-mono text-default">{{ gatewayServicio ?? 'sale de la red del servidor' }}</span><span v-if="gatewayServicio && gatewayDerivado">, {{ MARCA_GATEWAY_DERIVADO }}</span>
                    </p>
                </UFormField>

                <section
                    v-if="conIpv4"
                    class="flex flex-col gap-3"
                    data-prueba="editar-ipv4"
                >
                    <div class="flex flex-wrap items-center justify-between gap-2">
                        <div class="flex min-w-0 flex-col gap-0.5">
                            <span class="text-sm font-medium text-highlighted">IPv4</span>
                            <span
                                class="break-all text-sm text-muted"
                                :class="{ 'font-mono': servicio.ipv4 }"
                                data-prueba="editar-ipv4-actual"
                            >{{ estado.cambiar_ipv4 ? `Actual: ${textoIpv4Actual}` : textoIpv4Actual }}</span>
                        </div>
                        <div
                            v-if="!estado.cambiar_ipv4 && !estado.quitar_ipv4"
                            class="flex flex-wrap gap-2"
                        >
                            <UButton
                                v-if="puedeQuitarIpv4"
                                label="Quitar IP fija (usar el pool)"
                                icon="i-lucide-circle-minus"
                                color="neutral"
                                variant="ghost"
                                size="sm"
                                data-prueba="editar-quitar-ipv4"
                                @click="quitarIpv4"
                            />
                            <UButton
                                label="Cambiar IP"
                                icon="i-lucide-pencil"
                                color="neutral"
                                variant="outline"
                                size="sm"
                                data-prueba="editar-cambiar-ipv4"
                                @click="cambiarIpv4"
                            />
                        </div>
                        <UButton
                            v-else-if="estado.quitar_ipv4"
                            label="Mantener la IP fija"
                            icon="i-lucide-undo-2"
                            color="neutral"
                            variant="ghost"
                            size="sm"
                            data-prueba="editar-mantener-ipv4"
                            @click="deshacerQuitarIpv4"
                        />
                        <UButton
                            v-else
                            label="Mantener la actual"
                            icon="i-lucide-undo-2"
                            color="neutral"
                            variant="ghost"
                            size="sm"
                            data-prueba="editar-mantener-ipv4"
                            @click="mantenerIpv4"
                        />
                    </div>
                    <ServicioIpv4Fija
                        v-if="estado.cambiar_ipv4"
                        v-model:red-id="estado.red_id"
                        v-model:ipv4="estado.ipv4"
                        :redes="redes"
                        :exigir-red="redes.length > 0"
                    />
                    <UFormField
                        v-if="estado.quitar_ipv4"
                        name="ipv4"
                    >
                        <UAlert
                            color="neutral"
                            variant="subtle"
                            icon="i-lucide-info"
                            :description="`Al guardar se libera ${servicio.ipv4} y el servicio toma su IP del pool del router en la próxima conexión.`"
                            data-prueba="aviso-quitar-ipv4"
                        />
                    </UFormField>
                    <p
                        v-if="estado.cambiar_ipv4 && !conPppoe"
                        class="text-xs text-muted"
                    >
                        {{ TIPOS_CONEXION[estado.tipo_conexion].etiqueta }}: la IPv4 es obligatoria; se cambia, no se quita.
                    </p>
                </section>

                <section
                    v-if="editaClave"
                    class="flex flex-col gap-3"
                    data-prueba="editar-credenciales"
                >
                    <span class="text-sm font-medium text-highlighted">Credenciales PPPoE</span>
                    <div class="grid gap-4 sm:grid-cols-2">
                        <UFormField
                            name="user_ppp"
                            label="Usuario PPPoE"
                            help="Letras, números, punto, guion, guion bajo o @."
                        >
                            <UInput
                                v-model="estado.user_ppp"
                                autocomplete="off"
                                class="w-full font-mono"
                                data-prueba="editar-user-ppp"
                            />
                        </UFormField>
                        <UFormField
                            name="pass_ppp"
                            label="Contraseña nueva"
                            help="Vacía: se queda la que tiene."
                        >
                            <UFieldGroup class="w-full">
                                <UInput
                                    v-model="estado.pass_ppp"
                                    :type="claveVisible ? 'text' : 'password'"
                                    autocomplete="new-password"
                                    class="w-full font-mono"
                                    data-prueba="editar-pass-ppp"
                                />
                                <UButton
                                    :icon="claveVisible ? 'i-lucide-eye-off' : 'i-lucide-eye'"
                                    color="neutral"
                                    variant="outline"
                                    :aria-label="claveVisible ? 'Ocultar contraseña' : 'Mostrar contraseña'"
                                    @click="claveVisible = !claveVisible"
                                />
                                <UButton
                                    icon="i-lucide-refresh-cw"
                                    color="neutral"
                                    variant="outline"
                                    aria-label="Generar contraseña"
                                    data-prueba="editar-generar-pass"
                                    @click="generarClave"
                                />
                            </UFieldGroup>
                        </UFormField>
                    </div>
                    <UAlert
                        v-if="cambianCredenciales"
                        color="warning"
                        variant="subtle"
                        icon="i-lucide-triangle-alert"
                        description="Al guardar, el cliente se desconecta y vuelve a conectarse con el usuario y la contraseña nuevos."
                        data-prueba="aviso-clave"
                    />
                </section>

                <div class="grid gap-4 sm:grid-cols-2">
                    <UFormField
                        name="mac"
                        label="MAC del equipo"
                        :required="estado.tipo_conexion === 'dhcp_fija' || estado.amarre_ip_mac"
                    >
                        <UInput
                            v-model="estado.mac"
                            placeholder="4C:5E:0C:12:34:56"
                            class="w-full font-mono"
                            data-prueba="editar-mac"
                        />
                    </UFormField>
                    <UFormField
                        v-if="!conPppoe"
                        name="amarre_ip_mac"
                        label="Amarre IP-MAC"
                        description="ARP estático: solo esa MAC usa la IP."
                    >
                        <UCheckbox
                            v-model="estado.amarre_ip_mac"
                            label="Amarrar la IP a la MAC"
                        />
                    </UFormField>
                </div>

                <div class="grid gap-4 sm:grid-cols-2">
                    <UFormField
                        name="ipv6_modo"
                        label="Modo IPv6"
                        :description="conPppoe ? undefined : 'Sin PPPoE no hay RADIUS.'"
                    >
                        <USelect
                            v-model="estado.ipv6_modo"
                            :items="itemsIpv6"
                            class="w-full"
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
                </div>

                <div class="grid gap-4 sm:grid-cols-2">
                    <UFormField
                        name="costo_override"
                        label="Precio especial"
                        description="Vacío: el precio del plan."
                    >
                        <UInput
                            v-model="estado.costo_override"
                            inputmode="decimal"
                            class="w-full"
                        >
                            <template #leading>
                                <span class="text-sm text-muted">Q</span>
                            </template>
                        </UInput>
                    </UFormField>
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
                    <USwitch
                        v-model="estado.excluir_firewall"
                        label="Excluir del firewall de corte"
                        class="sm:col-span-2"
                    />
                </div>

                <USeparator
                    label="Ubicación y contacto en sitio"
                    :ui="{ label: 'text-highlighted font-medium' }"
                />
                <div
                    class="grid gap-4 sm:grid-cols-2"
                    data-prueba="editar-ubicacion-contacto"
                >
                    <UFormField
                        name="direccion"
                        label="Dirección de instalación"
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
                        help="Cómo llegar: lo lee el técnico en la orden."
                        class="sm:col-span-2"
                    >
                        <UTextarea
                            v-model="estado.referencia"
                            :rows="2"
                            :maxlength="300"
                            autoresize
                            placeholder="Casa verde frente a la iglesia"
                            class="w-full"
                        />
                    </UFormField>
                    <UFormField
                        name="coordenadas"
                        label="Coordenadas"
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
                        help="Quién recibe al técnico."
                    >
                        <UInput
                            v-model="estado.contacto_nombre"
                            :maxlength="200"
                            icon="i-lucide-user-round"
                            class="w-full"
                        />
                    </UFormField>
                    <UFormField
                        name="contacto_telefono"
                        label="Teléfono del contacto"
                    >
                        <UInput
                            v-model="estado.contacto_telefono"
                            type="tel"
                            inputmode="tel"
                            placeholder="5512 3344"
                            icon="i-lucide-phone"
                            class="w-full"
                        />
                    </UFormField>
                </div>

                <PppoeLocalSinApiAlerta
                    v-if="credencialesRechazadas"
                    :router-id="servicio.router_id"
                    :detalle="problema?.detail ?? null"
                />
                <ProblemaAlerta
                    v-else-if="problema"
                    :problema="problema"
                    :reintentar="accionProblema?.accion"
                    :etiqueta-reintentar="accionProblema?.etiqueta"
                    :reintentando="recargando || enviando"
                    data-prueba="editar-servicio-error"
                />
            </UForm>
        </template>

        <template #footer>
            <div class="flex w-full justify-end gap-2">
                <UButton
                    label="Cancelar"
                    color="neutral"
                    variant="ghost"
                    :disabled="enviando"
                    @click="abierto = false"
                />
                <UButton
                    type="submit"
                    form="form-editar-servicio"
                    label="Guardar cambios"
                    icon="i-lucide-save"
                    :loading="enviando"
                    data-prueba="guardar-servicio"
                />
            </div>
        </template>
    </USlideover>
</template>
