<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { SelectItem, TableColumn } from '@nuxt/ui'

/**
 * Bloqueos del libro (A3, fase 6 PR A, contrato fiscal §11): por empresa, el `hasta` vigente de cada
 * tipo (global, ventas, compras, impuestos y el duro), las acciones que el permiso deja (bloquear,
 * desbloquear, bloqueo duro con confirmación de texto, excepciones con fecha de fin, solo admin), los
 * procesos que una corrida no contabilizó por un bloqueo y el historial. Si algo no se puede leer, el
 * error se ve con «Reintentar» y no se muestra ningún estado inventado.
 */
definePageMeta({ permiso: 'libro.ver' })

useHead({ title: 'Bloqueos del libro · ArgosIsp' })

const { puede } = usePermisos()
const toast = useToast()
const empresaActiva = useEmpresaActiva()

/* Vigentes por empresa. */
const empresas = shallowRef<BloqueosEmpresa[]>([])
const cargando = ref(true)
const problema = ref<Problem | null>(null)

async function cargar() {
    cargando.value = true
    const resultado = await useBloqueosLibro().vigentes()
    cargando.value = false
    empresas.value = resultado.ok ? resultado.data : []
    problema.value = resultado.ok ? null : resultado.problema
}

function nombreEmpresa(id: number): string | null {
    return empresas.value.length > 1 || empresaActiva.eleccion.value === 'todas' ? empresaActiva.nombre(id) : null
}

function ultimo(empresa: BloqueosEmpresa, tipo: TipoBloqueo): BloqueoLibro | null {
    return empresa.ultimos.find(u => u.tipo === tipo) ?? null
}

const TIPOS: readonly TipoBloqueo[] = ['global', 'ventas', 'compras', 'impuestos', 'duro']

/* Acciones: qué modal y para qué empresa. */
type Accion = 'bloquear' | 'desbloquear' | 'duro' | 'excepcion'
const accion = ref<Accion | null>(null)
const empresaAccion = shallowRef<BloqueosEmpresa | null>(null)
const tipoAccion = ref<TipoBloqueoNormal>('global')

function abrir(tipo: Accion, empresa: BloqueosEmpresa, tipoBloqueo: TipoBloqueoNormal = 'global') {
    empresaAccion.value = empresa
    tipoAccion.value = tipoBloqueo
    accion.value = tipo
}

function abiertoPara(tipo: Accion) {
    return computed({
        get: () => accion.value === tipo,
        set: (valor: boolean) => {
            if (!valor) {
                accion.value = null
            }
        },
    })
}

const bloqueando = abiertoPara('bloquear')
const desbloqueando = abiertoPara('desbloquear')
const aplicandoDuro = abiertoPara('duro')
const creandoExcepcion = abiertoPara('excepcion')

function puedeDesbloquear(empresa: BloqueosEmpresa): boolean {
    return puede('libro.desbloquear') && TIPOS_DESBLOQUEABLES.some(t => empresa.vigentes[t] !== null)
}

function alCambiar(bloqueo: BloqueoLibro) {
    toast.add({
        title: bloqueo.tipo === 'duro' ? 'Bloqueo duro aplicado' : bloqueo.hasta ? `${TIPOS_BLOQUEO[bloqueo.tipo].etiqueta}: bloqueado hasta ${formatearFecha(bloqueo.hasta)}` : `${TIPOS_BLOQUEO[bloqueo.tipo].etiqueta}: sin bloqueo`,
        icon: 'i-lucide-lock',
        color: 'success',
    })
    void cargar()
    void historial.recargar()
}

function alCrearExcepcion(excepcion: ExcepcionBloqueo) {
    toast.add({ title: 'Excepción creada', description: `${TIPOS_BLOQUEO[excepcion.tipo].etiqueta} · ${excepcion.usuario_nombre ?? 'todos los usuarios'} · hasta ${formatearFechaHora(excepcion.hasta_en)}`, icon: 'i-lucide-key-round', color: 'success' })
    void excepciones.recargar()
}

/* Excepciones. */
const TODOS = 'todos'
const estadoExcepcion = ref<ExcepcionBloqueo['estado'] | typeof TODOS>('vigente')
const itemsEstado: SelectItem[] = [{ label: 'Todas', value: TODOS }, ...Object.entries(ESTADOS_EXCEPCION).map(([value, e]) => ({ label: e.etiqueta, value }))]
const excepciones = usePaginacionCursor(cursor => useBloqueosLibro().excepciones(estadoExcepcion.value === TODOS ? {} : { estado: estadoExcepcion.value }, cursor))
watch(estadoExcepcion, () => void excepciones.recargar())

