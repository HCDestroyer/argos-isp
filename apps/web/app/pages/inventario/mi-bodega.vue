<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { SelectItem, TableColumn } from '@nuxt/ui'

/**
 * «Mi bodega» del técnico (tablero NuevoMiBodega, pensado para el teléfono; A3 `contratos/inventario.md`
 * D.6, contrato Iris §3.3 y A47): los traslados por recibir arriba, sus equipos, sus materiales y abajo,
 * fijas, «Devolver a central» y «Pedir material». Con bodega de cuadrilla dice su jefe. Sus existencias
 * (con la modalidad), sus equipos por serie, las órdenes que vienen hacia él («Recibir y firmar») y
 * su kardex (los últimos 50; «Ver más» sigue con `GET /inventario/movimientos?bodega_id=` y cursor).
 * Con alcance global se elige el técnico; sin bodega: 404 `tecnico_sin_bodega`, visible.
 */
definePageMeta({ permiso: 'inventario.ver' })

useHead({ title: 'Mi bodega · ArgosIsp' })

const { puede } = usePermisos()
const toast = useToast()
const usuario = useUsuarioActual()
const alcanceGlobal = computed(() => usuario.value?.alcance_global === true)

/* Técnico consultado (solo con alcance global) */
const tecnicos = shallowRef<TecnicoInventario[]>([])
const problemaTecnicos = ref<Problem | null>(null)
const tecnicoId = ref<number | undefined>(undefined)
const itemsTecnico = computed<SelectItem[]>(() => tecnicos.value.map(t => ({ label: t.nombre, value: Number(t.id_externo), description: t.correo })))

async function cargarTecnicos() {
    const resultado = await useTecnicosInventario().listar()
    tecnicos.value = resultado.ok ? resultado.data.data : []
    problemaTecnicos.value = resultado.ok ? null : resultado.problema
}

/* La bodega */
const datos = shallowRef<MiBodegaInventario | null>(null)
const problema = ref<Problem | null>(null)
const cargando = ref(false)
const empresaElegida = ref<number | undefined>(undefined)

async function cargar() {
    cargando.value = true
    const resultado = await useTecnicosInventario().miBodega({
        ...(tecnicoId.value ? { usuario_id: tecnicoId.value } : {}),
        ...(empresaElegida.value ? { empresa_id: empresaElegida.value } : {}),
    })
    cargando.value = false
    datos.value = resultado.ok ? resultado.data : null
    problema.value = resultado.ok ? null : resultado.problema
    kardexExtra.value = []
    hayMasKardex.value = (resultado.ok ? resultado.data.kardex?.length ?? 0 : 0) >= 50
}

const route = useRoute()
onMounted(() => {
    if (alcanceGlobal.value) {
        void cargarTecnicos()
    }
    const pedido = Number(route.query.tecnico)
    if (alcanceGlobal.value && Number.isInteger(pedido) && pedido > 0) {
        // `?tecnico=<usuario_id>`: la bodega de ese técnico (el watch la carga).
        tecnicoId.value = pedido
        return
    }
    void cargar()
})
watch(tecnicoId, () => {
    empresaElegida.value = undefined
    void cargar()
})

const sinBodega = computed(() => problema.value?.status === 404 && codigoProblema(problema.value) === 'tecnico_sin_bodega')
const bodega = computed(() => datos.value?.bodega ?? null)
const variasEmpresas = computed(() => (datos.value?.bodegas?.length ?? 0) > 1 && !datos.value?.bodega)
function nombreEmpresa(id: number): string {
    return usuario.value?.empresas.find(e => e.id === id)?.nombre_comercial ?? `Empresa ${id}`
}

/* Kardex: los 50 de la respuesta y «Ver más» por cursor */
const kardexExtra = shallowRef<MovimientoInventario[]>([])
const hayMasKardex = ref(false)
const cargandoKardex = ref(false)
const problemaKardex = ref<Problem | null>(null)
const kardex = computed(() => [...(datos.value?.kardex ?? []), ...kardexExtra.value])

/**
 * `GET /inventario/movimientos` viene del más antiguo al más reciente; «Ver más» pide las páginas
 * y se queda con lo anterior al último movimiento mostrado.
 */
