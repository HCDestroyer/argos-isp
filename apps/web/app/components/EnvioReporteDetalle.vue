<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'

/**
 * Detalle de un envío programado (tablero PendEnviosReportes, panel derecho): para quién (un correo
 * retirado se tacha con «Retirado de la lista»), las últimas corridas con el resultado de cada
 * destinatario y, abajo, pausar o reanudar y «Ver el reporte». En el teléfono va dentro de una hoja
 * a pantalla completa con las acciones fijas abajo.
 */
const props = withDefaults(defineProps<{
    envio: EnvioReporte
    corridas: CorridaEnvioReporte[] | null
    problemaCorridas: Problem | null
    cargandoCorridas: boolean
    puedeEditar: boolean
    cambiando: boolean
    /** Sin el encabezado (la hoja del teléfono ya pone el título). */
    sinEncabezado?: boolean
}>(), {
    sinEncabezado: false,
})

const emit = defineEmits<{ cambiarActivo: [activo: boolean], reintentarCorridas: [] }>()

const estado = computed(() => estadoEnvio(props.envio))
const formato = computed(() => FORMATO_ENVIO[props.envio.formato])
const proximo = computed(() => (props.envio.activo ? `${formatearFechaCorta(props.envio.proximo_en)} ${formatearHora(props.envio.proximo_en)}` : '—'))
const hayRetirados = computed(() => props.envio.destinatarios.some(d => d.retirado))
const rutaReporte = computed(() => rutaReporteEnvio(props.envio.reporte))

function nombreDestinatario(id: number): string {
    const d = props.envio.destinatarios.find(x => x.id === id)
    return (d?.tipo === 'usuario' ? d.nombre ?? d.correo : d?.correo ?? d?.nombre) ?? 'Destinatario quitado'
}

const COLOR_RESULTADO = { enviado: 'bg-success', omitido: 'bg-warning', fallido: 'bg-error' } as const
</script>

<template>
    <section
        class="flex min-h-0 min-w-0 flex-col"
        :data-envio-detalle="envio.id"
    >
        <header
            v-if="!sinEncabezado"
            class="border-b border-(--ax-borde) px-4 py-3.5"
        >
            <div class="flex items-center gap-2">
                <h2 class="min-w-0 flex-1 truncate text-lg font-semibold text-highlighted">
                    {{ envio.nombre }}
                </h2>
                <UBadge
                    :label="estado.etiqueta"
                    :icon="estado.icono"
                    :color="estado.color"
                    variant="subtle"
                    size="sm"
                />
            </div>
            <p class="mt-0.5 text-xs text-muted">
                {{ frecuenciaEnvio(envio) }} · {{ formato.etiqueta }} · próximo: {{ proximo }}
            </p>
        </header>
        <p
            v-else
            class="px-4 pt-3 text-xs text-muted"
        >
            {{ frecuenciaEnvio(envio) }} · {{ formato.etiqueta }} · próximo: {{ proximo }}
        </p>

        <div class="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto px-4 pt-2 pb-3">
            <h3 class="mt-1.5 mb-1 text-xs font-bold tracking-[0.06em] text-muted uppercase">
                Para quién
            </h3>
            <ul class="flex flex-col">
                <li
                    v-for="destino in envio.destinatarios"
                    :key="destino.id"
                    class="flex min-w-0 items-center justify-between gap-2 border-(--ax-borde) py-2 [&:not(:first-child)]:border-t"
                    :data-destinatario="destino.correo ?? destino.nombre ?? destino.id"
                >
                    <span class="flex min-w-0 items-center gap-2 text-sm">
                        <UIcon
                            :name="destino.tipo === 'usuario' ? 'i-lucide-user' : 'i-lucide-mail'"
                            class="size-4 shrink-0 text-muted"
                        />
                        <template v-if="destino.tipo === 'usuario'">
                            <b class="truncate text-highlighted">{{ destino.nombre ?? destino.correo ?? '—' }}</b>
                            <span class="truncate text-xs text-muted">usuario</span>
                        </template>
                        <span
                            v-else
                            class="truncate font-mono text-[0.8125rem]"
                            :class="destino.retirado ? 'text-dimmed line-through' : 'text-highlighted'"
                        >{{ destino.correo ?? destino.nombre ?? '—' }}</span>
                    </span>
                    <UBadge
                        :label="destino.retirado ? 'Retirado de la lista' : 'Recibe'"
                        :icon="destino.retirado ? 'i-lucide-triangle-alert' : undefined"
                        :color="destino.retirado ? 'warning' : 'success'"
                        variant="subtle"
                        size="sm"
                        class="shrink-0"
                    />
                </li>
            </ul>
            <UAlert
                v-if="hayRetirados"
                color="warning"
                variant="subtle"
                icon="i-lucide-triangle-alert"
                description="Un correo retirado deja de recibir; quítalo o pide al admin que lo vuelva a aprobar."
                class="mt-2"
            />

            <h3 class="mt-4 mb-0.5 text-xs font-bold tracking-[0.06em] text-muted uppercase">
                Últimas corridas
            </h3>
            <ProblemaAlerta
                v-if="problemaCorridas"
                :problema="problemaCorridas"
                :reintentar="() => emit('reintentarCorridas')"
                :reintentando="cargandoCorridas"
            />
            <USkeleton
                v-else-if="corridas === null"
                class="h-20 w-full"
            />
            <p
                v-else-if="!corridas.length"
                class="py-2 text-sm text-muted"
            >
                Todavía no ha corrido.
            </p>
            <ul
                v-else
                class="flex flex-col"
                data-prueba="corridas-envio"
            >
                <li
                    v-for="corrida in corridas"
                    :key="corrida.id"
                    class="border-t border-(--ax-borde) py-2.5"
                >
                    <div class="flex items-center gap-2">
                        <b class="text-sm text-highlighted">{{ formatearFechaCorta(corrida.programado_para) }} {{ formatearHora(corrida.programado_para) }}</b>
                        <span class="flex-1" />
                        <UBadge
                            :label="resumenCorridaEnvio(corrida).texto"
                            :color="resumenCorridaEnvio(corrida).color"
                            variant="subtle"
                            size="sm"
                        />
                    </div>
                    <p
                        v-for="resultado in corrida.resultados"
                        :key="resultado.destinatario_id"
                        class="mt-1 flex items-center gap-1.5 text-xs text-muted"
                    >
                        <span
                            class="size-1.5 shrink-0 rounded-full"
                            :class="COLOR_RESULTADO[resultado.estado]"
                        />
                        <span class="text-default">{{ nombreDestinatario(resultado.destinatario_id) }}</span>
                        <span>· {{ textoResultadoEnvio(resultado) }}</span>
                    </p>
                </li>
            </ul>
        </div>

        <PanelBarraAccion class="border-t border-(--ax-borde) px-4 py-3 lg:flex">
            <UButton
                v-if="puedeEditar"
                :label="envio.activo ? 'Pausar' : 'Reanudar'"
                :icon="envio.activo ? 'i-lucide-pause' : 'i-lucide-play'"
                color="neutral"
                variant="outline"
                size="sm"
                :loading="cambiando"
                data-prueba="envio-pausar"
                @click="emit('cambiarActivo', !envio.activo)"
            />
            <span class="flex-1" />
            <UButton
                v-if="rutaReporte"
                label="Ver el reporte"
                trailing-icon="i-lucide-arrow-right"
                color="primary"
                variant="link"
                size="sm"
                :to="rutaReporte"
            />
        </PanelBarraAccion>
    </section>
</template>
