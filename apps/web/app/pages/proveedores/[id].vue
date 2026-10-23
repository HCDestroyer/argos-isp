<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { TabsItem, TableColumn } from '@nuxt/ui'
import Decimal from 'decimal.js'

/**
 * Ficha del proveedor (A3, fase 5): datos (editar con `proveedores.editar`), estado de cuenta de su
 * auxiliar en 2.1.03 con lo pendiente y su antigüedad, sus compras y sus pagos (anular con
 * `compras.pagar`). «Registrar compra» (`compras.registrar`) y «Registrar pago» (`compras.pagar`).
 */
definePageMeta({ permiso: 'proveedores.ver' })

const route = useRoute()
const router = useRouter()
const toast = useToast()
const { puede } = usePermisos()

const id = computed(() => Number(route.params.id))
const proveedor = shallowRef<Proveedor | null>(null)
const problema = ref<Problem | null>(null)
const cargando = ref(false)

useHead(() => ({ title: `${proveedor.value?.nombre ?? 'Proveedor'} · ArgosIsp` }))

async function cargar() {
    cargando.value = true
    const resultado = await useProveedores().ver(id.value)
    cargando.value = false
    proveedor.value = resultado.ok ? resultado.data : null
    problema.value = resultado.ok ? null : resultado.problema
}

/* Pestañas (en la URL). */
const pestanas: TabsItem[] = [
    { label: 'Estado de cuenta', value: 'cuenta', icon: 'i-lucide-scroll-text' },
    { label: 'Compras', value: 'compras', icon: 'i-lucide-shopping-cart' },
    { label: 'Pagos', value: 'pagos', icon: 'i-lucide-banknote' },
]
const pestana = computed<string>({
    get: () => (['compras', 'pagos'].includes(String(route.query.tab)) ? String(route.query.tab) : 'cuenta'),
    set: valor => void router.replace({ query: { ...route.query, tab: valor === 'cuenta' ? undefined : valor } }),
})

/* Estado de cuenta. */
const cuenta = shallowRef<EstadoCuentaProveedor | null>(null)
const problemaCuenta = ref<Problem | null>(null)
const cargandoCuenta = ref(false)

async function cargarCuenta() {
    cargandoCuenta.value = true
    const resultado = await useProveedores().estadoCuenta(id.value)
    cargandoCuenta.value = false
    cuenta.value = resultado.ok ? resultado.data : null
    problemaCuenta.value = resultado.ok ? null : resultado.problema
}

type Movimiento = EstadoCuentaProveedor['movimientos'][number]
const TIPOS_MOVIMIENTO: Record<Movimiento['tipo'], string> = { compra: 'Compra', nota_credito: 'Nota de crédito', pago: 'Pago', anulacion: 'Anulación', ajuste: 'Ajuste' }
const columnasMovimientos: TableColumn<Movimiento>[] = [
    { accessorKey: 'fecha', header: 'Fecha', meta: SOLO_ANCHO },
    { accessorKey: 'documento', header: 'Movimiento', meta: { class: { td: 'whitespace-normal' } } },
    { accessorKey: 'debe', header: 'Debe', meta: { class: { th: 'text-right hidden sm:table-cell', td: 'text-right hidden sm:table-cell' } } },
    { accessorKey: 'haber', header: 'Haber', meta: { class: { th: 'text-right hidden sm:table-cell', td: 'text-right hidden sm:table-cell' } } },
    { accessorKey: 'saldo', header: 'Saldo', meta: { class: { th: 'text-right', td: 'text-right' } } },
]

/* Compras y pagos del proveedor. */
const compras = usePaginacionCursor(cursor => useCompras().listar({ proveedor_id: id.value }, cursor))
const pagos = usePaginacionCursor(cursor => usePagosProveedores().listar({ proveedor_id: id.value }, cursor))

