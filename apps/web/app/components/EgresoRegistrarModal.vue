<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { FormSubmitEvent, SelectItem } from '@nuxt/ui'

/**
 * Registra un egreso (`POST /egresos`, `egresos.registrar`) con su `Idempotency-Key` por
 * apertura. Los 422 por campo se muestran junto a cada campo; los demás errores, abajo.
 */
const props = defineProps<{
    categorias: CategoriaEgresoApi[]
}>()

const abierto = defineModel<boolean>('open', { default: false })

const emit = defineEmits<{
    hecho: [egreso: Egreso]
}>()

const { puede } = usePermisos()
const formulario = useTemplateRef('formulario')
const hoy = hoyGuatemala()
const esquema = esquemaEgreso(hoy)
const estado = reactive<EntradaEgreso>(entradaEgresoVacia())
const enviando = ref(false)
const problema = ref<Problem | null>(null)
let clave = nuevaClaveIdempotencia()

const cajas = shallowRef<Caja[]>([])
const cuentas = shallowRef<CuentaBancaria[]>([])
const bancosLibro = shallowRef<BancoLibro[]>([])
const problemaCatalogos = ref<Problem | null>(null)

const itemsCategoria = computed<SelectItem[]>(() => (props.categorias.length
    ? props.categorias.map(c => ({ label: c.nombre, value: c.clave, description: `${c.cuenta_codigo} · ${c.cuenta_nombre}` }))
    : Object.entries(CATEGORIAS_EGRESO).map(([value, label]) => ({ label, value }))))
const itemsMetodo: SelectItem[] = Object.entries(METODOS_EGRESO).map(([value, label]) => ({ label, value }))
const itemsCaja = computed<SelectItem[]>(() => cajas.value.filter(c => c.activa).map(c => ({ label: c.nombre, value: c.id })))
/** Bancos del libro (`GET /libro/bancos`); el primero es el principal (1.1.02.01). */
const itemsBanco = computed<SelectItem[]>(() => bancosLibro.value.map(b => ({
    label: b.nombre,
    value: b.id,
    description: [b.banco, b.numero_enmascarado, `${b.cuenta_codigo} · ${b.cuenta_nombre}`].filter(Boolean).join(' · '),
})))
const itemsCuenta = computed<SelectItem[]>(() => cuentas.value
    .filter(c => c.activa && c.moneda === 'GTQ')
    .map(c => ({ label: `${c.banco_nombre} · ${c.alias}`, value: c.id, description: c.numero })))

/** El turno abierto de la caja elegida: el efectivo sale de ahí y baja el esperado del cierre. */
const cajaElegida = computed(() => cajas.value.find(c => c.id === estado.caja_id) ?? null)

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
    const fallo = (rCajas && !rCajas.ok ? rCajas.problema : null)
        ?? (rCuentas && !rCuentas.ok ? rCuentas.problema : null)
        ?? (rBancos && !rBancos.ok ? rBancos.problema : null)
    problemaCatalogos.value = fallo
    if (estado.caja_id === null && cajas.value.length === 1) {
        estado.caja_id = cajas.value[0]?.id ?? null
    }
    if (estado.banco_id === null && bancosLibro.value.length === 1) {
        estado.banco_id = bancosLibro.value[0]?.id ?? null
    }
}

watch(abierto, (valor) => {
    if (valor) {
        Object.assign(estado, entradaEgresoVacia())
        problema.value = null
        clave = nuevaClaveIdempotencia()
        void cargarCatalogos()
    }
})

async function enviar(evento: FormSubmitEvent<SalidaEgreso>) {
    enviando.value = true
    problema.value = null
    const resultado = await useEgresos().registrar(cuerpoEgreso(evento.data), clave)
    enviando.value = false
    if (resultado.ok) {
        abierto.value = false
        emit('hecho', resultado.data)
        return
    }
    const errores = erroresDeFormulario(resultado.problema)
    if (errores.length) {
        formulario.value?.setErrors(errores)
    }
    // Un 422 sin campo del formulario (p. ej. `periodo_cerrado`) o cualquier otro error, abajo.
    const campos = new Set(Object.keys(estado))
    if (!errores.length || errores.some(e => !e.name || !campos.has(e.name))) {
        problema.value = resultado.problema
    }
}
</script>

