<script setup lang="ts">
/**
 * Página de corte: aquí aterriza el cliente suspendido (dst-nat del MikroTik y detección de
 * portal cautivo). Identifica el servicio por la IP de origen (`GET /portal/quien-soy`) y solo
 * muestra nombre parcial, estado y montos.
 *
 * Día 2: estado, monto, facturas vencidas, datos de depósito y contacto. Día 4: solicitar promesa
 * de pago (tarea 4, `PromesaSolicitar`) y subir el comprobante de depósito (tarea 5,
 * `ComprobanteSubir`). Semana 2: pagar en línea (`PagoEnLinea`); la pasarela devuelve al cliente a
 * `/corte?pago=<id>&estado=<pagado|fallido>`, donde se sigue el cobro (`GET /portal/pagos/en-linea/:id`)
 * junto con el estado; `estado` (lo que dijo el proveedor) se muestra mientras llega el webhook.
 *
 * Estado en vivo (tarea 6): después de cualquier acción del cliente, cuando la pestaña vuelve a
 * estar visible o si ya tiene una promesa activa, consulta `GET /portal/estado` cada 5 s hasta
 * 2 min; al ver `activo` muestra "Ya tienes servicio".
 *
 * Pendiente de instalación (`contratos/instalacion.md` §3): nunca se muestra como cortado. Se ven
 * «Instalación pendiente» y sus cargos únicos (que se pagan en línea o por depósito), sin promesa ni
 * espera de reactivación: el servicio se activa cuando el técnico cierra la instalación.
 */
const { seguirNavegandoUrl } = useRuntimeConfig().public
/** Los `data-testid` de siempre de `/corte` (pruebas y guía del piloto). */
const TESTIDS_CORTE: Partial<Record<IdAcceso, string>> = {
    comprobante: 'subir-comprobante',
    promesa: 'solicitar-promesa',
    facturas: 'ver-mi-cuenta',
    soporte: 'contacto-corte',
    deposito: 'ver-deposito',
}
const route = useRoute()
const router = useRouter()
const { data: corte, status, error, refresh } = useCorte()
// Contacto, instrucciones y cuentas de depósito: configuración del panel (tarea 9).
const { empresa, nombre: nombreEmpresa } = useEmpresa()

useHead({ title: computed(() => `Estado del servicio · ${nombreEmpresa.value}`) })

const cargando = computed(() => status.value === 'idle' || status.value === 'pending')
const mensaje = computed(() => corte.value ? mensajeCorte(corte.value) : null)
const identificado = computed(() => corte.value?.identificado === true)
const retirado = computed(() => corte.value?.estado === 'retirado')
const pendiente = computed(() => esPendienteInstalacion(corte.value?.estado))

const verDeposito = ref(false)
const verPromesa = ref(false)
const verComprobante = ref(false)

/** Último comprobante enviado desde esta página: queda en revisión; al aprobarlo, el servicio vuelve. */
const comprobante = ref<ComprobantePortal | null>(null)
function comprobanteEnviado(enviado: ComprobantePortal) {
    comprobante.value = enviado
    vigilarEstado()
}

/** Última promesa enviada desde esta página (aprobada o pendiente; la rechazada se ve en el modal). */
const promesa = ref<PromesaSolicitada | null>(null)
const puedePedirPromesa = computed(() => identificado.value
    && !corte.value?.promesa_activa
    && corte.value?.estado !== 'activo'
    && !pendiente.value
    && promesa.value === null)

const { activo: servicioActivo, vigilando, agotado, sinRespuesta, vigilar, detener } = useEstadoServicio()
/** Tiene sentido esperar la reactivación: servicio identificado, no retirado, no activo y ya instalado. */
const puedeVigilar = computed(() => identificado.value
    && !retirado.value
    && !pendiente.value
    && corte.value?.estado !== 'activo')

/** Retorno de la pasarela: `/corte?pago=<id>&estado=<pagado|fallido>` (el estado lo pone el proveedor). */
const pagoId = ref(idPagoDeLaRuta(route.query.pago))
const estadoProveedor = ref(estadoRetornoDeLaRuta(route.query.estado))
const seguimiento = useSeguimientoPago()
const pago = computed(() => pagoId.value ? seguimiento.cobro.value : null)
/**
 * Ya no hay reactivación que esperar por este pago: rechazado o vencido en la API, o el proveedor
 * dijo `fallido` y la API no lo contradice (sigue pendiente hasta que llegue el webhook).
 */
