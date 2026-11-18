<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { TableColumn } from '@nuxt/ui'

/**
 * «Asignar a servicios sin plantilla» (`plantillas.asignar_sin_plantilla`, decisión del PM del 18
 * nov): confirmación sin campos. Al abrir pide la vista previa (`GET …/servicios-sin-plantilla`) y
 * muestra cuántos son, por estado, desde cuándo se cobra (nada atrasado) y la muestra. Confirmar
 * manda el `total` leído como `total_esperado`: si cambió (409 `total_cambiado`) avisa y vuelve a
 * pedir la vista previa; con 0 servicios no hay nada que confirmar.
 */
const props = defineProps<{
    plantilla: Pick<PlantillaFacturacion, 'id' | 'nombre'>
}>()

const emit = defineEmits<{
    asignado: [resultado: AsignacionSinPlantilla]
}>()

const abierto = defineModel<boolean>('open', { default: false })

const toast = useToast()

const vista = shallowRef<VistaPreviaSinPlantilla | null>(null)
const cargando = ref(false)
const problemaVista = ref<Problem | null>(null)
const asignando = ref(false)
const problemaAsignar = ref<Problem | null>(null)
/** Una por vista previa leída: un reintento del mismo `total_esperado` repite la misma clave. */
let clave = nuevaClaveIdempotencia()

async function cargar() {
    cargando.value = true
    problemaVista.value = null
    problemaAsignar.value = null
    const resultado = await usePlantillas().vistaPreviaSinPlantilla(props.plantilla.id)
    cargando.value = false
    vista.value = resultado.ok ? resultado.data : null
    problemaVista.value = resultado.ok ? null : resultado.problema
    clave = nuevaClaveIdempotencia()
}

watch(abierto, (valor) => {
    if (valor) {
        vista.value = null
        void cargar()
    }
}, { immediate: true })

/** «1 servicio» / «3 servicios». */
function servicios(cantidad: number): string {
    return cantidad === 1 ? '1 servicio' : `${cantidad} servicios`
}

const desde = computed(() => {
    if (!vista.value) {
        return ''
    }
    return vista.value.facturar_desde
        ? `Se cobra desde el ${formatearFecha(vista.value.facturar_desde)}; no se cobra nada atrasado.`
        : 'Cada servicio se cobra desde su siguiente aniversario (columna «Se cobra desde»); no se cobra nada atrasado.'
})

const DESGLOSE = ['activo', 'limitado', 'suspendido'] as const

async function confirmar() {
    if (!vista.value || vista.value.total === 0) {
        return
    }
    asignando.value = true
    problemaAsignar.value = null
    const resultado = await usePlantillas().asignarSinPlantilla(props.plantilla.id, vista.value.total, clave)
    asignando.value = false
    if (resultado.ok) {
        const asignados = resultado.data.asignados
        toast.add({
            title: asignados === 1 ? '1 servicio asignado' : `${asignados} servicios asignados`,
            description: `Ahora facturan con ${props.plantilla.nombre}. No se cobró nada atrasado.`,
            icon: 'i-lucide-circle-check',
            color: 'success',
        })
        emit('asignado', resultado.data)
        abierto.value = false
        return
    }
    if (codigoProblema(resultado.problema) === 'total_cambiado') {
        toast.add({
            title: 'Cambió la cantidad de servicios sin plantilla',
            description: 'No se asignó nada. Revisa la vista previa actualizada y confirma de nuevo.',
            icon: 'i-lucide-triangle-alert',
            color: 'warning',
        })
        await cargar()
        return
    }
    problemaAsignar.value = resultado.problema
}

const columnas: TableColumn<VistaPreviaSinPlantilla['muestra'][number]>[] = [
    { accessorKey: 'cliente_nombre', header: 'Cliente', meta: { class: { td: 'whitespace-normal' } } },
    { accessorKey: 'estado', header: 'Estado' },
    { accessorKey: 'plan_nombre', header: 'Plan', meta: SOLO_ANCHO },
    { accessorKey: 'facturar_desde', header: 'Se cobra desde', meta: SOLO_ANCHO },
]
</script>

