<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import Decimal from 'decimal.js'

/**
 * Vista rápida de un cliente desde la lista (tablero NuevoClientes): tarjeta flotante con el estado
 * (el peor de sus servicios y las facturas vencidas), saldo y servicios, teléfono, cada servicio
 * con su IP y la zona; abajo «Cobrar Q …», «Promesa» y «Abrir ficha». Lo que no se pudo leer se
 * muestra con su error y «Reintentar», nunca como cero.
 */
const props = defineProps<{
    cliente: Cliente | null
    nombreZona?: string | null
}>()

const abierto = defineModel<boolean>('open', { default: false })

const { puede, enlace } = usePermisos()
const verServicios = computed(() => puede('servicios.ver'))
const verCuenta = computed(() => puede('clientes.estado_cuenta'))

const servicios = shallowRef<Servicio[] | null>(null)
const problemaServicios = ref<Problem | null>(null)
const cuenta = shallowRef<EstadoCuenta | null>(null)
const problemaCuenta = ref<Problem | null>(null)

async function cargarServicios() {
    servicios.value = null
    problemaServicios.value = null
    if (!props.cliente || !verServicios.value) {
        return
    }
    const resultado = await useServicios().listar({ cliente_id: props.cliente.id })
    servicios.value = resultado.ok ? resultado.data.data.filter(s => s.estado !== 'retirado') : null
    problemaServicios.value = resultado.ok ? null : resultado.problema
}

async function cargarCuenta() {
    cuenta.value = null
    problemaCuenta.value = null
    if (!props.cliente || !verCuenta.value) {
        return
    }
    const resultado = await useClientes().estadoCuenta(props.cliente.id)
    cuenta.value = resultado.ok ? resultado.data : null
    problemaCuenta.value = resultado.ok ? null : resultado.problema
}

watch(() => [abierto.value, props.cliente?.id], () => {
    if (abierto.value) {
        void cargarServicios()
        void cargarCuenta()
    }
}, { immediate: true })

const peorEstado = computed(() => peorEstadoServicios(servicios.value))

const vencidas = computed(() => cuenta.value?.facturas_pendientes.filter(f => f.estado === 'vencida').length ?? null)
const debe = computed(() => (cuenta.value ? new Decimal(cuenta.value.saldo).gt(0) : false))

const textoEstado = computed(() => {
    if (!peorEstado.value) {
        return null
    }
    const base = ESTADOS_SERVICIO[peorEstado.value].etiqueta
    if (peorEstado.value === 'suspendido' || peorEstado.value === 'limitado') {
        const motivo = vencidas.value ? ` por mora · ${vencidas.value === 1 ? '1 factura vencida' : `${vencidas.value} facturas vencidas`}` : ''
        return `${base}${motivo}`
    }
    return base
})

function alCrearPromesa() {
    void cargarServicios()
    void cargarCuenta()
}
</script>