const pagoCerrado = computed(() => pago.value?.estado === 'fallido'
    || pago.value?.estado === 'expirado'
    || (estadoProveedor.value === 'fallido' && pago.value?.estado !== 'pagado'))
/** Con un pago pendiente o confirmado no se ofrece pagar otra vez (evita cobros dobles). */
const pagoEnCamino = computed(() => pagoId.value !== null
    && seguimiento.problema.value === null
    && !pagoCerrado.value)

const reactivado = computed(() => (servicioActivo.value && corte.value?.estado !== 'activo')
    // Volvió de la pasarela con el servicio ya reactivado por el webhook.
    || (pago.value?.estado === 'pagado' && corte.value?.estado === 'activo'))

/** Toda acción del cliente que pueda reactivar el servicio termina llamando a esta función. */
function vigilarEstado() {
    if (pagoId.value !== null) {
        seguimiento.seguir(pagoId.value)
    }
    if (puedeVigilar.value && !pagoCerrado.value) {
        vigilar()
    }
}

// Rechazado o vencido: ya no hay reactivación que esperar por este pago.
watch(pagoCerrado, (cerrado) => {
    if (cerrado) {
        detener()
    }
})

// El webhook confirmó el pago (aunque el proveedor hubiera dicho `fallido`): se espera la reactivación.
watch(() => pago.value?.estado, (estado) => {
    if (estado === 'pagado') {
        vigilarEstado()
    }
})

// Al volver de la pasarela se sigue el pago en cuanto se identifica el servicio.
watch(() => corte.value, (actual) => {
    if (actual && pagoId.value !== null) {
        vigilarEstado()
    }
}, { immediate: true })

/** Estado en vivo: arriba de las acciones al volver de la pasarela (es lo que el cliente viene a ver). */
const enVivo = computed(() => ({
    vigilando: vigilando.value || seguimiento.siguiendo.value,
    agotado: agotado.value || seguimiento.agotado.value,
    pagoEnCurso: pagoId.value !== null,
    pago: pago.value,
    estadoProveedor: estadoProveedor.value,
    pagoNoEncontrado: seguimiento.problema.value !== null,
    sinRespuesta: sinRespuesta.value || seguimiento.sinRespuesta.value,
}))

function descartarPago() {
    pagoId.value = null
    estadoProveedor.value = null
    seguimiento.detener()
    const query = { ...route.query }
    delete query.pago
    delete query.estado
    void router.replace({ query })
}

function alCambiarVisibilidad() {
    if (document.visibilityState === 'visible') {
        vigilarEstado()
    }
}

// Con una promesa activa la reactivación ya va en camino: se vigila desde que carga.
watch(() => corte.value?.promesa_activa, (promesa) => {
    if (promesa) {
        vigilarEstado()
    }
}, { immediate: true })

onMounted(() => document.addEventListener('visibilitychange', alCambiarVisibilidad))
onBeforeUnmount(() => document.removeEventListener('visibilitychange', alCambiarVisibilidad))

/** Aprobada: el servicio ya se reactivó en la API; el estado en vivo lo confirma ("Ya tienes servicio"). */
function promesaResuelta(resultado: PromesaSolicitada) {
    if (resultado.resultado === 'rechazada') {
        return
    }
    promesa.value = resultado
    if (resultado.resultado === 'aprobada') {
        vigilarEstado()
    }
}

/** Llamar es lo que funciona con el servicio suspendido; si no hay teléfono, la página de contacto. */
const contacto = computed(() => {
    const telefono = enlacesContacto(empresa.value).find(enlace => enlace.tipo === 'telefono')
    return telefono
        ? { label: `Llamar a soporte: ${telefono.valor}`, icon: telefono.icon, to: telefono.to }
        : { label: 'Contacta a soporte', icon: 'i-lucide-headset', to: '/contacto' }
})

/**
 * "Ver datos de depósito" se oculta solo cuando la configuración se leyó y no hay ni cuentas ni
 * instrucciones (nada que mostrar). Si aún carga o falló, el modal muestra el estado o el error.
 */
const hayDatosDeposito = computed(() => !empresa.value
    || empresa.value.cuentas_deposito.length > 0
    || Boolean(empresa.value.instrucciones_pago))

/**
 * Condiciones de promesa por IP (`GET /portal/promesas/condiciones`): "Prometer pago" solo aparece si
 * la API dice que se puede ahora. Se leen una vez identificado el servicio y cuando cambia el caso.
 */
