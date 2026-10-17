<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { TableColumn } from '@nuxt/ui'

/**
 * Frases del DTE vigentes a una fecha (`GET /fiscal/frases`): las del régimen se **calculan** del
 * régimen vigente (no se guardan ni se quitan aquí) y las manuales se agregan o retiran con vigencia.
 */
const { puede } = usePermisos()
const toast = useToast()

const fecha = ref(hoyGuatemala())
const frases = shallowRef<FrasesFiscales | null>(null)
const cargando = ref(false)
const problema = ref<Problem | null>(null)
const abierto = ref(false)
const retirando = shallowRef<FraseFiscal | null>(null)

const columnas: TableColumn<FraseFiscal>[] = [
    { accessorKey: 'texto', header: 'Frase' },
    { accessorKey: 'tipos_dte', header: 'DTE', meta: SOLO_ANCHO },
    { accessorKey: 'origen', header: 'Origen' },
    { id: 'acciones', header: '', meta: { class: { th: 'w-0', td: 'text-right' } } },
]
const columnasHistorial: TableColumn<FraseFiscal>[] = [
    { accessorKey: 'vigente_desde', header: 'Desde' },
    { accessorKey: 'texto', header: 'Frase' },
    { accessorKey: 'activa', header: 'Cambio' },
    { accessorKey: 'motivo', header: 'Motivo', meta: SOLO_ANCHO },
]

async function cargar() {
    // La página ya exige `fiscal.ver`; la guardia deja explícito el permiso de la lectura.
    if (!puede('fiscal.ver')) {
        return
    }
    cargando.value = true
    const resultado = await useFrasesFiscales().listar(fecha.value || undefined)
    cargando.value = false
    frases.value = resultado.ok ? resultado.data : null
    problema.value = resultado.ok ? null : problemaFiscalLegible(resultado.problema)
}

function agregar() {
    retirando.value = null
    abierto.value = true
}

function retirar(frase: FraseFiscal) {
    retirando.value = frase
    abierto.value = true
}

function alTerminar(frase: FraseFiscal) {
    toast.add({
        title: frase.activa ? 'Frase agregada' : 'Frase retirada',
        description: `${frase.tipo_frase}-${frase.escenario} · desde ${formatearFecha(frase.vigente_desde)}`,
        icon: 'i-lucide-check',
        color: 'success',
    })
    void cargar()
}

watch(fecha, cargar)
onMounted(cargar)
</script>

<template>
    <div class="flex flex-col gap-4">
        <div class="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <UFormField
                label="Vigentes al"
                class="sm:w-44"
            >
                <UInput
                    v-model="fecha"
                    type="date"
                    class="w-full"
                />
            </UFormField>
            <UButton
                v-if="puede('fiscal.configurar')"
                label="Agregar frase"
                icon="i-lucide-plus"
                @click="agregar"
            />
        </div>

        <ProblemaAlerta
            v-if="problema"
            :problema="problema"
            :reintentar="cargar"
            :reintentando="cargando"
        />
        <template v-else>
            <UTable
                :data="frases?.vigentes ?? []"
                :columns="columnas"
                :loading="cargando"
                :empty="frases ? 'Sin frases vigentes en esa fecha.' : ''"
            >
                <template #texto-cell="{ row }">
                    <div
                        class="flex min-w-0 flex-col gap-0.5 whitespace-normal"
                        :data-frase="row.original.clave"
                    >
                        <div class="flex flex-wrap items-center gap-1.5">
                            <span class="text-highlighted">{{ row.original.texto }}</span>
                            <UBadge
                                v-if="row.original.confirmar_contador"
                                label="Confirmar con contador"
                                icon="i-lucide-user-check"
                                color="warning"
                                variant="subtle"
                                size="sm"
                            />
                        </div>
                        <span class="text-xs text-muted">
                            <template v-if="row.original.tipo_frase !== null">Tipo {{ row.original.tipo_frase }}, escenario {{ row.original.escenario }}</template>
                            <template v-else>Sin código de frase verificado</template>
                            <template v-if="row.original.vigente_desde"> · desde {{ formatearFecha(row.original.vigente_desde) }}</template>
                            <span class="sm:hidden"> · {{ row.original.tipos_dte.join(', ') }}</span>
                        </span>
                    </div>
                </template>
                <template #tipos_dte-cell="{ row }">
                    <span class="font-mono text-xs">{{ row.original.tipos_dte.join(', ') }}</span>
                </template>
                <template #origen-cell="{ row }">
                    <UBadge
                        :label="row.original.origen === 'regimen' ? 'Del régimen' : 'Manual'"
                        :icon="row.original.origen === 'regimen' ? 'i-lucide-calculator' : 'i-lucide-pen-line'"
                        :color="row.original.origen === 'regimen' ? 'info' : 'neutral'"
                        variant="subtle"
                    />
                </template>
                <template #acciones-cell="{ row }">
                    <UButton
                        v-if="row.original.origen === 'manual' && puede('fiscal.configurar')"
                        icon="i-lucide-calendar-x"
                        color="neutral"
                        variant="ghost"
                        size="sm"
                        :aria-label="`Retirar frase ${row.original.tipo_frase}-${row.original.escenario}`"
                        @click="retirar(row.original)"
                    />
                </template>
            </UTable>

            <p class="text-xs text-muted">
                Las frases del régimen se calculan del régimen vigente en la fecha del documento: cambian solas al cambiar el régimen.
            </p>

            <UPageCard
                v-if="frases && frases.historial.length"
                title="Historial de frases manuales"
                variant="subtle"
            >
                <UTable
                    :data="frases.historial"
                    :columns="columnasHistorial"
                >
                    <template #vigente_desde-cell="{ row }">
                        {{ formatearFecha(row.original.vigente_desde) }}
                    </template>
                    <template #texto-cell="{ row }">
                        <span class="whitespace-normal">{{ row.original.tipo_frase }}-{{ row.original.escenario }} · {{ row.original.texto }}</span>
                    </template>
                    <template #activa-cell="{ row }">
                        <UBadge
                            :label="row.original.activa ? 'Agregada' : 'Retirada'"
                            :color="row.original.activa ? 'success' : 'neutral'"
                            variant="subtle"
                            size="sm"
                        />
                    </template>
                    <template #motivo-cell="{ row }">
                        <span class="text-xs text-muted">{{ row.original.motivo ?? '—' }}</span>
                    </template>
                </UTable>
            </UPageCard>
        </template>

        <FraseFiscalModal
            v-if="puede('fiscal.configurar')"
            v-model:open="abierto"
            :retirar="retirando"
            @hecho="alTerminar"
        />
    </div>
</template>
