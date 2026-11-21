<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { FormSubmitEvent, RadioGroupItem, SelectItem } from '@nuxt/ui'
import * as z from 'zod'

/**
 * Configuración → FEL (A3, fase 3; contrato §8, §11.1 y §17), por empresa: proveedor, ambiente y
 * modo (con `version`), credenciales de solo escritura por ambiente con su prueba, contingencia
 * con motivo y el momento de certificar de cada plantilla. Todo lo que se muestra sale de
 * `GET /fel/configuracion`; los secretos nunca vuelven de la API.
 */
definePageMeta({ permiso: 'fel.ver' })

useHead({ title: 'Factura electrónica (FEL) · ArgosIsp' })

const { puede } = usePermisos()
const toast = useToast()
const { empresaId, empresa, conSelector } = useEmpresaActiva()

const configuracion = shallowRef<ConfiguracionFel | null>(null)
const cargando = ref(false)
const problema = ref<Problem | null>(null)

async function cargar() {
    if (empresaId.value === null) {
        return
    }
    cargando.value = true
    problema.value = null
    const resultado = await useFel().configuracion(empresaId.value)
    cargando.value = false
    configuracion.value = resultado.ok ? resultado.data : null
    problema.value = resultado.ok ? null : resultado.problema
    if (resultado.ok) {
        reiniciarFormulario(resultado.data)
    }
}

/* Catálogo de certificadores (`GET /fel/proveedores`): campos, ambientes y `solo_pruebas`. */
const catalogo = shallowRef<ProveedorFelCatalogo[]>([])
const problemaCatalogo = ref<Problem | null>(null)

async function cargarCatalogo() {
    problemaCatalogo.value = null
    const resultado = await useFel().proveedores()
    catalogo.value = resultado.ok ? resultado.data : []
    problemaCatalogo.value = resultado.ok ? null : resultado.problema
}

function delCatalogo(codigo: string | null | undefined): ProveedorFelCatalogo | null {
    return catalogo.value.find(p => p.codigo === codigo) ?? null
}

/* Proveedor, ambiente y modo. */
const PROVEEDORES = ['infile', 'falso'] as const satisfies readonly ProveedorFel[]
const AMBIENTES = Object.keys(AMBIENTES_FEL) as AmbienteFel[]
const MODOS = Object.keys(MODOS_FEL) as ModoFel[]

/** Espejo de `configurarFelValidator` (A3): proveedor obligatorio salvo desactivada; falso solo en pruebas. */
const esquema = z.object({
    proveedor: z.enum(PROVEEDORES).nullable(),
    ambiente: z.enum(AMBIENTES),
    modo: z.enum(MODOS),
}).superRefine((datos, ctx) => {
    if (datos.modo !== 'desactivada' && !datos.proveedor) {
        ctx.addIssue({ code: 'custom', path: ['proveedor'], message: 'Elige el certificador' })
    }
    const elegido = delCatalogo(datos.proveedor)
    if (elegido && !elegido.ambientes.includes(datos.ambiente)) {
        ctx.addIssue({ code: 'custom', path: ['proveedor'], message: `${elegido.nombre} no admite ${AMBIENTES_FEL[datos.ambiente].toLowerCase()}` })
    }
})
type Datos = z.output<typeof esquema>

const formulario = useTemplateRef('formulario')
const idFormulario = useId()
const estado = reactive<Datos>({ proveedor: null, ambiente: 'pruebas', modo: 'desactivada' })
const guardando = ref(false)
const problemaGuardar = ref<Problem | null>(null)
let claveGuardar = nuevaClaveIdempotencia()

const avisos = computed(() => (problemaGuardar.value ? avisosPorCertificar(problemaGuardar.value) : null))

function reiniciarFormulario(actual: ConfiguracionFel) {
    estado.proveedor = actual.proveedor
    estado.ambiente = actual.ambiente
    estado.modo = actual.modo
    claveGuardar = nuevaClaveIdempotencia()
}

const itemsProveedor = computed<SelectItem[]>(() => catalogo.value
    .filter(p => esProveedorFel(p.codigo) && p.ambientes.includes(estado.ambiente))
    .map(p => ({ label: p.nombre, value: p.codigo, description: p.solo_pruebas ? 'Solo pruebas' : undefined })))
const itemsAmbiente: SelectItem[] = AMBIENTES.map(valor => ({ label: AMBIENTES_FEL[valor], value: valor }))
const itemsModo: RadioGroupItem[] = MODOS.map(valor => ({ label: MODOS_FEL[valor].etiqueta, value: valor, description: MODOS_FEL[valor].descripcion }))

