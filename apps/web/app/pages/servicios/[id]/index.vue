<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { DropdownMenuItem, TableColumn, TabsItem } from '@nuxt/ui'
import type Decimal from 'decimal.js'

/**
 * Ficha del servicio (tableros OperServicioFicha y OperServicioFichaMovil): franja con el código y
 * el nombre del servicio, su estado y lo que debe (el saldo una sola vez), y las acciones en una
 * sola fila: Cobrar, la acción de estado principal y el resto en «Más». Debajo, una tarjeta con
 * pestañas segmentadas: Resumen (sesión en vivo, equipo en comodato con «Cambiar equipo», tráfico
 * en Horus y caídas, plan, adicionales y contacto), Red y equipo, Facturas, Contactos, Bitácora y
 * Portal de corte. En el teléfono, «Más», Promesa y «Cobrar Q …» quedan fijos abajo. La pestaña
 * elegida va en `?pestana=`.
 */
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

const accionAbierta = ref(false)
const accionElegida = shallowRef<PresentacionAccionServicio | null>(null)
const lineaTiempo = useTemplateRef<{ recargar: () => Promise<void> }>('linea')
const historialAsignaciones = useTemplateRef<{ recargar: () => Promise<void> }>('asignaciones')
const historialSesiones = useTemplateRef<{ recargar: () => Promise<void> }>('historialSesiones')
const codigoCorte = useTemplateRef<{ recargar: () => Promise<void> }>('codigoCorte')
const promocionesServicio = useTemplateRef<{ abrirAgregar: () => void }>('promocionesServicio')

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
/** Acciones por grupo (sistema visual Argos): estado, red y, al final y aparte, lo destructivo. */
const accionesEstado = computed(() => acciones.value.filter(a => ['suspender', 'reactivar', 'limitar', 'quitar_limite'].includes(a.accion)))
const accionesRed = computed(() => acciones.value.filter(a => a.accion === 'desconectar'))
const accionesDestructivas = computed(() => acciones.value.filter(a => a.accion === 'retirar'))

/** Pendiente de instalación (`contratos/instalacion.md`): sin facturas, no hay promesa (422 de A3). */
const pendiente = computed(() => servicio.value !== null && esPendienteInstalacion(servicio.value))
const sinPromesas = computed(() => servicio.value === null || servicio.value.estado === 'retirado' || pendiente.value)
const puedePromesa = computed(() => puede('promesas.crear') && !sinPromesas.value)
const puedeSimular = computed(() => puede('promesas.ver') && !sinPromesas.value)
/** «Activar instalación» con su permiso exacto, solo sobre un pendiente (si no, 422 `servicio_no_pendiente`). */
const puedeActivarInstalacion = computed(() => puede('servicios.activar_instalacion') && pendiente.value)
const activarAbierto = ref(false)
const planta = computed(() => (servicio.value ? datosPlanta(servicio.value) : []))
/** Coordenadas del servicio en el mapa (como en la ficha del cliente). */
const mapaServicio = computed(() => {
    const coordenadas = servicio.value?.coordenadas?.replace(/\s/g, '')
    return coordenadas ? `https://www.google.com/maps?q=${encodeURIComponent(coordenadas)}` : null
})
/** Contacto en sitio (pedido A13 de Iris): quien recibe al técnico; null si no hay nombre ni teléfono. */
const contactoSitio = computed(() => {
    const nombre = servicio.value?.contacto_nombre?.trim()
    const telefono = servicio.value?.contacto_telefono?.trim()
    return nombre || telefono ? [nombre, telefono].filter(Boolean).join(' · ') : null
})

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

/** «Sincronizar con el router» (A1): aplica ya en el MikroTik lo que el servicio debe tener. */
const puedeSincronizarRouter = computed(() => puede('servicios.sincronizar_router') && servicio.value !== null && servicio.value.estado !== 'retirado')
const sincronizarRouterAbierto = ref(false)

function alCambiarEmpresa(actualizado: Servicio) {
    servicio.value = actualizado
    toast.add({ title: 'Empresa cambiada', description: `${etiquetaServicio(actualizado)} factura ahora con ${nombreEmpresa(actualizado.empresa_id)}`, icon: 'i-lucide-circle-check', color: 'success' })
    void lineaTiempo.value?.recargar()
}
const simuladorAbierto = ref(false)
/** Nueva factura (antes «Cargo único», A3): instalación, equipo…; con todo descontado queda como bonificación. */
const puedeCargoUnico = computed(() => puede('facturas.emitir_cargo_unico') && puede('facturas.ver') && servicio.value !== null && servicio.value.estado !== 'retirado')
/** Facturas de periodos a mano (A3): pago por adelantado o periodos que el cron no emitió; pantalla propia. */
const puedeFacturasPeriodo = computed(() => puede('facturas.emitir_periodos') && puede('facturas.ver') && servicio.value !== null && servicio.value.estado !== 'retirado')
const cargoAbierto = ref(false)
const periodosBonificados = useTemplateRef('periodosBonificados')

