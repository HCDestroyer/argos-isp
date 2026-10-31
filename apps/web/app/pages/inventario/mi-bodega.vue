<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { SelectItem, TableColumn } from '@nuxt/ui'

/**
 * «Mi bodega» del técnico (A3, `contratos/inventario.md` D.6 y contrato Iris §3.3): sus existencias
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

onMounted(() => {
    void cargar()
    if (alcanceGlobal.value) {
        void cargarTecnicos()
    }
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

const columnasExistencias: TableColumn<ExistenciaInventario>[] = [
    { accessorKey: 'producto_nombre', header: 'Producto', meta: { class: { td: 'whitespace-normal' } } },
    { accessorKey: 'modalidad', header: 'Modalidad', meta: SOLO_ANCHO },
    { accessorKey: 'cantidad', header: 'Cantidad', meta: { class: { th: 'text-right', td: 'text-right' } } },
    { accessorKey: 'valor', header: 'Valor', meta: { class: { th: 'text-right hidden lg:table-cell', td: 'text-right hidden lg:table-cell' } } },
]
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
    >
        <div class="mx-auto flex w-full max-w-5xl flex-col gap-5">
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
                <USkeleton class="h-20 w-full" />
                <USkeleton class="h-48 w-full" />
            </div>
            <UCard
                v-else-if="variasEmpresas"
                data-prueba="mi-bodega-empresas"
            >
                <div class="flex flex-col gap-3">
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
                            @click="empresaElegida = b.empresa_id; cargar()"
                        />
                    </div>
                </div>
            </UCard>
            <template v-else-if="bodega">
                <div class="flex flex-wrap items-center gap-2">
                    <UIcon
                        :name="TIPOS_BODEGA[bodega.tipo].icono"
                        class="size-5 text-muted"
                    />
                    <span
                        class="text-base font-semibold text-highlighted"
                        data-prueba="mi-bodega-nombre"
                    >{{ bodega.nombre }}</span>
                    <span
                        v-if="bodega.usuario_nombre"
                        class="text-sm text-muted"
                    >· {{ bodega.usuario_nombre }}</span>
                </div>

                <UCard
                    :ui="{ body: 'p-0 sm:p-0' }"
                    data-prueba="mi-bodega-por-recibir"
                >
                    <template #header>
                        <div class="flex items-center justify-between gap-2">
                            <h2 class="text-sm font-semibold text-highlighted">
                                Por recibir
                            </h2>
                            <UBadge
                                :label="String(datos.traslados_pendientes?.length ?? 0)"
                                color="info"
                                variant="subtle"
                                size="sm"
                            />
                        </div>
                    </template>
                    <UEmpty
                        v-if="!datos.traslados_pendientes?.length"
                        icon="i-lucide-truck"
                        title="Nada en camino"
                        description="Cuando te envíen una orden de traslado aparece aquí para recibirla y firmarla."
                        variant="naked"
                    />
                    <ul
                        v-else
                        class="divide-y divide-default"
                    >
                        <li
                            v-for="orden in datos.traslados_pendientes"
                            :key="orden.id"
                            class="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-6"
                            :data-por-recibir="orden.numero"
                        >
                            <div class="flex min-w-0 flex-col">
                                <ULink
                                    :to="`/inventario/traslados/${orden.id}`"
                                    class="text-sm font-medium text-highlighted hover:text-primary"
                                >Orden N.º {{ orden.numero }}</ULink>
                                <span class="text-xs text-muted">Desde {{ orden.bodega_origen_nombre }} · {{ formatearFechaHora(orden.enviado_en) }} · {{ orden.lineas_total }} {{ orden.lineas_total === 1 ? 'línea' : 'líneas' }}</span>
                            </div>
                            <UButton
                                v-if="puede('inventario.recibir_traslado')"
                                label="Recibir y firmar"
                                icon="i-lucide-signature"
                                class="justify-center"
                                :loading="abriendo === orden.id"
                                data-prueba="mi-bodega-recibir"
                                @click="recibir(orden)"
                            />
                        </li>
                    </ul>
                </UCard>

                <UCard :ui="{ body: 'p-0 sm:p-0' }">
                    <template #header>
                        <h2 class="text-sm font-semibold text-highlighted">
                            Existencias
                        </h2>
                    </template>
                    <UTable
                        :data="datos.existencias ?? []"
                        :columns="columnasExistencias"
                        :ui="{ td: 'py-3' }"
                        data-prueba="mi-bodega-existencias"
                    >
                        <template #producto_nombre-cell="{ row }">
                            <div class="flex min-w-0 flex-col gap-0.5">
                                <span class="text-sm font-medium text-highlighted">{{ row.original.producto_nombre }}</span>
                                <span class="font-mono text-xs text-muted">{{ row.original.producto_sku }}</span>
                                <ModalidadBadge
                                    v-if="row.original.modalidad"
                                    :modalidad="row.original.modalidad"
                                    class="self-start sm:hidden"
                                />
                            </div>
                        </template>
                        <template #modalidad-cell="{ row }">
                            <ModalidadBadge
                                v-if="row.original.modalidad"
                                :modalidad="row.original.modalidad"
                            />
                        </template>
                        <template #cantidad-cell="{ row }">
                            <span class="text-sm tabular-nums">{{ formatearCantidad(row.original.cantidad, row.original.unidad) }}</span>
                        </template>
                        <template #valor-cell="{ row }">
                            <span class="text-sm tabular-nums">{{ formatearQuetzales(row.original.valor) }}</span>
                        </template>
                        <template #empty>
                            <UEmpty
                                icon="i-lucide-package"
                                title="Sin existencias"
                                variant="naked"
                            />
                        </template>
                    </UTable>
                </UCard>

                <UCard>
                    <template #header>
                        <h2 class="text-sm font-semibold text-highlighted">
                            Equipos por serie
                        </h2>
                    </template>
                    <UEmpty
                        v-if="!datos.unidades?.length"
                        icon="i-lucide-barcode"
                        title="Sin equipos"
                        variant="naked"
                    />
                    <ul
                        v-else
                        class="grid gap-2 sm:grid-cols-2"
                        data-prueba="mi-bodega-unidades"
                    >
                        <li
                            v-for="u in datos.unidades"
                            :key="u.id"
                            class="flex flex-col gap-1 rounded-md border border-default p-3"
                        >
                            <span class="text-sm font-medium text-highlighted">{{ u.producto_nombre }}</span>
                            <span class="font-mono text-xs text-muted">{{ identificacionUnidad(u) }}</span>
                            <UBadge
                                :label="ESTADOS_UNIDAD[u.estado].etiqueta"
                                :color="ESTADOS_UNIDAD[u.estado].color"
                                :icon="ESTADOS_UNIDAD[u.estado].icono"
                                variant="subtle"
                                size="sm"
                                class="self-start"
                            />
                        </li>
                    </ul>
                </UCard>

                <UCard :ui="{ body: 'p-0 sm:p-0' }">
                    <template #header>
                        <h2 class="text-sm font-semibold text-highlighted">
                            Kardex
                        </h2>
                    </template>
                    <UTable
                        :data="kardex"
                        :columns="columnasKardex"
                        :ui="{ td: 'py-3' }"
                        data-prueba="mi-bodega-kardex"
                    >
                        <template #fecha-cell="{ row }">
                            <span class="text-sm">{{ formatearFecha(row.original.fecha) }}</span>
                        </template>
                        <template #producto_nombre-cell="{ row }">
                            <div class="flex min-w-0 flex-col gap-0.5">
                                <span class="text-sm text-highlighted">{{ row.original.producto_nombre }}</span>
                                <span class="text-xs text-muted">{{ TIPOS_MOVIMIENTO_INVENTARIO[row.original.tipo] }}{{ row.original.motivo ? ` · ${row.original.motivo}` : '' }}</span>
                            </div>
                        </template>
                        <template #cantidad-cell="{ row }">
                            <span
                                class="text-sm tabular-nums"
                                :class="row.original.cantidad.startsWith('-') ? 'text-error' : 'text-success'"
                            >{{ formatearCantidad(row.original.cantidad) }}</span>
                        </template>
                        <template #saldo_cantidad-cell="{ row }">
                            <span class="text-sm tabular-nums">{{ formatearCantidad(row.original.saldo_cantidad) }}</span>
                        </template>
                        <template #empty>
                            <UEmpty
                                icon="i-lucide-list-ordered"
                                title="Sin movimientos"
                                variant="naked"
                            />
                        </template>
                    </UTable>
                    <template #footer>
                        <div class="flex flex-col gap-2">
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
                                class="self-center"
                                :loading="cargandoKardex"
                                data-prueba="mi-bodega-ver-mas"
                                @click="verMasKardex"
                            />
                        </div>
                    </template>
                </UCard>
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
