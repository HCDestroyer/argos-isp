<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'

/**
 * Resultado de un sorteo ejecutado: titulares (con su premio y la entrega) y suplentes, con los datos
 * para verificarlo: semilla revelada, valor público, hashes y el enlace a la verificación pública.
 * «Comprobar» recalcula `argos-sorteo-v1` en el navegador con los datos públicos, como
 * `scripts/verificar-sorteo.mjs`. Quien lo abre decide si se puede entregar (`sorteos.entregar`).
 */
const props = defineProps<{
    sorteo: SorteoDetalle
    puedeEntregar: boolean
}>()

const emit = defineEmits<{
    entregar: [ganador: GanadorSorteo]
}>()

const { enlace } = usePermisos()
const nombres = useNombresClientes()

const titulares = computed(() => props.sorteo.ganadores.filter(g => g.tipo === 'titular'))
const suplentes = computed(() => props.sorteo.ganadores.filter(g => g.tipo === 'suplente'))
const urlVerificacion = computed(() => useSorteos().urlPublica(props.sorteo.id, 'verificacion'))

const comprobando = ref(false)
const comprobacion = shallowRef<ComprobacionSorteo | null>(null)
const problemaComprobacion = ref<Problem | null>(null)

const comprobado = computed(() => {
    const c = comprobacion.value
    return c ? c.compromiso && c.lista && c.bases && c.ganadores : null
})

async function comprobar() {
    comprobando.value = true
    problemaComprobacion.value = null
    comprobacion.value = null
    const resultado = await useSorteos().verificacion(props.sorteo.id)
    if (resultado.ok) {
        try {
            comprobacion.value = await comprobarSorteo(resultado.data)
        }
        catch {
            problemaComprobacion.value = { type: 'about:blank', title: 'No se pudo recalcular', status: 0, detail: 'La semilla publicada no es hexadecimal válido.' }
        }
    }
    else {
        problemaComprobacion.value = resultado.problema
    }
    comprobando.value = false
}

function premio(ganador: GanadorSorteo): PremioSorteo | null {
    return premioDeGanador(props.sorteo, ganador)
}

watch(() => props.sorteo.ganadores, (ganadores) => {
    void nombres.cargar(ganadores.map(g => g.cliente_id))
    comprobacion.value = null
}, { immediate: true })
</script>

