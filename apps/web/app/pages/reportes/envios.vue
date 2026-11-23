<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { TableColumn, TableRow } from '@nuxt/ui'

/**
 * Reportes › Envíos programados (tablero PendEnviosReportes, decisión 6 del PM; A3): reportes que
 * llegan solos por correo y los correos de fuera de la empresa que el admin aprobó.
 *
 * - **Envíos programados** (`GET /reportes/envios`): lista con cada cuánto, formato, para quién,
 *   próximo y estado; a la derecha (en el teléfono, debajo) el detalle con sus destinatarios, las
 *   últimas corridas (`GET /reportes/envios/:id/corridas`) y pausar o reanudar (`PUT`). Se programan
 *   desde cada reporte; pausar pide `reportes.editar_envio`.
 * - **Correos externos aprobados** (`GET /reportes/correos-externos`): quién lo aprobó o retiró y
 *   en cuántos envíos programados está («Envíos»). Solo el admin aprueba y retira; un retirado no
 *   se borra y los envíos que lo tienen lo muestran como «Retirado de la lista».
 */
definePageMeta({ permiso: 'reportes.programar_envio' })

useHead({ title: 'Envíos programados · Reportes · ArgosIsp' })

const { puede } = usePermisos()
const toast = useToast()
const { empresaId, eleccion, empresas: empresasUsuario } = useEmpresaActiva()
const ruta = useRoute()
const router = useRouter()

type Pestana = 'env' | 'cor'
const pestana = ref<Pestana>(ruta.query.ver === 'correos' ? 'cor' : 'env')
watch(pestana, (valor) => {
    void router.replace({ query: { ...ruta.query, ver: valor === 'cor' ? 'correos' : undefined } })
})
const busqueda = ref('')
const termino = computed(() => normalizarBusqueda(busqueda.value.trim()))

/* Envíos programados */
const envios = shallowRef<EnvioReporte[]>([])
const problemaEnvios = ref<Problem | null>(null)
const cargandoEnvios = ref(false)
const enviosLeidos = ref(false)
const seleccionado = ref<number | null>(null)

async function cargarEnvios() {
    cargandoEnvios.value = true
    const r = await useEnviosReportes().listar()
    cargandoEnvios.value = false
    enviosLeidos.value = true
    envios.value = r.ok ? r.data : []
    problemaEnvios.value = r.ok ? null : r.problema
    if (!envios.value.some(e => e.id === seleccionado.value)) {
        seleccionado.value = envios.value[0]?.id ?? null
    }
}

const enviosVisibles = computed(() => envios.value.filter(e => !termino.value
    || normalizarBusqueda(`${e.nombre} ${tituloReporteEnvio(e.reporte)} ${destinatariosEnvio(e)}`).includes(termino.value)))
const envioAbierto = computed(() => envios.value.find(e => e.id === seleccionado.value) ?? null)

function empresaDeEnvio(envio: EnvioReporte): string {
    if (envio.empresa_id === null) {
        return 'Consolidado (todas)'
    }
    return empresasUsuario.value.find(e => e.id === envio.empresa_id)?.nombre_comercial ?? `Empresa ${envio.empresa_id}`
}

const columnasEnvios: TableColumn<EnvioReporte>[] = [
    { accessorKey: 'nombre', header: 'Envío' },
    { id: 'frecuencia', header: 'Cada cuánto', meta: SOLO_ANCHO },
    { accessorKey: 'formato', header: 'Formato', meta: SOLO_ESCRITORIO },
    { id: 'destinatarios', header: 'Para quién', meta: SOLO_ESCRITORIO },
    { accessorKey: 'proximo_en', header: 'Próximo', meta: SOLO_ESCRITORIO },
    { accessorKey: 'activo', header: 'Estado' },
]

function alElegirEnvio(_evento: Event, fila: TableRow<EnvioReporte>) {
    seleccionado.value = fila.original.id
}

/* Corridas del envío abierto */
const corridas = shallowRef<CorridaEnvioReporte[] | null>(null)
const problemaCorridas = ref<Problem | null>(null)
const cargandoCorridas = ref(false)

async function cargarCorridas() {
    const id = seleccionado.value
    corridas.value = null
    problemaCorridas.value = null
    if (id === null) {
        return
    }
    cargandoCorridas.value = true
    const r = await useEnviosReportes().corridas(id)
    cargandoCorridas.value = false
    if (seleccionado.value !== id) {
        return
    }
    corridas.value = r.ok ? r.data : null
    problemaCorridas.value = r.ok ? null : r.problema
}