const { condiciones: leerCondiciones } = useSolicitudPromesa()
const promesaDisponible = ref<boolean | null>(null)
watch(puedePedirPromesa, async (puede) => {
    promesaDisponible.value = puede ? null : false
    if (puede) {
        const leido = await leerCondiciones()
        promesaDisponible.value = leido.ok ? promesaPermitida(leido.data) : false
    }
}, { immediate: true })

/**
 * Sesión del portal en este dispositivo (`useSesionPortal`): con ella, "Facturas" lleva directo a la
 * sección de `/cuenta`, se ofrece vincular Telegram y el layout muestra la barra del cliente.
 */
const sesion = useSesionPortal()
const telegram = useTelegram()
onMounted(async () => {
    if (await sesion.comprobar()) {
        await telegram.cargar()
    }
})

/** Sin pasarela (leída), "Ver datos de depósito" pasa a ser el botón principal de un servicio identificado. */
const depositoPrincipal = computed(() => identificado.value
    && !retirado.value
    && empresa.value !== null
    && !empresa.value.pago_en_linea
    && hayDatosDeposito.value)

/** Accesos rápidos de `/corte`: los que funcionan por IP ("Pagar en línea" es el botón principal). */
const accesos = computed(() => {
    if (!corte.value) {
        return []
    }
    const lista = accesosRapidos({
        modo: sesion.activa.value ? 'sesion' : 'ip',
        empresa: empresa.value,
        montoAdeudado: corte.value.monto_adeudado,
        retirado: retirado.value,
        pagoEnCamino: pagoEnCamino.value,
        promesaDisponible: puedePedirPromesa.value ? promesaDisponible.value : false,
        telegram: telegram.estado.value
            ? { disponible: telegram.estado.value.disponible, vinculado: telegram.estado.value.vinculado }
            : null,
        soporte: soporteDe(empresa.value),
        rutaTelegram: '/cuenta?seccion=cuenta#telegram',
    }).filter(acceso => acceso.id !== 'pagar' && !(acceso.id === 'deposito' && depositoPrincipal.value))
    // Sin identificar el servicio solo sirve lo que no depende de él: depósito y soporte.
    return identificado.value ? lista : lista.filter(acceso => acceso.id === 'deposito' || acceso.id === 'soporte')
})

function alAcceso(accion: NonNullable<AccesoRapido['accion']>) {
    if (accion === 'deposito') {
        verDeposito.value = true
    }
    else if (accion === 'comprobante') {
        verComprobante.value = true
    }
    else if (accion === 'promesa') {
        verPromesa.value = true
    }
}

/** "Actualizar" y jalar para actualizar: vuelve a identificar y revisa el estado en vivo. */
const actualizando = ref(false)
async function actualizar() {
    if (actualizando.value) {
        return
    }
    actualizando.value = true
    await refresh()
    actualizando.value = false
    vigilarEstado()
}
</script>

