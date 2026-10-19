<script setup lang="ts">
import Decimal from 'decimal.js'

/**
 * Portal con sesión: el "dashboard" del cliente, pensado para el teléfono.
 *
 * - Encabezado compacto con el total y el estado más urgente; "Actualizar" y jalar para actualizar.
 * - Secciones en la URL (`?seccion=inicio|pagar|facturas|puntos|sorteos|cuenta`, `utils/navegacion.ts`;
 *   «Puntos» solo con el programa visible en el portal; «Sorteos», desde el aviso del carrusel)
 *   con la barra inferior del layout en el teléfono y la barra superior en escritorio.
 * - Inicio: accesos rápidos (`utils/accesos.ts`: solo lo que la API aceptaría ahora) y los
 *   servicios, agrupados por la empresa que los factura (`utils/empresas.ts`). Con varias empresas,
 *   una sección por empresa con su logo; cada acceso (pago, depósito, comprobante, soporte) usa los
 *   datos de la empresa de ese grupo, nunca los de otra.
 *
 * Sin sesión (401) manda a `/entrar`. Si la cuenta no se puede leer, muestra el error con
 * "Reintentar" y ningún monto.
 */
const { nombre: nombreConfigurado } = useEmpresa({ de: 'cliente' })
const { data: resultado, status, refresh } = useCuenta()
const acceso = useAccesoPortal()
const route = useRoute()
const { condiciones: leerCondiciones } = useSolicitudPromesa()
const telegram = useTelegram()

const seccion = computed(() => seccionDeLaRuta(route.query.seccion))

// Solo la primera carga muestra el esqueleto; una recarga (p. ej. tras vincular Telegram) no lo hace.
const cargando = computed(() => !resultado.value && (status.value === 'idle' || status.value === 'pending'))
const cuenta = computed(() => resultado.value?.ok ? resultado.value.data : null)
const problema = computed(() => resultado.value && !resultado.value.ok ? resultado.value.problema : null)

useHead({
    // La empresa principal del cliente (la de la cuenta; mientras carga, la de la sesión).
    title: computed(() => `Mi cuenta · ${cuenta.value?.empresa_principal.nombre_comercial ?? nombreConfigurado.value}`),
    // El gesto de jalar es el nuestro (`PortalJalarParaActualizar`): sin el recargar nativo de Chrome.
    htmlAttrs: { class: 'overscroll-y-contain' },
    // "Agregar a pantalla de inicio" con el nombre de la empresa principal del cliente.
    link: computed(() => [{ rel: 'manifest', href: urlManifiesto(cuenta.value?.empresa_principal.id), key: 'manifest' }]),
})

watch(problema, (actual) => {
    if (actual && esSinSesion(actual)) {
        void navigateTo('/entrar')
    }
}, { immediate: true })

function contactoActualizado(contacto: ContactoPortal) {
    if (resultado.value?.ok) {
        resultado.value = { ok: true, data: { ...resultado.value.data, cliente: contacto } }
    }
}

/** Servicios a los que tiene sentido preguntarles por una promesa: con saldo, sin promesa y no retirados. */
function admitePromesa(servicio: { estado: string, promesa_activa: boolean, monto_adeudado: string }) {
    return servicio.estado !== 'retirado' && !servicio.promesa_activa && new Decimal(servicio.monto_adeudado).greaterThan(0)
}

/**
 * Condiciones de promesa de cada servicio (`GET /portal/promesas/condiciones?servicio_id=`): el
 * acceso "Prometer pago" y "Pedir promesa" solo aparecen si la API dice que se puede ahora.
 */
const promesaPorServicio = ref<Record<number, boolean | null>>({})
async function cargarCondiciones() {
    const servicios = cuenta.value?.servicios ?? []
    const estado: Record<number, boolean | null> = {}
    for (const servicio of servicios) {
        estado[servicio.id] = admitePromesa(servicio) ? null : false
    }
    promesaPorServicio.value = estado
    await Promise.all(servicios.filter(admitePromesa).map(async (servicio) => {
        const leido = await leerCondiciones(servicio.id)
        promesaPorServicio.value = {
            ...promesaPorServicio.value,
            [servicio.id]: leido.ok ? promesaPermitida(leido.data) : false,
        }
    }))
}
watch(cuenta, (actual, anterior) => {
    if (actual && actual !== anterior) {
        void cargarCondiciones()
    }
}, { immediate: true })