<template>
    <VistaRapida
        v-if="cliente"
        v-model:open="abierto"
        :titulo="cliente.nombre"
        :subtitulo="`${cliente.codigo} · desde ${new Date(cliente.created_at).getFullYear()}`"
        :avatar="cliente.nombre"
    >
        <template
            v-if="textoEstado && peorEstado"
            #estado
        >
            <UBadge
                :label="textoEstado"
                :icon="ESTADOS_SERVICIO[peorEstado].icono"
                :color="ESTADOS_SERVICIO[peorEstado].color"
                variant="subtle"
                class="rounded-full"
                data-prueba="vista-estado"
            />
        </template>

        <div class="grid grid-cols-2 gap-3">
            <div
                v-if="verCuenta"
                class="flex flex-col gap-0.5 rounded-xl bg-(--ax-panel) p-3"
            >
                <span class="text-xs text-muted">Saldo</span>
                <USkeleton
                    v-if="!cuenta && !problemaCuenta"
                    class="h-7 w-24"
                />
                <span
                    v-else-if="cuenta"
                    class="text-xl font-bold tabular-nums"
                    :class="debe ? 'text-error' : 'text-highlighted'"
                    data-prueba="vista-saldo"
                >{{ formatearQuetzales(cuenta.saldo) }}</span>
                <span
                    v-else
                    class="text-sm text-muted"
                >No se pudo leer</span>
            </div>
            <div
                v-if="verServicios"
                class="flex flex-col gap-0.5 rounded-xl bg-(--ax-panel) p-3"
            >
                <span class="text-xs text-muted">Servicios</span>
                <USkeleton
                    v-if="!servicios && !problemaServicios"
                    class="h-7 w-10"
                />
                <span
                    v-else-if="servicios"
                    class="text-xl font-bold tabular-nums text-highlighted"
                >{{ servicios.length }}</span>
                <span
                    v-else
                    class="text-sm text-muted"
                >No se pudo leer</span>
            </div>
        </div>

        <ProblemaAlerta
            v-if="problemaCuenta"
            :problema="problemaCuenta"
            :reintentar="cargarCuenta"
        />
        <ProblemaAlerta
            v-if="problemaServicios"
            :problema="problemaServicios"
            :reintentar="cargarServicios"
        />

        <dl class="flex flex-col divide-y divide-(--ax-borde) border-t border-(--ax-borde) text-sm">
            <div class="flex items-center justify-between gap-3 py-2.5">
                <dt class="flex items-center gap-2 text-muted">
                    <UIcon
                        name="i-lucide-phone"
                        class="size-4"
                    />
                    Teléfono
                </dt>
                <dd class="text-highlighted">
                    {{ cliente.telefono ?? cliente.movil ?? '—' }}
                </dd>
            </div>
            <template v-if="servicios">
                <div
                    v-for="servicio in servicios"
                    :key="servicio.id"
                    class="flex items-center justify-between gap-3 py-2.5"
                >
                    <dt class="flex min-w-0 items-center gap-2 text-muted">
                        <UIcon
                            name="i-lucide-wifi"
                            class="size-4 shrink-0"
                        />
                        <ULink
                            :to="enlace(`/servicios/${servicio.id}`)"
                            class="truncate hover:text-primary"
                        >
                            {{ etiquetaServicio(servicio) }}
                        </ULink>
                    </dt>
                    <dd>
                        <span
                            v-if="servicio.ipv4"
                            class="rounded-md bg-(--ax-panel) px-1.5 py-0.5 font-mono text-[0.8125rem] text-highlighted"
                        >{{ servicio.ipv4 }}</span>
                        <span
                            v-else
                            class="text-muted"
                        >Sin IPv4</span>
                    </dd>
                </div>
            </template>
            <div class="flex items-center justify-between gap-3 py-2.5">
                <dt class="flex items-center gap-2 text-muted">
                    <UIcon
                        name="i-lucide-map-pin"
                        class="size-4"
                    />
                    Zona
                </dt>
                <dd class="text-highlighted">
                    {{ nombreZona ?? '—' }}
                </dd>
            </div>
        </dl>

        <template #acciones>
            <UButton
                v-if="enlace(`/cobro?cliente=${cliente.id}`)"
                :to="enlace(`/cobro?cliente=${cliente.id}`)"
                :label="cuenta && debe ? `Cobrar ${formatearQuetzales(cuenta.saldo)}` : 'Cobrar'"
                :icon="ICONOS.cobrar"
                color="success"
                size="lg"
                block
                data-prueba="vista-cobrar"
            />
            <div class="grid grid-cols-2 gap-2">
                <PromesaServicioBoton
                    :servicios="servicios"
                    :boton="{ block: true }"
                    @creada="alCrearPromesa"
                />
                <UButton
                    :to="enlace(`/clientes/${cliente.id}`)"
                    label="Abrir ficha"
                    trailing-icon="i-lucide-chevron-right"
                    color="neutral"
                    variant="outline"
                    block
                    :class="puede('promesas.crear') && servicios?.some(s => s.estado !== 'pendiente_instalacion') ? '' : 'col-span-2'"
                />
            </div>
        </template>
    </VistaRapida>
</template>
