<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { SelectItem, TableColumn } from '@nuxt/ui'

/**
 * Ajustes fiscales del ISR (A3, fase 7 PR C, desvío a; `GET /declaraciones/ajustes`, `declaraciones.ver`):
 * llevan el resultado contable a la renta imponible por cierre parcial (trimestre) o anual. Solo
 * inserción: «Anular» registra otra fila con `anula_a` (`declaraciones.ajustar`); el borrador del
 * periodo queda desactualizado y hay que recalcularlo.
 */
definePageMeta({ permiso: 'declaraciones.ver' })

useHead({ title: 'Ajustes fiscales · ArgosIsp' })

const route = useRoute()
const router = useRouter()
const toast = useToast()
const { puede } = usePermisos()
const { conSelector, eleccion, empresaId, empresas, nombre: nombreEmpresa } = useEmpresaActiva()
const consolidado = computed(() => conSelector.value && eleccion.value === 'todas')
const empresa = computed<number | null>(() => empresaId.value ?? (conSelector.value ? null : (empresas.value[0]?.id ?? null)))

const anioActual = Number(hoyGuatemala().slice(0, 4))
const anio = ref(Number(route.query.anio) >= 2000 ? Number(route.query.anio) : anioActual)
const trimestre = ref<string>(['1', '2', '3', '4'].includes(String(route.query.trimestre)) ? String(route.query.trimestre) : 'todos')
const itemsAnio: SelectItem[] = [0, 1, 2, 3].map(n => ({ label: String(anioActual - n), value: anioActual - n }))
const itemsTrimestre: SelectItem[] = [
    { label: 'Anuales y trimestrales', value: 'todos' },
    ...[1, 2, 3, 4].map(n => ({ label: `${['1.er', '2.º', '3.er', '4.º'][n - 1]} trimestre`, value: String(n) })),
]

const filas = shallowRef<AjusteFiscal[] | null>(null)
const cargando = ref(false)
const problema = ref<Problem | null>(null)

async function cargar() {
    cargando.value = true
    const resultado = await useDeclaraciones().ajustes(anio.value, trimestre.value === 'todos' ? null : Number(trimestre.value))
    cargando.value = false
    filas.value = resultado.ok ? resultado.data : null
    problema.value = resultado.ok ? null : resultado.problema
}

watch([anio, trimestre], () => {
    void router.replace({ query: { ...route.query, anio: String(anio.value), trimestre: trimestre.value === 'todos' ? undefined : trimestre.value } })
    void cargar()
})
watch(eleccion, () => void cargar())
onMounted(cargar)

/** Un ajuste vigente: ni anulado ni anulación de otro. */
function vigente(a: AjusteFiscal): boolean {
    return a.anula_a === null && a.anulado_por_ajuste === null
}

const columnas: TableColumn<AjusteFiscal>[] = [
    { accessorKey: 'concepto', header: 'Ajuste', meta: { class: { td: 'whitespace-normal' } } },
    { accessorKey: 'trimestre', header: 'Periodo', meta: SOLO_ANCHO },
    { accessorKey: 'monto', header: 'Monto', meta: { class: { th: 'text-right', td: 'text-right tabular-nums' } } },
    { id: 'acciones', header: '', meta: { class: { th: 'w-0', td: 'text-right' } } },
]

/* Registrar y anular. */
const registrando = ref(false)
const anulando = shallowRef<AjusteFiscal | null>(null)
const viendoAnular = computed({
    get: () => anulando.value !== null,
    set: (valor: boolean) => {
        if (!valor) {
            anulando.value = null
        }
    },
})

function anular(concepto: string, clave: string): Promise<Resultado<AjusteFiscal>> {
    const ajuste = anulando.value
    if (!ajuste) {
        return Promise.resolve({ ok: false, problema: { type: 'about:blank', title: 'Sin ajuste', status: 0 } })
    }
    return useDeclaraciones().ajustar({ anula_a: ajuste.id, concepto }, clave)
        .then(r => (r.ok ? r : { ok: false as const, problema: problemaDeclaracionLegible(r.problema) }))
}

function alTerminar(ajuste: AjusteFiscal) {
    toast.add({
        title: ajuste.anula_a ? 'Ajuste anulado' : 'Ajuste registrado',
        description: `Recalcule la declaración de ISR de ${ajuste.trimestre ? `${ajuste.trimestre}.º trimestre ` : ''}${ajuste.anio}: su borrador queda desactualizado.`,
        icon: 'i-lucide-check',
        color: 'success',
    })
    void cargar()
}
</script>

