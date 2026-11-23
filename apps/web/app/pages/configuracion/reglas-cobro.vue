<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { FormSubmitEvent } from '@nuxt/ui'

/**
 * Configuración › Facturación y cobro › Reglas de cobro y libro (tablero OperConfigCobro, pestaña
 * «Reglas de cobro y libro»): de la empresa activa (`GET`/`PUT /ajustes-cobro`, A3). Asientos
 * manuales que aprueba otro usuario (decisión 10) y tope de días de la pausa sin cobro (decisión
 * 16). Los días de gracia de las facturas de meses pasados no son ajuste (decisión 21): se escriben
 * al emitir. Debajo, el formato de impresión de cada caja (decisión 20, `PUT /cajas/:id/impresion`).
 */
definePageMeta({ permiso: 'ajustes_cobro.ver' })

useHead({ title: 'Reglas de cobro y libro · ArgosIsp' })

const { puede } = usePermisos()
const toast = useToast()
const { eleccion, empresaId, empresa } = useEmpresaActiva()
const enTodas = computed(() => eleccion.value === 'todas' || empresaId.value === null)

const ajustes = shallowRef<AjustesCobro | null>(null)
const cargando = ref(false)
const problema = ref<Problem | null>(null)
const pideEmpresa = computed(() => problema.value !== null && codigoProblema(problema.value) === 'empresa_requerida')

const editable = computed(() => puede('ajustes_cobro.editar'))
const formulario = useTemplateRef('formulario')
const idFormulario = useId()
const estado = reactive<EntradaAjustesCobro>({ asientos_requieren_aprobacion: false, pausa_tope_dias: 90 })
const enviando = ref(false)
const problemaGuardar = ref<Problem | null>(null)

const sinCambios = computed(() => ajustes.value === null
    || (ajustes.value.asientos_requieren_aprobacion === estado.asientos_requieren_aprobacion && ajustes.value.pausa_tope_dias === estado.pausa_tope_dias))

function rellenar(datos: AjustesCobro) {
    ajustes.value = datos
    estado.asientos_requieren_aprobacion = datos.asientos_requieren_aprobacion
    estado.pausa_tope_dias = datos.pausa_tope_dias
    formulario.value?.clear()
}

async function cargar() {
    cargando.value = true
    problemaGuardar.value = null
    const r = await useAjustesCobro().ver()
    cargando.value = false
    problema.value = r.ok ? null : r.problema
    if (r.ok) {
        rellenar(r.data)
    }
    else {
        ajustes.value = null
    }
}

async function guardar(evento: FormSubmitEvent<SalidaAjustesCobro>) {
    if (!ajustes.value) {
        return
    }
    enviando.value = true
    problemaGuardar.value = null
    const r = await useAjustesCobro().editar(ajustes.value.version, evento.data)
    enviando.value = false
    if (!r.ok) {
        problemaGuardar.value = r.problema
        if (r.problema.status === 422) {
            formulario.value?.setErrors(erroresDeFormulario(r.problema))
        }
        return
    }
    rellenar(r.data)
    toast.add({ title: 'Reglas de cobro guardadas', description: `Para ${empresa.value?.nombre_comercial ?? 'la empresa activa'}.`, icon: 'i-lucide-circle-check', color: 'success' })
}

/* Impresión por caja (decisión 20): cada caja recuerda su formato, en la API. */
const verCajas = computed(() => puede('cajas.ver'))
const editaImpresion = computed(() => puede('cajas.configurar_impresion'))
const cajas = shallowRef<Caja[]>([])
const problemaCajas = ref<Problem | null>(null)
const cajasLeidas = ref(false)
const guardandoCaja = ref<number | null>(null)

async function cargarCajas() {
    if (!verCajas.value) {
        return
    }
    const r = await useCajas().listar()
    cajasLeidas.value = true
    cajas.value = r.ok ? r.data.filter(c => c.activa) : []
    problemaCajas.value = r.ok ? null : r.problema
}