const columnasExcepcion: TableColumn<ExcepcionBloqueo>[] = [
    { accessorKey: 'tipo', header: 'Cubre', meta: SOLO_ANCHO },
    { accessorKey: 'usuario_nombre', header: 'Para', meta: { class: { td: 'whitespace-normal' } } },
    { accessorKey: 'hasta_en', header: 'Hasta' },
    { accessorKey: 'estado', header: 'Estado' },
    { id: 'acciones', header: '' },
]

const excepcionARevocar = shallowRef<ExcepcionBloqueo | null>(null)
const revocando = computed({
    get: () => excepcionARevocar.value !== null,
    set: (valor: boolean) => {
        if (!valor) {
            excepcionARevocar.value = null
        }
    },
})

function revocar(motivo: string, clave: string) {
    const excepcion = excepcionARevocar.value
    return excepcion
        ? useBloqueosLibro().revocarExcepcion(excepcion.id, motivo, clave)
        : Promise.resolve<Resultado<ExcepcionBloqueo>>({ ok: false, problema: { type: 'about:blank', title: 'Sin excepción', status: 0 } })
}

function alRevocar() {
    toast.add({ title: 'Excepción revocada', description: 'Desde ahora no cubre asientos nuevos.', icon: 'i-lucide-key-round', color: 'success' })
    void excepciones.recargar()
}

/* Historial. */
const tipoHistorial = ref<TipoBloqueo | typeof TODOS>(TODOS)
const itemsTipoHistorial: SelectItem[] = [{ label: 'Todos los tipos', value: TODOS }, ...TIPOS.map(t => ({ label: TIPOS_BLOQUEO[t].etiqueta, value: t }))]
const historial = usePaginacionCursor(cursor => useBloqueosLibro().historial(tipoHistorial.value === TODOS ? {} : { tipo: tipoHistorial.value }, cursor))
watch(tipoHistorial, () => void historial.recargar())

const columnasHistorial: TableColumn<BloqueoLibro>[] = [
    { accessorKey: 'created_at', header: 'Cuándo', meta: { class: { td: 'whitespace-normal' } } },
    { accessorKey: 'tipo', header: 'Tipo', meta: SOLO_ANCHO },
    { accessorKey: 'hasta', header: 'Hasta', meta: { class: { td: 'whitespace-normal' } } },
    { accessorKey: 'motivo', header: 'Motivo', meta: { class: { th: 'hidden sm:table-cell', td: 'hidden whitespace-normal sm:table-cell' } } },
]

/* Procesos pendientes por un bloqueo: correr de nuevo y ver qué quedó detenido. */
const procesoAConfirmar = ref<ProcesoConBloqueo | null>(null)
const confirmandoProceso = computed({
    get: () => procesoAConfirmar.value !== null,
    set: (valor: boolean) => {
        if (!valor) {
            procesoAConfirmar.value = null
        }
    },
})
const corridas = reactive<Partial<Record<ProcesoConBloqueo, { resumen: string, bloqueados: number, bloqueos: BloqueoDeProceso[] }>>>({})

function correrProceso(): Promise<Resultado<{ resumen: string, bloqueados: number, bloqueos: BloqueoDeProceso[] }>> {
    const proceso = procesoAConfirmar.value
    const clave = nuevaClaveIdempotencia()
    if (proceso === 'facturar') {
        return useFacturas().generar(clave).then(r => (r.ok
            ? { ok: true, data: { resumen: `${r.data.generadas} generadas · ${r.data.omitidas} ya tenían factura${r.data.errores ? ` · ${r.data.errores} con error` : ''}`, bloqueados: r.data.bloqueados ?? 0, bloqueos: r.data.bloqueos ?? [] } }
            : r))
    }
    return useFacturas().vencer(clave).then(r => (r.ok
        ? { ok: true, data: { resumen: `${r.data.vencidas} vencidas · ${r.data.moras} moras${r.data.errores ? ` · ${r.data.errores} con error` : ''}`, bloqueados: r.data.bloqueados, bloqueos: r.data.bloqueos } }
        : r))
}

const ultimoProceso = ref<ProcesoConBloqueo | null>(null)

