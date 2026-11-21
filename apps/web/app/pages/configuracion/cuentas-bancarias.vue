<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { TableColumn } from '@nuxt/ui'

/**
 * Configuración · cuentas bancarias propias (A3): destino de depósitos, transferencias, ACH y
 * remesas, y fuente única de las cuentas que muestra el portal. Cada una crea su subcuenta
 * `1.1.02.NN` en el libro; no se borran, se desactivan.
 */
definePageMeta({ permiso: 'cuentas_bancarias.ver' })

useHead({ title: 'Cuentas bancarias · ArgosIsp' })

const { puede } = usePermisos()
const toast = useToast()

type FiltroActiva = 'todas' | 'activas' | 'inactivas'
const filtro = ref<FiltroActiva>('todas')
const itemsFiltro = [
    { label: 'Todas', value: 'todas' },
    { label: 'Activas', value: 'activas' },
    { label: 'Inactivas', value: 'inactivas' },
]

const cuentas = shallowRef<CuentaBancaria[]>([])
const cargando = ref(false)
const problema = ref<Problem | null>(null)
const leidas = ref(false)

const bancos = shallowRef<Banco[]>([])
const problemaBancos = ref<Problem | null>(null)

const editando = shallowRef<CuentaBancaria | null>(null)
const abierto = ref(false)

const columnas: TableColumn<CuentaBancaria>[] = [
    { accessorKey: 'banco_nombre', header: 'Banco' },
    { accessorKey: 'numero', header: 'Número', meta: SOLO_ANCHO },
    { accessorKey: 'tipo', header: 'Tipo', meta: SOLO_ESCRITORIO },
    { accessorKey: 'alias', header: 'Alias', meta: SOLO_ESCRITORIO },
    { id: 'ofrece', header: 'Se ofrece al cliente', meta: SOLO_ESCRITORIO },
    { accessorKey: 'activa', header: 'Activa' },
    { id: 'acciones', header: '', meta: { class: { th: 'w-0', td: 'text-right' } } },
]

/** Las activas en quetzales son las que el cobro, el portal e Iris ofrecen al cliente. */
function seOfrece(cuenta: CuentaBancaria): boolean {
    return cuenta.activa && cuenta.moneda === 'GTQ'
}

const menuFila = useMenuFila<CuentaBancaria>(cuenta => (puede('cuentas_bancarias.editar')
    ? [{ etiqueta: 'Editar cuenta', icono: ICONOS.editar, alElegir: () => editar(cuenta) }]
    : []))

async function cargar() {
    cargando.value = true
    const resultado = await useCuentasBancarias().listar(filtro.value === 'todas' ? {} : { activa: filtro.value === 'activas' })
    cargando.value = false
    leidas.value = true
    cuentas.value = resultado.ok ? resultado.data : []
    problema.value = resultado.ok ? null : resultado.problema
}

async function cargarBancos() {
    const resultado = await useBancos().listar()
    bancos.value = resultado.ok ? resultado.data : []
    problemaBancos.value = resultado.ok ? null : resultado.problema
}

function nueva() {
    editando.value = null
    abierto.value = true
}

function editar(cuenta: CuentaBancaria) {
    editando.value = cuenta
    abierto.value = true
}

async function recargarEditada() {
    const id = editando.value?.id
    if (!id) {
        return
    }
    const resultado = await useCuentasBancarias().ver(id)
    if (resultado.ok) {
        editando.value = resultado.data
        cuentas.value = cuentas.value.map(c => (c.id === id ? resultado.data : c))
    }
    else {
        toast.add({ title: 'No se pudo recargar la cuenta', description: resultado.problema.detail ?? resultado.problema.title, color: 'error', icon: 'i-lucide-circle-alert' })
    }
}

function alGuardar(cuenta: CuentaBancaria, nuevaCuenta: boolean) {
    toast.add({
        title: nuevaCuenta ? 'Cuenta bancaria creada' : 'Cuenta bancaria actualizada',
        description: `${cuenta.banco_nombre} · ${cuenta.alias} · subcuenta ${cuenta.cuenta_codigo}`,
        icon: 'i-lucide-landmark',
        color: 'success',
    })
    void cargar()
}

watch(filtro, cargar)
onMounted(() => {
    void cargar()
    if (puede('cuentas_bancarias.editar')) {
        void cargarBancos()
    }
})
</script>

