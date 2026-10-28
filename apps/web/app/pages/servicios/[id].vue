<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import Decimal from 'decimal.js'

definePageMeta({ permiso: 'servicios.ver' })

const route = useRoute()
const { puede, enlace } = usePermisos()
const toast = useToast()

const servicioId = computed(() => Number(route.params.id))

const servicio = shallowRef<Servicio | null>(null)
/** Servicio importado (Mikrowisp): «Importado de Mikrowisp #id», discreto bajo el título. */
const origen = computed(() => (servicio.value ? origenExterno(servicio.value) : null))
const cargando = ref(true)
const problema = ref<Problem | null>(null)

/** Velocidades y precio del plan (`planes.ver`); el nombre viene en `Servicio.plan_nombre`. */
const plan = shallowRef<Plan | null>(null)
const plantilla = shallowRef<PlantillaFacturacion | null>(null)

const sesion = shallowRef<Sesion | null>(null)
const cargandoSesion = ref(false)
const problemaSesion = ref<Problem | null>(null)

const promesas = shallowRef<Promesa[]>([])
const cargandoPromesas = ref(false)
const problemaPromesas = ref<Problem | null>(null)
const promesaAbierta = ref(false)
/** Lo pendiente del servicio (estado de cuenta), para sugerir el monto de la promesa. */
const pendienteServicio = ref<string | null>(null)

const accionAbierta = ref(false)
const accionElegida = shallowRef<PresentacionAccionServicio | null>(null)
const lineaTiempo = useTemplateRef<{ recargar: () => Promise<void> }>('linea')
const historialAsignaciones = useTemplateRef<{ recargar: () => Promise<void> }>('asignaciones')

useHead(() => ({ title: `${servicio.value ? etiquetaServicio(servicio.value) : 'Servicio'} · ArgosIsp` }))

const editando = ref(false)
const puedeEditar = computed(() => puede('servicios.editar') && servicio.value !== null && servicio.value.estado !== 'retirado')
/** Sin PPPoE (WISP) no hay credenciales ni sesión RADIUS. */
const conPppoe = computed(() => servicio.value !== null && esPppoe(servicio.value))

function alEditar(actualizado: Servicio) {
    servicio.value = actualizado
    toast.add({ title: 'Servicio actualizado', description: `${TIPOS_CONEXION[tipoConexionDe(actualizado)].corta} · ${etiquetaServicio(actualizado)}`, icon: 'i-lucide-circle-check', color: 'success' })
    void cargarRelacionados(actualizado)
    void cargarSesion()
    void lineaTiempo.value?.recargar()
    void historialAsignaciones.value?.recargar()
}

/**
 * Botones de acción: solo los que el usuario puede (permiso con el mismo nombre de la acción) y
 * que aplican al estado actual; un botón deshabilitado se confundía con uno activo.
 */
const acciones = computed(() => ACCIONES_SERVICIO.filter(a => puede(a.permiso) && aplica(a)))

/** Pendiente de instalación (`contratos/instalacion.md`): sin facturas, no hay promesa (422 de A3). */
const pendiente = computed(() => servicio.value !== null && esPendienteInstalacion(servicio.value))
const sinPromesas = computed(() => servicio.value === null || servicio.value.estado === 'retirado' || pendiente.value)
const puedePromesa = computed(() => puede('promesas.crear') && !sinPromesas.value)
const puedeSimular = computed(() => puede('promesas.ver') && !sinPromesas.value)
/** «Activar instalación» con su permiso exacto, solo sobre un pendiente (si no, 422 `servicio_no_pendiente`). */
const puedeActivarInstalacion = computed(() => puede('servicios.activar_instalacion') && pendiente.value)
const activarAbierto = ref(false)
const planta = computed(() => (servicio.value ? datosPlanta(servicio.value) : []))

