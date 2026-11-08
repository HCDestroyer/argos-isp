<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { TabsItem } from '@nuxt/ui'

/**
 * Ficha del router (núcleo de routers, pedido del PM): cabecera con nombre, estado, modo de
 * seguridad y acciones; franja de salud (`RouterSalud`); y pestañas en este orden: Control de
 * velocidad (la primera y abierta por defecto), Red de acceso, Pools e IPs, Servicios, Conexión y
 * Avanzado (QoS, datos del equipo y baja). Es el destino del autologin desde Horus (`/routers/:id`,
 * `rutaDestino` de A1); la pestaña elegida va en `?pestana=`.
 * Si el router está registrado dos veces, el aviso de duplicados con «Unir»; si ya se unió a otro
 * (`unido_a_id`), el enlace al que quedó (`contratos/routers.md`).
 */
definePageMeta({ permiso: 'routers.ver' })

const route = useRoute()
const routerId = computed(() => Number(route.params.id))

const nas = shallowRef<RouterNas | null>(null)

/** «Corte por el túnel: sí/no» con el motivo (§5 ter.3, `Router.corte_por_tunel` de A1). */
const corteTunel = computed(() => (nas.value ? presentarCorteTunel(nas.value) : null))
const cargando = ref(true)
const problema = ref<Problem | null>(null)

useHead(() => ({ title: `${nas.value?.nombre ?? 'Router'} · ArgosIsp` }))

async function cargar() {
    cargando.value = true
    problema.value = null
    const resultado = Number.isInteger(routerId.value) && routerId.value > 0
        ? await useRouters().ver(routerId.value)
        : null
    cargando.value = false
    nas.value = resultado?.ok ? resultado.data : null
    problema.value = resultado && !resultado.ok ? resultado.problema : null
}

onMounted(cargar)

/** Sube al unir para volver a leer el direccionamiento (redes y bloques que llegaron o se fueron). */
const lecturas = ref(0)

function alUnir(resultado: UnionRouters) {
    lecturas.value++
    // Si esta ficha era la del absorbido, el router que sigue en uso es el que quedó.
    if (resultado.absorbido_id === routerId.value) {
        nas.value = resultado.absorbido
        return
    }
    nas.value = resultado.router
}

/** Tras probar la conexión o generar un script: estado en línea y sección «Conexión» al día. */
const seccionConexion = useTemplateRef('seccionConexion')
async function refrescar() {
    const resultado = await useRouters().ver(routerId.value)
    if (resultado.ok) {
        nas.value = resultado.data
    }
    await seccionConexion.value?.cargar()
}

const { puede } = usePermisos()
const toast = useToast()

/**
 * Eliminar sin historial (`contratos/eliminar.md`): con `routers.eliminar` (admin) se pregunta si
 * se puede; si nunca se usó, «Eliminar», y si no, los motivos y «Desactivar» (`PUT` con
 * `activo: false`, `routers.editar`). Un router inactivo se vuelve a activar igual.
 */
const puedeEliminar = computed(() => puede('routers.eliminar'))
const eliminable = shallowRef<Eliminable | null>(null)
const problemaEliminable = ref<Problem | null>(null)
const eliminarAbierto = ref(false)
const liberaRouter = ref<string[]>([])

async function cargarEliminable() {
    const actual = nas.value
    if (!actual || !puedeEliminar.value) {
        eliminable.value = null
        return
    }
    problemaEliminable.value = null
    const resultado = await useRouters().eliminable(actual.id)
    eliminable.value = resultado.ok ? resultado.data : null
    problemaEliminable.value = resultado.ok ? null : resultado.problema
}

watch(() => [nas.value?.id, nas.value?.version], () => void cargarEliminable())

/** Lo que se libera: sus redes IPv4 y sus bloques IPv6 con sus pools (los planes se conservan). */
async function abrirEliminar() {
    const actual = nas.value
    if (!actual) {
        return
    }
    // Sin `redes.ver` / `ipv6.ver` no se listan: se dice en general.
    const [redes, bloques] = await Promise.all([
        puede('redes.ver') ? useRouters().redesIpv4(actual.id) : null,
        puede('ipv6.ver') ? useRouters().ipv6Bloques(actual.id) : null,
    ])
    liberaRouter.value = [
        ...(actual.nas_ip ? [`NAS ${actual.nas_ip}`] : []),
        ...(redes?.ok ? redes.data.map(r => `Red IPv4 ${r.cidr}`) : ['Sus redes IPv4']),
        ...(bloques?.ok ? bloques.data.map(b => `Bloque IPv6 ${b.prefijo} con sus pools`) : ['Sus bloques y pools IPv6']),
        'Los planes no se borran: solo deja de estar en ellos',
    ]
    eliminarAbierto.value = true
}

