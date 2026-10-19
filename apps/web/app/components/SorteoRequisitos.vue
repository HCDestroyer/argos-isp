<script setup lang="ts">
/**
 * Checklist legal del sorteo (§8), agrupado por el paso que lo exige, con su fuente, evidencia y el
 * aviso "Referencia; valídelo con su contador o abogado". «Marcar» solo si la pantalla lo permite
 * (`sorteos.marcar_requisito`, decide quien lo abre) y el sorteo no está cancelado.
 */
const props = defineProps<{
    requisitos: RequisitoSorteo[]
    /** Quien lo abre ya comprobó `sorteos.marcar_requisito` y el estado del sorteo. */
    puedeMarcar: boolean
    /** Requisitos que el siguiente paso exige y faltan (se resaltan). */
    faltantes: RequisitoSorteo['clave'][]
}>()

const emit = defineEmits<{
    marcar: [requisito: RequisitoSorteo]
}>()

const grupos = computed(() => (Object.keys(PASOS_REQUISITO) as PasoRequisito[])
    .map(paso => ({
        paso,
        titulo: PASOS_REQUISITO[paso],
        filas: props.requisitos.filter(r => REQUISITOS_SORTEO[r.clave]?.para === paso),
    }))
    .filter(g => g.filas.length > 0))
</script>

<template>
    <div class="flex flex-col gap-4">
        <UAlert
            color="neutral"
            variant="subtle"
            icon="i-lucide-scale"
            :description="AVISO_REQUISITOS"
        />
        <section
            v-for="grupo in grupos"
            :key="grupo.paso"
            class="flex flex-col gap-2"
        >
            <h4 class="text-xs font-semibold uppercase tracking-wide text-muted">
                {{ grupo.titulo }}
            </h4>
            <ul class="flex flex-col divide-y divide-default rounded-lg border border-default">
                <li
                    v-for="requisito in grupo.filas"
                    :key="requisito.clave"
                    class="flex flex-col gap-2 p-3 sm:flex-row sm:items-start sm:justify-between"
                    :class="{ 'bg-warning/5': faltantes.includes(requisito.clave) }"
                    :data-requisito="requisito.clave"
                >
                    <div class="flex min-w-0 flex-col gap-1">
                        <div class="flex flex-wrap items-center gap-2">
                            <span class="text-sm font-medium text-highlighted">{{ REQUISITOS_SORTEO[requisito.clave].etiqueta }}</span>
                            <UBadge
                                :label="ESTADOS_REQUISITO[requisito.estado].etiqueta"
                                :icon="ESTADOS_REQUISITO[requisito.estado].icono"
                                :color="ESTADOS_REQUISITO[requisito.estado].color"
                                variant="subtle"
                                size="sm"
                                data-prueba="requisito-estado"
                            />
                            <UBadge
                                v-if="REQUISITOS_SORTEO[requisito.clave].noBloquea"
                                label="No bloquea la ejecución"
                                color="neutral"
                                variant="outline"
                                size="sm"
                                data-prueba="requisito-no-bloquea"
                            />
                            <UBadge
                                v-if="faltantes.includes(requisito.clave)"
                                label="Falta para el siguiente paso"
                                color="warning"
                                variant="outline"
                                size="sm"
                            />
                        </div>
                        <p class="text-xs text-muted">
                            {{ REQUISITOS_SORTEO[requisito.clave].requisito }} <span class="text-dimmed">Fuente: {{ REQUISITOS_SORTEO[requisito.clave].fuente }}.</span>
                        </p>
                        <p
                            v-if="requisito.valor || requisito.evidencia"
                            class="text-xs text-default"
                        >
                            <template v-if="requisito.valor">
                                {{ requisito.valor }}
                            </template>
                            <template v-if="requisito.valor && requisito.evidencia">
                                ·
                            </template>
                            <span
                                v-if="requisito.evidencia"
                                class="text-muted"
                            >Evidencia: {{ requisito.evidencia }}</span>
                        </p>
                        <p
                            v-if="requisito.marcado_en"
                            class="text-xs text-dimmed"
                        >
                            Marcado el {{ formatearFechaHora(requisito.marcado_en) }}<template v-if="requisito.nota">
                                · {{ requisito.nota }}
                            </template>
                        </p>
                    </div>
                    <UButton
                        v-if="puedeMarcar"
                        :label="requisito.estado === 'pendiente' ? 'Marcar' : 'Cambiar'"
                        icon="i-lucide-check-square"
                        color="neutral"
                        variant="outline"
                        size="sm"
                        class="self-start"
                        :aria-label="`Marcar ${REQUISITOS_SORTEO[requisito.clave].etiqueta}`"
                        data-prueba="marcar-requisito"
                        @click="emit('marcar', requisito)"
                    />
                </li>
            </ul>
        </section>
    </div>
</template>
