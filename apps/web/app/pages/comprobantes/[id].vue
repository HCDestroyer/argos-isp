<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'

/**
 * Detalle de un comprobante: la foto o el PDF junto a sus datos, para compararlos con la banca en
 * línea. Aprobar registra el pago y reactiva (`Pago.servicios[]`); rechazar pide motivo.
 */
definePageMeta({ permiso: 'comprobantes.ver' })

const route = useRoute()
const { puede, enlace } = usePermisos()
const toast = useToast()

const comprobanteId = computed(() => Number(route.params.id))

const comprobante = shallowRef<Comprobante | null>(null)
const cargando = ref(true)
const problema = ref<Problem | null>(null)

const aprobarAbierto = ref(false)
const rechazarAbierto = ref(false)
/** Pago y servicios evaluados de la aprobación recién hecha (solo vienen en la respuesta). */
const pagoRegistrado = shallowRef<Pago | null>(null)

useHead(() => ({ title: `Comprobante #${route.params.id} · ArgosIsp` }))

const pendiente = computed(() => comprobante.value?.estado === 'pendiente')
const reactivados = computed(() => (pagoRegistrado.value?.servicios ?? []).filter(s => s.cambiado))
const sinReactivar = computed(() => (pagoRegistrado.value?.servicios ?? []).filter(s => !s.cambiado && s.estado !== 'activo'))

async function cargar() {
    cargando.value = true
    problema.value = null
    const resultado = await useComprobantes().ver(comprobanteId.value)
    cargando.value = false
    if (!resultado.ok) {
        comprobante.value = null
        problema.value = resultado.problema
        return
    }
    comprobante.value = resultado.data
}

function alAprobar(aprobado: Comprobante) {
    comprobante.value = aprobado
    pagoRegistrado.value = aprobado.pago ?? null
    const cuantos = reactivados.value.length
    toast.add({
        title: 'Comprobante aprobado',
        description: `Pago${aprobado.pago_id ? ` #${aprobado.pago_id}` : ''} de ${formatearQuetzales(aprobado.monto)} registrado${cuantos ? ` · ${cuantos === 1 ? 'servicio reactivado' : `${cuantos} servicios reactivados`}` : ''}`,
        icon: 'i-lucide-badge-check',
        color: 'success',
    })
}

/*
 * Reconexión temporal (contrato Iris 0.6.0 §7.3): la promesa `reconexion_temporal` activa ligada a
 * este comprobante. Rechazarlo la cancela y el servicio vuelve a cortarse a la hora de corte. Sin
 * `promesas.ver` no se puede saber: el aviso lo dice en vez de callarlo.
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
    // Por cliente: la reconexión puede ir a un servicio que el comprobante no trae (`servicio_id` del cuerpo).
    const resultado = await usePromesas().listar({ cliente_id: actual.cliente_id, tipo: 'reconexion_temporal', estado: 'activa', limit: 50 })
    cargandoReconexion.value = false
    if (!resultado.ok) {
        problemaReconexion.value = resultado.problema
        return
    }
    reconexion.value = resultado.data.data.find(p => p.comprobante_id === actual.id) ?? null
}

watch(comprobante, () => void cargarReconexion())

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
}

/**
 * «Ver conversación en Iris»: el autologin de Iris (`POST /integraciones/iris/abrir`) todavía no
 * acepta el destino `conversacion` (pedido B2 a Iris; A1 lo suma cuando Iris lo publique). Hasta
 * entonces el botón se ve deshabilitado y dice por qué.
 */
const MOTIVO_SIN_CONVERSACION = 'Iris todavía no permite abrir una conversación desde Argos (pedido B2). Búscala en Iris con este código.'

watch(comprobanteId, () => {
    pagoRegistrado.value = null
    void cargar()
})
onMounted(cargar)
</script>

