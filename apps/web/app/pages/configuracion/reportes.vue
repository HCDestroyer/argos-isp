<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { FormSubmitEvent } from '@nuxt/ui'

/**
 * Configuración › Reportes (decisiones 4 y 12 del PM; `GET`/`PUT /panel-financiero/ajustes`, A3),
 * de la empresa activa:
 *
 * - **Altas y bajas:** días de suspensión tras los que un servicio cuenta como baja (60 de fábrica).
 * - **Aviso de pequeño contribuyente:** el aviso del panel del dueño al acercarse al límite anual
 *   (encendido de fábrica) y sus umbrales en %. Los umbrales son el parámetro fiscal `pc_alertas`
 *   de la empresa: cambiarlos exige además `fiscal.editar_parametros` (sin él se ven de solo
 *   lectura) y agrega un valor vigente desde hoy (409 `vigencia_duplicada` si ya se cambiaron hoy).
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
const editaUmbrales = computed(() => editaPanel.value && puede('fiscal.editar_parametros'))
const panel = shallowRef<AjustesPanelFinanciero | null>(null)
const problemaPanel = ref<Problem | null>(null)
const cargandoPanel = ref(false)
const pidePanelEmpresa = computed(() => enTodas.value || (problemaPanel.value !== null && codigoProblema(problemaPanel.value) === 'empresa_requerida'))

async function cargarPanel() {
    problemaGuardarPanel.value = null
    problemaAviso.value = null
    problemaUmbrales.value = null
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
        estadoUmbrales.umbrales = (datos.aviso_pc_umbrales ?? []).map(Number)
        estadoUmbrales.motivo = ''
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

/* Aviso de pequeño contribuyente: interruptor */
const guardandoAviso = ref(false)
const problemaAviso = ref<Problem | null>(null)

async function cambiarAviso(activo: boolean) {
    if (!panel.value) {
        return
    }
    guardandoAviso.value = true
    problemaAviso.value = null
    const r = await usePanelFinancieroAjustes().guardar({ aviso_pc_activo: activo, version: panel.value.version })
    guardandoAviso.value = false
    if (!r.ok) {
        problemaAviso.value = r.problema
        return
    }
    aplicar(r.data)
    toast.add({
        title: activo ? 'Aviso de pequeño contribuyente encendido' : 'Aviso de pequeño contribuyente apagado',
        description: activo ? `El panel avisará a ${nombreEmpresa.value} al llegar a cada umbral.` : `El panel ya no avisa a ${nombreEmpresa.value} del límite anual.`,
        icon: 'i-lucide-circle-check',
        color: 'success',
    })
}

/* Aviso de pequeño contribuyente: umbrales */
const formUmbrales = useTemplateRef('formUmbrales')
const estadoUmbrales = reactive<{ umbrales: number[], motivo: string }>({ umbrales: [], motivo: '' })
const guardandoUmbrales = ref(false)
const problemaUmbrales = ref<Problem | null>(null)
const umbralesVigentes = computed(() => panel.value?.aviso_pc_umbrales ?? null)
const umbralesCambiaron = computed(() => {
    const vigentes = umbralesVigentes.value
    if (vigentes === null || estadoUmbrales.umbrales.some(u => typeof u !== 'number' || Number.isNaN(u))) {
        return vigentes !== null
    }
    return normalizarUmbralesPc(estadoUmbrales.umbrales).join() !== normalizarUmbralesPc(vigentes.map(Number)).join()
})

/** De dónde salen los umbrales vigentes y desde cuándo. */
const origenUmbrales = computed(() => {
    const datos = panel.value
    if (!datos || datos.aviso_pc_umbrales === null) {
        return ''
    }
    const quien = datos.aviso_pc_umbrales_nivel === 'empresa' ? 'Los cambió la empresa' : 'Valor de fábrica del país'
    return datos.aviso_pc_umbrales_desde ? `${quien} · rigen desde el ${formatearFecha(datos.aviso_pc_umbrales_desde)}` : quien
})

/** Propone un umbral que aún no está (95, 90, 100…); se puede escribir otro. */
function agregarUmbral() {
    if (estadoUmbrales.umbrales.length >= 5) {
        return
    }
    const propuesto = [95, 90, 80, 100, 70, 60, 50].find(u => !estadoUmbrales.umbrales.includes(u)) ?? 85
    estadoUmbrales.umbrales.push(propuesto)
}

function quitarUmbral(indice: number) {
    estadoUmbrales.umbrales.splice(indice, 1)
}

