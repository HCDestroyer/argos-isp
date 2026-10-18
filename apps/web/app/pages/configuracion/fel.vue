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

useHead({ title: 'FEL · ArgosIsp' })

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

/* Proveedor, ambiente y modo. */
const PROVEEDORES = Object.keys(PROVEEDORES_FEL) as ProveedorFel[]
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
    if (datos.proveedor && PROVEEDORES_FEL[datos.proveedor].soloPruebas && datos.ambiente === 'produccion') {
        ctx.addIssue({ code: 'custom', path: ['proveedor'], message: 'El certificador falso es solo para pruebas' })
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

const itemsProveedor = computed<SelectItem[]>(() => PROVEEDORES
    .filter(codigo => !PROVEEDORES_FEL[codigo].soloPruebas || estado.ambiente === 'pruebas')
    .map(codigo => ({ label: PROVEEDORES_FEL[codigo].etiqueta, value: codigo })))
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
    toast.add({ title: 'FEL guardada', description: `${MODOS_FEL[resultado.data.modo].etiqueta} · ${etiquetaProveedor(resultado.data.proveedor)} · ${AMBIENTES_FEL[resultado.data.ambiente]}`, icon: 'i-lucide-shield-check', color: 'success' })
}

/* Credenciales por ambiente. */
const credencialesAbiertas = ref(false)
const ambienteCredenciales = ref<AmbienteFel>('pruebas')
const probando = ref<AmbienteFel | null>(null)
const problemaPrueba = ref<{ ambiente: AmbienteFel, problema: Problem } | null>(null)

function credencialesDe(ambiente: AmbienteFel): CredencialesFel | null {
    return configuracion.value?.credenciales.find(c => c.ambiente === ambiente) ?? null
}

/** Proveedor con el que se guardan las credenciales: el elegido (aunque no esté guardado aún). */
const proveedorCredenciales = computed<ProveedorFel | null>(() => estado.proveedor ?? configuracion.value?.proveedor ?? null)

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

onMounted(cargar)
</script>