onMounted(() => {
    void telegram.cargar()
})

/** Servicio al que se asocia un comprobante: el primero con saldo (o el primero) de la lista dada. */
function servicioParaComprobante(servicios: readonly { id: number, monto_adeudado: string }[]) {
    return (servicios.find(s => new Decimal(s.monto_adeudado).greaterThan(0)) ?? servicios[0])?.id
}

/**
 * Pagar en línea cobra lo de UN servicio (`POST /portal/pagos/iniciar` con `servicio_id`). Con
 * varios servicios con saldo, el cliente elige cuál; si no, el total de arriba no coincidiría con
 * lo que se cobra.
 */
const serviciosConSaldo = computed(() => (cuenta.value?.servicios ?? [])
    .filter(s => new Decimal(s.monto_adeudado).greaterThan(0)))
const opcionesPago = computed(() => serviciosConSaldo.value.map(s => ({
    // Con varias empresas, cada servicio dice a quién se le paga.
    label: `${variasEmpresas.value ? `${s.empresa.nombre_comercial} · ` : ''}${s.plan ?? 'Servicio de internet'}${s.direccion ? ` · ${s.direccion}` : ''} · ${formatearQuetzales(s.monto_adeudado)}`,
    value: s.id,
})))
const servicioElegido = ref<number | undefined>(undefined)
const servicioPago = computed(() => serviciosConSaldo.value.some(s => s.id === servicioElegido.value)
    ? servicioElegido.value
    : serviciosConSaldo.value[0]?.id)

/** Grupos por empresa (la principal primero); cada uno calcula sus accesos con su empresa. */
const grupos = computed(() => agruparPorEmpresa(
    cuenta.value?.servicios ?? [],
    cuenta.value?.empresa_principal.id ?? null,
    cuenta.value?.empresas ?? [],
))
const variasEmpresas = computed(() => grupos.value.length > 1)
/**
 * Telegram por empresa ("Varios bots"): un bot solo le escribe a quien lo inició, así que con
 * servicios en varias empresas cada una tiene su tarjeta y su acceso "Vincular Telegram". Con una
 * sola, la tarjeta de siempre (en el primer grupo).
 */
const telegramPorEmpresa = computed(() => {
    const empresas = telegram.estado.value?.empresas ?? []
    return empresas.length > 1 ? empresas : null
})
function telegramDelGrupo(grupo: GrupoEmpresa, indice: number) {
    const estado = telegram.estado.value
    if (!estado) {
        return null
    }
    if (telegramPorEmpresa.value) {
        const propio = telegramPorEmpresa.value.find(t => t.empresa.id === grupo.empresa.id)
        return propio ? { disponible: propio.disponible, vinculado: propio.vinculado } : null
    }
    return indice === 0 ? { disponible: estado.disponible, vinculado: estado.vinculado } : null
}
function rutaTelegramDelGrupo(grupo: GrupoEmpresa) {
    return telegramPorEmpresa.value
        ? `/cuenta?seccion=cuenta#telegram-${grupo.empresa.id}`
        : '/cuenta?seccion=cuenta#telegram'
}

/** Empresa del servicio que se paga en línea en "Pagar" (sus cuentas, su pasarela). */
const grupoPago = computed(() => grupoDeServicio(grupos.value, servicioPago.value) ?? grupos.value[0] ?? null)
const { empresa: empresaPago } = useEmpresa({ empresaId: () => grupoPago.value?.empresa.id })

/** Empresa (y servicio) de los modales de depósito y comprobante: los del grupo que los abrió. */
const empresaModal = ref<number | undefined>(undefined)
const servicioComprobante = ref<number | undefined>(undefined)
watch(grupoPago, (grupo) => {
    if (empresaModal.value === undefined && grupo) {
        empresaModal.value = grupo.empresa.id
        servicioComprobante.value = servicioParaComprobante(grupo.servicios)
    }
}, { immediate: true })
function usarGrupo(grupo: GrupoEmpresa | null) {
    if (grupo) {
        empresaModal.value = grupo.empresa.id
        servicioComprobante.value = servicioParaComprobante(grupo.servicios)
    }
}
const estadoGeneral = computed(() => estadoMasUrgente(cuenta.value?.servicios ?? []))

