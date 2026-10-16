<script setup lang="ts">
import type { TabsItem } from '@nuxt/ui'
import Decimal from 'decimal.js'

/**
 * Portal autenticado: saldo y servicios arriba; facturas, pagos (con los comprobantes de depósito
 * enviados), promesas y datos en pestañas.
 * Sin sesión (401) manda a `/entrar`. Si la cuenta no se puede leer, muestra el error con
 * "Reintentar" y ningún monto.
 */
const { nombre: nombreEmpresa } = useEmpresa()
const { data: resultado, status, refresh } = useCuenta()
const acceso = useAccesoPortal()

useHead({ title: computed(() => `Mi cuenta · ${nombreEmpresa.value}`) })

// Solo la primera carga muestra el esqueleto; una recarga (p. ej. tras vincular Telegram) no lo hace.
const cargando = computed(() => !resultado.value && (status.value === 'idle' || status.value === 'pending'))
const cuenta = computed(() => resultado.value?.ok ? resultado.value.data : null)
const problema = computed(() => resultado.value && !resultado.value.ok ? resultado.value.problema : null)

watch(problema, (actual) => {
    if (actual && esSinSesion(actual)) {
        void navigateTo('/entrar')
    }
}, { immediate: true })

const pestanas: TabsItem[] = [
    { label: 'Facturas', icon: 'i-lucide-receipt', value: 'facturas', slot: 'facturas' as const },
    { label: 'Pagos', icon: 'i-lucide-wallet', value: 'pagos', slot: 'pagos' as const },
    { label: 'Promesas', icon: 'i-lucide-hand-coins', value: 'promesas', slot: 'promesas' as const },
    { label: 'Mis datos', icon: 'i-lucide-user-round', value: 'datos', slot: 'datos' as const },
]
const pestana = ref('facturas')

function contactoActualizado(contacto: ContactoPortal) {
    if (resultado.value?.ok) {
        resultado.value = { ok: true, data: { ...resultado.value.data, cliente: contacto } }
    }
}

/** Servicios a los que se les puede pedir promesa: con saldo, sin promesa activa y no retirados. */
function admitePromesa(servicio: { estado: string, promesa_activa: boolean, monto_adeudado: string }) {
    return servicio.estado !== 'retirado' && !servicio.promesa_activa && new Decimal(servicio.monto_adeudado).greaterThan(0)
}

/** Servicio al que se asocia un comprobante: el primero con saldo (o el primero). Solo informativo para A3. */
const servicioComprobante = computed(() => {
    const servicios = cuenta.value?.servicios ?? []
    return (servicios.find(s => new Decimal(s.monto_adeudado).greaterThan(0)) ?? servicios[0])?.id
})

/**
 * Pagar en línea cobra lo de UN servicio (`POST /portal/pagos/iniciar` con `servicio_id`). Con
 * varios servicios con saldo, el cliente elige cuál; si no, el total de arriba no coincidiría con
 * lo que se cobra.
 */
const serviciosConSaldo = computed(() => (cuenta.value?.servicios ?? [])
    .filter(s => new Decimal(s.monto_adeudado).greaterThan(0)))
const opcionesPago = computed(() => serviciosConSaldo.value.map(s => ({
    label: `${s.plan ?? 'Servicio de internet'}${s.direccion ? ` · ${s.direccion}` : ''} · ${formatearQuetzales(s.monto_adeudado)}`,
    value: s.id,
})))
const servicioElegido = ref<number | undefined>(undefined)
const servicioPago = computed(() => serviciosConSaldo.value.some(s => s.id === servicioElegido.value)
    ? servicioElegido.value
    : serviciosConSaldo.value[0]?.id)

const verPromesa = ref(false)
const servicioPromesa = ref<number | undefined>(undefined)
const promesa = ref<PromesaSolicitada | null>(null)

function pedirPromesa(servicioId: number) {
    servicioPromesa.value = servicioId
    verPromesa.value = true
}

/** Aprobada o pendiente: se recarga la cuenta (estado del servicio y promesa activa). */
async function promesaResuelta(resultado: PromesaSolicitada) {
    if (resultado.resultado === 'rechazada') {
        return
    }
    promesa.value = resultado
    await refresh()
}

const saliendo = ref(false)
async function salir() {
    saliendo.value = true
    await acceso.salir()
    saliendo.value = false
    await navigateTo('/')
}
</script>

