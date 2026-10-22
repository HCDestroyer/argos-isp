<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { SelectItem, TableColumn } from '@nuxt/ui'

/**
 * Lista de verificación de cierre de un mes (A3, fase 6 PR B): cada check con su estado, esperado y
 * obtenido; «Verificar» los corre (`libro.cerrar_periodo`) y una anomalía se supervisa con nota
 * (acción `cierres.revisar_check`, permiso `libro.cerrar_periodo`) para que el mes se pueda cerrar.
 * Cerrar el mes y el bloqueo duro exigen que todos pasen. Si la lista no se puede leer, se ve el error
 * con «Reintentar» y nada de «en orden».
 */
const props = defineProps<{
    /** Meses que se pueden elegir (AAAA-MM), el más reciente primero. */
    meses: string[]
}>()

const mes = defineModel<string | undefined>('mes', { required: true })

const { puede } = usePermisos()
const toast = useToast()

const itemsMes = computed<SelectItem[]>(() => props.meses.map(m => ({ label: etiquetaPeriodo(m), value: m })))

const lista = shallowRef<ChecksCierre | null>(null)
const cargando = ref(false)
const problema = ref<Problem | null>(null)

async function cargar() {
    const periodo = mes.value
    if (!periodo) {
        return
    }
    cargando.value = true
    const resultado = await useChecksCierre().listar('mensual', periodo)
    // Otro mes elegido mientras tanto: esta respuesta ya no es la que se ve.
    if (periodo !== mes.value) {
        return
    }
    cargando.value = false
    lista.value = resultado.ok ? resultado.data : null
    problema.value = resultado.ok ? null : resultado.problema
}

watch(mes, () => {
    lista.value = null
    void cargar()
}, { immediate: true })

/* Verificar. */
const verificando = ref(false)
const problemaVerificar = ref<Problem | null>(null)

async function verificar() {
    if (!mes.value) {
        return
    }
    verificando.value = true
    problemaVerificar.value = null
    const resultado = await useChecksCierre().verificar('mensual', mes.value, nuevaClaveIdempotencia())
    verificando.value = false
    if (!resultado.ok) {
        problemaVerificar.value = problemaCheckLegible(resultado.problema)
        return
    }
    const anomalias = resultado.data.anomalias.length
    toast.add({
        title: anomalias ? `${anomalias} ${anomalias === 1 ? 'anomalía' : 'anomalías'} sin supervisar` : 'Checks en orden',
        description: `${etiquetaPeriodo(resultado.data.periodo)}: ${resultado.data.checks.length} checks verificados.`,
        icon: anomalias ? 'i-lucide-circle-alert' : 'i-lucide-circle-check',
        color: anomalias ? 'warning' : 'success',
    })
    void cargar()
}

/* Supervisar (con nota) o retirar la supervisión. */
const aRevisar = shallowRef<{ check: CheckCierre, estado: 'supervisado' | 'anomalia' } | null>(null)
const revisando = computed({
    get: () => aRevisar.value !== null,
    set: (valor: boolean) => {
        if (!valor) {
            aRevisar.value = null
        }
    },
})

function revisar(nota: string, clave: string): Promise<Resultado<CheckCierre>> {
    const objetivo = aRevisar.value
    if (!objetivo) {
        return Promise.resolve({ ok: false, problema: { type: 'about:blank', title: 'Sin check', status: 0 } })
    }
    return useChecksCierre().revisar(objetivo.check.id, objetivo.estado, nota, clave)
        .then(r => (r.ok ? r : { ok: false as const, problema: problemaCheckLegible(r.problema) }))
}

function alRevisar(check: CheckCierre) {
    toast.add({
        title: check.estado === 'supervisado' ? 'Anomalía supervisada' : 'Supervisión retirada',
        description: check.estado === 'supervisado' ? `${check.titulo}: el cierre pasa con esta anomalía mientras el cálculo no cambie.` : `${check.titulo} vuelve a bloquear el cierre.`,
        icon: check.estado === 'supervisado' ? 'i-lucide-eye' : 'i-lucide-circle-x',
        color: check.estado === 'supervisado' ? 'success' : 'warning',
    })
    void cargar()
}