const verPromesa = ref(false)
const verComprobante = ref(false)
const verDeposito = ref(false)
const servicioPromesa = ref<number | undefined>(undefined)
const promesa = ref<PromesaSolicitada | null>(null)

function pedirPromesa(servicioId: number) {
    servicioPromesa.value = servicioId
    verPromesa.value = true
}

function alAcceso(grupo: GrupoEmpresa, accion: NonNullable<AccesoRapido['accion']>) {
    usarGrupo(grupo)
    if (accion === 'pagar') {
        // Pagar lo de esta empresa: su primer servicio con saldo queda elegido.
        const servicio = grupo.servicios.find(s => new Decimal(s.monto_adeudado).greaterThan(0))
        if (servicio) {
            servicioElegido.value = servicio.id
        }
        void navigateTo('/cuenta?seccion=pagar')
    }
    else if (accion === 'comprobante') {
        verComprobante.value = true
    }
    else if (accion === 'deposito') {
        verDeposito.value = true
    }
    else {
        const servicio = grupo.servicios.find(s => promesaPorServicio.value[s.id] === true)
        if (servicio) {
            pedirPromesa(servicio.id)
        }
    }
}

/** Aprobada o pendiente: se recarga la cuenta (estado del servicio y promesa activa). */
async function promesaResuelta(resuelta: PromesaSolicitada) {
    if (resuelta.resultado === 'rechazada') {
        return
    }
    promesa.value = resuelta
    await refresh()
}

/** "Actualizar" y jalar para actualizar: la cuenta, Telegram y las listas de la sección (se remontan). */
const actualizando = ref(false)
const recargas = ref(0)
async function actualizar() {
    if (actualizando.value) {
        return
    }
    actualizando.value = true
    recargas.value += 1
    await Promise.all([refresh(), telegram.cargar()])
    actualizando.value = false
}

const saliendo = ref(false)
async function salir() {
    saliendo.value = true
    await acceso.salir()
    saliendo.value = false
    await navigateTo('/')
}

// Al llegar a "Cuenta" desde "Vincular Telegram", la tarjeta de Telegram queda a la vista.
watch(() => route.hash, async (hash) => {
    if (/^#telegram(-\d+)?$/.test(hash)) {
        await nextTick()
        document.getElementById(hash.slice(1))?.scrollIntoView({ block: 'start' })
    }
})
</script>

