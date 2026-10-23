<script setup lang="ts">
import type { SelectItem, TableColumn } from '@nuxt/ui'

/**
 * Pagos a proveedores (A3, fase 5): de qué caja, banco o cuenta salieron, a qué compras se aplicaron y
 * su estado. Anular (`compras.pagar`) registra el reverso y devuelve el saldo a sus compras. Un pago se
 * registra desde la ficha del proveedor, que muestra lo pendiente.
 */
definePageMeta({ permiso: 'compras.ver' })

useHead({ title: 'Pagos a proveedores · ArgosIsp' })

const route = useRoute()
const router = useRouter()
const toast = useToast()
const { puede } = usePermisos()

const TODOS = 'todos'
const estado = ref<'registrado' | 'anulado' | typeof TODOS>(route.query.estado === 'registrado' || route.query.estado === 'anulado' ? route.query.estado : TODOS)
const itemsEstado: SelectItem[] = [{ label: 'Todos', value: TODOS }, { label: 'Registrados', value: 'registrado' }, { label: 'Anulados', value: 'anulado' }]

const lista = usePaginacionCursor(cursor => usePagosProveedores().listar(estado.value !== TODOS ? { estado: estado.value } : {}, cursor))

const columnas: TableColumn<PagoProveedor>[] = [
    { accessorKey: 'fecha', header: 'Fecha', meta: SOLO_ANCHO },
    { accessorKey: 'proveedor_nombre', header: 'Pago', meta: { class: { td: 'whitespace-normal' } } },
    { accessorKey: 'monto', header: 'Monto', meta: { class: { th: 'text-right', td: 'text-right' } } },
    { id: 'acciones', header: '', meta: { class: { td: 'text-right w-0' } } },
]

watch(estado, async () => {
    await router.replace({ query: estado.value !== TODOS ? { estado: estado.value } : {} })
    await lista.recargar()
})

const aAnular = shallowRef<PagoProveedor | null>(null)
const anulando = computed({
    get: () => aAnular.value !== null,
    set: (valor) => {
        if (!valor) {
            aAnular.value = null
        }
    },
})

async function anular(motivo: string, clave: string): Promise<Resultado<PagoProveedor>> {
    if (!aAnular.value) {
        return { ok: false, problema: { type: 'about:blank', title: 'Sin pago', status: 0 } }
    }
    const resultado = await usePagosProveedores().anular(aAnular.value.id, motivo, clave)
    return resultado.ok ? resultado : { ok: false, problema: problemaCompraLegible(resultado.problema) }
}

function alAnular(pago: PagoProveedor) {
    toast.add({ title: `Pago #${pago.id} anulado`, description: 'Sus compras vuelven a quedar con saldo.', icon: 'i-lucide-ban', color: 'neutral' })
    void lista.recargar()
}

onMounted(() => void lista.recargar())
</script>

<template>
    <PanelPagina
        id="pagos-proveedores"
        titulo="Pagos a proveedores"
        icono="i-lucide-banknote"
    >
        <div class="flex flex-col gap-4">
            <USelect
                v-model="estado"
                :items="itemsEstado"
                aria-label="Estado"
                class="w-full sm:max-w-xs"
            />
            <p
                v-if="puede('proveedores.ver')"
                class="text-xs text-muted"
            >
                Un pago se registra desde la ficha del proveedor, con lo que se le debe a la vista.
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
                    data-prueba="tabla-pagos-proveedores"
                >
                    <template #fecha-cell="{ row }">
                        <span class="whitespace-nowrap text-sm">{{ formatearFecha(row.original.fecha) }}</span>
                    </template>
                    <template #proveedor_nombre-cell="{ row }">
                        <div
                            class="flex flex-col"
                            :data-pago="row.original.id"
                        >
                            <ULink
                                :to="puede('proveedores.ver') ? `/proveedores/${row.original.proveedor_id}?tab=pagos` : undefined"
                                class="text-sm font-medium text-highlighted"
                            >
                                #{{ row.original.id }} · {{ row.original.proveedor_nombre }}
                            </ULink>
                            <span class="text-xs text-muted">{{ METODOS_PAGO_COMPRA[row.original.metodo] }}<template v-if="row.original.referencia"> · {{ row.original.referencia }}</template></span>
                            <span class="text-xs text-muted">{{ row.original.aplicaciones.map(a => `${a.documento} (${formatearQuetzales(a.monto)})`).join(', ') }}</span>
                            <span
                                v-if="row.original.estado === 'anulado'"
                                class="text-xs text-muted"
                            >Anulado: {{ row.original.motivo_anulacion }}</span>
                            <span class="text-xs text-muted sm:hidden">{{ formatearFecha(row.original.fecha) }}</span>
                        </div>
                    </template>
                    <template #monto-cell="{ row }">
                        <span
                            class="whitespace-nowrap tabular-nums"
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
                            title="Sin pagos a proveedores"
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
        </div>

        <AccionMotivoModal
            v-model:open="anulando"
            :titulo="aAnular ? `Anular pago #${aAnular.id}` : 'Anular pago'"
            :descripcion="aAnular ? `${aAnular.proveedor_nombre} · ${formatearQuetzales(aAnular.monto)} · ${formatearFecha(aAnular.fecha)}` : undefined"
            efecto="Se registra el reverso con fecha de hoy y las compras a las que se aplicó vuelven a quedar con saldo."
            confirmar="Anular pago"
            placeholder="Ej.: el cheque fue rechazado"
            :ejecutar="anular"
            @hecho="alAnular"
        />
    </PanelPagina>
</template>