function alActivarInstalacion(actualizado: Servicio) {
    servicio.value = actualizado
    toast.add({
        title: 'Instalación activada',
        description: `${etiquetaServicio(actualizado)} · ${ESTADOS_SERVICIO[actualizado.estado].etiqueta} desde ${formatearFechaHora(actualizado.instalado_en)}`,
        icon: 'i-lucide-circle-check',
        color: 'success',
    })
    void cargarSesion()
    void lineaTiempo.value?.recargar()
    void configuracionEfectiva.value?.recargar()
}

/** Tras un 409 en el modal: la ficha toma la versión y el estado actuales. */
function alRecargarServicio(actualizado: Servicio) {
    servicio.value = actualizado
}

/** Multiempresa: la empresa del servicio se ve y se cambia solo si hay más de una. */
const { conSelector: variasEmpresas, nombre: nombreEmpresa } = useEmpresaActiva()
const puedeCambiarEmpresa = computed(() => variasEmpresas.value && puede('servicios.cambiar_empresa') && servicio.value !== null && servicio.value.estado !== 'retirado')
const cambiarEmpresaAbierto = ref(false)

function alCambiarEmpresa(actualizado: Servicio) {
    servicio.value = actualizado
    toast.add({ title: 'Empresa cambiada', description: `${etiquetaServicio(actualizado)} factura ahora con ${nombreEmpresa(actualizado.empresa_id)}`, icon: 'i-lucide-circle-check', color: 'success' })
    void lineaTiempo.value?.recargar()
}
const simuladorAbierto = ref(false)
/** Cargo único (A3): instalación, equipo…; con todo descontado queda como bonificación. */
const puedeCargoUnico = computed(() => puede('facturas.emitir_cargo_unico') && puede('facturas.ver') && servicio.value !== null && servicio.value.estado !== 'retirado')
const cargoAbierto = ref(false)
const periodosBonificados = useTemplateRef('periodosBonificados')

async function alEmitirCargo(resultado: CargoUnicoEmitido) {
    void lineaTiempo.value?.recargar()
    if (resultado.documento === 'bonificacion' && resultado.bonificacion) {
        toast.add({ title: 'Bonificación registrada', description: `Sin costo: ${formatearQuetzales(resultado.bonificacion.bruto)} · ${resultado.bonificacion.motivo_nombre}`, icon: 'i-lucide-hand-heart', color: 'success' })
        void periodosBonificados.value?.recargar()
        await navigateTo(`/bonificaciones/${resultado.bonificacion.id}`)
        return
    }
    if (resultado.factura) {
        toast.add({ title: 'Cargo único emitido', description: `Factura #${resultado.factura.id} por ${formatearQuetzales(resultado.factura.total)}`, icon: 'i-lucide-receipt', color: 'success' })
        await navigateTo(`/facturas/${resultado.factura.id}`)
    }
}

/**
 * Captura 07: sin `excluir_canal` una página de 50 podía venir llena de `portal.quien_soy` (una por
 * visita a `/corte`) y el historial quedaba vacío con "Ver más". La API ya las deja fuera.
 */
const filtrosLinea = computed<FiltrosAcciones>(() => ({ entidad_tipo: 'servicio', entidad_id: servicioId.value, excluir_canal: 'portal' }))

const MODOS_IPV6: Record<ModoIpv6, string> = {
    radius_servicio: 'RADIUS (prefijos del servicio)',
    radius_pool: 'RADIUS (pool del router)',
    duid: 'Por DUID',
    estatico: 'Estático',
    ninguno: 'Sin IPv6',
}

function aplica(accion: PresentacionAccionServicio): boolean {
    return servicio.value !== null && accionDisponible(accion, servicio.value)
}

function abrirAccion(accion: PresentacionAccionServicio) {
    accionElegida.value = accion
    accionAbierta.value = true
}

/** Lecturas de la sesión: cada una vuelve a lanzar el anillo del punto "en vivo". */
const latidoSesion = ref(0)
const sesionLeidaEn = ref<string | null>(null)

async function cargarSesion() {
    if (!puede('sesiones.ver') || !conPppoe.value) {
        sesion.value = null
        return
    }
    cargandoSesion.value = true
    const resultado = await useSesiones().activaDe(servicioId.value)
    cargandoSesion.value = false
    sesion.value = resultado.ok ? resultado.data : null
    problemaSesion.value = resultado.ok ? null : resultado.problema
    if (resultado.ok) {
        latidoSesion.value += 1
        sesionLeidaEn.value = new Date().toISOString()
    }
}

