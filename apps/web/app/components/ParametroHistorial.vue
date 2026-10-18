<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { TableColumn } from '@nuxt/ui'

/**
 * Historial de un parámetro fiscal (`GET /fiscal/parametros/:clave/historial`): todas sus
 * versiones (paquete, instalación, global y de la empresa) por vigencia, con su fuente. Las filas
 * nunca se editan; «Nuevo valor» inserta otra.
 */
const props = defineProps<{
    clave: string | null
}>()

const abierto = defineModel<boolean>('open', { default: false })
const emit = defineEmits<{ nuevo: [parametro: ParametroFiscal] }>()

const { puede } = usePermisos()
const historial = shallowRef<HistorialParametroFiscal | null>(null)
const cargando = ref(false)
const problema = ref<Problem | null>(null)

const columnas: TableColumn<ValorParametroFiscal>[] = [
    { accessorKey: 'vigente_desde', header: 'Desde' },
    { accessorKey: 'valor', header: 'Valor' },
    { accessorKey: 'nivel', header: 'Fuente' },
    { accessorKey: 'motivo', header: 'Motivo', meta: SOLO_ANCHO },
]

/** La fila que rige hoy (la que dio el valor vigente). */
const vigenteId = computed(() => {
    const p = historial.value?.parametro
    if (!p) {
        return null
    }
    return historial.value?.valores.findLast(v => v.vigente_desde === p.vigente_desde && v.nivel === p.nivel)?.id ?? null
})

async function cargar() {
    if (!props.clave || !puede('fiscal.ver')) {
        return
    }
    cargando.value = true
    problema.value = null
    const resultado = await useParametrosFiscales().historial(props.clave)
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
        :title="clave ?? 'Parámetro'"
        description="Versiones con vigencia: lo anterior a cada fecha no cambia."
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
                    <div class="flex flex-col gap-2 text-sm">
                        <p class="text-highlighted">
                            {{ historial.parametro.descripcion }}
                        </p>
                        <div class="flex flex-wrap items-center gap-2">
                            <UBadge
                                :label="ALCANCES_FISCALES[historial.parametro.alcance]"
                                color="neutral"
                                variant="outline"
                                size="sm"
                            />
                            <UBadge
                                :label="CONFIANZA_FISCAL[historial.parametro.confianza]"
                                color="neutral"
                                variant="subtle"
                                size="sm"
                            />
                            <UBadge
                                v-if="historial.parametro.pendiente_confirmar"
                                label="Confirmar con contador"
                                icon="i-lucide-user-check"
                                color="warning"
                                variant="subtle"
                                size="sm"
                            />
                        </div>
                        <p class="text-xs text-muted">
                            Fuente: {{ historial.parametro.fuente }}
                        </p>
                        <UAlert
                            v-if="historial.parametro.accion"
                            color="info"
                            variant="subtle"
                            icon="i-lucide-info"
                            :description="`Se cambia con su acción propia (${historial.parametro.accion}).`"
                        />
                        <UAlert
                            v-if="historial.parametro.valor === null"
                            color="warning"
                            variant="subtle"
                            icon="i-lucide-circle-help"
                            title="Sin valor vigente"
                            description="Un cálculo que lo necesite responde «Falta un valor que debe confirmar el contador» hasta que se registre uno."
                        />
                    </div>

                    <UTable
                        :data="historial.valores"
                        :columns="columnas"
                        :loading="cargando"
                        empty="Sin versiones."
                    >
                        <template #vigente_desde-cell="{ row }">
                            <div class="flex items-center gap-2 whitespace-nowrap">
                                <span>{{ formatearFecha(row.original.vigente_desde) }}</span>
                                <UBadge
                                    v-if="row.original.id === vigenteId"
                                    label="Vigente"
                                    color="success"
                                    variant="subtle"
                                    size="sm"
                                />
                            </div>
                        </template>
                        <template #valor-cell="{ row }">
                            <span class="font-mono text-xs break-all">{{ formatearValorFiscal(historial.parametro.tipo, row.original.valor, historial.parametro.clave) }}</span>
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
            v-if="historial && editableEnLista(historial.parametro) && puede('fiscal.editar_parametros')"
            #footer
        >
            <div class="flex w-full justify-end">
                <UButton
                    label="Nuevo valor"
                    icon="i-lucide-plus"
                    @click="emit('nuevo', historial.parametro)"
                />
            </div>
        </template>
    </USlideover>
</template>
