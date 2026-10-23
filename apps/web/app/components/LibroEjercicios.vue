<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'

/**
 * Ejercicios anuales (A3, fase 6 PR C y fase 7 PR C; `GET /libro/ejercicios`, `libro.ver`): cada cierre
 * con su ISR (de la declaración ISR anual o escrito a mano), resultado y reserva legal, y sus
 * reaperturas. «Cerrar ejercicio» (`libro.cerrar_ejercicio`) y «Reabrir» (`libro.reabrir_ejercicio`,
 * con motivo; revierte los asientos del cierre).
 */
const toast = useToast()
const { puede } = usePermisos()
const { conSelector, eleccion, empresaId, empresas, nombre: nombreEmpresa } = useEmpresaActiva()
const consolidado = computed(() => conSelector.value && eleccion.value === 'todas')
const empresa = computed<number | null>(() => empresaId.value ?? (conSelector.value ? null : (empresas.value[0]?.id ?? null)))

const lista = usePaginacionCursor(cursor => (puede('libro.ver') ? useEjercicios().listar(cursor) : Promise.resolve({ ok: true as const, data: { data: [], nextCursor: null } })))
watch(eleccion, () => void lista.recargar())
onMounted(() => void lista.recargar())

const columnas: TableColumn<CierreAnual>[] = [
    { accessorKey: 'anio', header: 'Ejercicio', meta: { class: { td: 'whitespace-normal' } } },
    { accessorKey: 'isr', header: 'ISR', meta: { class: { th: 'text-right', td: 'text-right tabular-nums' } } },
    { accessorKey: 'resultado', header: 'Resultado', meta: { class: { th: 'hidden sm:table-cell text-right', td: 'hidden sm:table-cell text-right tabular-nums' } } },
    { accessorKey: 'reserva_legal', header: 'Reserva legal', meta: SOLO_ESCRITORIO },
    { id: 'acciones', header: '', meta: { class: { th: 'w-0', td: 'text-right' } } },
]

const cerrando = ref(false)
const aReabrir = shallowRef<CierreAnual | null>(null)
const reabriendo = computed({
    get: () => aReabrir.value !== null,
    set: (valor: boolean) => {
        if (!valor) {
            aReabrir.value = null
        }
    },
})

function reabrir(motivo: string, clave: string): Promise<Resultado<CierreAnual>> {
    const cierre = aReabrir.value
    if (!cierre) {
        return Promise.resolve({ ok: false, problema: { type: 'about:blank', title: 'Sin cierre', status: 0 } })
    }
    return useEjercicios().reabrir({ empresa_id: cierre.empresa_id, anio: cierre.anio, motivo }, clave)
        .then(r => (r.ok ? r : { ok: false as const, problema: problemaDeclaracionLegible(r.problema) }))
}

function alCerrar(cierre: CierreAnual) {
    toast.add({
        title: `Ejercicio ${cierre.anio} cerrado`,
        description: `ISR ${formatearQuetzales(cierre.isr)} · resultado ${formatearQuetzales(cierre.resultado)} · reserva legal ${formatearQuetzales(cierre.reserva_legal)}.`,
        icon: 'i-lucide-lock',
        color: 'success',
    })
    void lista.recargar()
}

function alReabrir(cierre: CierreAnual) {
    toast.add({ title: `Ejercicio ${cierre.anio} reabierto`, description: 'Se revirtieron los asientos del cierre y diciembre vuelve a estar abierto.', icon: 'i-lucide-lock-open', color: 'warning' })
    void lista.recargar()
}
</script>