/** La sesión es un dato en vivo: se relee cada 30 s mientras la pestaña está a la vista. */
const REFRESCO_SESION_MS = 30_000
let refrescoSesion: ReturnType<typeof setInterval> | undefined

onMounted(() => {
    refrescoSesion = setInterval(() => {
        if (document.visibilityState === 'visible' && !cargandoSesion.value) {
            void cargarSesion()
        }
    }, REFRESCO_SESION_MS)
})
onBeforeUnmount(() => clearInterval(refrescoSesion))

async function cargarPromesas() {
    if (!puede('promesas.ver')) {
        return
    }
    cargandoPromesas.value = true
    const resultado = await usePromesas().listar({ servicio_id: servicioId.value, limit: 10 })
    cargandoPromesas.value = false
    promesas.value = resultado.ok ? resultado.data.data : []
    problemaPromesas.value = resultado.ok ? null : resultado.problema
}

async function cargarPendiente(actual: Servicio) {
    pendienteServicio.value = null
    if (!puede('clientes.estado_cuenta')) {
        return
    }
    const resultado = await useClientes().estadoCuenta(actual.cliente_id)
    if (!resultado.ok) {
        return
    }
    const pendiente = resultado.data.facturas_pendientes
        .filter(f => f.servicio_id === actual.id)
        .reduce((suma, f) => suma.plus(saldoFactura(f)), new Decimal(0))
    pendienteServicio.value = pendiente.gt(0) ? pendiente.toFixed(2) : null
}

function abrirPromesa() {
    if (servicio.value) {
        void cargarPendiente(servicio.value)
    }
    promesaAbierta.value = true
}

async function alCrearPromesa() {
    void cargarPromesas()
    void lineaTiempo.value?.recargar()
    // Una promesa activa puede reactivar el servicio (evaluarEstadoServicio).
    const resultado = await useServicios().ver(servicioId.value)
    if (resultado.ok) {
        servicio.value = resultado.data
    }
}

async function cargarRelacionados(actual: Servicio) {
    const [resultadoPlanes, resultadoPlantillas] = await Promise.all([
        puede('planes.ver') ? usePlanes().listar() : null,
        puede('plantillas.ver') && actual.plantilla_facturacion_id ? usePlantillas().listar() : null,
    ])
    plan.value = resultadoPlanes?.ok ? (resultadoPlanes.data.data.find(p => p.id === actual.plan_id) ?? null) : null
    plantilla.value = resultadoPlantillas?.ok ? (resultadoPlantillas.data.find(p => p.id === actual.plantilla_facturacion_id) ?? null) : null
}

async function cargar() {
    cargando.value = true
    problema.value = null
    const resultado = await useServicios().ver(servicioId.value)
    cargando.value = false
    if (!resultado.ok) {
        servicio.value = null
        problema.value = resultado.problema
        return
    }
    servicio.value = resultado.data
    void cargarRelacionados(resultado.data)
    void cargarSesion()
    void cargarPromesas()
}

function alTerminar(actualizado: Servicio, accion: PresentacionAccionServicio) {
    servicio.value = actualizado
    toast.add({
        title: accion.hecho,
        description: `${etiquetaServicio(actualizado)} · ${ESTADOS_SERVICIO[actualizado.estado].etiqueta}`,
        icon: accion.icono,
        color: 'success',
    })
    void cargarSesion()
    void lineaTiempo.value?.recargar()
    // Retirar libera IPv4 y prefijos: cierra el tramo vigente.
    void historialAsignaciones.value?.recargar()
}

const configuracionEfectiva = useTemplateRef<{ recargar: () => Promise<void> }>('configuracionEfectiva')

