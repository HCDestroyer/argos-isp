<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { TabsItem } from '@nuxt/ui'

/**
 * Marco de Inventario (tablero NuevoInventario): los cuatro contadores (valor del inventario, bajo el
 * mínimo, en tránsito y equipos por recuperar) y la tarjeta isla con las pestañas segmentadas
 * Existencias, Equipos, Kardex, Por recuperar y Revisión y garantía. Cada pestaña es su propia ruta
 * (se puede compartir y volver con «Atrás»); el buscador y los filtros de la pestaña van en
 * `#herramientas`, a la derecha de las pestañas, y el contenido en el slot por defecto.
 *
 * Cada contador lee su propio dato: si falla dice «No se pudo leer» con «Reintentar», nunca un cero.
 */
export type PestanaInventario = 'existencias' | 'unidades' | 'kardex' | 'recuperar' | 'taller'

const props = defineProps<{
    pestana: PestanaInventario
}>()

const RUTAS: Record<PestanaInventario, string> = {
    existencias: '/inventario',
    unidades: '/inventario/unidades',
    kardex: '/inventario/kardex',
    recuperar: '/inventario/por-recuperar',
    taller: '/inventario/revision',
}

interface Contador {
    valor: string | null
    detalle: string | undefined
    problema: Problem | null
}

const vacio = (): Contador => ({ valor: null, detalle: undefined, problema: null })
const valor = reactive<Contador>(vacio())
const bajo = reactive<Contador>(vacio())
const transito = reactive<Contador>(vacio())
const recuperar = reactive<Contador>(vacio())
/** Equipos en revisión o garantía (insignia de la pestaña); `null` si no se pudo leer. */
const enTaller = ref<number | null>(null)
const porRecuperarN = ref<number | null>(null)

/** «50» o «50+» cuando la página no trae todo. */
function cuenta(filas: number, siguiente: string | null): string {
    return siguiente ? `${filas}+` : String(filas)
}

async function cargarValor() {
    Object.assign(valor, vacio())
    const r = await useReportesInventario().valorizado({})
    if (!r.ok) {
        valor.problema = r.problema
        return
    }
    const bodegas = new Set(r.data.data.map(f => f.bodega_id)).size
    valor.valor = formatearQuetzales(r.data.total)
    valor.detalle = `en ${bodegas} ${bodegas === 1 ? 'bodega' : 'bodegas'}`
}

async function cargarBajo() {
    Object.assign(bajo, vacio())
    const r = await useInventario().existencias({ bajo_minimo: true, limit: 100 })
    if (!r.ok) {
        bajo.problema = r.problema
        return
    }
    const nombres = [...new Set(r.data.data.map(f => f.producto_nombre))]
    const total = cuenta(nombres.length, r.data.nextCursor)
    bajo.valor = `${total} ${nombres.length === 1 && !r.data.nextCursor ? 'producto' : 'productos'}`
    bajo.detalle = nombres.length ? nombres.slice(0, 2).join(', ') + (nombres.length > 2 ? '…' : '') : 'Todo sobre su mínimo'
}

async function cargarTransito() {
    Object.assign(transito, vacio())
    const r = await useOrdenesTraslado().listar({ estado: 'en_transito', limit: 50 })
    if (!r.ok) {
        transito.problema = r.problema
        return
    }
    const n = r.data.data.length
    transito.valor = `${cuenta(n, r.data.nextCursor)} ${n === 1 && !r.data.nextCursor ? 'traslado' : 'traslados'}`
    const primero = r.data.data[0]
    transito.detalle = primero ? `N.º ${primero.numero} a ${primero.usuario_destino_nombre ?? primero.bodega_destino_nombre}` : 'Nada viajando'
}

async function cargarRecuperar() {
    Object.assign(recuperar, vacio())
    porRecuperarN.value = null
    const r = await useReportesInventario().porRecuperar({ limit: 100 })
    if (!r.ok) {
        recuperar.problema = r.problema
        return
    }
    porRecuperarN.value = r.data.data.length
    recuperar.valor = cuenta(r.data.data.length, r.data.nextCursor)
    recuperar.detalle = 'de servicios retirados'
}