<template>
    <section
        class="flex flex-col gap-3"
        aria-label="Ejercicios anuales"
        data-prueba="libro-ejercicios"
    >
        <div class="flex flex-wrap items-center justify-between gap-2">
            <p class="text-sm text-muted">
                El cierre anual va con fecha 31 de diciembre. Con declaración ISR anual revisada, el ISR sale de ella.
            </p>
            <UButton
                v-if="puede('libro.cerrar_ejercicio')"
                label="Cerrar ejercicio"
                icon="i-lucide-lock"
                :disabled="empresa === null"
                data-prueba="abrir-cerrar-ejercicio"
                @click="cerrando = true"
            />
        </div>
        <p
            v-if="puede('libro.cerrar_ejercicio') && empresa === null"
            class="text-sm text-muted"
        >
            Con «Todas» se ven los de todas las empresas; para cerrar un ejercicio, elija la empresa en el selector de arriba.
        </p>

        <ProblemaAlerta
            v-if="lista.problema.value"
            :problema="lista.problema.value"
            :reintentar="lista.recargar"
            :reintentando="lista.cargando.value"
        />
        <template v-else>
            <UTable
                :data="lista.filas.value"
                :columns="columnas"
                :loading="lista.cargando.value"
                data-prueba="tabla-ejercicios"
            >
                <template #anio-cell="{ row }">
                    <div
                        class="flex min-w-0 flex-col gap-0.5"
                        :data-ejercicio="row.original.anio"
                        :data-estado="row.original.estado"
                    >
                        <span class="flex items-center gap-2">
                            <span class="text-sm font-medium text-highlighted">{{ row.original.anio }}</span>
                            <UBadge
                                :label="row.original.estado === 'cerrado' ? 'Cerrado' : 'Reabierto'"
                                :color="row.original.estado === 'cerrado' ? 'success' : 'warning'"
                                :icon="row.original.estado === 'cerrado' ? 'i-lucide-lock' : 'i-lucide-lock-open'"
                                variant="subtle"
                                size="sm"
                            />
                        </span>
                        <span class="text-xs text-muted">
                            Cerró {{ row.original.cerrado_por_nombre ?? 'Sistema' }} · {{ formatearFechaHora(row.original.cerrado_en) }}<template v-if="consolidado"> · {{ nombreEmpresa(row.original.empresa_id) }}</template>
                        </span>
                        <span
                            v-if="row.original.isr_nota"
                            class="text-xs text-muted"
                            data-prueba="ejercicio-isr-nota"
                        >ISR: {{ row.original.isr_nota }}</span>
                        <span
                            v-if="row.original.estado === 'reabierto'"
                            class="text-xs text-muted"
                        >Reabrió {{ row.original.reabierto_por_nombre ?? '—' }} · {{ formatearFechaHora(row.original.reabierto_en) }}: {{ row.original.motivo_reapertura }}</span>
                        <span class="text-xs text-muted sm:hidden">Resultado {{ formatearQuetzales(row.original.resultado) }}</span>
                    </div>
                </template>
                <template #isr-cell="{ row }">
                    {{ formatearQuetzales(row.original.isr) }}
                </template>
                <template #resultado-cell="{ row }">
                    <span :class="row.original.resultado.startsWith('-') ? 'text-error' : ''">{{ formatearQuetzales(row.original.resultado) }}</span>
                </template>
                <template #reserva_legal-cell="{ row }">
                    {{ formatearQuetzales(row.original.reserva_legal) }}
                </template>
                <template #acciones-cell="{ row }">
                    <UButton
                        v-if="row.original.estado === 'cerrado' && puede('libro.reabrir_ejercicio')"
                        label="Reabrir"
                        icon="i-lucide-lock-open"
                        color="neutral"
                        variant="ghost"
                        size="sm"
                        :aria-label="`Reabrir el ejercicio ${row.original.anio}`"
                        @click="aReabrir = row.original"
                    />
                </template>
                <template #empty>
                    <UEmpty
                        icon="i-lucide-calendar-range"
                        title="Sin ejercicios cerrados"
                        variant="naked"
                    />
                </template>
            </UTable>
            <PaginacionCursor
                :pagina="lista.pagina.value"
                :hay-anterior="lista.hayAnterior.value"
                :hay-siguiente="lista.haySiguiente.value"
                :cargando="lista.cargando.value"
                :filas="lista.filas.value.length"
                @anterior="lista.anterior"
                @siguiente="lista.siguiente"
            />
        </template>

        <CerrarEjercicioModal
            v-if="puede('libro.cerrar_ejercicio') && empresa !== null"
            v-model:open="cerrando"
            :empresa-id="empresa"
            @hecho="alCerrar"
        />
        <AccionMotivoModal
            v-if="puede('libro.reabrir_ejercicio')"
            v-model:open="reabriendo"
            :titulo="aReabrir ? `Reabrir el ejercicio ${aReabrir.anio}` : 'Reabrir ejercicio'"
            efecto="Revierte los asientos del cierre con fecha 31 de diciembre y reabre diciembre. El cierre queda en el historial como reabierto, con tu motivo."
            confirmar="Reabrir ejercicio"
            icono="i-lucide-lock-open"
            color="warning"
            :ejecutar="reabrir"
            @hecho="alReabrir"
        />
    </section>
</template>