/** Un plan temporal que empieza o se cancela cambia el plan del servicio: se relee la ficha. */
async function alCambiarPlanTemporal() {
    const resultado = await useServicios().ver(servicioId.value)
    if (resultado.ok) {
        servicio.value = resultado.data
        void cargarRelacionados(resultado.data)
    }
    void configuracionEfectiva.value?.recargar()
    void lineaTiempo.value?.recargar()
}

const precio = computed(() => servicio.value?.costo_override ?? plan.value?.precio ?? null)

watch(servicioId, cargar)
onMounted(cargar)
</script>

<template>
    <PanelPagina
        id="servicio"
        :titulo="servicio ? etiquetaServicio(servicio) : 'Servicio'"
        icono="i-lucide-wifi"
    >
        <template #acciones>
            <VerEnHorusBoton
                v-if="servicio"
                tipo="servicio"
                :id-externo="servicio.id"
            />
            <UButton
                v-if="puedeEditar"
                label="Editar"
                icon="i-lucide-pencil"
                color="neutral"
                variant="outline"
                data-prueba="editar-servicio"
                @click="editando = true"
            />
            <UButton
                to="/servicios"
                icon="i-lucide-arrow-left"
                label="Servicios"
                color="neutral"
                variant="ghost"
                class="hidden sm:inline-flex"
            />
        </template>

        <div
            v-if="cargando && !servicio"
            class="flex flex-col gap-4"
        >
            <USkeleton class="h-8 w-64" />
            <USkeleton class="h-10 w-full" />
            <USkeleton class="h-48 w-full" />
        </div>

        <UEmpty
            v-else-if="problema?.status === 404"
            icon="i-lucide-wifi-off"
            title="Servicio no encontrado"
            :description="`No existe un servicio con id ${route.params.id}.`"
            :actions="[{ label: 'Volver a servicios', to: '/servicios', icon: 'i-lucide-arrow-left', color: 'neutral', variant: 'subtle' }]"
        />

        <ProblemaAlerta
            v-else-if="problema"
            :problema="problema"
            :reintentar="cargar"
            :reintentando="cargando"
        />

        <div
            v-else-if="servicio"
            class="flex flex-col gap-6"
        >
            <div class="flex flex-col gap-1">
                <div class="flex flex-wrap items-center gap-2">
                    <h2 class="break-all font-mono text-xl font-semibold text-highlighted">
                        {{ etiquetaServicio(servicio) }}
                    </h2>
                    <EstadoServicioBadge :estado="servicio.estado" />
                    <TipoPlanBadge
                        :tipo="servicio.plan_tipo"
                        data-prueba="tipo-plan-servicio"
                    />
                    <UBadge
                        :label="TIPOS_CONEXION[tipoConexionDe(servicio)].etiqueta"
                        :icon="TIPOS_CONEXION[tipoConexionDe(servicio)].icono"
                        color="neutral"
                        variant="outline"
                        data-prueba="tipo-conexion"
                    />
                    <UBadge
                        v-if="servicio.promesa_activa"
                        :label="PROMESA_ACTIVA.etiqueta"
                        :icon="PROMESA_ACTIVA.icono"
                        :color="PROMESA_ACTIVA.color"
                        variant="outline"
                    />
                    <SuspensionManualBadge :servicio="servicio" />
                    <UBadge
                        v-if="variasEmpresas"
                        :label="nombreEmpresa(servicio.empresa_id)"
                        icon="i-lucide-building-2"
                        color="neutral"
                        variant="outline"
                        data-prueba="empresa-servicio"
                    />
                </div>
                <p class="text-sm text-muted">
                    Servicio #{{ servicio.id }} ·
                    <ULink
                        :to="enlace(`/clientes/${servicio.cliente_id}`)"
                        class="text-default underline underline-offset-2 hover:text-primary"
                    >
                        {{ nombreCliente(servicio) }}
                    </ULink>
                    <template v-if="nombreZona(servicio)">
                        · {{ nombreZona(servicio) }}
                    </template>
                    · versión {{ servicio.version }}
                </p>
                <p
                    v-if="origen"
                    class="flex items-center gap-1.5 text-xs text-dimmed"
                    data-prueba="servicio-importado"
                >
                    <UIcon
                        name="i-lucide-import"
                        class="size-3.5 shrink-0"
                    />
                    {{ textoImportado(origen) }}
                </p>
            </div>

            <UAlert
                v-if="servicio.suspension_manual"
                color="error"
                variant="subtle"
                icon="i-lucide-hand"
                title="Suspendido manualmente"
                data-prueba="aviso-suspension-manual"
            >
                <template #description>
                    <p v-if="servicio.suspension_manual_motivo">
                        Motivo: {{ servicio.suspension_manual_motivo }}
                    </p>
                    <p>
                        El corte automático y los pagos no lo reactivan, y no se puede limitar ni quitar el límite.
                        Solo <strong>Reactivar</strong> quita la suspensión manual.
                    </p>
                </template>
            </UAlert>

            <UAlert
                v-if="pendiente"
                color="info"
                variant="subtle"
                icon="i-lucide-hard-hat"
                title="Pendiente de instalación"
                data-prueba="aviso-pendiente-instalacion"
            >
                <template #description>
                    <p>
                        Ya tiene usuario PPPoE, router, plan e IP para configurar el equipo, pero no navega ni factura.
                        La facturación arranca al <strong>activar la instalación</strong>.
                    </p>
                    <p>
                        Mientras tanto no se puede suspender, limitar, reactivar, desconectar ni programar un plan temporal; sí editarlo o retirarlo si la venta se cae.
                    </p>
                </template>
            </UAlert>

            <div
                v-if="acciones.length || puedeActivarInstalacion || puedePromesa || puedeSimular || puedeCambiarEmpresa || puedeCargoUnico"
                class="flex flex-wrap gap-2"
                role="group"
                aria-label="Acciones del servicio"
            >
                <UButton
                    v-if="puedeActivarInstalacion"
                    label="Activar instalación"
                    icon="i-lucide-hard-hat"
                    color="success"
                    data-prueba="abrir-activar-instalacion"
                    @click="activarAbierto = true"
                />
                <UButton
                    v-for="accion in acciones"
                    :key="accion.accion"
                    :label="accion.etiqueta"
                    :icon="accion.icono"
                    :color="accion.color"
                    variant="outline"
                    @click="abrirAccion(accion)"
                />
                <UButton
                    v-if="puedePromesa"
                    label="Promesa de pago"
                    icon="i-lucide-calendar-clock"
                    color="info"
                    variant="outline"
                    @click="abrirPromesa"
                />
                <UButton
                    v-if="puedeCargoUnico"
                    label="Cargo único"
                    icon="i-lucide-receipt"
                    color="neutral"
                    variant="outline"
                    data-prueba="abrir-cargo-unico"
                    @click="cargoAbierto = true"
                />
                <UButton
                    v-if="puedeSimular"
                    label="Simular promesa"
                    icon="i-lucide-flask-conical"
                    color="neutral"
                    variant="outline"
                    data-prueba="abrir-simulador"
                    @click="simuladorAbierto = true"
                />
                <UButton
                    v-if="puedeCambiarEmpresa"
                    label="Cambiar empresa"
                    icon="i-lucide-arrow-right-left"
                    color="neutral"
                    variant="outline"
                    data-prueba="abrir-cambiar-empresa"
                    @click="cambiarEmpresaAbierto = true"
                />
            </div>
            <p
                v-else-if="servicio.estado === 'retirado'"
                class="text-sm text-muted"
            >
                Servicio retirado: ya no admite acciones.
            </p>

            <div class="grid gap-4 lg:grid-cols-2">
                <UPageCard
                    title="Plan y facturación"
                    icon="i-lucide-gauge"
                    variant="subtle"
                >
                    <dl class="grid gap-x-6 gap-y-4 sm:grid-cols-2">
                        <DatoFicha
                            etiqueta="Plan"
                            :valor="nombrePlan(servicio)"
                        />
                        <DatoFicha
                            etiqueta="Precio mensual"
                            :valor="precio ? `${formatearQuetzales(precio)}${servicio.costo_override ? ' (precio especial)' : ''}` : null"
                        />
                        <DatoFicha
                            v-if="plan"
                            etiqueta="Velocidad"
                            :valor="`${formatearVelocidad(plan.bajada_kbps)} ↓ / ${formatearVelocidad(plan.subida_kbps)} ↑`"
                        />
                        <DatoFicha
                            v-if="plan"
                            etiqueta="Velocidad limitada"
                            :valor="`${formatearVelocidad(plan.bajada_limitada_kbps)} ↓ / ${formatearVelocidad(plan.subida_limitada_kbps)} ↑`"
                        />
                        <DatoFicha
                            etiqueta="Plantilla de facturación"
                            :valor="servicio.plantilla_facturacion_id ? (plantilla?.nombre ?? `Plantilla #${servicio.plantilla_facturacion_id}`) : 'Sin plantilla'"
                        />
                        <DatoFicha
                            etiqueta="Instalación"
                            :valor="formatearFecha(servicio.fecha_instalacion)"
                        />
                    </dl>
                </UPageCard>

                <UPageCard
                    title="Red"
                    icon="i-lucide-network"
                    variant="subtle"
                >
                    <dl class="grid gap-x-6 gap-y-4 sm:grid-cols-2">
                        <DatoFicha
                            etiqueta="Router"
                            :valor="nombreRouter(servicio)"
                        />
                        <DatoFicha
                            etiqueta="Tipo de conexión"
                            :valor="TIPOS_CONEXION[tipoConexionDe(servicio)].etiqueta"
                        />
                        <DatoFicha
                            v-if="!conPppoe"
                            etiqueta="Amarre IP-MAC"
                            :valor="servicio.amarre_ip_mac ? 'Sí (ARP estático)' : 'No'"
                        />
                        <DatoFicha
                            etiqueta="IPv4"
                            :valor="servicio.ipv4 ?? 'Sin IPv4'"
                            mono
                        />
                        <DatoFicha
                            etiqueta="Prefijo de enlace IPv6"
                            :valor="servicio.prefijo_enlace_v6"
                            mono
                        />
                        <DatoFicha
                            etiqueta="Prefijo delegado IPv6"
                            :valor="servicio.prefijo_delegado_v6"
                            mono
                        />
                        <DatoFicha
                            etiqueta="Modo IPv6"
                            :valor="MODOS_IPV6[servicio.ipv6_modo]"
                        />
                        <DatoFicha
                            v-if="servicio.ipv6_duid"
                            etiqueta="DUID"
                            :valor="servicio.ipv6_duid"
                            mono
                        />
                        <DatoFicha
                            etiqueta="MAC"
                            :valor="servicio.mac"
                            mono
                        />
                        <DatoFicha
                            etiqueta="Firewall de corte"
                            :valor="servicio.excluir_firewall ? 'Excluido' : 'Aplica'"
                        />
                    </dl>
                </UPageCard>

                <UPageCard
                    v-if="conPppoe"
                    title="Credenciales PPPoE"
                    icon="i-lucide-key-round"
                    variant="subtle"
                >
                    <ServicioCredenciales
                        :servicio="servicio"
                        @consultado="lineaTiempo?.recargar()"
                    />
                </UPageCard>

                <UPageCard
                    v-if="puede('sesiones.ver') && conPppoe"
                    title="Sesión activa"
                    icon="i-lucide-activity"
                    variant="subtle"
                >
                    <ProblemaAlerta
                        v-if="problemaSesion"
                        :problema="problemaSesion"
                        :reintentar="cargarSesion"
                        :reintentando="cargandoSesion"
                    />
                    <div
                        v-else-if="cargandoSesion && !sesion"
                        class="flex flex-col gap-2"
                    >
                        <USkeleton class="h-5 w-48" />
                        <USkeleton class="h-5 w-64" />
                    </div>
                    <div
                        v-else-if="!sesion"
                        class="flex flex-col items-start gap-2"
                    >
                        <EstadoSesionBadge estado="desconectada" />
                        <p class="text-sm text-muted">
                            Sin sesión PPPoE abierta.
                        </p>
                    </div>
                    <div
                        v-else
                        class="flex flex-col gap-4"
                    >
                        <EstadoSesionBadge
                            estado="en_linea"
                            :latido="latidoSesion"
                            :leido-en="sesionLeidaEn"
                        />
                        <dl class="grid gap-x-6 gap-y-4 sm:grid-cols-2">
                            <DatoFicha
                                etiqueta="Conectado desde"
                                :valor="`${formatearFechaHora(sesion.inicio)} (${formatearDuracion(sesion.inicio)})`"
                            />
                            <DatoFicha
                                etiqueta="NAS"
                                :valor="`${sesion.nas_ip} · ${sesion.acct_session_id}`"
                                mono
                            />
                            <DatoFicha
                                etiqueta="IPv4 de la sesión"
                                :valor="sesion.ipv4"
                                mono
                            />
                            <DatoFicha
                                etiqueta="Prefijos IPv6 de la sesión"
                                :valor="[sesion.prefijo_enlace_v6, sesion.prefijo_delegado_v6].filter(Boolean).join(' · ') || null"
                                mono
                            />
                            <DatoFicha
                                etiqueta="Tráfico"
                                :valor="`${formatearBytes(sesion.bytes_in)} ↓ / ${formatearBytes(sesion.bytes_out)} ↑`"
                            />
                        </dl>
                    </div>
                </UPageCard>

                <UPageCard
                    title="Instalación"
                    icon="i-lucide-map-pin"
                    variant="subtle"
                >
                    <dl class="grid gap-x-6 gap-y-4 sm:grid-cols-2">
                        <DatoFicha
                            etiqueta="Dirección"
                            :valor="servicio.direccion"
                            class="sm:col-span-2"
                        />
                        <DatoFicha
                            etiqueta="Coordenadas"
                            :valor="servicio.coordenadas"
                            mono
                        />
                        <DatoFicha
                            etiqueta="Instalado el (inicio de la facturación)"
                            :valor="servicio.instalado_en ? formatearFechaHora(servicio.instalado_en) : 'Pendiente: se fija al activar la instalación'"
                            data-prueba="instalado-en-servicio"
                        />
                        <DatoFicha
                            etiqueta="Última modificación"
                            :valor="formatearFechaHora(servicio.updated_at)"
                        />
                    </dl>
                    <div
                        v-if="planta.length"
                        class="mt-4 flex flex-col gap-3 border-t border-default pt-4"
                        data-prueba="planta-servicio"
                    >
                        <p class="flex items-center gap-1.5 text-xs font-medium text-muted">
                            <UIcon
                                name="i-lucide-cable"
                                class="size-3.5 shrink-0"
                            />
                            Referencia de planta (solo lectura, llega desde Iris)
                        </p>
                        <dl class="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3">
                            <DatoFicha
                                v-for="dato in planta"
                                :key="dato.campo"
                                :etiqueta="dato.etiqueta"
                                :valor="dato.valor"
                                mono
                            />
                        </dl>
                    </div>
                </UPageCard>
            </div>

            <ServicioConfiguracionEfectiva
                ref="configuracionEfectiva"
                :servicio-id="servicio.id"
            />

            <ServicioPlanesTemporales
                :servicio="servicio"
                @cambiado="alCambiarPlanTemporal"
            />

            <ServicioHorus
                v-if="puede('horus.ver')"
                :servicio-id="servicio.id"
            />

            <ServicioAdicionales
                :servicio="servicio"
                @cambiado="lineaTiempo?.recargar()"
            />

            <ServicioEquipos
                v-if="puede('inventario.ver')"
                :servicio="servicio"
                @cambiado="lineaTiempo?.recargar()"
            />

            <section
                class="flex flex-col gap-3"
                aria-label="Historial de asignaciones"
            >
                <h3 class="text-sm font-semibold text-highlighted">
                    Historial de asignaciones
                </h3>
                <ServicioAsignaciones
                    ref="asignaciones"
                    :servicio-id="servicio.id"
                />
            </section>

            <PeriodosBonificados
                v-if="puede('facturas.ver')"
                ref="periodosBonificados"
                :servicio-id="servicio.id"
            />

            <section
                v-if="puede('promesas.ver')"
                class="flex flex-col gap-3"
                aria-label="Promesas del servicio"
            >
                <div class="flex items-center justify-between gap-2">
                    <h3 class="text-sm font-semibold text-highlighted">
                        Promesas de pago
                    </h3>
                    <UButton
                        :to="`/promesas?servicio=${servicio.id}`"
                        label="Ver todas"
                        color="neutral"
                        variant="link"
                        size="sm"
                        trailing-icon="i-lucide-arrow-right"
                    />
                </div>
                <ProblemaAlerta
                    v-if="problemaPromesas"
                    :problema="problemaPromesas"
                    :reintentar="cargarPromesas"
                    :reintentando="cargandoPromesas"
                />
                <USkeleton
                    v-else-if="cargandoPromesas && !promesas.length"
                    class="h-16 w-full"
                />
                <p
                    v-else-if="!promesas.length"
                    class="text-sm text-muted"
                >
                    Sin promesas de pago.
                </p>
                <ul
                    v-else
                    class="flex flex-col divide-y divide-default rounded-lg border border-default"
                >
                    <li
                        v-for="promesa in promesas"
                        :key="promesa.id"
                        class="flex flex-col gap-1 p-3 sm:flex-row sm:items-start sm:justify-between"
                        :data-promesa="promesa.id"
                    >
                        <div class="flex flex-col">
                            <span class="text-sm font-medium text-highlighted">
                                {{ formatearQuetzales(promesa.monto) }} · vence {{ formatearFechaHora(promesa.vence_en) }}
                            </span>
                            <span class="text-xs text-muted">Promesa #{{ promesa.id }} · {{ CANALES_PROMESA[promesa.canal] }} · {{ formatearFechaHora(promesa.created_at) }}</span>
                            <EvaluacionPromesa
                                :promesa="promesa"
                                compacta
                            />
                        </div>
                        <UBadge
                            :label="ESTADOS_PROMESA[promesa.estado].etiqueta"
                            :icon="ESTADOS_PROMESA[promesa.estado].icono"
                            :color="ESTADOS_PROMESA[promesa.estado].color"
                            variant="subtle"
                            size="sm"
                            class="self-start"
                        />
                    </li>
                </ul>
            </section>

            <section
                v-if="puede('bitacora.ver')"
                class="flex flex-col gap-3"
            >
                <h3 class="text-sm font-semibold text-highlighted">
                    Historial
                </h3>
                <LineaTiempoBitacora
                    ref="linea"
                    :filtros="filtrosLinea"
                    etiqueta="Historial del servicio"
                />
            </section>

            <ServicioEditar
                v-model:open="editando"
                :servicio="servicio"
                @guardado="alEditar"
            />

            <PromesaSimularModal
                v-model:open="simuladorAbierto"
                :servicio="servicio"
                @creada="alCrearPromesa"
            />

            <PromesaCrearModal
                v-model:open="promesaAbierta"
                :servicio="servicio"
                :sugerido="pendienteServicio"
                @creada="alCrearPromesa"
            />

            <CargoUnicoModal
                v-if="puedeCargoUnico"
                v-model:open="cargoAbierto"
                :destino="{ servicio }"
                @hecho="alEmitirCargo"
            />
            <ServicioCambiarEmpresaModal
                v-if="puedeCambiarEmpresa"
                v-model:open="cambiarEmpresaAbierto"
                :servicio="servicio"
                @hecho="alCambiarEmpresa"
            />

            <ServicioActivarInstalacionModal
                v-if="puedeActivarInstalacion"
                v-model:open="activarAbierto"
                :servicio="servicio"
                @hecho="alActivarInstalacion"
                @recargado="alRecargarServicio"
            />

            <ServicioAccionModal
                v-model:open="accionAbierta"
                :servicio="servicio"
                :accion="accionElegida"
                @hecho="alTerminar"
            />
        </div>
    </PanelPagina>
</template>
