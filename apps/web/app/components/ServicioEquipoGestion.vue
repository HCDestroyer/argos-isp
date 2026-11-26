<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'

/**
 * Ficha del servicio › Equipo (tableros PendEquipoServicio y PendEquipoServicioMovil): la cuenta y la
 * OLT de SmartOLT que usa el servicio, el Wi-Fi y el PPPoE por el ACS, qué pasaría al aprovisionar una
 * ONU nueva y el equipo en comodato. Los cuatro casos del tablero: todo bien, sin ACS, OLT sin ligar
 * (se busca la serie en las cuentas de la empresa) y SmartOLT sin respuesta (el ACS se sigue viendo).
 * La gestión sale de Argos (`/equipo/gestion`); el estado en vivo, de SmartOLT y el ACS (`/equipo`).
 */
const props = defineProps<{ servicioId: number }>()

const { puede } = usePermisos()

const gestion = shallowRef<GestionEquipo | null>(null)
const problema = ref<Problem | null>(null)
const cargando = ref(false)
const estado = shallowRef<EstadoEquipoVivo | null>(null)
const problemaEstado = ref<Problem | null>(null)
const leyendoEstado = ref(false)
const comodato = shallowRef<EquipoServicio[] | null>(null)

async function cargarEstado() {
    leyendoEstado.value = true
    const r = await useEquipoGestionado().estado(props.servicioId)
    leyendoEstado.value = false
    estado.value = r.ok ? r.data : null
    problemaEstado.value = r.ok ? null : r.problema
}

async function cargar() {
    cargando.value = true
    const r = await useEquipoGestionado().gestion(props.servicioId)
    cargando.value = false
    gestion.value = r.ok ? r.data : null
    problema.value = r.ok ? null : r.problema
    if (r.ok && (r.data.smartolt.disponible || r.data.acs.operativo)) {
        void cargarEstado()
    }
    if (puede('inventario.ver')) {
        const c = await useEquiposServicio().listar(props.servicioId)
        comodato.value = c.ok ? c.data.filter(e => e.estado === 'en_comodato' || e.estado === 'por_recuperar') : null
    }
}

const so = computed(() => gestion.value?.smartolt ?? null)
const acs = computed(() => gestion.value?.acs ?? null)
/** Sin OLT ligada y con varias cuentas: al aprovisionar se busca la serie en todas. */
const sinOlt = computed(() => so.value?.origen === 'sin_buscar')
/** SmartOLT no respondió: el equipo es de SmartOLT pero el estado vino solo del ACS (o no vino). */
const smartoltCaido = computed(() => Boolean(gestion.value?.equipo?.onu_external_id && so.value?.instancia
    && ((estado.value && estado.value.fuente === 'acs') || (problemaEstado.value && problemaEstado.value.status === 503))))
const notaOrigen = computed(() => ({
    olt: 'Se eligió por la OLT del servicio. Si cambias de OLT, la cuenta se escoge sola.',
    unica: 'Es la única cuenta de SmartOLT operativa de la empresa.',
    guardada: 'La ONU ya está registrada en esta cuenta.',
    sin_buscar: '',
    ninguna: '',
} as const)[so.value?.origen ?? 'ninguna'])
const oltTexto = computed(() => so.value?.olt_argos?.nombre ?? so.value?.olt_smartolt?.nombre ?? null)

onMounted(cargar)
</script>

