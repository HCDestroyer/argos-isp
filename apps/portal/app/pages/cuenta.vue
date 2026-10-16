<script setup lang="ts">
import type { TabsItem } from '@nuxt/ui'
import Decimal from 'decimal.js'

/**
 * Portal autenticado: saldo y servicios arriba; facturas, pagos, promesas y datos en pestañas.
 * Sin sesión (401) manda a `/entrar`. Si la cuenta no se puede leer, muestra el error con
 * "Reintentar" y ningún monto.
 */
const { nombre: nombreEmpresa } = useEmpresa()
const { data: resultado, status, refresh } = useCuenta()
const acceso = useAccesoPortal()

useHead({ title: computed(() => `Mi cuenta · ${nombreEmpresa.value}`) })

const cargando = computed(() => status.value === 'idle' || status.value === 'pending')
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
                    ? `Tu promesa fue aprobada: pagarás ${formatearQuetzales(promesa.monto)} a más tardar el ${formatearFecha(promesa.vence_en)}.`
                    : `Pagarás ${formatearQuetzales(promesa.monto)} a más tardar el ${formatearFecha(promesa.vence_en)}. Si tu servicio no vuelve en unos minutos, comunícate con soporte.`"
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
                    <CuentaPagos />
                </template>
                <template #promesas>
                    <CuentaPromesas />
                </template>
                <template #datos>
                    <CuentaContacto
                        :contacto="cuenta.cliente"
                        @actualizado="contactoActualizado"
                    />
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