function alEliminar() {
    toast.add({ title: `${nas.value?.nombre ?? 'Router'} eliminado`, description: 'Sus redes y pools quedaron libres.', icon: 'i-lucide-trash-2', color: 'success' })
    void navigateTo('/routers')
}

const cambiarActivoAbierto = ref(false)
const cambiandoActivo = ref(false)
const problemaActivo = ref<Problem | null>(null)

async function cambiarActivo() {
    const actual = nas.value
    if (!actual) {
        return
    }
    cambiandoActivo.value = true
    problemaActivo.value = null
    const resultado = await useRouters().editar(actual.id, { version: actual.version, activo: !actual.activo })
    cambiandoActivo.value = false
    if (!resultado.ok) {
        problemaActivo.value = resultado.problema
        return
    }
    nas.value = resultado.data
    cambiarActivoAbierto.value = false
    toast.add({ title: resultado.data.activo ? `${resultado.data.nombre} activado` : `${resultado.data.nombre} desactivado`, icon: 'i-lucide-circle-check', color: 'success' })
}

watch(cambiarActivoAbierto, (valor) => {
    if (valor) {
        problemaActivo.value = null
    }
})

/* Pestañas: «Control de velocidad» primero y abierta por defecto; la elegida va en `?pestana=`. */
const PESTANAS = ['velocidad', 'red-acceso', 'pools', 'servicios', 'conexion', 'avanzado'] as const
type Pestana = typeof PESTANAS[number]

function esPestana(valor: unknown): valor is Pestana {
    return typeof valor === 'string' && (PESTANAS as readonly string[]).includes(valor)
}

const pestana = computed<Pestana>({
    get: () => esPestana(route.query.pestana) ? route.query.pestana : 'velocidad',
    set: (valor) => {
        void navigateTo({ query: { ...route.query, pestana: valor === 'velocidad' ? undefined : valor } }, { replace: true })
    },
})

const pestanas = computed<TabsItem[]>(() => [
    { label: 'Control de velocidad', value: 'velocidad', icon: 'i-lucide-gauge', slot: 'velocidad' as const },
    { label: 'Red de acceso', value: 'red-acceso', icon: 'i-lucide-cable', slot: 'red-acceso' as const },
    { label: 'Pools e IPs', value: 'pools', icon: 'i-lucide-network', slot: 'pools' as const },
    { label: 'Servicios', value: 'servicios', icon: 'i-lucide-users', slot: 'servicios' as const },
    { label: 'Conexión', value: 'conexion', icon: 'i-lucide-plug-zap', slot: 'conexion' as const },
    { label: 'Avanzado', value: 'avanzado', icon: 'i-lucide-settings-2', slot: 'avanzado' as const },
])

const pruebaAbierta = ref(false)
const salud = useTemplateRef('salud')

function alActualizar(router: RouterNas) {
    nas.value = router
}

async function alProbar() {
    await refrescar()
    salud.value?.cargar()
}
</script>

