<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { SelectItem } from '@nuxt/ui'
import Decimal from 'decimal.js'

/**
 * Reponer la caja chica (tablero PlanCajas, ventana «Reponer»; B9, `POST /cajas/:id/reponer`,
 * `caja_chica.reponer`): siempre por lo gastado (fondo fijo − efectivo), desde tu custodia o desde
 * el banco; nunca desde una caja de cobros. Los comprobantes quedan sellados como «repuestos».
 */
const props = defineProps<{
    caja: EstadoCajaChica
    /** Lo que tienes en custodia (`null` si no se pudo leer o no tienes). */
    custodia: Decimal | null
}>()

const abierto = defineModel<boolean>('open', { default: false })

const emit = defineEmits<{
    hecho: [reposicion: ReposicionCaja]
}>()

const toast = useToast()
const { puede } = usePermisos()
const monto = computed(() => new Decimal(props.caja.por_reponer))
const alcanzaCustodia = computed(() => Boolean(props.custodia?.gte(monto.value)))
const estado = reactive<EntradaReponerCajaChica>({ desde: 'custodia', cuenta_bancaria_id: null, referencia: '' })
const cuentas = shallowRef<SelectItem[]>([])
const problemaCuentas = ref<Problem | null>(null)
const enviando = ref(false)
const problema = ref<Problem | null>(null)
let clave = nuevaClaveIdempotencia()

async function cargarCuentas() {
    if (!puede('cuentas_bancarias.ver')) {
        return
    }
    const resultado = await useCuentasBancarias().listar()
    problemaCuentas.value = resultado.ok ? null : resultado.problema
    cuentas.value = resultado.ok
        ? resultado.data.filter(c => c.activa && c.moneda === 'GTQ').map(c => ({ label: `${c.banco_nombre} · ${c.alias} ···${c.numero.slice(-4)}`, value: c.id }))
        : []
}

watch(abierto, (valor) => {
    if (valor) {
        Object.assign(estado, { desde: alcanzaCustodia.value ? 'custodia' : 'banco', cuenta_bancaria_id: null, referencia: '' })
        problema.value = null
        clave = nuevaClaveIdempotencia()
        void cargarCuentas()
    }
}, { immediate: true })

async function reponer() {
    const datos = esquemaReponerCajaChica.safeParse(estado)
    if (!datos.success) {
        problema.value = { type: 'about:blank', title: datos.error.issues[0]?.message ?? 'Revisa los datos', status: 422 }
        return
    }
    enviando.value = true
    problema.value = null
    const resultado = await useCajaChica().reponer(props.caja.caja_id, {
        desde: datos.data.desde,
        monto: monto.value.toFixed(2),
        referencia: datos.data.referencia || null,
        ...(datos.data.desde === 'banco' && datos.data.cuenta_bancaria_id ? { cuenta_bancaria_id: datos.data.cuenta_bancaria_id } : {}),
    }, clave)
    enviando.value = false
    if (!resultado.ok) {
        if (resultado.problema.status >= 400 && resultado.problema.status < 500) {
            clave = nuevaClaveIdempotencia()
        }
        problema.value = resultado.problema
        return
    }
    abierto.value = false
    toast.add({ title: `Caja chica repuesta: ${formatearQuetzales(resultado.data.monto)}`, description: `${resultado.data.gastos} comprobantes quedaron sellados.`, color: 'success', icon: 'i-lucide-refresh-cw' })
    emit('hecho', resultado.data)
}
</script>

<template>
    <UModal
        v-model:open="abierto"
        :dismissible="!enviando"
        :ui="{ content: 'sm:max-w-[32.5rem]', header: 'items-start', footer: 'justify-end bg-(--ax-cabecera-tabla)' }"
    >
        <template #title>
            <ModalTitulo
                texto="Reponer la caja chica"
                icono="i-lucide-refresh-cw"
            />
        </template>
        <template #description>
            <span class="ps-13">{{ caja.nombre }} · por lo gastado</span>
        </template>

        <template #body>
            <div class="flex flex-col gap-4">
                <dl class="flex flex-col gap-2 rounded-2xl bg-(--ax-panel) p-4 text-sm">
                    <div class="flex justify-between gap-3">
                        <dt class="text-muted">
                            Comprobantes desde la última reposición
                        </dt>
                        <dd class="font-semibold tabular-nums">
                            {{ caja.comprobantes.cantidad }} · {{ formatearQuetzales(caja.comprobantes.monto) }}
                        </dd>
                    </div>
                    <div
                        v-if="caja.diferencias.cantidad"
                        class="flex justify-between gap-3"
                    >
                        <dt class="text-muted">
                            Diferencias de conteo
                        </dt>
                        <dd class="tabular-nums">
                            {{ formatearQuetzales(caja.diferencias.monto) }}
                        </dd>
                    </div>
                    <div class="flex justify-between gap-3">
                        <dt class="text-muted">
                            Fondo fijo
                        </dt>
                        <dd class="tabular-nums">
                            {{ formatearQuetzales(caja.fondo_fijo) }}
                        </dd>
                    </div>
                    <div class="flex items-baseline justify-between gap-3 border-t border-(--ax-borde) pt-2">
                        <dt class="font-semibold text-highlighted">
                            Se repone
                        </dt>
                        <dd
                            class="text-lg font-bold tabular-nums text-highlighted"
                            data-prueba="reponer-monto"
                        >
                            {{ formatearQuetzales(caja.por_reponer) }}
                        </dd>
                    </div>
                </dl>

                <URadioGroup
                    v-model="estado.desde"
                    legend="De dónde sale"
                    variant="card"
                    :items="[
                        { value: 'custodia', label: 'De tu custodia', description: custodia ? `Tienes ${formatearQuetzales(custodia)} · no pasa por el banco` : 'No tienes efectivo en custodia', disabled: !alcanzaCustodia },
                        { value: 'banco', label: 'Del banco', description: 'Cheque o retiro de una cuenta de la empresa' },
                    ]"
                    data-prueba="reponer-desde"
                />

                <template v-if="estado.desde === 'banco'">
                    <ProblemaAlerta
                        v-if="problemaCuentas"
                        :problema="problemaCuentas"
                        :reintentar="cargarCuentas"
                    />
                    <UFormField
                        v-else
                        label="Cuenta"
                        help="Sin elegir, el banco principal de la empresa"
                    >
                        <USelect
                            v-model="estado.cuenta_bancaria_id"
                            :items="cuentas"
                            placeholder="Banco principal"
                            class="w-full"
                        />
                    </UFormField>
                    <UFormField label="Cheque o retiro">
                        <UInput
                            v-model="estado.referencia"
                            placeholder="Cheque 1043"
                            class="w-full"
                            data-prueba="reponer-referencia"
                        />
                    </UFormField>
                </template>

                <p class="text-sm text-muted">
                    Los {{ caja.comprobantes.cantidad }} comprobantes quedan sellados como «repuestos» y ya no se pueden cambiar.
                </p>
                <ProblemaAlerta
                    v-if="problema"
                    :problema="problema"
                />
            </div>
        </template>

        <template #footer>
            <UButton
                label="Cancelar"
                color="neutral"
                variant="ghost"
                :disabled="enviando"
                @click="abierto = false"
            />
            <UButton
                :label="`Reponer ${formatearQuetzales(caja.por_reponer)}`"
                icon="i-lucide-check"
                class="glow-brand rounded-full"
                :loading="enviando"
                data-prueba="reponer-confirmar"
                @click="reponer"
            />
        </template>
    </UModal>
</template>
