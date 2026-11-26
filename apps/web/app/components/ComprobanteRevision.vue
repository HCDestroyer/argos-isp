<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import Decimal from 'decimal.js'

/**
 * Revisión de un comprobante en una sola vista (decisión 13 del PM, tableros OperComprobantes y
 * OperComprobanteMovil): la foto, lo que el cliente declaró, a qué facturas se aplicaría y la
 * decisión. Aprobar (`POST /comprobantes/:id/aprobar` con las facturas marcadas) registra el pago y
 * reactiva (`pago.servicios[]`); rechazar pide la causa y el motivo en una ventana corta. Al decidir
 * emite `decidido` para que la pantalla pase al siguiente.
 *
 * Comprobante con menos dinero (decisión 14): queda como abono a la factura más vieja y se dice
 * cuánto falta. Una `Idempotency-Key` por comprobante abierto.
 */
const props = withDefaults(defineProps<{
    comprobanteId: number
    /** «1 de 5 por revisar» (teléfono). */
    posicion?: string | null
    /** Teléfono: encabezado con «Atrás» y la decisión fija abajo a todo el ancho. */
    movil?: boolean
}>(), {
    posicion: null,
    movil: false,
})

const emit = defineEmits<{
    decidido: [comprobante: Comprobante]
}>()

const { puede, enlace } = usePermisos()
const toast = useToast()
const hoy = hoyGuatemala()

const comprobante = shallowRef<Comprobante | null>(null)
const cargando = ref(true)
const problema = ref<Problem | null>(null)

const servicio = shallowRef<Servicio | null>(null)
const cuenta = shallowRef<EstadoCuenta | null>(null)
const cargandoCuenta = ref(false)
const problemaCuenta = ref<Problem | null>(null)
const marcadas = ref<number[]>([])

const aprobando = ref(false)
const problemaAprobar = ref<Problem | null>(null)
const rechazarAbierto = ref(false)
/** Pago y servicios evaluados de la aprobación recién hecha (solo vienen en la respuesta). */
const pagoRegistrado = shallowRef<Pago | null>(null)
let claveIdempotencia = nuevaClaveIdempotencia()

const pendiente = computed(() => comprobante.value?.estado === 'pendiente')
const reactivados = computed(() => (pagoRegistrado.value?.servicios ?? []).filter(s => s.cambiado))
const sinReactivar = computed(() => (pagoRegistrado.value?.servicios ?? []).filter(s => !s.cambiado && s.estado !== 'activo'))

const puedeElegir = computed(() => puede('clientes.estado_cuenta'))
const resumen = computed(() => (cuenta.value ? resumenPendiente(cuenta.value.facturas_pendientes, hoy) : null))
const monto = computed(() => new Decimal(comprobante.value?.monto ?? 0))
const distribucion = computed(() => (resumen.value && marcadas.value.length ? distribuirPago(monto.value, resumen.value.facturas, marcadas.value) : null))
const totalMarcadas = computed(() => (resumen.value ? sumaMarcadas(resumen.value.facturas, marcadas.value) : null))
/** Lo que falta para cubrir las marcadas (abono, decisión 14), o `null` si alcanza. */
const faltante = computed(() => (totalMarcadas.value && totalMarcadas.value.gt(monto.value) ? totalMarcadas.value.minus(monto.value) : null))
const sobrante = computed(() => (totalMarcadas.value && monto.value.gt(totalMarcadas.value) ? monto.value.minus(totalMarcadas.value) : null))

const nombreServicio = computed(() => {
    const actual = comprobante.value
    if (!actual?.servicio_id) {
        return null
    }
    if (servicio.value) {
        return [servicio.value.codigo, servicio.value.nombre].filter(Boolean).join(' · ')
    }
    return `Servicio #${actual.servicio_id}`
})

const subtitulo = computed(() => {
    const actual = comprobante.value
    if (!actual) {
        return ''
    }
    return [nombreServicio.value, props.posicion, `Llegó por ${CANALES_COMPROBANTE[actual.canal].toLowerCase()}`].filter(Boolean).join(' · ')
})