<template>
    <PanelPagina
        id="comprobante"
        :titulo="`Comprobante #${route.params.id}`"
        icono="i-lucide-file-check-2"
    >
        <template #acciones>
            <UButton
                to="/comprobantes"
                icon="i-lucide-arrow-left"
                label="Comprobantes"
                color="neutral"
                variant="ghost"
                class="hidden sm:inline-flex"
            />
        </template>

        <div
            v-if="cargando && !comprobante"
            class="flex flex-col gap-4"
        >
            <USkeleton class="h-8 w-64" />
            <USkeleton class="h-64 w-full" />
        </div>

        <UEmpty
            v-else-if="problema?.status === 404"
            icon="i-lucide-file-x"
            title="Comprobante no encontrado"
            :description="`No existe un comprobante con id ${route.params.id}.`"
            :actions="[{ label: 'Volver a comprobantes', to: '/comprobantes', icon: 'i-lucide-arrow-left', color: 'neutral', variant: 'subtle' }]"
        />

        <ProblemaAlerta
            v-else-if="problema"
            :problema="problema"
            :reintentar="cargar"
            :reintentando="cargando"
        />

        <div
            v-else-if="comprobante"
            class="flex flex-col gap-6"
        >
            <div class="flex flex-wrap items-start justify-between gap-3">
                <div class="flex flex-col gap-1">
                    <div class="flex flex-wrap items-center gap-2">
                        <h2 class="text-xl font-semibold text-highlighted">
                            {{ formatearQuetzales(comprobante.monto) }}
                        </h2>
                        <UBadge
                            :label="ESTADOS_COMPROBANTE[comprobante.estado].etiqueta"
                            :icon="ESTADOS_COMPROBANTE[comprobante.estado].icono"
                            :color="ESTADOS_COMPROBANTE[comprobante.estado].color"
                            variant="subtle"
                            data-prueba="estado-comprobante"
                        />
                        <UBadge
                            v-if="llegoPorIris(comprobante)"
                            label="Llegó por Iris"
                            icon="i-lucide-messages-square"
                            color="info"
                            variant="subtle"
                            data-prueba="llego-por-iris"
                        />
                    </div>
                    <p class="text-sm text-muted">
                        {{ ETIQUETAS_METODO[comprobante.metodo] }} ·
                        <ULink
                            :to="enlace(`/clientes/${comprobante.cliente_id}?tab=cuenta`)"
                            class="text-default hover:text-primary"
                        >
                            {{ comprobante.cliente_nombre }}
                        </ULink>
                    </p>
                </div>
                <div
                    v-if="pendiente"
                    class="flex flex-wrap gap-2"
                >
                    <UBadge
                        v-if="cargandoReconexion"
                        label="Revisando reconexión…"
                        icon="i-lucide-loader"
                        color="neutral"
                        variant="subtle"
                        class="self-center"
                    />
                    <UButton
                        v-if="puede('comprobantes.rechazar')"
                        label="Rechazar"
                        icon="i-lucide-circle-x"
                        color="error"
                        variant="outline"
                        @click="rechazarAbierto = true"
                    />
                    <UButton
                        v-if="puede('comprobantes.aprobar')"
                        label="Aprobar"
                        icon="i-lucide-badge-check"
                        color="success"
                        @click="aprobarAbierto = true"
                    />
                </div>
            </div>

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
                v-if="pendiente && reconexion"
                color="warning"
                variant="subtle"
                icon="i-lucide-plug-zap"
                title="Reconexión temporal activa"
                :description="`Iris reconectó el servicio ${reconexion.servicio_id} mientras se revisa este comprobante, hasta el ${formatearFechaHora(reconexion.vence_en)}. Rechazarlo vuelve a cortar el servicio a la hora de corte.`"
                :actions="[{ label: 'Ver promesas', to: `/promesas?servicio=${reconexion.servicio_id}`, color: 'warning', variant: 'outline' }]"
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
                v-for="servicio in reactivados"
                :key="`r${servicio.servicio_id}`"
                color="success"
                variant="subtle"
                icon="i-lucide-wifi"
                :title="`Servicio ${servicio.servicio_id} reactivado`"
                :description="`${ESTADOS_SERVICIO[servicio.de].etiqueta} → ${ESTADOS_SERVICIO[servicio.estado].etiqueta} · ${servicio.motivo}`"
                :actions="puede('servicios.ver') ? [{ label: 'Ver servicio', to: `/servicios/${servicio.servicio_id}`, color: 'success', variant: 'outline' }] : undefined"
                data-prueba="servicio-reactivado"
            />

            <UAlert
                v-for="servicio in sinReactivar"
                :key="`s${servicio.servicio_id}`"
                color="warning"
                variant="subtle"
                :icon="ESTADOS_SERVICIO[servicio.estado].icono"
                :title="`Servicio ${servicio.servicio_id} sigue ${ESTADOS_SERVICIO[servicio.estado].etiqueta.toLowerCase()}`"
                :description="servicio.motivo"
            />

            <div class="grid items-start gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
                <UPageCard
                    title="Archivo"
                    icon="i-lucide-image"
                    variant="subtle"
                >
                    <ComprobanteArchivo :comprobante="comprobante" />
                </UPageCard>

                <UPageCard
                    title="Datos declarados"
                    description="Compáralos con el movimiento en la banca en línea antes de aprobar."
                    icon="i-lucide-landmark"
                    variant="subtle"
                >
                    <dl class="grid grid-cols-2 gap-x-6 gap-y-4">
                        <DatoFicha
                            etiqueta="Monto"
                            :valor="formatearQuetzales(comprobante.monto)"
                        />
                        <DatoFicha
                            etiqueta="Fecha del depósito"
                            :valor="formatearFecha(comprobante.fecha_deposito)"
                        />
                        <DatoFicha
                            etiqueta="Método"
                            :valor="ETIQUETAS_METODO[comprobante.metodo]"
                        />
                        <DatoFicha
                            :etiqueta="etiquetaReferencia(comprobante.metodo)"
                            :valor="comprobante.referencia"
                            mono
                        />
                        <DatoFicha
                            etiqueta="Cuenta de destino"
                            :valor="comprobante.cuenta_bancaria_nombre"
                            class="col-span-2"
                        />
                        <DatoFicha
                            v-if="comprobante.banco_origen_nombre"
                            etiqueta="Banco de origen"
                            :valor="comprobante.banco_origen_nombre"
                            class="col-span-2"
                        />
                        <DatoFicha
                            etiqueta="Cliente"
                            class="col-span-2"
                        >
                            <ULink
                                :to="enlace(`/clientes/${comprobante.cliente_id}?tab=cuenta`)"
                                class="text-highlighted hover:text-primary"
                            >
                                {{ comprobante.cliente_nombre }}
                            </ULink>
                        </DatoFicha>
                        <DatoFicha
                            v-if="comprobante.servicio_id"
                            etiqueta="Servicio"
                        >
                            <ULink
                                v-if="puede('servicios.ver')"
                                :to="`/servicios/${comprobante.servicio_id}`"
                                class="text-highlighted hover:text-primary"
                            >
                                Servicio #{{ comprobante.servicio_id }}
                            </ULink>
                            <template v-else>
                                Servicio #{{ comprobante.servicio_id }}
                            </template>
                        </DatoFicha>
                        <DatoFicha
                            etiqueta="Subido desde"
                            :valor="CANALES_COMPROBANTE[comprobante.canal]"
                        />
                        <DatoFicha
                            etiqueta="Recibido"
                            :valor="formatearFechaHora(comprobante.created_at)"
                        />
                        <DatoFicha
                            etiqueta="Nota del cliente"
                            :valor="comprobante.nota"
                            class="col-span-2"
                        />
                    </dl>
                </UPageCard>

                <UPageCard
                    v-if="llegoPorIris(comprobante)"
                    title="Lectura de Iris"
                    description="Lo que Iris leyó de la foto. Compáralo con el banco: Argos nunca lo aplica solo."
                    icon="i-lucide-messages-square"
                    variant="subtle"
                    class="lg:col-start-2"
                    data-prueba="lectura-iris"
                >
                    <dl class="grid grid-cols-2 gap-x-6 gap-y-4">
                        <DatoFicha
                            etiqueta="Leído por"
                            :valor="comprobante.leido_por ? LEIDO_POR[comprobante.leido_por] : null"
                        />
                        <DatoFicha
                            etiqueta="Confianza"
                            :valor="textoConfianza(comprobante.confianza)"
                        />
                        <DatoFicha
                            etiqueta="Llegó por"
                            :valor="comprobante.canal_contacto ? CANALES_CONTACTO[comprobante.canal_contacto].etiqueta : null"
                        />
                        <DatoFicha
                            etiqueta="Atendió"
                            :valor="textoActorIris(comprobante.iris_actor)"
                        />
                        <DatoFicha
                            etiqueta="Conversación"
                            :valor="comprobante.iris_conversacion ?? null"
                            mono
                            class="col-span-2"
                        />
                    </dl>
                    <div class="flex flex-col gap-1">
                        <UTooltip :text="MOTIVO_SIN_CONVERSACION">
                            <UButton
                                label="Ver conversación en Iris"
                                icon="i-lucide-external-link"
                                color="neutral"
                                variant="outline"
                                disabled
                                class="self-start"
                                data-prueba="ver-conversacion-iris"
                            />
                        </UTooltip>
                        <p class="text-xs text-muted">
                            {{ MOTIVO_SIN_CONVERSACION }}
                        </p>
                    </div>
                </UPageCard>
            </div>

            <ComprobanteAprobarModal
                v-model:open="aprobarAbierto"
                :comprobante="comprobante"
                @hecho="alAprobar"
                @revisado="cargar"
            />

            <ComprobanteRechazarModal
                v-model:open="rechazarAbierto"
                :comprobante="comprobante"
                :reconexion="reconexion"
                :reconexion-desconocida="reconexionDesconocida"
                @hecho="alRechazar"
                @revisado="cargar"
            />
        </div>
    </PanelPagina>
</template>