async function alEmitirCargo(resultado: CargoUnicoEmitido, siguiente: { cobrar: boolean, clienteId: number }) {
    void lineaTiempo.value?.recargar()
    if (resultado.documento === 'bonificacion' && resultado.bonificacion) {
        toast.add({ title: 'Bonificación registrada', description: `Sin costo: ${formatearQuetzales(resultado.bonificacion.bruto)} · ${resultado.bonificacion.motivo_nombre}`, icon: 'i-lucide-hand-heart', color: 'success' })
        void periodosBonificados.value?.recargar()
        await navigateTo(`/bonificaciones/${resultado.bonificacion.id}`)
        return
    }
    if (resultado.factura) {
        toast.add({ title: 'Factura emitida', description: `Factura #${resultado.factura.id} por ${formatearQuetzales(resultado.factura.total)}`, icon: 'i-lucide-receipt', color: 'success' })
        await navigateTo(siguiente.cobrar ? `/cobro?cliente=${siguiente.clienteId}` : `/facturas/${resultado.factura.id}`)
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

/** La promesa cubre todo lo vencido: el modal lee qué facturas y cuánto (simulación de A3). */
function abrirPromesa() {
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

/** Servidor PPPoE del servicio (`red_acceso.ver`), para su nombre; sin permiso se ve el id. */
const servidorPppoe = shallowRef<ServidorPppoe | null>(null)

async function cargarRelacionados(actual: Servicio) {
    const [resultadoPlanes, resultadoPlantillas, resultadoServidor] = await Promise.all([
        puede('planes.ver') ? usePlanes().listar() : null,
        puede('plantillas.ver') && actual.plantilla_facturacion_id ? usePlantillas().listar() : null,
        puede('red_acceso.ver') && actual.servidor_pppoe_id ? useRedAcceso().verServidor(actual.servidor_pppoe_id) : null,
    ])
    servidorPppoe.value = resultadoServidor?.ok ? resultadoServidor.data : null
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
    void historialSesiones.value?.recargar()
    void lineaTiempo.value?.recargar()
    // Retirar libera IPv4 y prefijos: cierra el tramo vigente.
    void historialAsignaciones.value?.recargar()
    // Suspender abre el código de corte y reactivar lo cierra (lo hace routeros en la misma pasada).
    void codigoCorte.value?.recargar()
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

/**
 * Eliminar sin historial (`contratos/eliminar.md`): solo quien tiene `servicios.eliminar` (admin)
 * pregunta si se puede. Si nunca se usó, «Eliminar»; si no, los motivos y la alternativa (retirar).
 */
const puedeEliminar = computed(() => puede('servicios.eliminar'))
const eliminable = shallowRef<Eliminable | null>(null)
const problemaEliminable = ref<Problem | null>(null)
const eliminarAbierto = ref(false)

async function cargarEliminable() {
    const actual = servicio.value
    if (!actual || !puedeEliminar.value) {
        eliminable.value = null
        return
    }
    problemaEliminable.value = null
    const resultado = await useServicios().eliminable(actual.id)
    eliminable.value = resultado.ok ? resultado.data : null
    problemaEliminable.value = resultado.ok ? null : resultado.problema
}

watch(() => [servicio.value?.id, servicio.value?.version], () => void cargarEliminable())

const liberaServicio = computed(() => {
    const actual = servicio.value
    if (!actual) {
        return []
    }
    return [
        `Usuario PPPoE ${actual.user_ppp}`,
        ...(actual.ipv4 ? [`IPv4 ${actual.ipv4}`] : []),
        ...(actual.prefijo_enlace_v6 ? [`Prefijo de enlace ${actual.prefijo_enlace_v6}`] : []),
        ...(actual.prefijo_delegado_v6 ? [`Prefijo delegado ${actual.prefijo_delegado_v6}`] : []),
    ]
})

function alEliminar() {
    toast.add({ title: 'Servicio eliminado', description: liberaServicio.value.length > 1 ? 'Su IP y sus prefijos quedaron libres.' : undefined, icon: 'i-lucide-trash-2', color: 'success' })
    void navigateTo('/servicios')
}

/**
 * `precio_mensual` de la API (contrato Iris 0.8.0): el precio con el que Argos factura el servicio
 * (`costo_override` o el del plan vigente, IVA incluido). No depende de poder ver los planes.
 */
const precio = computed(() => servicio.value?.precio_mensual ?? null)

/* Pestañas (tablero OperServicioFicha). */
const PESTANAS_SERVICIO = ['resumen', 'red', 'equipo', 'facturas', 'contactos', 'promociones', 'bitacora', 'corte'] as const
type PestanaServicio = typeof PESTANAS_SERVICIO[number]

const pestana = computed<PestanaServicio>({
    get: () => {
        const valor = route.query.pestana
        return typeof valor === 'string' && (PESTANAS_SERVICIO as readonly string[]).includes(valor) ? valor as PestanaServicio : 'resumen'
    },
    set: (valor) => {
        void navigateTo({ query: { ...route.query, pestana: valor === 'resumen' ? undefined : valor } }, { replace: true })
    },
})

const pestanas = computed<TabsItem[]>(() => [
    { label: 'Resumen', value: 'resumen', icon: 'i-lucide-house' },
    { label: 'Red y equipo', value: 'red', icon: 'i-lucide-network' },
    // SmartOLT y ACS (tablero PendEquipoServicio): qué cuenta, OLT y ACS usa el equipo del servicio.
    ...(puede('servicios.ver_equipo') ? [{ label: 'Equipo', value: 'equipo', icon: 'i-lucide-router' }] : []),
    ...(puede('facturas.ver') ? [{ label: 'Facturas', value: 'facturas', icon: 'i-lucide-receipt' }] : []),
    // Los contactos se leen con `contactos.buscar` (y el cliente con `clientes.ver`).
    ...(puede('clientes.ver') && puede('contactos.buscar') ? [{ label: 'Contactos', value: 'contactos', icon: 'i-lucide-users' }] : []),
    // Promociones de velocidad (decisión del PM 18): se leen con `servicios.ver`.
    { label: 'Promociones', value: 'promociones', icon: 'i-lucide-zap' },
    ...(puede('bitacora.ver') ? [{ label: 'Bitácora', value: 'bitacora', icon: 'i-lucide-history' }] : []),
    { label: 'Portal de corte', value: 'corte', icon: 'i-lucide-octagon-pause' },
])

/* Lo que debe este servicio: facturas pendientes del estado de cuenta del cliente (una sola vez, en la franja). */
const facturasPendientes = shallowRef<Factura[] | null>(null)
const problemaCuenta = ref<Problem | null>(null)

async function cargarCuenta() {
    const actual = servicio.value
    if (!actual || !puede('clientes.estado_cuenta')) {
        return
    }
    const resultado = await useClientes().estadoCuenta(actual.cliente_id)
    facturasPendientes.value = resultado.ok ? resultado.data.facturas_pendientes.filter(f => f.servicio_id === actual.id) : null
    problemaCuenta.value = resultado.ok ? null : resultado.problema
}

const saldo = computed<Decimal | null>(() => (facturasPendientes.value ? resumenPendiente(facturasPendientes.value, hoyGuatemala()).pendiente : null))
const debe = computed(() => saldo.value !== null && saldo.value.gt(0))
const proximaFactura = computed(() => (facturasPendientes.value ?? []).map(f => f.vence_en).sort()[0] ?? null)

/* Equipo en comodato (`inventario.ver`). */
const equipos = shallowRef<EquipoServicio[] | null>(null)
const problemaEquipos = ref<Problem | null>(null)
const cambiarEquipoAbierto = ref(false)

async function cargarEquipos() {
    if (!puede('inventario.ver')) {
        return
    }
    const resultado = await useEquiposServicio().listar(servicioId.value)
    equipos.value = resultado.ok ? resultado.data : null
    problemaEquipos.value = resultado.ok ? null : resultado.problema
}

function alCambiarEquipo() {
    void cargarEquipos()
    void lineaTiempo.value?.recargar()
}

/* Caídas de los últimos 7 días: sesiones que terminaron (del historial real, no un estimado). */
const sesionesSemana = shallowRef<Sesion[] | null>(null)
async function cargarCaidas() {
    if (!puede('sesiones.ver') || !conPppoe.value) {
        return
    }
    const desde = new Date(Date.now() - 7 * 86_400_000).toISOString()
    const resultado = await useSesiones().listar({ servicio_id: servicioId.value, desde, limit: 100 })
    sesionesSemana.value = resultado.ok ? resultado.data.data : null
}
const caidas = computed(() => (sesionesSemana.value ?? []).filter(s => s.fin !== null).sort((a, b) => (b.fin ?? '').localeCompare(a.fin ?? '')))

/* Facturas del servicio (pestaña Facturas). */
const facturasServicio = usePaginacionCursor(cursor => useFacturas().listar({ servicio_id: servicioId.value, limit: 25 }, cursor))
watch(pestana, (valor) => {
    if (valor === 'facturas' && puede('facturas.ver') && !facturasServicio.filas.value.length) {
        void facturasServicio.recargar()
    }
}, { immediate: true })
const columnasFacturas: TableColumn<Factura>[] = [
    { accessorKey: 'periodo', header: 'Periodo' },
    { accessorKey: 'vence_en', header: 'Vence', meta: SOLO_ANCHO },
    { accessorKey: 'total', header: 'Total', meta: { class: { th: 'text-end', td: 'text-end' } } },
    { accessorKey: 'estado', header: 'Estado' },
]

/* Servicios del cliente (Contactos: a cargo de sus servicios). */
const serviciosCliente = shallowRef<Servicio[] | null>(null)
async function cargarServiciosCliente() {
    const actual = servicio.value
    if (!actual) {
        return
    }
    const resultado = await useServicios().listar({ cliente_id: actual.cliente_id, limit: 50 })
    serviciosCliente.value = resultado.ok ? resultado.data.data : null
}
watch(pestana, (valor) => {
    if (valor === 'contactos' && !serviciosCliente.value) {
        void cargarServiciosCliente()
    }
}, { immediate: true })

watch(servicio, (actual, anterior) => {
    if (actual && actual.id !== anterior?.id) {
        void cargarCuenta()
        void cargarEquipos()
        void cargarCaidas()
    }
})

/* «Agregar a una promoción» del menú Más (tablero OperServicioFicha): abre la pestaña y su ventana. */
const puedeAgregarPromocion = computed(() => puede('promociones_velocidad.asignar') && puede('promociones_velocidad.ver') && servicio.value?.estado !== 'retirado')
function abrirAgregarPromocion() {
    pestana.value = 'promociones'
    // La pestaña se pinta cuando cambia `?pestana=`: se abre la ventana en cuanto existe.
    const parar = watch(promocionesServicio, (componente) => {
        if (componente) {
            componente.abrirAgregar()
            queueMicrotask(() => parar())
        }
    }, { immediate: true })
}

/* Acciones en una sola fila: Cobrar, la principal de estado y el resto en «Más». */
const accionPrincipal = computed(() => accionesEstado.value[0] ?? null)

/**
 * «Más» del servicio. En el teléfono la acción principal de estado no se ve en la franja (tablero
 * OperServicioFichaMovil: «Más», Promesa y Cobrar abajo), así que su «Más» la trae también.
 */
function gruposMas(conPrincipal: boolean): DropdownMenuItem[][] {
    const actual = servicio.value
    if (!actual) {
        return []
    }
    const estado: DropdownMenuItem[] = [
        ...(puedeActivarInstalacion.value && accionPrincipal.value ? [{ label: 'Activar instalación', icon: 'i-lucide-hard-hat', onSelect: () => { activarAbierto.value = true } }] : []),
        ...accionesEstado.value.slice(conPrincipal ? 0 : 1).map(a => ({ label: a.etiqueta, icon: a.icono, onSelect: () => abrirAccion(a) })),
        ...(puedeEditar.value ? [{ label: 'Cambiar plan', icon: 'i-lucide-arrow-right-left', onSelect: () => { editando.value = true } }] : []),
    ]
    const cobro: DropdownMenuItem[] = [
        ...(puedePromesa.value ? [{ label: 'Promesa de pago', icon: 'i-lucide-hand', onSelect: abrirPromesa }] : []),
        ...(puedeSimular.value ? [{ label: 'Simular promesa', icon: 'i-lucide-flask-conical', onSelect: () => { simuladorAbierto.value = true } }] : []),
        // En escritorio «Nueva factura» ya está a la vista en la franja; en el teléfono va en la barra de abajo.
        ...(puedeCargoUnico.value && conPrincipal ? [{ label: 'Nueva factura', icon: 'i-lucide-receipt', onSelect: () => { cargoAbierto.value = true } }] : []),
        ...(puedeFacturasPeriodo.value ? [{ label: 'Emitir facturas de periodos', icon: 'i-lucide-calendar-plus', to: enlace(`/servicios/${actual.id}/facturas-periodo`) }] : []),
    ]
    const red: DropdownMenuItem[] = [
        ...accionesRed.value.map(a => ({ label: a.etiqueta, icon: a.icono, onSelect: () => abrirAccion(a) })),
        ...(puedeAgregarPromocion.value ? [{ label: 'Agregar a una promoción', icon: 'i-lucide-zap', onSelect: abrirAgregarPromocion }] : []),
        ...(puedeSincronizarRouter.value ? [{ label: 'Sincronizar con el router', icon: 'i-lucide-refresh-cw', onSelect: () => { sincronizarRouterAbierto.value = true } }] : []),
        ...(puedeEditar.value ? [{ label: 'Editar servicio', icon: ICONOS.editar, onSelect: () => { editando.value = true } }] : []),
        ...(puedeCambiarEmpresa.value ? [{ label: 'Cambiar empresa', icon: 'i-lucide-building-2', onSelect: () => { cambiarEmpresaAbierto.value = true } }] : []),
    ]
    const baja: DropdownMenuItem[] = [
        ...accionesDestructivas.value.map(a => ({ label: a.etiqueta, icon: a.icono, color: 'error' as const, onSelect: () => abrirAccion(a) })),
        ...(puedeEliminar.value && eliminable.value?.eliminable ? [{ label: 'Eliminar', icon: ICONOS.eliminar, color: 'error' as const, onSelect: () => { eliminarAbierto.value = true } }] : []),
    ]
    return [estado, cobro, red, baja].filter(grupo => grupo.length)
}
const itemsMas = computed(() => gruposMas(false))
const itemsMasTelefono = computed(() => gruposMas(true))

const enlaceCobro = computed(() => (servicio.value ? `/cobro?cliente=${servicio.value.cliente_id}` : '/cobro'))

watch(servicioId, cargar)
onMounted(cargar)
</script>

<template>
    <PanelPagina
        id="servicio"
        :titulo="servicio ? etiquetaServicio(servicio) : 'Servicio'"
        icono="i-lucide-wifi"
        encabezado-propio
    >
        <div
            v-if="cargando && !servicio"
            class="flex flex-col gap-4"
        >
            <USkeleton class="h-24 w-full rounded-[1.375rem]" />
            <USkeleton class="h-96 w-full rounded-[1.375rem]" />
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
            class="flex flex-col gap-4"
        >
            <!-- Franja (tablero OperServicioFicha): código, nombre, estado, lo que debe y las acciones en una fila. -->
            <header
                class="surface-card flex flex-col gap-3 rounded-[1.375rem] p-4 lg:flex-row lg:items-center lg:justify-between sm:px-5"
                aria-label="Servicio"
                data-prueba="franja-servicio"
            >
                <div class="flex min-w-0 items-center gap-3">
                    <span
                        class="pastilla-icono pastilla-tono size-12 shrink-0 rounded-2xl"
                        :class="servicio.estado === 'activo' ? 'tono-exito' : servicio.estado === 'limitado' ? 'tono-aviso' : servicio.estado === 'suspendido' ? 'tono-error' : 'tono-marca'"
                    >
                        <UIcon
                            name="i-lucide-wifi"
                            class="size-6"
                        />
                    </span>
                    <div class="flex min-w-0 flex-col gap-1">
                        <div class="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                            <span
                                class="rounded-lg bg-(--ax-panel) px-2 py-0.5 font-mono text-sm font-semibold text-highlighted ring-1 ring-(--ax-borde)"
                                data-prueba="codigo-servicio"
                            >{{ servicio.codigo }}</span>
                            <h1 class="truncate text-xl font-bold tracking-[-0.02em] text-highlighted">
                                {{ servicio.nombre || nombrePlan(servicio) }}
                            </h1>
                            <UButton
                                v-if="puedeEditar"
                                :icon="ICONOS.editar"
                                color="neutral"
                                variant="ghost"
                                size="xs"
                                class="rounded-full"
                                aria-label="Editar servicio"
                                title="Editar servicio"
                                data-prueba="editar-servicio"
                                @click="editando = true"
                            />
                            <EstadoServicioBadge
                                :estado="servicio.estado"
                                class="rounded-full"
                            />
                            <UBadge
                                v-if="servicio.promesa_activa"
                                :label="promesas.find(p => p.estado === 'activa') ? `Promesa hasta el ${formatearFechaCorta(promesas.find(p => p.estado === 'activa')!.vence_en)}` : PROMESA_ACTIVA.etiqueta"
                                icon="i-lucide-hand"
                                color="primary"
                                variant="soft"
                                class="rounded-full"
                            />
                            <SuspensionManualBadge :servicio="servicio" />
                            <UBadge
                                v-if="variasEmpresas"
                                :label="nombreEmpresa(servicio.empresa_id)"
                                icon="i-lucide-building-2"
                                color="neutral"
                                variant="outline"
                                class="rounded-full"
                                data-prueba="empresa-servicio"
                            />
                        </div>
                        <p class="flex flex-wrap items-center gap-x-1 text-[0.8125rem] text-muted">
                            <ULink
                                :to="enlace(`/clientes/${servicio.cliente_id}`)"
                                class="text-default underline underline-offset-2 hover:text-primary"
                            >{{ nombreCliente(servicio) }}</ULink>
                            <span>· {{ nombrePlan(servicio) }}</span>
                            <span>· <span data-prueba="tipo-conexion">{{ TIPOS_CONEXION[tipoConexionDe(servicio)].corta }}</span> en {{ nombreRouter(servicio) }}</span>
                            <TipoPlanBadge
                                :tipo="servicio.plan_tipo"
                                class="hidden"
                                data-prueba="tipo-plan-servicio"
                            />
                            <span
                                v-if="servicio.direccion"
                                class="hidden lg:inline"
                            >· {{ servicio.direccion }}</span>
                            <span v-if="servicio.instalado_en">· desde {{ formatearMesAnio(servicio.instalado_en) }}</span>
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
                </div>
                <div
                    class="flex shrink-0 flex-wrap items-center gap-2 sm:flex-nowrap"
                    role="group"
                    aria-label="Acciones del servicio"
                    data-prueba="acciones-servicio"
                >
                    <div
                        v-if="puede('clientes.estado_cuenta')"
                        class="me-2 flex flex-col items-end"
                        data-prueba="saldo-servicio"
                    >
                        <span class="text-xs text-muted">Debe este servicio</span>
                        <span
                            v-if="saldo !== null"
                            class="text-xl font-bold tabular-nums"
                            :class="debe ? 'text-error' : 'text-success'"
                        >{{ debe ? formatearQuetzales(saldo) : 'Al día' }}</span>
                        <UButton
                            v-else-if="problemaCuenta"
                            label="No se pudo leer · Reintentar"
                            variant="link"
                            size="xs"
                            class="px-0"
                            @click="cargarCuenta"
                        />
                        <USkeleton
                            v-else
                            class="h-6 w-24"
                        />
                    </div>
                    <UButton
                        v-if="puede('pagos.registrar') && debe"
                        :to="enlaceCobro"
                        label="Cobrar"
                        :icon="ICONOS.cobrar"
                        color="success"
                        size="lg"
                        class="hidden rounded-full sm:inline-flex"
                        data-prueba="cobrar-servicio"
                    />
                    <UButton
                        v-if="puedeCargoUnico"
                        label="Nueva factura"
                        icon="i-lucide-plus"
                        color="primary"
                        size="lg"
                        class="hidden rounded-full sm:inline-flex"
                        data-prueba="nueva-factura-servicio"
                        @click="cargoAbierto = true"
                    />
                    <UButton
                        v-if="puedeActivarInstalacion"
                        label="Activar instalación"
                        icon="i-lucide-hard-hat"
                        color="success"
                        variant="outline"
                        size="lg"
                        class="rounded-full"
                        data-prueba="abrir-activar-instalacion"
                        @click="activarAbierto = true"
                    />
                    <UButton
                        v-else-if="accionPrincipal"
                        :label="accionPrincipal.etiqueta"
                        :icon="accionPrincipal.icono"
                        :color="accionPrincipal.color === 'success' ? 'success' : 'neutral'"
                        variant="outline"
                        size="lg"
                        class="hidden rounded-full sm:inline-flex"
                        :data-prueba="`accion-${accionPrincipal.accion}`"
                        @click="abrirAccion(accionPrincipal)"
                    />
                    <UDropdownMenu
                        v-if="itemsMas.length"
                        :items="itemsMas"
                        :content="{ align: 'end' }"
                    >
                        <UButton
                            icon="i-lucide-ellipsis"
                            color="neutral"
                            variant="ghost"
                            size="lg"
                            class="boton-flotante boton-circulo hidden sm:inline-flex"
                            aria-label="Más acciones del servicio"
                            data-prueba="mas-acciones-servicio"
                        />
                    </UDropdownMenu>
                    <VerEnHorusBoton
                        tipo="servicio"
                        :id-externo="servicio.id"
                        size="sm"
                        variant="ghost"
                        class="hidden xl:inline-flex"
                    />
                </div>
            </header>

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
                    <p class="font-semibold">
                        Siguiente paso: instalar el equipo y pulsar «Activar instalación».
                    </p>
                    <p>
                        Ya tiene usuario PPPoE, router, plan e IP para configurar el equipo, pero no navega ni factura.
                        La facturación arranca al <strong>activar la instalación</strong>.
                    </p>
                    <p>
                        Mientras tanto no se puede suspender, limitar, reactivar, desconectar ni programar un plan temporal; sí editarlo o retirarlo si la venta se cae.
                    </p>
                </template>
            </UAlert>

            <p
                v-if="servicio.estado === 'retirado'"
                class="text-sm text-muted"
            >
                Servicio retirado: ya no admite acciones.
            </p>
            <template v-if="puedeEliminar">
                <ProblemaAlerta
                    v-if="problemaEliminable"
                    :problema="problemaEliminable"
                    :reintentar="cargarEliminable"
                />
                <p
                    v-else-if="eliminable?.eliminable"
                    class="text-xs text-muted"
                    data-prueba="eliminable"
                >
                    Nunca se usó: se puede borrar del todo desde «Más».
                </p>
                <p
                    v-else-if="eliminable"
                    class="flex items-start gap-1.5 text-xs text-muted"
                    data-prueba="no-eliminable"
                >
                    <UIcon
                        name="i-lucide-history"
                        class="mt-0.5 size-3.5 shrink-0"
                    />
                    <span>{{ textoNoEliminable('servicio', eliminable.motivos, servicio.estado === 'retirado') }}</span>
                </p>
            </template>

            <!-- Pestañas segmentadas dentro de la tarjeta de su contenido. -->
            <section
                class="surface-card flex min-w-0 flex-col gap-4 rounded-[1.375rem] p-3 sm:p-4"
                aria-label="Detalle del servicio"
            >
                <div class="flex items-center justify-between gap-2">
                    <RedPestanas
                        v-model="pestana"
                        :items="pestanas"
                        etiqueta="Secciones del servicio"
                        data-prueba="pestanas-servicio"
                    />
                    <AyudaBoton
                        solo-icono
                        class="hidden sm:inline-flex"
                    />
                </div>

                <!-- Resumen. -->
                <div
                    v-if="pestana === 'resumen'"
                    class="flex flex-col gap-4"
                    data-prueba="servicio-resumen"
                >
                    <div class="grid gap-4 lg:grid-cols-3">
                        <RedTarjeta
                            titulo="Sesión en vivo"
                            icono="i-lucide-wifi"
                        >
                            <template
                                v-if="sesion && puede('servicios.desconectar') && accionesRed.length"
                                #accion
                            >
                                <UButton
                                    label="Desconectar"
                                    icon="i-lucide-ban"
                                    color="error"
                                    variant="outline"
                                    size="xs"
                                    class="rounded-full"
                                    data-prueba="desconectar-servicio"
                                    @click="abrirAccion(accionesRed[0]!)"
                                />
                            </template>
                            <p
                                v-if="!conPppoe"
                                class="text-sm text-muted"
                            >
                                {{ TIPOS_CONEXION[tipoConexionDe(servicio)].etiqueta }}: sin sesión PPPoE; navega con su IP fija.
                            </p>
                            <p
                                v-else-if="!puede('sesiones.ver')"
                                class="text-sm text-muted"
                            >
                                Ver la sesión pide el permiso «sesiones.ver».
                            </p>
                            <ProblemaAlerta
                                v-else-if="problemaSesion"
                                :problema="problemaSesion"
                                :reintentar="cargarSesion"
                                :reintentando="cargandoSesion"
                            />
                            <USkeleton
                                v-else-if="cargandoSesion && !sesion"
                                class="h-24 w-full"
                            />
                            <div
                                v-else-if="!sesion"
                                class="flex flex-col items-start gap-2"
                            >
                                <EstadoSesionBadge estado="desconectada" />
                                <p class="text-sm text-muted">
                                    Sin sesión PPPoE abierta.
                                </p>
                            </div>
                            <template v-else>
                                <div class="flex flex-wrap items-center gap-2">
                                    <EstadoSesionBadge
                                        estado="en_linea"
                                        :latido="latidoSesion"
                                        :leido-en="sesionLeidaEn"
                                    />
                                    <span class="font-semibold text-highlighted">Conectado hace {{ formatearDuracion(sesion.inicio) }}</span>
                                    <UTooltip
                                        v-if="esSesionPorSondeo(sesion)"
                                        :text="DISTINTIVO_SONDEO.explicacion"
                                    >
                                        <UBadge
                                            :label="DISTINTIVO_SONDEO.etiqueta"
                                            :icon="DISTINTIVO_SONDEO.icono"
                                            :color="DISTINTIVO_SONDEO.color"
                                            variant="subtle"
                                            size="sm"
                                            data-prueba="sesion-activa-sondeo"
                                        />
                                    </UTooltip>
                                </div>
                                <dl>
                                    <RedFila etiqueta="IPv4">
                                        <span class="font-mono">{{ sesion.ipv4 ?? '—' }}</span>
                                        <UBadge
                                            v-if="servicio.ipv4 && servicio.ipv4 === sesion.ipv4"
                                            label="fija"
                                            color="neutral"
                                            variant="soft"
                                            size="sm"
                                            class="ms-1"
                                        />
                                    </RedFila>
                                    <RedFila
                                        etiqueta="IPv6 de su casa"
                                        :valor="sesion.prefijo_delegado_v6"
                                        mono
                                    />
                                    <RedFila
                                        etiqueta="NAS"
                                        :valor="`${textoNasSesion(sesion)} · ${sesion.acct_session_id}`"
                                        mono
                                    />
                                    <RedFila
                                        etiqueta="IPv6 del enlace"
                                        :valor="sesion.prefijo_enlace_v6"
                                        mono
                                    />
                                    <RedFila
                                        v-if="plan"
                                        etiqueta="Velocidad del plan"
                                        :valor="`${formatearVelocidad(plan.bajada_kbps)} / ${formatearVelocidad(plan.subida_kbps)}`"
                                    />
                                    <RedFila
                                        etiqueta="Descargó / subió"
                                        :valor="textoConsumoSesion(sesion)"
                                        data-prueba="sesion-activa-consumo"
                                    />
                                </dl>
                            </template>
                        </RedTarjeta>

                        <RedTarjeta
                            v-if="puede('inventario.ver')"
                            titulo="Equipo en comodato"
                            icono="i-lucide-router"
                        >
                            <template #accion>
                                <UButton
                                    label="Ver en inventario"
                                    variant="link"
                                    size="sm"
                                    @click="pestana = 'red'"
                                />
                            </template>
                            <ProblemaAlerta
                                v-if="problemaEquipos"
                                :problema="problemaEquipos"
                                :reintentar="cargarEquipos"
                            />
                            <USkeleton
                                v-else-if="!equipos"
                                class="h-24 w-full"
                            />
                            <template v-else-if="equipos.length">
                                <div
                                    v-for="equipo in equipos.slice(0, 2)"
                                    :key="equipo.id"
                                    class="flex items-center gap-3"
                                >
                                    <span class="pastilla-icono pastilla-tono tono-marca size-10 shrink-0 rounded-xl">
                                        <UIcon
                                            name="i-lucide-router"
                                            class="size-5"
                                        />
                                    </span>
                                    <div class="flex min-w-0 flex-col">
                                        <span class="truncate font-semibold text-highlighted">{{ equipo.producto_nombre }}</span>
                                        <span class="truncate font-mono text-xs text-muted">{{ [equipo.serie && `Serie ${equipo.serie}`, equipo.mac && `MAC ${equipo.mac}`].filter(Boolean).join(' · ') || `#${equipo.id}` }}</span>
                                    </div>
                                </div>
                                <dl>
                                    <RedFila etiqueta="Estado">
                                        <UBadge
                                            :label="equipos[0]!.condicion ? `En comodato · ${equipos[0]!.condicion}` : 'En comodato'"
                                            icon="i-lucide-circle-check"
                                            color="success"
                                            variant="soft"
                                            size="sm"
                                        />
                                    </RedFila>
                                    <RedFila
                                        etiqueta="Asignado"
                                        :valor="equipos[0]!.fecha_asignacion ? formatearFecha(equipos[0]!.fecha_asignacion) : '—'"
                                    />
                                </dl>
                                <SeccionSinApi
                                    titulo="Equipo en vivo"
                                    descripcion="Señal, Wi-Fi y estado del equipo con SmartOLT y GenieACS: en construcción en la API."
                                    icono="i-lucide-radio"
                                />
                                <UButton
                                    v-if="puede('servicios.cambiar_equipo') && servicio.estado !== 'retirado'"
                                    label="Cambiar equipo"
                                    icon="i-lucide-arrow-left-right"
                                    block
                                    class="mt-auto rounded-full"
                                    data-prueba="cambiar-equipo"
                                    @click="cambiarEquipoAbierto = true"
                                />
                            </template>
                            <UEmpty
                                v-else
                                icon="i-lucide-router"
                                title="Sin equipo en comodato"
                                description="Asígnalo en «Red y equipo»."
                                variant="naked"
                                size="sm"
                            />
                        </RedTarjeta>

                        <div class="flex min-w-0 flex-col gap-4">
                            <ServicioHorus
                                v-if="puede('horus.ver')"
                                :servicio-id="servicio.id"
                            />
                            <RedTarjeta
                                v-else
                                titulo="Tráfico"
                                icono="i-lucide-activity"
                            >
                                <p class="text-sm text-muted">
                                    El tráfico lo mide Horus; verlo pide el permiso «horus.ver».
                                </p>
                            </RedTarjeta>
                            <div
                                v-if="sesionesSemana && caidas.length"
                                class="flex items-start gap-2 rounded-xl border border-warning/40 bg-warning/10 px-3 py-2 text-sm"
                                data-prueba="caidas-servicio"
                            >
                                <UIcon
                                    name="i-lucide-triangle-alert"
                                    class="mt-0.5 size-4 shrink-0 text-warning"
                                />
                                <span class="min-w-0 flex-1">
                                    <span class="font-semibold text-warning">{{ caidas.length }} {{ caidas.length === 1 ? 'caída' : 'caídas' }} en 7 días.</span>
                                    La última: {{ formatearFechaHora(caidas[0]!.fin!) }}{{ textoCausaFin(caidas[0]!) ? ` (${textoCausaFin(caidas[0]!)})` : '' }}.
                                </span>
                                <UButton
                                    label="Ver"
                                    variant="link"
                                    size="sm"
                                    class="shrink-0 px-0"
                                    @click="pestana = 'red'"
                                />
                            </div>
                        </div>
                    </div>

                    <div class="grid gap-4 lg:grid-cols-3">
                        <RedTarjeta
                            titulo="Plan y precio"
                            icono="i-lucide-gauge"
                        >
                            <div class="flex items-baseline justify-between gap-2">
                                <span class="min-w-0">
                                    <span class="text-lg font-bold text-highlighted">{{ nombrePlan(servicio) }}</span>
                                    <span
                                        v-if="plan"
                                        class="ms-1 text-xs text-muted"
                                    >{{ formatearVelocidad(plan.bajada_kbps) }} ↓ / {{ formatearVelocidad(plan.subida_kbps) }} ↑</span>
                                </span>
                                <span
                                    v-if="precio"
                                    class="shrink-0 text-lg font-bold text-highlighted"
                                    data-prueba="precio-mensual-servicio"
                                >{{ formatearQuetzales(precio) }}{{ servicio.costo_override ? ' (precio especial)' : '' }} <span class="text-xs font-normal text-muted">/mes</span></span>
                            </div>
                            <dl>
                                <RedFila
                                    etiqueta="Plantilla de facturación"
                                    :valor="servicio.plantilla_facturacion_id ? (plantilla?.nombre ?? `Plantilla #${servicio.plantilla_facturacion_id}`) : 'Sin plantilla'"
                                />
                                <RedFila
                                    v-if="proximaFactura"
                                    etiqueta="Vence lo pendiente"
                                    :valor="formatearFecha(proximaFactura)"
                                />
                            </dl>
                            <div class="mt-auto flex flex-wrap gap-2">
                                <UButton
                                    v-if="puedeEditar"
                                    label="Cambiar plan"
                                    icon="i-lucide-arrow-right-left"
                                    color="neutral"
                                    variant="outline"
                                    size="sm"
                                    class="rounded-full"
                                    @click="editando = true"
                                />
                            </div>
                            <SeccionSinApi
                                titulo="Promociones de velocidad"
                                descripcion="Duplicar la velocidad por días o en horas fijas. Disponible pronto."
                                icono="i-lucide-zap"
                            />
                        </RedTarjeta>

                        <div class="min-w-0">
                            <ServicioAdicionales
                                :servicio="servicio"
                                @cambiado="lineaTiempo?.recargar()"
                            />
                        </div>

                        <RedTarjeta
                            titulo="Contacto en sitio"
                            icono="i-lucide-users"
                        >
                            <template
                                v-if="puede('clientes.ver') && puede('contactos.buscar')"
                                #accion
                            >
                                <UButton
                                    label="Contactos"
                                    variant="link"
                                    size="sm"
                                    @click="pestana = 'contactos'"
                                />
                            </template>
                            <dl>
                                <RedFila
                                    etiqueta="Titular"
                                    :valor="nombreCliente(servicio)"
                                />
                                <RedFila
                                    etiqueta="Recibe al técnico"
                                    :valor="contactoSitio ?? '—'"
                                    data-prueba="contacto-servicio"
                                />
                                <RedFila
                                    etiqueta="Dirección"
                                    :valor="servicio.direccion"
                                />
                            </dl>
                        </RedTarjeta>
                    </div>

                    <ServicioPlanesTemporales
                        :servicio="servicio"
                        @cambiado="alCambiarPlanTemporal"
                    />
                </div>

                <!-- Red y equipo. -->
                <div
                    v-else-if="pestana === 'red'"
                    class="flex flex-col gap-4"
                    data-prueba="servicio-red"
                >
                    <div class="grid gap-4 lg:grid-cols-2">
                        <RedTarjeta
                            titulo="Red"
                            icono="i-lucide-network"
                        >
                            <dl class="grid gap-x-6 gap-y-3 sm:grid-cols-2">
                                <DatoFicha
                                    etiqueta="Router"
                                    :valor="nombreRouter(servicio)"
                                />
                                <DatoFicha
                                    etiqueta="Tipo de conexión"
                                    :valor="TIPOS_CONEXION[tipoConexionDe(servicio)].etiqueta"
                                />
                                <DatoFicha
                                    v-if="conPppoe && servicio.servidor_pppoe_id"
                                    etiqueta="Servidor PPPoE"
                                    :valor="servidorPppoe?.nombre ?? `Servidor #${servicio.servidor_pppoe_id}`"
                                    data-prueba="servicio-servidor-pppoe"
                                />
                                <DatoFicha
                                    v-if="conPppoe"
                                    etiqueta="Gateway (local-address)"
                                    :valor="servicio.local_address ? `${servicio.local_address}${servicio.local_address_derivado ? `, ${MARCA_GATEWAY_DERIVADO}` : ''}` : 'Sin red IPv4'"
                                    :mono="Boolean(servicio.local_address)"
                                    data-prueba="servicio-local-address"
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
                        </RedTarjeta>

                        <RedTarjeta
                            v-if="conPppoe"
                            titulo="Credenciales PPPoE"
                            icono="i-lucide-key-round"
                        >
                            <ServicioCredenciales
                                :servicio="servicio"
                                @consultado="lineaTiempo?.recargar()"
                            />
                        </RedTarjeta>

                        <RedTarjeta
                            titulo="Ubicación y contacto en sitio"
                            icono="i-lucide-map-pin"
                            data-prueba="ubicacion-contacto-servicio"
                        >
                            <dl class="grid gap-x-6 gap-y-3 sm:grid-cols-2">
                                <DatoFicha
                                    etiqueta="Dirección"
                                    :valor="servicio.direccion"
                                    class="sm:col-span-2"
                                />
                                <DatoFicha
                                    etiqueta="Referencia"
                                    :valor="servicio.referencia ?? null"
                                    class="sm:col-span-2 whitespace-pre-line"
                                    data-prueba="referencia-servicio"
                                />
                                <DatoFicha
                                    etiqueta="Coordenadas"
                                    :valor="servicio.coordenadas"
                                    mono
                                >
                                    <ULink
                                        v-if="mapaServicio"
                                        :to="mapaServicio"
                                        target="_blank"
                                        class="inline-flex items-center gap-1 text-primary"
                                    >
                                        {{ servicio.coordenadas }}
                                        <UIcon
                                            name="i-lucide-external-link"
                                            class="size-3.5"
                                        />
                                    </ULink>
                                    <template v-else>
                                        —
                                    </template>
                                </DatoFicha>
                                <DatoFicha
                                    etiqueta="Contacto en sitio"
                                    :valor="contactoSitio"
                                    data-prueba="contacto-servicio"
                                >
                                    <template v-if="!contactoSitio">
                                        —
                                    </template>
                                    <span v-else-if="servicio.contacto_nombre">{{ servicio.contacto_nombre }}</span>
                                    <ULink
                                        v-if="servicio.contacto_telefono"
                                        :to="`tel:${servicio.contacto_telefono.replace(/[^\d+]/g, '')}`"
                                        :class="servicio.contacto_nombre ? 'ms-2' : ''"
                                        class="inline-flex items-center gap-1 text-primary"
                                    >
                                        <UIcon
                                            name="i-lucide-phone"
                                            class="size-3.5"
                                        />
                                        {{ servicio.contacto_telefono }}
                                    </ULink>
                                </DatoFicha>
                            </dl>
                            <p class="mt-4 flex items-center gap-1.5 border-t border-default pt-4 text-xs font-medium text-muted">
                                <UIcon
                                    name="i-lucide-wrench"
                                    class="size-3.5 shrink-0"
                                />
                                Instalación
                            </p>
                            <dl class="mt-3 grid gap-x-6 gap-y-4 sm:grid-cols-2">
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
                        </RedTarjeta>
                    </div>
                    <ServicioConfiguracionEfectiva
                        ref="configuracionEfectiva"
                        :servicio-id="servicio.id"
                    />
                    <ServicioEquipos
                        v-if="puede('inventario.ver')"
                        :servicio="servicio"
                        @cambiado="alCambiarEquipo"
                    />
                    <section
                        v-if="puede('sesiones.ver') && conPppoe"
                        class="flex flex-col gap-3"
                        aria-label="Historial de sesiones"
                    >
                        <h3 class="text-sm font-semibold text-highlighted">
                            Historial de sesiones
                        </h3>
                        <ServicioSesiones
                            ref="historialSesiones"
                            :servicio-id="servicio.id"
                        />
                    </section>
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
                </div>

                <!-- Facturas. -->
                <div
                    v-else-if="pestana === 'facturas'"
                    class="flex flex-col gap-4"
                    data-prueba="servicio-facturas"
                >
                    <ProblemaAlerta
                        v-if="facturasServicio.problema.value"
                        :problema="facturasServicio.problema.value"
                        :reintentar="facturasServicio.recargar"
                        :reintentando="facturasServicio.cargando.value"
                    />
                    <template v-else>
                        <UTable
                            :data="facturasServicio.filas.value"
                            :columns="columnasFacturas"
                            :loading="facturasServicio.cargando.value"
                            :ui="{ thead: 'bg-(--ax-cabecera-tabla)', th: 'text-xs', td: 'py-2.5' }"
                        >
                            <template #periodo-cell="{ row }">
                                <ULink
                                    :to="`/facturas/${row.original.id}`"
                                    class="font-semibold text-highlighted hover:text-primary"
                                >{{ row.original.periodo }}</ULink>
                            </template>
                            <template #vence_en-cell="{ row }">
                                <span class="text-sm text-muted">{{ formatearFecha(row.original.vence_en) }}</span>
                            </template>
                            <template #total-cell="{ row }">
                                <span class="font-semibold tabular-nums">{{ formatearQuetzales(row.original.total) }}</span>
                            </template>
                            <template #estado-cell="{ row }">
                                <EstadoFacturaBadge :estado="row.original.estado" />
                            </template>
                            <template #empty>
                                <UEmpty
                                    icon="i-lucide-receipt"
                                    title="Sin facturas"
                                    variant="naked"
                                />
                            </template>
                        </UTable>
                        <PaginacionCursor
                            :pagina="facturasServicio.pagina.value"
                            :hay-anterior="facturasServicio.hayAnterior.value"
                            :hay-siguiente="facturasServicio.haySiguiente.value"
                            :cargando="facturasServicio.cargando.value"
                            :filas="facturasServicio.filas.value.length"
                            @anterior="facturasServicio.anterior"
                            @siguiente="facturasServicio.siguiente"
                        />
                    </template>
                    <PeriodosBonificados
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
                                    <PromesaCumplimiento
                                        :promesa="promesa"
                                        class="my-1"
                                    />
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
                </div>

                <!-- Equipo: SmartOLT y ACS. -->
                <ServicioEquipoGestion
                    v-else-if="pestana === 'equipo' && puede('servicios.ver_equipo')"
                    :servicio-id="servicio.id"
                />

                <!-- Contactos. -->
                <ClienteContactos
                    v-else-if="pestana === 'contactos' && puede('clientes.ver') && puede('contactos.buscar')"
                    :cliente-id="servicio.cliente_id"
                    :servicios="serviciosCliente"
                />

                <!-- Promociones de velocidad (decisiones del PM 18 y 34). -->
                <ServicioPromociones
                    v-else-if="pestana === 'promociones'"
                    ref="promocionesServicio"
                    :servicio="servicio"
                    @cambiada="lineaTiempo?.recargar()"
                />

                <!-- Bitácora. -->
                <LineaTiempoBitacora
                    v-else-if="pestana === 'bitacora'"
                    ref="linea"
                    :filtros="filtrosLinea"
                    etiqueta="Historial del servicio"
                />

                <!-- Portal de corte. -->
                <ServicioCodigoCorte
                    v-else-if="pestana === 'corte'"
                    ref="codigoCorte"
                    :servicio-id="servicio.id"
                />
            </section>

            <!-- Teléfono: «Más», Promesa y «Cobrar Q …» fijos abajo. -->
            <RedBarraTelefono>
                <UDropdownMenu
                    v-if="itemsMasTelefono.length"
                    :items="itemsMasTelefono"
                    :content="{ align: 'start', side: 'top' }"
                >
                    <UButton
                        icon="i-lucide-ellipsis"
                        color="neutral"
                        variant="outline"
                        size="lg"
                        class="rounded-full"
                        aria-label="Más acciones del servicio"
                    />
                </UDropdownMenu>
                <UButton
                    v-if="puedePromesa"
                    :label="puedeCargoUnico ? undefined : 'Promesa'"
                    aria-label="Promesa de pago"
                    icon="i-lucide-hand"
                    color="neutral"
                    variant="outline"
                    size="lg"
                    class="justify-center rounded-full"
                    :class="puedeCargoUnico ? '' : 'flex-1'"
                    @click="abrirPromesa"
                />
                <UButton
                    v-if="puedeCargoUnico"
                    label="Nueva factura"
                    icon="i-lucide-plus"
                    color="neutral"
                    variant="outline"
                    size="lg"
                    class="flex-1 justify-center rounded-full"
                    data-prueba="nueva-factura-telefono"
                    @click="cargoAbierto = true"
                />
                <UButton
                    v-if="puede('pagos.registrar') && debe && saldo"
                    :to="enlaceCobro"
                    :label="`Cobrar ${formatearQuetzales(saldo)}`"
                    :icon="ICONOS.cobrar"
                    color="success"
                    size="lg"
                    class="flex-[2] justify-center rounded-full"
                />
            </RedBarraTelefono>

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
                @creada="alCrearPromesa"
            />

            <FacturaNuevaPanel
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

            <ServicioSincronizarRouterModal
                v-model:open="sincronizarRouterAbierto"
                :servicio="servicio"
                :nombre-router="servicio.router_nombre"
            />

            <EliminarRegistroModal
                v-if="puedeEliminar && eliminable?.eliminable"
                :id="servicio.id"
                v-model:open="eliminarAbierto"
                tipo="servicio"
                :nombre="etiquetaServicio(servicio)"
                :version="servicio.version"
                :libera="liberaServicio"
                @eliminado="alEliminar"
                @recargar="cargar"
            />

            <ServicioAccionModal
                v-model:open="accionAbierta"
                :servicio="servicio"
                :accion="accionElegida"
                @hecho="alTerminar"
            />
            <ServicioCambiarEquipo
                v-if="equipos && puede('servicios.cambiar_equipo')"
                v-model:open="cambiarEquipoAbierto"
                :servicio-id="servicio.id"
                :equipos="equipos"
                @hecho="alCambiarEquipo"
            />
        </div>
    </PanelPagina>
</template>