watch(seleccionado, cargarCorridas)

/* Pausar o reanudar */
const cambiando = ref(false)
const problemaCambio = ref<Problem | null>(null)

async function cambiarActivo(activo: boolean) {
    const envio = envioAbierto.value
    if (!envio) {
        return
    }
    cambiando.value = true
    problemaCambio.value = null
    const r = await useEnviosReportes().cambiarActivo(envio, activo)
    cambiando.value = false
    if (!r.ok) {
        problemaCambio.value = r.problema
        return
    }
    envios.value = envios.value.map(e => (e.id === r.data.id ? r.data : e))
    toast.add({ title: activo ? `${envio.nombre} reanudado` : `${envio.nombre} en pausa`, description: activo ? 'Vuelve a llegar en su próximo horario.' : 'No se envía hasta que lo reanudes.', icon: 'i-lucide-circle-check', color: 'success' })
}

/* Correos externos aprobados */
const correos = shallowRef<CorreoExternoListado[]>([])
const problemaCorreos = ref<Problem | null>(null)
const cargandoCorreos = ref(false)
const correosLeidos = ref(false)
const aprobarAbierto = ref(false)
const retirarAbierto = ref(false)
const aRetirar = shallowRef<CorreoExternoListado | null>(null)

async function cargarCorreos() {
    cargandoCorreos.value = true
    const r = await useCorreosExternos().listar()
    cargandoCorreos.value = false
    correosLeidos.value = true
    correos.value = r.ok ? [...r.data].sort((a, b) => Number(b.activo) - Number(a.activo)) : []
    problemaCorreos.value = r.ok ? null : r.problema
}

const correosVisibles = computed(() => correos.value.filter(c => !termino.value || normalizarBusqueda(`${c.correo} ${c.nombre}`).includes(termino.value)))
const aprobados = computed(() => correos.value.filter(c => c.activo).length)

const columnasCorreos: TableColumn<CorreoExternoListado>[] = [
    { accessorKey: 'correo', header: 'Correo' },
    { accessorKey: 'nombre', header: 'De quién es', meta: SOLO_ESCRITORIO },
    { id: 'aprobado', header: 'Aprobado', meta: SOLO_ESCRITORIO },
    { accessorKey: 'envios_programados', header: 'Envíos', meta: SOLO_ANCHO },
    { accessorKey: 'activo', header: 'Estado' },
    { id: 'acciones', header: '', meta: { class: { th: 'w-0', td: 'text-right' } } },
]

/** «Ana Castillo · 3 oct 2026» o «Retirado por Ana Castillo · 14 nov». */
function quienCorreo(correo: CorreoExternoListado): string {
    if (!correo.activo) {
        return `Retirado${correo.retirado_por_nombre ? ` por ${correo.retirado_por_nombre}` : ''} · ${formatearFechaCorta(correo.retirado_en)}`
    }
    return `${correo.aprobado_por_nombre ?? 'Sin nombre'} · ${formatearFechaCorta(correo.aprobado_en)}`
}

function textoEnvios(correo: CorreoExternoListado): string {
    return `${correo.envios_programados} ${correo.envios_programados === 1 ? 'programado' : 'programados'}`
}

function retirar(correo: CorreoExternoListado) {
    aRetirar.value = correo
    retirarAbierto.value = true
}

const efectoRetiro = computed(() => {
    const n = aRetirar.value?.envios_programados ?? 0
    return n
        ? `Deja de recibir desde el próximo envío. Sus ${n} ${n === 1 ? 'envío programado sigue' : 'envíos programados siguen'} para los demás destinatarios y lo muestran como «Retirado de la lista».`
        : 'Deja de recibir desde el próximo envío. Queda en la lista como retirado y se puede volver a aprobar.'
})

function alAprobar(correo: CorreoExternoReportes) {
    toast.add({ title: `${correo.correo} aprobado`, description: 'Ya se puede elegir en los envíos programados.', icon: 'i-lucide-circle-check', color: 'success' })
    void cargarCorreos()
    void cargarEnvios()
}

function alRetirar(correo: CorreoExternoReportes) {
    toast.add({ title: `${correo.correo} retirado`, description: 'Deja de recibir desde el siguiente envío.', icon: 'i-lucide-circle-check', color: 'success' })
    void cargarCorreos()
    void cargarEnvios()
}