<template>
    <ConfiguracionMarco
        id="cuentas-bancarias"
        titulo="Facturación y cobro"
        descripcion="Cuentas donde pagan los clientes, bancos de origen, plantillas y conceptos"
        empresas
    >
        <template #cabecera>
            <UTabs
                v-model="filtro"
                :items="itemsFiltro"
                :content="false"
                size="xs"
                variant="link"
                aria-label="Filtrar por estado"
            />
        </template>

        <div class="flex flex-col gap-3 sm:flex-row sm:items-center">
            <UAlert
                color="primary"
                variant="subtle"
                icon="i-lucide-info"
                description="Estas son las cuentas donde depositan los clientes. Argos es la única fuente: el portal, caja e Iris leen esta lista."
                class="flex-1"
            />
            <UButton
                v-if="puede('cuentas_bancarias.editar')"
                label="Agregar cuenta"
                icon="i-lucide-plus"
                class="glow-brand self-start sm:self-center"
                aria-label="Nueva cuenta"
                @click="nueva"
            />
        </div>

        <ProblemaAlerta
            v-if="problemaBancos && puede('cuentas_bancarias.editar')"
            :problema="problemaBancos"
            :reintentar="cargarBancos"
        />

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
                :data="cuentas"
                :columns="columnas"
                :loading="cargando"
                :empty="leidas ? 'No hay cuentas bancarias con este filtro.' : ''"
                class="-mx-4"
                @contextmenu="menuFila.alContextmenu"
            >
                <template #banco_nombre-cell="{ row }">
                    <div
                        class="flex min-w-0 items-center gap-3"
                        :data-cuenta="row.original.id"
                    >
                        <span class="pastilla-icono tono-marca pastilla-tono">
                            <UIcon
                                name="i-lucide-landmark"
                                class="size-4"
                            />
                        </span>
                        <div class="flex min-w-0 flex-col">
                            <span class="font-semibold text-highlighted">{{ row.original.banco_nombre }}</span>
                            <span class="text-xs text-muted lg:hidden">{{ row.original.alias }}</span>
                            <span class="font-mono text-xs text-muted sm:hidden">{{ row.original.numero }} · {{ row.original.moneda }}</span>
                        </div>
                    </div>
                </template>
                <template #numero-cell="{ row }">
                    <span
                        class="font-mono"
                        data-copiar
                    >{{ row.original.numero }}</span>
                </template>
                <template #tipo-cell="{ row }">
                    <span v-if="row.original.tipo">{{ TIPOS_CUENTA_BANCARIA[row.original.tipo] }} · {{ row.original.moneda }}</span>
                    <UBadge
                        v-else
                        label="Falta titular y tipo"
                        icon="i-lucide-pencil-line"
                        color="warning"
                        variant="subtle"
                        size="sm"
                        data-prueba="cuenta-sin-titular"
                    />
                </template>
                <template #alias-cell="{ row }">
                    <div class="flex flex-col">
                        <span>{{ row.original.alias }}</span>
                        <span class="font-mono text-xs text-muted">{{ row.original.cuenta_codigo }}</span>
                    </div>
                </template>
                <template #ofrece-cell="{ row }">
                    <UBadge
                        :label="seOfrece(row.original) ? 'Sí' : 'No'"
                        :icon="seOfrece(row.original) ? 'i-lucide-eye' : 'i-lucide-eye-off'"
                        :color="seOfrece(row.original) ? 'success' : 'neutral'"
                        variant="subtle"
                        size="sm"
                    />
                </template>
                <template #activa-cell="{ row }">
                    <UBadge
                        :label="row.original.activa ? 'Activa' : 'Inactiva'"
                        :icon="row.original.activa ? 'i-lucide-circle-check' : 'i-lucide-circle-pause'"
                        :color="row.original.activa ? 'success' : 'neutral'"
                        variant="subtle"
                    />
                </template>
                <template #acciones-cell="{ row }">
                    <UDropdownMenu
                        v-if="puede('cuentas_bancarias.editar')"
                        :items="menuFila.itemsDe(row.original)"
                    >
                        <UButton
                            icon="i-lucide-ellipsis"
                            color="neutral"
                            variant="ghost"
                            size="sm"
                            :aria-label="`Acciones de ${row.original.alias}`"
                        />
                    </UDropdownMenu>
                </template>
            </UTable>
        </UContextMenu>

        <CuentaBancariaFormulario
            v-if="puede('cuentas_bancarias.editar')"
            v-model:open="abierto"
            :cuenta="editando"
            :bancos="bancos"
            @guardada="alGuardar"
            @recargar="recargarEditada"
        />
    </ConfiguracionMarco>
</template>