const columnas: TableColumn<CheckCierre>[] = [
    { accessorKey: 'titulo', header: 'Check', meta: { class: { td: 'whitespace-normal min-w-56' } } },
    { accessorKey: 'esperado', header: 'Esperado', meta: SOLO_ANCHO },
    { accessorKey: 'obtenido', header: 'Obtenido', meta: SOLO_ANCHO },
    { accessorKey: 'estado', header: 'Estado' },
    { id: 'acciones', header: '', meta: { class: { th: 'hidden sm:table-cell', td: 'hidden sm:table-cell text-right w-0' } } },
]

const resolver = computed(() => (lista.value ? porResolver(lista.value) : 0))

defineExpose({ cargar })
</script>

<template>
    <section
        class="flex flex-col gap-3"
        aria-label="Lista de verificación de cierre"
        data-prueba="checklist-cierre"
    >
        <div class="flex flex-wrap items-center gap-3">
            <h3 class="text-base font-semibold text-highlighted">
                Lista de verificación
            </h3>
            <USelect
                v-model="mes"
                :items="itemsMes"
                aria-label="Mes de la lista de verificación"
                class="w-44"
                data-prueba="checklist-mes"
            />
            <UBadge
                v-if="lista && !problema"
                :label="lista.pasan ? 'El mes pasa la lista' : `${resolver} por resolver`"
                :color="lista.pasan ? 'success' : 'warning'"
                :icon="lista.pasan ? 'i-lucide-circle-check' : 'i-lucide-circle-alert'"
                variant="subtle"
                data-prueba="checklist-resumen"
            />
            <UButton
                v-if="puede('libro.cerrar_periodo')"
                label="Verificar"
                icon="i-lucide-list-checks"
                color="neutral"
                variant="outline"
                class="sm:ml-auto"
                :loading="verificando"
                :disabled="!mes || cargando"
                data-prueba="checklist-verificar"
                @click="verificar"
            />
        </div>
        <p class="text-sm text-muted">
            Cerrar el mes y el bloqueo duro verifican estos checks y exigen que todos estén en orden o supervisados. Un aviso nunca bloquea.
        </p>

        <ProblemaAlerta
            v-if="problemaVerificar"
            :problema="problemaVerificar"
            data-prueba="checklist-verificar-error"
        />
        <ProblemaAlerta
            v-if="problema"
            :problema="problema"
            :reintentar="cargar"
            :reintentando="cargando"
            data-prueba="checklist-error"
        />
        <template v-else>
            <UAlert
                v-if="lista?.sin_verificar.length"
                color="warning"
                variant="subtle"
                icon="i-lucide-list-todo"
                :title="`${lista.sin_verificar.length} ${lista.sin_verificar.length === 1 ? 'check sin verificar' : 'checks sin verificar'}`"
                data-prueba="checklist-sin-verificar"
            >
                <template #description>
                    <ul class="mt-1 flex flex-col gap-0.5">
                        <li
                            v-for="s in lista.sin_verificar"
                            :key="s.clave"
                            :data-clave="s.clave"
                        >
                            {{ s.titulo }}
                        </li>
                    </ul>
                </template>
            </UAlert>
            <UTable
                :data="lista?.checks ?? []"
                :columns="columnas"
                :loading="cargando"
                :ui="{ td: 'py-2.5 align-top' }"
                data-prueba="tabla-checks"
            >
                <template #titulo-cell="{ row }">
                    <div
                        class="flex flex-col gap-0.5"
                        :data-clave="row.original.clave"
                    >
                        <span class="text-sm font-medium text-highlighted">{{ row.original.titulo }}</span>
                        <span class="text-xs tabular-nums text-muted sm:hidden">
                            Esperado {{ row.original.esperado ?? '—' }} · obtenido {{ row.original.obtenido ?? '—' }}
                        </span>
                        <span
                            v-if="detalleCheck(row.original.detalle)"
                            class="text-xs text-muted"
                        >{{ detalleCheck(row.original.detalle) }}</span>
                        <span
                            v-if="row.original.nota"
                            class="text-xs text-muted"
                            data-prueba="check-nota"
                        >
                            {{ row.original.estado === 'supervisado' ? 'Supervisó' : 'Retiró la supervisión' }} {{ row.original.revisado_por_nombre ?? 'Sistema' }} · {{ formatearFechaHora(row.original.created_at) }}: {{ row.original.nota }}
                        </span>
                        <div class="mt-1 flex flex-wrap gap-2 sm:hidden">
                            <UButton
                                v-if="puede('libro.cerrar_periodo') && puedeSupervisarse(row.original)"
                                label="Supervisar"
                                icon="i-lucide-eye"
                                color="warning"
                                variant="outline"
                                size="xs"
                                :data-prueba="`supervisar-${row.original.clave}`"
                                @click="aRevisar = { check: row.original, estado: 'supervisado' }"
                            />
                            <UButton
                                v-if="puede('libro.cerrar_periodo') && puedeRetirarse(row.original)"
                                label="Retirar supervisión"
                                icon="i-lucide-eye-off"
                                color="neutral"
                                variant="ghost"
                                size="xs"
                                :data-prueba="`retirar-${row.original.clave}`"
                                @click="aRevisar = { check: row.original, estado: 'anomalia' }"
                            />
                        </div>
                    </div>
                </template>
                <template #esperado-cell="{ row }">
                    <span class="text-sm tabular-nums">{{ row.original.esperado ?? '—' }}</span>
                </template>
                <template #obtenido-cell="{ row }">
                    <span
                        class="text-sm tabular-nums"
                        :class="row.original.resultado === 'anomalia' ? 'font-medium text-error' : ''"
                    >{{ row.original.obtenido ?? '—' }}</span>
                </template>
                <template #estado-cell="{ row }">
                    <div class="flex flex-wrap gap-1">
                        <UBadge
                            :label="ESTADOS_CHECK[row.original.estado].etiqueta"
                            :color="ESTADOS_CHECK[row.original.estado].color"
                            :icon="ESTADOS_CHECK[row.original.estado].icono"
                            variant="subtle"
                            size="sm"
                            data-prueba="check-estado"
                        />
                        <UBadge
                            v-if="row.original.aviso"
                            label="Aviso"
                            color="info"
                            variant="outline"
                            size="sm"
                        />
                    </div>
                </template>
                <template #acciones-cell="{ row }">
                    <UButton
                        v-if="puede('libro.cerrar_periodo') && puedeSupervisarse(row.original)"
                        label="Supervisar"
                        icon="i-lucide-eye"
                        color="warning"
                        variant="outline"
                        size="sm"
                        :data-prueba="`supervisar-${row.original.clave}`"
                        @click="aRevisar = { check: row.original, estado: 'supervisado' }"
                    />
                    <UButton
                        v-else-if="puede('libro.cerrar_periodo') && puedeRetirarse(row.original)"
                        label="Retirar supervisión"
                        icon="i-lucide-eye-off"
                        color="neutral"
                        variant="ghost"
                        size="sm"
                        :data-prueba="`retirar-${row.original.clave}`"
                        @click="aRevisar = { check: row.original, estado: 'anomalia' }"
                    />
                </template>
                <template #empty>
                    <UEmpty
                        icon="i-lucide-list-checks"
                        :title="mes ? `${etiquetaPeriodo(mes)} sin verificar` : 'Elige un mes'"
                        :description="puede('libro.cerrar_periodo') ? 'Pulsa «Verificar» para correr los checks.' : undefined"
                        variant="naked"
                    />
                </template>
            </UTable>
        </template>

        <AccionMotivoModal
            v-model:open="revisando"
            :titulo="aRevisar?.estado === 'anomalia' ? 'Retirar la supervisión' : 'Supervisar la anomalía'"
            :descripcion="aRevisar ? `${aRevisar.check.titulo} · esperado ${aRevisar.check.esperado ?? '—'}, obtenido ${aRevisar.check.obtenido ?? '—'}` : undefined"
            :efecto="aRevisar?.estado === 'anomalia' ? 'El check vuelve a bloquear el cierre del mes y el bloqueo duro. Tu nota queda en el historial.' : 'El cierre pasa con esta anomalía mientras el cálculo no cambie; si vuelve a verificarse con otros valores, hay que supervisarla de nuevo. Tu nota queda en el historial.'"
            :confirmar="aRevisar?.estado === 'anomalia' ? 'Retirar supervisión' : 'Supervisar'"
            :icono="aRevisar?.estado === 'anomalia' ? 'i-lucide-eye-off' : 'i-lucide-eye'"
            :color="aRevisar?.estado === 'anomalia' ? 'neutral' : 'warning'"
            etiqueta="Nota"
            placeholder="Ej.: el depósito del 31/07 lo acreditó el banco el 03/08"
            :ejecutar="revisar"
            @hecho="alRevisar"
        />
    </section>
</template>
