<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { TableColumn } from '@nuxt/ui'

/**
 * Balance de saldos (`GET /libro/balance?hasta=`) o estado de resultados
 * (`GET /libro/estado-resultados?desde=&hasta=`), de A3. Cada empresa (NIT) tiene su libro: una
 * sección por empresa y, con varias (consolidado), el total del grupo arriba. Los totales y el
 * "cuadra" vienen de la API; la pantalla no suma nada.
 */
const props = defineProps<{
    tipo: 'balance' | 'resultados'
}>()

type Seccion = BalanceSaldos['empresas'][number] | EstadoResultados['empresas'][number]
type Linea = BalanceSaldos['total']['cuentas'][number]
type TotalesBalance = BalanceSaldos['total']['totales']

const FECHA = /^\d{4}-\d{2}-\d{2}$/

const hasta = ref('')
const desde = ref('')
const datos = shallowRef<BalanceSaldos | EstadoResultados | null>(null)
const problema = ref<Problem | null>(null)
const cargando = ref(false)

async function cargar() {
    cargando.value = true
    const fin = FECHA.test(hasta.value) ? hasta.value : undefined
    const resultado = props.tipo === 'balance'
        ? await useLibro().balance(fin)
        : await useLibro().estadoResultados(FECHA.test(desde.value) ? desde.value : undefined, fin)
    cargando.value = false
    datos.value = resultado.ok ? resultado.data : null
    problema.value = resultado.ok ? null : resultado.problema
}

watch([desde, hasta], cargar)
onMounted(cargar)

const secciones = computed<Seccion[]>(() => datos.value?.empresas ?? [])
const variasEmpresas = computed(() => secciones.value.length > 1)

function esBalance(totales: Seccion['totales']): totales is TotalesBalance {
    return 'cuadra' in totales
}

const columnas: TableColumn<Linea>[] = [
    { accessorKey: 'codigo', header: 'Cuenta' },
    { accessorKey: 'debe', header: 'Debe', meta: { class: { th: 'hidden text-right sm:table-cell', td: 'hidden text-right sm:table-cell' } } },
    { accessorKey: 'haber', header: 'Haber', meta: { class: { th: 'hidden text-right sm:table-cell', td: 'hidden text-right sm:table-cell' } } },
    { accessorKey: 'saldo', header: 'Saldo', meta: { class: { th: 'text-right', td: 'text-right' } } },
]

const titulo = computed(() => (props.tipo === 'balance' ? 'Balance de saldos' : 'Estado de resultados'))
const rango = computed(() => {
    if (!datos.value) {
        return ''
    }
    return 'desde' in datos.value
        ? `Del ${formatearFecha(datos.value.desde)} al ${formatearFecha(datos.value.hasta)}`
        : `Al ${formatearFecha(datos.value.hasta)}`
})
</script>

