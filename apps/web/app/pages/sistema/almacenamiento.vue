<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'

definePageMeta({ permiso: 'sistema.ver_almacenamiento' })

useHead({ title: 'Almacenamiento · ArgosIsp' })

/**
 * Qué ocupa espacio (`GET /sistema/almacenamiento`, `contratos/salud.md` §6): discos leídos al
 * momento, y el último cálculo guardado de carpetas por tipo, base de datos y Redis con «calculado
 * hace…» y «Recalcular» (`sistema.recalcular_almacenamiento`). Solo mide: sin borrado.
 */
const { puede } = usePermisos()
const toast = useToast()
const datos = shallowRef<AlmacenamientoSistema | null>(null)
const problema = ref<Problem | null>(null)
const cargando = ref(false)
const recalculando = ref(false)

async function cargar() {
    cargando.value = true
    const resultado = await useSistema().almacenamiento()
    cargando.value = false
    datos.value = resultado.ok ? resultado.data : null
    problema.value = resultado.ok ? null : resultado.problema
}

async function recalcular() {
    recalculando.value = true
    const resultado = await useSistema().recalcularAlmacenamiento()
    recalculando.value = false
    if (resultado.ok) {
        datos.value = datos.value ? { ...datos.value, medicion: resultado.data } : null
        toast.add({ title: 'Almacenamiento recalculado', icon: 'i-lucide-check', color: 'success' })
        return
    }
    toast.add({ title: 'No se pudo recalcular', description: resultado.problema.detail ?? resultado.problema.title, icon: 'i-lucide-circle-alert', color: 'error' })
}

onMounted(cargar)

const ICONOS_CATEGORIA: Record<string, string> = {
    comprobantes: 'i-lucide-file-check-2',
    logos: 'i-lucide-image',
    anuncios: 'i-lucide-megaphone',
    inventario: 'i-lucide-package',
    libros: 'i-lucide-book-marked',
    sorteos: 'i-lucide-ticket',
    respaldos: 'i-lucide-archive',
}

const medicion = computed(() => datos.value?.medicion ?? null)
const mayorCategoria = computed(() => Math.max(1, ...(medicion.value?.categorias.map(c => c.bytes) ?? [1])))
const mayorTabla = computed(() => Math.max(1, ...(medicion.value?.base_datos.tablas_mayores.map(t => t.bytes) ?? [1])))
const totalArchivos = computed(() => medicion.value?.categorias.reduce((suma, c) => suma + c.bytes, 0) ?? 0)

function porcentajeDe(bytes: number, total: number): number {
    return Math.max(2, Math.round((bytes / total) * 100))
}
</script>