async function verMasKardex() {
    if (!bodega.value) {
        return
    }
    cargandoKardex.value = true
    problemaKardex.value = null
    const ultimo = kardex.value.at(-1)
    const todos: MovimientoInventario[] = []
    let cursor: string | undefined
    do {
        const resultado = await useInventario().kardex({ bodega_id: bodega.value.id, limit: 100 }, cursor)
        if (!resultado.ok) {
            problemaKardex.value = resultado.problema
            cargandoKardex.value = false
            return
        }
        todos.push(...resultado.data.data)
        cursor = resultado.data.nextCursor ?? undefined
    } while (cursor)
    cargandoKardex.value = false
    const vistos = new Set(kardex.value.map(m => m.id))
    const anteriores = todos
        .filter(m => !vistos.has(m.id) && (!ultimo || m.fecha < ultimo.fecha || (m.fecha === ultimo.fecha && m.id < ultimo.id)))
        .sort((a, b) => b.fecha.localeCompare(a.fecha) || b.id - a.id)
    kardexExtra.value = [...kardexExtra.value, ...anteriores.slice(0, 50)]
    hayMasKardex.value = anteriores.length > 50
}

/* Recibir y firmar */
const ordenARecibir = shallowRef<OrdenTrasladoDetalle | null>(null)
const recibirAbierto = ref(false)
const abriendo = ref<number | null>(null)

async function recibir(orden: OrdenTraslado) {
    abriendo.value = orden.id
    const resultado = await useOrdenesTraslado().ver(orden.id)
    abriendo.value = null
    if (!resultado.ok) {
        toast.add({ title: 'No se pudo abrir la orden', description: resultado.problema.detail ?? resultado.problema.title, icon: 'i-lucide-circle-alert', color: 'error' })
        return
    }
    ordenARecibir.value = resultado.data
    recibirAbierto.value = true
}

function alRecibir(orden: OrdenTrasladoDetalle) {
    toast.add({ title: `Orden N.º ${orden.numero} ${ESTADOS_ORDEN_TRASLADO[orden.estado].etiqueta.toLowerCase()}`, icon: 'i-lucide-package-check', color: orden.estado === 'recibida' ? 'success' : 'warning' })
    void cargar()
}

/* Equipos y materiales */
const buscarAbierto = ref(false)
const busqueda = ref('')
const todosLosEquipos = ref(false)
const kardexAbierto = ref(false)

const equipos = computed(() => {
    const q = busqueda.value.trim().toUpperCase().replace(/[^0-9A-Z]/g, '')
    return (datos.value?.unidades ?? []).filter(u => !q || [u.serie, u.mac].some(v => v?.toUpperCase().replace(/[^0-9A-Z]/g, '').includes(q)))
})
const equiposVisibles = computed(() => (todosLosEquipos.value || busqueda.value ? equipos.value : equipos.value.slice(0, 3)))
/** Los materiales: lo que se lleva por cantidad (los equipos por serie van arriba, uno por uno). */
const materiales = computed(() => {
    const porSerie = new Set((datos.value?.unidades ?? []).map(u => u.producto_id))
    return (datos.value?.existencias ?? []).filter(e => !porSerie.has(e.producto_id) && e.modalidad !== 'comodato')
})

function elegirEmpresa(id: number) {
    empresaElegida.value = id
    void cargar()
}
const columnasKardex: TableColumn<MovimientoInventario>[] = [
    { accessorKey: 'fecha', header: 'Fecha' },
    { accessorKey: 'producto_nombre', header: 'Movimiento', meta: { class: { td: 'whitespace-normal' } } },
    { accessorKey: 'cantidad', header: 'Cantidad', meta: { class: { th: 'text-right', td: 'text-right' } } },
    { accessorKey: 'saldo_cantidad', header: 'Saldo', meta: { class: { th: 'text-right hidden sm:table-cell', td: 'text-right hidden sm:table-cell' } } },
]
</script>