async function cargar() {
    cargando.value = true
    problema.value = null
    pagoRegistrado.value = null
    problemaAprobar.value = null
    claveIdempotencia = nuevaClaveIdempotencia()
    const resultado = await useComprobantes().ver(props.comprobanteId)
    cargando.value = false
    if (!resultado.ok) {
        comprobante.value = null
        problema.value = resultado.problema
        return
    }
    comprobante.value = resultado.data
    void cargarServicio()
    void cargarCuenta()
}

async function cargarServicio() {
    servicio.value = null
    const actual = comprobante.value
    if (!actual?.servicio_id || !puede('servicios.ver')) {
        return
    }
    const resultado = await useServicios().ver(actual.servicio_id)
    servicio.value = resultado.ok ? resultado.data : null
}

/** Las facturas pendientes del cliente; marcadas por defecto las que elegiría la API. */
async function cargarCuenta() {
    cuenta.value = null
    marcadas.value = []
    problemaCuenta.value = null
    const actual = comprobante.value
    if (!actual || actual.estado !== 'pendiente' || !puedeElegir.value) {
        return
    }
    cargandoCuenta.value = true
    const resultado = await useClientes().estadoCuenta(actual.cliente_id)
    cargandoCuenta.value = false
    if (!resultado.ok) {
        problemaCuenta.value = resultado.problema
        return
    }
    cuenta.value = resultado.data
    const pantalla = resumenPendiente(resultado.data.facturas_pendientes, hoy).facturas
    const porDefecto = new Set(facturasPorDefectoComprobante(actual, pantalla))
    const elegidas = pantalla.filter(f => porDefecto.has(f.id)).map(f => f.id)
    // Sin servicio en el comprobante, la API aplica a la más antigua: se marca esa.
    marcadas.value = elegidas.length ? elegidas : pantalla.slice(0, 1).map(f => f.id)
}

function marcar(facturaId: number, valor: boolean) {
    const elegidas = new Set(marcadas.value)
    if (valor) {
        elegidas.add(facturaId)
    }
    else {
        elegidas.delete(facturaId)
    }
    marcadas.value = (resumen.value?.facturas ?? []).filter(f => elegidas.has(f.id)).map(f => f.id)
}

/*
 * Reconexión temporal (contrato Iris 0.6.0 §7.3): la promesa `reconexion_temporal` activa ligada a
 * este comprobante. Rechazarlo la cancela. Sin `promesas.ver` no se puede saber: se avisa.
 */
const reconexion = shallowRef<Promesa | null>(null)
const problemaReconexion = ref<Problem | null>(null)
const cargandoReconexion = ref(false)
const reconexionDesconocida = computed(() => pendiente.value && (problemaReconexion.value !== null || !puede('promesas.ver')))

async function cargarReconexion() {
    reconexion.value = null
    problemaReconexion.value = null
    const actual = comprobante.value
    if (!actual || actual.estado !== 'pendiente' || !puede('promesas.ver')) {
        return
    }
    cargandoReconexion.value = true
    const resultado = await usePromesas().listar({ cliente_id: actual.cliente_id, tipo: 'reconexion_temporal', estado: 'activa', limit: 50 })
    cargandoReconexion.value = false
    if (!resultado.ok) {
        problemaReconexion.value = resultado.problema
        return
    }
    reconexion.value = resultado.data.data.find(p => p.comprobante_id === actual.id) ?? null
}

watch(comprobante, () => void cargarReconexion())

/** Servicio cortado sin reconexión: el tablero ofrece reconectarlo mientras se revisa. */
const servicioCortado = computed(() => pendiente.value && servicio.value !== null && (servicio.value.estado === 'suspendido' || servicio.value.estado === 'limitado') && !reconexion.value)

/**
 * «Reconectar mientras reviso» (decisión 15: el cajero da la reconexión temporal con las reglas y el
 * cupo de Iris). `POST /promesas` del panel todavía no acepta `tipo: reconexion_temporal`: pedido a A3
 * (`.claude/integration/a4.md`). Hasta entonces el botón se ve deshabilitado y dice por qué.
 */
const MOTIVO_SIN_RECONEXION = 'El panel todavía no puede dar la reconexión temporal (llega con la API de la decisión 15). Mientras tanto, revisa el comprobante o da una promesa desde el servicio.'