<template>
    <div class="flex flex-col gap-4">
        <PortalJalarParaActualizar
            :actualizando="actualizando"
            @actualizar="actualizar"
        />

        <template v-if="cargando">
            <USkeleton class="h-5 w-1/3" />
            <USkeleton class="h-8 w-2/3" />
            <USkeleton class="h-36 w-full" />
            <USkeleton class="h-12 w-full" />
            <USkeleton class="h-12 w-full" />
        </template>

        <template v-else-if="status === 'error' || !corte || !mensaje">
            <UAlert
                color="error"
                variant="subtle"
                icon="i-lucide-cloud-off"
                title="No pudimos consultar tu servicio"
                :description="mensajeProblema(problemaDeCorte(error))"
                :actions="[{ label: 'Reintentar', icon: 'i-lucide-refresh-cw', color: 'error', variant: 'outline', onClick: () => refresh() }]"
                role="alert"
                data-testid="corte-error"
            />
            <!-- Sin el estado no se muestran montos ni acciones del servicio, pero sí cómo pagar y a quién llamar. -->
            <UButton
                v-if="hayDatosDeposito"
                label="Ver datos de depósito"
                icon="i-lucide-landmark"
                color="neutral"
                variant="outline"
                size="xl"
                block
                @click="verDeposito = true"
            />
            <UButton
                data-testid="contacto-corte"
                :label="contacto.label"
                :icon="contacto.icon"
                :to="contacto.to"
                color="neutral"
                variant="ghost"
                size="lg"
                block
            />
        </template>

        <CorteServicioReactivado
            v-else-if="reactivado"
            :url="seguirNavegandoUrl"
            :promesa="promesa?.resultado === 'aprobada' ? promesa : null"
            :pago="pago?.estado === 'pagado' ? pago : null"
        />

        <template v-else>
            <div>
                <p
                    v-if="corte.nombre_parcial"
                    class="text-sm text-muted"
                >
                    Hola, {{ corte.nombre_parcial }}
                </p>
                <h1 class="mt-1 text-2xl font-semibold text-balance text-highlighted">
                    {{ mensaje.titulo }}
                </h1>
                <p class="mt-1 text-sm text-muted">
                    {{ mensaje.descripcion }}
                </p>
            </div>

            <CorteResumenDeuda
                v-if="identificado"
                :corte="corte"
            />

            <CorteEstadoEnVivo
                v-if="pagoId !== null"
                v-bind="enVivo"
                :instalacion-pendiente="pendiente"
                @revisar="vigilarEstado"
                @descartar-pago="descartarPago"
            />

            <UAlert
                v-if="comprobante"
                color="info"
                variant="subtle"
                icon="i-lucide-file-check"
                title="Recibimos tu comprobante, lo revisaremos"
                :description="`${formatearQuetzales(comprobante.monto)} · Ref. ${comprobante.referencia}. ${pendiente ? 'Al aprobarlo se abona a tus cargos.' : 'Al aprobarlo se reactiva tu servicio.'}`"
                data-testid="comprobante-recibido"
            />

            <UAlert
                v-if="promesa?.resultado === 'aprobada'"
                color="success"
                variant="subtle"
                icon="i-lucide-circle-check"
                title="Promesa de pago aprobada"
                :description="`Pagarás ${montoEnTexto(promesa.monto)} a más tardar el ${formatearFecha(promesa.vence_en)}. Estamos reactivando tu servicio.`"
                data-testid="promesa-aprobada"
            />
            <UAlert
                v-else-if="promesa?.resultado === 'pendiente_aprobacion'"
                color="warning"
                variant="subtle"
                icon="i-lucide-hourglass"
                title="Tu promesa está pendiente de aprobación"
                :description="promesa.motivo"
                data-testid="promesa-pendiente-corte"
            />

            <div
                v-if="!identificado"
                class="flex flex-col gap-2"
                data-testid="corte-no-identificado"
            >
                <UButton
                    label="Entrar con mi NIT o usuario"
                    icon="i-lucide-log-in"
                    size="xl"
                    to="/entrar"
                    block
                />
                <p class="-mt-1 text-center text-xs text-muted">
                    Para pagar en línea, subir un comprobante o pedir una promesa de pago necesitamos saber cuál es tu servicio.
                </p>
            </div>

            <template v-else-if="!retirado">
                <PagoEnLinea v-if="!pagoEnCamino" />
                <!-- Sin pasarela, el depósito es la acción principal (un botón, no una tarjeta más). -->
                <UButton
                    v-if="depositoPrincipal"
                    label="Ver datos de depósito"
                    icon="i-lucide-landmark"
                    size="xl"
                    block
                    data-testid="ver-deposito"
                    @click="verDeposito = true"
                />
            </template>

            <PortalAccesosRapidos
                :accesos="accesos"
                :testids="TESTIDS_CORTE"
                @accion="alAcceso"
            />

            <CorteEstadoEnVivo
                v-if="puedeVigilar && pagoId === null"
                v-bind="enVivo"
                @revisar="vigilarEstado"
            />

            <!-- Promociones del panel: siempre debajo de pagar y de pedir promesa, nunca encima ni en modal. -->
            <PromoPromociones
                v-if="identificado && !retirado"
                lugar="pagina_corte"
            />

            <UButton
                v-if="contacto.to !== '/contacto'"
                label="Más formas de contacto y horario"
                color="neutral"
                variant="link"
                size="sm"
                to="/contacto"
                class="self-center"
            />

            <p
                v-if="!identificado"
                class="text-center text-xs text-dimmed"
            >
                Conexión desde {{ corte.ip }}
            </p>
        </template>

        <CorteDatosDeposito v-model:open="verDeposito" />
        <PromesaSolicitar
            v-model:open="verPromesa"
            @resultado="promesaResuelta"
        />
        <ComprobanteSubir
            v-model:open="verComprobante"
            @enviado="comprobanteEnviado"
        />
    </div>
</template>
