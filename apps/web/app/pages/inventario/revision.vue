<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import Decimal from 'decimal.js'

/**
 * Inventario · Revisión y garantía (tablero NuevoInventario, A48): tres columnas. «En revisión», los
 * equipos que volvieron de un cambio o de un retiro y se prueban en bodega antes de decidir
 * (funciona y vuelve a bodega, se envía a garantía o se da de baja); «En garantía», los que tiene el
 * proveedor con su RMA y vencimiento (volvió reparada, cambiada por otra o rechazada); y los «Dados
 * de baja» del mes con su gasto. Un equipo dañado o en garantía nunca vuelve como «funciona» sin que
 * alguien lo pruebe. Cada botón con su permiso.
 */
definePageMeta({ permiso: 'inventario.ver' })

useHead({ title: 'Revisión y garantía · Inventario · ArgosIsp' })

const { puede } = usePermisos()

const busqueda = ref('')
const marco = useTemplateRef<{ recargar: () => void }>('marco')
const accionesRef = useTemplateRef<{ ejecutar: (accion: AccionEquipo, unidad: UnidadInventario, extra?: { resultado?: 'reparada' | 'reemplazada' | 'rechazada' }) => void }>('acciones')

const enTaller = shallowRef<UnidadInventarioDetalle[]>([])
const problemaTaller = ref<Problem | null>(null)
const cargandoTaller = ref(false)
const bajas = shallowRef<MovimientoInventario[]>([])
const series = shallowRef<Map<number, UnidadInventario>>(new Map())
const problemaBajas = ref<Problem | null>(null)
const cargandoBajas = ref(false)

const inicioMes = () => {
    const hoy = new Date()
    return `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}-01`
}

/** Los equipos en revisión o garantía, con su detalle (de dónde vinieron y la garantía abierta). */
async function cargarTaller() {
    cargandoTaller.value = true
    problemaTaller.value = null
    const r = await useUnidadesInventario().listar({ estado: 'en_reparacion', limit: 100 })
    if (!r.ok) {
        cargandoTaller.value = false
        problemaTaller.value = r.problema
        enTaller.value = []
        return
    }
    const detalles = await Promise.all(r.data.data.map(u => useUnidadesInventario().ver(u.id)))
    cargandoTaller.value = false
    const fallo = detalles.find(d => !d.ok)
    if (fallo && !fallo.ok) {
        problemaTaller.value = fallo.problema
        enTaller.value = []
        return
    }
    enTaller.value = detalles.flatMap(d => (d.ok ? [d.data] : []))
}

async function cargarBajas() {
    cargandoBajas.value = true
    problemaBajas.value = null
    const [k, u] = await Promise.all([
        useInventario().kardex({ tipo: 'baja', desde: inicioMes(), limit: 100 }),
        useUnidadesInventario().listar({ estado: 'dada_de_baja', limit: 100 }),
    ])
    cargandoBajas.value = false
    if (!k.ok) {
        problemaBajas.value = k.problema
        bajas.value = []
        return
    }
    bajas.value = k.data.data.filter(m => m.unidad_id !== null)
    series.value = new Map((u.ok ? u.data.data : []).map(x => [x.id, x]))
}

function recargar() {
    void cargarTaller()
    void cargarBajas()
    marco.value?.recargar()
}

onMounted(() => {
    void cargarTaller()
    void cargarBajas()
})

const q = computed(() => busqueda.value.trim().toLowerCase())
const coincide = (u: { producto_nombre: string, serie?: string | null, mac?: string | null }) => !q.value || [u.producto_nombre, u.serie, u.mac].some(v => v?.toLowerCase().includes(q.value))

const enRevision = computed(() => enTaller.value.filter(u => estadoEquipoDe(u) === 'revision' && coincide(u)))
const enGarantia = computed(() => enTaller.value.filter(u => estadoEquipoDe(u) === 'garantia' && coincide(u)))
const bajasVisibles = computed(() => bajas.value.filter(m => coincide({ producto_nombre: m.producto_nombre, serie: series.value.get(m.unidad_id ?? 0)?.serie, mac: series.value.get(m.unidad_id ?? 0)?.mac })))
const totalBajas = computed(() => bajas.value.reduce((t, m) => t.plus(new Decimal(m.costo_total).abs()), new Decimal(0)))

/** De dónde vino el equipo: el último cambio a revisión («Cambio en servicio #201 · wifi intermitente»). */
function origen(u: UnidadInventarioDetalle): string {
    const ultimo = [...u.historial_estados].reverse().find(c => c.a === 'revision')
    if (!ultimo) {
        return 'En revisión en su bodega'
    }
    const de = ultimo.de === 'en_comodato' || ultimo.de === 'por_recuperar' ? 'Devuelto' : 'Volvió'
    const detalle = (ultimo.motivo ?? '').split(' · ').slice(1).join(' · ')
    return [ultimo.servicio_id ? `${de} del servicio #${ultimo.servicio_id}` : de, detalle ? `«${detalle}»` : motivoEnPalabras(ultimo.motivo), formatearFechaCorta(ultimo.fecha)].filter(Boolean).join(' · ')
}