<template>
    <div class="flex flex-col gap-4">
        <template v-if="cargando">
            <USkeleton class="h-6 w-1/2" />
            <USkeleton class="h-28 w-full" />
            <USkeleton class="h-10 w-full" />
            <USkeleton class="h-40 w-full" />
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
            <div class="flex items-start justify-between gap-3">
                <div class="min-w-0">
                    <p class="text-sm text-muted">
                        Hola,
                    </p>
                    <h1 class="text-2xl font-semibold text-balance break-words text-highlighted">
                        {{ cuenta.cliente.nombre }}
                    </h1>
                </div>
                <UButton
                    label="Salir"
                    icon="i-lucide-log-out"
                    color="neutral"
                    variant="ghost"
                    :loading="saliendo"
                    @click="salir"
                />
            </div>

            <UCard>
                <p class="text-sm text-muted">
                    Total pendiente
                </p>
                <p
                    class="text-3xl font-semibold tabular-nums text-highlighted"
                    data-testid="saldo-cuenta"
                >
                    {{ formatearQuetzales(cuenta.monto_adeudado) }}
                </p>
                <div
                    v-for="servicio in cuenta.servicios"
                    :key="servicio.id"
                    class="mt-3 flex items-center justify-between gap-3 border-t border-default pt-3"
                    data-testid="servicio-cuenta"
                >
                    <div class="min-w-0">
                        <p class="truncate text-sm font-medium text-default">
                            {{ servicio.plan ?? 'Servicio de internet' }}
                        </p>
                        <p
                            v-if="servicio.direccion"
                            class="truncate text-xs text-muted"
                        >
                            {{ servicio.direccion }}
                        </p>
                    </div>
                    <div class="flex shrink-0 flex-col items-end gap-1">
                        <EstadoServicioBadge
                            :estado="servicio.estado"
                            size="sm"
                        />
                        <span
                            v-if="cuenta.servicios.length > 1"
                            class="text-sm font-medium tabular-nums text-highlighted"
                            data-testid="saldo-servicio"
                        >
                            {{ formatearQuetzales(servicio.monto_adeudado) }}
                        </span>
                        <UButton
                            v-if="admitePromesa(servicio)"
                            label="Pedir promesa"
                            icon="i-lucide-hand-coins"
                            color="neutral"
                            variant="link"
                            size="sm"
                            class="px-0"
                            data-testid="pedir-promesa"
                            @click="pedirPromesa(servicio.id)"
                        />
                    </div>
                </div>
                <UFormField
                    v-if="opcionesPago.length > 1"
                    label="¿Qué servicio quieres pagar en línea?"
                    class="mt-3"
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
                    v-if="servicioPago !== undefined"
                    :servicio-id="servicioPago"
                    id-ayuda="pagar-en-linea-ayuda-cuenta"
                    class="mt-3"
                />
                <UButton
                    v-if="cuenta.servicios.some(s => s.estado === 'suspendido' || s.estado === 'limitado')"
                    label="Cómo reactivar mi servicio"
                    icon="i-lucide-wifi"
                    to="/corte"
                    class="mt-3"
                    block
                />
            </UCard>

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

            <UTabs
                v-model="pestana"
                :items="pestanas"
                variant="link"
                :ui="{
                    list: 'w-full',
                    trigger: 'flex-1 flex-col gap-1 px-1 text-xs sm:flex-row sm:gap-1.5 sm:text-sm',
                }"
            >
                <template #facturas>
                    <CuentaFacturas />
                </template>
                <template #pagos>
                    <div class="flex flex-col gap-6">
                        <CuentaComprobantes :servicio-id="servicioComprobante" />
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
                            <CuentaPagos />
                        </section>
                    </div>
                </template>
                <template #promesas>
                    <CuentaPromesas />
                </template>
                <template #datos>
                    <div class="flex flex-col gap-4">
                        <CuentaTelegram
                            :vinculado="cuenta.cliente.telegram_vinculado"
                            @cambio="refresh()"
                        />
                        <CuentaContacto
                            :contacto="cuenta.cliente"
                            @actualizado="contactoActualizado"
                        />
                    </div>
                </template>
            </UTabs>
        </template>

        <PromesaSolicitar
            v-model:open="verPromesa"
            :servicio-id="servicioPromesa"
            @resultado="promesaResuelta"
        />
    </div>
</template>
