<script setup lang="ts">
/**
 * Página pública de un sorteo (contrato `lealtad.md` §7 y §12): sin sesión, desde que el panel
 * publica sus bases. Bases, premios, fechas, el compromiso de la semilla y, al terminar, los
 * ganadores por seudónimo y los datos para recalcular el resultado. Nunca datos de nadie.
 */
const route = useRoute()
const id = computed(() => {
    const valor = Number(route.params.id)
    return Number.isSafeInteger(valor) && valor > 0 ? valor : 0
})
const { sorteo, problema, cargando, recargar } = useSorteoPublico(id)

useHead({ title: computed(() => sorteo.value ? `Sorteo ${sorteo.value.nombre} · ${sorteo.value.empresa.nombre_comercial}` : 'Sorteo') })

const noExiste = computed(() => problema.value?.status === 404 || id.value === 0)
const urlVerificacion = computed(() => `/api/v1/portal/sorteos/${id.value}/verificacion`)

const bases = computed(() => {
    const b = sorteo.value?.bases
    if (!b) {
        return []
    }
    return [
        { titulo: 'Cómo participas', texto: b.regla_participacion, prueba: 'base-participacion' },
        { titulo: 'Mecánica del sorteo', texto: b.mecanica, prueba: 'base-mecanica' },
        { titulo: 'Plazo para reclamar', texto: b.plazo_reclamo_dias ? `${b.plazo_reclamo_dias} días después del sorteo` : null, prueba: 'base-plazo' },
        { titulo: 'Premios no reclamados', texto: b.no_reclamados, prueba: 'base-no-reclamados' },
        { titulo: 'Publicación de resultados', texto: b.publicacion_resultados, prueba: 'base-publicacion' },
        { titulo: 'Autorización de la Gobernación', texto: b.resolucion_gobernacion, prueba: 'base-resolucion' },
    ].filter(item => item.texto)
})
</script>