async function cargarTaller() {
    const r = await useUnidadesInventario().listar({ estado: 'en_reparacion', limit: 100 })
    enTaller.value = r.ok ? r.data.data.length : null
}

/** Vuelve a leer los contadores (después de una acción que los cambia). */
function recargar() {
    void cargarValor()
    void cargarBajo()
    void cargarTransito()
    void cargarRecuperar()
    void cargarTaller()
}

defineExpose({ recargar })
onMounted(recargar)

const pestanas = computed<TabsItem[]>(() => [
    { label: 'Existencias', value: 'existencias', icon: 'i-lucide-package' },
    { label: 'Equipos (serie/MAC)', value: 'unidades', icon: 'i-lucide-barcode' },
    { label: 'Kardex', value: 'kardex', icon: 'i-lucide-list-ordered' },
    { label: 'Por recuperar', value: 'recuperar', icon: 'i-lucide-undo-2', badge: porRecuperarN.value ? { label: String(porRecuperarN.value), color: 'warning', variant: 'subtle', size: 'sm' } : undefined },
    { label: 'Revisión y garantía', value: 'taller', icon: 'i-lucide-wrench', badge: enTaller.value ? { label: String(enTaller.value), color: 'warning', variant: 'subtle', size: 'sm' } : undefined },
])

const activa = computed({
    get: () => props.pestana,
    set: (destino: string | number) => {
        const ruta = RUTAS[destino as PestanaInventario]
        if (ruta && destino !== props.pestana) {
            void navigateTo(ruta)
        }
    },
})
</script>

<template>
    <div class="flex min-h-0 flex-1 flex-col gap-4">
        <div
            class="grid grid-cols-2 gap-3 xl:grid-cols-4"
            data-prueba="contadores-inventario"
        >
            <TarjetaDato
                etiqueta="Valor del inventario"
                icono="i-lucide-box"
                tono="tono-marca"
                :valor="valor.valor"
                :detalle="valor.detalle"
                :problema="valor.problema"
                data-contador="valor"
                @reintentar="cargarValor"
            />
            <TarjetaDato
                etiqueta="Bajo el mínimo"
                icono="i-lucide-triangle-alert"
                tono="tono-error"
                :valor="bajo.valor"
                :detalle="bajo.detalle"
                :problema="bajo.problema"
                data-contador="bajo-minimo"
                @reintentar="cargarBajo"
            />
            <TarjetaDato
                etiqueta="En tránsito"
                icono="i-lucide-truck"
                tono="tono-marca"
                :valor="transito.valor"
                :detalle="transito.detalle"
                :problema="transito.problema"
                data-contador="transito"
                @reintentar="cargarTransito"
            />
            <TarjetaDato
                etiqueta="Equipos por recuperar"
                icono="i-lucide-history"
                tono="tono-aviso"
                :valor="recuperar.valor"
                :detalle="recuperar.detalle"
                :problema="recuperar.problema"
                data-contador="por-recuperar"
                @reintentar="cargarRecuperar"
            />
        </div>

        <div class="surface-card flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-2xl">
            <div class="flex flex-col gap-3 border-b border-(--ax-borde) p-3 sm:p-4 xl:flex-row xl:items-center xl:justify-between">
                <UTabs
                    v-model="activa"
                    :items="pestanas"
                    variant="pill"
                    color="neutral"
                    :content="false"
                    class="min-w-0"
                    :ui="{
                        list: 'w-auto max-w-full justify-start self-start overflow-x-auto rounded-xl bg-(--ax-panel) p-1',
                        indicator: 'rounded-lg bg-(--ax-tarjeta) shadow-sm ring ring-(--ax-borde)',
                        trigger: 'shrink-0 grow-0 rounded-lg px-3 text-muted data-[state=active]:text-primary',
                        leadingIcon: 'size-4',
                    }"
                    data-prueba="pestanas-inventario"
                />
                <div
                    v-if="$slots.herramientas"
                    class="flex min-w-0 flex-wrap items-center gap-2"
                >
                    <slot name="herramientas" />
                </div>
            </div>
            <div class="flex min-h-0 flex-1 flex-col overflow-auto">
                <slot />
            </div>
        </div>
    </div>
</template>