function garantiaDe(u: UnidadInventarioDetalle): string {
    const g = u.garantias.find(x => x.resuelta_en === null)
    if (!g) {
        return 'Garantía abierta'
    }
    return [g.proveedor_nombre ? `Con ${g.proveedor_nombre}` : null, g.rma ? `RMA ${g.rma}` : null, g.enviada_en ? `enviada ${formatearFechaCorta(g.enviada_en)}` : 'sin enviar', g.vence_en ? `vence ${formatearFechaCorta(g.vence_en)}` : null].filter(Boolean).join(' · ')
}

function garantiaSinEnviar(u: UnidadInventarioDetalle): boolean {
    return u.garantias.some(g => g.resuelta_en === null && g.enviada_en === null)
}

function bajaDe(m: MovimientoInventario): string {
    return [m.causa ? CAUSAS_BAJA[m.causa] : null, m.motivo, formatearFechaCorta(m.fecha), formatearQuetzales(new Decimal(m.costo_total).abs().toFixed(2))].filter(Boolean).join(' · ')
}

const ejecutar = (accion: AccionEquipo, u: UnidadInventario, resultado?: 'reparada' | 'reemplazada' | 'rechazada') => accionesRef.value?.ejecutar(accion, u, { resultado })
</script>

<template>
    <PanelPagina
        id="inventario-revision"
        titulo="Inventario"
        icono="i-lucide-wrench"
        sin-descripcion
    >
        <template #acciones>
            <InventarioAcciones @hecho="recargar" />
        </template>

        <InventarioMarco
            ref="marco"
            pestana="taller"
        >
            <template #herramientas>
                <UInput
                    v-model="busqueda"
                    icon="i-lucide-search"
                    placeholder="Producto, serie o MAC"
                    aria-label="Buscar equipo por producto, serie o MAC"
                    class="w-full sm:w-72"
                    :ui="{ base: 'rounded-full' }"
                />
            </template>

            <div class="grid gap-4 p-3 sm:p-4 lg:grid-cols-3">
                <!-- En revisión -->
                <section
                    class="flex min-w-0 flex-col gap-2.5"
                    data-prueba="columna-revision"
                >
                    <h2 class="flex items-center gap-2 font-semibold text-highlighted">
                        <span class="pastilla-icono pastilla-tono tono-marca size-8 rounded-lg">
                            <UIcon
                                name="i-lucide-wrench"
                                class="size-4"
                            />
                        </span>
                        En revisión
                        <span class="text-sm font-normal text-muted">{{ enRevision.length }}</span>
                    </h2>
                    <ProblemaAlerta
                        v-if="problemaTaller"
                        :problema="problemaTaller"
                        :reintentar="cargarTaller"
                        :reintentando="cargandoTaller"
                    />
                    <USkeleton
                        v-else-if="cargandoTaller && !enTaller.length"
                        class="h-24 w-full rounded-2xl"
                    />
                    <template v-else>
                        <article
                            v-for="u in enRevision"
                            :key="u.id"
                            class="flex flex-col gap-1 rounded-2xl border border-(--ax-borde) p-3"
                            :data-taller="u.serie ?? u.mac ?? u.id"
                        >
                            <span class="font-semibold text-highlighted">{{ u.producto_nombre }}</span>
                            <span class="font-mono text-xs text-muted">{{ identificacionUnidad(u) }}</span>
                            <span class="text-sm">{{ origen(u) }}</span>
                            <div class="flex flex-wrap gap-1.5 pt-1.5">
                                <UButton
                                    v-if="puede('inventario.marcar_reparada')"
                                    label="Funciona: a bodega"
                                    color="neutral"
                                    variant="outline"
                                    size="xs"
                                    class="rounded-full"
                                    @click="ejecutar('funciona', u)"
                                />
                                <UButton
                                    v-if="puede('inventario.enviar_garantia') && !garantiaSinEnviar(u)"
                                    label="Enviar a garantía"
                                    color="neutral"
                                    variant="outline"
                                    size="xs"
                                    class="rounded-full"
                                    data-prueba="enviar-garantia"
                                    @click="ejecutar('garantia', u)"
                                />
                                <UButton
                                    v-if="puede('inventario.enviar_garantia') && garantiaSinEnviar(u)"
                                    label="Enviar al proveedor"
                                    color="primary"
                                    variant="soft"
                                    size="xs"
                                    class="rounded-full"
                                    @click="ejecutar('garantia', u)"
                                />
                                <UButton
                                    v-if="puede('inventario.dar_de_baja')"
                                    label="Dar de baja"
                                    color="error"
                                    variant="outline"
                                    size="xs"
                                    class="rounded-full"
                                    @click="ejecutar('baja', u)"
                                />
                            </div>
                        </article>
                        <p
                            v-if="!enRevision.length"
                            class="rounded-2xl border border-dashed border-(--ax-borde) p-3 text-sm text-muted"
                        >
                            Nada en revisión.
                        </p>
                    </template>
                </section>

                <!-- En garantía -->
                <section
                    class="flex min-w-0 flex-col gap-2.5"
                    data-prueba="columna-garantia"
                >
                    <h2 class="flex items-center gap-2 font-semibold text-highlighted">
                        <span class="pastilla-icono pastilla-tono tono-4 size-8 rounded-lg">
                            <UIcon
                                name="i-lucide-truck"
                                class="size-4"
                            />
                        </span>
                        En garantía
                        <span class="text-sm font-normal text-muted">{{ enGarantia.length }}</span>
                    </h2>
                    <USkeleton
                        v-if="cargandoTaller && !enTaller.length && !problemaTaller"
                        class="h-24 w-full rounded-2xl"
                    />
                    <template v-else-if="!problemaTaller">
                        <article
                            v-for="u in enGarantia"
                            :key="u.id"
                            class="flex flex-col gap-1 rounded-2xl border border-(--ax-borde) p-3"
                            :data-taller="u.serie ?? u.mac ?? u.id"
                        >
                            <span class="font-semibold text-highlighted">{{ u.producto_nombre }}</span>
                            <span class="font-mono text-xs text-muted">{{ identificacionUnidad(u) }}</span>
                            <span class="text-sm">{{ garantiaDe(u) }}</span>
                            <div
                                v-if="puede('inventario.resolver_garantia')"
                                class="flex flex-wrap gap-1.5 pt-1.5"
                            >
                                <UButton
                                    label="Volvió reparada"
                                    color="neutral"
                                    variant="outline"
                                    size="xs"
                                    class="rounded-full"
                                    data-prueba="garantia-reparada"
                                    @click="ejecutar('resolver', u, 'reparada')"
                                />
                                <UButton
                                    label="Cambiada por otra"
                                    color="neutral"
                                    variant="outline"
                                    size="xs"
                                    class="rounded-full"
                                    @click="ejecutar('resolver', u, 'reemplazada')"
                                />
                                <UButton
                                    label="Rechazada"
                                    color="error"
                                    variant="outline"
                                    size="xs"
                                    class="rounded-full"
                                    @click="ejecutar('resolver', u, 'rechazada')"
                                />
                            </div>
                        </article>
                        <p
                            v-if="!enGarantia.length"
                            class="rounded-2xl border border-dashed border-(--ax-borde) p-3 text-sm text-muted"
                        >
                            Nada en garantía.
                        </p>
                    </template>
                </section>

                <!-- Dados de baja -->
                <section
                    class="flex min-w-0 flex-col gap-2.5"
                    data-prueba="columna-bajas"
                >
                    <h2 class="flex flex-wrap items-center gap-2 font-semibold text-highlighted">
                        <span class="pastilla-icono pastilla-tono tono-error size-8 rounded-lg">
                            <UIcon
                                name="i-lucide-triangle-alert"
                                class="size-4"
                            />
                        </span>
                        Dados de baja
                        <span
                            v-if="!problemaBajas && !cargandoBajas"
                            class="text-sm font-normal text-muted"
                        >este mes · {{ formatearQuetzales(totalBajas.toFixed(2)) }}</span>
                    </h2>
                    <ProblemaAlerta
                        v-if="problemaBajas"
                        :problema="problemaBajas"
                        :reintentar="cargarBajas"
                        :reintentando="cargandoBajas"
                    />
                    <USkeleton
                        v-else-if="cargandoBajas && !bajas.length"
                        class="h-24 w-full rounded-2xl"
                    />
                    <template v-else>
                        <article
                            v-for="m in bajasVisibles"
                            :key="m.id"
                            class="flex flex-col gap-1 rounded-2xl border border-(--ax-borde) p-3"
                        >
                            <span class="font-semibold text-highlighted">{{ m.producto_nombre }}</span>
                            <span
                                v-if="series.get(m.unidad_id ?? 0)"
                                class="font-mono text-xs text-muted"
                            >{{ identificacionUnidad(series.get(m.unidad_id ?? 0)!) }}</span>
                            <span class="text-sm">{{ bajaDe(m) }}</span>
                            <UBadge
                                label="Gasto 5.6.02"
                                color="neutral"
                                variant="soft"
                                size="sm"
                                class="mt-1 self-start rounded-full"
                            />
                        </article>
                        <p
                            v-if="!bajasVisibles.length"
                            class="rounded-2xl border border-dashed border-(--ax-borde) p-3 text-sm text-muted"
                        >
                            Ningún equipo dado de baja este mes.
                        </p>
                    </template>
                </section>
            </div>
        </InventarioMarco>

        <EquipoAcciones
            ref="acciones"
            @hecho="recargar"
        />
    </PanelPagina>
</template>
