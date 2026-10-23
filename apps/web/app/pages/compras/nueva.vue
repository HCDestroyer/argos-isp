<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { FormSubmitEvent, SelectItem } from '@nuxt/ui'

/**
 * Registrar una compra (A3, fase 5; `POST /compras`, `compras.registrar`) o la compra de un egreso ya
 * registrado (`?egreso=`, `POST /compras/desde-egreso/:id`): documento del proveedor, líneas con su tipo
 * (un activo fijo da de alta el activo; un gasto anticipado se difiere en N meses), retenciones sugeridas,
 * ninguna o a mano, y la condición (al contado sale de caja, banco o cuenta; al crédito queda en el
 * auxiliar del proveedor). Las cifras finales las calcula la API; aquí se muestran como referencia.
 */
definePageMeta({ permiso: 'compras.registrar' })

useHead({ title: 'Registrar compra · ArgosIsp' })

const route = useRoute()
const router = useRouter()
const toast = useToast()
const { puede } = usePermisos()

const hoy = hoyGuatemala()
const egresoId = Number(route.query.egreso) || null
const proveedorInicial = Number(route.query.proveedor) || null

const formulario = useTemplateRef('formulario')
const esquema = esquemaCompra(hoy, egresoId !== null)
const estado = reactive<EntradaCompra>({ ...compraVacia(hoy), proveedor_id: proveedorInicial })
const enviando = ref(false)
const problema = ref<Problem | null>(null)
let clave = nuevaClaveIdempotencia()

/* Catálogos: proveedores, cuentas del libro (si se pueden ver) y el egreso de origen. */
const proveedores = shallowRef<Proveedor[]>([])
const cuentas = shallowRef<Cuenta[]>([])
const egreso = shallowRef<Egreso | null>(null)
const problemaCatalogos = ref<Problem | null>(null)

async function cargarCatalogos() {
    const [rProveedores, rCuentas, rEgreso] = await Promise.all([
        puede('proveedores.ver') ? useProveedores().listar({ activo: true, limit: 200 }) : null,
        puede('libro.ver') ? useLibro().cuentas() : null,
        egresoId !== null && puede('egresos.ver') ? useEgresos().ver(egresoId) : null,
    ])
    proveedores.value = rProveedores?.ok ? rProveedores.data.data : []
    cuentas.value = rCuentas?.ok ? rCuentas.data : []
    egreso.value = rEgreso?.ok ? rEgreso.data : null
    problemaCatalogos.value = (rProveedores && !rProveedores.ok ? rProveedores.problema : null)
        ?? (rEgreso && !rEgreso.ok ? rEgreso.problema : null)
        ?? (rCuentas && !rCuentas.ok ? rCuentas.problema : null)
    if (egreso.value && !estado.descripcion) {
        estado.descripcion = egreso.value.descripcion ?? ''
    }
}

const itemsProveedor = computed(() => proveedores.value.map(p => ({ label: p.nombre, value: p.id, description: `${DOCUMENTOS_PROVEEDOR[p.tipo_documento]} ${p.nit}` })))
const proveedor = computed(() => proveedores.value.find(p => p.id === estado.proveedor_id) ?? null)
/** `USelectMenu` usa `undefined` sin elección; el formulario, `null`. */
const proveedorElegido = computed<number | undefined>({
    get: () => estado.proveedor_id ?? undefined,
    set: (valor) => {
        estado.proveedor_id = valor ?? null
    },
})
const itemsTipoDocumento: SelectItem[] = Object.entries(TIPOS_DOCUMENTO_COMPRA).map(([value, label]) => ({ label: `${value} · ${label}`, value }))
const itemsTipoLinea: SelectItem[] = Object.entries(TIPOS_LINEA_COMPRA).map(([value, label]) => ({ label, value }))
const itemsClase: SelectItem[] = Object.entries(CLASES_ACTIVO).map(([value, label]) => ({ label, value }))
const itemsRetencion: SelectItem[] = Object.entries(RETENCIONES_EMITIDAS).map(([value, label]) => ({ label, value, description: value }))
const itemsCuenta = computed(() => [
    { label: 'Según el tipo de línea', value: '' },
    ...cuentas.value.filter(c => c.imputable && c.activa && (c.tipo === 'gasto' || c.tipo === 'activo')).map(c => ({ label: `${c.codigo} · ${c.nombre}`, value: c.codigo })),
])
const itemsCondicion: SelectItem[] = [{ label: 'Al crédito', value: 'credito' }, { label: 'Al contado', value: 'contado' }]
const itemsRetencionesModo = [
    { label: 'Sugeridas', value: 'sugeridas', description: 'Las que tocan según el proveedor (p. ej. ISR al régimen opcional).' },
    { label: 'Ninguna', value: 'ninguna', description: 'Sin retenciones.' },
    { label: 'Elegir', value: 'manual', description: 'Las que indiques, con su monto o calculado con la tasa.' },
]

