<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { SelectItem, TableColumn } from '@nuxt/ui'

/**
 * Fondos en tránsito 1.1.11 (A3, fase 4 §10.3): el saldo del libro contra lo pendiente de acreditar,
 * los depósitos de caja y los traslados entre bancos con su estado, y "Trasladar"
 * (`bancos.trasladar`). Un depósito o traslado pasa a acreditado al conciliar su línea del extracto.
 */
definePageMeta({ permiso: 'bancos.ver' })

useHead({ title: 'Fondos en tránsito · ArgosIsp' })

const toast = useToast()
const { puede, enlace } = usePermisos()
const { empresas } = useEmpresaActiva()

const TODOS = 'todos'
const resumen = shallowRef<ResumenFondosEnTransito[]>([])
const cargando = ref(true)
const problema = ref<Problem | null>(null)
const estado = ref<EstadoTransito | typeof TODOS>('en_transito')
const trasladando = ref(false)

const itemsEstado: SelectItem[] = [
    { label: 'En tránsito', value: 'en_transito' },
    { label: 'Acreditados', value: 'acreditado' },
    { label: 'Todos', value: TODOS },
]

const filtroEstado = () => (estado.value === TODOS ? undefined : estado.value)
const depositos = usePaginacionCursor(cursor => useFondosEnTransito().depositos(filtroEstado(), cursor))
/** `GET /bancos/depositos` pide `cajas.ver` (A3, fase 4 final), además del `bancos.ver` de la página. */
const leeDepositos = computed(() => puede('cajas.ver'))

function recargarDepositos() {
    if (leeDepositos.value) {
        void depositos.recargar()
    }
}
const traslados = usePaginacionCursor(cursor => useFondosEnTransito().traslados(filtroEstado(), cursor))

const columnasDepositos: TableColumn<Deposito>[] = [
    { accessorKey: 'boleta', header: 'Depósito' },
    { accessorKey: 'cuenta_nombre', header: 'Cuenta', meta: SOLO_ESCRITORIO },
    { accessorKey: 'estado', header: 'Estado', meta: SOLO_ANCHO },
    { accessorKey: 'monto', header: 'Monto', meta: { class: { th: 'text-right', td: 'text-right' } } },
]

const columnasTraslados: TableColumn<Traslado>[] = [
    { accessorKey: 'referencia', header: 'Traslado' },
    { accessorKey: 'estado', header: 'Estado', meta: SOLO_ANCHO },
    { accessorKey: 'monto', header: 'Monto', meta: { class: { th: 'text-right', td: 'text-right' } } },
]

function nombreEmpresa(id: number): string {
    return empresas.value.find(e => e.id === id)?.nombre_comercial ?? `Empresa ${id}`
}

async function cargarResumen() {
    cargando.value = true
    const resultado = await useFondosEnTransito().resumen()
    cargando.value = false
    resumen.value = resultado.ok ? resultado.data : []
    problema.value = resultado.ok ? null : resultado.problema
}

function recargarTodo() {
    void cargarResumen()
    recargarDepositos()
    void traslados.recargar()
}

function alTrasladar(traslado: Traslado) {
    toast.add({
        title: `Traslado ${traslado.referencia} registrado`,
        description: `${formatearQuetzales(traslado.monto)} de ${traslado.cuenta_origen_codigo} a ${traslado.cuenta_destino_codigo}: en tránsito hasta conciliar el extracto.`,
        icon: 'i-lucide-arrow-right-left',
        color: 'success',
    })
    recargarTodo()
}

watch(estado, () => {
    recargarDepositos()
    void traslados.recargar()
})

onMounted(recargarTodo)
</script>

