<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import Decimal from 'decimal.js'

/**
 * Lateral de «Compras y gastos» (tablero ContaCompras): lo que se debe a proveedores por antigüedad
 * (`GET /reportes/cuentas-por-pagar`, cuadra con 2.1.03) y los borradores de factura por revisar
 * (`GET /compras/borradores`). Cada parte con su error y «Reintentar»; nunca un total inventado.
 */
const { puede } = usePermisos()

type FilaCxp = RespuestaReporte<'cuentas-por-pagar'>['totales']

const totales = shallowRef<FilaCxp | null>(null)
const problema = ref<Problem | null>(null)
const borradores = shallowRef<BorradorCompra[] | null>(null)

async function cargar() {
    const r = await useReportes().reporte('cuentas-por-pagar', { corte: hoyGuatemala() })
    totales.value = r.ok ? r.data.totales : null
    problema.value = r.ok ? null : r.problema
}

async function cargarBorradores() {
    if (!puede('compras.cargar_borrador')) {
        return
    }
    const r = await useBorradoresCompra().listar({ estado: 'borrador' })
    borradores.value = r.ok ? r.data.data : null
}

onMounted(() => {
    void cargar()
    void cargarBorradores()
})

const total = computed(() => (totales.value?.total ? new Decimal(totales.value.total) : null))
const vencido = computed(() => (totales.value?.vencido ? new Decimal(totales.value.vencido) : null))
const tramos = computed(() => (totales.value
    ? tramosCartera({
            por_vencer: String(totales.value.por_vencer ?? '0'),
            dias_0_30: String(totales.value.dias_0_30 ?? '0'),
            dias_31_60: String(totales.value.dias_31_60 ?? '0'),
            dias_61_90: String(totales.value.dias_61_90 ?? '0'),
            dias_mas_90: String(totales.value.dias_mas_90 ?? '0'),
        })
    : []))
</script>

<template>
    <div
        class="flex flex-col gap-4 p-4"
        data-prueba="cuentas-por-pagar"
    >
        <div>
            <h2 class="text-base font-semibold text-highlighted">
                <template v-if="total && vencido">
                    Debes {{ formatearQuetzales(total) }}; {{ formatearQuetzales(vencido) }} ya vencieron
                </template>
                <template v-else>
                    Lo que debes a proveedores
                </template>
            </h2>
            <p class="text-xs text-muted">
                Cuentas por pagar por antigüedad · cuadra con proveedores (2.1.03)
            </p>
        </div>
        <ProblemaAlerta
            v-if="problema"
            :problema="problema"
            :reintentar="cargar"
        />
        <USkeleton
            v-else-if="!totales"
            class="h-40 w-full"
        />
        <ContaAntiguedad
            v-else
            :tramos="tramos"
            etiqueta="Cuentas por pagar por antigüedad"
        />

        <div
            v-if="borradores?.length"
            class="flex flex-col gap-2 rounded-2xl border border-dashed border-primary/40 bg-primary/5 p-4"
            data-prueba="borradores-por-revisar"
        >
            <div class="flex items-start gap-3">
                <UIcon
                    name="i-lucide-upload"
                    class="mt-0.5 size-5 shrink-0 text-primary"
                />
                <div class="flex min-w-0 flex-col">
                    <span class="text-sm font-semibold text-highlighted">{{ borradores.length }} {{ borradores.length === 1 ? 'borrador por revisar' : 'borradores por revisar' }}</span>
                    <span class="text-xs text-muted">Leídos del XML o la foto de la factura; tú confirmas antes de que toquen el libro</span>
                </div>
            </div>
            <ULink
                v-for="b in borradores.slice(0, 4)"
                :key="b.id"
                :to="`/compras/borradores/${b.id}`"
                class="flex items-center justify-between gap-2 rounded-lg px-1 py-1 text-sm hover:bg-(--ax-fila-hover)"
            >
                <span class="truncate">{{ b.archivo_nombre ?? `Borrador #${b.id}` }}</span>
                <UBadge
                    :label="b.archivo_tipo?.includes('xml') ? 'XML' : 'Foto · revisar'"
                    :color="b.archivo_tipo?.includes('xml') ? 'success' : 'warning'"
                    variant="soft"
                    size="sm"
                />
            </ULink>
        </div>
    </div>
</template>