<template>
    <PanelPagina
        id="inventario-mi-bodega"
        titulo="Mi bodega"
        icono="i-lucide-hard-hat"
        encabezado-propio
    >
        <div class="mx-auto flex w-full max-w-3xl flex-col gap-3 pb-24">
            <div class="flex items-center gap-3">
                <AvatarIniciales
                    :nombre="bodega?.usuario_nombre ?? usuario?.nombre ?? 'Mi bodega'"
                    class="size-11"
                />
                <div class="flex min-w-0 flex-1 flex-col">
                    <h1 class="flex items-center gap-1 text-lg font-bold text-highlighted">
                        Mi bodega
                        <AyudaBoton solo-icono />
                    </h1>
                    <span
                        v-if="bodega"
                        class="truncate text-xs text-muted"
                        data-prueba="mi-bodega-nombre"
                    >{{ [bodega.usuario_nombre, bodega.nombre].filter(Boolean).join(' · ') }}{{ datos?.cuadrilla && datos.jefe ? ` · cuadrilla, jefe ${datos.jefe.nombre}` : '' }}</span>
                </div>
                <UButton
                    v-if="bodega"
                    icon="i-lucide-scan-barcode"
                    color="neutral"
                    variant="outline"
                    class="boton-flotante boton-circulo"
                    :aria-pressed="buscarAbierto"
                    aria-label="Buscar un equipo por serie o MAC"
                    @click="buscarAbierto = !buscarAbierto"
                />
            </div>

            <div
                v-if="alcanceGlobal"
                class="flex flex-col gap-2 sm:flex-row sm:items-center"
            >
                <USelectMenu
                    v-model="tecnicoId"
                    :items="itemsTecnico"
                    value-key="value"
                    placeholder="Ver la bodega de un técnico"
                    class="w-full sm:w-80"
                    aria-label="Técnico"
                    data-prueba="mi-bodega-tecnico"
                />
                <ProblemaAlerta
                    v-if="problemaTecnicos"
                    :problema="problemaTecnicos"
                    :reintentar="cargarTecnicos"
                />
            </div>

            <UEmpty
                v-if="sinBodega"
                icon="i-lucide-hard-hat"
                :title="tecnicoId ? 'Ese técnico no tiene bodega en esta empresa' : 'No tienes una bodega de técnico'"
                :description="alcanceGlobal ? 'Elige un técnico arriba para ver su bodega, o crea su bodega en Inventario → Bodegas.' : 'Pide a un encargado que cree tu bodega de técnico.'"
                data-prueba="mi-bodega-sin-bodega"
            />
            <ProblemaAlerta
                v-else-if="problema"
                :problema="problema"
                :reintentar="cargar"
                :reintentando="cargando"
            />
            <div
                v-else-if="!datos"
                class="flex flex-col gap-3"
            >
                <USkeleton class="h-20 w-full rounded-2xl" />
                <USkeleton class="h-48 w-full rounded-2xl" />
            </div>
            <div
                v-else-if="variasEmpresas"
                class="surface-card flex flex-col gap-3 rounded-2xl p-4"
                data-prueba="mi-bodega-empresas"
            >
                <p class="text-sm text-muted">
                    Hay bodegas en varias empresas. Elige una:
                </p>
                <div class="flex flex-wrap gap-2">
                    <UButton
                        v-for="b in datos.bodegas ?? []"
                        :key="b.id"
                        :label="`${b.nombre} · ${nombreEmpresa(b.empresa_id)}`"
                        icon="i-lucide-warehouse"
                        color="neutral"
                        variant="outline"
                        class="rounded-full"
                        @click="elegirEmpresa(b.empresa_id)"
                    />
                </div>
            </div>
            <template v-else-if="bodega">
                <div
                    v-if="buscarAbierto"
                    class="flex flex-col gap-1"
                >
                    <UInput
                        v-model="busqueda"
                        icon="i-lucide-search"
                        placeholder="Escanea o escribe la serie o MAC"
                        aria-label="Buscar un equipo de mi bodega por serie o MAC"
                        autofocus
                        class="w-full"
                        :ui="{ base: 'rounded-full' }"
                    />
                </div>

                <div
                    class="flex flex-col gap-2"
                    data-prueba="mi-bodega-por-recibir"
                >
                    <div
                        v-for="orden in datos.traslados_pendientes ?? []"
                        :key="orden.id"
                        class="flex items-center gap-3 rounded-2xl border border-info/40 bg-info/5 p-3"
                        :data-orden-pendiente="orden.numero"
                    >
                        <span class="pastilla-icono pastilla-tono tono-2 size-10 shrink-0 rounded-xl">
                            <UIcon
                                name="i-lucide-truck"
                                class="size-5"
                            />
                        </span>
                        <div class="flex min-w-0 flex-1 flex-col">
                            <span class="font-semibold text-highlighted">Traslado T-{{ String(orden.numero).padStart(4, '0') }} por recibir</span>
                            <span class="truncate text-xs text-info">{{ orden.lineas_total }} {{ orden.lineas_total === 1 ? 'producto' : 'productos' }} desde {{ nombreCortoBodega(orden.bodega_origen_nombre) }}</span>
                        </div>
                        <UButton
                            v-if="puede('inventario.recibir_traslado')"
                            label="Recibir"
                            icon="i-lucide-package-check"
                            class="glow-brand rounded-full"
                            :loading="abriendo === orden.id"
                            data-prueba="mi-bodega-recibir"
                            @click="recibir(orden)"
                        />
                    </div>
                </div>

                <section class="surface-card overflow-hidden rounded-2xl">
                    <h2 class="border-b border-(--ax-borde) px-4 py-2.5 text-xs font-bold uppercase tracking-wide text-muted">
                        Equipos ({{ equipos.length }})
                    </h2>
                    <UEmpty
                        v-if="!equipos.length"
                        icon="i-lucide-barcode"
                        :title="busqueda ? 'Ningún equipo con esa serie o MAC' : 'Sin equipos'"
                        variant="naked"
                        class="py-6"
                    />
                    <ul
                        v-else
                        class="divide-y divide-(--ax-borde)"
                        data-prueba="mi-bodega-unidades"
                    >
                        <li
                            v-for="u in equiposVisibles"
                            :key="u.id"
                            class="flex items-center gap-3 px-4 py-2.5"
                        >
                            <span class="pastilla-icono pastilla-tono tono-marca size-8 shrink-0 rounded-lg">
                                <UIcon
                                    name="i-lucide-barcode"
                                    class="size-4"
                                />
                            </span>
                            <div class="flex min-w-0 flex-1 flex-col">
                                <span class="truncate font-semibold text-highlighted">{{ u.producto_nombre }}</span>
                                <span class="truncate font-mono text-xs text-muted">{{ identificacionUnidad(u) }}</span>
                            </div>
                            <UBadge
                                v-if="estadoEquipoDe(u) !== 'disponible'"
                                :label="ESTADOS_EQUIPO[estadoEquipoDe(u)].etiqueta"
                                :icon="ESTADOS_EQUIPO[estadoEquipoDe(u)].icono"
                                :color="ESTADOS_EQUIPO[estadoEquipoDe(u)].color"
                                variant="subtle"
                                size="sm"
                                class="rounded-full"
                            />
                        </li>
                    </ul>
                    <UButton
                        v-if="equipos.length > 3 && !todosLosEquipos"
                        :label="`Ver los ${equipos.length}`"
                        color="primary"
                        variant="link"
                        class="px-4 pb-3"
                        @click="todosLosEquipos = true"
                    />
                </section>

                <section class="surface-card overflow-hidden rounded-2xl">
                    <h2 class="border-b border-(--ax-borde) px-4 py-2.5 text-xs font-bold uppercase tracking-wide text-muted">
                        Materiales
                    </h2>
                    <UEmpty
                        v-if="!materiales.length"
                        icon="i-lucide-package"
                        title="Sin materiales"
                        variant="naked"
                        class="py-6"
                    />
                    <ul
                        v-else
                        class="divide-y divide-(--ax-borde)"
                        data-prueba="mi-bodega-existencias"
                    >
                        <li
                            v-for="e in materiales"
                            :key="e.producto_id"
                            class="flex items-center gap-3 px-4 py-3"
                            :data-existencia="e.producto_sku"
                        >
                            <span class="pastilla-icono pastilla-tono tono-marca size-8 shrink-0 rounded-lg">
                                <UIcon
                                    name="i-lucide-package"
                                    class="size-4"
                                />
                            </span>
                            <div class="flex min-w-0 flex-1 flex-col">
                                <span class="truncate font-semibold text-highlighted">{{ e.producto_nombre }}</span>
                                <span
                                    v-if="e.modalidad"
                                    class="text-xs text-muted"
                                >{{ MODALIDADES[e.modalidad].etiqueta }}</span>
                            </div>
                            <span
                                class="text-lg font-bold tabular-nums"
                                :class="e.bajo_minimo ? 'text-error' : 'text-highlighted'"
                            >{{ formatearCantidad(e.cantidad) }}<span class="ms-1 text-xs font-normal text-muted">{{ e.unidad }}</span></span>
                        </li>
                    </ul>
                </section>

                <section class="surface-card overflow-hidden rounded-2xl">
                    <UCollapsible v-model:open="kardexAbierto">
                        <UButton
                            :label="`Movimientos recientes (${kardex.length})`"
                            color="neutral"
                            variant="ghost"
                            block
                            :trailing-icon="kardexAbierto ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'"
                            class="justify-between rounded-none px-4 py-2.5 text-xs font-bold uppercase tracking-wide text-muted"
                        />
                        <template #content>
                            <UTable
                                :data="kardex"
                                :columns="columnasKardex"
                                :ui="{ thead: 'bg-(--ax-cabecera-tabla)', th: 'text-xs', td: 'py-2.5' }"
                                data-prueba="mi-bodega-kardex"
                            >
                                <template #fecha-cell="{ row }">
                                    <span class="whitespace-nowrap text-sm text-muted">{{ formatearFechaCorta(row.original.fecha) }}</span>
                                </template>
                                <template #producto_nombre-cell="{ row }">
                                    <div class="flex flex-col">
                                        <span class="text-sm text-highlighted">{{ TIPOS_MOVIMIENTO_INVENTARIO[row.original.tipo] }} · {{ row.original.producto_nombre }}</span>
                                        <span
                                            v-if="row.original.motivo"
                                            class="text-xs text-muted"
                                        >{{ row.original.motivo }}</span>
                                    </div>
                                </template>
                                <template #cantidad-cell="{ row }">
                                    <span
                                        class="text-sm font-semibold tabular-nums"
                                        :class="row.original.cantidad.startsWith('-') ? 'text-error' : 'text-success'"
                                    >{{ row.original.cantidad.startsWith('-') ? '' : '+' }}{{ formatearCantidad(row.original.cantidad) }}</span>
                                </template>
                                <template #saldo_cantidad-cell="{ row }">
                                    <span class="text-sm tabular-nums text-muted">{{ formatearCantidad(row.original.saldo_cantidad) }}</span>
                                </template>
                                <template #empty>
                                    <UEmpty
                                        icon="i-lucide-list-ordered"
                                        title="Sin movimientos"
                                        variant="naked"
                                    />
                                </template>
                            </UTable>
                            <div class="flex flex-col gap-2 p-3">
                                <ProblemaAlerta
                                    v-if="problemaKardex"
                                    :problema="problemaKardex"
                                    :reintentar="verMasKardex"
                                    :reintentando="cargandoKardex"
                                />
                                <UButton
                                    v-if="hayMasKardex"
                                    label="Ver más"
                                    icon="i-lucide-chevrons-down"
                                    color="neutral"
                                    variant="outline"
                                    class="self-center rounded-full"
                                    :loading="cargandoKardex"
                                    data-prueba="mi-bodega-ver-mas"
                                    @click="verMasKardex"
                                />
                            </div>
                        </template>
                    </UCollapsible>
                </section>

                <PanelBarraAccion class="lg:mt-2">
                    <UButton
                        v-if="puede('inventario.crear_traslado')"
                        label="Devolver a central"
                        icon="i-lucide-undo-2"
                        color="neutral"
                        variant="outline"
                        size="lg"
                        block
                        class="flex-1 justify-center rounded-full"
                        :to="`/inventario/traslados/nueva?origen=${bodega.id}`"
                        data-prueba="mi-bodega-devolver"
                    />
                    <UButton
                        label="Pedir material"
                        icon="i-lucide-package-plus"
                        size="lg"
                        block
                        disabled
                        class="flex-1 justify-center rounded-full"
                        title="Pedir material todavía no está en la API (anotado para A3); por ahora pídelo a la bodega central"
                        data-prueba="mi-bodega-pedir"
                    />
                </PanelBarraAccion>
            </template>
        </div>

        <TrasladoRecibirSlideover
            v-if="ordenARecibir"
            v-model:open="recibirAbierto"
            :orden="ordenARecibir"
            @recibida="alRecibir"
        />
    </PanelPagina>
</template>
