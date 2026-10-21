<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { FormSubmitEvent, RadioGroupItem, SelectItem } from '@nuxt/ui'

/**
 * Entrega el premio de un titular (`POST /lealtad/sorteos/:id/ganadores/:g/entregar`,
 * `sorteos.entregar`). La contrapartida depende del tipo del premio (§15.3): efectivo sale de una
 * caja, un banco o una cuenta bancaria por el valor menos el ISR; un bien se entrega con la línea de
 * la compra registrada con que se compró (`compra`, decisión del PM: un bien a crédito también se
 * registra primero como compra; `proveedor` responde 422) o contra una cuenta de activo de la lista
 * blanca (H25, p. ej. un inventario de premios); un servicio queda como canje para la próxima factura.
 */
const props = defineProps<{
    sorteoId: number
    ganador: GanadorSorteo | null
    premio: PremioSorteo | null
    /** Nombre del ganador para el encabezado. */
    nombre: string
    /** Empresa del sorteo: las compras y cuentas se filtran por ella. */
    empresaId: number
    /** Unidades ya entregadas por línea de compra en este sorteo (la API respondería 422 `compra_ya_entregada`). */
    unidadesUsadas: Record<number, number>
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
    { label: 'Compra registrada', value: 'compra', description: 'El bien se compró con factura (al contado o a crédito)' },
    { label: 'Cuenta de activo', value: 'cuenta', description: 'P. ej. inventario de premios' },
]

/* Constancia firmada de la entrega (opcional): se sube antes (`POST .../archivos`, uso `constancia`). */
const constancia = ref<File | null>(null)
const errorConstancia = ref<string | null>(null)

const revisandoConstancia = shallowRef<Promise<void> | null>(null)

watch(constancia, (nuevo) => {
    errorConstancia.value = null
    revisandoConstancia.value = nuevo
        ? nuevo.arrayBuffer().then((datos) => {
                if (constancia.value === nuevo) {
                    errorConstancia.value = errorArchivoSorteo(new Uint8Array(datos))
                }
            })
        : null
})

const compras = shallowRef<Compra[]>([])
const cuentasLibro = shallowRef<Cuenta[]>([])
const problemaBien = ref<Problem | null>(null)
const cargandoBien = ref(false)
const lineas = computed(() => lineasDeBien(compras.value, props.empresaId, props.unidadesUsadas))
const lineaElegida = computed(() => lineas.value.find(l => l.linea.id === estado.compra_linea_id) ?? null)

// Otra línea: las unidades no pasan de lo que le queda.
watch(lineaElegida, (linea) => {
    if (linea && estado.unidades > linea.quedan) {
        estado.unidades = linea.quedan
    }
})
const itemsLinea = computed<SelectItem[]>(() => lineas.value
    .map(({ compra, linea, quedan }) => ({
        label: (linea.cantidad ?? 1) > 1 ? `${linea.descripcion} (quedan ${quedan} de ${linea.cantidad})` : linea.descripcion,
        value: linea.id,
        // Lo que distingue la línea primero (base y documento), para que en 390 px no se corte el monto.
        description: `${formatearQuetzales(linea.base)} sin IVA · ${compra.serie}-${compra.numero} · ${compra.proveedor_nombre}`,
    })))
const itemsCuentaActivo = computed<SelectItem[]>(() => cuentasLibro.value
    .filter(c => cuentaParaBienDePremio(c, props.empresaId))
    .map(c => ({ label: `${c.codigo} · ${c.nombre}`, value: c.codigo })))

/** Compras vigentes (con `compras.ver`) y cuentas del plan (con `libro.ver`) para el bien. */
async function cargarBien() {
    cargandoBien.value = true
    problemaBien.value = null
    const [rCompras, rCuentas] = await Promise.all([
        puede('compras.ver') ? useCompras().listar({ estado: 'vigente', limit: 200 }) : null,
        puede('libro.ver') ? useLibro().cuentas() : null,
    ])
    cargandoBien.value = false
    compras.value = rCompras?.ok ? rCompras.data.data : []
    cuentasLibro.value = rCuentas?.ok ? rCuentas.data : []
    problemaBien.value = (rCompras && !rCompras.ok ? rCompras.problema : null) ?? (rCuentas && !rCuentas.ok ? rCuentas.problema : null)
}
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
        constancia.value = null
        errorConstancia.value = null
        problema.value = null
        clave = nuevaClaveIdempotencia()
        if (props.premio.tipo === 'efectivo') {
            void cargarCatalogos()
        }
        if (props.premio.tipo === 'bien') {
            void cargarBien()
        }
    }
})