<template>
    <div
        class="flex flex-col gap-5"
        data-testid="sorteo-publico"
    >
        <template v-if="cargando && !sorteo && !problema">
            <USkeleton class="h-16 w-full" />
            <USkeleton class="h-40 w-full" />
        </template>

        <UAlert
            v-else-if="noExiste"
            color="neutral"
            variant="subtle"
            icon="i-lucide-search-x"
            title="No encontramos este sorteo"
            description="El sorteo no existe o todavía no publica sus bases."
            :actions="[{ label: 'Ir al inicio', icon: 'i-lucide-house', color: 'neutral', variant: 'outline', to: '/' }]"
            data-testid="sorteo-no-existe"
        />

        <UAlert
            v-else-if="problema"
            color="error"
            variant="subtle"
            icon="i-lucide-cloud-off"
            title="No pudimos cargar el sorteo"
            :description="mensajeProblema(problema)"
            :actions="[{ label: 'Reintentar', icon: 'i-lucide-refresh-cw', color: 'error', variant: 'outline', onClick: () => recargar() }]"
            data-testid="sorteo-error"
        />

        <template v-else-if="sorteo">
            <header class="flex flex-col gap-2">
                <p class="text-sm text-muted">
                    Sorteo de {{ sorteo.empresa.nombre_comercial }}
                </p>
                <h1 class="text-2xl font-semibold text-balance text-highlighted">
                    {{ sorteo.nombre }}
                </h1>
                <UBadge
                    :label="ESTADOS_SORTEO[sorteo.estado].etiqueta"
                    :color="ESTADOS_SORTEO[sorteo.estado].color"
                    :icon="ESTADOS_SORTEO[sorteo.estado].icono"
                    variant="subtle"
                    class="self-start"
                    data-testid="estado-sorteo"
                />
                <p
                    v-if="sorteo.descripcion"
                    class="text-sm text-default"
                >
                    {{ sorteo.descripcion }}
                </p>
            </header>

            <UAlert
                v-if="sorteo.estado === 'cancelado'"
                color="error"
                variant="subtle"
                icon="i-lucide-circle-x"
                title="Este sorteo se canceló"
                :description="sorteo.motivo_cancelacion ?? undefined"
            />

            <UCard :ui="{ body: 'p-4 sm:p-5' }">
                <dl class="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
                    <div>
                        <dt class="text-muted">
                            Fecha del sorteo
                        </dt>
                        <dd class="font-medium text-highlighted">
                            {{ fechaHoraSorteo(sorteo.fecha_sorteo) }}
                        </dd>
                    </div>
                    <div v-if="sorteo.lugar">
                        <dt class="text-muted">
                            Lugar
                        </dt>
                        <dd class="font-medium text-highlighted">
                            {{ sorteo.lugar }}
                        </dd>
                    </div>
                    <div v-if="sorteo.inscripcion_desde">
                        <dt class="text-muted">
                            Participación desde
                        </dt>
                        <dd class="font-medium text-highlighted">
                            {{ formatearFecha(sorteo.inscripcion_desde) }}
                        </dd>
                    </div>
                    <div v-if="sorteo.corte_en">
                        <dt class="text-muted">
                            Cierre de la lista
                        </dt>
                        <dd class="font-medium text-highlighted">
                            {{ fechaHoraSorteo(sorteo.corte_en) }}
                        </dd>
                    </div>
                </dl>
            </UCard>

            <section
                class="flex flex-col gap-3"
                aria-labelledby="titulo-premios"
            >
                <h2
                    id="titulo-premios"
                    class="text-lg font-semibold text-highlighted"
                >
                    Premios
                </h2>
                <SorteoPremios
                    :premios="sorteo.premios"
                    con-valor
                />
            </section>

            <section
                v-if="sorteo.ganadores"
                class="flex flex-col gap-3"
                aria-labelledby="titulo-ganadores"
            >
                <h2
                    id="titulo-ganadores"
                    class="text-lg font-semibold text-highlighted"
                >
                    Ganadores
                </h2>
                <p class="text-sm text-muted">
                    Por seudónimo: cada participante conoce el suyo en su cuenta.
                </p>
                <SorteoGanadores
                    :ganadores="sorteo.ganadores"
                    :premios="sorteo.premios"
                />
            </section>

            <section
                class="flex flex-col gap-3"
                aria-labelledby="titulo-bases"
            >
                <h2
                    id="titulo-bases"
                    class="text-lg font-semibold text-highlighted"
                >
                    Bases
                </h2>
                <UCard :ui="{ body: 'p-0 sm:p-0' }">
                    <dl class="divide-y divide-default">
                        <div
                            v-for="base in bases"
                            :key="base.prueba"
                            class="px-4 py-3"
                            :data-testid="base.prueba"
                        >
                            <dt class="text-sm font-medium text-highlighted">
                                {{ base.titulo }}
                            </dt>
                            <dd class="mt-0.5 text-sm whitespace-pre-line text-muted">
                                {{ base.texto }}
                            </dd>
                        </div>
                    </dl>
                </UCard>
            </section>

            <section
                class="flex flex-col gap-3"
                aria-labelledby="titulo-verificacion"
                data-testid="verificacion"
            >
                <h2
                    id="titulo-verificacion"
                    class="text-lg font-semibold text-highlighted"
                >
                    Verificación
                </h2>
                <p class="text-sm text-muted">
                    Las bases y la semilla del sorteo quedaron comprometidas antes de cerrar la lista. Al terminar,
                    cualquiera puede recalcular el resultado con los datos publicados (algoritmo argos-sorteo-v1).
                </p>
                <UCard :ui="{ body: 'flex flex-col gap-3 p-4 sm:p-5' }">
                    <div>
                        <p class="text-xs text-muted">
                            Huella de las bases (SHA-256)
                        </p>
                        <p
                            class="font-mono text-xs break-all text-highlighted"
                            data-testid="bases-hash"
                        >
                            {{ sorteo.bases_hash }}
                        </p>
                    </div>
                    <div v-if="sorteo.compromiso">
                        <p class="text-xs text-muted">
                            Compromiso de la semilla (SHA-256)
                        </p>
                        <p
                            class="font-mono text-xs break-all text-highlighted"
                            data-testid="compromiso"
                        >
                            {{ sorteo.compromiso }}
                        </p>
                    </div>
                    <UButton
                        v-if="sorteo.verificable"
                        label="Descargar datos de verificación (JSON)"
                        icon="i-lucide-download"
                        :to="urlVerificacion"
                        external
                        download
                        color="neutral"
                        variant="outline"
                        block
                        data-testid="descargar-verificacion"
                    />
                    <p
                        v-else
                        class="text-sm text-muted"
                    >
                        Los datos para recalcular el resultado se publican aquí después del sorteo.
                    </p>
                </UCard>
            </section>
        </template>
    </div>
</template>