<template>
    <div
        class="flex min-w-0 flex-col gap-3"
        data-prueba="servicio-equipo"
    >
        <ProblemaAlerta
            v-if="problema"
            :problema="problema"
            :reintentar="cargar"
            :reintentando="cargando"
        />
        <USkeleton
            v-else-if="!gestion || !so || !acs"
            class="h-64 w-full"
        />
        <div
            v-else
            class="grid items-start gap-3 lg:grid-cols-2"
        >
            <ConfiguracionBloque
                titulo="ONU en SmartOLT"
                icono="i-lucide-server"
                data-prueba="equipo-smartolt"
            >
                <template #accion>
                    <UButton
                        v-if="so.instancia"
                        label="Ver en SmartOLT"
                        :to="so.instancia.url"
                        target="_blank"
                        variant="link"
                        size="sm"
                        class="p-0"
                    />
                </template>
                <template v-if="so.origen === 'ninguna'">
                    <UAlert
                        color="warning"
                        variant="subtle"
                        icon="i-lucide-triangle-alert"
                        title="La empresa no tiene una cuenta de SmartOLT encendida y probada."
                        description="Sin ella, Argos no autoriza la ONU ni lee su estado."
                        data-prueba="equipo-sin-smartolt"
                    />
                    <UButton
                        v-if="puede('smartolt.ver')"
                        label="Ver las cuentas"
                        to="/configuracion/integraciones?ver=smartolt"
                        variant="link"
                        class="mt-2 self-start p-0"
                    />
                </template>
                <template v-else-if="sinOlt">
                    <UAlert
                        color="warning"
                        variant="subtle"
                        icon="i-lucide-triangle-alert"
                        data-prueba="equipo-olt-sin-ligar"
                    >
                        <template #description>
                            <b>Este servicio no tiene una OLT ligada a SmartOLT.</b> Al aprovisionar, Argos buscará la serie de la ONU en las <b>{{ so.cuentas.length }} cuentas</b> de la empresa ({{ so.cuentas.map(c => c.nombre).join(' y ') }}). Si aparece en las dos, se detiene y te pregunta.
                        </template>
                    </UAlert>
                    <div class="mt-2 flex flex-wrap gap-2">
                        <UButton
                            v-if="puede('smartolt.vincular_olt')"
                            label="Ligar la OLT en SmartOLT"
                            icon="i-lucide-link"
                            color="neutral"
                            variant="outline"
                            size="sm"
                            to="/configuracion/integraciones?ver=smartolt"
                        />
                        <UButton
                            v-if="puede('smartolt.ver')"
                            label="Ver las cuentas"
                            to="/configuracion/integraciones?ver=smartolt"
                            variant="link"
                            size="sm"
                        />
                    </div>
                </template>
                <template v-else>
                    <UAlert
                        v-if="smartoltCaido"
                        color="error"
                        variant="subtle"
                        icon="i-lucide-triangle-alert"
                        :actions="[{ label: 'Reintentar', icon: 'i-lucide-refresh-cw', color: 'neutral', variant: 'outline', loading: leyendoEstado, onClick: () => void cargarEstado() }]"
                        class="mb-1"
                        data-prueba="equipo-smartolt-caido"
                    >
                        <template #description>
                            <b>SmartOLT no respondió</b> (cuenta «{{ so.instancia?.nombre }}»). El estado de la ONU no se pudo leer ahora{{ estado ? '; el ACS sí respondió' : '' }}.
                        </template>
                    </UAlert>
                    <ConfiguracionFila etiqueta="Cuenta de SmartOLT">
                        <span class="flex items-center gap-2">
                            <b>{{ so.instancia?.nombre }}</b>
                            <UButton
                                v-if="so.instancia && puede('smartolt.ver')"
                                label="Abrir"
                                variant="link"
                                size="sm"
                                class="p-0"
                                :to="`/configuracion/integraciones/smartolt/${so.instancia.id}`"
                            />
                        </span>
                    </ConfiguracionFila>
                    <ConfiguracionFila etiqueta="OLT">
                        <span
                            v-if="oltTexto"
                            class="text-end"
                        ><b>{{ oltTexto }}</b>
                            <span
                                v-if="so.olt_smartolt"
                                class="text-xs text-muted"
                            > en Argos · en SmartOLT: <span class="font-mono">{{ so.olt_smartolt.nombre ?? so.olt_smartolt.smartolt_olt_id }}</span></span></span>
                        <span
                            v-else
                            class="text-sm text-muted"
                        >La que diga SmartOLT para la ONU</span>
                    </ConfiguracionFila>
                    <ConfiguracionFila
                        v-if="!smartoltCaido"
                        etiqueta="Puerto"
                        :valor="so.puerto_pon ? `PON ${so.puerto_pon}` : '—'"
                    />
                    <ConfiguracionFila
                        v-if="!smartoltCaido"
                        etiqueta="Identificador de la ONU"
                        :valor="gestion.equipo?.onu_external_id ?? '—'"
                        mono
                    />
                    <ConfiguracionFila etiqueta="Estado de la ONU">
                        <UBadge
                            v-if="smartoltCaido || !estado || estado.fuente !== 'smartolt'"
                            label="Sin dato ahora"
                            icon="i-lucide-clock"
                            color="neutral"
                            variant="subtle"
                            size="sm"
                            data-prueba="equipo-estado-onu"
                        />
                        <span
                            v-else
                            class="flex items-center gap-1.5"
                        >
                            <UBadge
                                :label="estado.en_linea ? 'En línea' : 'Fuera de línea'"
                                :icon="estado.en_linea ? 'i-lucide-check' : 'i-lucide-circle-x'"
                                :color="estado.en_linea ? 'success' : 'error'"
                                variant="subtle"
                                size="sm"
                                data-prueba="equipo-estado-onu"
                            />
                            <span
                                v-if="estado.senal?.rx_dbm !== undefined && estado.senal?.rx_dbm !== null"
                                class="text-xs text-muted"
                            >· señal {{ estado.senal.rx_dbm }} dBm</span>
                        </span>
                    </ConfiguracionFila>
                    <p
                        v-if="notaOrigen && !smartoltCaido"
                        class="flex items-center gap-1 pt-1 text-xs text-muted"
                    >
                        <UIcon
                            name="i-lucide-info"
                            class="size-3.5"
                        />{{ notaOrigen }}
                    </p>
                </template>
            </ConfiguracionBloque>

            <ConfiguracionBloque
                titulo="Wi-Fi y PPPoE por ACS"
                icono="i-lucide-wifi"
                data-prueba="equipo-acs"
            >
                <template v-if="acs.operativo">
                    <ConfiguracionFila etiqueta="Red Wi-Fi">
                        <b>{{ estado?.ssid ?? '—' }}</b>
                    </ConfiguracionFila>
                    <ConfiguracionFila
                        etiqueta="Clave del Wi-Fi"
                        valor="***"
                        mono
                    />
                    <ConfiguracionFila etiqueta="PPPoE por ACS">
                        <UBadge
                            :label="acs.pppoe_por_acs ? 'Encendido' : 'Apagado'"
                            :icon="acs.pppoe_por_acs ? 'i-lucide-check' : 'i-lucide-power'"
                            :color="acs.pppoe_por_acs ? 'success' : 'neutral'"
                            variant="subtle"
                            size="sm"
                        />
                    </ConfiguracionFila>
                    <ConfiguracionFila
                        etiqueta="Firmware"
                        :valor="estado?.firmware ?? '—'"
                    />
                    <ConfiguracionFila
                        etiqueta="Último contacto"
                        :valor="estado?.ultimo_contacto ? formatearFechaHora(estado.ultimo_contacto) : '—'"
                    />
                </template>
                <template v-else>
                    <UAlert
                        color="warning"
                        variant="subtle"
                        icon="i-lucide-triangle-alert"
                        data-prueba="equipo-sin-acs"
                    >
                        <template #description>
                            <b>{{ acs.configurado ? 'El ACS de la empresa está apagado o sin probar.' : 'Esta empresa no tiene ACS.' }}</b> Sin ACS no se configuran Wi-Fi ni PPPoE de la ONU.
                        </template>
                    </UAlert>
                    <p class="pt-2 text-sm text-muted">
                        La ONU sigue funcionando y SmartOLT la sigue autorizando y mostrando. Solo el Wi-Fi y el usuario PPPoE no se pueden cambiar desde Argos.
                    </p>
                    <div class="mt-2 flex flex-wrap items-center gap-2">
                        <UButton
                            label="Cambiar Wi-Fi"
                            icon="i-lucide-wifi"
                            color="neutral"
                            variant="outline"
                            size="sm"
                            disabled
                        />
                        <UButton
                            v-if="puede('acs.ver')"
                            label="Configurar el ACS"
                            to="/configuracion/integraciones?ver=acs"
                            variant="link"
                            size="sm"
                        />
                    </div>
                </template>
            </ConfiguracionBloque>

            <ConfiguracionBloque
                titulo="Si hay que aprovisionar una ONU nueva"
                icono="i-lucide-wrench"
                data-prueba="equipo-aprovisionar"
            >
                <ConfiguracionFila etiqueta="Cuenta">
                    <UBadge
                        v-if="sinOlt"
                        :label="`Se busca en ${so.cuentas.length} cuentas`"
                        icon="i-lucide-triangle-alert"
                        color="warning"
                        variant="subtle"
                        size="sm"
                    />
                    <b v-else>{{ so.instancia?.nombre ?? 'Ninguna' }}</b>
                </ConfiguracionFila>
                <ConfiguracionFila etiqueta="OLT">
                    <span
                        v-if="oltTexto"
                        class="text-sm"
                    >{{ oltTexto }}{{ so.puerto_pon ? ` · PON ${so.puerto_pon}` : '' }}</span>
                    <span
                        v-else
                        class="text-sm text-muted"
                    >La que tenga la serie de la ONU</span>
                </ConfiguracionFila>
                <ConfiguracionFila etiqueta="Perfil de autorización">
                    <span
                        v-if="so.perfil"
                        class="text-sm"
                    >Preset {{ so.perfil.authorization_preset_id }} · {{ so.perfil.pon_type.toUpperCase() }}</span>
                    <span
                        v-else
                        class="text-sm text-muted"
                    >El de esa OLT para el plan</span>
                </ConfiguracionFila>
                <ConfiguracionFila etiqueta="Wi-Fi inicial">
                    <UBadge
                        :label="acs.operativo ? 'Por el ACS' : 'No disponible sin ACS'"
                        :icon="acs.operativo ? 'i-lucide-check' : 'i-lucide-triangle-alert'"
                        :color="acs.operativo ? 'success' : 'warning'"
                        variant="subtle"
                        size="sm"
                    />
                </ConfiguracionFila>
            </ConfiguracionBloque>

            <ConfiguracionBloque
                v-if="puede('inventario.ver')"
                titulo="Equipo en comodato"
                icono="i-lucide-router"
                data-prueba="equipo-comodato"
            >
                <USkeleton
                    v-if="comodato === null"
                    class="h-10 w-full"
                />
                <p
                    v-else-if="!comodato.length"
                    class="text-sm text-muted"
                >
                    Sin equipo en comodato.
                </p>
                <template v-else>
                    <template
                        v-for="e in comodato"
                        :key="e.id"
                    >
                        <ConfiguracionFila
                            :etiqueta="e.producto_nombre"
                            :valor="e.serie ?? e.mac ?? '—'"
                            mono
                        />
                        <ConfiguracionFila etiqueta="Estado">
                            <UBadge
                                :label="e.estado === 'en_comodato' ? 'En comodato' : 'Por recuperar'"
                                :icon="e.estado === 'en_comodato' ? 'i-lucide-check' : 'i-lucide-triangle-alert'"
                                :color="e.estado === 'en_comodato' ? 'success' : 'warning'"
                                variant="subtle"
                                size="sm"
                            />
                        </ConfiguracionFila>
                    </template>
                </template>
            </ConfiguracionBloque>
        </div>
    </div>
</template>