<template>
    <div class="flex flex-col gap-4">
        <section
            class="flex flex-col gap-2"
            aria-label="Titulares"
        >
            <h4 class="text-sm font-semibold text-highlighted">
                Titulares
            </h4>
            <ul class="flex flex-col divide-y divide-default rounded-lg border border-default">
                <li
                    v-for="ganador in titulares"
                    :key="ganador.id"
                    class="flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:justify-between"
                    :data-ganador="ganador.posicion"
                >
                    <div class="flex min-w-0 items-start gap-3">
                        <span class="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">{{ ganador.posicion }}</span>
                        <div class="flex min-w-0 flex-col">
                            <ULink
                                v-if="enlace(`/clientes/${ganador.cliente_id}`)"
                                :to="enlace(`/clientes/${ganador.cliente_id}`)"
                                class="text-sm font-medium text-highlighted hover:text-primary"
                            >
                                {{ nombres.nombre(ganador.cliente_id) }}
                            </ULink>
                            <span
                                v-else
                                class="text-sm font-medium text-highlighted"
                            >{{ nombres.nombre(ganador.cliente_id) }}</span>
                            <span class="text-xs text-muted">
                                <span class="font-mono">{{ ganador.codigo_publico }}</span>
                                <template v-if="premio(ganador)">
                                    · {{ premio(ganador)?.nombre }} ({{ TIPOS_PREMIO_SORTEO[premio(ganador)?.tipo ?? 'efectivo'].etiqueta.toLowerCase() }})
                                </template>
                            </span>
                            <span
                                v-if="ganador.estado === 'entregado'"
                                class="text-xs text-muted"
                                data-prueba="ganador-entrega"
                            >
                                {{ contrapartidaLegible(ganador.contrapartida) }}<template v-if="ganador.retencion_isr && ganador.retencion_isr !== '0.00'">
                                    · ISR {{ formatearQuetzales(ganador.retencion_isr) }}
                                </template><template v-if="ganador.entregado_en">
                                    · {{ formatearFechaHora(ganador.entregado_en) }}
                                </template>
                            </span>
                        </div>
                    </div>
                    <div class="flex items-center gap-2 self-start sm:self-center">
                        <UBadge
                            :label="ESTADOS_GANADOR[ganador.estado].etiqueta"
                            :color="ESTADOS_GANADOR[ganador.estado].color"
                            variant="subtle"
                            data-prueba="ganador-estado"
                        />
                        <UButton
                            v-if="puedeEntregar && (ganador.estado === 'por_notificar' || ganador.estado === 'notificado')"
                            label="Entregar"
                            icon="i-lucide-gift"
                            size="sm"
                            :aria-label="`Entregar el premio a ${nombres.nombre(ganador.cliente_id)}`"
                            data-prueba="entregar-premio"
                            @click="emit('entregar', ganador)"
                        />
                    </div>
                </li>
            </ul>
        </section>

        <section
            v-if="suplentes.length"
            class="flex flex-col gap-2"
            aria-label="Suplentes"
        >
            <h4 class="text-sm font-semibold text-highlighted">
                Suplentes
            </h4>
            <ol class="flex flex-col divide-y divide-default rounded-lg border border-default">
                <li
                    v-for="ganador in suplentes"
                    :key="ganador.id"
                    class="flex items-center justify-between gap-2 p-3"
                    :data-suplente="ganador.posicion"
                >
                    <span class="min-w-0 text-sm">
                        <span class="text-muted">{{ ganador.posicion }}.</span>
                        {{ nombres.nombre(ganador.cliente_id) }}
                        <span class="font-mono text-xs text-muted">{{ ganador.codigo_publico }}</span>
                    </span>
                    <UBadge
                        :label="ESTADOS_GANADOR[ganador.estado].etiqueta"
                        :color="ESTADOS_GANADOR[ganador.estado].color"
                        variant="subtle"
                        size="sm"
                    />
                </li>
            </ol>
        </section>

        <section
            class="flex flex-col gap-3 rounded-lg border border-default p-3"
            aria-label="Verificación"
            data-prueba="sorteo-verificacion"
        >
            <div class="flex flex-wrap items-center justify-between gap-2">
                <h4 class="text-sm font-semibold text-highlighted">
                    Verificación pública
                </h4>
                <div class="flex flex-wrap gap-2">
                    <UButton
                        :to="urlVerificacion"
                        target="_blank"
                        rel="noopener"
                        label="Abrir verificación"
                        icon="i-lucide-external-link"
                        color="neutral"
                        variant="outline"
                        size="sm"
                        data-prueba="enlace-verificacion"
                    />
                    <UButton
                        label="Comprobar resultado"
                        icon="i-lucide-shield-check"
                        color="neutral"
                        variant="outline"
                        size="sm"
                        :loading="comprobando"
                        data-prueba="comprobar-sorteo"
                        @click="comprobar"
                    />
                </div>
            </div>
            <dl class="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <DatoFicha
                    etiqueta="Valor público del acto"
                    :valor="sorteo.valor_publico"
                    data-prueba="valor-publico-resultado"
                />
                <DatoFicha
                    etiqueta="Algoritmo"
                    :valor="sorteo.algoritmo"
                    mono
                    class="min-w-0 [&_dd]:break-all"
                />
                <DatoFicha
                    etiqueta="Semilla revelada"
                    :valor="sorteo.semilla"
                    mono
                    class="min-w-0 [&_dd]:break-all"
                />
                <DatoFicha
                    etiqueta="Compromiso (SHA-256 de la semilla)"
                    :valor="sorteo.compromiso"
                    mono
                    class="min-w-0 [&_dd]:break-all"
                />
                <DatoFicha
                    etiqueta="Hash de las bases"
                    :valor="sorteo.bases_hash"
                    mono
                    class="min-w-0 [&_dd]:break-all"
                />
                <DatoFicha
                    etiqueta="Hash de la lista"
                    :valor="sorteo.lista_hash"
                    mono
                    class="min-w-0 [&_dd]:break-all"
                />
            </dl>
            <p class="text-xs text-muted break-all">
                Cualquiera puede repetir el cálculo con <span class="font-mono">scripts/verificar-sorteo.mjs</span> y los datos de
                <span class="font-mono">{{ urlVerificacion }}</span>.
            </p>
            <ProblemaAlerta
                v-if="problemaComprobacion"
                :problema="problemaComprobacion"
                :reintentar="comprobar"
                :reintentando="comprobando"
            />
            <UAlert
                v-else-if="comprobacion"
                :color="comprobado ? 'success' : 'error'"
                variant="subtle"
                :icon="comprobado ? 'i-lucide-shield-check' : 'i-lucide-shield-alert'"
                :title="comprobado ? 'El resultado se reproduce' : 'El resultado no coincide'"
                data-prueba="resultado-comprobacion"
            >
                <template #description>
                    <ul class="flex flex-col gap-0.5">
                        <li>{{ comprobacion.compromiso ? '✓' : '✗' }} La semilla revelada corresponde al compromiso publicado con las bases.</li>
                        <li>{{ comprobacion.bases ? '✓' : '✗' }} Las bases publicadas tienen el hash registrado.</li>
                        <li>{{ comprobacion.lista ? '✓' : '✗' }} La lista del corte tiene el hash registrado.</li>
                        <li>{{ comprobacion.ganadores ? '✓' : '✗' }} Recalculado: {{ comprobacion.elegidos.join(', ') || 'ninguno' }}.</li>
                    </ul>
                </template>
            </UAlert>
        </section>
    </div>
</template>