<template>
    <div
        class="flex flex-col gap-4"
        data-testid="cuenta"
    >
        <template v-if="cargando">
            <USkeleton class="h-20 w-full" />
            <div class="grid grid-cols-2 gap-2">
                <USkeleton class="h-28" />
                <USkeleton class="h-28" />
                <USkeleton class="h-28" />
                <USkeleton class="h-28" />
            </div>
        </template>

        <UAlert
            v-else-if="problema && !esSinSesion(problema)"
            color="error"
            variant="subtle"
            icon="i-lucide-cloud-off"
            title="No pudimos cargar tu cuenta"
            :description="mensajeProblema(problema)"
            :actions="[{ label: 'Reintentar', icon: 'i-lucide-refresh-cw', color: 'error', variant: 'outline', onClick: () => refresh() }]"
        />

        <template v-else-if="cuenta">
            <PortalJalarParaActualizar
                :actualizando="actualizando"
                @actualizar="actualizar"
            />

            <h1 class="sr-only">
                Mi cuenta
            </h1>

            <CuentaResumen
                :nombre="cuenta.cliente.nombre"
                :monto-adeudado="cuenta.monto_adeudado"
                :estado="estadoGeneral"
                :actualizando="actualizando"
                @actualizar="actualizar"
            />

            <UAlert
                v-if="promesa?.resultado === 'aprobada'"
                color="success"
                variant="subtle"
                icon="i-lucide-circle-check"
                :title="promesa.servicio_estado === 'activo' ? 'Ya tienes servicio' : 'Promesa de pago aprobada'"
                :description="promesa.servicio_estado === 'activo'
                    ? `Tu promesa fue aprobada: pagarás ${montoEnTexto(promesa.monto)} a más tardar el ${formatearFecha(promesa.vence_en)}.`
                    : `Pagarás ${montoEnTexto(promesa.monto)} a más tardar el ${formatearFecha(promesa.vence_en)}. Si tu servicio no vuelve en unos minutos, comunícate con soporte.`"
                data-testid="promesa-aprobada"
            />
            <UAlert
                v-else-if="promesa?.resultado === 'pendiente_aprobacion'"
                color="warning"
                variant="subtle"
                icon="i-lucide-hourglass"
                title="Tu promesa está pendiente de aprobación"
                :description="promesa.motivo"
                data-testid="promesa-pendiente-cuenta"
            />

            <Transition
                name="seccion"
                mode="out-in"
            >
                <div
                    v-if="seccion === 'inicio'"
                    key="inicio"
                    class="flex flex-col gap-6"
                    data-testid="seccion-inicio"
                >
                    <UAlert
                        v-if="estadoGeneral === 'suspendido' || estadoGeneral === 'limitado'"
                        :color="ESTADOS_SERVICIO[estadoGeneral].color"
                        variant="subtle"
                        :icon="ESTADOS_SERVICIO[estadoGeneral].icono"
                        :title="estadoGeneral === 'suspendido' ? 'Tu servicio está suspendido' : 'Tu servicio está limitado'"
                        description="Paga, sube tu comprobante o pide una promesa para reactivarlo."
                        :actions="[{ label: 'Cómo reactivar mi servicio', icon: 'i-lucide-wifi', color: 'neutral', variant: 'outline', to: '/corte' }]"
                        data-testid="aviso-reactivar"
                    />
                    <CuentaInicioEmpresa
                        v-for="(grupo, indice) in grupos"
                        :key="grupo.clave"
                        :grupo="grupo"
                        :mostrar-marca="variasEmpresas"
                        :telegram="telegramDelGrupo(grupo, indice)"
                        :ruta-telegram="rutaTelegramDelGrupo(grupo)"
                        :promesa-por-servicio="promesaPorServicio"
                        @accion="alAcceso(grupo, $event)"
                        @pedir-promesa="pedirPromesa"
                    />
                    <PuntosResumen />
                    <PromoPromociones lugar="portal_inicio" />
                </div>

                <div
                    v-else-if="seccion === 'pagar'"
                    key="pagar"
                    class="flex flex-col gap-6"
                    data-testid="seccion-pagar"
                >
                    <section
                        class="flex flex-col gap-3"
                        aria-labelledby="titulo-pagar"
                    >
                        <h2
                            id="titulo-pagar"
                            class="text-lg font-semibold text-highlighted"
                        >
                            Pagar
                        </h2>
                        <UCard v-if="servicioPago !== undefined">
                            <div class="flex flex-col gap-3">
                                <UFormField
                                    v-if="opcionesPago.length > 1"
                                    label="¿Qué servicio quieres pagar en línea?"
                                >
                                    <USelect
                                        :model-value="servicioPago"
                                        :items="opcionesPago"
                                        class="w-full"
                                        data-testid="servicio-a-pagar"
                                        @update:model-value="servicioElegido = Number($event)"
                                    />
                                </UFormField>
                                <PagoEnLinea
                                    :servicio-id="servicioPago"
                                    :empresa-id="grupoPago?.empresa.id"
                                    id-ayuda="pagar-en-linea-ayuda-cuenta"
                                />
                            </div>
                        </UCard>
                        <p
                            v-else
                            class="text-sm text-muted"
                            data-testid="sin-saldo"
                        >
                            No tienes saldo pendiente.
                        </p>
                        <UButton
                            v-if="empresaPago && (empresaPago.cuentas_deposito.length > 0 || empresaPago.instrucciones_pago)"
                            :label="variasEmpresas && grupoPago ? `Datos de depósito de ${grupoPago.empresa.nombre_comercial}` : 'Ver datos de depósito'"
                            icon="i-lucide-landmark"
                            color="neutral"
                            variant="outline"
                            size="lg"
                            block
                            data-testid="deposito-pagar"
                            @click="usarGrupo(grupoPago); verDeposito = true"
                        />
                    </section>

                    <CuentaComprobantes
                        :key="`comprobantes-${recargas}`"
                        :servicio-id="servicioParaComprobante(grupoPago?.servicios ?? [])"
                        :empresa-id="grupoPago?.empresa.id"
                    />
                    <section
                        class="flex flex-col gap-3"
                        aria-labelledby="titulo-pagos"
                    >
                        <h2
                            id="titulo-pagos"
                            class="text-sm font-semibold text-highlighted"
                        >
                            Pagos registrados
                        </h2>
                        <CuentaPagos :key="`pagos-${recargas}`" />
                    </section>
                    <section
                        class="flex flex-col gap-3"
                        aria-labelledby="titulo-promesas"
                    >
                        <h2
                            id="titulo-promesas"
                            class="text-sm font-semibold text-highlighted"
                        >
                            Promesas de pago
                        </h2>
                        <CuentaPromesas :key="`promesas-${recargas}`" />
                    </section>
                </div>

                <div
                    v-else-if="seccion === 'facturas'"
                    key="facturas"
                    class="flex flex-col gap-6"
                    data-testid="seccion-facturas"
                >
                    <section
                        class="flex flex-col gap-3"
                        aria-labelledby="titulo-facturas"
                    >
                        <h2
                            id="titulo-facturas"
                            class="text-lg font-semibold text-highlighted"
                        >
                            Facturas
                        </h2>
                        <CuentaFacturas :key="`facturas-${recargas}`" />
                    </section>
                    <section
                        class="flex flex-col gap-3"
                        aria-labelledby="titulo-notas-credito"
                        data-testid="seccion-notas-credito"
                    >
                        <h2
                            id="titulo-notas-credito"
                            class="text-sm font-semibold text-highlighted"
                        >
                            Notas de crédito
                        </h2>
                        <CuentaNotasCredito :key="`notas-${recargas}`" />
                    </section>
                </div>

                <SorteoSeccion
                    v-else-if="seccion === 'sorteos'"
                    :key="`sorteos-${recargas}`"
                />

                <PuntosSeccion
                    v-else-if="seccion === 'puntos'"
                    :key="`puntos-${recargas}`"
                    :servicios="cuenta.servicios"
                />

                <div
                    v-else
                    key="cuenta"
                    class="flex flex-col gap-4"
                    data-testid="seccion-cuenta"
                >
                    <h2 class="text-lg font-semibold text-highlighted">
                        Mi cuenta
                    </h2>
                    <template v-if="telegramPorEmpresa">
                        <CuentaTelegram
                            v-for="propio in telegramPorEmpresa"
                            :id="`telegram-${propio.empresa.id}`"
                            :key="propio.empresa.id"
                            :vinculado="propio.vinculado"
                            :empresa="propio.empresa"
                            @cambio="refresh(); telegram.cargar()"
                        />
                    </template>
                    <CuentaTelegram
                        v-else
                        id="telegram"
                        :vinculado="cuenta.cliente.telegram_vinculado"
                        @cambio="refresh(); telegram.cargar()"
                    />
                    <CuentaContacto
                        :contacto="cuenta.cliente"
                        @actualizado="contactoActualizado"
                    />
                    <UButton
                        label="Ayuda y contacto"
                        icon="i-lucide-headset"
                        color="neutral"
                        variant="outline"
                        size="lg"
                        to="/contacto"
                        block
                    />
                    <UButton
                        label="Salir"
                        icon="i-lucide-log-out"
                        color="neutral"
                        variant="ghost"
                        size="lg"
                        block
                        :loading="saliendo"
                        data-testid="salir"
                        @click="salir"
                    />
                </div>
            </Transition>
        </template>

        <PromesaSolicitar
            v-model:open="verPromesa"
            :servicio-id="servicioPromesa"
            @resultado="promesaResuelta"
        />
        <ComprobanteSubir
            v-model:open="verComprobante"
            :servicio-id="servicioComprobante"
            :empresa-id="empresaModal"
            @enviado="recargas += 1"
        />
        <CorteDatosDeposito
            v-model:open="verDeposito"
            :empresa-id="empresaModal"
        />
    </div>
</template>
