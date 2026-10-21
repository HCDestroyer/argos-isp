<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { SelectItem, TableColumn } from '@nuxt/ui'

/**
 * Cierre mensual del libro (A3): un mes cerrado no admite asientos con fecha en él (ni egresos
 * ni reversos). Cerrar pide `libro.cerrar_periodo` y confirmación; reabrir pide
 * `libro.reabrir_periodo` y motivo.
 */
const toast = useToast()
const { puede, enlace } = usePermisos()

const lista = usePaginacionCursor(cursor => useLibro().periodos(cursor))
const hoy = hoyGuatemala()
const cerrables = computed(() => mesesCerrables(hoy, lista.filas.value))

const columnas: TableColumn<CierrePeriodo>[] = [
    { accessorKey: 'periodo', header: 'Mes', meta: { class: { td: 'whitespace-normal' } } },
    { id: 'resumen', header: 'Movimiento del mes', meta: SOLO_ANCHO },
    { accessorKey: 'cerrado_en', header: 'Cierre', meta: SOLO_ESCRITORIO },
    { accessorKey: 'estado', header: 'Estado', meta: SOLO_ANCHO },
    { id: 'acciones', header: '', meta: { class: { th: 'hidden sm:table-cell', td: 'hidden sm:table-cell text-right w-0' } } },
]

/* Cerrar: confirmación con el mes elegido. */
const cerrando = ref(false)
const mesACerrar = ref<string | undefined>(undefined)
const enviandoCierre = ref(false)
const problemaCierre = ref<Problem | null>(null)
let claveCierre = nuevaClaveIdempotencia()

/**
 * 409 `ncre_sin_certificar`: una fila de `errors[]` por nota (`field: 'nota_id'`, `message` = estado
 * de su NCRE, `rule` = `dte_id`, y además `nota_id`); se enlazan a su ficha (o a su DTE).
 * 409 `integridad_rota`: se lleva a la pestaña de integridad.
 */
const codigoCierre = computed(() => (problemaCierre.value ? codigoProblema(problemaCierre.value) : null))
const notasSinCertificar = computed(() => (codigoCierre.value === 'ncre_sin_certificar' ? ncreDeProblema(problemaCierre.value) : []))

const itemsMes = computed<SelectItem[]>(() => cerrables.value.map(p => ({ label: etiquetaPeriodo(p), value: p })))

function abrirCierre() {
    mesACerrar.value = cerrables.value[0]
    problemaCierre.value = null
    claveCierre = nuevaClaveIdempotencia()
    cerrando.value = true
}

watch(mesACerrar, () => {
    // Otro mes es otra operación: otra clave.
    claveCierre = nuevaClaveIdempotencia()
    problemaCierre.value = null
})

async function confirmarCierre() {
    if (!mesACerrar.value) {
        return
    }
    enviandoCierre.value = true
    problemaCierre.value = null
    const resultado = await useLibro().cerrarPeriodo(mesACerrar.value, claveCierre)
    enviandoCierre.value = false
    if (!resultado.ok) {
        problemaCierre.value = problemaFelLegible(resultado.problema)
        return
    }
    cerrando.value = false
    toast.add({ title: `${etiquetaPeriodo(resultado.data.periodo)} cerrado`, description: 'Ya no se pueden registrar asientos con fecha en ese mes.', icon: 'i-lucide-lock', color: 'success' })
    void lista.recargar()
}

/* Reabrir: motivo obligatorio. */
const aReabrir = shallowRef<CierrePeriodo | null>(null)
const reabriendo = computed({
    get: () => aReabrir.value !== null,
    set: (valor) => {
        if (!valor) {
            aReabrir.value = null
        }
    },
})

function reabrir(motivo: string, clave: string) {
    if (!aReabrir.value) {
        return Promise.resolve({ ok: false as const, problema: { type: 'about:blank', title: 'Sin mes', status: 0 } })
    }
    // Bajo el bloqueo duro ningún mes se reabre (409 `bloqueo_duro`): el error se ve con su título.
    return useLibro().reabrirPeriodo(aReabrir.value.periodo, motivo, clave)
        .then(r => (r.ok ? r : { ok: false as const, problema: problemaBloqueoLegible(r.problema) }))
}

function alReabrir(cierre: CierrePeriodo) {
    toast.add({ title: `${etiquetaPeriodo(cierre.periodo)} reabierto`, description: 'Se pueden volver a registrar asientos en ese mes.', icon: 'i-lucide-lock-open', color: 'warning' })
    void lista.recargar()
}

