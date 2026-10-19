<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { FormSubmitEvent, RadioGroupItem, SelectItem } from '@nuxt/ui'

/**
 * Entrega el premio de un titular (`POST /lealtad/sorteos/:id/ganadores/:g/entregar`,
 * `sorteos.entregar`). La contrapartida depende del tipo del premio (§15.3): efectivo sale de una
 * caja, un banco o una cuenta bancaria por el valor menos el ISR; un bien va contra Proveedores
 * (2.1.03) o una cuenta de activo; un servicio queda como canje para la próxima factura.
 */
const props = defineProps<{
    sorteoId: number
    ganador: GanadorSorteo | null
    premio: PremioSorteo | null
    /** Nombre del ganador para el encabezado. */
    nombre: string
}>()

const abierto = defineModel<boolean>('open', { default: false })

const emit = defineEmits<{
    hecho: [sorteo: SorteoDetalle]
}>()

const { puede } = usePermisos()
const formulario = useTemplateRef('formulario')
const estado = reactive<EntradaEntregaPremio>(entradaEntregaVacia('efectivo'))
const enviando = ref(false)
const problema = ref<Problem | null>(null)
let clave = nuevaClaveIdempotencia()

const cajas = shallowRef<Caja[]>([])
const cuentas = shallowRef<CuentaBancaria[]>([])
const bancosLibro = shallowRef<BancoLibro[]>([])
const problemaCatalogos = ref<Problem | null>(null)

const isr = computed(() => (props.premio ? isrPremio(props.premio) : null))
const neto = computed(() => (props.premio ? netoPremio(props.premio) : null))

const itemsMetodo: RadioGroupItem[] = [
    { label: 'Caja', value: 'caja' },
    { label: 'Banco', value: 'banco' },
    { label: 'Cuenta bancaria', value: 'cuenta_bancaria' },
]
const itemsContrapartida: RadioGroupItem[] = [
    { label: 'Proveedores (2.1.03)', value: 'proveedor', description: 'Comprado a crédito' },
    { label: 'Cuenta de activo', value: 'cuenta', description: 'P. ej. inventario de premios' },
]
const itemsCaja = computed<SelectItem[]>(() => cajas.value.filter(c => c.activa).map(c => ({ label: c.nombre, value: c.id })))
const itemsBanco = computed<SelectItem[]>(() => bancosLibro.value.map(b => ({ label: b.nombre, value: b.id, description: `${b.cuenta_codigo} · ${b.cuenta_nombre}` })))
const itemsCuenta = computed<SelectItem[]>(() => cuentas.value.filter(c => c.activa && c.moneda === 'GTQ').map(c => ({ label: `${c.banco_nombre} · ${c.alias}`, value: c.id, description: c.numero })))

async function cargarCatalogos() {
    problemaCatalogos.value = null
    const [rCajas, rCuentas, rBancos] = await Promise.all([
        puede('cajas.ver') ? useCajas().listar() : null,
        puede('cuentas_bancarias.ver') ? useCuentasBancarias().listar({ activa: true }) : null,
        puede('egresos.ver') ? useLibro().bancos() : null,
    ])
    cajas.value = rCajas?.ok ? rCajas.data : []
    cuentas.value = rCuentas?.ok ? rCuentas.data : []
    bancosLibro.value = rBancos?.ok ? rBancos.data : []
    problemaCatalogos.value = (rCajas && !rCajas.ok ? rCajas.problema : null)
        ?? (rCuentas && !rCuentas.ok ? rCuentas.problema : null)
        ?? (rBancos && !rBancos.ok ? rBancos.problema : null)
    if (estado.caja_id === null && itemsCaja.value.length === 1) {
        estado.caja_id = cajas.value.find(c => c.activa)?.id ?? null
    }
    if (estado.banco_id === null && bancosLibro.value.length) {
        estado.banco_id = bancosLibro.value[0]?.id ?? null
    }
}

watch(abierto, (valor) => {
    if (valor && props.premio) {
        Object.assign(estado, entradaEntregaVacia(props.premio.tipo))
        problema.value = null
        clave = nuevaClaveIdempotencia()
        if (props.premio.tipo === 'efectivo') {
            void cargarCatalogos()
        }
    }
})

async function enviar(evento: FormSubmitEvent<EntradaEntregaPremio>) {
    if (!props.ganador) {
        return
    }
    enviando.value = true
    problema.value = null
    const resultado = await useSorteos().entregar(props.sorteoId, props.ganador.id, cuerpoEntregaPremio(esquemaEntregaPremio.parse(evento.data)), clave)
    enviando.value = false
    if (resultado.ok) {
        abierto.value = false
        emit('hecho', resultado.data)
        return
    }
    const errores = erroresDeFormulario(resultado.problema).filter(e => e.name && e.name in estado)
    if (errores.length) {
        formulario.value?.setErrors(errores)
    }
    if (!errores.length || errores.length < (resultado.problema.errors?.length ?? 0)) {
        problema.value = problemaSorteoLegible(resultado.problema)
    }
}
</script>