async function guardarUmbrales(evento: FormSubmitEvent<DatosFormUmbralesPc>) {
    if (!panel.value) {
        return
    }
    guardandoUmbrales.value = true
    problemaUmbrales.value = null
    const motivo = evento.data.motivo.trim()
    const r = await usePanelFinancieroAjustes().guardar({
        aviso_pc_umbrales: normalizarUmbralesPc(evento.data.umbrales),
        ...(motivo ? { motivo } : {}),
        version: panel.value.version,
    })
    guardandoUmbrales.value = false
    if (!r.ok) {
        problemaUmbrales.value = r.problema
        if (r.problema.status === 422 && codigoProblema(r.problema) !== 'localizacion_no_instalada') {
            formUmbrales.value?.setErrors(erroresDeFormulario(r.problema).map(e => ({ ...e, name: e.name?.startsWith('aviso_pc_umbrales') ? 'umbrales' : e.name })))
        }
        return
    }
    aplicar(r.data)
    toast.add({ title: 'Umbrales del aviso guardados', description: `Rigen desde hoy para ${nombreEmpresa.value}.`, icon: 'i-lucide-circle-check', color: 'success' })
}

/** Mensaje claro para los errores propios de los umbrales; los demás, como vienen de la API. */
const avisoUmbrales = computed<{ titulo: string, texto: string } | null>(() => {
    const p = problemaUmbrales.value
    if (!p) {
        return null
    }
    const codigo = codigoProblema(p)
    if (codigo === 'vigencia_duplicada') {
        return { titulo: 'Los umbrales ya se cambiaron hoy', texto: 'Cada cambio rige desde el día en que se hace y hoy ya hay uno. Vuelve a intentarlo mañana o pide al contador que lo corrija en Configuración › Fiscal.' }
    }
    if (codigo === 'localizacion_no_instalada') {
        return { titulo: 'La empresa no tiene la localización fiscal instalada', texto: 'Los umbrales son un parámetro fiscal: instala la localización del país en Configuración › Fiscal y vuelve a intentarlo.' }
    }
    if (p.status === 403) {
        return { titulo: 'Sin permiso para cambiar los umbrales', texto: 'Cambiar los umbrales necesita además el permiso de editar parámetros fiscales.' }
    }
    return null
})

watch(empresaId, cargarPanel)
onMounted(cargarPanel)
</script>

