<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { FormSubmitEvent } from '@nuxt/ui'

/**
 * Configuración › Reportes (decisión 4 del PM; `GET`/`PUT /panel-financiero/ajustes`, A3), de la
 * empresa activa: días de suspensión tras los que un servicio cuenta como baja (60 de fábrica).
 * El aviso de pequeño contribuyente (decisión 12) vive en Configuración › Fiscal (FiscalAvisoPc).
 *
 * Los correos externos aprobados viven en Reportes › Envíos programados (tablero PendEnviosReportes).
 */
definePageMeta({ permiso: 'reportes.ver' })

useHead({ title: 'Reportes · Configuración · ArgosIsp' })

const { puede } = usePermisos()
const toast = useToast()
const { eleccion, empresaId, empresa } = useEmpresaActiva()
const enTodas = computed(() => eleccion.value === 'todas' || empresaId.value === null)
const nombreEmpresa = computed(() => empresa.value?.nombre_comercial ?? 'la empresa activa')

const verPanel = computed(() => puede('panel_financiero.ver'))
const editaPanel = computed(() => puede('panel_financiero.configurar'))
const panel = shallowRef<AjustesPanelFinanciero | null>(null)
const problemaPanel = ref<Problem | null>(null)
const cargandoPanel = ref(false)
const pidePanelEmpresa = computed(() => enTodas.value || (problemaPanel.value !== null && codigoProblema(problemaPanel.value) === 'empresa_requerida'))

async function cargarPanel() {
    problemaGuardarPanel.value = null
    if (!verPanel.value || enTodas.value) {
        panel.value = null
        problemaPanel.value = null
        return
    }
    cargandoPanel.value = true
    const r = await usePanelFinancieroAjustes().ver()
    cargandoPanel.value = false
    problemaPanel.value = r.ok ? null : r.problema
    aplicar(r.ok ? r.data : null)
}

/** Lo que devolvió la API pasa al formulario (la `version` siempre de la última respuesta). */
function aplicar(datos: AjustesPanelFinanciero | null) {
    panel.value = datos
    if (datos) {
        estadoPanel.dias_baja = datos.dias_baja
    }
}

/* Altas y bajas */
const formPanel = useTemplateRef('formPanel')
const estadoPanel = reactive<{ dias_baja: number | undefined }>({ dias_baja: 60 })
const guardandoPanel = ref(false)
const problemaGuardarPanel = ref<Problem | null>(null)
const panelSinCambios = computed(() => panel.value === null || panel.value.dias_baja === estadoPanel.dias_baja)

async function guardarPanel(evento: FormSubmitEvent<DatosFormPanelFinanciero>) {
    if (!panel.value) {
        return
    }
    guardandoPanel.value = true
    problemaGuardarPanel.value = null
    const r = await usePanelFinancieroAjustes().guardar({ dias_baja: evento.data.dias_baja, version: panel.value.version })
    guardandoPanel.value = false
    if (!r.ok) {
        problemaGuardarPanel.value = r.problema
        if (r.problema.status === 422) {
            formPanel.value?.setErrors(erroresDeFormulario(r.problema))
        }
        return
    }
    aplicar(r.data)
    toast.add({ title: 'Días para contar una baja guardados', description: `Para ${nombreEmpresa.value}.`, icon: 'i-lucide-circle-check', color: 'success' })
}

watch(empresaId, cargarPanel)
onMounted(cargarPanel)
</script>

<template>
    <ConfiguracionMarco
        id="configuracion-reportes"
        titulo="Reportes"
        descripcion="Cómo se cuentan las bajas en los reportes"
        empresas
    >
        <UAlert
            v-if="verPanel && pidePanelEmpresa"
            color="info"
            variant="subtle"
            icon="i-lucide-building"
            title="Elige una empresa"
            description="Cada empresa decide cuándo cuenta una baja: elige una arriba."
            class="my-1"
        />
        <ProblemaAlerta
            v-else-if="verPanel && problemaPanel"
            :problema="problemaPanel"
            :reintentar="cargarPanel"
            :reintentando="cargandoPanel"
        />
        <USkeleton
            v-else-if="verPanel && !panel"
            class="h-40 w-full"
        />
        <template v-else-if="verPanel && panel">
            <ConfiguracionBloque
                titulo="Altas y bajas"
                icono="i-lucide-user-minus"
                data-prueba="bloque-bajas"
            >
                <UForm
                    ref="formPanel"
                    :schema="esquemaPanelFinanciero"
                    :state="estadoPanel"
                    :disabled="!editaPanel || guardandoPanel"
                    class="flex min-w-0 flex-col gap-2 py-2.5 sm:flex-row sm:items-center sm:justify-between"
                    @submit="guardarPanel"
                >
                    <div class="flex min-w-0 flex-col">
                        <span class="text-sm font-semibold text-highlighted">Días suspendido para contar una baja</span>
                        <span class="text-xs text-muted">Un servicio retirado, o suspendido más de estos días, cuenta como baja; si se reactiva deja de contar. De fábrica, 60.</span>
                        <UBadge
                            v-if="panel.fabrica"
                            label="Valor de fábrica"
                            color="neutral"
                            variant="soft"
                            size="sm"
                            class="mt-1 self-start"
                        />
                    </div>
                    <div class="flex shrink-0 items-start gap-2">
                        <UFormField
                            name="dias_baja"
                            required
                        >
                            <div class="flex items-center gap-2">
                                <UInputNumber
                                    v-model="estadoPanel.dias_baja"
                                    :min="1"
                                    :max="365"
                                    :step="1"
                                    :increment="false"
                                    :decrement="false"
                                    :format-options="{ useGrouping: false }"
                                    aria-label="Días suspendido para contar una baja"
                                    class="w-24"
                                    data-prueba="dias-baja"
                                />
                                <span class="text-xs text-muted">días</span>
                            </div>
                        </UFormField>
                        <UButton
                            v-if="editaPanel"
                            type="submit"
                            label="Guardar"
                            icon="i-lucide-check"
                            :loading="guardandoPanel"
                            :disabled="panelSinCambios"
                            data-prueba="dias-baja-guardar"
                        />
                    </div>
                </UForm>
                <ProblemaAlerta
                    v-if="problemaGuardarPanel && problemaGuardarPanel.status === 409"
                    :problema="problemaGuardarPanel"
                    etiqueta-reintentar="Recargar"
                    :reintentar="cargarPanel"
                />
                <ProblemaAlerta
                    v-else-if="problemaGuardarPanel && problemaGuardarPanel.status !== 422"
                    :problema="problemaGuardarPanel"
                />
            </ConfiguracionBloque>
        </template>
    </ConfiguracionMarco>
</template>
