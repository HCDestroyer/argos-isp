<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { TableColumn } from '@nuxt/ui'

/**
 * Diarios y numeración guardada (A3, fase 2; contrato §10.7), solo lectura (`libro.ver`):
 * `GET /libro/diarios` (consolidable) con su tipo, cuenta por defecto y el último número de cada
 * año; el detalle (`GET /libro/diarios/:id`) en un panel lateral. Cada asiento lleva su diario y
 * número, que nunca cambia; la partida del Libro Diario se asigna al cerrar el mes.
 */
const { empresas, empresaId } = useEmpresaActiva()

const TIPOS_DIARIO: Record<Diario['tipo'], string> = {
    ventas: 'Ventas',
    cobros: 'Cobros',
    caja: 'Caja',
    banco: 'Banco',
    compras: 'Compras y egresos',
    impuestos: 'Impuestos',
    cierre: 'Cierre',
    varios: 'Varios',
}

const diarios = shallowRef<Diario[]>([])
const cargando = ref(false)
const problema = ref<Problem | null>(null)

const consolidado = computed(() => empresaId.value === null && empresas.value.length > 1)

const columnas = computed<TableColumn<Diario>[]>(() => [
    { accessorKey: 'codigo', header: 'Diario' },
    { accessorKey: 'tipo', header: 'Tipo', meta: SOLO_ANCHO },
    ...(consolidado.value ? [{ id: 'empresa', header: 'Empresa', meta: SOLO_ESCRITORIO }] : []),
    { accessorKey: 'cuenta_por_defecto_codigo', header: 'Cuenta por defecto', meta: SOLO_ESCRITORIO },
    { id: 'numeracion', header: 'Último número', meta: { class: { th: 'text-right', td: 'text-right' } } },
    { accessorKey: 'activo', header: 'Estado', meta: SOLO_ANCHO },
])

async function cargar() {
    cargando.value = true
    problema.value = null
    const resultado = await useLibro().diarios()
    cargando.value = false
    diarios.value = resultado.ok ? [...resultado.data].sort((a, b) => a.empresa_id - b.empresa_id || a.codigo.localeCompare(b.codigo)) : []
    problema.value = resultado.ok ? null : resultado.problema
}

/** El último número del año más reciente con numeración, o `null` si el diario aún no tiene asientos. */
function ultimo(diario: Diario): { anio: number, ultimo: number } | null {
    return [...diario.secuencias].sort((a, b) => b.anio - a.anio)[0] ?? null
}

function nombreEmpresa(id: number): string {
    return empresas.value.find(e => e.id === id)?.nombre_comercial ?? `Empresa ${id}`
}

/* Detalle en un panel lateral. */
const detalle = shallowRef<Diario | null>(null)
const abierto = ref(false)
const cargandoDetalle = ref(false)
const problemaDetalle = ref<Problem | null>(null)
let elegido = 0

async function abrir(id: number) {
    elegido = id
    abierto.value = true
    detalle.value = null
    cargandoDetalle.value = true
    problemaDetalle.value = null
    const resultado = await useLibro().verDiario(id)
    cargandoDetalle.value = false
    detalle.value = resultado.ok ? resultado.data : null
    problemaDetalle.value = resultado.ok ? null : resultado.problema
}

onMounted(cargar)
</script>

