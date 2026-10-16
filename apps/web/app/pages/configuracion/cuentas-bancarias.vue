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
    { accessorKey: 'alias', header: 'Cuenta' },
    { accessorKey: 'numero', header: 'Número', meta: SOLO_ANCHO },
    { accessorKey: 'moneda', header: 'Moneda', meta: SOLO_ESCRITORIO },
    { accessorKey: 'cuenta_codigo', header: 'Subcuenta', meta: SOLO_ESCRITORIO },
    { accessorKey: 'activa', header: 'Estado' },
    { id: 'acciones', header: '', meta: { class: { th: 'w-0', td: 'text-right' } } },
]

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
    <PanelPagina
        id="cuentas-bancarias"
        titulo="Cuentas bancarias"
        icono="i-lucide-landmark"
    >
        <template #acciones>
            <UButton
                v-if="puede('cuentas_bancarias.editar')"
                label="Nueva cuenta"
                icon="i-lucide-plus"
                aria-label="Nueva cuenta"
                :ui="{ label: 'hidden sm:inline' }"
                @click="nueva"
            />
        </template>

        <div class="flex flex-col gap-4">
            <p class="text-sm text-muted">
                Cuentas propias donde entran depósitos, transferencias, ACH y remesas. Las activas en quetzales aparecen en el cobro y en el portal.
            </p>
            <div class="flex flex-wrap items-center gap-2">
                <UTabs
                    v-model="filtro"
                    :items="itemsFiltro"
                    :content="false"
                    size="sm"
                    aria-label="Filtrar por estado"
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
            <UTable
                v-else
                :data="cuentas"
                :columns="columnas"
                :loading="cargando"
                :empty="leidas ? 'No hay cuentas bancarias con este filtro.' : ''"
                class="rounded-md border border-default"
            >
                <template #alias-cell="{ row }">
                    <div
                        class="flex min-w-0 flex-col"
                        :data-cuenta="row.original.id"
                    >
                        <span class="font-medium text-highlighted">{{ row.original.banco_nombre }} · {{ row.original.alias }}</span>
                        <span class="font-mono text-xs text-muted sm:hidden">{{ row.original.numero }} · {{ row.original.moneda }}</span>
                    </div>
                </template>
                <template #numero-cell="{ row }">
                    <span class="font-mono">{{ row.original.numero }}</span>
                </template>
                <template #cuenta_codigo-cell="{ row }">
                    <span class="font-mono text-muted">{{ row.original.cuenta_codigo }}</span>
                </template>
                <template #activa-cell="{ row }">
                    <UBadge
                        :label="row.original.activa ? 'Activa' : 'Inactiva'"
                        :color="row.original.activa ? 'success' : 'neutral'"
                        variant="subtle"
                    />
                </template>
                <template #acciones-cell="{ row }">
                    <UButton
                        v-if="puede('cuentas_bancarias.editar')"
                        icon="i-lucide-pencil"
                        color="neutral"
                        variant="ghost"
                        size="sm"
                        :aria-label="`Editar ${row.original.alias}`"
                        @click="editar(row.original)"
                    />
                </template>
            </UTable>
        </div>

        <CuentaBancariaFormulario
            v-if="puede('cuentas_bancarias.editar')"
            v-model:open="abierto"
            :cuenta="editando"
            :bancos="bancos"
            @guardada="alGuardar"
            @recargar="recargarEditada"
        />
    </PanelPagina>
</template>
