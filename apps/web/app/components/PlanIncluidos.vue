<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { TableColumn } from '@nuxt/ui'

/**
 * Adicionales incluidos en un plan (`GET /planes/:id/adicionales`, `planes.ver`). Editar la lista
 * pide `planes.editar` y, para elegir del catálogo, `adicionales.ver`. Cambiarla no toca los
 * servicios que ya tienen el plan: aplica al próximo alta o cambio de plan.
 */
const props = defineProps<{
    plan: Plan
}>()

const emit = defineEmits<{
    /** La lista cambió: la versión del plan subió. */
    actualizado: []
}>()

const { puede } = usePermisos()
const toast = useToast()
const { conSelector: variasEmpresas, nombre: nombreEmpresa } = useEmpresaActiva()

const lista = shallowRef<AdicionalPlan[]>([])
const cargando = ref(false)
const problema = ref<Problem | null>(null)
const editando = ref(false)

const puedeEditar = computed(() => puede('planes.editar') && puede('adicionales.ver'))

const columnas = computed<TableColumn<AdicionalPlan>[]>(() => [
    { accessorKey: 'adicional_nombre', header: 'Adicional', meta: { class: { td: 'whitespace-normal' } } },
    ...(variasEmpresas.value ? [{ accessorKey: 'empresa_id', header: 'Empresa', meta: SOLO_ANCHO }] : []),
    { accessorKey: 'cantidad', header: 'Cantidad', meta: { class: { th: 'text-right', td: 'text-right' } } },
])

async function cargar() {
    cargando.value = true
    problema.value = null
    const resultado = await usePlanes().adicionales(props.plan.id)
    cargando.value = false
    lista.value = resultado.ok ? resultado.data : []
    problema.value = resultado.ok ? null : resultado.problema
}

function alGuardar(nueva: AdicionalPlan[]) {
    lista.value = nueva
    toast.add({
        title: 'Adicionales del plan guardados',
        description: 'Aplican desde la próxima alta o cambio de plan; los servicios actuales no cambian.',
        icon: 'i-lucide-circle-check',
        color: 'success',
    })
    emit('actualizado')
}

watch(() => props.plan.id, () => void cargar())
onMounted(cargar)
</script>

<template>
    <section
        class="flex flex-col gap-3"
        aria-label="Adicionales incluidos"
        data-prueba="plan-adicionales"
    >
        <div class="flex flex-wrap items-center justify-between gap-2">
            <h3 class="text-sm font-semibold text-highlighted">
                Adicionales incluidos
            </h3>
            <UButton
                v-if="puedeEditar && !problema"
                label="Editar lista"
                icon="i-lucide-list-plus"
                color="neutral"
                variant="outline"
                size="sm"
                :disabled="cargando"
                data-prueba="editar-adicionales-plan"
                @click="editando = true"
            />
        </div>
        <p class="text-sm text-muted">
            Cada servicio nuevo con este plan los recibe como «Incluido», solo los de su empresa. Cambiar la lista aplica desde la próxima alta o cambio de plan: los servicios que ya tienen este plan no cambian.
        </p>

        <ProblemaAlerta
            v-if="problema"
            :problema="problema"
            :reintentar="cargar"
            :reintentando="cargando"
        />
        <UTable
            v-else
            :data="lista"
            :columns="columnas"
            :loading="cargando"
        >
            <template #adicional_nombre-cell="{ row }">
                <div class="flex flex-col">
                    <span class="flex flex-wrap items-center gap-1.5 text-sm font-medium text-highlighted">
                        {{ row.original.adicional_nombre }}
                        <UBadge
                            v-if="!row.original.adicional_activo"
                            label="Desactivado: no se asigna"
                            color="neutral"
                            variant="subtle"
                            size="sm"
                        />
                    </span>
                    <span class="font-mono text-xs text-muted">{{ row.original.adicional_codigo }}</span>
                    <span
                        v-if="variasEmpresas"
                        class="text-xs text-muted sm:hidden"
                    >{{ nombreEmpresa(row.original.empresa_id) }}</span>
                </div>
            </template>
            <template #empresa_id-cell="{ row }">
                <span class="text-sm">{{ nombreEmpresa(row.original.empresa_id) }}</span>
            </template>
            <template #cantidad-cell="{ row }">
                <span class="tabular-nums">{{ row.original.cantidad }}</span>
            </template>
            <template #empty>
                <UEmpty
                    icon="i-lucide-package"
                    title="Este plan no trae adicionales"
                    variant="naked"
                />
            </template>
        </UTable>

        <PlanAdicionalesModal
            v-if="puedeEditar"
            v-model:open="editando"
            :plan="plan"
            :actuales="lista"
            @guardado="alGuardar"
        />
    </section>
</template>