/* NCRE o NDEB: la compra que corrige (vigente, al crédito y del mismo proveedor). */
const referencias = shallowRef<Compra[]>([])
const corrige = computed(() => estado.tipo_documento === 'NCRE' || estado.tipo_documento === 'NDEB')
const itemsReferencia = computed<SelectItem[]>(() => referencias.value.map(c => ({ label: `${documentoCompra(c)} · saldo ${formatearQuetzales(c.saldo)}`, value: c.id })))

watch(() => [estado.proveedor_id, corrige.value] as const, async ([id, esCorreccion]) => {
    referencias.value = []
    estado.compra_referencia_id = null
    if (!id || !esCorreccion || !puede('compras.ver')) {
        return
    }
    const resultado = await useCompras().listar({ proveedor_id: id, estado: 'vigente', condicion: 'credito' })
    referencias.value = resultado.ok ? resultado.data.data.filter(c => c.tipo_documento !== 'NCRE') : []
})

watch(() => estado.tipo_documento, (tipo) => {
    if (tipo === 'NCRE') {
        estado.condicion = 'credito'
        estado.retenciones_modo = 'ninguna'
    }
    estado.credito_fiscal = !['FPEQ', 'FCAP', 'RECIBO'].includes(tipo)
})

/* Líneas y retenciones. */
function agregarLinea() {
    estado.lineas.push(lineaVacia())
}

function quitarLinea(indice: number) {
    estado.lineas.splice(indice, 1)
}

function agregarRetencion() {
    estado.retenciones.push({ codigo: 'RET_ISR_OPC_C', monto: '' })
}

const totales = computed(() => totalesFormulario(estado))
const cuadraConEgreso = computed(() => !egreso.value || totales.value.total === egreso.value.monto || estado.retenciones_modo !== 'ninguna')

/* Envío. */
async function enviar(evento: FormSubmitEvent<EntradaCompra>) {
    enviando.value = true
    problema.value = null
    const resultado = egresoId !== null
        ? await useCompras().registrarDesdeEgreso(egresoId, cuerpoCompraDesdeEgreso(evento.data), clave)
        : await useCompras().registrar(cuerpoCompra(evento.data), clave)
    enviando.value = false
    if (resultado.ok) {
        toast.add({ title: `Compra #${resultado.data.id} registrada`, description: `${documentoCompra(resultado.data)} · ${formatearQuetzales(resultado.data.total)}`, icon: 'i-lucide-circle-check', color: 'success' })
        await router.push(`/compras/${resultado.data.id}`)
        return
    }
    const errores = erroresDeFormulario(resultado.problema)
    if (resultado.problema.status === 422 && errores.length) {
        formulario.value?.setErrors(errores)
    }
    if (resultado.problema.status !== 422 || !errores.length || codigoProblema(resultado.problema) !== 'validacion') {
        problema.value = problemaCompraLegible(resultado.problema)
    }
    clave = nuevaClaveIdempotencia()
}

onMounted(cargarCatalogos)
</script>