async function cambiarImpresion(caja: Caja, cambios: CambiosImpresionCaja) {
    guardandoCaja.value = caja.id
    const r = await useImpresionCajas().configurar(caja, cambios)
    guardandoCaja.value = null
    if (!r.ok) {
        toast.add({ title: r.problema.title, description: r.problema.detail, icon: 'i-lucide-circle-alert', color: 'error' })
        if (r.problema.status === 409) {
            void cargarCajas()
        }
        return
    }
    cajas.value = cajas.value.map(c => (c.id === r.data.id ? r.data : c))
    toast.add({ title: `Impresión de ${caja.nombre} guardada`, icon: 'i-lucide-circle-check', color: 'success' })
}

function recargar() {
    ajustes.value = null
    problema.value = null
    if (!enTodas.value) {
        void cargar()
    }
    void cargarCajas()
}

watch(empresaId, recargar)
onMounted(recargar)
</script>

<template>
    <ConfiguracionMarco
        id="configuracion-reglas-cobro"
        titulo="Facturación y cobro"
        descripcion="Cuentas donde pagan los clientes, bancos de origen, plantillas y conceptos"
        empresas
    >
        <UAlert
            v-if="enTodas || pideEmpresa"
            color="info"
            variant="subtle"
            icon="i-lucide-building"
            title="Elige una empresa"
            description="Cada empresa tiene sus reglas de cobro: elige una arriba."
            data-prueba="reglas-cobro-elige-empresa"
        />
        <ProblemaAlerta
            v-else-if="problema"
            :problema="problema"
            :reintentar="cargar"
            :reintentando="cargando"
        />
        <div
            v-else-if="!ajustes"
            class="grid gap-4 xl:grid-cols-2"
        >
            <USkeleton class="h-40" />
            <USkeleton class="h-40" />
        </div>
        <div
            v-else
            class="grid items-start gap-4 xl:grid-cols-2"
        >
            <UForm
                :id="idFormulario"
                ref="formulario"
                :schema="esquemaAjustesCobro"
                :state="estado"
                :disabled="!editable || enviando"
                class="flex min-w-0 flex-col gap-4"
                @submit="guardar"
            >
                <ConfiguracionBloque
                    titulo="Asientos manuales"
                    icono="i-lucide-book-open"
                >
                    <ConfiguracionFila
                        etiqueta="Pedir aprobación de otro usuario"
                        ayuda="El asiento de ajuste queda como borrador en Libro › Por aprobar hasta que otra persona lo aprueba. Quien lo crea no puede aprobarlo."
                        fuerte
                    >
                        <USwitch
                            v-model="estado.asientos_requieren_aprobacion"
                            size="lg"
                            aria-label="Pedir aprobación de otro usuario"
                            data-prueba="aprobacion-asientos"
                        />
                    </ConfiguracionFila>
                    <template #pie>
                        De fábrica: apagado (el asiento entra directo al libro).
                    </template>
                </ConfiguracionBloque>
                <ConfiguracionBloque
                    titulo="Pausa sin cobro"
                    icono="i-lucide-circle-pause"
                >
                    <div class="flex min-w-0 flex-col gap-2 py-2.5 sm:flex-row sm:items-center sm:justify-between">
                        <div class="flex min-w-0 flex-col">
                            <span class="text-sm font-semibold text-highlighted">Tope de días</span>
                            <span class="text-xs text-muted">Lo más que puede durar una pausa sin cobro (1 a 365)</span>
                        </div>
                        <UFormField name="pausa_tope_dias">
                            <div class="flex items-center gap-2">
                                <UInputNumber
                                    v-model="estado.pausa_tope_dias"
                                    :min="1"
                                    :max="365"
                                    :step="1"
                                    :increment="false"
                                    :decrement="false"
                                    :format-options="{ useGrouping: false }"
                                    aria-label="Tope de días de la pausa sin cobro"
                                    class="w-24"
                                    data-prueba="pausa-tope"
                                />
                                <span class="text-xs text-muted">días</span>
                            </div>
                        </UFormField>
                    </div>
                    <template #pie>
                        La suspensión normal sigue facturando; la pausa sin cobro pide su propio permiso y motivo.
                    </template>
                </ConfiguracionBloque>
                <ProblemaAlerta
                    v-if="problemaGuardar && problemaGuardar.status === 409"
                    :problema="problemaGuardar"
                    etiqueta-reintentar="Recargar"
                    :reintentar="cargar"
                    :reintentando="cargando"
                />
                <ProblemaAlerta
                    v-else-if="problemaGuardar"
                    :problema="problemaGuardar"
                />
            </UForm>

            <div class="flex min-w-0 flex-col gap-4">
                <ConfiguracionBloque
                    titulo="Facturas de meses pasados"
                    icono="i-lucide-calendar"
                >
                    <UAlert
                        color="primary"
                        variant="subtle"
                        icon="i-lucide-info"
                        class="my-1"
                    >
                        <template #description>
                            Los <b>días de gracia antes del corte</b> no son un ajuste: los escribe quien emite, en «Emitir facturas por periodo», para cada emisión.
                        </template>
                    </UAlert>
                </ConfiguracionBloque>

                <ConfiguracionBloque
                    v-if="verCajas"
                    titulo="Impresión por caja"
                    icono="i-lucide-printer"
                    data-prueba="impresion-cajas"
                >
                    <ProblemaAlerta
                        v-if="problemaCajas"
                        :problema="problemaCajas"
                        :reintentar="cargarCajas"
                    />
                    <USkeleton
                        v-else-if="!cajasLeidas"
                        class="h-12 w-full"
                    />
                    <p
                        v-else-if="!cajas.length"
                        class="py-2 text-sm text-muted"
                    >
                        Esta empresa no tiene cajas activas.
                    </p>
                    <div
                        v-for="caja in cajas"
                        :key="caja.id"
                        class="flex min-w-0 flex-col gap-2 border-(--ax-borde) py-2.5 sm:flex-row sm:items-center sm:justify-between [&:not(:first-child)]:border-t"
                        :data-caja="caja.id"
                    >
                        <span class="truncate text-sm font-semibold text-highlighted">{{ caja.nombre }}</span>
                        <div class="flex flex-wrap items-center gap-2">
                            <USelect
                                :model-value="caja.formato_recibo ?? 'pos_80'"
                                :items="FORMATOS_IMPRESION_CAJA"
                                :disabled="!editaImpresion || guardandoCaja === caja.id"
                                :aria-label="`Recibo de ${caja.nombre}`"
                                class="w-44"
                                data-prueba="formato-recibo"
                                @update:model-value="v => cambiarImpresion(caja, { formato_recibo: v })"
                            >
                                <template #leading>
                                    <span class="text-xs text-muted">Recibo</span>
                                </template>
                            </USelect>
                            <USelect
                                :model-value="caja.formato_factura ?? 'carta'"
                                :items="FORMATOS_IMPRESION_CAJA"
                                :disabled="!editaImpresion || guardandoCaja === caja.id"
                                :aria-label="`Factura de ${caja.nombre}`"
                                class="w-44"
                                data-prueba="formato-factura"
                                @update:model-value="v => cambiarImpresion(caja, { formato_factura: v })"
                            >
                                <template #leading>
                                    <span class="text-xs text-muted">Factura</span>
                                </template>
                            </USelect>
                        </div>
                    </div>
                    <template #pie>
                        Cada caja recuerda su formato. De fábrica, recibo en ticket de 80 mm y factura en carta.
                    </template>
                </ConfiguracionBloque>
            </div>
        </div>

        <template
            v-if="ajustes && !enTodas"
            #pie
        >
            <span
                class="me-auto text-sm text-muted"
                data-prueba="reglas-cobro-pie"
            >
                De {{ empresa?.nombre_comercial ?? 'la empresa activa' }} · cada empresa tiene sus reglas<template v-if="ajustes.updated_at"> · último cambio: {{ formatearFechaCorta(ajustes.updated_at) }}</template>
            </span>
            <template v-if="editable">
                <UButton
                    label="Descartar"
                    color="neutral"
                    variant="ghost"
                    :disabled="sinCambios || enviando"
                    @click="ajustes && rellenar(ajustes)"
                />
                <UButton
                    type="submit"
                    :form="idFormulario"
                    label="Guardar"
                    icon="i-lucide-check"
                    :loading="enviando"
                    :disabled="sinCambios"
                    class="glow-brand"
                    data-prueba="reglas-cobro-guardar"
                />
            </template>
        </template>
    </ConfiguracionMarco>
</template>