function alCorrer(resultado: { resumen: string, bloqueados: number, bloqueos: BloqueoDeProceso[] }) {
    const proceso = ultimoProceso.value
    if (proceso) {
        corridas[proceso] = resultado
    }
    toast.add({
        title: resultado.bloqueados ? `${resultado.bloqueados} pendientes por un bloqueo` : 'Sin pendientes por bloqueos',
        description: resultado.resumen,
        icon: resultado.bloqueados ? 'i-lucide-lock' : 'i-lucide-circle-check',
        color: resultado.bloqueados ? 'warning' : 'success',
    })
}

function pedirProceso(proceso: ProcesoConBloqueo) {
    ultimoProceso.value = proceso
    procesoAConfirmar.value = proceso
}

onMounted(() => {
    void cargar()
    void excepciones.recargar()
    void historial.recargar()
})
</script>

<template>
    <PanelPagina
        id="bloqueos-libro"
        titulo="Bloqueos del libro"
        icono="i-lucide-lock"
    >
        <template #acciones>
            <UButton
                to="/libro"
                icon="i-lucide-arrow-left"
                label="Libro"
                color="neutral"
                variant="ghost"
                class="hidden sm:inline-flex"
            />
        </template>

        <div class="flex flex-col gap-6">
            <UAlert
                color="neutral"
                variant="subtle"
                icon="i-lucide-info"
                description="Nada se registra con fecha hasta el día bloqueado bajo un bloqueo que le aplique (global, ventas, compras o impuestos), salvo con una excepción vigente. Bajo el bloqueo duro no entra nada, ni con excepción, y ningún mes se reabre."
            />

            <ProblemaAlerta
                v-if="problema"
                :problema="problema"
                :reintentar="cargar"
                :reintentando="cargando"
            />
            <USkeleton
                v-else-if="cargando && !empresas.length"
                class="h-40 w-full"
            />
            <UPageCard
                v-for="empresa in empresas"
                v-else
                :key="empresa.empresa_id"
                :title="nombreEmpresa(empresa.empresa_id) ?? 'Bloqueos vigentes'"
                icon="i-lucide-lock"
                variant="subtle"
                :data-empresa="empresa.empresa_id"
                data-prueba="bloqueos-empresa"
            >
                <div class="flex flex-col gap-4">
                    <div class="flex flex-wrap gap-2">
                        <UButton
                            v-if="puede('libro.bloquear')"
                            label="Bloquear"
                            icon="i-lucide-lock"
                            size="sm"
                            data-prueba="abrir-bloquear"
                            @click="abrir('bloquear', empresa)"
                        />
                        <UButton
                            v-if="puedeDesbloquear(empresa)"
                            label="Desbloquear"
                            icon="i-lucide-lock-open"
                            color="warning"
                            variant="outline"
                            size="sm"
                            data-prueba="abrir-desbloquear"
                            @click="abrir('desbloquear', empresa, TIPOS_DESBLOQUEABLES.find(t => empresa.vigentes[t]) ?? 'global')"
                        />
                        <UButton
                            v-if="puede('libro.bloquear_duro')"
                            label="Bloqueo duro"
                            icon="i-lucide-shield-alert"
                            color="error"
                            variant="outline"
                            size="sm"
                            data-prueba="abrir-duro"
                            @click="abrir('duro', empresa)"
                        />
                        <UButton
                            v-if="puede('libro.excepcion_bloqueo')"
                            label="Nueva excepción"
                            icon="i-lucide-key-round"
                            color="neutral"
                            variant="outline"
                            size="sm"
                            data-prueba="abrir-excepcion"
                            @click="abrir('excepcion', empresa)"
                        />
                    </div>
                    <ul class="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                        <li
                            v-for="tipo in TIPOS"
                            :key="tipo"
                            class="flex flex-col gap-1 rounded-lg border p-3"
                            :class="tipo === 'duro' && empresa.vigentes.duro ? 'border-error/40 bg-error/5' : 'border-default'"
                            :data-tipo="tipo"
                        >
                            <span class="flex items-center gap-2 text-sm font-medium text-highlighted">
                                <UIcon
                                    :name="TIPOS_BLOQUEO[tipo].icono"
                                    class="size-4 shrink-0"
                                />
                                {{ TIPOS_BLOQUEO[tipo].etiqueta }}
                            </span>
                            <span
                                class="text-base font-semibold tabular-nums"
                                :class="empresa.vigentes[tipo] ? 'text-highlighted' : 'text-muted'"
                                data-prueba="bloqueo-vigente"
                            >{{ empresa.vigentes[tipo] ? `Hasta ${formatearFecha(empresa.vigentes[tipo] ?? '')}` : 'Sin bloqueo' }}</span>
                            <span
                                v-if="ultimo(empresa, tipo)"
                                class="text-xs text-muted"
                            >
                                {{ ultimo(empresa, tipo)?.motivo }} · {{ ultimo(empresa, tipo)?.creado_por_nombre ?? 'Sistema' }}, {{ formatearFecha(ultimo(empresa, tipo)?.created_at ?? '') }}
                            </span>
                            <span
                                v-if="tipo !== 'global' && tipo !== 'duro' && bloqueoEfectivo(empresa.vigentes, tipo) !== empresa.vigentes[tipo]"
                                class="text-xs text-muted"
                            >Efectivo hasta {{ formatearFecha(bloqueoEfectivo(empresa.vigentes, tipo) ?? '') }} (global o duro)</span>
                        </li>
                    </ul>
                </div>
            </UPageCard>

            <UPageCard
                v-if="puede('facturas.generar')"
                title="Procesos detenidos por un bloqueo"
                description="La facturación y el vencimiento no contabilizan lo que cae bajo un bloqueo: lo dejan pendiente y cada corrida lo reintenta. Después de desbloquear (o con una excepción), córralos para que entre lo pendiente."
                icon="i-lucide-hourglass"
                variant="subtle"
                data-prueba="procesos-bloqueados"
            >
                <div class="grid gap-3 lg:grid-cols-2">
                    <div
                        v-for="(visual, proceso) in PROCESOS_CON_BLOQUEO"
                        :key="proceso"
                        class="flex flex-col gap-2 rounded-lg border border-default p-3"
                        :data-proceso="proceso"
                    >
                        <div class="flex flex-wrap items-center justify-between gap-2">
                            <span class="flex items-center gap-2 text-sm font-medium text-highlighted">
                                <UIcon
                                    :name="visual.icono"
                                    class="size-4"
                                />
                                {{ visual.etiqueta }}
                            </span>
                            <UButton
                                label="Correr ahora"
                                icon="i-lucide-play"
                                color="neutral"
                                variant="outline"
                                size="sm"
                                :data-prueba="`correr-${proceso}`"
                                @click="pedirProceso(proceso)"
                            />
                        </div>
                        <p class="text-xs text-muted">
                            {{ visual.descripcion }}
                        </p>
                        <template v-if="corridas[proceso]">
                            <p class="text-sm">
                                {{ corridas[proceso]?.resumen }}
                            </p>
                            <p
                                class="text-sm font-medium"
                                :class="corridas[proceso]?.bloqueados ? 'text-warning' : 'text-success'"
                                data-prueba="proceso-bloqueados"
                            >
                                {{ corridas[proceso]?.bloqueados ? `${corridas[proceso]?.bloqueados} documentos siguen pendientes por un bloqueo` : 'Nada quedó detenido por un bloqueo' }}
                            </p>
                            <ul
                                v-if="corridas[proceso]?.bloqueos.length"
                                class="flex flex-col gap-1 text-xs text-muted"
                            >
                                <li
                                    v-for="(b, indice) in corridas[proceso]?.bloqueos"
                                    :key="indice"
                                    data-prueba="proceso-bloqueo"
                                >
                                    {{ TIPOS_BLOQUEO[b.tipo].etiqueta }}{{ b.hasta ? ` hasta ${formatearFecha(b.hasta)}` : '' }} · fecha {{ formatearFecha(b.fecha) }} · {{ b.documentos }} {{ b.documentos === 1 ? 'documento' : 'documentos' }}<template v-if="nombreEmpresa(b.empresa_id)">
                                        · {{ nombreEmpresa(b.empresa_id) }}
                                    </template><template v-if="b.ejemplos.length">
                                        · ids {{ b.ejemplos.slice(0, 5).join(', ') }}{{ b.ejemplos.length > 5 ? '…' : '' }}
                                    </template>
                                </li>
                            </ul>
                        </template>
                    </div>
                </div>
            </UPageCard>

            <section
                class="flex flex-col gap-3"
                aria-label="Excepciones"
            >
                <div class="flex flex-wrap items-center justify-between gap-2">
                    <h3 class="text-base font-semibold text-highlighted">
                        Excepciones
                    </h3>
                    <USelect
                        v-model="estadoExcepcion"
                        :items="itemsEstado"
                        aria-label="Estado de la excepción"
                        class="w-40"
                    />
                </div>
                <ProblemaAlerta
                    v-if="excepciones.problema.value"
                    :problema="excepciones.problema.value"
                    :reintentar="excepciones.recargar"
                    :reintentando="excepciones.cargando.value"
                />
                <template v-else>
                    <UTable
                        :data="excepciones.filas.value"
                        :columns="columnasExcepcion"
                        :loading="excepciones.cargando.value"
                        data-prueba="tabla-excepciones"
                    >
                        <template #tipo-cell="{ row }">
                            <span class="text-sm">{{ TIPOS_BLOQUEO[row.original.tipo].etiqueta }}</span>
                        </template>
                        <template #usuario_nombre-cell="{ row }">
                            <div class="flex min-w-0 flex-col">
                                <span class="text-xs text-muted sm:hidden">{{ TIPOS_BLOQUEO[row.original.tipo].etiqueta }}</span>
                                <span class="text-sm">{{ row.original.usuario_nombre ?? 'Todos los usuarios' }}</span>
                                <span class="text-xs text-muted">{{ row.original.motivo }}</span>
                                <span
                                    v-if="row.original.estado === 'revocada' && row.original.motivo_revocacion"
                                    class="text-xs text-muted"
                                >Revocada: {{ row.original.motivo_revocacion }}</span>
                            </div>
                        </template>
                        <template #hasta_en-cell="{ row }">
                            <div class="flex flex-col">
                                <span class="text-sm tabular-nums">{{ formatearFechaHora(row.original.hasta_en) }}</span>
                                <span class="text-xs text-muted">{{ row.original.asientos }} {{ row.original.asientos === 1 ? 'asiento' : 'asientos' }}</span>
                            </div>
                        </template>
                        <template #estado-cell="{ row }">
                            <UBadge
                                :label="ESTADOS_EXCEPCION[row.original.estado].etiqueta"
                                :color="ESTADOS_EXCEPCION[row.original.estado].color"
                                variant="subtle"
                                size="sm"
                                data-prueba="excepcion-estado"
                            />
                        </template>
                        <template #acciones-cell="{ row }">
                            <UButton
                                v-if="puede('libro.excepcion_bloqueo') && row.original.estado === 'vigente'"
                                label="Revocar"
                                icon="i-lucide-ban"
                                color="error"
                                variant="ghost"
                                size="xs"
                                :aria-label="`Revocar la excepción ${row.original.id}`"
                                data-prueba="revocar-excepcion"
                                @click="excepcionARevocar = row.original"
                            />
                        </template>
                        <template #empty>
                            <UEmpty
                                icon="i-lucide-key-round"
                                title="Sin excepciones"
                                description="Nadie puede registrar bajo un bloqueo con estos filtros."
                                variant="naked"
                            />
                        </template>
                    </UTable>
                    <PaginacionCursor
                        :pagina="excepciones.pagina.value"
                        :hay-anterior="excepciones.hayAnterior.value"
                        :hay-siguiente="excepciones.haySiguiente.value"
                        :cargando="excepciones.cargando.value"
                        :filas="excepciones.filas.value.length"
                        @anterior="excepciones.anterior"
                        @siguiente="excepciones.siguiente"
                    />
                </template>
            </section>

            <section
                class="flex flex-col gap-3"
                aria-label="Historial de bloqueos"
            >
                <div class="flex flex-wrap items-center justify-between gap-2">
                    <h3 class="text-base font-semibold text-highlighted">
                        Historial
                    </h3>
                    <USelect
                        v-model="tipoHistorial"
                        :items="itemsTipoHistorial"
                        aria-label="Tipo de bloqueo"
                        class="w-44"
                    />
                </div>
                <ProblemaAlerta
                    v-if="historial.problema.value"
                    :problema="historial.problema.value"
                    :reintentar="historial.recargar"
                    :reintentando="historial.cargando.value"
                />
                <template v-else>
                    <UTable
                        :data="historial.filas.value"
                        :columns="columnasHistorial"
                        :loading="historial.cargando.value"
                        data-prueba="tabla-historial-bloqueos"
                    >
                        <template #created_at-cell="{ row }">
                            <div class="flex flex-col">
                                <span class="text-sm tabular-nums">{{ formatearFechaHora(row.original.created_at) }}</span>
                                <span class="text-xs text-muted">{{ row.original.creado_por_nombre ?? 'Sistema' }}</span>
                                <span class="text-xs text-muted sm:hidden">{{ TIPOS_BLOQUEO[row.original.tipo].etiqueta }}</span>
                                <span class="text-xs text-muted sm:hidden">{{ row.original.motivo }}</span>
                            </div>
                        </template>
                        <template #tipo-cell="{ row }">
                            <span class="text-sm">{{ TIPOS_BLOQUEO[row.original.tipo].etiqueta }}</span>
                        </template>
                        <template #hasta-cell="{ row }">
                            <span class="text-sm tabular-nums">{{ row.original.hasta ? formatearFecha(row.original.hasta) : 'Sin bloqueo' }}<span
                                v-if="row.original.anterior"
                                class="text-xs text-muted"
                            > (antes {{ formatearFecha(row.original.anterior) }})</span></span>
                        </template>
                        <template #empty>
                            <UEmpty
                                icon="i-lucide-history"
                                title="Sin cambios de bloqueo"
                                variant="naked"
                            />
                        </template>
                    </UTable>
                    <PaginacionCursor
                        :pagina="historial.pagina.value"
                        :hay-anterior="historial.hayAnterior.value"
                        :hay-siguiente="historial.haySiguiente.value"
                        :cargando="historial.cargando.value"
                        :filas="historial.filas.value.length"
                        @anterior="historial.anterior"
                        @siguiente="historial.siguiente"
                    />
                </template>
            </section>
        </div>

        <template v-if="empresaAccion">
            <BloqueoLibroModal
                v-if="puede('libro.bloquear')"
                v-model:open="bloqueando"
                modo="bloquear"
                :empresa-id="empresaAccion.empresa_id"
                :empresa="nombreEmpresa(empresaAccion.empresa_id)"
                :vigentes="empresaAccion.vigentes"
                :tipo-inicial="tipoAccion"
                @hecho="alCambiar"
            />
            <BloqueoLibroModal
                v-if="puede('libro.desbloquear')"
                v-model:open="desbloqueando"
                modo="desbloquear"
                :empresa-id="empresaAccion.empresa_id"
                :empresa="nombreEmpresa(empresaAccion.empresa_id)"
                :vigentes="empresaAccion.vigentes"
                :tipo-inicial="tipoAccion"
                @hecho="alCambiar"
            />
            <BloqueoDuroModal
                v-if="puede('libro.bloquear_duro')"
                v-model:open="aplicandoDuro"
                :empresa-id="empresaAccion.empresa_id"
                :empresa="nombreEmpresa(empresaAccion.empresa_id)"
                :vigentes="empresaAccion.vigentes"
                @hecho="alCambiar"
            />
            <ExcepcionBloqueoModal
                v-if="puede('libro.excepcion_bloqueo')"
                v-model:open="creandoExcepcion"
                :empresa-id="empresaAccion.empresa_id"
                :empresa="nombreEmpresa(empresaAccion.empresa_id)"
                :vigentes="empresaAccion.vigentes"
                @hecho="alCrearExcepcion"
            />
        </template>
        <AccionMotivoModal
            v-if="puede('libro.excepcion_bloqueo')"
            v-model:open="revocando"
            titulo="Revocar excepción"
            :descripcion="excepcionARevocar ? `${TIPOS_BLOQUEO[excepcionARevocar.tipo].etiqueta} · ${excepcionARevocar.usuario_nombre ?? 'todos los usuarios'}` : undefined"
            efecto="Desde ahora no cubre asientos nuevos. Los que ya entraron por ella quedan como están."
            confirmar="Revocar"
            placeholder="Ej.: ya se registraron las facturas pendientes"
            :ejecutar="revocar"
            @hecho="alRevocar"
        />
        <ConfirmacionModal
            v-if="puede('facturas.generar')"
            v-model:open="confirmandoProceso"
            :titulo="procesoAConfirmar ? PROCESOS_CON_BLOQUEO[procesoAConfirmar].etiqueta : 'Proceso'"
            efecto="Procesa todo lo pendiente hasta hoy, como la corrida automática. Lo que siga bajo un bloqueo queda pendiente y se ve aquí."
            confirmar="Correr ahora"
            icono="i-lucide-play"
            color="primary"
            :ejecutar="correrProceso"
            @hecho="alCorrer"
        />
    </PanelPagina>
</template>