async function enviar(evento: FormSubmitEvent<EntradaEntregaPremio>) {
    if (!props.ganador) {
        return
    }
    await revisandoConstancia.value
    if (errorConstancia.value) {
        return
    }
    enviando.value = true
    problema.value = null
    let constanciaId: number | null = null
    if (constancia.value && puede('sorteos.marcar_requisito')) {
        const subida = await useSorteos().subirArchivo(props.sorteoId, 'constancia', constancia.value)
        if (!subida.ok) {
            enviando.value = false
            const enCampo = subida.problema.errors?.find(e => e.field === 'archivo')
            errorConstancia.value = enCampo?.message ?? null
            problema.value = enCampo ? null : subida.problema
            return
        }
        constanciaId = subida.data.id
        constancia.value = null
    }
    const cuerpo = cuerpoEntregaPremio(esquemaEntregaPremio.parse(evento.data))
    const resultado = await useSorteos().entregar(props.sorteoId, props.ganador.id, constanciaId ? { ...cuerpo, constancia_archivo_id: constanciaId } : cuerpo, clave)
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
                        help="Gasto 5.1.03 Premios y promociones por la base sin IVA."
                    >
                        <URadioGroup
                            v-model="estado.contrapartida"
                            :items="itemsContrapartida"
                            data-prueba="entrega-contrapartida"
                        />
                    </UFormField>
                    <UFormField
                        v-if="estado.contrapartida === 'compra'"
                        label="Línea de la compra"
                        name="compra_linea_id"
                        required
                        :help="puede('compras.ver') ? 'Un bien de una compra vigente de la empresa. Si se compró a crédito, registre antes la compra.' : undefined"
                    >
                        <USelect
                            v-if="puede('compras.ver')"
                            v-model="estado.compra_linea_id"
                            :items="itemsLinea"
                            :loading="cargandoBien"
                            placeholder="Elija el bien comprado"
                            class="w-full"
                            data-prueba="entrega-compra-linea"
                        />
                        <p
                            v-else
                            class="text-sm text-muted"
                        >
                            Sin el permiso compras.ver no se pueden listar las compras: use una cuenta de activo o pida la entrega a quien lo tenga.
                        </p>
                    </UFormField>
                    <UFormField
                        v-if="estado.contrapartida === 'compra' && lineaElegida"
                        label="Unidades que se entregan"
                        name="unidades"
                        required
                        :help="`De ${lineaElegida.quedan} disponibles en esta línea. El gasto es la parte de la base por unidad.`"
                    >
                        <UInputNumber
                            v-model="estado.unidades"
                            :min="1"
                            :max="lineaElegida.quedan"
                            class="w-full"
                            data-prueba="entrega-unidades"
                        />
                    </UFormField>
                    <p
                        v-if="estado.contrapartida === 'compra' && puede('compras.ver') && !cargandoBien && !problemaBien && !itemsLinea.length"
                        class="text-sm text-muted"
                        data-prueba="entrega-sin-compras"
                    >
                        No hay bienes en compras vigentes de la empresa. Registre la compra del premio (al contado o a crédito) y vuelva a abrir esta ventana.
                    </p>
                    <UFormField
                        v-if="estado.contrapartida === 'cuenta'"
                        label="Cuenta de activo"
                        name="cuenta_codigo"
                        required
                        help="Solo activos imputables fuera de las cuentas control (caja, bancos, CxC, impuestos, tránsito, activo fijo…)."
                    >
                        <USelect
                            v-if="puede('libro.ver')"
                            v-model="estado.cuenta_codigo"
                            :items="itemsCuentaActivo"
                            :loading="cargandoBien"
                            placeholder="Elija la cuenta"
                            class="w-full"
                            data-prueba="entrega-cuenta"
                        />
                        <UInput
                            v-else
                            v-model="estado.cuenta_codigo"
                            placeholder="Código, p. ej. 1.1.14"
                            class="w-full font-mono"
                            data-prueba="entrega-cuenta"
                        />
                    </UFormField>
                    <ProblemaAlerta
                        v-if="problemaBien"
                        :problema="problemaBien"
                        :reintentar="cargarBien"
                        :reintentando="cargandoBien"
                    />
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
                    v-if="puede('sorteos.marcar_requisito')"
                    label="Constancia firmada"
                    :error="errorConstancia ?? undefined"
                    help="Opcional: la constancia de entrega firmada (PDF o foto, hasta 5 MB). Queda con su SHA-256."
                >
                    <UFileUpload
                        v-model="constancia"
                        :accept="TIPOS_ARCHIVO_SORTEO"
                        label="Elija o arrastre la constancia"
                        icon="i-lucide-file-signature"
                        layout="list"
                        class="w-full"
                        data-prueba="entrega-constancia"
                    />
                </UFormField>
                <UFormField
                    label="Nota"
                    name="nota"
                    help="Quién recibió, observaciones…"
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
