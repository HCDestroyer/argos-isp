<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'

/**
 * Plan elegido en la lista de planes (tablero RedPlanes, panel derecho): precio, bajada y subida,
 * reuso, garantizado, limitado en mora, lo que recibe el router (lo calcula la API con
 * `POST /planes/vista-previa`, nunca el panel) y dónde se ofrece; abajo «Sincronizar» y «Editar».
 */
const props = withDefaults(defineProps<{
    plan: Plan
    routerNombres: Map<number, string>
    sinEncabezado?: boolean
}>(), {
    sinEncabezado: false,
})

const emit = defineEmits<{
    sincronizar: []
}>()

const { puede, enlace } = usePermisos()

const vista = shallowRef<VistaPreviaVelocidad | null>(null)
const problema = ref<Problem | null>(null)
const cargando = ref(false)

async function calcular() {
    const cuerpo = cuerpoVistaPrevia(entradaDesdePlan(props.plan), null)
    if (!cuerpo) {
        vista.value = null
        return
    }
    cargando.value = true
    const resultado = await usePlanes().vistaPrevia(cuerpo)
    cargando.value = false
    vista.value = resultado.ok ? resultado.data : null
    problema.value = resultado.ok ? null : resultado.problema
}

watch(() => [props.plan.id, props.plan.version], () => void calcular(), { immediate: true })

const garantizado = computed(() => {
    const pct = props.plan.garantizado_pct ?? (props.plan.reuso ? 100 / props.plan.reuso : null)
    return pct === null ? '—' : `${Math.round(Number(pct) * 10) / 10} %`
})
</script>

<template>
    <div class="flex flex-col">
        <div
            v-if="!sinEncabezado"
            class="flex flex-col gap-1 border-b border-(--ax-borde) p-4"
        >
            <div class="flex items-center justify-between gap-2">
                <span class="truncate text-lg font-bold text-highlighted">{{ plan.nombre }}</span>
                <TipoPlanBadge :tipo="plan.tipo" />
            </div>
            <span class="text-2xl font-bold text-highlighted">{{ formatearQuetzales(plan.precio) }} <span class="text-sm font-normal text-muted">al mes</span></span>
        </div>
        <span
            v-else
            class="mb-3 text-2xl font-bold text-highlighted"
        >{{ formatearQuetzales(plan.precio) }} <span class="text-sm font-normal text-muted">al mes</span></span>
        <div class="flex flex-col gap-3 p-4">
            <div class="grid grid-cols-2 gap-2">
                <div class="rounded-xl bg-(--ax-panel) px-3 py-2">
                    <span class="flex items-center gap-1 text-xs text-muted"><UIcon
                        name="i-lucide-arrow-down"
                        class="size-3.5"
                    />Bajada</span>
                    <span class="text-lg font-bold text-highlighted">{{ formatearVelocidad(plan.bajada_kbps) }}</span>
                </div>
                <div class="rounded-xl bg-(--ax-panel) px-3 py-2">
                    <span class="flex items-center gap-1 text-xs text-muted"><UIcon
                        name="i-lucide-arrow-up"
                        class="size-3.5"
                    />Subida</span>
                    <span class="text-lg font-bold text-highlighted">{{ formatearVelocidad(plan.subida_kbps) }}</span>
                </div>
            </div>
            <dl>
                <RedFila
                    etiqueta="Reuso"
                    :valor="`1:${plan.reuso}`"
                />
                <RedFila
                    etiqueta="Garantizado"
                    :valor="garantizado"
                />
                <RedFila
                    etiqueta="Limitado (mora)"
                    :valor="`${formatearVelocidad(plan.bajada_limitada_kbps)} / ${formatearVelocidad(plan.subida_limitada_kbps)}`"
                />
                <RedFila
                    etiqueta="Prioridad"
                    :valor="String(plan.prioridad)"
                />
            </dl>
            <div class="flex flex-col gap-1">
                <span class="text-xs font-semibold tracking-[0.06em] text-muted uppercase">Así lo recibe el router</span>
                <ProblemaAlerta
                    v-if="problema"
                    :problema="problema"
                    :reintentar="calcular"
                />
                <USkeleton
                    v-else-if="cargando || !vista"
                    class="h-10 w-full"
                />
                <code
                    v-else
                    class="block rounded-lg bg-(--ax-panel) px-3 py-2 font-mono text-xs break-all text-highlighted"
                    data-prueba="detalle-rate-limit"
                >{{ vista.rate_limit }}</code>
            </div>
            <div class="flex flex-col gap-1">
                <span class="text-xs font-semibold tracking-[0.06em] text-muted uppercase">Dónde se ofrece</span>
                <span
                    v-if="plan.global"
                    class="flex items-center gap-1.5 text-sm"
                ><UIcon
                    name="i-lucide-globe"
                    class="size-4 text-success"
                />Todos los routers</span>
                <span
                    v-for="id in plan.global ? [] : (plan.routers ?? [])"
                    :key="id"
                    class="flex items-center gap-1.5 text-sm"
                ><UIcon
                    name="i-lucide-router"
                    class="size-4 text-primary"
                />{{ routerNombres.get(id) ?? `Router ${id}` }}</span>
                <span
                    v-if="!plan.global && plan.routers && !plan.routers.length"
                    class="text-sm text-muted"
                >En ningún router todavía</span>
                <span
                    v-else-if="!plan.global && !plan.routers"
                    class="text-sm text-muted"
                >—</span>
            </div>
        </div>
        <div class="mt-auto flex gap-2 border-t border-(--ax-borde) p-4">
            <UButton
                v-if="puede('planes.sincronizar')"
                label="Sincronizar"
                icon="i-lucide-refresh-cw"
                color="neutral"
                variant="outline"
                class="flex-1 justify-center rounded-full"
                data-prueba="sincronizar-plan"
                @click="emit('sincronizar')"
            />
            <UButton
                v-if="puede('planes.editar')"
                :to="`/planes/${plan.id}/editar`"
                label="Editar"
                :icon="ICONOS.editar"
                class="flex-1 justify-center rounded-full"
                data-prueba="editar-plan"
            />
            <UButton
                v-else
                :to="enlace(`/planes/${plan.id}`)"
                label="Abrir"
                color="neutral"
                variant="outline"
                class="flex-1 justify-center rounded-full"
            />
        </div>
    </div>
</template>
