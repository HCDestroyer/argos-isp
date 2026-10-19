<script setup lang="ts">
/**
 * Un sorteo en la cuenta del cliente: estado, fechas, premios con imagen, cómo se participa (de las
 * bases), sus boletos y su seudónimo y, al terminar, los ganadores por seudónimo. Enlace a la página
 * pública de bases y verificación.
 */
const props = defineProps<{
    sorteo: SorteoPortal
}>()

const terminado = computed(() => sorteoTerminado(props.sorteo.estado))
const gane = computed(() => Boolean(props.sorteo.mi_codigo && props.sorteo.ganadores?.some(g => g.codigo === props.sorteo.mi_codigo && g.tipo === 'titular')))
</script>

<template>
    <UCard
        as="article"
        :ui="{ body: 'flex flex-col gap-4 p-4 sm:p-5' }"
        :data-testid="`sorteo-${props.sorteo.id}`"
    >
        <div class="flex flex-wrap items-start justify-between gap-2">
            <div class="min-w-0">
                <h3 class="text-base font-semibold text-highlighted">
                    {{ props.sorteo.nombre }}
                </h3>
                <p
                    v-if="props.sorteo.descripcion"
                    class="text-sm text-muted"
                >
                    {{ props.sorteo.descripcion }}
                </p>
            </div>
            <UBadge
                :label="ESTADOS_SORTEO[props.sorteo.estado].etiqueta"
                :color="ESTADOS_SORTEO[props.sorteo.estado].color"
                :icon="ESTADOS_SORTEO[props.sorteo.estado].icono"
                variant="subtle"
                data-testid="estado-sorteo"
            />
        </div>

        <UAlert
            v-if="gane"
            color="success"
            variant="subtle"
            icon="i-lucide-party-popper"
            title="¡Ganaste en este sorteo!"
            description="Te contactaremos para entregarte tu premio. También puedes llamarnos."
            data-testid="ganaste"
        />

        <div
            class="grid grid-cols-2 gap-3"
            data-testid="mis-boletos"
        >
            <div class="rounded-lg bg-elevated/60 p-3">
                <p class="text-xs text-muted">
                    Tus boletos
                </p>
                <p class="text-2xl font-semibold tabular-nums text-highlighted">
                    {{ formatearPuntos(props.sorteo.mis_boletos) }}
                </p>
            </div>
            <div class="rounded-lg bg-elevated/60 p-3">
                <p class="text-xs text-muted">
                    Tu seudónimo
                </p>
                <p
                    :class="props.sorteo.mi_codigo ? 'font-mono text-base font-semibold break-all text-highlighted' : 'text-sm text-muted'"
                    data-testid="mi-codigo"
                >
                    {{ props.sorteo.mi_codigo ?? 'Al cerrar la lista' }}
                </p>
            </div>
        </div>
        <p
            v-if="props.sorteo.mi_codigo"
            class="-mt-2 text-xs text-muted"
        >
            Así apareces en la lista pública y en los resultados: nunca con tu nombre.
        </p>

        <ul class="space-y-1 text-sm text-muted">
            <li class="flex items-center gap-1.5">
                <UIcon
                    name="i-lucide-calendar"
                    class="size-4 shrink-0"
                />
                Se sortea el {{ fechaHoraSorteo(props.sorteo.fecha_sorteo) }}<template v-if="props.sorteo.lugar">
                    en {{ props.sorteo.lugar }}
                </template>
            </li>
            <li
                v-if="props.sorteo.corte_en && !terminado"
                class="flex items-center gap-1.5"
            >
                <UIcon
                    name="i-lucide-hourglass"
                    class="size-4 shrink-0"
                />
                La lista se cierra el {{ fechaHoraSorteo(props.sorteo.corte_en) }}
            </li>
        </ul>

        <section
            v-if="props.sorteo.regla_participacion"
            class="space-y-1"
        >
            <h4 class="text-sm font-semibold text-highlighted">
                Cómo participas
            </h4>
            <p
                class="text-sm whitespace-pre-line text-default"
                data-testid="regla-participacion"
            >
                {{ props.sorteo.regla_participacion }}
            </p>
        </section>

        <section class="space-y-2">
            <h4 class="text-sm font-semibold text-highlighted">
                Premios
            </h4>
            <SorteoPremios :premios="props.sorteo.premios" />
        </section>

        <section
            v-if="props.sorteo.ganadores"
            class="space-y-2"
        >
            <h4 class="text-sm font-semibold text-highlighted">
                Ganadores
            </h4>
            <SorteoGanadores
                :ganadores="props.sorteo.ganadores"
                :premios="props.sorteo.premios"
                :mi-codigo="props.sorteo.mi_codigo"
            />
        </section>

        <UButton
            :label="terminado ? 'Bases, resultado y verificación' : 'Ver las bases del sorteo'"
            :to="rutaSorteoPublico(props.sorteo.id)"
            icon="i-lucide-scroll-text"
            color="neutral"
            variant="outline"
            block
            data-testid="enlace-bases"
        />
    </UCard>
</template>