<template>
    <ConfiguracionMarco
        id="configuracion-reportes"
        titulo="Reportes"
        descripcion="Cómo se cuentan las bajas y cuándo avisa el límite de pequeño contribuyente"
        empresas
    >
        <UAlert
            v-if="verPanel && pidePanelEmpresa"
            color="info"
            variant="subtle"
            icon="i-lucide-building"
            title="Elige una empresa"
            description="Cada empresa decide cuándo cuenta una baja y cuándo avisa el límite de pequeño contribuyente: elige una arriba."
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

            <ConfiguracionBloque
                titulo="Aviso de pequeño contribuyente"
                icono="i-lucide-gauge"
                data-prueba="bloque-aviso-pc"
            >
                <ConfiguracionFila
                    etiqueta="Avisar al acercarse al límite anual"
                    ayuda="En el panel financiero, cuando las ventas del año llegan a cada umbral del límite del pequeño contribuyente."
                    fuerte
                >
                    <USwitch
                        :model-value="panel.aviso_pc_activo"
                        :loading="guardandoAviso"
                        :disabled="!editaPanel || guardandoAviso"
                        aria-label="Avisar al acercarse al límite anual"
                        data-prueba="aviso-pc-activo"
                        @update:model-value="cambiarAviso"
                    />
                </ConfiguracionFila>
                <ProblemaAlerta
                    v-if="problemaAviso"
                    :problema="problemaAviso"
                    :etiqueta-reintentar="problemaAviso.status === 409 ? 'Recargar' : undefined"
                    :reintentar="problemaAviso.status === 409 ? cargarPanel : undefined"
                />
                <UAlert
                    v-if="!panel.aviso_pc_aplica"
                    color="neutral"
                    variant="subtle"
                    icon="i-lucide-info"
                    description="El régimen actual de la empresa no es pequeño contribuyente: el aviso no sale aunque esté encendido."
                    class="my-1"
                    data-prueba="aviso-pc-no-aplica"
                />

                <div
                    v-if="umbralesVigentes === null"
                    class="flex flex-col gap-2 border-t border-(--ax-borde) py-2.5"
                    data-prueba="umbrales-sin-localizacion"
                >
                    <span class="text-sm font-semibold text-highlighted">Umbrales del aviso</span>
                    <UAlert
                        color="warning"
                        variant="subtle"
                        icon="i-lucide-triangle-alert"
                        title="Sin localización fiscal"
                        description="Los umbrales son un parámetro fiscal de la empresa: instala la localización del país para verlos y cambiarlos."
                        :actions="puede('fiscal.ver') ? [{ label: 'Ir a Fiscal', to: '/configuracion/fiscal', color: 'neutral', variant: 'outline' }] : undefined"
                    />
                </div>

                <div
                    v-else-if="!editaUmbrales"
                    class="flex flex-col gap-2 border-t border-(--ax-borde) py-2.5 sm:flex-row sm:items-center sm:justify-between"
                    data-prueba="umbrales-lectura"
                >
                    <div class="flex min-w-0 flex-col">
                        <span class="text-sm font-semibold text-highlighted">Umbrales del aviso</span>
                        <span class="text-xs text-muted">{{ origenUmbrales }}</span>
                        <span
                            v-if="editaPanel"
                            class="text-xs text-muted"
                        >Cambiarlos necesita además el permiso de editar parámetros fiscales.</span>
                    </div>
                    <div class="flex flex-wrap gap-1.5">
                        <UBadge
                            v-for="umbral in umbralesVigentes"
                            :key="umbral"
                            :label="etiquetaUmbralPc(umbral)"
                            color="neutral"
                            variant="soft"
                        />
                    </div>
                </div>

                <UForm
                    v-else
                    ref="formUmbrales"
                    :schema="esquemaUmbralesPc"
                    :state="estadoUmbrales"
                    :disabled="guardandoUmbrales"
                    class="flex min-w-0 flex-col gap-3 border-t border-(--ax-borde) py-2.5"
                    data-prueba="umbrales-form"
                    @submit="guardarUmbrales"
                >
                    <div class="flex min-w-0 flex-col">
                        <span class="text-sm font-semibold text-highlighted">Umbrales del aviso</span>
                        <span class="text-xs text-muted">Porcentaje del límite anual en que avisa (de fábrica, 80 % y 95 %). Un cambio rige desde hoy y queda en el historial del parámetro fiscal.</span>
                        <span class="text-xs text-muted">{{ origenUmbrales }}</span>
                    </div>
                    <UFormField
                        name="umbrales"
                        :ui="{ error: 'mt-1' }"
                    >
                        <div class="flex flex-wrap items-center gap-2">
                            <div
                                v-for="(_, indice) in estadoUmbrales.umbrales"
                                :key="indice"
                                class="flex items-center gap-1 rounded-full border border-(--ax-borde) py-0.5 ps-1 pe-0.5"
                                :data-umbral="indice"
                            >
                                <UInputNumber
                                    v-model="estadoUmbrales.umbrales[indice]"
                                    :min="0.01"
                                    :max="100"
                                    :step="1"
                                    :increment="false"
                                    :decrement="false"
                                    :format-options="{ useGrouping: false, maximumFractionDigits: 2 }"
                                    :aria-label="`Umbral ${indice + 1} en %`"
                                    variant="none"
                                    class="w-16"
                                    :ui="{ base: 'text-end' }"
                                />
                                <span class="text-sm text-muted">%</span>
                                <UButton
                                    icon="i-lucide-x"
                                    color="neutral"
                                    variant="ghost"
                                    size="xs"
                                    class="rounded-full"
                                    :disabled="estadoUmbrales.umbrales.length <= 1"
                                    :aria-label="`Quitar el umbral ${indice + 1}`"
                                    @click="quitarUmbral(indice)"
                                />
                            </div>
                            <UButton
                                v-if="estadoUmbrales.umbrales.length < 5"
                                label="Agregar"
                                icon="i-lucide-plus"
                                color="neutral"
                                variant="outline"
                                size="sm"
                                class="rounded-full"
                                data-prueba="agregar-umbral"
                                @click="agregarUmbral"
                            />
                        </div>
                    </UFormField>
                    <UFormField
                        v-if="umbralesCambiaron"
                        name="motivo"
                        label="Motivo del cambio"
                        hint="Opcional"
                    >
                        <UInput
                            v-model="estadoUmbrales.motivo"
                            placeholder="Ej.: el contador pidió avisar antes"
                            class="w-full"
                            data-prueba="umbrales-motivo"
                        />
                    </UFormField>
                    <UAlert
                        v-if="avisoUmbrales"
                        color="error"
                        variant="subtle"
                        icon="i-lucide-circle-alert"
                        :title="avisoUmbrales.titulo"
                        :description="avisoUmbrales.texto"
                        data-prueba="umbrales-error"
                    />
                    <ProblemaAlerta
                        v-else-if="problemaUmbrales && problemaUmbrales.status === 409"
                        :problema="problemaUmbrales"
                        etiqueta-reintentar="Recargar"
                        :reintentar="cargarPanel"
                    />
                    <ProblemaAlerta
                        v-else-if="problemaUmbrales && problemaUmbrales.status !== 422"
                        :problema="problemaUmbrales"
                    />
                    <UButton
                        type="submit"
                        label="Guardar umbrales"
                        icon="i-lucide-check"
                        class="self-end"
                        :loading="guardandoUmbrales"
                        :disabled="!umbralesCambiaron"
                        data-prueba="umbrales-guardar"
                    />
                </UForm>
            </ConfiguracionBloque>
        </template>
    </ConfiguracionMarco>
</template>
