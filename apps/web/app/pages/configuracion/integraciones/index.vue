<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'

/**
 * Configuración → Integraciones (tablero OperConfigIntegraciones): a la izquierda, los sistemas
 * con los que Argos habla y su estado; a la derecha, el elegido (`?ver=`). Iris y Horus se
 * configuran en su pantalla; pasarela y FEL muestran su estado y llevan a su configuración;
 * SmartOLT y GenieACS se configuran aquí por empresa (`ConfiguracionEquipos`): credenciales
 * cifradas que no vuelven y «Probar conexión» de verdad. Cada lectura va por separado: si una falla, las
 * otras se ven igual.
 */
definePageMeta({ permiso: ['horus.ver', 'iris.ver', 'smartolt.ver', 'acs.ver'] })

useHead({ title: 'Integraciones · ArgosIsp' })

const conector = shallowRef<ConectorHorus | null>(null)
const cargando = ref(false)
const problema = ref<Problem | null>(null)

async function cargar() {
    cargando.value = true
    problema.value = null
    const resultado = await useHorus().conector()
    cargando.value = false
    conector.value = resultado.ok ? resultado.data : null
    problema.value = resultado.ok ? null : resultado.problema
    resumen.horus.value = conector.value
}

const { puede, enlace } = usePermisos()
const route = useRoute()
const verHorus = computed(() => puede('horus.ver'))
const verIris = computed(() => puede('iris.ver'))
const resumen = useIntegracionesConfiguracion()

/** La integración elegida: `?ver=`, o la primera permitida. */
const ver = computed(() => {
    const pedida = typeof route.query.ver === 'string' ? route.query.ver : null
    const ids = resumen.items.value.map(i => i.id)
    return pedida && ids.includes(pedida) ? pedida : ids[0] ?? null
})

const conectorIris = shallowRef<ConectorIris | null>(null)
const cargandoIris = ref(false)
const problemaIris = ref<Problem | null>(null)

async function cargarIris() {
    cargandoIris.value = true
    problemaIris.value = null
    const resultado = await useIris().conector()
    cargandoIris.value = false
    conectorIris.value = resultado.ok ? resultado.data : null
    problemaIris.value = resultado.ok ? null : resultado.problema
    resumen.iris.value = conectorIris.value
}

const presentacionIris = computed(() => (conectorIris.value ? presentacionConectorIris(conectorIris.value) : null))
/** Contrato Iris 0.6.3: canje pendiente o conector desconectado; sin `estado_canje`, nada. */
const avisoCanjeTarjeta = computed(() => (conectorIris.value ? avisoCanjeIris(conectorIris.value) : null))
const avisoReconexionTarjeta = computed(() => (conectorIris.value ? avisoReconexionIris(conectorIris.value) : null))
const textoDesconexionTarjeta = computed(() => (avisoCanjeTarjeta.value?.estado === 'desconectado' ? textoDesconexionIris(avisoCanjeTarjeta.value) : null))

watch(useEmpresaActiva().empresaId, () => {
    if (puede('smartolt.ver')) {
        void resumen.cargarEquipos()
    }
})

onMounted(() => {
    if (puede('smartolt.ver')) {
        void resumen.cargarEquipos()
    }
    if (puede('fel.ver')) {
        void resumen.cargarFel()
    }
    if (puede('bancos.ver')) {
        void resumen.cargarProveedores()
    }
    if (verHorus.value) {
        void cargar()
    }
    if (verIris.value) {
        void cargarIris()
    }
})
</script>