<template>
    <div
        class="flex flex-col gap-4"
        :data-prueba="`libro-${tipo}`"
    >
        <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <UInput
                v-if="tipo === 'resultados'"
                v-model="desde"
                type="date"
                :max="hasta || undefined"
                aria-label="Desde"
                class="w-full"
            />
            <UInput
                v-model="hasta"
                type="date"
                :min="desde || undefined"
                :aria-label="tipo === 'balance' ? 'Saldos al' : 'Hasta'"
                class="w-full"
            />
            <p class="self-center text-xs text-muted sm:col-span-2">
                {{ tipo === 'balance' ? 'Sin fecha, saldos a hoy.' : 'Sin fechas, el mes en curso.' }} Fechas contables (día de Guatemala).
            </p>
        </div>

        <ProblemaAlerta
            v-if="problema"
            :problema="problema"
            :reintentar="cargar"
            :reintentando="cargando"
        />
        <div
            v-else-if="!datos"
            class="flex flex-col gap-3"
        >
            <USkeleton class="h-24 w-full" />
            <USkeleton class="h-48 w-full" />
        </div>
        <UEmpty
            v-else-if="!secciones.length"
            icon="i-lucide-book-x"
            :title="`${titulo} sin movimientos`"
            :description="rango"
        />
        <template v-else>
            <p class="text-sm text-muted">
                {{ titulo }} · {{ rango }}<template v-if="datos.consolidado">
                    · consolidado del grupo
                </template>
            </p>

            <section
                v-if="variasEmpresas"
                class="surface-card flex flex-col gap-3 p-4"
                aria-label="Total del grupo"
                data-prueba="total-grupo"
            >
                <h3 class="font-semibold text-highlighted">
                    Total del grupo
                </h3>
                <dl class="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    <template v-if="esBalance(datos.total.totales)">
                        <DatoFicha
                            etiqueta="Activo"
                            :valor="formatearQuetzales(datos.total.totales.activo)"
                        />
                        <DatoFicha
                            etiqueta="Pasivo"
                            :valor="formatearQuetzales(datos.total.totales.pasivo)"
                        />
                    </template>
                    <DatoFicha
                        etiqueta="Ingresos"
                        :valor="formatearQuetzales(datos.total.totales.ingresos)"
                    />
                    <DatoFicha
                        etiqueta="Gastos"
                        :valor="formatearQuetzales(datos.total.totales.gastos)"
                    />
                    <DatoFicha
                        etiqueta="Resultado"
                        :valor="formatearQuetzales(datos.total.totales.resultado)"
                    />
                </dl>
                <p class="text-xs text-muted">
                    Suma de los libros de cada empresa; cada NIT declara solo el suyo.
                </p>
            </section>

            <section
                v-for="seccion in secciones"
                :key="seccion.empresa_id ?? 0"
                class="surface-card flex flex-col gap-3 p-4"
                :aria-label="`${titulo} de ${seccion.nombre_comercial ?? 'la empresa'}`"
                :data-empresa="seccion.empresa_id"
            >
                <div class="flex flex-wrap items-center justify-between gap-2">
                    <div>
                        <h3 class="font-semibold text-highlighted">
                            {{ seccion.nombre_comercial ?? `Empresa ${seccion.empresa_id}` }}
                        </h3>
                        <p class="text-xs text-muted">
                            NIT <span class="font-mono">{{ seccion.nit ?? '—' }}</span>
                        </p>
                    </div>
                    <UBadge
                        v-if="esBalance(seccion.totales)"
                        :label="seccion.totales.cuadra ? 'Cuadra' : 'No cuadra'"
                        :icon="seccion.totales.cuadra ? 'i-lucide-circle-check' : 'i-lucide-octagon-alert'"
                        :color="seccion.totales.cuadra ? 'success' : 'error'"
                        variant="subtle"
                        data-prueba="cuadra"
                    />
                </div>

                <div
                    class="overflow-x-auto"
                    tabindex="0"
                    :aria-label="`Cuentas de ${seccion.nombre_comercial ?? 'la empresa'}`"
                >
                    <UTable
                        :data="seccion.cuentas"
                        :columns="columnas"
                        :ui="{ td: 'py-2' }"
                    >
                        <template #codigo-cell="{ row }">
                            <div class="flex flex-col">
                                <span class="text-sm">{{ row.original.nombre }}</span>
                                <span class="font-mono text-xs text-muted">{{ row.original.codigo }}</span>
                            </div>
                        </template>
                        <template #debe-cell="{ row }">
                            <span class="tabular-nums">{{ formatearQuetzales(row.original.debe) }}</span>
                        </template>
                        <template #haber-cell="{ row }">
                            <span class="tabular-nums">{{ formatearQuetzales(row.original.haber) }}</span>
                        </template>
                        <template #saldo-cell="{ row }">
                            <span class="font-medium tabular-nums">{{ formatearQuetzales(row.original.saldo) }}</span>
                        </template>
                        <template #empty>
                            <UEmpty
                                icon="i-lucide-list"
                                title="Sin movimientos"
                                variant="naked"
                            />
                        </template>
                    </UTable>
                </div>

                <dl class="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    <template v-if="esBalance(seccion.totales)">
                        <DatoFicha
                            etiqueta="Activo"
                            :valor="formatearQuetzales(seccion.totales.activo)"
                        />
                        <DatoFicha
                            etiqueta="Pasivo"
                            :valor="formatearQuetzales(seccion.totales.pasivo)"
                        />
                    </template>
                    <DatoFicha
                        etiqueta="Ingresos"
                        :valor="formatearQuetzales(seccion.totales.ingresos)"
                    />
                    <DatoFicha
                        etiqueta="Gastos"
                        :valor="formatearQuetzales(seccion.totales.gastos)"
                    />
                    <DatoFicha
                        etiqueta="Resultado"
                        :valor="formatearQuetzales(seccion.totales.resultado)"
                        data-prueba="resultado"
                    />
                </dl>
            </section>
        </template>
    </div>
</template>
