<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { FormSubmitEvent, TableColumn } from '@nuxt/ui'

/**
 * Configuración › Reportes (decisiones 4 y 6 del PM; el aviso de pequeño contribuyente, la 12, va
 * en Régimen e impuestos):
 *
 * - **Altas y bajas** (`GET`/`PUT /panel-financiero/ajustes`, A3): días de suspensión tras los que
 *   un servicio cuenta como baja, de la empresa activa (60 de fábrica).
 * - **Correos externos aprobados** (tablero PendEnviosReportes, pestaña «Correos externos
 *   aprobados»; `/reportes/correos-externos`, A3): un contador o un socio puede recibir reportes
 *   contables programados. Solo el admin aprueba y retira; un retirado no se borra.
 */
definePageMeta({ permiso: 'reportes.ver' })

useHead({ title: 'Reportes · Configuración · ArgosIsp' })

const { puede } = usePermisos()
const toast = useToast()
const { eleccion, empresaId, empresa } = useEmpresaActiva()
const enTodas = computed(() => eleccion.value === 'todas' || empresaId.value === null)

/* Altas y bajas */
const verPanel = computed(() => puede('panel_financiero.ver'))
const editaPanel = computed(() => puede('panel_financiero.configurar'))
const panel = shallowRef<AjustesPanelFinanciero | null>(null)
const problemaPanel = ref<Problem | null>(null)
const cargandoPanel = ref(false)
const pidePanelEmpresa = computed(() => enTodas.value || (problemaPanel.value !== null && codigoProblema(problemaPanel.value) === 'empresa_requerida'))
const formPanel = useTemplateRef('formPanel')
const estadoPanel = reactive<{ dias_baja: number | undefined }>({ dias_baja: 60 })
const guardandoPanel = ref(false)
const problemaGuardarPanel = ref<Problem | null>(null)
const panelSinCambios = computed(() => panel.value === null || panel.value.dias_baja === estadoPanel.dias_baja)

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
    panel.value = r.ok ? r.data : null
    problemaPanel.value = r.ok ? null : r.problema
    if (r.ok) {
        estadoPanel.dias_baja = r.data.dias_baja
    }
}

async function guardarPanel(evento: FormSubmitEvent<DatosFormPanelFinanciero>) {
    if (!panel.value) {
        return
    }
    guardandoPanel.value = true
    problemaGuardarPanel.value = null
    const r = await usePanelFinancieroAjustes().guardar(evento.data.dias_baja, panel.value.version)
    guardandoPanel.value = false
    if (!r.ok) {
        problemaGuardarPanel.value = r.problema
        if (r.problema.status === 422) {
            formPanel.value?.setErrors(erroresDeFormulario(r.problema))
        }
        return
    }
    panel.value = r.data
    estadoPanel.dias_baja = r.data.dias_baja
    toast.add({ title: 'Días para contar una baja guardados', description: `Para ${empresa.value?.nombre_comercial ?? 'la empresa activa'}.`, icon: 'i-lucide-circle-check', color: 'success' })
}

/* Correos externos aprobados */
const verCorreos = computed(() => puede('reportes.programar_envio'))
const correos = shallowRef<CorreoExternoReportes[]>([])
const problemaCorreos = ref<Problem | null>(null)
const cargandoCorreos = ref(false)
const correosLeidos = ref(false)
const busqueda = ref('')
const aprobarAbierto = ref(false)
const retirarAbierto = ref(false)
const aRetirar = shallowRef<CorreoExternoReportes | null>(null)

async function cargarCorreos() {
    if (!verCorreos.value) {
        return
    }
    cargandoCorreos.value = true
    const r = await useCorreosExternos().listar()
    cargandoCorreos.value = false
    correosLeidos.value = true
    correos.value = r.ok ? [...r.data].sort((a, b) => Number(b.activo) - Number(a.activo)) : []
    problemaCorreos.value = r.ok ? null : r.problema
}

const correosVisibles = computed(() => {
    const termino = normalizarBusqueda(busqueda.value.trim())
    return correos.value.filter(c => !termino || normalizarBusqueda(`${c.correo} ${c.nombre}`).includes(termino))
})
const activos = computed(() => correos.value.filter(c => c.activo).length)

const columnas: TableColumn<CorreoExternoReportes>[] = [
    { accessorKey: 'correo', header: 'Correo' },
    { accessorKey: 'nombre', header: 'De quién es', meta: SOLO_ANCHO },
    { id: 'aprobado', header: 'Aprobado', meta: SOLO_ESCRITORIO },
    { accessorKey: 'activo', header: 'Estado' },
    { id: 'acciones', header: '', meta: { class: { th: 'w-0', td: 'text-right' } } },
]

function retirar(correo: CorreoExternoReportes) {
    aRetirar.value = correo
    retirarAbierto.value = true
}

function alAprobar(correo: CorreoExternoReportes) {
    toast.add({ title: `${correo.correo} aprobado`, description: 'Ya se puede elegir en los envíos programados.', icon: 'i-lucide-circle-check', color: 'success' })
    void cargarCorreos()
}

function alRetirar(correo: CorreoExternoReportes) {
    toast.add({ title: `${correo.correo} retirado`, description: 'Deja de recibir desde el siguiente envío.', icon: 'i-lucide-circle-check', color: 'success' })
    void cargarCorreos()
}

