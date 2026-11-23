<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { TableColumn } from '@nuxt/ui'

/**
 * Proveedores de cobro por empresa (A3, fase 4 §10.3): pasarela, agente o débito con su subcuenta
 * puente 1.1.10.NN, el banco donde liquida y la fecha de corte. Alta y edición con
 * `cobros.configurar`; la fecha de corte no se edita.
 */
definePageMeta({ permiso: 'bancos.ver' })

useHead({ title: 'Proveedores de cobro · ArgosIsp' })

const toast = useToast()
const { puede, enlace } = usePermisos()

const proveedores = shallowRef<ProveedorCobro[]>([])
const cargando = ref(true)
const problema = ref<Problem | null>(null)

const editado = shallowRef<ProveedorCobro | null>(null)
const modalAbierto = ref(false)

const columnas: TableColumn<ProveedorCobro>[] = [
    { accessorKey: 'nombre', header: 'Proveedor' },
    { accessorKey: 'cuenta_codigo', header: 'Puente', meta: SOLO_ANCHO },
    { accessorKey: 'cuenta_liquidacion_nombre', header: 'Liquida en', meta: SOLO_ESCRITORIO },
    { accessorKey: 'desde', header: 'Desde', meta: SOLO_ANCHO },
    { accessorKey: 'activo', header: 'Estado' },
    { id: 'acciones', header: '', meta: { class: { td: 'text-right w-0' } } },
]

const menuFila = useMenuFila<ProveedorCobro>(proveedor => (puede('cobros.configurar')
    ? [{ etiqueta: 'Editar proveedor', icono: ICONOS.editar, alElegir: () => editar(proveedor) }]
    : []))

async function cargar() {
    cargando.value = true
    const resultado = await useProveedoresCobro().listar()
    cargando.value = false
    proveedores.value = resultado.ok ? resultado.data : []
    problema.value = resultado.ok ? null : resultado.problema
}

function nuevo() {
    editado.value = null
    modalAbierto.value = true
}

function editar(proveedor: ProveedorCobro) {
    editado.value = proveedor
    modalAbierto.value = true
}

function alGuardar(proveedor: ProveedorCobro) {
    toast.add({
        title: editado.value ? 'Proveedor actualizado' : 'Proveedor creado',
        description: `${proveedor.nombre} · puente ${proveedor.cuenta_codigo} desde ${formatearFecha(proveedor.desde)}`,
        icon: 'i-lucide-circle-check',
        color: 'success',
    })
    void cargar()
}

onMounted(cargar)
</script>

<template>
    <ConfiguracionMarco
        id="proveedores-cobro"
        titulo="Facturación y cobro"
        descripcion="Cuentas donde pagan los clientes, bancos de origen, plantillas y conceptos"
        empresas
    >
        <div class="flex flex-col gap-4">
            <div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <p class="text-sm text-muted">
                    Los pagos por pasarela, agente o débito de un proveedor activo, desde su fecha de corte, entran a su cuenta puente por el bruto
                    y salen con la
                    <ULink
                        :to="enlace('/cobros/por-liquidar')"
                        class="underline"
                    >liquidación</ULink>
                    (banco por el neto y la comisión). Sin proveedor, el pago sigue contra el banco como antes.
                </p>
                <UButton
                    v-if="puede('cobros.configurar')"
                    label="Agregar proveedor"
                    icon="i-lucide-plus"
                    class="glow-brand shrink-0 self-start"
                    aria-label="Nuevo proveedor"
                    data-prueba="nuevo-proveedor"
                    @click="nuevo"
                />
            </div>

            <ProblemaAlerta
                v-if="problema"
                :problema="problema"
                :reintentar="cargar"
                :reintentando="cargando"
            />
            <UContextMenu
                v-else
                :items="menuFila.items.value"
            >
                <UTable
                    :data="proveedores"
                    :columns="columnas"
                    :loading="cargando"
                    data-prueba="tabla-proveedores"
                    class="-mx-4"
                    @contextmenu="menuFila.alContextmenu"
                >
                    <template #nombre-cell="{ row }">
                        <div class="flex min-w-0 items-center gap-2">
                            <UIcon
                                :name="METODOS_PROVEEDOR[row.original.metodo].icono"
                                class="size-4 shrink-0 text-muted"
                            />
                            <div class="flex min-w-0 flex-col">
                                <span class="text-sm font-medium text-highlighted">{{ row.original.nombre }}</span>
                                <span class="text-xs text-muted">{{ METODOS_PROVEEDOR[row.original.metodo].etiqueta }} · {{ row.original.codigo }}</span>
                                <span class="text-xs text-muted sm:hidden">{{ row.original.cuenta_codigo }} · desde {{ formatearFecha(row.original.desde) }}</span>
                            </div>
                        </div>
                    </template>
                    <template #cuenta_codigo-cell="{ row }">
                        <span class="font-mono text-sm">{{ row.original.cuenta_codigo }}</span>
                    </template>
                    <template #cuenta_liquidacion_nombre-cell="{ row }">
                        <span class="text-sm">{{ row.original.cuenta_liquidacion_nombre }}</span>
                    </template>
                    <template #desde-cell="{ row }">
                        <span class="text-sm">{{ formatearFecha(row.original.desde) }}</span>
                    </template>
                    <template #activo-cell="{ row }">
                        <UBadge
                            :label="row.original.activo ? 'Activo' : 'Inactivo'"
                            :color="row.original.activo ? 'success' : 'neutral'"
                            :icon="row.original.activo ? 'i-lucide-circle-check' : 'i-lucide-circle-pause'"
                            variant="subtle"
                            size="sm"
                        />
                    </template>
                    <template #acciones-cell="{ row }">
                        <UDropdownMenu
                            v-if="puede('cobros.configurar')"
                            :items="menuFila.itemsDe(row.original)"
                        >
                            <UButton
                                icon="i-lucide-ellipsis"
                                color="neutral"
                                variant="ghost"
                                size="sm"
                                :aria-label="`Acciones de ${row.original.nombre}`"
                            />
                        </UDropdownMenu>
                    </template>
                    <template #empty>
                        <UEmpty
                            icon="i-lucide-credit-card"
                            title="Sin proveedores de cobro"
                            description="Mientras no haya uno, los pagos por pasarela, agente o débito se registran directo contra el banco."
                            variant="naked"
                        />
                    </template>
                </UTable>
            </UContextMenu>
        </div>

        <ProveedorCobroModal
            v-if="puede('cobros.configurar')"
            v-model:open="modalAbierto"
            :proveedor="editado"
            @hecho="alGuardar"
        />
    </ConfiguracionMarco>
</template>
