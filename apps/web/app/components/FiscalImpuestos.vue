<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { TableColumn } from '@nuxt/ui'

/**
 * Impuestos de la empresa activa vigentes a una fecha (`fiscal.impuestos`, contrato §10.2): IVA,
 * pequeño contribuyente y retenciones (con signo −). Un código por uso: `IVA12` en ventas,
 * `IVA12_C` en compras. Editar = versión nueva con vigencia.
 */
const { puede } = usePermisos()
const toast = useToast()

type FiltroGrupo = 'todos' | ImpuestoFiscal['grupo']
const fecha = ref(hoyGuatemala())
const grupo = ref<FiltroGrupo>('todos')
const uso = ref<'todos' | ImpuestoFiscal['uso']>('todos')
const datos = shallowRef<ImpuestoFiscal[]>([])
const cargando = ref(false)
const leidos = ref(false)
const problema = ref<Problem | null>(null)

const codigoHistorial = ref<string | null>(null)
const historialAbierto = ref(false)
const historial = useTemplateRef('historial')
const editando = shallowRef<ImpuestoFiscal | null>(null)
const versionAbierta = ref(false)

const itemsGrupo = [
    { label: 'Todos', value: 'todos' },
    ...Object.entries(GRUPOS_IMPUESTO).map(([value, label]) => ({ label, value })),
]
const itemsUso = [
    { label: 'Ventas y compras', value: 'todos' },
    ...Object.entries(USOS_IMPUESTO).map(([value, label]) => ({ label, value })),
]

const columnas: TableColumn<ImpuestoFiscal>[] = [
    { accessorKey: 'codigo', header: 'Impuesto' },
    { accessorKey: 'tasa', header: 'Tasa' },
    { accessorKey: 'calculo', header: 'Cálculo', meta: SOLO_ESCRITORIO },
    { accessorKey: 'cuadricula_cuota', header: 'Cuadrículas', meta: SOLO_ESCRITORIO },
    { accessorKey: 'nivel', header: 'Fuente', meta: SOLO_ANCHO },
    { id: 'acciones', header: '', meta: { class: { th: 'w-0', td: 'text-right' } } },
]

const visibles = computed(() => datos.value
    .filter(i => grupo.value === 'todos' || i.grupo === grupo.value)
    .filter(i => uso.value === 'todos' || i.uso === uso.value))

async function cargar() {
    // La página ya exige `fiscal.ver`; la guardia deja explícito el permiso de la lectura.
    if (!puede('fiscal.ver')) {
        return
    }
    cargando.value = true
    const resultado = await useImpuestosFiscales().listar(fecha.value || undefined)
    cargando.value = false
    leidos.value = true
    datos.value = resultado.ok ? resultado.data.impuestos : []
    problema.value = resultado.ok ? null : problemaFiscalLegible(resultado.problema)
}

function verHistorial(impuesto: ImpuestoFiscal) {
    codigoHistorial.value = impuesto.codigo
    historialAbierto.value = true
}

function nuevaVersion(impuesto: ImpuestoFiscal) {
    editando.value = impuesto
    versionAbierta.value = true
}

function alGuardar(impuesto: ImpuestoFiscal) {
    toast.add({
        title: `${impuesto.codigo}: ${tasaConSigno(impuesto)}${impuesto.activo ? '' : ' (inactivo)'}`,
        description: `Versión nueva desde ${formatearFecha(impuesto.vigente_desde)}; las anteriores no cambian.`,
        icon: 'i-lucide-check',
        color: 'success',
    })
    void cargar()
    if (historialAbierto.value) {
        void historial.value?.cargar()
    }
}

watch(fecha, cargar)
onMounted(cargar)
</script>