const cambios = computed(() => configuracion.value !== null && (estado.proveedor !== configuracion.value.proveedor
    || estado.ambiente !== configuracion.value.ambiente || estado.modo !== configuracion.value.modo))

watch(() => [estado.proveedor, estado.ambiente, estado.modo], () => {
    // Otros datos son otra operación: otra clave.
    claveGuardar = nuevaClaveIdempotencia()
    problemaGuardar.value = null
})

async function guardar(evento: FormSubmitEvent<Datos>) {
    if (!configuracion.value || empresaId.value === null) {
        return
    }
    guardando.value = true
    problemaGuardar.value = null
    const resultado = await useFel().configurar({ empresa_id: empresaId.value, ...evento.data, version: configuracion.value.version }, claveGuardar)
    guardando.value = false
    if (!resultado.ok) {
        const errores = erroresDeFormulario(resultado.problema).filter(e => e.name === 'proveedor' || e.name === 'ambiente')
        if (errores.length) {
            formulario.value?.setErrors(errores)
            return
        }
        problemaGuardar.value = problemaFelLegible(resultado.problema)
        return
    }
    configuracion.value = resultado.data
    reiniciarFormulario(resultado.data)
    toast.add({ title: 'FEL guardada', description: `${MODOS_FEL[resultado.data.modo].etiqueta} · ${etiquetaProveedor(resultado.data.proveedor, catalogo.value)} · ${AMBIENTES_FEL[resultado.data.ambiente]}`, icon: 'i-lucide-shield-check', color: 'success' })
}

/* Credenciales por ambiente. */
const credencialesAbiertas = ref(false)
const ambienteCredenciales = ref<AmbienteFel>('pruebas')
const probando = ref<AmbienteFel | null>(null)
const problemaPrueba = ref<{ ambiente: AmbienteFel, problema: Problem } | null>(null)

function credencialesDe(ambiente: AmbienteFel): CredencialesFel | null {
    return configuracion.value?.credenciales.find(c => c.ambiente === ambiente) ?? null
}

/** Certificador con el que se guardan las credenciales: el elegido (aunque no esté guardado aún). */
const proveedorCredenciales = computed(() => delCatalogo(estado.proveedor ?? configuracion.value?.proveedor ?? null))

function abrirCredenciales(ambiente: AmbienteFel) {
    ambienteCredenciales.value = ambiente
    credencialesAbiertas.value = true
}

function alGuardarCredenciales(guardadas: CredencialesFel) {
    if (configuracion.value) {
        configuracion.value = { ...configuracion.value, credenciales: [...configuracion.value.credenciales.filter(c => c.ambiente !== guardadas.ambiente), guardadas] }
    }
    toast.add({ title: `Credenciales de ${AMBIENTES_FEL[guardadas.ambiente].toLowerCase()} guardadas`, description: 'Cifradas; pruébalas antes de certificar.', icon: 'i-lucide-key-round', color: 'success' })
}

async function probar(ambiente: AmbienteFel) {
    if (empresaId.value === null) {
        return
    }
    probando.value = ambiente
    problemaPrueba.value = null
    const resultado = await useFel().probarCredenciales(ambiente, empresaId.value)
    probando.value = null
    if (!resultado.ok) {
        problemaPrueba.value = { ambiente, problema: problemaFelLegible(resultado.problema) }
        return
    }
    if (configuracion.value) {
        configuracion.value = { ...configuracion.value, credenciales: configuracion.value.credenciales.map(c => (c.ambiente === ambiente ? resultado.data : c)) }
    }
    const prueba = resultado.data.resultado_prueba
    toast.add({
        title: prueba?.ok ? 'Credenciales válidas' : 'El certificador rechazó las credenciales',
        description: prueba?.detalle,
        icon: prueba?.ok ? 'i-lucide-circle-check' : 'i-lucide-circle-x',
        color: prueba?.ok ? 'success' : 'error',
    })
}

/* Contingencia. */
const contingenciaAbierta = ref(false)

function cambiarContingencia(motivo: string, clave: string) {
    const activar = !(configuracion.value?.contingencia_activa ?? false)
    return useFel().cambiarContingencia(activar, motivo, clave, empresaId.value ?? undefined)
        .then(r => (r.ok ? r : { ...r, problema: problemaFelLegible(r.problema) }))
}