const columnasCompras: TableColumn<Compra>[] = [
    { accessorKey: 'fecha_documento', header: 'Fecha', meta: SOLO_ANCHO },
    { accessorKey: 'numero', header: 'Documento', meta: { class: { td: 'whitespace-normal' } } },
    { accessorKey: 'total', header: 'Total', meta: { class: { th: 'text-right', td: 'text-right' } } },
    { accessorKey: 'saldo', header: 'Saldo', meta: { class: { th: 'text-right hidden sm:table-cell', td: 'text-right hidden sm:table-cell' } } },
]
const columnasPagos: TableColumn<PagoProveedor>[] = [
    { accessorKey: 'fecha', header: 'Fecha', meta: SOLO_ANCHO },
    { accessorKey: 'id', header: 'Pago', meta: { class: { td: 'whitespace-normal' } } },
    { accessorKey: 'monto', header: 'Monto', meta: { class: { th: 'text-right', td: 'text-right' } } },
    { id: 'acciones', header: '', meta: { class: { td: 'text-right w-0' } } },
]

watch(pestana, (valor) => {
    if (valor === 'compras') {
        void compras.recargar()
    }
    if (valor === 'pagos') {
        void pagos.recargar()
    }
}, { immediate: true })

/* Acciones. */
const editando = ref(false)
const pagando = ref(false)
const aAnular = shallowRef<PagoProveedor | null>(null)
const anulando = computed({
    get: () => aAnular.value !== null,
    set: (valor) => {
        if (!valor) {
            aAnular.value = null
        }
    },
})

function alEditar(nuevo: Proveedor) {
    proveedor.value = nuevo
    toast.add({ title: 'Proveedor guardado', description: nuevo.nombre, icon: 'i-lucide-circle-check', color: 'success' })
}

function alPagar(pago: PagoProveedor) {
    toast.add({ title: `Pago #${pago.id} registrado`, description: `${formatearQuetzales(pago.monto)} · ${pago.aplicaciones.map(a => a.documento).join(', ')}`, icon: 'i-lucide-circle-check', color: 'success' })
    void recargarTodo()
}

async function anularPago(motivo: string, clave: string): Promise<Resultado<PagoProveedor>> {
    if (!aAnular.value) {
        return { ok: false, problema: { type: 'about:blank', title: 'Sin pago', status: 0 } }
    }
    const resultado = await usePagosProveedores().anular(aAnular.value.id, motivo, clave)
    return resultado.ok ? resultado : { ok: false, problema: problemaCompraLegible(resultado.problema) }
}

function alAnular(pago: PagoProveedor) {
    toast.add({ title: `Pago #${pago.id} anulado`, description: 'Sus compras vuelven a quedar con saldo.', icon: 'i-lucide-ban', color: 'neutral' })
    void recargarTodo()
}

async function recargarTodo() {
    await Promise.all([cargar(), cargarCuenta(), pestana.value === 'pagos' ? pagos.recargar() : null, pestana.value === 'compras' ? compras.recargar() : null])
}

onMounted(() => {
    void cargar()
    void cargarCuenta()
})
</script>