<template>
    <UModal
        v-model:open="abierto"
        title="Entregar premio"
        :description="premio ? `${premio.nombre} · ${nombre}` : nombre"
        :dismissible="!enviando"
    >
        <template #body>
            <UForm
                v-if="premio && ganador"
                id="form-entregar-premio"
                ref="formulario"
                :schema="esquemaEntregaPremio"
                :state="estado"
                class="flex flex-col gap-4"
                @submit="enviar"
            >
                <dl class="grid grid-cols-2 gap-3 rounded-lg border border-default p-3 sm:grid-cols-3">
                    <DatoFicha
                        etiqueta="Tipo"
                        :valor="TIPOS_PREMIO_SORTEO[premio.tipo].etiqueta"
                    />
                    <DatoFicha
                        etiqueta="Valor"
                        :valor="formatearQuetzales(premio.valor)"
                    />
                    <DatoFicha
                        etiqueta="ISR"
                        :valor="premio.retiene_isr && isr ? `${formatearQuetzales(isr)} (${formatearPorcentaje(premio.isr_pct)} %)` : 'Sin ISR'"
                    />
                    <DatoFicha
                        v-if="premio.tipo === 'efectivo' && neto"
                        etiqueta="Se paga"
                        :valor="formatearQuetzales(neto)"
                        data-prueba="entrega-neto"
                    />
                    <DatoFicha
                        etiqueta="Ganador"
                        :valor="`${ganador.posicion}.º · ${ganador.codigo_publico}`"
                        mono
                        class="min-w-0 [&_dd]:break-all"
                    />
                </dl>

                <template v-if="premio.tipo === 'efectivo'">
                    <UFormField
                        label="De dónde sale el efectivo"
                        name="metodo"
                        required
                    >
                        <URadioGroup
                            v-model="estado.metodo"
                            :items="itemsMetodo"
                            orientation="horizontal"
                            data-prueba="entrega-metodo"
                        />
                    </UFormField>
                    <UFormField
                        v-if="estado.metodo === 'caja'"
                        label="Caja"
                        name="caja_id"
                        required
                        help="Baja el esperado del turno abierto de esa caja."
                    >
                        <USelect
                            v-model="estado.caja_id"
                            :items="itemsCaja"
                            placeholder="Elija la caja"
                            class="w-full"
                            data-prueba="entrega-caja"
                        />
                    </UFormField>
                    <UFormField
                        v-if="estado.metodo === 'banco'"
                        label="Banco"
                        name="banco_id"
                        required
                    >
                        <USelect
                            v-model="estado.banco_id"
                            :items="itemsBanco"
                            placeholder="Elija el banco"
                            class="w-full"
                        />
                    </UFormField>
                    <UFormField
                        v-if="estado.metodo === 'cuenta_bancaria'"
                        label="Cuenta bancaria"
                        name="cuenta_bancaria_id"
                        required
                    >
                        <USelect
                            v-model="estado.cuenta_bancaria_id"
                            :items="itemsCuenta"
                            placeholder="Elija la cuenta"
                            class="w-full"
                        />
                    </UFormField>
                    <ProblemaAlerta
                        v-if="problemaCatalogos"
                        :problema="problemaCatalogos"
                        :reintentar="cargarCatalogos"
                    />
                </template>

                <template v-else-if="premio.tipo === 'bien'">
                    <UFormField
                        label="Contrapartida"
                        name="contrapartida"
                        required
                        help="Gasto 5.1.03 Premios y promociones contra esta cuenta."
                    >
                        <URadioGroup
                            v-model="estado.contrapartida"
                            :items="itemsContrapartida"
                            data-prueba="entrega-contrapartida"
                        />
                    </UFormField>
                    <UFormField
                        v-if="estado.contrapartida === 'cuenta'"
                        label="Código de la cuenta de activo"
                        name="cuenta_codigo"
                        required
                        help="Imputable y de la empresa. Ojo: 1.1.07 es ISR de pagos trimestrales, no inventario."
                    >
                        <UInput
                            v-model="estado.cuenta_codigo"
                            placeholder="1.1.08"
                            class="w-full font-mono"
                        />
                    </UFormField>
                </template>

                <UAlert
                    v-else
                    color="neutral"
                    variant="subtle"
                    icon="i-lucide-wifi"
                    title="Canje para la próxima factura"
                    description="Se registra un canje sin puntos del premio del catálogo para el servicio del ganador; la próxima factura lo aplica como descuento."
                />

                <UFormField
                    label="Nota"
                    name="nota"
                    help="Constancia de entrega, quién recibió…"
                >
                    <UTextarea
                        v-model="estado.nota"
                        :rows="2"
                        autoresize
                        class="w-full"
                    />
                </UFormField>
                <ProblemaAlerta
                    v-if="problema"
                    :problema="problema"
                    data-prueba="entregar-problema"
                />
            </UForm>
        </template>
        <template #footer>
            <div class="flex w-full justify-end gap-2">
                <UButton
                    label="Cancelar"
                    color="neutral"
                    variant="ghost"
                    :disabled="enviando"
                    @click="abierto = false"
                />
                <UButton
                    type="submit"
                    form="form-entregar-premio"
                    label="Registrar entrega"
                    icon="i-lucide-gift"
                    :loading="enviando"
                    data-prueba="confirmar-entrega"
                />
            </div>
        </template>
    </UModal>
</template>
