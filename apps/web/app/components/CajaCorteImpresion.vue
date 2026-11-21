<script setup lang="ts">
/**
 * Corte de caja para imprimir (tablero NuevoCierreCaja, paso «Cerrada»): ticket de 80 mm o
 * carta, según el botón (decisión 20: cada caja recuerda su formato). Fuera de la vista en
 * pantalla; al imprimir solo sale este bloque (usa la misma clase que el recibo del cobro).
 */
const props = defineProps<{
    caja: Caja
    turno: TurnoCaja
    resumen: ResumenTurnoCaja | null
    formato: FormatoImpresion
}>()

/** El tamaño de la hoja se decide al imprimir: 80 mm de ancho o carta. */
useHead(() => ({
    style: [{ key: 'corte-caja-pagina', textContent: `@media print { @page { size: ${props.formato === 'carta' ? 'letter' : '80mm auto'}; margin: ${props.formato === 'carta' ? '15mm' : '4mm'}; } }` }],
}))

const filas = computed(() => [
    { etiqueta: 'Fondo inicial', valor: formatearQuetzales(props.turno.fondo_inicial) },
    ...(props.resumen
        ? [
                { etiqueta: `Cobros en efectivo (${props.resumen.efectivo_cobrado.cantidad})`, valor: formatearQuetzales(props.resumen.efectivo_cobrado.monto) },
                { etiqueta: `Retiros (${props.resumen.retiros.cantidad})`, valor: formatearQuetzales(props.resumen.retiros.monto) },
            ]
        : []),
    { etiqueta: 'Debe haber', valor: formatearQuetzales(props.turno.esperado) },
    { etiqueta: 'Contado', valor: formatearQuetzales(props.turno.contado) },
    { etiqueta: 'Diferencia', valor: props.turno.diferencia ? etiquetaCuadre(props.turno.diferencia) : '—' },
    ...(props.turno.fondo_siguiente ? [{ etiqueta: 'Fondo que queda', valor: formatearQuetzales(props.turno.fondo_siguiente) }] : []),
    ...(props.turno.entregado_a_nombre ? [{ etiqueta: `Entregado a ${props.turno.entregado_a_nombre}`, valor: formatearQuetzales(props.turno.entregado_monto) }] : []),
])
</script>

<template>
    <div
        class="pointer-events-none fixed top-0 -left-[200vw] print:left-0"
        aria-hidden="true"
    >
        <div
            class="recibo-ticket flex flex-col gap-2 text-black"
            :class="formato === 'carta' ? 'w-[180mm]' : 'w-[72mm]'"
            data-prueba="corte-impresion"
        >
            <p class="text-center font-bold">
                Corte de caja #{{ turno.id }}
            </p>
            <p class="text-center text-xs">
                {{ caja.nombre }} · {{ formatearFechaHora(turno.abierto_en) }} a {{ turno.cerrado_en ? formatearFechaHora(turno.cerrado_en) : '—' }}
            </p>
            <dl class="flex flex-col text-xs">
                <div
                    v-for="fila in filas"
                    :key="fila.etiqueta"
                    class="flex justify-between gap-2 border-b border-dashed py-1"
                >
                    <dt>{{ fila.etiqueta }}</dt>
                    <dd class="tabular-nums">
                        {{ fila.valor }}
                    </dd>
                </div>
            </dl>
            <template v-if="resumen?.cobros.por_metodo.length">
                <p class="text-xs font-bold">
                    Cobros por método
                </p>
                <dl class="flex flex-col text-xs">
                    <div
                        v-for="m in resumen.cobros.por_metodo"
                        :key="m.metodo"
                        class="flex justify-between gap-2 py-0.5"
                    >
                        <dt>{{ ETIQUETAS_METODO[m.metodo as keyof typeof ETIQUETAS_METODO] ?? m.metodo }} ({{ m.cantidad }})</dt>
                        <dd class="tabular-nums">
                            {{ formatearQuetzales(m.monto) }}
                        </dd>
                    </div>
                </dl>
            </template>
            <p
                v-if="turno.motivo"
                class="text-xs"
            >
                Motivo: {{ turno.motivo }}
            </p>
            <p class="mt-6 text-center text-xs">
                ____________________<br>Firma del cajero
            </p>
        </div>
    </div>
</template>

<style>
@media print {
    body * {
        visibility: hidden !important;
    }

    .recibo-ticket,
    .recibo-ticket * {
        visibility: visible !important;
        color: #000 !important;
        background: #fff !important;
    }

    .recibo-ticket {
        position: absolute;
        inset: 0 auto auto 0;
    }
}
</style>