<template>
    <PanelPagina
        id="proveedor"
        :titulo="proveedor?.nombre ?? 'Proveedor'"
        icono="i-lucide-truck"
    >
        <template #acciones>
            <div class="flex flex-wrap gap-2">
                <UButton
                    v-if="proveedor && puede('compras.registrar')"
                    :to="`/compras/nueva?proveedor=${proveedor.id}`"
                    label="Registrar compra"
                    :aria-label="'Registrar compra'"
                    :ui="{ label: 'hidden sm:inline' }"
                    icon="i-lucide-shopping-cart"
                    color="neutral"
                    variant="outline"
                />
                <UButton
                    v-if="proveedor && cuenta && puede('compras.pagar') && cuenta.pendientes.length"
                    label="Registrar pago"
                    :aria-label="'Registrar pago'"
                    :ui="{ label: 'hidden sm:inline' }"
                    icon="i-lucide-banknote"
                    data-prueba="abrir-pago-proveedor"
                    @click="pagando = true"
                />
            </div>
        </template>

        <div class="flex flex-col gap-6">
            <ProblemaAlerta
                v-if="problema"
                :problema="problema"
                :reintentar="cargar"
                :reintentando="cargando"
            />
            <UCard
                v-else-if="proveedor"
                :ui="{ body: 'p-4 sm:p-4' }"
            >
                <div class="flex flex-col gap-4">
                    <div class="flex flex-wrap items-center gap-2">
                        <UBadge
                            :label="TIPOS_PROVEEDOR[proveedor.tipo]"
                            color="neutral"
                            variant="subtle"
                        />
                        <UBadge
                            v-if="!proveedor.activo"
                            label="Inactivo"
                            color="neutral"
                            variant="outline"
                        />
                        <UBadge
                            v-if="proveedor.regimen_isr === 'opcional_simplificado'"
                            label="Se le retiene ISR (régimen opcional)"
                            color="info"
                            variant="subtle"
                        />
                        <UButton
                            v-if="puede('proveedores.editar')"
                            label="Editar"
                            icon="i-lucide-pencil"
                            color="neutral"
                            variant="ghost"
                            size="sm"
                            class="ml-auto"
                            data-prueba="editar-proveedor"
                            @click="editando = true"
                        />
                    </div>
                    <dl class="grid grid-cols-2 gap-4 sm:grid-cols-4">
                        <DatoFicha
                            :etiqueta="DOCUMENTOS_PROVEEDOR[proveedor.tipo_documento]"
                            :valor="proveedor.nit"
                            mono
                        />
                        <DatoFicha
                            etiqueta="Le debemos"
                            data-prueba="proveedor-saldo"
                        >
                            <span class="font-semibold tabular-nums">{{ formatearQuetzales(proveedor.saldo) }}</span>
                        </DatoFicha>
                        <DatoFicha
                            etiqueta="Crédito"
                            :valor="proveedor.dias_credito ? `${proveedor.dias_credito} días` : 'Contado'"
                        />
                        <DatoFicha
                            etiqueta="Agente de retención de IVA"
                            :valor="proveedor.agente_retencion_iva ? 'Sí' : 'No'"
                        />
                        <DatoFicha
                            etiqueta="Teléfono"
                            :valor="proveedor.telefono"
                        />
                        <DatoFicha
                            etiqueta="Correo"
                            :valor="proveedor.correo"
                        />
                        <DatoFicha
                            etiqueta="Dirección"
                            :valor="proveedor.direccion"
                            class="col-span-2"
                        />
                    </dl>
                </div>
            </UCard>

            <UTabs
                v-model="pestana"
                :items="pestanas"
                :content="false"
                class="w-full"
            />

            <template v-if="pestana === 'cuenta'">
                <ProblemaAlerta
                    v-if="problemaCuenta"
                    :problema="problemaCuenta"
                    :reintentar="cargarCuenta"
                    :reintentando="cargandoCuenta"
                />
                <template v-else-if="cuenta">
                    <div
                        v-if="cuenta.pendientes.length"
                        class="flex flex-col gap-2"
                        data-prueba="pendientes-proveedor"
                    >
                        <h2 class="text-sm font-semibold text-highlighted">
                            Por pagar
                        </h2>
                        <ul class="flex flex-col divide-y divide-default rounded-lg border border-default">
                            <li
                                v-for="p in cuenta.pendientes"
                                :key="p.compra_id"
                                class="flex flex-wrap items-center justify-between gap-2 px-3 py-2"
                                :data-pendiente="p.compra_id"
                            >
                                <ULink
                                    :to="puede('compras.ver') ? `/compras/${p.compra_id}` : undefined"
                                    class="text-sm font-medium text-highlighted"
                                >
                                    {{ p.documento }}
                                </ULink>
                                <UBadge
                                    :label="p.dias_vencida ? `Vencida hace ${p.dias_vencida} días` : `Vence el ${formatearFecha(p.vence_en)}`"
                                    :color="p.dias_vencida ? 'error' : 'neutral'"
                                    variant="subtle"
                                    size="sm"
                                />
                                <span class="text-sm font-semibold tabular-nums">{{ formatearQuetzales(p.saldo) }}</span>
                            </li>
                        </ul>
                    </div>
                    <UTable
                        :data="cuenta.movimientos"
                        :columns="columnasMovimientos"
                        :loading="cargandoCuenta"
                        data-prueba="tabla-cuenta-proveedor"
                    >
                        <template #fecha-cell="{ row }">
                            <span class="whitespace-nowrap text-sm">{{ formatearFecha(row.original.fecha) }}</span>
                        </template>
                        <template #documento-cell="{ row }">
                            <div class="flex flex-col">
                                <span class="text-sm font-medium text-highlighted">{{ TIPOS_MOVIMIENTO[row.original.tipo] }} · {{ row.original.documento }}</span>
                                <span class="text-xs text-muted">{{ row.original.descripcion }}</span>
                                <span class="text-xs text-muted sm:hidden">{{ formatearFecha(row.original.fecha) }} · {{ new Decimal(row.original.debe).gt(0) ? `Debe ${formatearQuetzales(row.original.debe)}` : `Haber ${formatearQuetzales(row.original.haber)}` }}</span>
                            </div>
                        </template>
                        <template #debe-cell="{ row }">
                            <span class="tabular-nums">{{ new Decimal(row.original.debe).isZero() ? '' : formatearQuetzales(row.original.debe) }}</span>
                        </template>
                        <template #haber-cell="{ row }">
                            <span class="tabular-nums">{{ new Decimal(row.original.haber).isZero() ? '' : formatearQuetzales(row.original.haber) }}</span>
                        </template>
                        <template #saldo-cell="{ row }">
                            <span class="font-medium tabular-nums">{{ formatearQuetzales(row.original.saldo) }}</span>
                        </template>
                        <template #empty>
                            <UEmpty
                                icon="i-lucide-scroll-text"
                                title="Sin movimientos al crédito"
                                variant="naked"
                            />
                        </template>
                    </UTable>
                    <p class="text-right text-sm">
                        Saldo al {{ formatearFecha(cuenta.hasta) }}: <strong
                            class="tabular-nums"
                            data-prueba="saldo-final-proveedor"
                        >{{ formatearQuetzales(cuenta.saldo_final) }}</strong>
                    </p>
                </template>
            </template>

            <template v-else-if="pestana === 'compras'">
                <ProblemaAlerta
                    v-if="compras.problema.value"
                    :problema="compras.problema.value"
                    :reintentar="compras.recargar"
                    :reintentando="compras.cargando.value"
                />
                <template v-else>
                    <UTable
                        :data="compras.filas.value"
                        :columns="columnasCompras"
                        :loading="compras.cargando.value"
                    >
                        <template #fecha_documento-cell="{ row }">
                            <span class="whitespace-nowrap text-sm">{{ formatearFecha(row.original.fecha_documento) }}</span>
                        </template>
                        <template #numero-cell="{ row }">
                            <div class="flex flex-col">
                                <ULink
                                    :to="puede('compras.ver') ? `/compras/${row.original.id}` : undefined"
                                    class="text-sm font-medium text-highlighted"
                                >
                                    {{ documentoCompra(row.original) }}
                                </ULink>
                                <span class="text-xs text-muted">{{ row.original.condicion === 'credito' ? 'Al crédito' : 'Al contado' }} · {{ ESTADOS_COMPRA[row.original.estado].etiqueta }}</span>
                            </div>
                        </template>
                        <template #total-cell="{ row }">
                            <span
                                class="tabular-nums"
                                :class="row.original.estado === 'anulada' ? 'text-muted line-through' : ''"
                            >{{ formatearQuetzales(row.original.total) }}</span>
                        </template>
                        <template #saldo-cell="{ row }">
                            <span class="tabular-nums">{{ formatearQuetzales(row.original.saldo) }}</span>
                        </template>
                        <template #empty>
                            <UEmpty
                                icon="i-lucide-shopping-cart"
                                title="Sin compras de este proveedor"
                                variant="naked"
                            />
                        </template>
                    </UTable>
                    <PaginacionCursor
                        :pagina="compras.pagina.value"
                        :hay-anterior="compras.hayAnterior.value"
                        :hay-siguiente="compras.haySiguiente.value"
                        :cargando="compras.cargando.value"
                        :filas="compras.filas.value.length"
                        @anterior="compras.anterior"
                        @siguiente="compras.siguiente"
                    />
                </template>
            </template>

            <template v-else>
                <ProblemaAlerta
                    v-if="pagos.problema.value"
                    :problema="pagos.problema.value"
                    :reintentar="pagos.recargar"
                    :reintentando="pagos.cargando.value"
                />
                <template v-else>
                    <UTable
                        :data="pagos.filas.value"
                        :columns="columnasPagos"
                        :loading="pagos.cargando.value"
                        data-prueba="tabla-pagos-proveedor"
                    >
                        <template #fecha-cell="{ row }">
                            <span class="whitespace-nowrap text-sm">{{ formatearFecha(row.original.fecha) }}</span>
                        </template>
                        <template #id-cell="{ row }">
                            <div class="flex flex-col">
                                <span class="text-sm font-medium text-highlighted">#{{ row.original.id }} · {{ METODOS_PAGO_COMPRA[row.original.metodo] }}</span>
                                <span class="text-xs text-muted">{{ row.original.aplicaciones.map(a => `${a.documento} (${formatearQuetzales(a.monto)})`).join(', ') }}</span>
                                <span
                                    v-if="row.original.estado === 'anulado'"
                                    class="text-xs text-muted"
                                >Anulado: {{ row.original.motivo_anulacion }}</span>
                            </div>
                        </template>
                        <template #monto-cell="{ row }">
                            <span
                                class="tabular-nums"
                                :class="row.original.estado === 'anulado' ? 'text-muted line-through' : 'font-medium'"
                            >{{ formatearQuetzales(row.original.monto) }}</span>
                        </template>
                        <template #acciones-cell="{ row }">
                            <UButton
                                v-if="puede('compras.pagar') && row.original.estado === 'registrado'"
                                icon="i-lucide-ban"
                                color="error"
                                variant="ghost"
                                size="sm"
                                :aria-label="`Anular el pago ${row.original.id}`"
                                data-prueba="anular-pago-proveedor"
                                @click="aAnular = row.original"
                            />
                        </template>
                        <template #empty>
                            <UEmpty
                                icon="i-lucide-banknote"
                                title="Sin pagos a este proveedor"
                                variant="naked"
                            />
                        </template>
                    </UTable>
                    <PaginacionCursor
                        :pagina="pagos.pagina.value"
                        :hay-anterior="pagos.hayAnterior.value"
                        :hay-siguiente="pagos.haySiguiente.value"
                        :cargando="pagos.cargando.value"
                        :filas="pagos.filas.value.length"
                        @anterior="pagos.anterior"
                        @siguiente="pagos.siguiente"
                    />
                </template>
            </template>
        </div>

        <ProveedorModal
            v-if="proveedor"
            v-model:open="editando"
            :proveedor="proveedor"
            @hecho="alEditar"
        />
        <PagoProveedorModal
            v-if="proveedor && cuenta"
            v-model:open="pagando"
            :proveedor="proveedor"
            :pendientes="cuenta.pendientes"
            @hecho="alPagar"
        />
        <AccionMotivoModal
            v-model:open="anulando"
            :titulo="aAnular ? `Anular pago #${aAnular.id}` : 'Anular pago'"
            :descripcion="aAnular ? `${formatearQuetzales(aAnular.monto)} · ${formatearFecha(aAnular.fecha)}` : undefined"
            efecto="Se registra el reverso con fecha de hoy y las compras a las que se aplicó vuelven a quedar con saldo."
            confirmar="Anular pago"
            placeholder="Ej.: el cheque fue rechazado"
            :ejecutar="anularPago"
            @hecho="alAnular"
        />
    </PanelPagina>
</template>
