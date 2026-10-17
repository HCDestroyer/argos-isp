<script setup lang="ts">
import type { Problem, Schema } from '@argosisp/contracts'
import type { TableColumn } from '@nuxt/ui'
import Decimal from 'decimal.js'

/**
 * Pestaña "Estado de cuenta": saldo del auxiliar CxC, avisos pendientes y movimientos. Con varias
 * empresas (multiempresa) los avisos pendientes van por empresa (la de su servicio) con lo que falta
 * pagar en cada una; el saldo total queda solo como información (cada NIT cobra lo suyo).
 */
const props = withDefaults(defineProps<{
    clienteId: number
    /** Servicios del cliente, para saber la empresa de cada aviso. */
    servicios?: Servicio[]
}>(), {
    servicios: () => [],
})

type Factura = Schema<'Factura'>
type Movimiento = Schema<'MovimientoEstadoCuenta'>

const { puede } = usePermisos()
const { conSelector: porEmpresa } = useEmpresaActiva()

/** Enlace al documento del movimiento (factura, mora, pago o nota de crédito), si el usuario puede verlo. */
function enlaceMovimiento(movimiento: Movimiento): string | null {
    if ((movimiento.tipo === 'factura' || movimiento.tipo === 'mora') && puede('facturas.ver')) {
        return `/facturas/${movimiento.referencia_id}`
    }
    if (movimiento.tipo === 'pago' && puede('pagos.ver')) {
        return `/pagos/${movimiento.referencia_id}`
    }
    // `referencia_id` de una nota de crédito es la nota (A3, `a3.md`).
    if (movimiento.tipo === 'nota_credito' && puede('facturas.ver')) {
        return `/notas-credito/${movimiento.referencia_id}`
    }
    return null
}

/**
 * Concepto del movimiento: sin "· pagado por …" (va en su insignia) y, si viene de una
 * importación, sin la clave del origen (va aparte, discreta).
 */
function partesMovimiento(movimiento: Movimiento): { concepto: string, pagadoPor: string | null, origen: OrigenImportado | null } {
    const origen = origenMovimiento(movimiento)
    return { ...separarPagadoPor(origen?.descripcion ?? movimiento.descripcion), origen }
}

const estado = shallowRef<EstadoCuenta | null>(null)
const cargando = ref(true)
const problema = ref<Problem | null>(null)

/** `null` mientras no se haya leído la cuenta: nunca se asume saldo cero. */
const saldo = computed(() => (estado.value ? new Decimal(estado.value.saldo) : null))

const columnasFacturas: TableColumn<Factura>[] = [
    { accessorKey: 'periodo', header: 'Periodo' },
    { accessorKey: 'vence_en', header: 'Vence', meta: SOLO_ANCHO },
    { accessorKey: 'total', header: 'Total', meta: SOLO_ANCHO },
    { id: 'pendiente', header: 'Pendiente' },
    { accessorKey: 'estado', header: 'Estado' },
]

const columnasMovimientos: TableColumn<Movimiento>[] = [
    { accessorKey: 'fecha', header: 'Fecha', meta: SOLO_ANCHO },
    { accessorKey: 'descripcion', header: 'Concepto', meta: { class: { td: 'whitespace-normal' } } },
    { accessorKey: 'cargo', header: 'Cargo', meta: SOLO_ANCHO },
    { accessorKey: 'abono', header: 'Abono', meta: SOLO_ANCHO },
    { accessorKey: 'saldo', header: 'Saldo' },
]

interface GrupoCuenta {
    empresaId: number | null
    filas: Factura[]
    /** Lo que muestra el encabezado: el saldo de la sección (API) o, sin secciones, lo pendiente. */
    detalle: string
}

/**
 * Avisos pendientes por empresa. Con `EstadoCuenta.empresas[]` (A3) cada sección trae su saldo del
 * auxiliar; sin ella (API anterior) se agrupan por la empresa del servicio y se muestra lo pendiente.
 */
const gruposFacturas = computed<GrupoCuenta[]>(() => {
    const facturas = estado.value?.facturas_pendientes ?? []
    if (!porEmpresa.value) {
        return [{ empresaId: null, filas: facturas, detalle: '' }]
    }
    const secciones = estado.value?.empresas
    if (secciones?.length) {
        return secciones.map(seccion => ({
            empresaId: seccion.empresa_id,
            filas: seccion.facturas_pendientes,
            detalle: `Saldo ${formatearQuetzales(seccion.saldo)}${new Decimal(seccion.saldo_a_favor).gt(0) ? ` · a favor ${formatearQuetzales(seccion.saldo_a_favor)}` : ''}`,
        }))
    }
    return agruparPorEmpresa(facturas, factura => factura.empresa_id ?? empresaDeFactura(factura, props.servicios))
        .map(grupo => ({ ...grupo, detalle: `Pendiente ${formatearQuetzales(pendienteDeFacturas(grupo.filas))}` }))
})