const pestanas = computed(() => [
    {
        label: 'Envíos programados',
        value: 'env',
        icon: 'i-lucide-send',
        badge: enviosLeidos.value && !problemaEnvios.value ? { label: String(envios.value.length), color: 'neutral' as const, variant: 'soft' as const } : undefined,
    },
    {
        label: 'Correos externos aprobados',
        value: 'cor',
        icon: 'i-lucide-mail',
        badge: correosLeidos.value && !problemaCorreos.value ? { label: String(aprobados.value), color: 'neutral' as const, variant: 'soft' as const } : undefined,
    },
])

function cargar() {
    void cargarEnvios()
    void cargarCorreos()
}

watch([empresaId, eleccion], cargar)
onMounted(cargar)
</script>

<template>
    <PanelPagina
        id="reportes-envios"
        titulo="Envíos programados"
        icono="i-lucide-send"
        descripcion="Reportes que llegan solos por correo, y los correos de fuera que el admin aprobó"
    >
        <section class="surface-card flex min-w-0 flex-col rounded-2xl lg:min-h-0 lg:flex-1">
            <div class="flex flex-wrap items-center justify-between gap-2 border-b border-(--ax-borde) p-3 sm:px-4">
                <UTabs
                    v-model="pestana"
                    :items="pestanas"
                    variant="pill"
                    color="neutral"
                    :content="false"
                    class="min-w-0 max-w-full"
                    :ui="{
                        list: 'w-auto max-w-full justify-start self-start overflow-x-auto rounded-xl bg-(--ax-panel) p-1',
                        indicator: 'rounded-lg bg-(--ax-tarjeta) shadow-sm ring ring-(--ax-borde)',
                        trigger: 'shrink-0 grow-0 rounded-lg px-3 text-muted data-[state=active]:text-primary',
                        leadingIcon: 'size-4',
                    }"
                    data-prueba="pestanas-envios"
                />
                <UInput
                    v-model="busqueda"
                    icon="i-lucide-search"
                    placeholder="Buscar envío o correo…"
                    aria-label="Buscar envío o correo"
                    class="w-full sm:w-60"
                    :ui="{ base: 'rounded-full' }"
                />
            </div>

            <!-- Envíos programados: lista y, a la derecha, el detalle del elegido. -->
            <div
                v-if="pestana === 'env'"
                class="flex min-w-0 flex-col lg:min-h-0 lg:flex-1 lg:flex-row"
                data-prueba="tab-envios"
            >
                <div class="flex min-w-0 flex-1 flex-col lg:min-h-0">
                    <div class="flex flex-col p-3 sm:px-4 lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
                        <ProblemaAlerta
                            v-if="problemaEnvios"
                            :problema="problemaEnvios"
                            :reintentar="cargarEnvios"
                            :reintentando="cargandoEnvios"
                        />
                        <UTable
                            v-else
                            :data="enviosVisibles"
                            :columns="columnasEnvios"
                            :loading="cargandoEnvios"
                            :empty="enviosLeidos ? (busqueda ? 'Ningún envío coincide.' : 'Todavía no hay envíos programados. Se programan desde cada reporte.') : ''"
                            class="-mx-3 sm:-mx-4"
                            :ui="{ tr: 'cursor-pointer' }"
                            @select="alElegirEnvio"
                        >
                            <template #nombre-cell="{ row }">
                                <div
                                    class="flex min-w-0 flex-col"
                                    :data-envio="row.original.nombre"
                                    :data-seleccionado="row.original.id === seleccionado"
                                >
                                    <span
                                        class="truncate text-sm font-semibold"
                                        :class="row.original.id === seleccionado ? 'text-primary' : 'text-highlighted'"
                                    >{{ row.original.nombre }}</span>
                                    <span class="truncate text-xs text-muted">{{ tituloReporteEnvio(row.original.reporte) }} · {{ empresaDeEnvio(row.original) }}</span>
                                    <span class="truncate text-xs text-muted sm:hidden">{{ frecuenciaEnvio(row.original) }}</span>
                                </div>
                            </template>
                            <template #frecuencia-cell="{ row }">
                                <span class="text-sm">{{ frecuenciaEnvio(row.original) }}</span>
                            </template>
                            <template #formato-cell="{ row }">
                                <UBadge
                                    :label="FORMATO_ENVIO[row.original.formato].etiqueta"
                                    :icon="FORMATO_ENVIO[row.original.formato].icono"
                                    color="neutral"
                                    variant="subtle"
                                    size="sm"
                                />
                            </template>
                            <template #destinatarios-cell="{ row }">
                                <span class="line-clamp-2 text-xs text-muted">{{ destinatariosEnvio(row.original) }}</span>
                            </template>
                            <template #proximo_en-cell="{ row }">
                                <span class="text-sm">{{ row.original.activo ? `${formatearFechaCorta(row.original.proximo_en)} ${formatearHora(row.original.proximo_en)}` : '—' }}</span>
                            </template>
                            <template #activo-cell="{ row }">
                                <UBadge
                                    :label="estadoEnvio(row.original).etiqueta"
                                    :icon="estadoEnvio(row.original).icono"
                                    :color="estadoEnvio(row.original).color"
                                    variant="subtle"
                                    size="sm"
                                />
                            </template>
                        </UTable>
                    </div>
                    <p class="flex items-start gap-1.5 border-t border-(--ax-borde) px-4 py-2.5 text-xs text-muted">
                        <UIcon
                            name="i-lucide-info"
                            class="mt-px size-3.5 shrink-0"
                        />
                        Se programan desde cada reporte con «Programar envío». A un correo externo solo llegan reportes contables sin datos personales.
                    </p>
                </div>
                <aside
                    v-if="envioAbierto"
                    class="flex min-w-0 flex-col border-t border-(--ax-borde) lg:min-h-0 lg:w-[420px] lg:shrink-0 lg:border-t-0 lg:border-l"
                    aria-label="Detalle del envío"
                >
                    <ProblemaAlerta
                        v-if="problemaCambio"
                        :problema="problemaCambio"
                        :etiqueta-reintentar="problemaCambio.status === 409 ? 'Recargar' : undefined"
                        :reintentar="problemaCambio.status === 409 ? cargarEnvios : undefined"
                        class="m-3"
                    />
                    <EnvioReporteDetalle
                        :envio="envioAbierto"
                        :corridas="corridas"
                        :problema-corridas="problemaCorridas"
                        :cargando-corridas="cargandoCorridas"
                        :puede-editar="puede('reportes.editar_envio')"
                        :cambiando="cambiando"
                        class="lg:flex-1"
                        @cambiar-activo="cambiarActivo"
                        @reintentar-corridas="cargarCorridas"
                    />
                </aside>
            </div>

            <!-- Correos externos aprobados. -->
            <div
                v-else
                class="flex min-w-0 flex-col gap-3 p-3 sm:p-4 lg:min-h-0 lg:flex-1 lg:overflow-y-auto"
                data-prueba="correos-externos"
            >
                <div class="flex flex-col gap-3 sm:flex-row sm:items-center">
                    <p class="flex flex-1 items-start gap-2 rounded-xl border border-primary/30 bg-primary/5 p-3 text-sm text-primary">
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
                    :columns="columnasCorreos"
                    :loading="cargandoCorreos"
                    :empty="correosLeidos ? (busqueda ? 'Ningún correo coincide.' : 'Todavía no hay correos externos aprobados.') : ''"
                    class="-mx-3 sm:-mx-4"
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
                            <span class="truncate text-xs text-muted lg:hidden">{{ row.original.nombre }}</span>
                            <span class="truncate text-xs text-muted lg:hidden">{{ quienCorreo(row.original) }}</span>
                            <span class="truncate text-xs text-muted sm:hidden">{{ textoEnvios(row.original) }}</span>
                        </div>
                    </template>
                    <template #nombre-cell="{ row }">
                        <span :class="row.original.activo ? '' : 'text-muted'">{{ row.original.nombre }}</span>
                    </template>
                    <template #aprobado-cell="{ row }">
                        <span class="text-xs text-muted">{{ quienCorreo(row.original) }}</span>
                    </template>
                    <template #envios_programados-cell="{ row }">
                        <span
                            class="text-xs text-muted"
                            :title="row.original.envios_programados ? `${row.original.envios_activos} activos` : undefined"
                            :data-envios="row.original.correo"
                        >{{ textoEnvios(row.original) }}</span>
                    </template>
                    <template #activo-cell="{ row }">
                        <UBadge
                            :label="row.original.activo ? 'Aprobado' : 'Retirado'"
                            :icon="row.original.activo ? 'i-lucide-check' : 'i-lucide-x'"
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
            </div>
        </section>

        <CorreoExternoModal
            v-model:open="aprobarAbierto"
            @hecho="alAprobar"
        />
        <ConfirmacionModal
            v-model:open="retirarAbierto"
            :titulo="`¿Retirar ${aRetirar?.correo ?? 'el correo'}?`"
            :efecto="efectoRetiro"
            confirmar="Retirar"
            icono="i-lucide-mail-x"
            :ejecutar="() => useCorreosExternos().retirar(aRetirar?.id ?? 0)"
            @hecho="alRetirar"
        />
    </PanelPagina>
</template>