<template>
    <UModal
        v-model:open="abierto"
        title="Registrar egreso"
        description="Gasto pagado por caja, banco o una cuenta bancaria propia. Genera su asiento en el libro."
        :dismissible="!enviando"
    >
        <template #body>
            <UForm
                id="form-egreso"
                ref="formulario"
                :schema="esquema"
                :state="estado"
                class="flex flex-col gap-4"
                @submit="enviar"
            >
                <div class="grid gap-4 sm:grid-cols-2">
                    <UFormField
                        label="Categoría"
                        name="categoria"
                        required
                    >
                        <USelect
                            v-model="estado.categoria"
                            :items="itemsCategoria"
                            class="w-full"
                            data-prueba="egreso-categoria"
                        />
                    </UFormField>
                    <UFormField
                        label="Monto"
                        name="monto"
                        required
                    >
                        <UInput
                            v-model="estado.monto"
                            inputmode="decimal"
                            placeholder="150.00"
                            class="w-full"
                            data-prueba="egreso-monto"
                        >
                            <template #leading>
                                <span class="text-sm text-muted">Q</span>
                            </template>
                        </UInput>
                    </UFormField>
                    <UFormField
                        label="Pagado con"
                        name="metodo"
                        required
                    >
                        <USelect
                            v-model="estado.metodo"
                            :items="itemsMetodo"
                            class="w-full"
                        />
                    </UFormField>
                    <UFormField
                        label="Fecha contable"
                        name="fecha"
                        help="Vacía: hoy. No puede ser futura ni de un mes cerrado."
                    >
                        <UInput
                            v-model="estado.fecha"
                            type="date"
                            :max="hoy"
                            class="w-full"
                        />
                    </UFormField>
                    <UFormField
                        v-if="estado.metodo === 'caja'"
                        label="Caja"
                        name="caja_id"
                        required
                        class="sm:col-span-2"
                        :help="cajaElegida ? (cajaElegida.turno_abierto_id ? `Sale del turno abierto #${cajaElegida.turno_abierto_id}: baja el esperado del cierre.` : 'La caja no tiene turno abierto: el efectivo sale de la caja sin turno.') : undefined"
                    >
                        <USelect
                            v-model="estado.caja_id"
                            :items="itemsCaja"
                            placeholder="Elige la caja"
                            class="w-full"
                        />
                    </UFormField>
                    <UFormField
                        v-if="estado.metodo === 'cuenta_bancaria'"
                        label="Cuenta bancaria"
                        name="cuenta_bancaria_id"
                        required
                        class="sm:col-span-2"
                    >
                        <USelect
                            v-model="estado.cuenta_bancaria_id"
                            :items="itemsCuenta"
                            placeholder="Elige la cuenta"
                            class="w-full"
                        />
                    </UFormField>
                    <UFormField
                        v-if="estado.metodo === 'banco'"
                        label="Banco"
                        name="banco_id"
                        class="sm:col-span-2"
                        help="Cuenta bancaria del libro de donde sale el dinero. Sin elegir: el banco principal."
                    >
                        <USelect
                            v-model="estado.banco_id"
                            :items="itemsBanco"
                            placeholder="Banco principal"
                            class="w-full"
                            data-prueba="egreso-banco"
                        />
                    </UFormField>
                    <UFormField
                        label="Proveedor"
                        name="proveedor"
                    >
                        <UInput
                            v-model="estado.proveedor"
                            placeholder="EEGSA"
                            class="w-full"
                        />
                    </UFormField>
                    <UFormField
                        label="Documento del proveedor"
                        name="comprobante"
                    >
                        <UInput
                            v-model="estado.comprobante"
                            placeholder="Serie y número de la factura"
                            class="w-full"
                        />
                    </UFormField>
                    <UFormField
                        label="Descripción"
                        name="descripcion"
                        class="sm:col-span-2"
                    >
                        <UTextarea
                            v-model="estado.descripcion"
                            :rows="2"
                            class="w-full"
                        />
                    </UFormField>
                </div>

                <ProblemaAlerta
                    v-if="problemaCatalogos"
                    :problema="problemaCatalogos"
                    :reintentar="cargarCatalogos"
                />
                <ProblemaAlerta
                    v-if="problema"
                    :problema="problema"
                    data-prueba="egreso-error"
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
                    form="form-egreso"
                    label="Registrar egreso"
                    icon="i-lucide-receipt"
                    :loading="enviando"
                    data-prueba="egreso-registrar"
                />
            </div>
        </template>
    </UModal>
</template>