<template>
    <PanelPagina
        id="configuracion-fel"
        titulo="FEL"
        icono="i-lucide-badge-check"
    >
        <div class="flex flex-col gap-6">
            <p class="text-sm text-muted">
                Factura electrónica en línea de <span class="font-medium text-highlighted">{{ empresa?.nombre_comercial ?? 'la empresa' }}</span>: certificador, credenciales, modo de emisión y contingencia.
            </p>

            <UAlert
                v-if="empresaId === null"
                color="info"
                variant="subtle"
                icon="i-lucide-building-2"
                title="Elige una empresa"
                :description="conSelector ? 'La FEL es de cada empresa (NIT): elige una en el selector de empresa.' : 'No hay una empresa activa en tu sesión.'"
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
                    <UAlert
                        v-if="configuracion.contingencia_activa"
                        color="warning"
                        variant="subtle"
                        icon="i-lucide-cloud-off"
                        title="Contingencia activa"
                        :description="`Desde ${configuracion.contingencia_desde ? formatearFechaHora(configuracion.contingencia_desde) : '—'} · ${configuracion.contingencia_motivo ?? ''}`"
                    />

                    <UPageCard
                        title="Certificador y modo"
                        icon="i-lucide-shield-check"
                        variant="subtle"
                    >
                        <div class="flex flex-wrap items-center gap-2">
                            <UBadge
                                :label="MODOS_FEL[configuracion.modo].etiqueta"
                                :icon="MODOS_FEL[configuracion.modo].icono"
                                :color="MODOS_FEL[configuracion.modo].color"
                                variant="subtle"
                                data-prueba="fel-modo"
                            />
                            <UBadge
                                :label="etiquetaProveedor(configuracion.proveedor)"
                                color="neutral"
                                variant="outline"
                            />
                            <UBadge
                                :label="AMBIENTES_FEL[configuracion.ambiente]"
                                :color="configuracion.ambiente === 'produccion' ? 'primary' : 'neutral'"
                                variant="outline"
                            />
                            <span class="text-xs text-muted">
                                {{ configuracion.version === 0 ? 'Nunca configurada' : `Versión ${configuracion.version}${configuracion.updated_at ? ` · ${formatearFechaHora(configuracion.updated_at)}` : ''}` }}
                            </span>
                        </div>

                        <UForm
                            v-if="puede('fel.configurar')"
                            :id="idFormulario"
                            ref="formulario"
                            :schema="esquema"
                            :state="estado"
                            class="mt-4 flex flex-col gap-4"
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
                                    :ui="{ fieldset: 'grid gap-2 lg:grid-cols-3' }"
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

                            <div class="flex flex-wrap justify-end gap-2">
                                <UButton
                                    v-if="cambios"
                                    label="Descartar"
                                    color="neutral"
                                    variant="ghost"
                                    :disabled="guardando"
                                    @click="reiniciarFormulario(configuracion)"
                                />
                                <UButton
                                    type="submit"
                                    label="Guardar"
                                    icon="i-lucide-save"
                                    :loading="guardando"
                                    :disabled="!cambios"
                                    class="glow-brand"
                                    data-prueba="fel-guardar"
                                />
                            </div>
                        </UForm>
                    </UPageCard>

                    <UPageCard
                        title="Credenciales"
                        description="De solo escritura: la API nunca las devuelve. Aquí solo se ve si están guardadas, el usuario y la última prueba."
                        icon="i-lucide-key-round"
                        variant="subtle"
                    >
                        <div class="grid gap-3 lg:grid-cols-2">
                            <div
                                v-for="ambiente in AMBIENTES"
                                :key="ambiente"
                                class="flex flex-col gap-3 rounded-lg border border-default p-3"
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
                                        :valor="etiquetaProveedor(credencialesDe(ambiente)?.proveedor)"
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
                                        :label="credencialesDe(ambiente) ? 'Reemplazar' : 'Guardar credenciales'"
                                        icon="i-lucide-key-round"
                                        color="neutral"
                                        variant="outline"
                                        size="sm"
                                        :disabled="!proveedorCredenciales || (PROVEEDORES_FEL[proveedorCredenciales].soloPruebas && ambiente === 'produccion')"
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
                        </div>
                    </UPageCard>

                    <UPageCard
                        title="Contingencia"
                        description="Cuando el certificador no responde: las facturas se emiten igual y sus DTE esperan en cola hasta levantarla. Procedimiento y plazo oficiales: confirmar con contador."
                        icon="i-lucide-cloud-off"
                        variant="subtle"
                    >
                        <div class="flex flex-wrap items-center justify-between gap-3">
                            <div class="flex flex-col gap-1">
                                <UBadge
                                    :label="configuracion.contingencia_activa ? 'Activa' : 'Inactiva'"
                                    :icon="configuracion.contingencia_activa ? 'i-lucide-cloud-off' : 'i-lucide-cloud'"
                                    :color="configuracion.contingencia_activa ? 'warning' : 'success'"
                                    variant="subtle"
                                    class="self-start"
                                    data-prueba="contingencia-estado"
                                />
                                <span
                                    v-if="configuracion.contingencia_motivo"
                                    class="text-xs text-muted"
                                >
                                    {{ configuracion.contingencia_activa ? 'Motivo' : 'Último motivo' }}: {{ configuracion.contingencia_motivo }}
                                </span>
                            </div>
                            <UButton
                                v-if="puede('fel.contingencia')"
                                :label="configuracion.contingencia_activa ? 'Levantar contingencia' : 'Activar contingencia'"
                                :icon="configuracion.contingencia_activa ? 'i-lucide-cloud' : 'i-lucide-cloud-off'"
                                :color="configuracion.contingencia_activa ? 'primary' : 'warning'"
                                variant="outline"
                                :disabled="configuracion.modo === 'desactivada'"
                                data-prueba="contingencia-abrir"
                                @click="contingenciaAbierta = true"
                            />
                        </div>
                    </UPageCard>

                    <UPageCard
                        v-if="puede('plantillas.ver')"
                        title="Momento de certificar"
                        icon="i-lucide-calendar-check"
                        variant="subtle"
                    >
                        <FelCertificarAl :modo="configuracion.modo" />
                    </UPageCard>

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
        </div>
    </PanelPagina>
</template>