watch(empresaId, cargarPanel)
onMounted(() => {
    void cargarPanel()
    void cargarCorreos()
})
</script>

<template>
    <ConfiguracionMarco
        id="configuracion-reportes"
        titulo="Reportes"
        descripcion="Cómo se cuentan las bajas y a quién se envían los reportes"
        empresas
    >
        <ConfiguracionBloque
            v-if="verPanel"
            titulo="Altas y bajas"
            icono="i-lucide-user-minus"
            data-prueba="bloque-bajas"
        >
            <UAlert
                v-if="pidePanelEmpresa"
                color="info"
                variant="subtle"
                icon="i-lucide-building"
                title="Elige una empresa"
                description="Cada empresa decide cuándo cuenta una baja: elige una arriba."
                class="my-1"
            />
            <ProblemaAlerta
                v-else-if="problemaPanel"
                :problema="problemaPanel"
                :reintentar="cargarPanel"
                :reintentando="cargandoPanel"
            />
            <USkeleton
                v-else-if="!panel"
                class="h-12 w-full"
            />
            <UForm
                v-else
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
                    <UFormField name="dias_baja">
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

        <section
            v-if="verCorreos"
            class="flex min-w-0 flex-col gap-3"
            data-prueba="correos-externos"
        >
            <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <h2 class="flex items-center gap-2 text-xs font-bold tracking-[0.06em] text-muted uppercase">
                    <UIcon
                        name="i-lucide-mail-check"
                        class="size-4"
                    />
                    Correos externos aprobados
                    <UBadge
                        v-if="correosLeidos && !problemaCorreos"
                        :label="String(activos)"
                        color="neutral"
                        variant="soft"
                        size="sm"
                    />
                </h2>
                <UInput
                    v-model="busqueda"
                    icon="i-lucide-search"
                    placeholder="Buscar correo…"
                    aria-label="Buscar correo externo"
                    class="w-full sm:w-64"
                    :ui="{ base: 'rounded-full' }"
                />
            </div>
            <div class="flex flex-col gap-3 rounded-xl border border-primary/30 bg-primary/5 p-3 sm:flex-row sm:items-center">
                <p class="flex flex-1 items-start gap-2 text-sm text-primary">
                    <UIcon
                        name="i-lucide-shield-check"
                        class="mt-0.5 size-4 shrink-0"
                    />
                    <span>Solo el admin aprueba correos de fuera de la empresa (contador, socios, auditoría). Reciben <b>solo reportes contables, sin datos personales de clientes</b>.</span>
                </p>
                <UButton
                    v-if="puede('reportes.aprobar_correo_externo')"
                    label="Aprobar un correo"
                    icon="i-lucide-plus"
                    class="glow-brand self-start sm:self-center"
                    data-prueba="aprobar-correo"
                    @click="aprobarAbierto = true"
                />
            </div>
            <ProblemaAlerta
                v-if="problemaCorreos"
                :problema="problemaCorreos"
                :reintentar="cargarCorreos"
                :reintentando="cargandoCorreos"
            />
            <UTable
                v-else
                :data="correosVisibles"
                :columns="columnas"
                :loading="cargandoCorreos"
                :empty="correosLeidos ? (busqueda ? 'Ningún correo coincide.' : 'Todavía no hay correos externos aprobados.') : ''"
                class="-mx-4"
            >
                <template #correo-cell="{ row }">
                    <div
                        class="flex min-w-0 flex-col"
                        :data-correo="row.original.correo"
                    >
                        <span
                            class="truncate font-mono text-sm"
                            :class="row.original.activo ? 'text-highlighted' : 'text-muted'"
                        >{{ row.original.correo }}</span>
                        <span class="truncate text-xs text-muted sm:hidden">{{ row.original.nombre }}</span>
                    </div>
                </template>
                <template #aprobado-cell="{ row }">
                    <span class="text-xs text-muted">{{ row.original.activo ? `Aprobado el ${formatearFecha(row.original.aprobado_en)}` : `Retirado el ${formatearFecha(row.original.retirado_en)}` }}</span>
                </template>
                <template #activo-cell="{ row }">
                    <UBadge
                        :label="row.original.activo ? 'Aprobado' : 'Retirado'"
                        :icon="row.original.activo ? 'i-lucide-check' : 'i-lucide-circle-x'"
                        :color="row.original.activo ? 'success' : 'neutral'"
                        variant="subtle"
                        size="sm"
                    />
                </template>
                <template #acciones-cell="{ row }">
                    <UButton
                        v-if="row.original.activo && puede('reportes.retirar_correo_externo')"
                        label="Retirar"
                        color="error"
                        variant="ghost"
                        size="sm"
                        :data-retirar="row.original.correo"
                        @click="retirar(row.original)"
                    />
                </template>
            </UTable>
        </section>

        <CorreoExternoModal
            v-model:open="aprobarAbierto"
            @hecho="alAprobar"
        />
        <ConfirmacionModal
            v-model:open="retirarAbierto"
            :titulo="`¿Retirar ${aRetirar?.correo ?? 'el correo'}?`"
            efecto="Deja de recibir reportes desde el siguiente envío. Queda en la lista como retirado y se puede volver a aprobar."
            confirmar="Retirar"
            icono="i-lucide-mail-x"
            :ejecutar="() => useCorreosExternos().retirar(aRetirar?.id ?? 0)"
            @hecho="alRetirar"
        />
    </ConfiguracionMarco>
</template>
