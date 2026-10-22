<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'

/**
 * Filas de un libro legal (vista previa) con sus columnas. Las filas que no son movimiento (total de
 * la partida en el Diario, saldo inicial y final en el Mayor) van en negrita; el pie muestra
 * `totales` tal como lo da la API, que solo suma los movimientos (el saldo no se suma).
 */
const props = defineProps<{
    reporte: ReporteLibroCualquiera
    cargando?: boolean
    titulo: string
}>()

const NUMERICAS: ColumnaReporte['tipo'][] = ['dinero', 'entero', 'porcentaje']

const filas = computed<FilaReporte[]>(() => props.reporte.filas.map(fila => Object.fromEntries(Object.entries(fila))))
const totales = computed<FilaReporte>(() => Object.fromEntries(Object.entries(props.reporte.totales)))

const columnas = computed<TableColumn<FilaReporte>[]>(() => columnasLibro(props.reporte.columnas).map((columna, indice) => {
    const numerica = NUMERICAS.includes(columna.tipo)
    const total = totales.value[columna.clave]
    const pie = total === null || total === undefined ? (indice === 0 ? 'Total' : '') : celdaReporte(columna, total)
    return {
        id: columna.clave,
        header: columna.titulo,
        cell: ({ row }) => {
            const valor = row.original[columna.clave]
            return h('span', { class: [numerica ? 'tabular-nums' : '', esNegativo(columna, valor) ? 'text-error' : ''] }, celdaReporte(columna, valor))
        },
        footer: () => h('span', { 'class': ['whitespace-nowrap font-semibold text-highlighted', numerica ? 'tabular-nums' : ''], 'data-prueba': `total-${columna.clave}` }, pie),
        meta: { class: { th: numerica ? 'text-right' : '', td: numerica ? 'text-right whitespace-nowrap' : 'whitespace-nowrap' } },
    }
}))

const meta = {
    class: {
        tr: (fila: { original: FilaReporte }) => (esFilaResumen(fila.original) ? 'font-semibold text-highlighted bg-elevated/50' : ''),
    },
}
</script>

<template>
    <UTable
        :data="filas"
        :columns="columnas"
        :meta="meta"
        :loading="cargando"
        sticky
        class="max-h-[70vh]"
        :ui="{ td: 'py-2 text-sm', th: 'py-2 text-xs', tfoot: 'bg-elevated/50' }"
        tabindex="0"
        :aria-label="titulo"
        data-prueba="tabla-libro"
    >
        <template #empty>
            <UEmpty
                icon="i-lucide-file-x"
                title="Sin movimientos en el periodo"
                variant="naked"
            />
        </template>
    </UTable>
</template>