<template>
    <UModal
        v-model:open="abierto"
        :title="`Asignar ${plantilla.nombre} a servicios sin plantilla`"
        description="Los servicios activos, limitados y suspendidos que no tienen plantilla de facturación empiezan a facturar con esta."
        :dismissible="!asignando"
        :ui="{ content: 'sm:max-w-2xl' }"
    >
        <template #body>
            <div
                class="flex flex-col gap-4"
                data-prueba="asignar-sin-plantilla"
            >
                <ProblemaAlerta
                    v-if="problemaVista"
                    :problema="problemaVista"
                    :reintentar="cargar"
                    :reintentando="cargando"
                />
                <div
                    v-else-if="cargando && !vista"
                    class="flex flex-col gap-2"
                >
                    <USkeleton class="h-5 w-2/3" />
                    <USkeleton class="h-4 w-full" />
                    <USkeleton class="h-24 w-full" />
                </div>

                <template v-else-if="vista">
                    <UEmpty
                        v-if="vista.total === 0"
                        icon="i-lucide-circle-check"
                        title="No hay servicios sin plantilla"
                        description="Todos los servicios vigentes ya facturan con una plantilla."
                        variant="naked"
                        data-prueba="sin-plantilla-vacio"
                    />
                    <template v-else>
                        <div class="flex flex-col gap-2">
                            <p
                                class="text-base font-semibold text-highlighted"
                                data-prueba="sin-plantilla-total"
                            >
                                {{ servicios(vista.total) }} sin plantilla
                            </p>
                            <div
                                class="flex flex-wrap gap-1.5"
                                data-prueba="sin-plantilla-por-estado"
                            >
                                <template
                                    v-for="estado in DESGLOSE"
                                    :key="estado"
                                >
                                    <span
                                        v-if="vista.por_estado[estado] > 0"
                                        class="flex items-center gap-1 text-sm"
                                        :data-estado="estado"
                                    >
                                        <EstadoServicioBadge
                                            :estado="estado"
                                            size="sm"
                                        />
                                        <span class="tabular-nums text-default">{{ vista.por_estado[estado] }}</span>
                                    </span>
                                </template>
                            </div>
                        </div>

                        <UAlert
                            color="info"
                            variant="subtle"
                            icon="i-lucide-calendar-check"
                            :title="desde"
                            data-prueba="sin-plantilla-desde"
                        />

                        <div class="flex flex-col gap-1">
                            <UTable
                                :data="vista.muestra"
                                :columns="columnas"
                                :ui="{ td: 'py-2' }"
                                data-prueba="sin-plantilla-muestra"
                            >
                                <template #cliente_nombre-cell="{ row }">
                                    <div
                                        class="flex min-w-0 flex-col"
                                        :data-servicio="row.original.servicio_id"
                                    >
                                        <span class="text-sm text-highlighted">{{ row.original.cliente_nombre }}</span>
                                        <span class="font-mono text-xs text-muted">{{ row.original.user_ppp ?? `Servicio ${row.original.servicio_id}` }}</span>
                                        <span class="text-xs text-muted sm:hidden">{{ row.original.plan_nombre }} · desde {{ formatearFecha(row.original.facturar_desde) }}</span>
                                    </div>
                                </template>
                                <template #estado-cell="{ row }">
                                    <EstadoServicioBadge
                                        :estado="row.original.estado"
                                        size="sm"
                                        :con-icono="false"
                                    />
                                </template>
                                <template #facturar_desde-cell="{ row }">
                                    <span class="whitespace-nowrap text-sm">{{ formatearFecha(row.original.facturar_desde) }}</span>
                                </template>
                            </UTable>
                            <p
                                v-if="vista.total > vista.muestra.length"
                                class="text-xs text-muted"
                            >
                                Se muestran {{ vista.muestra.length }} de {{ vista.total }}.
                            </p>
                        </div>
                    </template>
                </template>

                <ProblemaAlerta
                    v-if="problemaAsignar"
                    :problema="problemaAsignar"
                    :reintentar="confirmar"
                    :reintentando="asignando"
                />
            </div>
        </template>
        <template #footer>
            <div class="flex w-full flex-wrap justify-end gap-2">
                <UButton
                    :label="vista && vista.total > 0 ? 'Cancelar' : 'Cerrar'"
                    color="neutral"
                    variant="ghost"
                    :disabled="asignando"
                    @click="abierto = false"
                />
                <UButton
                    v-if="vista && vista.total > 0"
                    :label="`Asignar a ${servicios(vista.total)}`"
                    icon="i-lucide-check"
                    :loading="asignando"
                    :disabled="cargando"
                    data-prueba="asignar-sin-plantilla-confirmar"
                    @click="confirmar"
                />
            </div>
        </template>
    </UModal>
</template>
