<script setup lang="ts">
import type { Schema } from '@argosisp/contracts'
import Decimal from 'decimal.js'

/**
 * Recibo de un pago registrado. En pantalla es una tarjeta; al imprimir (`window.print()`) solo
 * sale este bloque, como ticket de 80 mm en blanco y negro (estilos `@media print` abajo).
 */
const props = withDefaults(defineProps<{
    pago: Pago
    cliente: Cliente
    /** Facturas del cliente antes del pago, para mostrar el periodo de cada aplicación. */
    facturas?: Schema<'Factura'>[]
    caja?: string | null
    cajero?: string | null
    /** Servicios del cliente, para nombrar el servicio de cada factura pagada. */
    servicios?: Servicio[]
    /** Servicios que el pago reactivó (`Pago.servicios[]`). */
    reactivados?: Servicio[]
    /** Servicios suspendidos a mano: el pago no los reactiva y el recibo lo dice. */
    suspendidosManual?: Servicio[]
}>(), {
    facturas: () => [],
    caja: null,
    cajero: null,
    servicios: () => [],
    reactivados: () => [],
    suspendidosManual: () => [],
})

const periodos = computed(() => new Map(props.facturas.map(f => [f.id, f])))

const aplicado = computed(() => props.pago.aplicaciones.reduce((total, a) => total.plus(a.monto), new Decimal(0)))
const aFavor = computed(() => new Decimal(props.pago.monto).minus(aplicado.value))

/** Nombre de cada cliente que aparece en el pago: el pagador y los dueños de las facturas. */
const nombres = computed(() => {
    const mapa = new Map<number, string>([[props.cliente.id, props.cliente.nombre]])
    for (const a of props.pago.aplicaciones) {
        if (a.cliente_id !== undefined && a.cliente_nombre) {
            mapa.set(a.cliente_id, a.cliente_nombre)
        }
    }
    for (const s of [...props.servicios, ...props.reactivados]) {
        if (s.cliente_nombre && !mapa.has(s.cliente_id)) {
            mapa.set(s.cliente_id, s.cliente_nombre)
        }
    }
    return mapa
})

/**
 * Pago de terceros (A3): las aplicaciones agrupadas por dueño de la factura, el pagador primero.
 * Sin `cliente_id` (API vieja) todo es del pagador.
 */
const gruposAplicacion = computed(() => {
    const grupos = new Map<number, Schema<'AplicacionPago'>[]>()
    for (const a of props.pago.aplicaciones) {
        const dueno = a.cliente_id ?? props.cliente.id
        grupos.set(dueno, [...(grupos.get(dueno) ?? []), a])
    }
    return [...grupos.entries()]
        .sort(([a], [b]) => Number(b === props.cliente.id) - Number(a === props.cliente.id))
        .map(([clienteId, aplicaciones]) => ({ clienteId, nombre: nombres.value.get(clienteId) ?? `Cliente #${clienteId}`, aplicaciones }))
})
const deTerceros = computed(() => gruposAplicacion.value.some(g => g.clienteId !== props.cliente.id))

/** Servicios reactivados por cliente, con el nombre del dueño cuando no es el pagador. */
const reactivadosPorCliente = computed(() => {
    const grupos = new Map<number, Servicio[]>()
    for (const s of props.reactivados) {
        grupos.set(s.cliente_id, [...(grupos.get(s.cliente_id) ?? []), s])
    }
    return [...grupos.entries()]
        .sort(([a], [b]) => Number(b === props.cliente.id) - Number(a === props.cliente.id))
        .map(([clienteId, servicios]) => ({ clienteId, nombre: nombres.value.get(clienteId) ?? null, servicios }))
})

function periodo(facturaId: number): string {
    const factura = periodos.value.get(facturaId)
    if (!factura) {
        return `Aviso #${facturaId}`
    }
    const servicio = props.servicios.find(s => s.id === factura.servicio_id)
    return `Aviso #${facturaId} · ${formatearFecha(factura.periodo).slice(3)}${servicio ? ` · ${etiquetaServicio(servicio)}` : ''}`
}
</script>