<template>
    <PanelPagina
        id="declaraciones-ajustes"
        titulo="Ajustes fiscales"
        icono="i-lucide-sliders-horizontal"
    >
        <div class="flex flex-col gap-4">
            <UAlert
                color="neutral"
                variant="subtle"
                icon="i-lucide-info"
                description="Suman (gastos no deducibles) o restan (rentas exentas) a la renta imponible del ISR por cierre parcial de un trimestre o del año. No se editan: anular un ajuste registra otra fila con su motivo. Confirme cada criterio con el contador."
                :actions="[{ label: 'Declaraciones', icon: 'i-lucide-file-spreadsheet', color: 'neutral', variant: 'outline', to: '/declaraciones' }]"
            />

            <div class="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                <div class="grid grid-cols-2 gap-2 sm:flex">
                    <USelect
                        v-model="anio"
                        :items="itemsAnio"
                        aria-label="Año"
                        class="w-full sm:w-32"
                        data-prueba="ajustes-anio"
                    />
                    <USelect
                        v-model="trimestre"
                        :items="itemsTrimestre"
                        aria-label="Trimestre"
                        class="w-full sm:w-56"
                        data-prueba="ajustes-trimestre"
                    />
                </div>
                <UButton
                    v-if="puede('declaraciones.ajustar')"
                    label="Registrar ajuste"
                    icon="i-lucide-plus"
                    :disabled="empresa === null"
                    class="self-start"
                    data-prueba="abrir-ajuste"
                    @click="registrando = true"
                />
            </div>
            <p
                v-if="puede('declaraciones.ajustar') && empresa === null"
                class="text-sm text-muted"
            >
                Con «Todas» se ven los de todas las empresas; para registrar uno, elija la empresa en el selector de arriba.
            </p>

            <ProblemaAlerta
                v-if="problema"
                :problema="problema"
                :reintentar="cargar"
                :reintentando="cargando"
            />
            <UTable
                v-else
                :data="filas ?? []"
                :columns="columnas"
                :loading="cargando"
                data-prueba="tabla-ajustes"
            >
                <template #concepto-cell="{ row }">
                    <div
                        class="flex min-w-0 flex-col gap-0.5"
                        :data-ajuste="row.original.id"
                    >
                        <span
                            class="text-sm"
                            :class="vigente(row.original) ? 'text-highlighted' : 'text-muted line-through decoration-1'"
                        >{{ row.original.concepto }}</span>
                        <span class="text-xs text-muted">
                            {{ row.original.efecto === 'suma' ? 'Suma a la renta' : 'Resta de la renta' }} · {{ formatearFechaHora(row.original.created_at) }}<template v-if="consolidado"> · {{ nombreEmpresa(row.original.empresa_id) }}</template>
                            <span class="sm:hidden"> · {{ row.original.trimestre ? `${row.original.trimestre}.º trimestre` : 'anual' }}</span>
                        </span>
                        <UBadge
                            v-if="row.original.anula_a"
                            :label="`Anula el ajuste ${row.original.anula_a}`"
                            color="neutral"
                            variant="outline"
                            size="sm"
                            class="self-start"
                        />
                        <UBadge
                            v-else-if="row.original.anulado_por_ajuste"
                            :label="`Anulado por el ajuste ${row.original.anulado_por_ajuste}`"
                            color="neutral"
                            variant="subtle"
                            size="sm"
                            class="self-start"
                            data-prueba="ajuste-anulado"
                        />
                    </div>
                </template>
                <template #trimestre-cell="{ row }">
                    <span class="text-sm">{{ row.original.trimestre ? `${row.original.trimestre}.º trimestre ${row.original.anio}` : `Anual ${row.original.anio}` }}</span>
                </template>
                <template #monto-cell="{ row }">
                    <span :class="row.original.efecto === 'resta' ? 'text-error' : ''">{{ row.original.efecto === 'resta' ? '−' : '+' }}{{ formatearQuetzales(row.original.monto) }}</span>
                </template>
                <template #acciones-cell="{ row }">
                    <UButton
                        v-if="vigente(row.original) && puede('declaraciones.ajustar')"
                        icon="i-lucide-x"
                        color="neutral"
                        variant="ghost"
                        size="sm"
                        :aria-label="`Anular el ajuste ${row.original.id}`"
                        @click="anulando = row.original"
                    />
                </template>
                <template #empty>
                    <UEmpty
                        icon="i-lucide-sliders-horizontal"
                        :title="`Sin ajustes en ${anio}`"
                        description="Sin ajustes, la renta imponible es el resultado del libro más los gastos no deducibles."
                        variant="naked"
                    />
                </template>
            </UTable>
        </div>

        <AjusteFiscalModal
            v-if="puede('declaraciones.ajustar') && empresa !== null"
            v-model:open="registrando"
            :anio="anio"
            :trimestre="trimestre === 'todos' ? null : Number(trimestre)"
            @hecho="alTerminar"
        />
        <AccionMotivoModal
            v-if="puede('declaraciones.ajustar')"
            v-model:open="viendoAnular"
            titulo="Anular ajuste"
            :descripcion="anulando ? `${anulando.concepto} · ${anulando.efecto === 'suma' ? '+' : '−'}${formatearQuetzales(anulando.monto)}` : undefined"
            efecto="Se registra otra fila que anula este ajuste (nada se borra). El borrador de ISR del periodo queda desactualizado: recalcúlelo."
            confirmar="Anular ajuste"
            icono="i-lucide-x"
            color="error"
            etiqueta="Motivo"
            placeholder="Ej.: registrado dos veces"
            :ejecutar="anular"
            @hecho="alTerminar"
        />
    </PanelPagina>
</template>