onMounted(() => void lista.recargar())
</script>

<template>
    <div class="flex flex-col gap-4">
        <div class="flex flex-wrap items-center gap-3">
            <p class="text-sm text-muted">
                Un mes cerrado no admite asientos con fecha en él: ni facturas, pagos, egresos ni reversos. Las correcciones van en el mes abierto.
            </p>
            <UButton
                v-if="puede('libro.cerrar_periodo')"
                label="Cerrar un mes"
                icon="i-lucide-lock"
                class="sm:ml-auto"
                :disabled="!cerrables.length || lista.cargando.value || lista.problema.value !== null"
                data-prueba="abrir-cerrar-periodo"
                @click="abrirCierre"
            />
        </div>

        <ProblemaAlerta
            v-if="lista.problema.value"
            :problema="lista.problema.value"
            :reintentar="lista.recargar"
            :reintentando="lista.cargando.value"
            data-prueba="cierres-error"
        />
        <template v-else>
            <UTable
                :data="lista.filas.value"
                :columns="columnas"
                :loading="lista.cargando.value"
                :ui="{ td: 'py-2.5' }"
                data-prueba="tabla-cierres"
            >
                <template #periodo-cell="{ row }">
                    <div class="flex flex-col">
                        <span class="text-sm font-medium text-highlighted">{{ etiquetaPeriodo(row.original.periodo) }}</span>
                        <span class="text-xs text-muted lg:hidden">
                            Cerró {{ row.original.cerrado_por_nombre ?? 'Sistema' }} · {{ formatearFechaHora(row.original.cerrado_en) }}
                        </span>
                        <span
                            v-if="row.original.estado === 'reabierto'"
                            class="text-xs text-muted"
                        >
                            Reabrió {{ row.original.reabierto_por_nombre ?? 'Sistema' }} · {{ formatearFechaHora(row.original.reabierto_en) }}<template v-if="row.original.motivo_reapertura">: {{ row.original.motivo_reapertura }}</template>
                        </span>
                        <div class="mt-1.5 flex items-center gap-2 sm:hidden">
                            <UBadge
                                :label="ESTADOS_CIERRE[row.original.estado].etiqueta"
                                :color="ESTADOS_CIERRE[row.original.estado].color"
                                :icon="ESTADOS_CIERRE[row.original.estado].icono"
                                variant="subtle"
                                size="sm"
                            />
                            <UButton
                                v-if="puede('libro.reabrir_periodo') && row.original.estado === 'cerrado'"
                                label="Reabrir"
                                icon="i-lucide-lock-open"
                                color="warning"
                                variant="ghost"
                                size="xs"
                                @click="aReabrir = row.original"
                            />
                        </div>
                    </div>
                </template>
                <template #resumen-cell="{ row }">
                    <span
                        v-if="resumenCierre(row.original).asientos !== null"
                        class="text-sm tabular-nums"
                    >
                        {{ resumenCierre(row.original).asientos }} asientos · Debe {{ formatearQuetzales(resumenCierre(row.original).debe) }} · Haber {{ formatearQuetzales(resumenCierre(row.original).haber) }}
                    </span>
                    <span
                        v-else
                        class="text-sm text-muted"
                    >Sin resumen</span>
                </template>
                <template #cerrado_en-cell="{ row }">
                    <div class="flex flex-col text-sm">
                        <span>{{ formatearFechaHora(row.original.cerrado_en) }}</span>
                        <span class="text-xs text-muted">{{ row.original.cerrado_por_nombre ?? 'Sistema' }}</span>
                    </div>
                </template>
                <template #estado-cell="{ row }">
                    <UBadge
                        :label="ESTADOS_CIERRE[row.original.estado].etiqueta"
                        :color="ESTADOS_CIERRE[row.original.estado].color"
                        :icon="ESTADOS_CIERRE[row.original.estado].icono"
                        variant="subtle"
                        size="sm"
                    />
                </template>
                <template #acciones-cell="{ row }">
                    <UButton
                        v-if="puede('libro.reabrir_periodo') && row.original.estado === 'cerrado'"
                        label="Reabrir"
                        icon="i-lucide-lock-open"
                        color="warning"
                        variant="ghost"
                        size="sm"
                        :data-prueba="`reabrir-${row.original.periodo}`"
                        @click="aReabrir = row.original"
                    />
                </template>
                <template #empty>
                    <UEmpty
                        icon="i-lucide-lock-open"
                        title="Ningún mes cerrado todavía"
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

        <UModal
            v-model:open="cerrando"
            title="Cerrar un mes del libro"
            description="Solo meses ya terminados."
            :dismissible="!enviandoCierre"
        >
            <template #body>
                <div class="flex flex-col gap-4">
                    <UFormField
                        label="Mes"
                        required
                    >
                        <USelect
                            v-model="mesACerrar"
                            :items="itemsMes"
                            class="w-full"
                            data-prueba="mes-a-cerrar"
                        />
                    </UFormField>
                    <UAlert
                        color="warning"
                        variant="subtle"
                        icon="i-lucide-triangle-alert"
                        title="Qué implica cerrar"
                        :description="`Desde que cierres ${mesACerrar ? etiquetaPeriodo(mesACerrar) : 'el mes'}, ningún asiento podrá tener fecha en ese mes: facturas, pagos, egresos y reversos se registran en el mes abierto. Se guarda el resumen de asientos, debe y haber del mes. Solo quien tenga el permiso de reabrir puede deshacerlo, con motivo.`"
                    />
                    <ProblemaAlerta
                        v-if="problemaCierre"
                        :problema="problemaCierre"
                        data-prueba="cierre-error"
                    />
                    <ul
                        v-if="notasSinCertificar.length"
                        class="flex flex-col divide-y divide-default rounded-lg border border-default"
                        data-prueba="cierre-ncre"
                    >
                        <li
                            v-for="nota in notasSinCertificar"
                            :key="nota.dteId"
                            class="flex items-center justify-between gap-2 px-3 py-2"
                        >
                            <ULink
                                v-if="nota.notaId !== null"
                                :to="enlace(`/notas-credito/${nota.notaId}`)"
                                class="text-sm font-medium text-highlighted hover:text-primary"
                            >
                                Nota de crédito #{{ nota.notaId }}
                            </ULink>
                            <ULink
                                v-else
                                :to="enlace(`/dte/${nota.dteId}`)"
                                class="text-sm font-medium text-highlighted hover:text-primary"
                            >
                                NCRE · DTE #{{ nota.dteId }}
                            </ULink>
                            <EstadoDteBadge
                                v-if="nota.estado"
                                :estado="nota.estado"
                                size="sm"
                            />
                        </li>
                    </ul>
                    <div
                        v-if="codigoCierre === 'ncre_sin_certificar' || codigoCierre === 'integridad_rota'"
                        class="flex flex-wrap gap-2"
                    >
                        <UButton
                            v-if="codigoCierre === 'ncre_sin_certificar' && puede('fel.ver')"
                            label="NCRE en la cola de DTE"
                            icon="i-lucide-badge-check"
                            color="neutral"
                            variant="outline"
                            size="sm"
                            :to="enlace('/dte?documento=nota_credito')"
                        />
                        <UButton
                            v-else-if="codigoCierre === 'integridad_rota'"
                            label="Ver integridad del libro"
                            icon="i-lucide-shield-alert"
                            color="neutral"
                            variant="outline"
                            size="sm"
                            :to="enlace('/libro?tab=integridad')"
                            data-prueba="cierre-a-integridad"
                        />
                    </div>
                </div>
            </template>
            <template #footer>
                <div class="flex w-full justify-end gap-2">
                    <UButton
                        label="Cancelar"
                        color="neutral"
                        variant="ghost"
                        :disabled="enviandoCierre"
                        @click="cerrando = false"
                    />
                    <UButton
                        :label="mesACerrar ? `Cerrar ${etiquetaPeriodo(mesACerrar)}` : 'Cerrar mes'"
                        icon="i-lucide-lock"
                        :loading="enviandoCierre"
                        :disabled="!mesACerrar"
                        data-prueba="confirmar-cierre"
                        @click="confirmarCierre"
                    />
                </div>
            </template>
        </UModal>

        <AccionMotivoModal
            v-model:open="reabriendo"
            :titulo="aReabrir ? `Reabrir ${etiquetaPeriodo(aReabrir.periodo)}` : 'Reabrir mes'"
            efecto="El mes vuelve a admitir asientos con fecha en él. El cierre anterior queda en el historial como reabierto, con tu motivo."
            confirmar="Reabrir mes"
            icono="i-lucide-lock-open"
            color="warning"
            placeholder="Ej.: falta registrar la factura de energía de septiembre"
            :ejecutar="reabrir"
            @hecho="alReabrir"
        />
    </div>
</template>