<template>
    <article
        class="recibo-ticket flex flex-col gap-3 rounded-lg border border-default bg-default p-4 text-sm"
        aria-label="Recibo de pago"
    >
        <header class="flex flex-col items-center gap-0.5 text-center">
            <p class="text-base font-semibold text-highlighted">
                ArgosIsp
            </p>
            <p class="text-xs text-muted">
                Recibo de pago
            </p>
            <p class="font-mono text-lg font-semibold text-highlighted">
                No. {{ String(pago.id).padStart(6, '0') }}
            </p>
            <p class="text-xs text-muted">
                {{ formatearFechaHora(pago.created_at) }} (hora de Guatemala)
            </p>
        </header>

        <USeparator type="dashed" />

        <dl class="recibo-datos grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
            <dt class="text-muted">
                Cliente
            </dt>
            <dd class="text-right text-highlighted">
                {{ cliente.nombre }}
            </dd>
            <dt class="text-muted">
                NIT
            </dt>
            <dd class="text-right font-mono">
                {{ cliente.nit_cui ?? 'CF' }}
            </dd>
            <dt class="text-muted">
                Método
            </dt>
            <dd class="text-right">
                {{ ETIQUETAS_METODO[pago.metodo] }}
            </dd>
            <template v-if="pago.banco_origen_nombre">
                <dt class="text-muted">
                    Banco de origen
                </dt>
                <dd
                    class="text-right"
                    data-prueba="recibo-banco-origen"
                >
                    {{ pago.banco_origen_nombre }}
                </dd>
            </template>
            <template v-if="pago.cuenta_bancaria_nombre">
                <dt class="text-muted">
                    Cuenta de destino
                </dt>
                <dd
                    class="text-right"
                    data-prueba="recibo-cuenta-destino"
                >
                    {{ pago.cuenta_bancaria_nombre }}
                </dd>
            </template>
            <template v-if="pago.referencia">
                <dt class="text-muted">
                    {{ etiquetaReferencia(pago.metodo) }}
                </dt>
                <dd
                    class="break-all text-right font-mono"
                    data-prueba="recibo-referencia"
                >
                    {{ pago.referencia }}
                </dd>
            </template>
            <template v-if="caja">
                <dt class="text-muted">
                    Caja
                </dt>
                <dd class="text-right">
                    {{ caja }}
                </dd>
            </template>
            <template v-if="cajero">
                <dt class="text-muted">
                    Atendió
                </dt>
                <dd class="text-right">
                    {{ cajero }}
                </dd>
            </template>
        </dl>

        <USeparator type="dashed" />

        <div class="flex flex-col gap-1">
            <p class="text-xs font-medium text-muted">
                Aplicado a
            </p>
            <p
                v-if="!pago.aplicaciones.length"
                class="text-muted"
            >
                Sin facturas pendientes: queda como saldo a favor.
            </p>
            <div
                v-for="grupo in gruposAplicacion"
                :key="grupo.clienteId"
                class="flex flex-col gap-1"
                :data-recibo-cliente="grupo.clienteId"
            >
                <p
                    v-if="deTerceros"
                    class="text-xs font-medium text-highlighted"
                >
                    {{ grupo.nombre }}<template v-if="grupo.clienteId !== cliente.id">
                        · pagado por {{ cliente.nombre }}
                    </template>
                </p>
                <div
                    v-for="aplicacion in grupo.aplicaciones"
                    :key="aplicacion.factura_id"
                    class="flex justify-between gap-3"
                >
                    <span>{{ periodo(aplicacion.factura_id) }}</span>
                    <span class="tabular-nums">{{ formatearQuetzales(aplicacion.monto) }}</span>
                </div>
            </div>
            <div
                v-if="aFavor.gt(0) && pago.aplicaciones.length"
                class="flex justify-between gap-3 text-muted"
            >
                <span>Saldo a favor</span>
                <span class="tabular-nums">{{ formatearQuetzales(aFavor) }}</span>
            </div>
        </div>

        <USeparator type="dashed" />

        <div class="flex items-baseline justify-between gap-3">
            <span class="font-medium text-highlighted">Total recibido</span>
            <span class="text-xl font-semibold tabular-nums text-highlighted">{{ formatearQuetzales(pago.monto) }}</span>
        </div>

        <template v-if="reactivados.length || suspendidosManual.length">
            <USeparator type="dashed" />
            <div class="flex flex-col gap-1">
                <template
                    v-for="grupo in reactivadosPorCliente"
                    :key="`rc-${grupo.clienteId}`"
                >
                    <p
                        v-for="servicio in grupo.servicios"
                        :key="`r-${servicio.id}`"
                        class="flex items-center gap-1.5 text-success"
                        data-prueba="recibo-reactivado"
                    >
                        <UIcon
                            name="i-lucide-circle-check"
                            class="size-4 shrink-0"
                        />
                        <span>Servicio <span class="font-mono">{{ etiquetaServicio(servicio) }}</span> reactivado<template v-if="grupo.clienteId !== cliente.id && grupo.nombre"> · {{ grupo.nombre }}</template></span>
                    </p>
                </template>
                <p
                    v-for="servicio in suspendidosManual"
                    :key="`m-${servicio.id}`"
                    class="text-xs text-highlighted"
                    data-prueba="recibo-suspension-manual"
                >
                    El servicio <span class="font-mono">{{ etiquetaServicio(servicio) }}</span> está suspendido manualmente: este pago no lo
                    reactiva. Para reactivarlo, comuníquese con la oficina.
                </p>
            </div>
        </template>

        <p
            v-if="pago.nota"
            class="text-xs text-muted"
        >
            Nota: {{ pago.nota }}
        </p>
        <p class="text-center text-xs text-muted">
            Gracias por su pago.
        </p>
    </article>
</template>

<style>
/* Ticket de 80 mm: al imprimir solo se ve el recibo, en negro sobre blanco. */
@media print {
    @page {
        size: 80mm auto;
        margin: 4mm;
    }

    html,
    body {
        background: #fff !important;
    }

    body * {
        visibility: hidden !important;
    }

    .recibo-ticket,
    .recibo-ticket * {
        visibility: visible !important;
        color: #000 !important;
        background: #fff !important;
        border-color: #000 !important;
    }

    .recibo-ticket {
        position: absolute;
        inset: 0 auto auto 0;
        width: 72mm;
        padding: 0 !important;
        border: 0 !important;
        font-size: 11px;
    }
}
</style>
