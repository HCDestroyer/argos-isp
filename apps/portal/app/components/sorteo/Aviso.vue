<script setup lang="ts">
/**
 * Aviso de un sorteo próximo en el carrusel de promociones (inicio y página de corte). Sin imagen
 * (en la página de corte solo se alcanza el walled garden) ni datos de nadie: nombre, premio
 * principal, fechas y el enlace a las bases. Con la sesión, además «Ver mis boletos».
 */
const props = defineProps<{
    aviso: AvisoSorteo
    /** "2 de 3": para lectores de pantalla dentro del carrusel */
    posicion?: string
    conSesion?: boolean
}>()

const etiqueta = computed(() => props.posicion ? `${props.posicion}: sorteo ${props.aviso.nombre}` : `Sorteo ${props.aviso.nombre}`)
</script>

<template>
    <UCard
        as="article"
        class="h-full overflow-hidden"
        :ui="{ body: 'flex h-full flex-col p-0 sm:p-0' }"
        :aria-label="etiqueta"
        data-testid="aviso-sorteo"
    >
        <div class="flex items-center gap-3 bg-primary/10 px-4 py-5">
            <div class="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-primary text-inverted">
                <UIcon
                    name="i-lucide-ticket"
                    class="size-6"
                />
            </div>
            <div class="min-w-0">
                <p class="text-xs font-medium text-primary">
                    Sorteo · {{ ESTADOS_SORTEO[props.aviso.estado].etiqueta }}
                </p>
                <h3 class="text-base font-semibold text-balance text-highlighted">
                    {{ props.aviso.nombre }}
                </h3>
            </div>
        </div>
        <div class="flex flex-1 flex-col gap-2 p-4">
            <p
                v-if="props.aviso.premio_principal"
                class="text-sm text-default"
            >
                <span class="font-medium">Gran premio:</span> {{ props.aviso.premio_principal }}<template v-if="props.aviso.premios > 1">
                    · {{ props.aviso.premios }} premios en total
                </template>
            </p>
            <ul class="space-y-1 text-sm text-muted">
                <li class="flex items-center gap-1.5">
                    <UIcon
                        name="i-lucide-calendar"
                        class="size-4 shrink-0"
                    />
                    Se sortea el {{ fechaHoraSorteo(props.aviso.fecha_sorteo) }}
                </li>
                <li
                    v-if="props.aviso.corte_en"
                    class="flex items-center gap-1.5"
                >
                    <UIcon
                        name="i-lucide-hourglass"
                        class="size-4 shrink-0"
                    />
                    Ganas boletos hasta el {{ fechaHoraSorteo(props.aviso.corte_en) }}
                </li>
            </ul>
            <div class="mt-auto flex flex-wrap gap-2 pt-1">
                <UButton
                    v-if="props.conSesion"
                    label="Ver mis boletos"
                    to="/cuenta?seccion=sorteos"
                    trailing-icon="i-lucide-arrow-right"
                    color="primary"
                    variant="soft"
                    data-testid="aviso-sorteo-boletos"
                />
                <UButton
                    label="Bases del sorteo"
                    :to="rutaSorteoPublico(props.aviso.id)"
                    icon="i-lucide-scroll-text"
                    color="neutral"
                    variant="ghost"
                    data-testid="aviso-sorteo-bases"
                />
            </div>
        </div>
    </UCard>
</template>
