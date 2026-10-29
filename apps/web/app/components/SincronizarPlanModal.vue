<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { TableColumn } from '@nuxt/ui'
import type { SincronizacionPlan } from '~/types/controlVelocidad'

/**
 * «Sincronizar plan» (`POST /planes/:id/sincronizar?router_id=`, `planes.sincronizar`,
 * `contratos/control-velocidad.md` §5): aplica la velocidad vigente del plan a las sesiones PPPoE
 * abiertas por CoA (sin desconectar a nadie) y reconcilia las colas del plan en cada router. Al
 * terminar, el resumen por router; un router con error se reintenta solo.
 */
const props = withDefaults(defineProps<{
    plan: Plan
    /** Un router (desde su implementación) o null = todos los routers del plan. */
    routerId?: number | null
    nombreRouter?: string | null
}>(), {
    routerId: null,
    nombreRouter: null,
})

const abierto = defineModel<boolean>('open', { default: false })

const resultado = shallowRef<SincronizacionPlan | null>(null)
const problema = ref<Problem | null>(null)
const sincronizando = ref(false)
const reintentando = ref<number | null>(null)

watch(abierto, (valor) => {
    if (valor) {
        resultado.value = null
        problema.value = null
    }
})

async function sincronizar(routerId: number | null = props.routerId) {
    if (routerId !== props.routerId) {
        reintentando.value = routerId
    }
    else {
        sincronizando.value = true
    }
    problema.value = null
    const respuesta = await useControlVelocidad().sincronizar(props.plan.id, routerId, nuevaClaveIdempotencia())
    sincronizando.value = false
    reintentando.value = null
    if (!respuesta.ok) {
        problema.value = respuesta.problema
        return
    }
    if (resultado.value && routerId !== props.routerId) {
        // Reintento de un router: se reemplaza su fila.
        const fila = respuesta.data.routers[0]
        resultado.value = { ...resultado.value, routers: resultado.value.routers.map(r => (fila && r.router_id === fila.router_id ? fila : r)) }
        return
    }
    resultado.value = respuesta.data
}

type FilaRouter = SincronizacionPlan['routers'][number]
const numero = { class: { th: 'text-right', td: 'text-right tabular-nums' } }
const columnas: TableColumn<FilaRouter>[] = [
    { accessorKey: 'nombre', header: 'Router' },
    { accessorKey: 'sesiones_actualizadas', header: 'Sesiones actualizadas', meta: numero },
    { accessorKey: 'colas_cambiadas', header: 'Colas cambiadas', meta: numero },
    { id: 'estado', header: 'Resultado' },
]

const conErrores = computed(() => resultado.value?.routers.filter(r => r.errores.length).length ?? 0)
</script>

<template>
    <UModal
        v-model:open="abierto"
        :title="`Sincronizar ${plan.nombre}`"
        :description="routerId ? `Solo en ${nombreRouter ?? `el router ${routerId}`}.` : 'En todos los routers donde está el plan.'"
        :dismissible="!sincronizando"
        :ui="{ content: 'sm:max-w-2xl' }"
    >
        <template #body>
            <div
                class="flex flex-col gap-4"
                data-prueba="sincronizar-plan-modal"
            >
                <template v-if="!resultado">
                    <p class="text-sm text-muted">
                        Aplica la velocidad que el plan tiene ahora (subida, bajada, ráfaga, reuso) a los clientes ya conectados, sin desconectarlos:
                    </p>
                    <ul class="flex list-disc flex-col gap-1 ps-5 text-sm">
                        <li>Las sesiones PPPoE abiertas reciben la velocidad nueva al instante (CoA).</li>
                        <li>Las colas del plan en cada router (padres, PCQ, árbol) se corrigen.</li>
                        <li>Los clientes que se conecten después ya entran con la velocidad nueva.</li>
                    </ul>
                    <p class="text-xs text-muted">
                        Al editar la velocidad del plan esto pasa solo; úsalo si un router estaba caído o cambiaste algo a mano.
                    </p>
                </template>

                <ProblemaAlerta
                    v-if="problema"
                    :problema="problema"
                    :reintentar="() => sincronizar()"
                    :reintentando="sincronizando"
                />

                <template v-if="resultado">
                    <UAlert
                        :color="conErrores ? 'warning' : 'success'"
                        variant="subtle"
                        :icon="conErrores ? 'i-lucide-triangle-alert' : 'i-lucide-circle-check'"
                        :title="conErrores ? `Sincronizado con ${conErrores === 1 ? 'un router con error' : `${conErrores} routers con error`}` : 'Plan sincronizado'"
                        :description="`${resultado.aaa_reescritos.toLocaleString('es-GT')} servicios con la velocidad nueva en RADIUS.`"
                        data-prueba="sincronizar-resumen"
                    />
                    <UTable
                        :data="resultado.routers"
                        :columns="columnas"
                        tabindex="0"
                        aria-label="Resultado por router"
                    >
                        <template #nombre-cell="{ row }">
                            <div
                                class="flex flex-col"
                                :data-router="row.original.router_id"
                            >
                                <span class="font-medium text-highlighted">{{ row.original.nombre }}</span>
                                <span class="text-xs text-muted">{{ row.original.servicios.toLocaleString('es-GT') }} servicios<template v-if="row.original.sesiones_sin_coa"> · {{ row.original.sesiones_sin_coa }} sin CoA</template></span>
                            </div>
                        </template>
                        <template #estado-cell="{ row }">
                            <div
                                v-if="row.original.errores.length"
                                class="flex flex-col items-start gap-1"
                            >
                                <UBadge
                                    label="Con error"
                                    icon="i-lucide-circle-x"
                                    color="error"
                                    variant="subtle"
                                    size="sm"
                                />
                                <span
                                    v-for="error in row.original.errores"
                                    :key="error"
                                    class="text-xs whitespace-normal text-error"
                                >{{ error }}</span>
                                <UButton
                                    label="Reintentar"
                                    icon="i-lucide-rotate-cw"
                                    color="neutral"
                                    variant="outline"
                                    size="xs"
                                    :loading="reintentando === row.original.router_id"
                                    :data-prueba="`reintentar-router-${row.original.router_id}`"
                                    @click="sincronizar(row.original.router_id)"
                                />
                            </div>
                            <UBadge
                                v-else
                                label="Al día"
                                icon="i-lucide-circle-check"
                                color="success"
                                variant="subtle"
                                size="sm"
                            />
                        </template>
                        <template #empty>
                            <UEmpty
                                icon="i-lucide-router"
                                title="El plan no está en ningún router"
                                variant="naked"
                            />
                        </template>
                    </UTable>
                </template>
            </div>
        </template>
        <template #footer>
            <div class="flex w-full justify-end gap-2">
                <UButton
                    :label="resultado ? 'Cerrar' : 'Cancelar'"
                    color="neutral"
                    variant="ghost"
                    :disabled="sincronizando"
                    @click="abierto = false"
                />
                <UButton
                    v-if="!resultado"
                    label="Sincronizar"
                    icon="i-lucide-refresh-cw"
                    :loading="sincronizando"
                    data-prueba="sincronizar-confirmar"
                    @click="sincronizar()"
                />
            </div>
        </template>
    </UModal>
</template>