<template>
    <div class="flex flex-col gap-4">
        <p class="text-sm text-muted">
            Cada asiento recibe al registrarse el siguiente número de su diario en el año, y ese número nunca cambia. La partida del Libro Diario se asigna al cerrar el mes.
        </p>
        <ProblemaAlerta
            v-if="problema"
            :problema="problema"
            :reintentar="cargar"
            :reintentando="cargando"
            data-prueba="diarios-error"
        />
        <UTable
            v-else
            :data="diarios"
            :columns="columnas"
            :loading="cargando"
            data-prueba="tabla-diarios"
        >
            <template #codigo-cell="{ row }">
                <div class="flex flex-col">
                    <UButton
                        :label="row.original.codigo"
                        variant="link"
                        color="neutral"
                        class="self-start p-0 font-mono font-medium text-highlighted"
                        :data-prueba="`diario-${row.original.codigo}`"
                        @click="abrir(row.original.id)"
                    />
                    <span class="text-xs text-muted">{{ row.original.nombre }}</span>
                </div>
            </template>
            <template #tipo-cell="{ row }">
                <span class="text-sm">{{ TIPOS_DIARIO[row.original.tipo] }}</span>
            </template>
            <template #empresa-cell="{ row }">
                <span class="text-sm">{{ nombreEmpresa(row.original.empresa_id) }}</span>
            </template>
            <template #cuenta_por_defecto_codigo-cell="{ row }">
                <span class="font-mono text-sm">{{ row.original.cuenta_por_defecto_codigo ?? '—' }}</span>
            </template>
            <template #numeracion-cell="{ row }">
                <span
                    v-if="ultimo(row.original)"
                    class="font-mono text-sm tabular-nums"
                >{{ ultimo(row.original)?.anio }} · {{ ultimo(row.original)?.ultimo }}</span>
                <span
                    v-else
                    class="text-xs text-muted"
                >Sin asientos</span>
            </template>
            <template #activo-cell="{ row }">
                <UBadge
                    :label="row.original.activo ? 'Activo' : 'Inactivo'"
                    :color="row.original.activo ? 'success' : 'neutral'"
                    variant="subtle"
                    size="sm"
                />
            </template>
            <template #empty>
                <UEmpty
                    icon="i-lucide-book-open"
                    title="Sin diarios"
                    variant="naked"
                />
            </template>
        </UTable>

        <USlideover
            v-model:open="abierto"
            :title="detalle ? `${detalle.codigo} · ${detalle.nombre}` : 'Diario'"
            :description="detalle ? `${TIPOS_DIARIO[detalle.tipo]} · ${nombreEmpresa(detalle.empresa_id)}` : undefined"
        >
            <template #body>
                <ProblemaAlerta
                    v-if="problemaDetalle"
                    :problema="problemaDetalle"
                    :reintentar="() => void abrir(elegido)"
                    :reintentando="cargandoDetalle"
                />
                <USkeleton
                    v-else-if="cargandoDetalle"
                    class="h-40 w-full"
                />
                <div
                    v-else-if="detalle"
                    class="flex flex-col gap-4"
                    data-prueba="diario-detalle"
                >
                    <dl class="grid grid-cols-2 gap-x-6 gap-y-3">
                        <DatoFicha
                            etiqueta="Cuenta por defecto"
                            :valor="detalle.cuenta_por_defecto_codigo"
                            mono
                        />
                        <DatoFicha
                            etiqueta="Estado"
                            :valor="detalle.activo ? 'Activo' : 'Inactivo'"
                        />
                        <DatoFicha
                            v-if="detalle.caja_id"
                            etiqueta="Caja"
                            :valor="`Caja #${detalle.caja_id}`"
                        />
                        <DatoFicha
                            v-if="detalle.cuenta_bancaria_id"
                            etiqueta="Cuenta bancaria"
                            :valor="`Cuenta #${detalle.cuenta_bancaria_id}`"
                        />
                    </dl>
                    <section class="flex flex-col gap-2">
                        <h3 class="text-sm font-semibold text-highlighted">
                            Numeración por año
                        </h3>
                        <ul
                            v-if="detalle.secuencias.length"
                            class="flex flex-col divide-y divide-default rounded-lg border border-default"
                        >
                            <li
                                v-for="secuencia in [...detalle.secuencias].sort((a, b) => b.anio - a.anio)"
                                :key="secuencia.anio"
                                class="flex items-center justify-between px-3 py-2 text-sm"
                            >
                                <span>{{ secuencia.anio }}</span>
                                <span class="font-mono tabular-nums">último {{ secuencia.ultimo }} · siguiente {{ secuencia.ultimo + 1 }}</span>
                            </li>
                        </ul>
                        <p
                            v-else
                            class="text-sm text-muted"
                        >
                            Este diario todavía no tiene asientos.
                        </p>
                    </section>
                </div>
            </template>
        </USlideover>
    </div>
</template>