async function aprobar() {
    const actual = comprobante.value
    if (!actual) {
        return
    }
    aprobando.value = true
    problemaAprobar.value = null
    const datos: DatosAprobarComprobante = {}
    if (marcadas.value.length) {
        datos.facturas = marcadas.value
    }
    const resultado = await useComprobantes().aprobar(actual.id, datos, claveIdempotencia)
    aprobando.value = false
    if (!resultado.ok) {
        problemaAprobar.value = resultado.problema
        if (esComprobanteRevisado(resultado.problema)) {
            void cargar()
        }
        return
    }
    comprobante.value = resultado.data
    pagoRegistrado.value = resultado.data.pago ?? null
    // Al decidir la pantalla pasa al siguiente (decisión 13): el cambio de estado va en el aviso.
    const cambios = reactivados.value.map(r => `Servicio ${r.servicio_id}: ${ESTADOS_SERVICIO[r.de].etiqueta} → ${ESTADOS_SERVICIO[r.estado].etiqueta}`)
    toast.add({
        title: 'Comprobante aprobado',
        description: [`Pago${resultado.data.pago_id ? ` #${resultado.data.pago_id}` : ''} de ${formatearQuetzales(resultado.data.monto)} registrado`, ...cambios].join(' · '),
        icon: 'i-lucide-badge-check',
        color: 'success',
    })
    emit('decidido', resultado.data)
}

function alRechazar(rechazado: Comprobante) {
    const conReconexion = reconexion.value !== null
    comprobante.value = rechazado
    toast.add({
        title: 'Comprobante rechazado',
        description: conReconexion
            ? 'La reconexión temporal se canceló: el servicio vuelve a cortarse a la hora de corte.'
            : llegoPorIris(rechazado)
                ? 'Iris se lo explica al cliente en la conversación.'
                : 'Se avisa al cliente con el motivo; puede subirlo de nuevo.',
        icon: 'i-lucide-circle-x',
        color: 'success',
    })
    emit('decidido', rechazado)
}

/**
 * «Ver conversación en Iris»: el autologin de Iris todavía no acepta el destino `conversacion`
 * (pedido B2 a Iris). Hasta entonces el enlace se ve deshabilitado y dice por qué.
 */
const MOTIVO_SIN_CONVERSACION = 'Iris todavía no permite abrir una conversación desde Argos (pedido B2). Búscala en Iris con este código.'

watch(() => props.comprobanteId, cargar)
onMounted(cargar)

defineExpose({ comprobante })
</script>

<template>
    <div
        class="flex min-h-0 min-w-0 flex-col"
        :class="movil ? 'gap-3 pb-24 lg:pb-0' : 'surface-card h-full overflow-hidden rounded-[1.375rem]'"
        data-prueba="revision-comprobante"
    >
        <div
            v-if="cargando && !comprobante"
            class="flex flex-col gap-4 p-4"
        >
            <USkeleton class="h-10 w-64" />
            <USkeleton class="h-56 w-full rounded-2xl" />
            <USkeleton class="h-32 w-full" />
        </div>

        <UEmpty
            v-else-if="problema?.status === 404"
            icon="i-lucide-file-x"
            title="Comprobante no encontrado"
            :description="`No existe un comprobante con id ${comprobanteId}.`"
            variant="naked"
            class="m-auto"
        />

        <div
            v-else-if="problema"
            class="p-4"
        >
            <ProblemaAlerta
                :problema="problema"
                :reintentar="cargar"
                :reintentando="cargando"
            />
        </div>

        <template v-else-if="comprobante">
            <!-- Encabezado: cliente, servicio y por dónde llegó. -->
            <header
                class="flex items-start gap-3"
                :class="movil ? '' : 'border-b border-(--ax-borde) p-4'"
            >
                <slot name="antes-del-titulo" />
                <span
                    v-if="!movil"
                    class="pastilla-icono pastilla-tono tono-marca size-10 shrink-0 rounded-xl"
                >
                    <UIcon
                        name="i-lucide-image"
                        class="size-5"
                    />
                </span>
                <div class="flex min-w-0 flex-1 flex-col">
                    <h2 class="truncate text-lg font-bold text-highlighted">
                        <ULink
                            :to="enlace(`/clientes/${comprobante.cliente_id}?tab=cuenta`)"
                            class="text-highlighted hover:text-primary"
                        >
                            {{ comprobante.cliente_nombre }}
                        </ULink>
                    </h2>
                    <p
                        class="text-[0.8125rem] text-muted"
                        :class="movil ? '' : 'truncate'"
                    >
                        Comprobante #{{ comprobante.id }} · {{ subtitulo }}
                    </p>
                </div>
                <div class="flex shrink-0 flex-col items-end gap-1">
                    <span
                        class="pastilla-tono rounded-full px-2.5 py-0.5 text-xs font-semibold"
                        :class="CANAL_COMPROBANTE_CORTO[comprobante.canal].tono"
                        :data-prueba="llegoPorIris(comprobante) ? 'llego-por-iris' : 'canal-comprobante'"
                    >{{ CANAL_COMPROBANTE_CORTO[comprobante.canal].etiqueta }}</span>
                    <UBadge
                        v-if="!pendiente"
                        :label="ESTADOS_COMPROBANTE[comprobante.estado].etiqueta"
                        :icon="ESTADOS_COMPROBANTE[comprobante.estado].icono"
                        :color="ESTADOS_COMPROBANTE[comprobante.estado].color"
                        variant="subtle"
                        data-prueba="estado-comprobante"
                    />
                </div>
            </header>

            <div
                class="flex min-h-0 flex-1 flex-col gap-4"
                :class="movil ? '' : 'overflow-y-auto p-4 [&>*]:shrink-0'"
            >
                <!-- Servicio cortado: reconectar mientras se revisa (decisión 15). -->
                <UAlert
                    v-if="servicioCortado && servicio"
                    color="error"
                    variant="subtle"
                    :icon="ESTADOS_SERVICIO[servicio.estado].icono"
                    :title="`El servicio está ${ESTADOS_SERVICIO[servicio.estado].etiqueta.toLowerCase()}.`"
                    description="Si no puedes revisarlo ya, reconéctalo mientras tanto (1 vez por periodo)."
                    data-prueba="servicio-cortado"
                >
                    <template #actions>
                        <span :title="MOTIVO_SIN_RECONEXION">
                            <UButton
                                label="Reconectar mientras reviso"
                                icon="i-lucide-power"
                                color="neutral"
                                variant="outline"
                                size="sm"
                                disabled
                                data-prueba="reconectar-mientras-reviso"
                            />
                        </span>
                    </template>
                </UAlert>

                <UAlert
                    v-if="pendiente && reconexion"
                    color="warning"
                    variant="subtle"
                    icon="i-lucide-plug-zap"
                    :title="['Reconexión temporal activa', etiquetaMotivoReconexion(reconexion)].filter(Boolean).join(' · ')"
                    :description="`Se reconectó el servicio ${reconexion.servicio_id} mientras se revisa este comprobante, hasta el ${formatearFechaHora(reconexion.vence_en)}. Rechazarlo vuelve a cortar el servicio a la hora de corte.`"
                    :actions="puede('promesas.ver') ? [{ label: 'Ver promesas', to: `/promesas?servicio=${reconexion.servicio_id}`, color: 'warning', variant: 'outline' }] : undefined"
                    data-prueba="aviso-reconexion"
                />
                <ProblemaAlerta
                    v-else-if="pendiente && problemaReconexion"
                    :problema="problemaReconexion"
                    :reintentar="cargarReconexion"
                    :reintentando="cargandoReconexion"
                    data-prueba="error-reconexion"
                />

                <UAlert
                    v-if="comprobante.estado === 'aprobado'"
                    color="success"
                    variant="subtle"
                    icon="i-lucide-badge-check"
                    title="Comprobante aprobado"
                    :description="`${textoRevision(comprobante) ?? 'Revisado'}.`"
                    :actions="comprobante.pago_id && puede('pagos.ver') ? [{ label: `Ver pago #${comprobante.pago_id}`, to: `/pagos/${comprobante.pago_id}`, icon: 'i-lucide-banknote', color: 'success', variant: 'outline' }] : undefined"
                    data-prueba="comprobante-aprobado"
                />
                <UAlert
                    v-else-if="comprobante.estado === 'rechazado'"
                    color="error"
                    variant="subtle"
                    icon="i-lucide-circle-x"
                    title="Comprobante rechazado"
                    :description="[etiquetaCausaRechazo(comprobante.causa_rechazo), comprobante.motivo_rechazo, textoRevision(comprobante)].filter(Boolean).join(' · ')"
                    data-prueba="comprobante-rechazado"
                />
                <UAlert
                    v-for="reactivado in reactivados"
                    :key="`r${reactivado.servicio_id}`"
                    color="success"
                    variant="subtle"
                    icon="i-lucide-wifi"
                    :title="`Servicio ${reactivado.servicio_id} reactivado`"
                    :description="`${ESTADOS_SERVICIO[reactivado.de].etiqueta} → ${ESTADOS_SERVICIO[reactivado.estado].etiqueta} · ${reactivado.motivo}`"
                    :actions="puede('servicios.ver') ? [{ label: 'Ver servicio', to: `/servicios/${reactivado.servicio_id}`, color: 'success', variant: 'outline' }] : undefined"
                    data-prueba="servicio-reactivado"
                />
                <UAlert
                    v-for="sigue in sinReactivar"
                    :key="`s${sigue.servicio_id}`"
                    color="warning"
                    variant="subtle"
                    :icon="ESTADOS_SERVICIO[sigue.estado].icono"
                    :title="`Servicio ${sigue.servicio_id} sigue ${ESTADOS_SERVICIO[sigue.estado].etiqueta.toLowerCase()}`"
                    :description="sigue.motivo"
                />

                <ComprobanteArchivo :comprobante="comprobante" />

                <div class="grid gap-3 2xl:grid-cols-2">
                    <!-- Lo que declaró el cliente. -->
                    <section
                        class="rounded-2xl border border-(--ax-borde) p-4"
                        aria-labelledby="declaro-titulo"
                    >
                        <h3
                            id="declaro-titulo"
                            class="mb-2 flex items-center gap-2 text-xs font-semibold tracking-[0.06em] text-muted uppercase"
                        >
                            <UIcon
                                name="i-lucide-file-text"
                                class="size-4"
                            />
                            Lo que declaró
                        </h3>
                        <dl class="flex flex-col divide-y divide-(--ax-borde) text-sm">
                            <div class="flex items-baseline justify-between gap-3 py-2">
                                <dt class="text-muted">
                                    Monto
                                </dt>
                                <dd class="text-lg font-bold tabular-nums text-highlighted">
                                    {{ formatearQuetzales(comprobante.monto) }}
                                </dd>
                            </div>
                            <div class="flex justify-between gap-3 py-2">
                                <dt class="text-muted">
                                    Método
                                </dt>
                                <dd class="text-end text-highlighted">
                                    {{ ETIQUETAS_METODO[comprobante.metodo] }}
                                </dd>
                            </div>
                            <div class="flex justify-between gap-3 py-2">
                                <dt class="shrink-0 text-muted">
                                    Cuenta de destino
                                </dt>
                                <dd class="min-w-0 truncate text-end text-highlighted">
                                    {{ comprobante.cuenta_bancaria_nombre }}
                                </dd>
                            </div>
                            <div
                                v-if="comprobante.banco_origen_nombre"
                                class="flex justify-between gap-3 py-2"
                            >
                                <dt class="text-muted">
                                    Banco de origen
                                </dt>
                                <dd class="text-end text-highlighted">
                                    {{ comprobante.banco_origen_nombre }}
                                </dd>
                            </div>
                            <div class="flex items-center justify-between gap-3 py-2">
                                <dt class="text-muted">
                                    {{ etiquetaReferencia(comprobante.metodo) }}
                                </dt>
                                <dd>
                                    <span
                                        class="rounded-md bg-(--ax-panel) px-2 py-0.5 font-mono text-highlighted"
                                        data-copiar
                                    >{{ comprobante.referencia }}</span>
                                </dd>
                            </div>
                            <div class="flex justify-between gap-3 py-2">
                                <dt class="text-muted">
                                    Fecha del depósito
                                </dt>
                                <dd class="text-end text-highlighted">
                                    {{ formatearFecha(comprobante.fecha_deposito) }}
                                </dd>
                            </div>
                            <div
                                v-if="comprobante.nota"
                                class="flex flex-col gap-0.5 py-2"
                            >
                                <dt class="text-muted">
                                    Nota del cliente
                                </dt>
                                <dd class="text-highlighted">
                                    {{ comprobante.nota }}
                                </dd>
                            </div>
                        </dl>
                    </section>

                    <!-- A qué se aplicaría (pendiente) o lectura de Iris. -->
                    <section
                        class="flex flex-col gap-2 rounded-2xl border border-(--ax-borde) p-4"
                        aria-labelledby="aplica-titulo"
                    >
                        <h3
                            id="aplica-titulo"
                            class="flex items-center gap-2 text-xs font-semibold tracking-[0.06em] text-muted uppercase"
                        >
                            <UIcon
                                name="i-lucide-zap"
                                class="size-4"
                            />
                            {{ pendiente ? 'A qué se aplicaría' : 'Revisión' }}
                        </h3>

                        <template v-if="pendiente">
                            <p
                                v-if="!puedeElegir"
                                class="text-sm text-muted"
                            >
                                Se aplica primero a las facturas del servicio del comprobante y luego a la más antigua.
                            </p>
                            <ProblemaAlerta
                                v-else-if="problemaCuenta"
                                :problema="problemaCuenta"
                                :reintentar="cargarCuenta"
                                :reintentando="cargandoCuenta"
                            />
                            <USkeleton
                                v-else-if="cargandoCuenta || !resumen"
                                class="h-20 w-full"
                            />
                            <p
                                v-else-if="!resumen.facturas.length"
                                class="text-sm text-muted"
                            >
                                El cliente no tiene facturas pendientes: todo el monto queda como saldo a favor.
                            </p>
                            <template v-else>
                                <CobroFacturasLista
                                    :facturas="resumen.facturas"
                                    :marcadas="marcadas"
                                    etiqueta="Facturas a las que se aplica"
                                    @marcar="marcar"
                                />
                                <div
                                    class="flex flex-wrap gap-1.5"
                                    data-prueba="distribucion-comprobante"
                                >
                                    <UBadge
                                        v-if="!marcadas.length"
                                        label="Sin facturas marcadas: va a la más antigua"
                                        color="neutral"
                                        variant="subtle"
                                    />
                                    <UBadge
                                        v-else-if="faltante"
                                        :label="`Queda como abono: faltan ${formatearQuetzales(faltante)}`"
                                        icon="i-lucide-circle-dashed"
                                        color="warning"
                                        variant="subtle"
                                        data-prueba="abono-faltante"
                                    />
                                    <UBadge
                                        v-else-if="sobrante"
                                        :label="`Sobran ${formatearQuetzales(sobrante)}: van a otras facturas o a favor`"
                                        icon="i-lucide-circle-plus"
                                        color="info"
                                        variant="subtle"
                                    />
                                    <UBadge
                                        v-else
                                        label="Coincide con lo marcado"
                                        icon="i-lucide-circle-check"
                                        color="success"
                                        variant="subtle"
                                    />
                                </div>
                                <ul
                                    v-if="distribucion"
                                    class="flex flex-col gap-0.5 text-xs text-muted"
                                    aria-label="Cómo se aplicará el pago"
                                >
                                    <li
                                        v-for="linea in [...distribucion.marcadas, ...distribucion.otras].filter(l => l.aplicado.gt(0))"
                                        :key="linea.factura.id"
                                        class="flex justify-between gap-3"
                                    >
                                        <span>Aviso #{{ linea.factura.id }} · {{ etiquetaPeriodo(linea.factura.periodo) }}<template v-if="linea.parcial"> (abono)</template></span>
                                        <span class="tabular-nums text-default">{{ formatearQuetzales(linea.aplicado) }}</span>
                                    </li>
                                    <li
                                        v-if="distribucion.aFavor.gt(0)"
                                        class="flex justify-between gap-3"
                                    >
                                        <span>Saldo a favor del cliente</span>
                                        <span class="tabular-nums text-default">{{ formatearQuetzales(distribucion.aFavor) }}</span>
                                    </li>
                                </ul>
                            </template>
                        </template>

                        <dl
                            v-else
                            class="flex flex-col gap-1 text-sm"
                        >
                            <dd class="text-highlighted">
                                {{ textoRevision(comprobante) ?? 'Revisado' }}
                            </dd>
                            <dd v-if="comprobante.pago_id">
                                <ULink
                                    :to="enlace(`/pagos/${comprobante.pago_id}`)"
                                    class="text-primary"
                                >
                                    Pago #{{ comprobante.pago_id }}
                                </ULink>
                            </dd>
                        </dl>

                        <div
                            v-if="llegoPorIris(comprobante)"
                            class="mt-auto flex flex-col gap-1 border-t border-(--ax-borde) pt-2 text-xs text-muted"
                            data-prueba="lectura-iris"
                        >
                            <span class="flex items-center gap-1.5">
                                <UIcon
                                    name="i-lucide-bot"
                                    class="size-3.5"
                                />
                                {{ resumenLecturaIris(comprobante) ?? 'Llegó por Iris' }}
                                <template v-if="textoActorIris(comprobante.iris_actor)"> · {{ textoActorIris(comprobante.iris_actor) }}</template>
                            </span>
                            <span
                                :title="MOTIVO_SIN_CONVERSACION"
                                class="self-start"
                            >
                                <UButton
                                    label="Ver conversación en Iris"
                                    icon="i-lucide-message-square"
                                    color="primary"
                                    variant="link"
                                    size="xs"
                                    class="self-start px-0"
                                    disabled
                                    data-prueba="ver-conversacion-iris"
                                />
                            </span>
                            <span class="sr-only">{{ MOTIVO_SIN_CONVERSACION }}</span>
                            <span
                                v-if="comprobante.iris_conversacion"
                                class="font-mono"
                            >{{ comprobante.iris_conversacion }}</span>
                        </div>
                    </section>
                </div>

                <UAlert
                    v-if="esCuentaInactiva(problemaAprobar)"
                    color="error"
                    variant="subtle"
                    icon="i-lucide-landmark"
                    :title="`${comprobante.cuenta_bancaria_nombre}: cuenta desactivada`"
                    description="El cliente depositó en una cuenta que ya no recibe pagos. Pide que la vuelvan a activar en Ajustes → Cuentas bancarias, o rechaza el comprobante y explícale al cliente dónde depositar."
                    data-prueba="cuenta-inactiva"
                />
                <template v-else-if="problemaAprobar">
                    <ProblemaAlerta :problema="problemaAprobar" />
                    <p
                        v-if="esReferenciaDuplicada(problemaAprobar)"
                        class="text-xs text-muted"
                    >
                        Ya hay un pago con esa referencia: revisa el pago existente y rechaza este comprobante.
                    </p>
                </template>
            </div>

            <!--
                Decisión: en escritorio al pie de la tarjeta; en el teléfono es la acción fija, en su isla
                justo encima de la navegación (`.panel-barra-accion`, tablero MarcoMovil).
            -->
            <footer
                v-if="pendiente && (puede('comprobantes.aprobar') || puede('comprobantes.rechazar'))"
                class="flex items-center gap-3"
                :class="movil
                    ? 'panel-barra-accion lg:rounded-2xl lg:border lg:border-(--ax-borde) lg:p-3'
                    : 'border-t border-(--ax-borde) p-4'"
                data-prueba="decision-comprobante"
            >
                <UButton
                    v-if="puede('comprobantes.rechazar')"
                    label="Rechazar"
                    icon="i-lucide-circle-x"
                    color="error"
                    variant="outline"
                    size="lg"
                    :class="movil ? 'flex-1 justify-center' : ''"
                    :disabled="aprobando"
                    @click="rechazarAbierto = true"
                />
                <p
                    v-if="!movil"
                    class="hidden min-w-0 flex-1 text-xs text-muted sm:block"
                >
                    Registra el pago de hoy a {{ comprobante.cuenta_bancaria_nombre }}
                </p>
                <UButton
                    v-if="puede('comprobantes.aprobar')"
                    :label="movil ? `Aprobar ${formatearQuetzales(comprobante.monto)}` : 'Aprobar y registrar el pago'"
                    icon="i-lucide-check"
                    color="success"
                    size="lg"
                    :class="movil ? 'flex-[2] justify-center' : 'ms-auto'"
                    :loading="aprobando"
                    :disabled="problemaAprobar !== null && esComprobanteRevisado(problemaAprobar)"
                    data-prueba="aprobar-comprobante"
                    @click="aprobar"
                />
            </footer>

            <ComprobanteRechazarModal
                v-model:open="rechazarAbierto"
                :comprobante="comprobante"
                :reconexion="reconexion"
                :reconexion-desconocida="reconexionDesconocida"
                @hecho="alRechazar"
                @revisado="cargar"
            />
        </template>
    </div>
</template>
