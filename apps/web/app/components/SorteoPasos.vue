<script setup lang="ts">
/**
 * Avance del sorteo por sus pasos (§7.3): cada uno con la fecha en que se dio. Un sorteo cancelado
 * marca hasta dónde llegó.
 */
const props = defineProps<{
    sorteo: Pick<SorteoDetalle, 'estado' | 'created_at' | 'publicado_en' | 'corte_cerrado_en' | 'ejecutado_en' | 'cancelado_en' | 'ganadores' | 'acta_cerrada_en'>
}>()

interface Paso {
    estado: EstadoSorteo
    etiqueta: string
    fecha: string | null
    hecho: boolean
    actual: boolean
}

const pasos = computed<Paso[]>(() => {
    const s = props.sorteo
    const indice = PASOS_SORTEO.indexOf(s.estado)
    const entregado = s.ganadores.filter(g => g.entregado_en).map(g => g.entregado_en ?? '').sort().at(-1) ?? null
    const fechas: Record<string, string | null> = {
        borrador: s.created_at,
        bases_publicadas: s.publicado_en,
        participacion_abierta: null,
        corte_cerrado: s.corte_cerrado_en,
        ejecutado: s.ejecutado_en,
        acta_cerrada: s.acta_cerrada_en ?? null,
        premios_entregados: s.estado === 'premios_entregados' ? entregado : null,
    }
    // Cancelado: el último paso alcanzado es el último con fecha (o el borrador).
    const alcanzado = s.estado === 'cancelado'
        ? Math.max(0, ...PASOS_SORTEO.map((p, i) => (fechas[p] ? i : 0)))
        : indice
    return PASOS_SORTEO.map((estado, i) => ({
        estado,
        etiqueta: ESTADOS_SORTEO[estado].etiqueta,
        fecha: fechas[estado] ?? null,
        hecho: i < alcanzado || (i === alcanzado && s.estado === 'premios_entregados'),
        actual: i === alcanzado && s.estado !== 'cancelado' && s.estado !== 'premios_entregados',
    }))
})
</script>

<template>
    <ol
        class="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6"
        aria-label="Pasos del sorteo"
        data-prueba="sorteo-pasos"
    >
        <li
            v-for="paso in pasos"
            :key="paso.estado"
            class="flex items-start gap-2 rounded-lg border p-2"
            :class="paso.actual ? 'border-primary bg-primary/5' : 'border-default'"
            :aria-current="paso.actual ? 'step' : undefined"
            :data-paso="paso.estado"
        >
            <UIcon
                :name="paso.hecho ? 'i-lucide-circle-check' : paso.actual ? 'i-lucide-circle-dot' : 'i-lucide-circle'"
                class="mt-0.5 size-4 shrink-0"
                :class="paso.hecho ? 'text-success' : paso.actual ? 'text-primary' : 'text-dimmed'"
            />
            <div class="flex min-w-0 flex-col">
                <span
                    class="text-sm"
                    :class="paso.hecho || paso.actual ? 'font-medium text-highlighted' : 'text-muted'"
                >{{ paso.etiqueta }}</span>
                <span
                    v-if="paso.fecha"
                    class="text-xs text-muted"
                >{{ formatearFecha(paso.fecha) }}</span>
            </div>
        </li>
    </ol>
</template>
