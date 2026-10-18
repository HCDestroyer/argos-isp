<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { TableColumn } from '@nuxt/ui'

/**
 * Un extracto y sus líneas (A3, fase 4 §10.3): conciliar cada línea con el libro, depósitos o
 * traslados; registrar las que no tienen documento (comisión, interés); deshacer una conciliación
 * con motivo; y aplicar las reglas de conciliación (`bancos.conciliar`).
 */
definePageMeta({ permiso: 'bancos.ver' })

const route = useRoute()
const toast = useToast()
const { puede, enlace } = usePermisos()

const extractoId = computed(() => Number(route.params.id))
const extracto = shallowRef<Extracto | null>(null)
const lineas = shallowRef<LineaExtracto[]>([])
const cargando = ref(true)
const problema = ref<Problem | null>(null)

const aplicando = ref(false)
const resultadoReglas = shallowRef<ResultadoAplicarReglas | null>(null)
const problemaReglas = ref<Problem | null>(null)

const aConciliar = shallowRef<LineaExtracto | null>(null)
const aRegistrar = shallowRef<LineaExtracto | null>(null)
const aAnular = shallowRef<LineaExtracto | null>(null)

function modelo(referencia: typeof aConciliar) {
    return computed({
        get: () => referencia.value !== null,
        set: (valor: boolean) => {
            if (!valor) {
                referencia.value = null
            }
        },
    })
}
const conciliando = modelo(aConciliar)
const registrando = modelo(aRegistrar)
const anulando = modelo(aAnular)

useHead(() => ({ title: `Extracto #${route.params.id} · ArgosIsp` }))

const pendientes = computed(() => lineas.value.filter(l => !l.conciliada).length)

const columnas: TableColumn<LineaExtracto>[] = [
    { accessorKey: 'descripcion', header: 'Línea' },
    { accessorKey: 'monto', header: 'Monto', meta: { class: { th: 'text-right', td: 'text-right' } } },
    { accessorKey: 'conciliada', header: 'Conciliación', meta: SOLO_ANCHO },
    { id: 'acciones', header: '', meta: { class: { th: 'hidden sm:table-cell', td: 'hidden sm:table-cell text-right w-0' } } },
]

async function cargar() {
    cargando.value = true
    problema.value = null
    const [rExtracto, rLineas] = await Promise.all([useExtractos().ver(extractoId.value), useExtractos().lineas(extractoId.value)])
    cargando.value = false
    if (!rExtracto.ok || !rLineas.ok) {
        extracto.value = null
        lineas.value = []
        problema.value = !rExtracto.ok ? rExtracto.problema : (!rLineas.ok ? rLineas.problema : null)
        return
    }
    extracto.value = rExtracto.data
    lineas.value = rLineas.data
}

async function aplicarReglas() {
    aplicando.value = true
    problemaReglas.value = null
    const resultado = await useExtractos().aplicarReglas(extractoId.value, nuevaClaveIdempotencia())
    aplicando.value = false
    if (!resultado.ok) {
        problemaReglas.value = resultado.problema
        return
    }
    resultadoReglas.value = resultado.data
    void cargar()
}

function alConciliar(conciliacion: Conciliacion) {
    toast.add({ title: 'Línea conciliada', description: `${conciliacion.movimientos.length} ${conciliacion.movimientos.length === 1 ? 'movimiento' : 'movimientos'} · ${formatearQuetzales(conciliacion.monto)}`, icon: 'i-lucide-link', color: 'success' })
    void cargar()
}

function alRegistrar(conciliacion: Conciliacion) {
    toast.add({ title: 'Línea registrada y conciliada', description: `Asiento #${conciliacion.movimientos[0]?.asiento_id ?? '—'} · ${formatearQuetzales(conciliacion.monto)}`, icon: 'i-lucide-file-plus', color: 'success' })
    void cargar()
}

function anularSeleccionada(motivo: string, clave: string) {
    const id = aAnular.value?.conciliacion_id
    if (!id) {
        return Promise.resolve({ ok: false as const, problema: { type: 'about:blank', title: 'La línea no está conciliada', status: 0 } })
    }
    return useConciliaciones().anular(id, motivo, clave)
}

function alAnular() {
    toast.add({ title: 'Conciliación deshecha', description: 'La línea y sus movimientos vuelven a estar por conciliar.', icon: 'i-lucide-unlink', color: 'neutral' })
    void cargar()
}

watch(extractoId, cargar)
onMounted(cargar)
</script>

