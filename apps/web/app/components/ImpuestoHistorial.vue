<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { TableColumn } from '@nuxt/ui'

/**
 * Versiones de un impuesto (`GET /fiscal/impuestos/:codigo/historial`): la vigente y todas las
 * de paquete, globales y de la empresa, por vigencia. Ninguna se edita.
 */
const props = defineProps<{
    codigo: string | null
}>()

const abierto = defineModel<boolean>('open', { default: false })
const emit = defineEmits<{ nueva: [impuesto: ImpuestoFiscal] }>()

const { puede } = usePermisos()
const historial = shallowRef<HistorialImpuestoFiscal | null>(null)
const cargando = ref(false)
const problema = ref<Problem | null>(null)

const columnas: TableColumn<ImpuestoFiscal>[] = [
    { accessorKey: 'vigente_desde', header: 'Desde' },
    { accessorKey: 'tasa', header: 'Tasa' },
    { accessorKey: 'nivel', header: 'Fuente' },
    { accessorKey: 'motivo', header: 'Motivo', meta: SOLO_ANCHO },
]

async function cargar() {
    if (!props.codigo || !puede('fiscal.ver')) {
        return
    }
    cargando.value = true
    problema.value = null
    const resultado = await useImpuestosFiscales().historial(props.codigo)
    cargando.value = false
    historial.value = resultado.ok ? resultado.data : null
    problema.value = resultado.ok ? null : problemaFiscalLegible(resultado.problema)
}

watch(abierto, (valor) => {
    if (valor) {
        historial.value = null
        void cargar()
    }
})

defineExpose({ cargar })
</script>

<template>
    <USlideover
        v-model:open="abierto"
        :title="codigo ?? 'Impuesto'"
        :description="historial?.vigente?.nombre ?? 'Versiones con vigencia'"
        :ui="{ content: 'sm:max-w-2xl' }"
    >
        <template #body>
            <div class="flex flex-col gap-4">
                <ProblemaAlerta
                    v-if="problema"
                    :problema="problema"
                    :reintentar="cargar"
                    :reintentando="cargando"
                />
                <template v-else-if="historial">
                    <dl
                        v-if="historial.vigente"
                        class="grid gap-3 text-sm sm:grid-cols-2"
                    >
                        <DatoFicha
                            etiqueta="Tasa vigente"
                            :valor="tasaConSigno(historial.vigente)"
                        />
                        <DatoFicha
                            etiqueta="Cálculo"
                            :valor="`${CALCULOS_IMPUESTO[historial.vigente.calculo]}${historial.vigente.base_impuesto ? ` de ${historial.vigente.base_impuesto}` : ''}`"
                        />
                        <DatoFicha
                            etiqueta="Cuenta de la cuota"
                            :valor="historial.vigente.cuenta_transicion ? `${historial.vigente.cuenta_cuota} (por certificar: ${historial.vigente.cuenta_transicion})` : historial.vigente.cuenta_cuota"
                        />
                        <DatoFicha
                            etiqueta="Cuadrículas"
                            :valor="`Base ${cuadriculaConSigno(historial.vigente.cuadricula_base, 1)} · cuota ${cuadriculaConSigno(historial.vigente.cuadricula_cuota, historial.vigente.signo)}`"
                        />
                    </dl>
                    <p
                        v-if="historial.vigente"
                        class="text-xs text-muted"
                    >
                        {{ historial.vigente.descripcion }} · Fuente: {{ historial.vigente.fuente }}
                    </p>

                    <UTable
                        :data="historial.versiones"
                        :columns="columnas"
                        :loading="cargando"
                        empty="Sin versiones."
                    >
                        <template #vigente_desde-cell="{ row }">
                            <div class="flex items-center gap-2 whitespace-nowrap">
                                <span>{{ formatearFecha(row.original.vigente_desde) }}</span>
                                <UBadge
                                    v-if="row.original.id === historial.vigente?.id"
                                    label="Vigente"
                                    color="success"
                                    variant="subtle"
                                    size="sm"
                                />
                            </div>
                        </template>
                        <template #tasa-cell="{ row }">
                            <span :class="['font-mono', row.original.activo ? '' : 'text-muted line-through']">{{ tasaConSigno(row.original) }}</span>
                            <span
                                v-if="!row.original.activo"
                                class="ml-1 text-xs text-muted"
                            >inactivo</span>
                        </template>
                        <template #nivel-cell="{ row }">
                            <UBadge
                                :label="NIVELES_FISCALES[row.original.nivel].etiqueta"
                                :color="NIVELES_FISCALES[row.original.nivel].color"
                                variant="subtle"
                                size="sm"
                            />
                        </template>
                        <template #motivo-cell="{ row }">
                            <span class="text-xs text-muted">{{ row.original.motivo ?? '—' }}</span>
                        </template>
                    </UTable>
                </template>
                <USkeleton
                    v-else
                    class="h-40 w-full"
                />
            </div>
        </template>
        <template
            v-if="historial?.vigente && puede('fiscal.editar_parametros')"
            #footer
        >
            <div class="flex w-full justify-end">
                <UButton
                    label="Nueva versión"
                    icon="i-lucide-plus"
                    @click="historial.vigente && emit('nueva', historial.vigente)"
                />
            </div>
        </template>
    </USlideover>
</template>