<template>
    <PanelPagina
        id="compra-nueva"
        :titulo="egresoId ? `Compra del egreso #${egresoId}` : 'Registrar compra'"
        icono="i-lucide-shopping-cart"
    >
        <div class="flex flex-col gap-6">
            <ProblemaAlerta
                v-if="problemaCatalogos"
                :problema="problemaCatalogos"
                :reintentar="cargarCatalogos"
            />
            <UAlert
                v-if="egresoId"
                color="info"
                variant="subtle"
                icon="i-lucide-receipt"
                :title="egreso ? `Egreso #${egreso.id} · ${formatearQuetzales(egreso.monto)} · ${formatearFecha(egreso.fecha)}` : `Egreso #${egresoId}`"
                description="El asiento del egreso no cambia: la compra agrega la reclasificación del IVA como crédito fiscal. El total menos las retenciones debe ser el monto del egreso."
                data-prueba="compra-desde-egreso"
            />

            <UForm
                ref="formulario"
                :schema="esquema"
                :state="estado"
                class="flex flex-col gap-6"
                @submit="enviar"
            >
                <section class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    <UFormField
                        label="Proveedor"
                        name="proveedor_id"
                        required
                        class="sm:col-span-2 lg:col-span-1"
                    >
                        <USelectMenu
                            v-model="proveedorElegido"
                            :items="itemsProveedor"
                            value-key="value"
                            placeholder="Busca el proveedor"
                            class="w-full"
                            data-prueba="compra-proveedor"
                        />
                    </UFormField>
                    <UFormField
                        label="Documento"
                        name="tipo_documento"
                        required
                    >
                        <USelect
                            v-model="estado.tipo_documento"
                            :items="itemsTipoDocumento"
                            class="w-full"
                        />
                    </UFormField>
                    <UFormField
                        label="Fecha del documento"
                        name="fecha_documento"
                        required
                    >
                        <UInput
                            v-model="estado.fecha_documento"
                            type="date"
                            :max="hoy"
                            class="w-full"
                        />
                    </UFormField>
                    <UFormField
                        label="Serie"
                        name="serie"
                    >
                        <UInput
                            v-model="estado.serie"
                            class="w-full"
                        />
                    </UFormField>
                    <UFormField
                        label="Número"
                        name="numero"
                        required
                    >
                        <UInput
                            v-model="estado.numero"
                            class="w-full"
                            data-prueba="compra-numero"
                        />
                    </UFormField>
                    <UFormField
                        label="Autorización del DTE"
                        name="autorizacion"
                        help="UUID de la factura electrónica del proveedor (opcional)."
                    >
                        <UInput
                            v-model="estado.autorizacion"
                            class="w-full font-mono"
                        />
                    </UFormField>
                    <UFormField
                        label="Mes del IVA"
                        name="periodo_iva"
                        help="Vacío: el del documento. Hasta la ventana del crédito fiscal."
                    >
                        <UInput
                            v-model="estado.periodo_iva"
                            type="month"
                            :max="hoy.slice(0, 7)"
                            class="w-full"
                        />
                    </UFormField>
                    <UFormField
                        v-if="corrige"
                        label="Compra que corrige"
                        name="compra_referencia_id"
                        :required="estado.tipo_documento === 'NCRE'"
                    >
                        <USelect
                            v-model="estado.compra_referencia_id"
                            :items="itemsReferencia"
                            placeholder="Elige la compra"
                            class="w-full"
                        />
                    </UFormField>
                    <UFormField
                        name="credito_fiscal"
                        class="self-end"
                    >
                        <UCheckbox
                            v-model="estado.credito_fiscal"
                            label="Tomar el crédito fiscal del IVA"
                            :disabled="['FPEQ', 'FCAP', 'RECIBO'].includes(estado.tipo_documento)"
                            description="Sin crédito, el IVA va al costo."
                        />
                    </UFormField>
                    <UFormField
                        label="Descripción"
                        name="descripcion"
                        class="sm:col-span-2 lg:col-span-3"
                    >
                        <UInput
                            v-model="estado.descripcion"
                            class="w-full"
                        />
                    </UFormField>
                </section>

                <section class="flex flex-col gap-3">
                    <div class="flex items-center justify-between gap-2">
                        <h2 class="text-sm font-semibold text-highlighted">
                            Líneas
                        </h2>
                        <UButton
                            label="Agregar línea"
                            icon="i-lucide-plus"
                            color="neutral"
                            variant="outline"
                            size="sm"
                            data-prueba="agregar-linea"
                            @click="agregarLinea"
                        />
                    </div>
                    <UCard
                        v-for="(linea, i) in estado.lineas"
                        :key="i"
                        :ui="{ body: 'p-3 sm:p-4' }"
                        :data-linea="i"
                    >
                        <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                            <UFormField
                                label="Descripción"
                                :name="`lineas.${i}.descripcion`"
                                required
                                class="sm:col-span-2"
                            >
                                <UInput
                                    v-model="linea.descripcion"
                                    class="w-full"
                                    data-prueba="linea-descripcion"
                                />
                            </UFormField>
                            <UFormField
                                label="Tipo"
                                :name="`lineas.${i}.tipo`"
                            >
                                <USelect
                                    v-model="linea.tipo"
                                    :items="itemsTipoLinea"
                                    class="w-full"
                                    data-prueba="linea-tipo"
                                />
                            </UFormField>
                            <UFormField
                                label="Total con IVA"
                                :name="`lineas.${i}.total`"
                                required
                            >
                                <UInput
                                    v-model="linea.total"
                                    inputmode="decimal"
                                    placeholder="0.00"
                                    class="w-full"
                                    data-prueba="linea-total"
                                />
                            </UFormField>
                            <UFormField
                                v-if="linea.tipo !== 'activo_fijo' && cuentas.length"
                                label="Cuenta"
                                :name="`lineas.${i}.cuenta`"
                                class="sm:col-span-2"
                            >
                                <USelectMenu
                                    v-model="linea.cuenta"
                                    :items="itemsCuenta"
                                    value-key="value"
                                    class="w-full"
                                />
                            </UFormField>
                            <template v-if="linea.tipo === 'activo_fijo'">
                                <UFormField
                                    label="Clase del activo"
                                    :name="`lineas.${i}.clase_activo`"
                                    required
                                >
                                    <USelect
                                        v-model="linea.clase_activo"
                                        :items="itemsClase"
                                        placeholder="Elige la clase"
                                        class="w-full"
                                    />
                                </UFormField>
                                <UFormField
                                    label="Tasa anual"
                                    :name="`lineas.${i}.activo_tasa_anual`"
                                    help="Vacía: el máximo legal de la clase."
                                >
                                    <UInput
                                        v-model="linea.activo_tasa_anual"
                                        inputmode="decimal"
                                        class="w-full"
                                    >
                                        <template #trailing>
                                            <span class="text-xs text-muted">%</span>
                                        </template>
                                    </UInput>
                                </UFormField>
                            </template>
                            <div class="flex flex-wrap items-center gap-x-4 gap-y-2 sm:col-span-2 lg:col-span-4">
                                <UCheckbox
                                    v-model="linea.exento"
                                    label="Exenta de IVA"
                                />
                                <UCheckbox
                                    v-if="linea.tipo !== 'activo_fijo'"
                                    v-model="linea.diferir"
                                    label="Gasto anticipado: diferir"
                                />
                                <UFormField
                                    v-if="linea.diferir && linea.tipo !== 'activo_fijo'"
                                    :name="`lineas.${i}.diferir_meses`"
                                    class="w-36"
                                >
                                    <UInputNumber
                                        v-model="linea.diferir_meses"
                                        :min="2"
                                        :max="120"
                                        placeholder="Meses"
                                        aria-label="Meses a diferir"
                                    />
                                </UFormField>
                                <UButton
                                    v-if="estado.lineas.length > 1"
                                    label="Quitar"
                                    icon="i-lucide-trash-2"
                                    color="error"
                                    variant="ghost"
                                    size="xs"
                                    class="ml-auto"
                                    @click="quitarLinea(i)"
                                />
                            </div>
                        </div>
                    </UCard>
                    <dl
                        class="grid grid-cols-3 gap-3 rounded-lg bg-elevated px-3 py-2 text-sm"
                        data-prueba="totales-compra"
                    >
                        <DatoFicha etiqueta="Base (referencia)">
                            <span class="tabular-nums">{{ formatearQuetzales(totales.base) }}</span>
                        </DatoFicha>
                        <DatoFicha etiqueta="IVA 12 % (referencia)">
                            <span class="tabular-nums">{{ formatearQuetzales(totales.iva) }}</span>
                        </DatoFicha>
                        <DatoFicha etiqueta="Total">
                            <span class="font-semibold tabular-nums">{{ formatearQuetzales(totales.total) }}</span>
                        </DatoFicha>
                    </dl>
                    <UAlert
                        v-if="!cuadraConEgreso"
                        color="warning"
                        variant="subtle"
                        icon="i-lucide-triangle-alert"
                        :description="`Sin retenciones, el total (${formatearQuetzales(totales.total)}) debe ser el monto del egreso (${formatearQuetzales(egreso?.monto ?? '0')}).`"
                    />
                </section>

                <section
                    v-if="estado.tipo_documento !== 'NCRE'"
                    class="flex flex-col gap-3"
                >
                    <h2 class="text-sm font-semibold text-highlighted">
                        Retenciones
                    </h2>
                    <URadioGroup
                        v-model="estado.retenciones_modo"
                        :items="itemsRetencionesModo"
                        orientation="horizontal"
                        class="flex-wrap"
                    />
                    <p
                        v-if="estado.retenciones_modo === 'sugeridas' && proveedor?.regimen_isr === 'opcional_simplificado'"
                        class="text-xs text-muted"
                    >
                        {{ proveedor.nombre }} está en el régimen opcional simplificado: se le retiene ISR (5 % de la base).
                    </p>
                    <template v-if="estado.retenciones_modo === 'manual'">
                        <div
                            v-for="(r, i) in estado.retenciones"
                            :key="i"
                            class="grid gap-3 sm:grid-cols-[1fr_10rem_auto]"
                        >
                            <UFormField
                                :name="`retenciones.${i}.codigo`"
                                label="Retención"
                            >
                                <USelect
                                    v-model="r.codigo"
                                    :items="itemsRetencion"
                                    class="w-full"
                                />
                            </UFormField>
                            <UFormField
                                :name="`retenciones.${i}.monto`"
                                label="Monto"
                                help="Vacío: con la tasa."
                            >
                                <UInput
                                    v-model="r.monto"
                                    inputmode="decimal"
                                    class="w-full"
                                />
                            </UFormField>
                            <UButton
                                icon="i-lucide-trash-2"
                                color="error"
                                variant="ghost"
                                class="self-end"
                                :aria-label="`Quitar la retención ${i + 1}`"
                                @click="estado.retenciones.splice(i, 1)"
                            />
                        </div>
                        <UButton
                            label="Agregar retención"
                            icon="i-lucide-plus"
                            color="neutral"
                            variant="outline"
                            size="sm"
                            class="self-start"
                            @click="agregarRetencion"
                        />
                    </template>
                </section>

                <section
                    v-if="!egresoId"
                    class="flex flex-col gap-3"
                >
                    <h2 class="text-sm font-semibold text-highlighted">
                        Pago
                    </h2>
                    <div class="grid gap-4 sm:grid-cols-2">
                        <UFormField
                            label="Condición"
                            name="condicion"
                            required
                        >
                            <USelect
                                v-model="estado.condicion"
                                :items="itemsCondicion"
                                :disabled="estado.tipo_documento === 'NCRE'"
                                class="w-full"
                                data-prueba="compra-condicion"
                            />
                        </UFormField>
                        <UFormField
                            v-if="estado.condicion === 'credito'"
                            label="Vence"
                            name="vence_en"
                            :help="proveedor ? `Vacío: ${proveedor.dias_credito} días de crédito del proveedor.` : 'Vacío: los días de crédito del proveedor.'"
                        >
                            <UInput
                                v-model="estado.vence_en"
                                type="date"
                                class="w-full"
                            />
                        </UFormField>
                    </div>
                    <MedioPagoCampos
                        v-if="estado.condicion === 'contado'"
                        v-model:metodo="estado.metodo"
                        v-model:caja-id="estado.caja_id"
                        v-model:banco-id="estado.banco_id"
                        v-model:cuenta-bancaria-id="estado.cuenta_bancaria_id"
                    />
                    <p
                        v-if="estado.condicion === 'contado'"
                        class="text-xs text-muted"
                    >
                        Al contado se crea el egreso que la paga, con el asiento de la compra.
                    </p>
                </section>

                <ProblemaAlerta
                    v-if="problema"
                    :problema="problema"
                    con-errores
                    data-prueba="compra-problema"
                />

                <div class="flex flex-wrap justify-end gap-2">
                    <UButton
                        :to="egresoId ? '/egresos' : '/compras'"
                        label="Cancelar"
                        color="neutral"
                        variant="ghost"
                    />
                    <UButton
                        type="submit"
                        label="Registrar compra"
                        icon="i-lucide-check"
                        :loading="enviando"
                        data-prueba="guardar-compra"
                    />
                </div>
            </UForm>
        </div>
    </PanelPagina>
</template>
