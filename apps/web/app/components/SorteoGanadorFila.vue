<script setup lang="ts">
/**
 * Un ganador del resultado (titular o suplente): su premio (el de su puesto o, un suplente, el de quien
 * no reclamó), el estado, el plazo para reclamar, la entrega con su constancia y las acciones que la
 * ficha permite (entregar, anular la entrega, dar por no reclamado). La fila no llama a la API:
 * emite y la ficha abre el modal.
 */
const props = defineProps<{
    sorteo: SorteoDetalle
    ganador: GanadorSorteo
    nombre: string
    puedeEntregar: boolean
    puedeAnularEntrega: boolean
    /** `sorteos.entregar` con el sorteo ejecutado o con el acta cerrada. */
    puedeNoReclamado: boolean
}>()

const emit = defineEmits<{
    entregar: [ganador: GanadorSorteo]
    anularEntrega: [ganador: GanadorSorteo]
    noReclamado: [ganador: GanadorSorteo]
}>()

const { enlace } = usePermisos()

const premio = computed(() => premioDeGanador(props.sorteo, props.ganador))
const pendiente = computed(() => props.ganador.estado === 'por_notificar' || props.ganador.estado === 'notificado')
const plazoVencido = computed(() => plazoReclamoVencido(props.ganador))
const sustituto = computed(() => props.sorteo.ganadores.find(g => g.sustituye_a === props.ganador.id) ?? null)
const sustituido = computed(() => (props.ganador.sustituye_a ? props.sorteo.ganadores.find(g => g.id === props.ganador.sustituye_a) ?? null : null))
</script>

<template>
    <li
        class="flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:justify-between"
        v-bind="ganador.tipo === 'titular' ? { 'data-ganador': ganador.posicion } : { 'data-suplente': ganador.posicion }"
    >
        <div class="flex min-w-0 items-start gap-3">
            <span
                class="flex size-8 shrink-0 items-center justify-center rounded-full text-sm font-semibold"
                :class="ganador.tipo === 'titular' ? 'bg-primary/10 text-primary' : 'bg-elevated text-muted'"
            >{{ ganador.posicion }}</span>
            <div class="flex min-w-0 flex-col">
                <ULink
                    v-if="enlace(`/clientes/${ganador.cliente_id}`)"
                    :to="enlace(`/clientes/${ganador.cliente_id}`)"
                    class="text-sm font-medium text-highlighted hover:text-primary"
                >
                    {{ nombre }}
                </ULink>
                <span
                    v-else
                    class="text-sm font-medium text-highlighted"
                >{{ nombre }}</span>
                <span class="text-xs text-muted">
                    <span class="font-mono">{{ ganador.codigo_publico }}</span>
                    <template v-if="premio">
                        · {{ premio.nombre }} ({{ TIPOS_PREMIO_SORTEO[premio.tipo].etiqueta.toLowerCase() }})
                    </template>
                </span>
                <span
                    v-if="sustituido"
                    class="text-xs text-muted"
                    data-prueba="ganador-sustituye"
                >Toma el premio del {{ sustituido.posicion }}.º puesto, que no lo reclamó.</span>
                <span
                    v-if="ganador.estado === 'notificado' && ganador.reclamar_antes"
                    class="text-xs"
                    :class="plazoVencido ? 'text-warning' : 'text-muted'"
                    data-prueba="ganador-plazo"
                >
                    Notificado{{ ganador.notificado_en ? ` el ${formatearFecha(ganador.notificado_en)}` : '' }} · {{ plazoVencido ? `el plazo venció el ${formatearFecha(ganador.reclamar_antes)}` : `reclama hasta el ${formatearFecha(ganador.reclamar_antes)}` }}
                </span>
                <span
                    v-if="ganador.estado === 'sustituido' || ganador.estado === 'no_reclamado'"
                    class="text-xs text-muted"
                    data-prueba="ganador-no-reclamado"
                >
                    No reclamó{{ ganador.no_reclamado_en ? ` (${formatearFecha(ganador.no_reclamado_en)})` : '' }}{{ sustituto ? `: el premio pasó al suplente ${sustituto.posicion}.º` : ': sin suplentes, el premio sigue lo que dicen las bases' }}
                </span>
                <span
                    v-if="ganador.estado === 'entregado'"
                    class="text-xs text-muted"
                    data-prueba="ganador-entrega"
                >
                    {{ contrapartidaLegible(ganador.contrapartida) }}<template v-if="ganador.compra_unidades">
                        · {{ ganador.compra_unidades }} {{ ganador.compra_unidades === 1 ? 'unidad' : 'unidades' }}<template v-if="ganador.compra_base">, base {{ formatearQuetzales(ganador.compra_base) }}</template>
                    </template><template v-if="ganador.retencion_isr && ganador.retencion_isr !== '0.00'">
                        · ISR {{ formatearQuetzales(ganador.retencion_isr) }}
                    </template><template v-if="ganador.entregado_en">
                        · {{ formatearFechaHora(ganador.entregado_en) }}
                    </template>
                </span>
                <SorteoArchivoBoton
                    v-if="ganador.estado === 'entregado' && ganador.constancia_archivo_id"
                    :sorteo-id="sorteo.id"
                    :archivo-id="ganador.constancia_archivo_id"
                    :archivos="sorteo.archivos ?? []"
                    class="self-start"
                />
            </div>
        </div>
        <div class="flex flex-wrap items-center gap-2 self-start sm:justify-end sm:self-center">
            <UBadge
                :label="ESTADOS_GANADOR[ganador.estado].etiqueta"
                :color="ESTADOS_GANADOR[ganador.estado].color"
                variant="subtle"
                data-prueba="ganador-estado"
            />
            <UButton
                v-if="puedeNoReclamado && ganador.estado === 'notificado' && plazoVencido"
                label="No reclamado"
                icon="i-lucide-user-x"
                size="sm"
                color="neutral"
                variant="outline"
                :aria-label="`Dar por no reclamado el premio de ${nombre}`"
                data-prueba="no-reclamado"
                @click="emit('noReclamado', ganador)"
            />
            <UButton
                v-if="puedeEntregar && premio && pendiente"
                label="Entregar"
                icon="i-lucide-gift"
                size="sm"
                :aria-label="`Entregar el premio a ${nombre}`"
                data-prueba="entregar-premio"
                @click="emit('entregar', ganador)"
            />
            <UButton
                v-if="puedeAnularEntrega && ganador.estado === 'entregado'"
                label="Anular entrega"
                icon="i-lucide-undo-2"
                size="sm"
                color="neutral"
                variant="outline"
                :aria-label="`Anular la entrega del premio a ${nombre}`"
                data-prueba="anular-entrega"
                @click="emit('anularEntrega', ganador)"
            />
        </div>
    </li>
</template>