<template>
    <PanelPagina
        id="router"
        titulo="Router"
        icono="i-lucide-router"
    >
        <template #acciones>
            <UButton
                to="/routers"
                icon="i-lucide-arrow-left"
                label="Routers"
                color="neutral"
                variant="ghost"
                class="hidden sm:inline-flex"
            />
        </template>

        <div class="mx-auto flex w-full max-w-6xl flex-col gap-6">
            <UAlert
                v-if="!cargando && nas?.unido_a_id"
                color="info"
                variant="subtle"
                icon="i-lucide-merge"
                title="Este router se unió a otro"
                description="Era el mismo MikroTik registrado dos veces: sus servicios, sesiones, redes y planes pasaron al router que quedó. Este registro queda desactivado con su historial."
                :actions="[{ label: 'Ver el router que quedó', to: `/routers/${nas.unido_a_id}`, icon: 'i-lucide-arrow-right', color: 'info', variant: 'outline' }]"
                data-prueba="router-unido"
            />
            <RoutersDuplicadosAviso
                v-if="!cargando && nas?.activo"
                :router-id="nas.id"
                @unido="alUnir"
            />
            <USkeleton
                v-if="cargando"
                class="h-40 w-full"
            />
            <UEmpty
                v-else-if="problema?.status === 404 || (!problema && !nas)"
                icon="i-lucide-router"
                title="Router no encontrado"
                :description="`No existe un router con id ${route.params.id}.`"
                :actions="[{ label: 'Volver a routers', to: '/routers', icon: 'i-lucide-arrow-left', color: 'neutral', variant: 'subtle' }]"
            />
            <ProblemaAlerta
                v-else-if="problema"
                :problema="problema"
                :reintentar="cargar"
                :reintentando="cargando"
            />
            <template v-else-if="nas">
                <header
                    class="surface-card flex flex-col gap-4 p-4 sm:flex-row sm:items-start sm:justify-between sm:p-6"
                    aria-label="Router"
                    data-prueba="router-cabecera"
                >
                    <div class="flex min-w-0 items-start gap-3">
                        <span class="flex size-11 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                            <UIcon
                                name="i-lucide-router"
                                class="size-6"
                            />
                        </span>
                        <div class="flex min-w-0 flex-col gap-1.5">
                            <h1 class="truncate text-lg font-semibold text-highlighted">
                                {{ nas.nombre }}
                            </h1>
                            <div class="flex flex-wrap items-center gap-1.5">
                                <UBadge
                                    :label="nas.activo ? 'Activo' : 'Inactivo'"
                                    :icon="nas.activo ? 'i-lucide-circle-check' : 'i-lucide-circle-pause'"
                                    :color="nas.activo ? 'success' : 'neutral'"
                                    variant="subtle"
                                    size="sm"
                                    data-prueba="router-estado"
                                />
                                <UBadge
                                    :label="MODOS_SEGURIDAD[nas.modo_seguridad].etiqueta"
                                    :icon="MODOS_SEGURIDAD[nas.modo_seguridad].icono"
                                    :color="MODOS_SEGURIDAD[nas.modo_seguridad].color"
                                    variant="subtle"
                                    size="sm"
                                    data-prueba="router-modo-seguridad"
                                />
                                <UBadge
                                    :label="`Corte ${CORTE_IDENTIFICACION[nas.corte_identificacion].etiqueta.toLowerCase()}`"
                                    :icon="CORTE_IDENTIFICACION[nas.corte_identificacion].icono"
                                    :title="CORTE_IDENTIFICACION[nas.corte_identificacion].descripcion"
                                    color="neutral"
                                    variant="subtle"
                                    size="sm"
                                    data-prueba="router-corte-identificacion"
                                />
                                <UBadge
                                    v-if="corteTunel"
                                    :label="corteTunel.etiqueta"
                                    :icon="corteTunel.icono"
                                    :color="corteTunel.color"
                                    variant="subtle"
                                    size="sm"
                                    data-prueba="router-corte-tunel"
                                />
                                <UBadge
                                    :label="nas.routeros_version ? `RouterOS ${nas.routeros_version}` : 'RouterOS ?'"
                                    icon="i-lucide-cpu"
                                    color="neutral"
                                    variant="subtle"
                                    size="sm"
                                />
                            </div>
                            <p class="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted">
                                <span>Host <span class="font-mono text-default">{{ nas.host }}</span></span>
                                <span>NAS <span
                                    :class="nas.nas_ip ? 'font-mono text-default' : 'text-default'"
                                    data-prueba="router-nas-ip"
                                >{{ textoNas(nas) }}</span></span>
                            </p>
                            <p
                                v-if="corteTunel?.motivo"
                                class="text-xs text-muted"
                                data-prueba="router-corte-tunel-motivo"
                            >
                                Por qué el corte no va por el túnel: {{ corteTunel.motivo }}
                            </p>
                            <p
                                v-if="esSinRadius(nas)"
                                class="text-xs text-muted"
                                data-prueba="router-pppoe-sin-radius"
                            >
                                {{ PPPOE_EN_ROUTER_SIN_RADIUS }}
                            </p>
                            <p
                                v-if="esSinRadius(nas) && !tieneCredencialesApi(nas)"
                                class="text-xs text-warning"
                            >
                                Sin usuario y contraseña de la API no se pueden crear servicios PPPoE aquí.
                            </p>
                        </div>
                    </div>
                    <div class="flex flex-wrap items-center gap-2 sm:justify-end">
                        <UButton
                            v-if="puede('routers.probar_conexion')"
                            label="Probar conexión"
                            icon="i-lucide-activity"
                            color="neutral"
                            variant="outline"
                            data-prueba="probar-conexion-cabecera"
                            @click="pruebaAbierta = true"
                        />
                        <VerEnHorusBoton
                            tipo="router"
                            :id-externo="nas.id"
                        />
                        <RouterAcciones
                            :router="nas"
                            con-editar
                            @actualizado="alActualizar"
                            @probado="alProbar"
                        />
                    </div>
                </header>

                <RouterSalud
                    ref="salud"
                    :router="nas"
                />

                <UTabs
                    v-model="pestana"
                    :items="pestanas"
                    variant="link"
                    :ui="{ list: 'overflow-x-auto', trigger: 'shrink-0', content: 'pt-4' }"
                    data-prueba="pestanas-router"
                >
                    <template #velocidad>
                        <div class="flex flex-col gap-6">
                            <RouterTipoConexion
                                :router="nas"
                                @actualizado="alActualizar"
                            />
                            <RouterControlVelocidad
                                :router="nas"
                                @actualizado="alActualizar"
                            />
                        </div>
                    </template>
                    <template #red-acceso>
                        <RouterRedAcceso
                            v-if="puede('red_acceso.ver')"
                            :router="nas"
                        />
                        <UEmpty
                            v-else
                            icon="i-lucide-lock"
                            title="Sin permiso para ver la red de acceso"
                            description="Pide a un administrador el permiso «red_acceso.ver»."
                            variant="naked"
                        />
                    </template>
                    <template #pools>
                        <RouterDireccionamiento
                            :key="lecturas"
                            :router-id="nas.id"
                        />
                    </template>
                    <template #servicios>
                        <RouterSeccion
                            id-titulo="titulo-servicios-router"
                            titulo="Servicios"
                            icono="i-lucide-users"
                            descripcion="Los servicios de este router, con su estado y su plan, están en la lista de servicios filtrada por router."
                        >
                            <template
                                v-if="puede('servicios.ver')"
                                #acciones
                            >
                                <UButton
                                    :to="`/servicios?router=${nas.id}`"
                                    label="Ver servicios del router"
                                    icon="i-lucide-arrow-right"
                                    color="neutral"
                                    variant="outline"
                                    data-prueba="ver-servicios-router"
                                />
                            </template>
                        </RouterSeccion>
                    </template>
                    <template #conexion>
                        <RouterConexionSeccion
                            ref="seccionConexion"
                            :router="nas"
                        />
                    </template>
                    <template #avanzado>
                        <div class="flex flex-col gap-6">
                            <RouterQos
                                v-if="puede('qos.ver')"
                                :router="nas"
                                @actualizado="alActualizar"
                                @recargar="cargar"
                            />
                            <RouterSeccion
                                id-titulo="titulo-datos-router"
                                titulo="Datos del equipo"
                                icono="i-lucide-hard-drive"
                            >
                                <dl class="grid gap-4 sm:grid-cols-3">
                                    <DatoFicha
                                        etiqueta="Host"
                                        :valor="nas.host"
                                        mono
                                    />
                                    <DatoFicha
                                        etiqueta="API"
                                        :valor="nas.api_url ?? `https://${nas.host}`"
                                        mono
                                    />
                                    <DatoFicha
                                        etiqueta="Serial"
                                        :valor="nas.serial ?? 'Sin leer'"
                                        :mono="Boolean(nas.serial)"
                                    />
                                    <DatoFicha
                                        etiqueta="Servidor DHCP"
                                        :valor="nas.dhcp_servidor ?? 'El de la configuración'"
                                        :mono="Boolean(nas.dhcp_servidor)"
                                    />
                                    <DatoFicha
                                        etiqueta="Interfaz de clientes"
                                        :valor="nas.interfaz_clientes ?? 'La de la configuración'"
                                        :mono="Boolean(nas.interfaz_clientes)"
                                    />
                                    <DatoFicha
                                        etiqueta="Último contacto"
                                        :valor="nas.ultimo_contacto ? `${formatearFechaHora(nas.ultimo_contacto)} (${textoUltimoContacto(nas)})` : 'Nunca respondió'"
                                    />
                                </dl>
                            </RouterSeccion>
                            <RouterSeccion
                                v-if="puede('routers.editar') || puedeEliminar"
                                id-titulo="titulo-baja-router"
                                titulo="Baja del router"
                                icono="i-lucide-power"
                                data-prueba="router-baja"
                            >
                                <ProblemaAlerta
                                    v-if="problemaEliminable"
                                    :problema="problemaEliminable"
                                    :reintentar="cargarEliminable"
                                />
                                <div class="flex flex-wrap items-center gap-2">
                                    <UButton
                                        v-if="puedeEliminar && eliminable?.eliminable"
                                        label="Eliminar"
                                        icon="i-lucide-trash-2"
                                        color="error"
                                        variant="outline"
                                        data-prueba="eliminar-router"
                                        @click="abrirEliminar"
                                    />
                                    <UButton
                                        v-if="puede('routers.editar') && !eliminable?.eliminable"
                                        :label="nas.activo ? 'Desactivar' : 'Activar'"
                                        :icon="nas.activo ? 'i-lucide-circle-pause' : 'i-lucide-circle-play'"
                                        color="neutral"
                                        variant="outline"
                                        data-prueba="cambiar-activo-router"
                                        @click="cambiarActivoAbierto = true"
                                    />
                                </div>
                                <p
                                    v-if="puedeEliminar && eliminable?.eliminable"
                                    class="text-xs text-muted"
                                >
                                    Nunca se usó: se puede borrar del todo.
                                </p>
                                <p
                                    v-else-if="puedeEliminar && eliminable"
                                    class="flex items-start gap-1.5 text-xs text-muted"
                                    data-prueba="no-eliminable"
                                >
                                    <UIcon
                                        name="i-lucide-history"
                                        class="mt-0.5 size-3.5 shrink-0"
                                    />
                                    <span>{{ textoNoEliminable('router', eliminable.motivos, !nas.activo) }}</span>
                                </p>
                            </RouterSeccion>
                        </div>
                    </template>
                </UTabs>
            </template>
        </div>

        <RouterPruebaConexionModal
            v-if="nas && puede('routers.probar_conexion')"
            v-model:open="pruebaAbierta"
            :router="nas"
            @probado="alProbar"
            @actualizado="alActualizar"
        />
        <EliminarRegistroModal
            v-if="nas && puedeEliminar && eliminable?.eliminable"
            :id="nas.id"
            v-model:open="eliminarAbierto"
            tipo="router"
            :nombre="nas.nombre"
            :version="nas.version"
            :libera="liberaRouter"
            @eliminado="alEliminar"
            @recargar="cargar"
        />

        <UModal
            v-if="nas && puede('routers.editar')"
            v-model:open="cambiarActivoAbierto"
            :title="nas.activo ? `Desactivar ${nas.nombre}` : `Activar ${nas.nombre}`"
            :description="nas.activo ? 'Argos deja de enviarle comandos. Su historial se conserva y lo encuentras en «Inactivos» de la lista de routers.' : 'Argos vuelve a enviarle comandos y aparece en la lista de routers activos.'"
            :dismissible="!cambiandoActivo"
        >
            <template #body>
                <ProblemaAlerta
                    v-if="problemaActivo"
                    :problema="problemaActivo"
                    :reintentar="problemaActivo.status === 409 ? cargar : undefined"
                />
                <p
                    v-else
                    class="text-sm text-muted"
                >
                    {{ nas.activo ? 'Puedes volver a activarlo cuando quieras.' : 'Revisa que el router esté en línea antes de activarlo.' }}
                </p>
            </template>
            <template #footer>
                <div class="flex w-full justify-end gap-2">
                    <UButton
                        label="Cancelar"
                        color="neutral"
                        variant="ghost"
                        :disabled="cambiandoActivo"
                        @click="cambiarActivoAbierto = false"
                    />
                    <UButton
                        :label="nas.activo ? 'Desactivar' : 'Activar'"
                        :color="nas.activo ? 'warning' : 'primary'"
                        :loading="cambiandoActivo"
                        data-prueba="confirmar-activo-router"
                        @click="cambiarActivo"
                    />
                </div>
            </template>
        </UModal>
    </PanelPagina>
</template>