function pendiente(factura: Factura): Decimal {
    return new Decimal(factura.total).minus(factura.pagado)
}

function esCero(monto: string): boolean {
    return new Decimal(monto).isZero()
}

async function cargar() {
    cargando.value = true
    const resultado = await useClientes().estadoCuenta(props.clienteId)
    cargando.value = false
    if (resultado.ok) {
        estado.value = resultado.data
        problema.value = null
    }
    else {
        estado.value = null
        problema.value = resultado.problema
    }
}

onMounted(cargar)
</script>

<template>
    <!--
        Con error solo se ve el aviso: nada de saldo, contadores ni tablas vacías, porque
        "Q 0.00 · Al día" sobre una cuenta que no se pudo leer es un dato inventado.
    -->
    <ProblemaAlerta
        v-if="problema"
        :problema="problema"
        :reintentar="cargar"
        :reintentando="cargando"
    />

    <div
        v-else
        class="flex flex-col gap-6"
    >
        <div class="grid gap-4 sm:grid-cols-3">
            <UPageCard
                variant="subtle"
                :ui="{ container: 'gap-1 sm:p-4' }"
            >
                <p class="text-xs font-medium text-muted">
                    {{ porEmpresa && (estado?.empresas?.length ?? 0) > 1 ? 'Saldo total (informativo)' : 'Saldo' }}
                </p>
                <template v-if="cargando || !saldo">
                    <USkeleton class="h-8 w-32" />
                    <USkeleton class="h-4 w-40" />
                </template>
                <template v-else>
                    <p
                        class="text-2xl font-semibold tabular-nums"
                        :class="saldo.gt(0) ? 'text-error' : 'text-success'"
                    >
                        {{ formatearQuetzales(saldo) }}
                    </p>
                    <p class="text-xs text-muted">
                        {{ saldo.gt(0) ? 'El cliente debe este monto' : saldo.lt(0) ? 'Saldo a favor del cliente' : 'Al día' }}
                    </p>
                    <p
                        v-if="estado?.saldo_a_favor && !esCero(estado.saldo_a_favor)"
                        class="text-xs font-medium text-success"
                        data-prueba="saldo-a-favor"
                    >
                        Anticipo sin aplicar: {{ formatearQuetzales(estado.saldo_a_favor) }}
                    </p>
                </template>
            </UPageCard>

            <UPageCard
                variant="subtle"
                :ui="{ container: 'gap-1 sm:p-4' }"
            >
                <p class="text-xs font-medium text-muted">
                    Avisos pendientes
                </p>
                <template v-if="cargando || !estado">
                    <USkeleton class="h-8 w-12" />
                    <USkeleton class="h-4 w-24" />
                </template>
                <template v-else>
                    <p class="text-2xl font-semibold tabular-nums text-highlighted">
                        {{ estado.facturas_pendientes.length }}
                    </p>
                    <p class="text-xs text-muted">
                        {{ estado.facturas_pendientes.filter(f => f.estado === 'vencida').length }} vencidos
                    </p>
                </template>
            </UPageCard>
        </div>

        <div
            v-if="puede('facturas.ver') || puede('pagos.ver')"
            class="flex flex-wrap gap-2"
        >
            <UButton
                v-if="puede('facturas.ver')"
                :to="`/facturas?cliente=${clienteId}`"
                label="Todas sus facturas"
                icon="i-lucide-receipt-text"
                color="neutral"
                variant="outline"
                size="sm"
            />
            <UButton
                v-if="puede('pagos.ver')"
                :to="`/pagos?cliente=${clienteId}`"
                label="Sus pagos"
                icon="i-lucide-banknote"
                color="neutral"
                variant="outline"
                size="sm"
            />
            <UButton
                v-if="puede('promesas.ver')"
                :to="`/promesas?cliente=${clienteId}`"
                label="Sus promesas"
                icon="i-lucide-calendar-clock"
                color="neutral"
                variant="outline"
                size="sm"
            />
        </div>

        <section class="flex flex-col gap-3">
            <h3 class="text-sm font-semibold text-highlighted">
                Avisos de cobro pendientes
            </h3>
            <p
                v-if="porEmpresa && gruposFacturas.length > 1"
                class="text-xs text-muted"
            >
                Cada empresa cobra sus avisos con su NIT; el saldo total es solo informativo.
            </p>
            <div
                v-for="grupo in gruposFacturas"
                :key="grupo.empresaId ?? 'todas'"
                class="flex flex-col gap-2"
                :data-prueba="porEmpresa ? `pendientes-empresa-${grupo.empresaId}` : undefined"
            >
                <EncabezadoEmpresa
                    v-if="porEmpresa"
                    :empresa-id="grupo.empresaId"
                    nivel="h4"
                    :detalle="grupo.detalle"
                />
                <UTable
                    :data="grupo.filas"
                    :columns="columnasFacturas"
                    :loading="cargando"
                >
                    <template #periodo-cell="{ row }">
                        <div class="flex flex-col">
                            <ULink
                                v-if="puede('facturas.ver')"
                                :to="`/facturas/${row.original.id}`"
                                class="text-sm text-highlighted hover:text-primary"
                            >
                                {{ formatearFecha(row.original.periodo) }}
                            </ULink>
                            <span
                                v-else
                                class="text-sm"
                            >{{ formatearFecha(row.original.periodo) }}</span>
                            <span class="text-xs text-muted">Aviso #{{ row.original.id }}<template v-if="row.original.servicio_id"> · servicio {{ row.original.servicio_id }}</template></span>
                        </div>
                    </template>
                    <template #vence_en-cell="{ row }">
                        {{ formatearFecha(row.original.vence_en) }}
                    </template>
                    <template #total-cell="{ row }">
                        <span class="tabular-nums">{{ formatearQuetzales(row.original.total) }}</span>
                    </template>
                    <template #pendiente-cell="{ row }">
                        <span class="font-medium tabular-nums text-highlighted">{{ formatearQuetzales(pendiente(row.original)) }}</span>
                    </template>
                    <template #estado-cell="{ row }">
                        <UBadge
                            :label="ESTADOS_FACTURA[row.original.estado].etiqueta"
                            :icon="ESTADOS_FACTURA[row.original.estado].icono"
                            :color="ESTADOS_FACTURA[row.original.estado].color"
                            variant="subtle"
                            size="sm"
                        />
                    </template>
                    <template #empty>
                        <UEmpty
                            icon="i-lucide-badge-check"
                            title="Sin avisos pendientes"
                            variant="naked"
                        />
                    </template>
                </UTable>
            </div>
        </section>

        <section class="flex flex-col gap-2">
            <h3 class="text-sm font-semibold text-highlighted">
                Movimientos
            </h3>
            <UTable
                :data="estado?.movimientos ?? []"
                :columns="columnasMovimientos"
                :loading="cargando"
            >
                <template #fecha-cell="{ row }">
                    <span class="whitespace-nowrap text-sm">{{ formatearFecha(row.original.fecha) }}</span>
                </template>
                <template #descripcion-cell="{ row }">
                    <div class="flex flex-col">
                        <ULink
                            v-if="enlaceMovimiento(row.original)"
                            :to="enlaceMovimiento(row.original) ?? undefined"
                            class="text-sm text-highlighted hover:text-primary"
                        >
                            {{ partesMovimiento(row.original).concepto }}
                        </ULink>
                        <span
                            v-else
                            class="text-sm"
                        >{{ partesMovimiento(row.original).concepto }}</span>
                        <span
                            v-if="partesMovimiento(row.original).pagadoPor"
                            class="mt-0.5"
                        >
                            <UBadge
                                :label="`Pagado por ${partesMovimiento(row.original).pagadoPor}`"
                                icon="i-lucide-hand-coins"
                                color="info"
                                variant="subtle"
                                size="sm"
                                data-prueba="pagado-por"
                            />
                        </span>
                        <span
                            v-if="partesMovimiento(row.original).origen"
                            class="text-xs text-dimmed"
                            data-prueba="movimiento-importado"
                        >
                            Importado de {{ partesMovimiento(row.original).origen?.sistema }} · <span class="font-mono">{{ partesMovimiento(row.original).origen?.idExterno }}</span>
                        </span>
                        <span class="text-xs tabular-nums text-muted sm:hidden">
                            {{ formatearFecha(row.original.fecha) }} ·
                            {{ esCero(row.original.cargo) ? `abono ${formatearQuetzales(row.original.abono)}` : `cargo ${formatearQuetzales(row.original.cargo)}` }}
                        </span>
                    </div>
                </template>
                <template #cargo-cell="{ row }">
                    <span class="tabular-nums">{{ esCero(row.original.cargo) ? '' : formatearQuetzales(row.original.cargo) }}</span>
                </template>
                <template #abono-cell="{ row }">
                    <span class="tabular-nums text-success">{{ esCero(row.original.abono) ? '' : formatearQuetzales(row.original.abono) }}</span>
                </template>
                <template #saldo-cell="{ row }">
                    <span class="font-medium tabular-nums">{{ formatearQuetzales(row.original.saldo) }}</span>
                </template>
                <template #empty>
                    <UEmpty
                        icon="i-lucide-list"
                        title="Sin movimientos"
                        variant="naked"
                    />
                </template>
            </UTable>
        </section>
    </div>
</template>