<template>
    <div class="flex flex-col gap-4">
        <div class="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
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
            <USelect
                v-model="grupo"
                :items="itemsGrupo"
                aria-label="Grupo de impuesto"
                class="w-full sm:w-56"
            />
            <USelect
                v-model="uso"
                :items="itemsUso"
                aria-label="Uso"
                class="w-full sm:w-48"
            />
        </div>

        <ProblemaAlerta
            v-if="problema"
            :problema="problema"
            :reintentar="cargar"
            :reintentando="cargando"
        />
        <UTable
            v-else
            :data="visibles"
            :columns="columnas"
            :loading="cargando"
            :empty="leidos ? 'Ningún impuesto con este filtro.' : ''"
        >
            <template #codigo-cell="{ row }">
                <div
                    class="flex min-w-0 flex-col gap-0.5 whitespace-normal"
                    :data-impuesto="row.original.codigo"
                >
                    <div class="flex flex-wrap items-center gap-1.5">
                        <span class="font-mono text-sm font-medium text-highlighted">{{ row.original.codigo }}</span>
                        <UBadge
                            :label="USOS_IMPUESTO[row.original.uso]"
                            color="neutral"
                            variant="outline"
                            size="sm"
                        />
                        <UBadge
                            v-if="!row.original.activo"
                            label="Inactivo"
                            color="neutral"
                            variant="subtle"
                            size="sm"
                        />
                        <UBadge
                            v-if="row.original.confirmar_contador"
                            label="Confirmar con contador"
                            icon="i-lucide-user-check"
                            color="warning"
                            variant="subtle"
                            size="sm"
                        />
                    </div>
                    <span class="text-xs text-muted">{{ row.original.nombre }} · {{ GRUPOS_IMPUESTO[row.original.grupo] }}</span>
                </div>
            </template>
            <template #tasa-cell="{ row }">
                <span :class="['font-mono text-sm', row.original.signo === -1 ? 'text-error' : 'text-highlighted']">{{ tasaConSigno(row.original) }}</span>
            </template>
            <template #calculo-cell="{ row }">
                <span class="text-sm">{{ CALCULOS_IMPUESTO[row.original.calculo] }}<template v-if="row.original.base_impuesto"> de <span class="font-mono">{{ row.original.base_impuesto }}</span></template></span>
            </template>
            <template #cuadricula_cuota-cell="{ row }">
                <span class="font-mono text-xs text-muted">{{ cuadriculaConSigno(row.original.cuadricula_base, 1) }} / {{ cuadriculaConSigno(row.original.cuadricula_cuota, row.original.signo) }}</span>
            </template>
            <template #nivel-cell="{ row }">
                <div class="flex flex-col gap-1">
                    <UBadge
                        :label="NIVELES_FISCALES[row.original.nivel].etiqueta"
                        :color="NIVELES_FISCALES[row.original.nivel].color"
                        variant="subtle"
                        size="sm"
                        class="w-fit"
                    />
                    <span class="text-xs text-muted">desde {{ formatearFecha(row.original.vigente_desde) }}</span>
                </div>
            </template>
            <template #acciones-cell="{ row }">
                <div class="flex justify-end gap-1">
                    <UButton
                        icon="i-lucide-history"
                        color="neutral"
                        variant="ghost"
                        size="sm"
                        :aria-label="`Versiones de ${row.original.codigo}`"
                        @click="verHistorial(row.original)"
                    />
                    <UButton
                        v-if="puede('fiscal.editar_parametros')"
                        icon="i-lucide-plus"
                        color="neutral"
                        variant="ghost"
                        size="sm"
                        :aria-label="`Nueva versión de ${row.original.codigo}`"
                        @click="nuevaVersion(row.original)"
                    />
                </div>
            </template>
        </UTable>

        <ImpuestoHistorial
            ref="historial"
            v-model:open="historialAbierto"
            :codigo="codigoHistorial"
            @nueva="nuevaVersion"
        />
        <ImpuestoVersionModal
            v-if="puede('fiscal.editar_parametros')"
            v-model:open="versionAbierta"
            :impuesto="editando"
            @hecho="alGuardar"
        />
    </div>
</template>