<template>
    <PanelPagina
        id="fondos-transito"
        titulo="Fondos en tránsito"
        icono="i-lucide-truck"
    >
        <template #acciones>
            <UButton
                v-if="puede('bancos.trasladar')"
                label="Trasladar"
                icon="i-lucide-arrow-right-left"
                :ui="{ label: 'hidden sm:inline' }"
                aria-label="Trasladar entre bancos"
                data-prueba="abrir-traslado"
                @click="trasladando = true"
            />
        </template>

        <div class="flex flex-col gap-6">
            <ProblemaAlerta
                v-if="problema"
                :problema="problema"
                :reintentar="cargarResumen"
                :reintentando="cargando"
            />
            <USkeleton
                v-else-if="cargando && !resumen.length"
                class="h-24 w-full"
            />
            <div
                v-else
                class="grid gap-3 sm:grid-cols-2"
            >
                <UPageCard
                    v-for="fila in resumen"
                    :key="fila.empresa_id"
                    variant="subtle"
                    data-prueba="resumen-transito"
                >
                    <div class="flex flex-col gap-3">
                        <div class="flex items-center justify-between gap-2">
                            <span class="text-sm font-medium text-highlighted">{{ resumen.length > 1 ? nombreEmpresa(fila.empresa_id) : '1.1.11 Fondos en tránsito' }}</span>
                            <UBadge
                                :label="fila.cuadra ? 'Cuadra' : `Diferencia ${formatearQuetzales(fila.diferencia)}`"
                                :color="fila.cuadra ? 'success' : 'error'"
                                :icon="fila.cuadra ? 'i-lucide-circle-check' : 'i-lucide-circle-alert'"
                                variant="subtle"
                                size="sm"
                            />
                        </div>
                        <dl class="grid grid-cols-2 gap-3">
                            <DatoFicha
                                etiqueta="Saldo del libro"
                                :valor="formatearQuetzales(fila.saldo_libro)"
                            />
                            <DatoFicha
                                etiqueta="Por acreditar"
                                :valor="formatearQuetzales(fila.pendiente)"
                            />
                            <DatoFicha
                                etiqueta="Depósitos en tránsito"
                                :valor="fila.depositos"
                            />
                            <DatoFicha
                                etiqueta="Traslados en tránsito"
                                :valor="fila.traslados"
                            />
                        </dl>
                    </div>
                </UPageCard>
                <UEmpty
                    v-if="!resumen.length"
                    icon="i-lucide-truck"
                    title="Nada en tránsito"
                    variant="naked"
                />
            </div>

            <div class="flex flex-wrap items-center gap-3">
                <USelect
                    v-model="estado"
                    :items="itemsEstado"
                    aria-label="Estado"
                    class="w-full sm:w-48"
                />
                <p class="text-xs text-muted">
                    Se acreditan al conciliar su línea en la
                    <ULink
                        :to="enlace('/bancos/extractos')"
                        class="underline"
                    >conciliación bancaria</ULink>.
                </p>
            </div>

            <section class="flex flex-col gap-2">
                <h3 class="text-sm font-semibold text-highlighted">
                    Depósitos de caja
                </h3>
                <UAlert
                    v-if="!leeDepositos"
                    color="neutral"
                    variant="subtle"
                    icon="i-lucide-lock"
                    title="Sin acceso a los depósitos de caja"
                    description="Para verlos tu usuario necesita el permiso cajas.ver."
                    data-prueba="depositos-sin-permiso"
                />
                <ProblemaAlerta
                    v-else-if="depositos.problema.value"
                    :problema="depositos.problema.value"
                    :reintentar="depositos.recargar"
                    :reintentando="depositos.cargando.value"
                />
                <template v-else>
                    <UTable
                        :data="depositos.filas.value"
                        :columns="columnasDepositos"
                        :loading="depositos.cargando.value"
                        data-prueba="tabla-depositos"
                    >
                        <template #boleta-cell="{ row }">
                            <div class="flex min-w-0 flex-col">
                                <span class="text-sm font-medium text-highlighted">#{{ row.original.id }} · boleta {{ row.original.boleta }}</span>
                                <span class="text-xs text-muted">{{ row.original.caja_nombre }} · turno #{{ row.original.turno_id }} · {{ formatearFecha(row.original.fecha) }}</span>
                                <span class="text-xs text-muted lg:hidden">{{ row.original.cuenta_nombre }}</span>
                                <span
                                    v-if="row.original.acreditado_en"
                                    class="text-xs text-muted"
                                >Acreditado {{ formatearFechaHora(row.original.acreditado_en) }}</span>
                            </div>
                        </template>
                        <template #cuenta_nombre-cell="{ row }">
                            <span class="text-sm">{{ row.original.cuenta_nombre }}</span>
                        </template>
                        <template #estado-cell="{ row }">
                            <UBadge
                                :label="ESTADOS_TRANSITO[row.original.estado].etiqueta"
                                :color="ESTADOS_TRANSITO[row.original.estado].color"
                                :icon="ESTADOS_TRANSITO[row.original.estado].icono"
                                variant="subtle"
                                size="sm"
                            />
                        </template>
                        <template #monto-cell="{ row }">
                            <span class="whitespace-nowrap tabular-nums font-medium text-highlighted">{{ formatearQuetzales(row.original.monto) }}</span>
                        </template>
                        <template #empty>
                            <UEmpty
                                icon="i-lucide-landmark"
                                title="Sin depósitos"
                                variant="naked"
                            />
                        </template>
                    </UTable>
                    <PaginacionCursor
                        :pagina="depositos.pagina.value"
                        :hay-anterior="depositos.hayAnterior.value"
                        :hay-siguiente="depositos.haySiguiente.value"
                        :cargando="depositos.cargando.value"
                        :filas="depositos.filas.value.length"
                        @anterior="depositos.anterior"
                        @siguiente="depositos.siguiente"
                    />
                </template>
            </section>

            <section class="flex flex-col gap-2">
                <h3 class="text-sm font-semibold text-highlighted">
                    Traslados entre bancos
                </h3>
                <ProblemaAlerta
                    v-if="traslados.problema.value"
                    :problema="traslados.problema.value"
                    :reintentar="traslados.recargar"
                    :reintentando="traslados.cargando.value"
                />
                <template v-else>
                    <UTable
                        :data="traslados.filas.value"
                        :columns="columnasTraslados"
                        :loading="traslados.cargando.value"
                        data-prueba="tabla-traslados"
                    >
                        <template #referencia-cell="{ row }">
                            <div class="flex min-w-0 flex-col">
                                <span class="text-sm font-medium text-highlighted">#{{ row.original.id }} · {{ row.original.referencia }}</span>
                                <span class="text-xs text-muted"><span class="font-mono">{{ row.original.cuenta_origen_codigo }}</span> → <span class="font-mono">{{ row.original.cuenta_destino_codigo }}</span> · {{ formatearFecha(row.original.fecha) }}</span>
                            </div>
                        </template>
                        <template #estado-cell="{ row }">
                            <UBadge
                                :label="ESTADOS_TRANSITO[row.original.estado].etiqueta"
                                :color="ESTADOS_TRANSITO[row.original.estado].color"
                                :icon="ESTADOS_TRANSITO[row.original.estado].icono"
                                variant="subtle"
                                size="sm"
                            />
                        </template>
                        <template #monto-cell="{ row }">
                            <span class="whitespace-nowrap tabular-nums font-medium text-highlighted">{{ formatearQuetzales(row.original.monto) }}</span>
                        </template>
                        <template #empty>
                            <UEmpty
                                icon="i-lucide-arrow-right-left"
                                title="Sin traslados"
                                variant="naked"
                            />
                        </template>
                    </UTable>
                    <PaginacionCursor
                        :pagina="traslados.pagina.value"
                        :hay-anterior="traslados.hayAnterior.value"
                        :hay-siguiente="traslados.haySiguiente.value"
                        :cargando="traslados.cargando.value"
                        :filas="traslados.filas.value.length"
                        @anterior="traslados.anterior"
                        @siguiente="traslados.siguiente"
                    />
                </template>
            </section>
        </div>

        <TrasladoModal
            v-if="puede('bancos.trasladar')"
            v-model:open="trasladando"
            @hecho="alTrasladar"
        />
    </PanelPagina>
</template>