<template>
    <PanelPagina
        id="extracto"
        :titulo="`Extracto #${route.params.id}`"
        icono="i-lucide-file-spreadsheet"
    >
        <template #acciones>
            <UButton
                to="/bancos/extractos"
                icon="i-lucide-arrow-left"
                label="Extractos"
                color="neutral"
                variant="ghost"
                class="hidden sm:inline-flex"
            />
            <UButton
                v-if="puede('bancos.conciliar') && extracto"
                label="Aplicar reglas"
                icon="i-lucide-wand-sparkles"
                :loading="aplicando"
                :disabled="!pendientes"
                :ui="{ label: 'hidden sm:inline' }"
                aria-label="Aplicar reglas"
                data-prueba="aplicar-reglas"
                @click="aplicarReglas"
            />
        </template>

        <USkeleton
            v-if="cargando && !extracto"
            class="h-40 w-full"
        />
        <UEmpty
            v-else-if="problema?.status === 404"
            icon="i-lucide-file-x"
            title="Extracto no encontrado"
            :actions="[{ label: 'Volver', to: '/bancos/extractos', icon: 'i-lucide-arrow-left', color: 'neutral', variant: 'subtle' }]"
        />
        <ProblemaAlerta
            v-else-if="problema"
            :problema="problema"
            :reintentar="cargar"
            :reintentando="cargando"
        />

        <div
            v-else-if="extracto"
            class="flex flex-col gap-6"
        >
            <UPageCard
                variant="subtle"
                :title="extracto.cuenta_nombre"
                :description="`${extracto.cuenta_codigo} · ${formatearFecha(extracto.desde)} → ${formatearFecha(extracto.hasta)}`"
                icon="i-lucide-landmark"
            >
                <dl class="grid grid-cols-2 gap-x-6 gap-y-4 lg:grid-cols-4">
                    <DatoFicha
                        etiqueta="Saldo inicial"
                        :valor="formatearQuetzales(extracto.saldo_inicial)"
                    />
                    <DatoFicha
                        etiqueta="Saldo final"
                        :valor="formatearQuetzales(extracto.saldo_final)"
                    />
                    <DatoFicha etiqueta="Conciliadas">
                        <UBadge
                            :label="`${lineas.length - pendientes} de ${lineas.length}`"
                            :color="pendientes ? 'warning' : 'success'"
                            variant="subtle"
                            data-prueba="avance-conciliacion"
                        />
                    </DatoFicha>
                    <DatoFicha
                        etiqueta="Archivo"
                        :valor="extracto.archivo"
                    />
                    <DatoFicha
                        v-if="extracto.sha256"
                        etiqueta="sha256"
                        :valor="extracto.sha256"
                        mono
                        class="col-span-2 break-all"
                    />
                    <DatoFicha
                        v-if="extracto.motivo_no_encadena"
                        etiqueta="Importado sin encadenar"
                        :valor="extracto.motivo_no_encadena"
                        class="col-span-2"
                    />
                </dl>
            </UPageCard>

            <ProblemaAlerta
                v-if="problemaReglas"
                :problema="problemaReglas"
                :reintentar="aplicarReglas"
                :reintentando="aplicando"
            />
            <UAlert
                v-else-if="resultadoReglas"
                :color="resultadoReglas.conciliadas.length ? 'success' : 'neutral'"
                variant="subtle"
                icon="i-lucide-wand-sparkles"
                :title="`Reglas aplicadas: ${resultadoReglas.conciliadas.length} ${resultadoReglas.conciliadas.length === 1 ? 'línea conciliada' : 'líneas conciliadas'}`"
                :description="[
                    resultadoReglas.sin_regla.length ? `${resultadoReglas.sin_regla.length} sin regla que aplique` : null,
                    resultadoReglas.sin_pago.length ? `${resultadoReglas.sin_pago.length} con regla de cliente sin un pago único que coincida` : null,
                ].filter(Boolean).join(' · ') || undefined"
                data-prueba="resultado-reglas"
            />

            <UTable
                :data="lineas"
                :columns="columnas"
                :loading="cargando"
                data-prueba="tabla-lineas"
            >
                <template #descripcion-cell="{ row }">
                    <div class="flex min-w-0 flex-col whitespace-normal">
                        <span class="text-sm font-medium text-highlighted">{{ row.original.descripcion }}</span>
                        <span class="text-xs text-muted">{{ formatearFecha(row.original.fecha) }}<template v-if="row.original.referencia"> · ref. <span class="break-all">{{ row.original.referencia }}</span></template><template v-if="row.original.saldo"> · saldo {{ formatearQuetzales(row.original.saldo) }}</template></span>
                        <ul
                            v-if="row.original.movimientos.length"
                            class="mt-1 flex flex-col gap-0.5 text-xs text-muted"
                        >
                            <li
                                v-for="movimiento in row.original.movimientos"
                                :key="movimiento.movimiento_id"
                            >
                                <UIcon
                                    name="i-lucide-link"
                                    class="size-3"
                                />
                                {{ ORIGENES_ASIENTO[movimiento.origen_tipo as OrigenAsiento]?.etiqueta ?? movimiento.origen_tipo }} · {{ movimiento.descripcion }} · {{ formatearQuetzales(movimiento.monto) }}
                            </li>
                        </ul>
                        <span class="mt-1 sm:hidden">
                            <UBadge
                                :label="row.original.conciliada ? 'Conciliada' : 'Por conciliar'"
                                :color="row.original.conciliada ? 'success' : 'warning'"
                                variant="subtle"
                                size="sm"
                            />
                        </span>
                        <div
                            v-if="puede('bancos.conciliar')"
                            class="mt-1 flex flex-wrap gap-1 sm:hidden"
                        >
                            <template v-if="!row.original.conciliada">
                                <UButton
                                    label="Conciliar"
                                    icon="i-lucide-link"
                                    size="xs"
                                    variant="soft"
                                    @click="aConciliar = row.original"
                                />
                                <UButton
                                    label="Registrar"
                                    icon="i-lucide-file-plus"
                                    size="xs"
                                    color="neutral"
                                    variant="ghost"
                                    @click="aRegistrar = row.original"
                                />
                            </template>
                            <UButton
                                v-else
                                label="Deshacer"
                                icon="i-lucide-unlink"
                                size="xs"
                                color="error"
                                variant="ghost"
                                @click="aAnular = row.original"
                            />
                        </div>
                    </div>
                </template>
                <template #monto-cell="{ row }">
                    <span
                        class="whitespace-nowrap tabular-nums font-medium"
                        :class="row.original.monto.startsWith('-') ? 'text-error' : 'text-success'"
                    >{{ montoConSigno(row.original.monto) }}</span>
                </template>
                <template #conciliada-cell="{ row }">
                    <UBadge
                        :label="row.original.conciliada ? 'Conciliada' : 'Por conciliar'"
                        :color="row.original.conciliada ? 'success' : 'warning'"
                        :icon="row.original.conciliada ? 'i-lucide-link' : 'i-lucide-circle-dashed'"
                        variant="subtle"
                        size="sm"
                        :data-linea="row.original.id"
                    />
                </template>
                <template #acciones-cell="{ row }">
                    <div
                        v-if="puede('bancos.conciliar')"
                        class="flex justify-end gap-1"
                    >
                        <template v-if="!row.original.conciliada">
                            <UButton
                                label="Conciliar"
                                icon="i-lucide-link"
                                size="sm"
                                variant="soft"
                                :data-conciliar="row.original.id"
                                @click="aConciliar = row.original"
                            />
                            <UButton
                                label="Registrar"
                                icon="i-lucide-file-plus"
                                size="sm"
                                color="neutral"
                                variant="ghost"
                                :data-registrar="row.original.id"
                                @click="aRegistrar = row.original"
                            />
                        </template>
                        <UButton
                            v-else
                            icon="i-lucide-unlink"
                            size="sm"
                            color="error"
                            variant="ghost"
                            :aria-label="`Deshacer la conciliación de la línea ${row.original.orden}`"
                            :data-deshacer="row.original.id"
                            @click="aAnular = row.original"
                        />
                    </div>
                </template>
                <template #empty>
                    <UEmpty
                        icon="i-lucide-list"
                        title="El extracto no tiene líneas"
                        variant="naked"
                    />
                </template>
            </UTable>

            <p class="text-xs text-muted">
                Conciliar nunca reescribe asientos: liga la línea con lo que ya está en el libro. Deshacer deja la anulación con su motivo.
                <ULink
                    :to="enlace(`/bancos/conciliacion?cuenta=${extracto.cuenta_id}`)"
                    class="underline"
                >Ver el reporte de esta cuenta</ULink>.
            </p>
        </div>

        <ConciliarLineaSlideover
            v-if="aConciliar"
            v-model:open="conciliando"
            :linea="aConciliar"
            @hecho="alConciliar"
        />
        <LineaRegistrarModal
            v-if="aRegistrar"
            v-model:open="registrando"
            :linea="aRegistrar"
            @hecho="alRegistrar"
        />
        <AccionMotivoModal
            v-model:open="anulando"
            titulo="Deshacer conciliación"
            :descripcion="aAnular ? `${formatearFecha(aAnular.fecha)} · ${aAnular.descripcion} · ${montoConSigno(aAnular.monto)}` : undefined"
            efecto="La línea y sus movimientos vuelven a estar por conciliar. La llegada de un depósito o traslado ya registrada no se revierte (el dinero llegó)."
            confirmar="Deshacer conciliación"
            icono="i-lucide-unlink"
            placeholder="Ej.: se concilió con la liquidación equivocada"
            :ejecutar="anularSeleccionada"
            @hecho="alAnular"
        />
    </PanelPagina>
</template>