<template>
    <ConfiguracionMarco
        id="almacenamiento"
        titulo="Sistema"
        descripcion="Cómo está el servidor: salud, registro de fallos y espacio en disco"
    >
        <template #acciones>
            <UButton
                v-if="puede('sistema.recalcular_almacenamiento')"
                label="Recalcular"
                color="neutral"
                variant="outline"
                :icon="ICONOS.actualizar"
                :loading="recalculando"
                data-prueba="recalcular-almacenamiento"
                @click="recalcular"
            />
        </template>

        <ProblemaAlerta
            v-if="problema"
            :problema="problema"
            :reintentar="cargar"
            :reintentando="cargando"
        />
        <div
            v-else-if="!datos"
            class="grid gap-4 md:grid-cols-2"
        >
            <USkeleton class="h-36 w-full" />
            <USkeleton class="h-36 w-full" />
            <USkeleton class="h-72 w-full md:col-span-2" />
        </div>
        <div
            v-else
            class="flex flex-col gap-6"
        >
            <div class="grid gap-4 md:grid-cols-2">
                <section
                    v-for="volumen in datos.volumenes"
                    :key="volumen.id"
                    class="flex flex-col gap-3 rounded-2xl border border-(--ax-borde) p-4 sm:p-5"
                    :data-volumen="volumen.id"
                >
                    <div class="flex items-center gap-3">
                        <span class="pastilla-icono tono-marca pastilla-tono">
                            <UIcon
                                :name="volumen.id === 'base' ? 'i-lucide-database' : 'i-lucide-hard-drive'"
                                class="size-5"
                            />
                        </span>
                        <h2 class="flex-1 text-sm font-semibold text-highlighted">
                            {{ volumen.nombre }}
                        </h2>
                        <UBadge
                            :label="ESTADOS_SALUD[volumen.estado].etiqueta"
                            :color="ESTADOS_SALUD[volumen.estado].color"
                            :icon="ESTADOS_SALUD[volumen.estado].icono"
                            variant="subtle"
                            size="sm"
                        />
                    </div>
                    <template v-if="volumen.porcentaje_usado !== null">
                        <UProgress
                            :model-value="volumen.porcentaje_usado"
                            size="md"
                            :color="volumen.estado === 'caido' ? 'error' : volumen.estado === 'degradado' ? 'warning' : 'primary'"
                            :aria-label="`${volumen.nombre}: ${volumen.porcentaje_usado} % usado`"
                        />
                        <p class="text-sm tabular-nums">
                            <strong class="text-highlighted">{{ formatearTamanoSistema(volumen.usado_bytes) }}</strong> usados de {{ formatearTamanoSistema(volumen.total_bytes) }} · {{ formatearTamanoSistema(volumen.libre_bytes) }} libres ({{ volumen.porcentaje_usado }} % usado)
                        </p>
                    </template>
                    <p
                        v-else
                        class="text-sm tabular-nums"
                    >
                        <strong class="text-highlighted">{{ formatearTamanoSistema(volumen.usado_bytes) }}</strong> en uso
                    </p>
                    <p
                        v-if="volumen.ruta"
                        class="font-mono text-xs text-muted"
                    >
                        {{ volumen.ruta }}
                    </p>
                    <p
                        v-if="volumen.aviso"
                        class="text-xs text-muted"
                    >
                        {{ volumen.aviso }}
                    </p>
                </section>
            </div>

            <UEmpty
                v-if="!medicion"
                icon="i-lucide-hard-drive"
                title="Todavía no se ha calculado qué ocupa espacio"
                description="El cálculo corre cada noche; también puedes pedirlo ahora."
                :actions="puede('sistema.recalcular_almacenamiento') ? [{ label: 'Recalcular', icon: ICONOS.actualizar, onClick: recalcular }] : undefined"
            />
            <template v-else>
                <section
                    class="flex flex-col gap-4 rounded-2xl border border-(--ax-borde) p-4 sm:p-5"
                    aria-labelledby="titulo-categorias"
                >
                    <div class="flex flex-wrap items-baseline justify-between gap-2">
                        <h2
                            id="titulo-categorias"
                            class="text-sm font-semibold text-highlighted"
                        >
                            Archivos por tipo · {{ formatearTamanoSistema(totalArchivos) }}
                        </h2>
                        <p class="text-xs text-muted">
                            Calculado {{ haceCuanto(medicion.calculado_en) }} ({{ formatearFechaHora(medicion.calculado_en) }}, {{ medicion.origen === 'cron' ? 'cálculo diario' : 'a pedido' }})<template v-if="medicion.parcial">
                                · parcial: algunas carpetas no alcanzaron a medirse
                            </template>
                        </p>
                    </div>
                    <ul class="flex flex-col gap-3">
                        <li
                            v-for="categoria in medicion.categorias"
                            :key="categoria.id"
                            class="grid items-center gap-x-3 gap-y-1 sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)_auto]"
                            :data-categoria="categoria.id"
                        >
                            <span class="flex min-w-0 items-center gap-2 text-sm">
                                <UIcon
                                    :name="ICONOS_CATEGORIA[categoria.id] ?? 'i-lucide-folder'"
                                    class="size-4 shrink-0 text-primary"
                                />
                                <span class="truncate text-highlighted">{{ categoria.nombre }}</span>
                            </span>
                            <span class="h-2 rounded-full bg-(--viz-track)">
                                <span
                                    class="block h-2 rounded-full bg-primary"
                                    :style="{ width: `${porcentajeDe(categoria.bytes, mayorCategoria)}%` }"
                                />
                            </span>
                            <span class="flex flex-wrap items-baseline gap-x-2 text-xs tabular-nums text-muted sm:justify-end">
                                <strong class="text-sm text-highlighted">{{ formatearTamanoSistema(categoria.bytes) }}</strong>
                                {{ categoria.archivos.toLocaleString('es-GT') }} archivos
                                <template v-if="categoria.crecimiento_30d_bytes !== null">· +{{ formatearTamanoSistema(categoria.crecimiento_30d_bytes) }} en 30 días</template>
                            </span>
                            <span
                                v-if="categoria.aviso || categoria.estado !== 'completo'"
                                class="text-xs text-muted sm:col-span-3"
                            >{{ categoria.aviso ?? (categoria.estado === 'parcial' ? 'Medición parcial.' : 'No disponible.') }}</span>
                        </li>
                    </ul>
                </section>

                <div class="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
                    <section
                        class="flex flex-col gap-3 rounded-2xl border border-(--ax-borde) p-4 sm:p-5"
                        aria-labelledby="titulo-tablas"
                    >
                        <h2
                            id="titulo-tablas"
                            class="text-sm font-semibold text-highlighted"
                        >
                            Base de datos · {{ formatearTamanoSistema(medicion.base_datos.tamano_bytes) }}
                        </h2>
                        <p class="text-xs text-muted">
                            Las tablas más grandes:
                        </p>
                        <ul class="flex flex-col gap-2">
                            <li
                                v-for="tabla in medicion.base_datos.tablas_mayores"
                                :key="`${tabla.schema}.${tabla.tabla}`"
                                class="grid grid-cols-[minmax(0,12rem)_minmax(0,1fr)_auto] items-center gap-3 text-sm"
                            >
                                <span class="truncate font-mono text-xs">{{ tabla.schema }}.{{ tabla.tabla }}</span>
                                <span class="h-2 rounded-full bg-(--viz-track)">
                                    <span
                                        class="block h-2 rounded-full bg-primary"
                                        :style="{ width: `${porcentajeDe(tabla.bytes, mayorTabla)}%` }"
                                    />
                                </span>
                                <span class="text-xs font-semibold tabular-nums text-highlighted">{{ formatearTamanoSistema(tabla.bytes) }}</span>
                            </li>
                        </ul>
                        <p
                            v-if="medicion.base_datos.aviso"
                            class="text-xs text-muted"
                        >
                            {{ medicion.base_datos.aviso }}
                        </p>
                    </section>
                    <section
                        class="flex flex-col gap-3 rounded-2xl border border-(--ax-borde) p-4 sm:p-5"
                        aria-labelledby="titulo-redis"
                    >
                        <h2
                            id="titulo-redis"
                            class="text-sm font-semibold text-highlighted"
                        >
                            Redis (memoria)
                        </h2>
                        <dl class="grid grid-cols-2 gap-3">
                            <DatoFicha
                                etiqueta="En uso"
                                :valor="formatearTamanoSistema(medicion.redis.usada_bytes)"
                            />
                            <DatoFicha
                                etiqueta="Pico"
                                :valor="formatearTamanoSistema(medicion.redis.pico_bytes)"
                            />
                            <DatoFicha
                                etiqueta="Máximo permitido"
                                :valor="medicion.redis.maxima_bytes ? formatearTamanoSistema(medicion.redis.maxima_bytes) : 'Sin límite'"
                            />
                        </dl>
                        <p
                            v-if="medicion.redis.aviso"
                            class="text-xs text-muted"
                        >
                            {{ medicion.redis.aviso }}
                        </p>
                    </section>
                </div>
            </template>
        </div>
    </ConfiguracionMarco>
</template>