function alCambiarContingencia(actual: ConfiguracionFel) {
    configuracion.value = actual
    reiniciarFormulario(actual)
    toast.add({
        title: actual.contingencia_activa ? 'Contingencia activada' : 'Contingencia levantada',
        description: actual.contingencia_activa ? 'Las facturas se emiten y sus DTE esperan en cola.' : 'La cola transmite los DTE en contingencia.',
        icon: actual.contingencia_activa ? 'i-lucide-cloud-off' : 'i-lucide-cloud',
        color: actual.contingencia_activa ? 'warning' : 'success',
    })
}

onMounted(() => {
    void cargarCatalogo()
    void cargar()
})
</script>

<template>
    <ConfiguracionMarco
        id="configuracion-fel"
        titulo="Empresa y fiscal"
        descripcion="Los datos legales con los que se factura y se declara"
        empresas
    >
        <UAlert
            v-if="empresaId === null"
            color="info"
            variant="subtle"
            icon="i-lucide-building-2"
            title="Elige una empresa"
            :description="conSelector ? 'La FEL es de cada empresa (NIT): elige una en las pastillas de arriba.' : 'No hay una empresa activa en tu sesión.'"
            data-prueba="elegir-empresa"
        />

        <template v-else>
            <USkeleton
                v-if="cargando && !configuracion"
                class="h-40 w-full"
            />
            <ProblemaAlerta
                v-else-if="problema"
                :problema="problema"
                :reintentar="cargar"
                :reintentando="cargando"
                data-prueba="fel-error"
            />

            <template v-else-if="configuracion">
                <UAlert
                    v-if="configuracion.modo === 'desactivada'"
                    color="error"
                    variant="subtle"
                    icon="i-lucide-shield-off"
                    title="FEL desactivada"
                    :description="AVISO_FEL_DESACTIVADA"
                    data-prueba="fel-desactivada"
                />
                <ProblemaAlerta
                    v-if="problemaCatalogo"
                    :problema="problemaCatalogo"
                    :reintentar="cargarCatalogo"
                    data-prueba="fel-catalogo-error"
                />

                <div class="grid gap-4 xl:grid-cols-2">
                    <div class="flex min-w-0 flex-col gap-4">
                        <ConfiguracionBloque
                            titulo="Certificador"
                            icono="i-lucide-shield-check"
                        >
                            <ConfiguracionFila etiqueta="Estado">
                                <UBadge
                                    :label="MODOS_FEL[configuracion.modo].etiqueta"
                                    :icon="MODOS_FEL[configuracion.modo].icono"
                                    :color="MODOS_FEL[configuracion.modo].color"
                                    variant="subtle"
                                    data-prueba="fel-modo"
                                />
                            </ConfiguracionFila>
                            <ConfiguracionFila
                                etiqueta="Proveedor"
                                :valor="etiquetaProveedor(configuracion.proveedor, catalogo)"
                            />
                            <ConfiguracionFila
                                etiqueta="Ambiente"
                                :valor="AMBIENTES_FEL[configuracion.ambiente]"
                            />
                            <ConfiguracionFila
                                etiqueta="Versión"
                                :valor="configuracion.version === 0 ? 'Nunca configurada' : `${configuracion.version}${configuracion.updated_at ? ` · ${formatearFechaHora(configuracion.updated_at)}` : ''}`"
                            />
                        </ConfiguracionBloque>

                        <ConfiguracionBloque
                            v-if="puede('fel.configurar')"
                            titulo="Cambiar certificador y modo"
                            icono="i-lucide-sliders-horizontal"
                        >
                            <UForm
                                :id="idFormulario"
                                ref="formulario"
                                :schema="esquema"
                                :state="estado"
                                class="flex flex-col gap-4 py-2"
                                @submit="guardar"
                            >
                                <div class="grid gap-4 sm:grid-cols-2">
                                    <UFormField
                                        label="Ambiente"
                                        name="ambiente"
                                        required
                                    >
                                        <USelect
                                            v-model="estado.ambiente"
                                            :items="itemsAmbiente"
                                            class="w-full"
                                            data-prueba="fel-ambiente"
                                        />
                                    </UFormField>
                                    <UFormField
                                        label="Certificador"
                                        name="proveedor"
                                        :required="estado.modo !== 'desactivada'"
                                    >
                                        <USelect
                                            v-model="estado.proveedor"
                                            :items="itemsProveedor"
                                            placeholder="Elige el certificador"
                                            class="w-full"
                                            data-prueba="fel-proveedor"
                                        />
                                    </UFormField>
                                </div>
                                <UFormField
                                    label="Modo de emisión"
                                    name="modo"
                                    required
                                >
                                    <URadioGroup
                                        v-model="estado.modo"
                                        :items="itemsModo"
                                        variant="card"
                                        indicator="start"
                                        :ui="{ fieldset: 'grid gap-2' }"
                                        data-prueba="fel-modos"
                                    />
                                </UFormField>
                                <UAlert
                                    v-if="avisos !== null"
                                    color="error"
                                    variant="subtle"
                                    icon="i-lucide-receipt-text"
                                    :title="`${avisos} avisos de cobro sin certificar`"
                                    :description="problemaGuardar?.detail"
                                    data-prueba="fel-avisos-por-certificar"
                                />
                                <ProblemaAlerta
                                    v-else-if="problemaGuardar"
                                    :problema="problemaGuardar"
                                    data-prueba="fel-guardar-error"
                                />
                            </UForm>
                        </ConfiguracionBloque>

                        <ConfiguracionBloque
                            v-if="puede('plantillas.ver')"
                            titulo="Qué se certifica"
                            icono="i-lucide-file-check"
                        >
                            <FelCertificarAl :modo="configuracion.modo" />
                        </ConfiguracionBloque>
                    </div>

                    <div class="flex min-w-0 flex-col gap-4">
                        <ConfiguracionBloque
                            titulo="Contingencia"
                            icono="i-lucide-triangle-alert"
                        >
                            <div class="flex flex-col gap-3 py-2">
                                <UAlert
                                    :color="configuracion.contingencia_activa ? 'warning' : 'success'"
                                    variant="subtle"
                                    :icon="configuracion.contingencia_activa ? 'i-lucide-cloud-off' : 'i-lucide-circle-check'"
                                    :title="configuracion.contingencia_activa ? `En contingencia desde ${configuracion.contingencia_desde ? formatearFechaHora(configuracion.contingencia_desde) : '—'}` : 'Sin contingencia: los documentos se certifican al emitirse.'"
                                    :description="configuracion.contingencia_motivo ? `${configuracion.contingencia_activa ? 'Motivo' : 'Último motivo'}: ${configuracion.contingencia_motivo}` : undefined"
                                />
                                <UBadge
                                    :label="configuracion.contingencia_activa ? 'Activa' : 'Inactiva'"
                                    :icon="configuracion.contingencia_activa ? 'i-lucide-cloud-off' : 'i-lucide-cloud'"
                                    :color="configuracion.contingencia_activa ? 'warning' : 'success'"
                                    variant="subtle"
                                    class="sr-only"
                                    data-prueba="contingencia-estado"
                                />
                                <p class="text-xs text-muted">
                                    Cuando el certificador no responde, las facturas se emiten igual y sus DTE esperan en cola hasta levantarla.
                                </p>
                                <UButton
                                    v-if="puede('fel.contingencia')"
                                    :label="configuracion.contingencia_activa ? 'Levantar contingencia' : 'Activar contingencia'"
                                    :icon="configuracion.contingencia_activa ? 'i-lucide-cloud' : 'i-lucide-cloud-off'"
                                    :color="configuracion.contingencia_activa ? 'primary' : 'warning'"
                                    variant="outline"
                                    class="self-start"
                                    :disabled="configuracion.modo === 'desactivada'"
                                    data-prueba="contingencia-abrir"
                                    @click="contingenciaAbierta = true"
                                />
                            </div>
                        </ConfiguracionBloque>

                        <ConfiguracionBloque
                            titulo="Credenciales"
                            icono="i-lucide-key-round"
                            descripcion="Cifradas y de solo escritura: la API nunca las devuelve. Aquí se ve si están guardadas y su última prueba."
                        >
                            <div
                                v-for="ambiente in AMBIENTES"
                                :key="ambiente"
                                class="flex flex-col gap-2 py-3"
                                :data-credenciales="ambiente"
                            >
                                <div class="flex flex-wrap items-center justify-between gap-2">
                                    <span class="text-sm font-semibold text-highlighted">{{ AMBIENTES_FEL[ambiente] }}</span>
                                    <UBadge
                                        :label="credencialesDe(ambiente) ? 'Configuradas' : 'Sin configurar'"
                                        :icon="credencialesDe(ambiente) ? 'i-lucide-lock' : 'i-lucide-lock-open'"
                                        :color="credencialesDe(ambiente) ? 'success' : 'neutral'"
                                        variant="subtle"
                                        size="sm"
                                        data-prueba="credenciales-estado"
                                    />
                                </div>
                                <dl
                                    v-if="credencialesDe(ambiente)"
                                    class="grid gap-x-4 gap-y-2 sm:grid-cols-2"
                                >
                                    <DatoFicha
                                        etiqueta="Certificador"
                                        :valor="etiquetaProveedor(credencialesDe(ambiente)?.proveedor, catalogo)"
                                    />
                                    <DatoFicha
                                        v-for="(valor, campo) in credencialesDe(ambiente)?.campos_visibles"
                                        :key="campo"
                                        :etiqueta="String(campo).replace(/_/g, ' ')"
                                        :valor="valor"
                                        mono
                                    />
                                    <DatoFicha
                                        etiqueta="Última prueba"
                                        class="sm:col-span-2"
                                    >
                                        <span
                                            v-if="credencialesDe(ambiente)?.resultado_prueba"
                                            :class="credencialesDe(ambiente)?.resultado_prueba?.ok ? 'text-success' : 'text-error'"
                                            data-prueba="credenciales-prueba"
                                        >
                                            {{ credencialesDe(ambiente)?.resultado_prueba?.ok ? 'Válidas' : 'Rechazadas' }} · {{ credencialesDe(ambiente)?.resultado_prueba?.detalle }} · {{ formatearFechaHora(credencialesDe(ambiente)?.probada_en ?? null) }}
                                        </span>
                                        <span v-else>Sin probar</span>
                                    </DatoFicha>
                                </dl>
                                <ProblemaAlerta
                                    v-if="problemaPrueba?.ambiente === ambiente"
                                    :problema="problemaPrueba.problema"
                                />
                                <div
                                    v-if="puede('fel.configurar')"
                                    class="flex flex-wrap gap-2"
                                >
                                    <UButton
                                        :label="credencialesDe(ambiente) ? 'Cambiar' : 'Guardar credenciales'"
                                        icon="i-lucide-key-round"
                                        color="neutral"
                                        variant="outline"
                                        size="sm"
                                        :disabled="!proveedorCredenciales || !proveedorCredenciales.ambientes.includes(ambiente)"
                                        :data-prueba="`credenciales-abrir-${ambiente}`"
                                        @click="abrirCredenciales(ambiente)"
                                    />
                                    <UButton
                                        v-if="credencialesDe(ambiente)"
                                        label="Probar"
                                        icon="i-lucide-plug-zap"
                                        color="neutral"
                                        variant="outline"
                                        size="sm"
                                        :loading="probando === ambiente"
                                        :data-prueba="`credenciales-probar-${ambiente}`"
                                        @click="probar(ambiente)"
                                    />
                                </div>
                            </div>
                        </ConfiguracionBloque>
                    </div>
                </div>

                <FelCredencialesModal
                    v-if="puede('fel.configurar') && proveedorCredenciales"
                    v-model:open="credencialesAbiertas"
                    :empresa-id="empresaId"
                    :ambiente="ambienteCredenciales"
                    :proveedor="proveedorCredenciales"
                    @hecho="alGuardarCredenciales"
                />

                <AccionMotivoModal
                    v-if="puede('fel.contingencia')"
                    v-model:open="contingenciaAbierta"
                    :titulo="configuracion.contingencia_activa ? 'Levantar contingencia' : 'Activar contingencia'"
                    :descripcion="empresa?.nombre_comercial"
                    :efecto="configuracion.contingencia_activa
                        ? 'La cola transmite al certificador los DTE que quedaron en contingencia.'
                        : 'Las facturas nuevas se emiten (asiento y evento) y su DTE queda en contingencia, en cola hasta levantarla.'"
                    :confirmar="configuracion.contingencia_activa ? 'Levantar' : 'Activar'"
                    :icono="configuracion.contingencia_activa ? 'i-lucide-cloud' : 'i-lucide-cloud-off'"
                    :color="configuracion.contingencia_activa ? 'primary' : 'warning'"
                    placeholder="Ej.: el certificador no responde desde las 8:00"
                    :ejecutar="cambiarContingencia"
                    @hecho="alCambiarContingencia"
                />
            </template>
        </template>

        <template
            v-if="configuracion && puede('fel.configurar')"
            #pie
        >
            <span class="me-auto text-sm text-muted">Cada empresa tiene su NIT, sus cuentas y su libro. Nada se mezcla entre empresas.</span>
            <UButton
                label="Descartar"
                color="neutral"
                variant="ghost"
                :disabled="!cambios || guardando"
                @click="reiniciarFormulario(configuracion)"
            />
            <UButton
                type="submit"
                :form="idFormulario"
                label="Guardar"
                icon="i-lucide-check"
                :loading="guardando"
                :disabled="!cambios"
                class="glow-brand"
                data-prueba="fel-guardar"
            />
        </template>
    </ConfiguracionMarco>
</template>