<template>
    <ConfiguracionMarco
        id="integraciones"
        titulo="Integraciones"
        descripcion="Los sistemas con los que Argos habla, con su estado y lo que se les permite"
        sin-tarjeta
    >
        <div class="grid min-w-0 gap-3.5 lg:min-h-0 lg:flex-1 xl:grid-cols-[22rem_minmax(0,1fr)]">
            <ConfiguracionIntegracionesLista
                :items="resumen.items.value"
                :activa="ver"
            />
            <section
                class="surface-card flex min-w-0 flex-col gap-4 rounded-2xl p-4 lg:min-h-0 lg:overflow-y-auto"
                data-prueba="detalle-integracion"
            >
                <ConfiguracionBloque
                    v-if="ver === 'iris'"
                    titulo="Iris"
                    descripcion="Tickets, órdenes de trabajo y seguimiento comercial: Iris lee clientes y servicios, activa instalaciones y recibe los avisos de ArgosIsp."
                    icono="i-lucide-message-square"
                    data-prueba="tarjeta-iris"
                >
                    <ProblemaAlerta
                        v-if="problemaIris"
                        :problema="problemaIris"
                        :reintentar="cargarIris"
                        :reintentando="cargandoIris"
                    />
                    <USkeleton
                        v-else-if="!presentacionIris"
                        class="h-6 w-28"
                    />
                    <div
                        v-else
                        class="flex flex-wrap items-center gap-2"
                    >
                        <UBadge
                            :label="presentacionIris.etiqueta"
                            :icon="presentacionIris.icono"
                            :color="presentacionIris.color"
                            variant="subtle"
                            data-prueba="estado-tarjeta-iris"
                        />
                        <UBadge
                            v-if="conectorIris?.requiere_reconectar"
                            :label="MARCA_RECONECTAR_IRIS.etiqueta"
                            :icon="MARCA_RECONECTAR_IRIS.icono"
                            :color="MARCA_RECONECTAR_IRIS.color"
                            variant="subtle"
                            data-prueba="marca-reconectar-tarjeta-iris"
                        />
                        <UBadge
                            v-if="avisoCanjeTarjeta?.estado === 'pendiente'"
                            :label="MARCA_CANJE_PENDIENTE_IRIS.etiqueta"
                            :icon="MARCA_CANJE_PENDIENTE_IRIS.icono"
                            :color="MARCA_CANJE_PENDIENTE_IRIS.color"
                            variant="subtle"
                            class="whitespace-normal"
                            data-prueba="marca-canje-pendiente-tarjeta-iris"
                        />
                        <UBadge
                            v-else-if="avisoCanjeTarjeta?.estado === 'desconectado'"
                            :label="MARCA_DESCONECTADO_IRIS.etiqueta"
                            :icon="MARCA_DESCONECTADO_IRIS.icono"
                            :color="MARCA_DESCONECTADO_IRIS.color"
                            variant="subtle"
                            data-prueba="marca-desconectado-tarjeta-iris"
                        />
                        <UBadge
                            v-if="avisoReconexionTarjeta"
                            :label="MARCA_RECONEXION_PENDIENTE_IRIS.etiqueta"
                            :icon="MARCA_RECONEXION_PENDIENTE_IRIS.icono"
                            :color="MARCA_RECONEXION_PENDIENTE_IRIS.color"
                            variant="subtle"
                            data-prueba="marca-reconexion-tarjeta-iris"
                        />
                    </div>
                    <p
                        v-if="avisoReconexionTarjeta"
                        class="text-sm text-muted"
                        data-prueba="reconexion-vence-tarjeta-iris"
                    >
                        {{ textoReconexionIris(avisoReconexionTarjeta) }}
                    </p>
                    <p
                        v-if="avisoCanjeTarjeta?.estado === 'pendiente' && avisoCanjeTarjeta.venceEn"
                        class="text-sm text-muted"
                        data-prueba="canje-vence-tarjeta-iris"
                    >
                        Vence el {{ formatearFechaHora(avisoCanjeTarjeta.venceEn) }}
                    </p>
                    <p
                        v-else-if="textoDesconexionTarjeta"
                        class="flex items-start gap-1.5 text-sm text-error"
                        data-prueba="motivo-desconexion-tarjeta-iris"
                    >
                        <UIcon
                            name="i-lucide-circle-x"
                            class="mt-0.5 size-4 shrink-0"
                        />
                        <span>{{ textoDesconexionTarjeta }}</span>
                    </p>
                    <UButton
                        to="/configuracion/integraciones/iris"
                        label="Abrir la configuración"
                        icon="i-lucide-settings-2"
                        color="primary"
                        variant="solid"
                        class="glow-brand self-start"
                        data-prueba="configurar-iris"
                    />
                </ConfiguracionBloque>
                <ConfiguracionBloque
                    v-if="ver === 'horus'"
                    titulo="Horus Flow"
                    descripcion="Consumo, salud y seguridad de cada servicio, avisos de Horus y autologin entre los dos sistemas."
                    icono="i-lucide-activity"
                    data-prueba="tarjeta-horus"
                >
                    <ProblemaAlerta
                        v-if="problema"
                        :problema="problema"
                        :reintentar="cargar"
                        :reintentando="cargando"
                    />
                    <USkeleton
                        v-else-if="!conector"
                        class="h-6 w-28"
                    />
                    <div v-else>
                        <UBadge
                            :label="conector.activo ? 'Activa' : (conector.version === 0 ? 'Sin conectar' : 'Apagada')"
                            :icon="conector.activo ? 'i-lucide-plug-zap' : 'i-lucide-power-off'"
                            :color="conector.activo ? 'success' : 'neutral'"
                            variant="subtle"
                            data-prueba="estado-tarjeta-horus"
                        />
                    </div>
                    <UButton
                        to="/configuracion/integraciones/horus"
                        label="Abrir la configuración"
                        icon="i-lucide-settings-2"
                        color="primary"
                        variant="solid"
                        class="glow-brand self-start"
                        data-prueba="configurar-horus"
                    />
                </ConfiguracionBloque>

                <ConfiguracionBloque
                    v-if="ver === 'pasarela'"
                    titulo="Pasarela de pago"
                    icono="i-lucide-credit-card"
                    descripcion="Cobro con tarjeta en el portal. La pasarela es un proveedor de cobro con su cuenta puente: entra el bruto y sale con la liquidación."
                    data-prueba="tarjeta-pasarela"
                >
                    <ProblemaAlerta
                        v-if="resumen.problemaProveedores.value"
                        :problema="resumen.problemaProveedores.value"
                        :reintentar="resumen.cargarProveedores"
                    />
                    <USkeleton
                        v-else-if="!resumen.pasarelas.value"
                        class="h-10 w-full"
                    />
                    <template v-else>
                        <ConfiguracionFila
                            v-for="proveedor in resumen.pasarelas.value"
                            :key="proveedor.id"
                            :etiqueta="proveedor.nombre"
                            :ayuda="`${proveedor.codigo} · cuenta puente ${proveedor.cuenta_codigo}`"
                        >
                            <UBadge
                                :label="proveedor.activo ? 'Activa' : 'Inactiva'"
                                :color="proveedor.activo ? 'success' : 'neutral'"
                                variant="subtle"
                                size="sm"
                            />
                        </ConfiguracionFila>
                        <p
                            v-if="!resumen.pasarelas.value.length"
                            class="text-sm text-muted"
                        >
                            Sin pasarela configurada: el portal no ofrece pago con tarjeta.
                        </p>
                    </template>
                    <UButton
                        label="Abrir proveedores de cobro"
                        icon="i-lucide-arrow-right"
                        trailing
                        color="neutral"
                        variant="outline"
                        class="self-start"
                        to="/configuracion/proveedores-cobro"
                    />
                </ConfiguracionBloque>

                <ConfiguracionBloque
                    v-if="ver === 'fel'"
                    titulo="Factura electrónica"
                    icono="i-lucide-shield-check"
                    descripcion="Certificador FEL de la empresa activa: credenciales cifradas, prueba de conexión y contingencia."
                    data-prueba="tarjeta-fel"
                >
                    <ProblemaAlerta
                        v-if="resumen.problemaFel.value"
                        :problema="resumen.problemaFel.value"
                        :reintentar="resumen.cargarFel"
                    />
                    <template v-else-if="resumen.fel.value">
                        <ConfiguracionFila etiqueta="Modo">
                            <UBadge
                                :label="MODOS_FEL[resumen.fel.value.modo].etiqueta"
                                :icon="MODOS_FEL[resumen.fel.value.modo].icono"
                                :color="MODOS_FEL[resumen.fel.value.modo].color"
                                variant="subtle"
                                size="sm"
                            />
                        </ConfiguracionFila>
                        <ConfiguracionFila
                            etiqueta="Ambiente"
                            :valor="AMBIENTES_FEL[resumen.fel.value.ambiente]"
                        />
                        <ConfiguracionFila
                            etiqueta="Credenciales"
                            :valor="resumen.fel.value.credenciales.length ? `${resumen.fel.value.credenciales.length} guardadas, cifradas` : 'Sin guardar'"
                        />
                    </template>
                    <USkeleton
                        v-else
                        class="h-10 w-full"
                    />
                    <UButton
                        label="Abrir la configuración FEL"
                        icon="i-lucide-arrow-right"
                        trailing
                        color="neutral"
                        variant="outline"
                        class="self-start"
                        to="/configuracion/fel"
                    />
                </ConfiguracionBloque>

                <ConfiguracionBloque
                    v-if="ver === 'smartolt' || ver === 'genieacs'"
                    :titulo="ver === 'smartolt' ? 'SmartOLT' : 'GenieACS'"
                    :icono="ver === 'smartolt' ? 'i-lucide-router' : 'i-lucide-cpu'"
                    :descripcion="ver === 'smartolt' ? 'Estado de las ONU y su señal en la ficha del servicio.' : 'Configuración remota de los equipos del cliente (TR-069): wifi, reinicio y firmware.'"
                    :data-prueba="`tarjeta-${ver}`"
                >
                    <ConfiguracionEquipos
                        :key="ver"
                        :sistema="ver"
                        @cambio="config => resumen.equipos.value = config"
                    />
                </ConfiguracionBloque>

                <ConfiguracionBloque
                    v-if="ver === 'mcp'"
                    titulo="Asistentes de IA (MCP)"
                    icono="i-lucide-bot"
                    descripcion="Un asistente de IA es un usuario con un token de alcance acotado: pasa por el mismo ACL y sus acciones quedan en la bitácora."
                    data-prueba="tarjeta-mcp"
                >
                    <UButton
                        label="Abrir tokens de API"
                        icon="i-lucide-arrow-right"
                        trailing
                        color="neutral"
                        variant="outline"
                        class="self-start"
                        :to="enlace('/usuarios/tokens')"
                    />
                </ConfiguracionBloque>
            </section>
        </div>
    </ConfiguracionMarco>
</template>
