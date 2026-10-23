<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { SelectItem } from '@nuxt/ui'

/**
 * De dónde sale el dinero de una compra al contado o de un pago a proveedor: efectivo de una caja (de su
 * turno abierto), un banco del libro o una cuenta bancaria propia. Va dentro de un `UForm`: los campos se
 * llaman `metodo`, `caja_id`, `banco_id` y `cuenta_bancaria_id` para que los errores caigan en su sitio.
 * Lee las cajas (`cajas.ver`), las cuentas (`cuentas_bancarias.ver`) y los bancos del libro (`egresos.ver`)
 * solo con su permiso.
 */
const metodo = defineModel<MetodoPagoCompra>('metodo', { required: true })
const cajaId = defineModel<number | null>('cajaId', { required: true })
const bancoId = defineModel<number | null>('bancoId', { required: true })
const cuentaBancariaId = defineModel<number | null>('cuentaBancariaId', { required: true })

const { puede } = usePermisos()

const cajas = shallowRef<Caja[]>([])
const cuentas = shallowRef<CuentaBancaria[]>([])
const bancosLibro = shallowRef<BancoLibro[]>([])
const problema = ref<Problem | null>(null)

const itemsMetodo: SelectItem[] = Object.entries(METODOS_PAGO_COMPRA).map(([value, label]) => ({ label, value }))
const itemsCaja = computed<SelectItem[]>(() => cajas.value.filter(c => c.activa).map(c => ({ label: c.nombre, value: c.id, description: c.turno_abierto_id ? `Turno #${c.turno_abierto_id}` : 'Sin turno abierto' })))
const itemsBanco = computed<SelectItem[]>(() => bancosLibro.value.map(b => ({ label: b.nombre, value: b.id, description: `${b.cuenta_codigo} · ${b.cuenta_nombre}` })))
const itemsCuenta = computed<SelectItem[]>(() => cuentas.value.filter(c => c.activa && c.moneda === 'GTQ').map(c => ({ label: `${c.banco_nombre} · ${c.alias}`, value: c.id, description: c.numero })))
const cajaElegida = computed(() => cajas.value.find(c => c.id === cajaId.value) ?? null)

async function cargar() {
    const [rCajas, rCuentas, rBancos] = await Promise.all([
        puede('cajas.ver') ? useCajas().listar() : null,
        puede('cuentas_bancarias.ver') ? useCuentasBancarias().listar({ activa: true }) : null,
        puede('egresos.ver') ? useLibro().bancos() : null,
    ])
    cajas.value = rCajas?.ok ? rCajas.data : []
    cuentas.value = rCuentas?.ok ? rCuentas.data : []
    bancosLibro.value = rBancos?.ok ? rBancos.data : []
    problema.value = (rCajas && !rCajas.ok ? rCajas.problema : null)
        ?? (rCuentas && !rCuentas.ok ? rCuentas.problema : null)
        ?? (rBancos && !rBancos.ok ? rBancos.problema : null)
}

onMounted(cargar)
</script>

<template>
    <div class="grid gap-4 sm:grid-cols-2">
        <ProblemaAlerta
            v-if="problema"
            :problema="problema"
            :reintentar="cargar"
            class="sm:col-span-2"
        />
        <UFormField
            label="Pagado con"
            name="metodo"
            required
        >
            <USelect
                v-model="metodo"
                :items="itemsMetodo"
                class="w-full"
                data-prueba="medio-metodo"
            />
        </UFormField>
        <UFormField
            v-if="metodo === 'caja'"
            label="Caja"
            name="caja_id"
            required
            :help="cajaElegida ? (cajaElegida.turno_abierto_id ? `Sale del turno abierto #${cajaElegida.turno_abierto_id}: baja su esperado.` : 'La caja no tiene turno abierto.') : undefined"
        >
            <USelect
                v-model="cajaId"
                :items="itemsCaja"
                placeholder="Elige la caja"
                class="w-full"
            />
        </UFormField>
        <UFormField
            v-if="metodo === 'banco'"
            label="Banco"
            name="banco_id"
            help="Sin elegir: el banco principal del libro."
        >
            <USelect
                v-model="bancoId"
                :items="itemsBanco"
                placeholder="Banco principal"
                class="w-full"
            />
        </UFormField>
        <UFormField
            v-if="metodo === 'cuenta_bancaria'"
            label="Cuenta bancaria"
            name="cuenta_bancaria_id"
            required
        >
            <USelect
                v-model="cuentaBancariaId"
                :items="itemsCuenta"
                placeholder="Elige la cuenta"
                class="w-full"
            />
        </UFormField>
    </div>
</template>
