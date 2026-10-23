<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'

/**
 * Sección de una empresa en el comparador de regímenes: la comparación anual (ISR de cada régimen, ISO
 * como piso, diferencia, `m` y `m*`), los bloques de los que sale, la proyección a 12 meses y los
 * supuestos y matices. Es una simulación: no tiene «aplicar»; el cambio de régimen está en
 * Configuración → Fiscal, con su aviso a la SAT.
 */
const props = withDefaults(defineProps<{
    empresa: ComparadorEmpresa
    nombre: string
    reintentar: () => void
    reintentando?: boolean
}>(), {
    reintentando: false,
})

const { puede } = usePermisos()

const bloques = computed(() => props.empresa.bloques)
const comparacion = computed(() => bloques.value.comparacion.datos)

interface FilaRegimen {
    clave: 'opcional_simplificado' | 'utilidades'
    regimen: string
    isr: string
    detalle: string
}

const filas = computed<FilaRegimen[]>(() => {
    const c = comparacion.value
    if (!c) {
        return []
    }
    return [
        { clave: 'opcional_simplificado', regimen: 'Opcional simplificado', isr: c.isr_opcional_anual, detalle: 'Escala del art. 44 sobre las ventas de cada mes' },
        {
            clave: 'utilidades',
            regimen: 'Sobre utilidades',
            isr: c.utilidades_con_iso,
            detalle: c.iso_es_piso
                ? `ISR ${formatearQuetzales(c.isr_utilidades_anual)}; paga el ISO ${formatearQuetzales(c.iso_anual)} como piso`
                : `ISR ${formatearQuetzales(c.isr_utilidades_anual)}; el ISO ${formatearQuetzales(c.iso_anual)} se acredita`,
        },
    ]
})

const columnas: TableColumn<FilaRegimen>[] = [
    { accessorKey: 'regimen', header: 'Régimen' },
    { accessorKey: 'isr', header: 'Impuesto anual estimado', meta: { class: { th: 'text-right', td: 'text-right' } } },
    { accessorKey: 'detalle', header: 'Cómo sale' },
]

interface FilaMes {
    mes: string
    ventas: string
    isr_opcional: string
}

const columnasProyeccion: TableColumn<FilaMes>[] = [
    { accessorKey: 'mes', header: 'Mes' },
    { accessorKey: 'ventas', header: 'Ventas sin IVA', meta: { class: { th: 'text-right', td: 'text-right' } } },
    { accessorKey: 'isr_opcional', header: 'ISR opcional', meta: { class: { th: 'text-right', td: 'text-right' } } },
]

const verMeses = ref(false)
</script>

<template>
    <section
        class="flex flex-col gap-4"
        :data-empresa="empresa.empresa_id"
        :aria-label="`Comparador de regímenes de ${nombre}`"
    >
        <div class="flex flex-wrap items-center gap-2">
            <h2 class="text-base font-semibold text-highlighted">
                {{ nombre }}
            </h2>
            <UBadge
                :color="empresa.regimen ? 'neutral' : 'warning'"
                variant="subtle"
                icon="i-lucide-scale"
                :label="empresa.regimen ? `Hoy: ${etiquetaRegimen(empresa.regimen)}` : 'Régimen sin confirmar'"
                data-prueba="comparador-regimen"
            />
            <span
                v-if="empresa.desde && empresa.hasta"
                class="text-xs text-muted"
            >
                Meses leídos: {{ formatearFecha(empresa.desde) }} al {{ formatearFecha(empresa.hasta) }}
            </span>
        </div>

        <TableroBloque
            nombre="comparacion"
            :titulo="BLOQUES_COMPARADOR.comparacion.titulo"
            :icono="BLOQUES_COMPARADOR.comparacion.icono"
            :etiquetas="ETIQUETAS_BLOQUES_COMPARADOR"
            :bloque="bloques.comparacion"
            :reintentar="reintentar"
            :reintentando="reintentando"
        >
            <div
                v-if="comparacion"
                class="flex flex-col gap-4"
            >
                <UTable
                    :data="filas"
                    :columns="columnas"
                    data-prueba="tabla-regimenes"
                    :ui="{ td: 'whitespace-normal align-top' }"
                >
                    <template #regimen-cell="{ row }">
                        <div
                            class="flex flex-col items-start gap-1"
                            :data-regimen="row.original.clave"
                        >
                            <span class="font-medium text-highlighted">{{ row.original.regimen }}</span>
                            <div class="flex flex-wrap gap-1">
                                <UBadge
                                    v-if="comparacion.regimen_actual === row.original.clave"
                                    color="neutral"
                                    variant="outline"
                                    size="sm"
                                    label="Actual"
                                />
                                <UBadge
                                    v-if="comparacion.menor === row.original.clave"
                                    color="success"
                                    variant="subtle"
                                    size="sm"
                                    icon="i-lucide-arrow-down"
                                    label="Paga menos"
                                    data-prueba="paga-menos"
                                />
                            </div>
                        </div>
                    </template>
                    <template #isr-cell="{ row }">
                        <span class="font-semibold tabular-nums">{{ formatearQuetzales(row.original.isr) }}</span>
                    </template>
                    <template #detalle-cell="{ row }">
                        <span class="text-xs text-muted">{{ row.original.detalle }}</span>
                    </template>
                </UTable>

                <p
                    class="text-sm font-medium"
                    :class="comparacion.menor === 'iguales' ? 'text-highlighted' : 'text-success'"
                    data-prueba="comparador-menor"
                >
                    {{ REGIMEN_MENOR[comparacion.menor] }}<template v-if="comparacion.menor !== 'iguales'">
                        : {{ formatearQuetzales(comparacion.diferencia.replace('-', '')) }} al año
                    </template>
                </p>

                <dl class="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    <DatoFicha etiqueta="Margen fiscal m">
                        <span
                            class="font-semibold tabular-nums"
                            data-prueba="margen-m"
                        >{{ comparacion.margen_fiscal }} %</span>
                    </DatoFicha>
                    <DatoFicha etiqueta="Margen de equilibrio m*">
                        <span
                            class="font-semibold tabular-nums"
                            data-prueba="margen-equilibrio"
                        >{{ comparacion.margen_equilibrio === null ? '—' : `${comparacion.margen_equilibrio} %` }}</span>
                    </DatoFicha>
                    <DatoFicha etiqueta="m* con el 7 % plano">
                        <span class="tabular-nums">{{ comparacion.margen_equilibrio_art46 === null ? '—' : `${comparacion.margen_equilibrio_art46} %` }}</span>
                    </DatoFicha>
                    <DatoFicha etiqueta="Ventas al año">
                        <span class="tabular-nums">{{ formatearQuetzales(comparacion.ventas_anuales) }}</span>
                    </DatoFicha>
                </dl>
                <p class="text-xs text-muted">
                    {{ comparacion.nota }}.<template v-if="comparacion.anualizado">
                        Con {{ comparacion.meses_base }} {{ comparacion.meses_base === 1 ? 'mes leído' : 'meses leídos' }}: anualizado × 12 ÷ {{ comparacion.meses_base }}.
                    </template>
                </p>
                <UAlert
                    color="neutral"
                    variant="outline"
                    icon="i-lucide-info"
                    description="Esta pantalla no cambia el régimen. El cambio se hace en Configuración → Fiscal: rige desde el 1 de enero y se avisa a la SAT en diciembre."
                    :actions="puede('fiscal.ver') ? [{ label: 'Ir a la configuración fiscal', to: '/configuracion/fiscal', color: 'neutral', variant: 'outline', icon: 'i-lucide-arrow-right' }] : undefined"
                    data-prueba="comparador-sin-aplicar"
                />
            </div>
        </TableroBloque>

        <div class="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <TableroBloque
                nombre="datos"
                :titulo="BLOQUES_COMPARADOR.datos.titulo"
                :icono="BLOQUES_COMPARADOR.datos.icono"
                :etiquetas="ETIQUETAS_BLOQUES_COMPARADOR"
                :bloque="bloques.datos"
                :reintentar="reintentar"
                :reintentando="reintentando"
            >
                <div
                    v-if="bloques.datos.datos"
                    class="flex flex-col gap-3"
                >
                    <dl class="grid grid-cols-2 gap-2">
                        <DatoFicha etiqueta="Ventas sin IVA (R)">
                            <span class="tabular-nums">{{ formatearQuetzales(bloques.datos.datos.ventas_sin_iva) }}</span>
                        </DatoFicha>
                        <DatoFicha etiqueta="Promedio mensual">
                            <span class="tabular-nums">{{ formatearQuetzales(bloques.datos.datos.ventas_mensual_promedio) }}</span>
                        </DatoFicha>
                        <DatoFicha etiqueta="Ingresos del libro">
                            <span class="tabular-nums">{{ formatearQuetzales(bloques.datos.datos.ingresos) }}</span>
                        </DatoFicha>
                        <DatoFicha etiqueta="Gastos del libro">
                            <span class="tabular-nums">{{ formatearQuetzales(bloques.datos.datos.gastos) }}</span>
                        </DatoFicha>
                        <DatoFicha etiqueta="No deducibles">
                            <span class="tabular-nums">{{ formatearQuetzales(bloques.datos.datos.no_deducibles) }}</span>
                        </DatoFicha>
                        <DatoFicha etiqueta="Renta fiscal">
                            <span class="tabular-nums">{{ formatearQuetzales(bloques.datos.datos.renta_fiscal) }}</span>
                        </DatoFicha>
                    </dl>
                    <p class="text-xs text-muted">
                        m = renta fiscal ÷ R = {{ bloques.datos.datos.margen_fiscal }} %, con {{ bloques.datos.datos.meses_con_datos }} {{ bloques.datos.datos.meses_con_datos === 1 ? 'mes' : 'meses' }} del libro.
                    </p>
                    <UButton
                        :label="verMeses ? 'Ocultar las ventas por mes' : 'Ver las ventas por mes'"
                        :icon="verMeses ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'"
                        color="neutral"
                        variant="link"
                        size="sm"
                        class="self-start px-0"
                        :aria-expanded="verMeses"
                        @click="verMeses = !verMeses"
                    />
                    <ul
                        v-if="verMeses"
                        class="grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-3"
                        data-prueba="datos-meses"
                    >
                        <li
                            v-for="m in bloques.datos.datos.meses"
                            :key="m.mes"
                            class="flex justify-between gap-2"
                        >
                            <span class="text-muted">{{ mesComparador(m.mes) }}</span>
                            <span class="tabular-nums">{{ formatearQuetzales(m.ventas) }}</span>
                        </li>
                    </ul>
                </div>
            </TableroBloque>

            <TableroBloque
                nombre="opcional"
                :titulo="BLOQUES_COMPARADOR.opcional.titulo"
                :icono="BLOQUES_COMPARADOR.opcional.icono"
                :etiquetas="ETIQUETAS_BLOQUES_COMPARADOR"
                :bloque="bloques.opcional"
                :reintentar="reintentar"
                :reintentando="reintentando"
            >
                <dl
                    v-if="bloques.opcional.datos"
                    class="grid grid-cols-2 gap-2"
                >
                    <DatoFicha etiqueta="ISR con la escala (art. 44)">
                        <span class="tabular-nums">{{ formatearQuetzales(bloques.opcional.datos.isr_escala) }}</span>
                    </DatoFicha>
                    <DatoFicha etiqueta="Tasa efectiva">
                        <span class="tabular-nums">{{ bloques.opcional.datos.tasa_efectiva }} %</span>
                    </DatoFicha>
                    <DatoFicha etiqueta="7 % plano (art. 46)">
                        <span class="tabular-nums">{{ formatearQuetzales(bloques.opcional.datos.isr_plano_art46) }}</span>
                    </DatoFicha>
                </dl>
            </TableroBloque>

            <TableroBloque
                nombre="utilidades"
                :titulo="BLOQUES_COMPARADOR.utilidades.titulo"
                :icono="BLOQUES_COMPARADOR.utilidades.icono"
                :etiquetas="ETIQUETAS_BLOQUES_COMPARADOR"
                :bloque="bloques.utilidades"
                :reintentar="reintentar"
                :reintentando="reintentando"
            >
                <dl
                    v-if="bloques.utilidades.datos"
                    class="grid grid-cols-2 gap-2"
                >
                    <DatoFicha etiqueta="Renta imponible">
                        <span class="tabular-nums">{{ formatearQuetzales(bloques.utilidades.datos.renta_imponible) }}</span>
                    </DatoFicha>
                    <DatoFicha etiqueta="Tasa">
                        <span class="tabular-nums">{{ bloques.utilidades.datos.tasa }} %</span>
                    </DatoFicha>
                    <DatoFicha etiqueta="ISR">
                        <span class="tabular-nums">{{ formatearQuetzales(bloques.utilidades.datos.isr) }}</span>
                    </DatoFicha>
                    <DatoFicha
                        v-if="bloques.utilidades.datos.perdida"
                        etiqueta="Resultado"
                        valor="Pérdida: no paga ISR"
                    />
                </dl>
            </TableroBloque>

            <TableroBloque
                nombre="iso_piso"
                :titulo="BLOQUES_COMPARADOR.iso_piso.titulo"
                :icono="BLOQUES_COMPARADOR.iso_piso.icono"
                :etiquetas="ETIQUETAS_BLOQUES_COMPARADOR"
                :bloque="bloques.iso_piso"
                :reintentar="reintentar"
                :reintentando="reintentando"
            >
                <dl
                    v-if="bloques.iso_piso.datos"
                    class="grid grid-cols-2 gap-2"
                >
                    <DatoFicha etiqueta="Activo neto">
                        <span class="tabular-nums">{{ formatearQuetzales(bloques.iso_piso.datos.activo_neto) }}</span>
                    </DatoFicha>
                    <DatoFicha etiqueta="Ingresos brutos">
                        <span class="tabular-nums">{{ formatearQuetzales(bloques.iso_piso.datos.ingresos_brutos) }}</span>
                    </DatoFicha>
                    <DatoFicha etiqueta="Base (la mayor)">
                        <span class="tabular-nums">{{ formatearQuetzales(bloques.iso_piso.datos.base) }}</span>
                    </DatoFicha>
                    <DatoFicha :etiqueta="`ISO del año (${bloques.iso_piso.datos.tasa} %)`">
                        <span class="tabular-nums">{{ formatearQuetzales(bloques.iso_piso.datos.iso_anual) }}</span>
                    </DatoFicha>
                </dl>
            </TableroBloque>
        </div>

        <TableroBloque
            nombre="proyeccion"
            :titulo="BLOQUES_COMPARADOR.proyeccion.titulo"
            :icono="BLOQUES_COMPARADOR.proyeccion.icono"
            :etiquetas="ETIQUETAS_BLOQUES_COMPARADOR"
            :bloque="bloques.proyeccion"
            :reintentar="reintentar"
            :reintentando="reintentando"
        >
            <div
                v-if="bloques.proyeccion.datos"
                class="flex flex-col gap-3"
            >
                <p
                    class="text-sm text-highlighted"
                    data-prueba="proyeccion-crecimiento"
                >
                    Crecimiento de {{ bloques.proyeccion.datos.crecimiento_mensual }} % mensual
                    ({{ bloques.proyeccion.datos.crecimiento_supuesto === 'usuario' ? 'el que escribiste' : 'la tendencia de los meses leídos' }}) con el mismo margen de {{ bloques.proyeccion.datos.margen_fiscal }} %.
                </p>
                <dl class="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    <DatoFicha etiqueta="Ventas proyectadas">
                        <span class="tabular-nums">{{ formatearQuetzales(bloques.proyeccion.datos.ventas) }}</span>
                    </DatoFicha>
                    <DatoFicha etiqueta="Opcional simplificado">
                        <span
                            class="font-semibold tabular-nums"
                            data-prueba="proyeccion-opcional"
                        >{{ formatearQuetzales(bloques.proyeccion.datos.isr_opcional) }}</span>
                    </DatoFicha>
                    <DatoFicha etiqueta="Sobre utilidades (con ISO)">
                        <span class="font-semibold tabular-nums">{{ formatearQuetzales(bloques.proyeccion.datos.utilidades_con_iso) }}</span>
                    </DatoFicha>
                    <DatoFicha etiqueta="Diferencia">
                        <span class="tabular-nums">{{ formatearQuetzales(bloques.proyeccion.datos.diferencia) }}</span>
                    </DatoFicha>
                </dl>
                <UTable
                    :data="bloques.proyeccion.datos.meses"
                    :columns="columnasProyeccion"
                    data-prueba="tabla-proyeccion"
                >
                    <template #mes-cell="{ row }">
                        {{ mesComparador(row.original.mes) }}
                    </template>
                    <template #ventas-cell="{ row }">
                        <span class="tabular-nums">{{ formatearQuetzales(row.original.ventas) }}</span>
                    </template>
                    <template #isr_opcional-cell="{ row }">
                        <span class="tabular-nums">{{ formatearQuetzales(row.original.isr_opcional) }}</span>
                    </template>
                </UTable>
                <p class="text-xs text-muted">
                    {{ bloques.proyeccion.datos.nota }}. Proyección de referencia: confirmar con contador.
                </p>
            </div>
        </TableroBloque>

        <div class="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <UCard
                :ui="{ header: 'px-4 py-3 sm:px-4', body: 'px-4 py-3 sm:px-4' }"
                data-prueba="comparador-supuestos"
            >
                <template #header>
                    <h3 class="flex items-center gap-2 text-sm font-semibold text-highlighted">
                        <UIcon
                            name="i-lucide-sliders-horizontal"
                            class="size-4 text-muted"
                        />
                        Supuestos
                    </h3>
                </template>
                <ul class="flex flex-col gap-2">
                    <li
                        v-for="s in empresa.supuestos"
                        :key="s.clave"
                        class="flex flex-col gap-0.5"
                        :data-supuesto="s.clave"
                    >
                        <div class="flex flex-wrap items-center gap-2">
                            <span class="text-sm font-medium text-highlighted">{{ SUPUESTOS_COMPARADOR[s.clave] ?? s.clave }}</span>
                            <UBadge
                                v-if="s.confirmar_contador"
                                color="warning"
                                variant="subtle"
                                size="sm"
                                icon="i-lucide-user-check"
                                label="Confirmar con contador"
                            />
                        </div>
                        <span
                            class="text-xs"
                            :class="s.valor === null ? 'text-warning' : 'text-muted'"
                        >
                            {{ valorSupuesto(s.clave, s.valor) }}<template v-if="s.vigente_desde">
                                · desde el {{ formatearFecha(s.vigente_desde) }}
                            </template><template v-if="s.confianza">
                                · confianza {{ s.confianza }}
                            </template>
                        </span>
                    </li>
                </ul>
            </UCard>

            <UCard
                :ui="{ header: 'px-4 py-3 sm:px-4', body: 'px-4 py-3 sm:px-4' }"
                data-prueba="comparador-matices"
            >
                <template #header>
                    <h3 class="flex items-center gap-2 text-sm font-semibold text-highlighted">
                        <UIcon
                            name="i-lucide-message-square-warning"
                            class="size-4 text-muted"
                        />
                        Matices
                    </h3>
                </template>
                <ul class="flex flex-col gap-2">
                    <li
                        v-for="m in empresa.matices"
                        :key="m.clave"
                        class="flex flex-col items-start gap-1 text-sm text-default"
                        :data-matiz="m.clave"
                    >
                        {{ m.texto }}
                        <UBadge
                            v-if="m.confirmar_contador"
                            color="warning"
                            variant="subtle"
                            size="sm"
                            icon="i-lucide-user-check"
                            label="Confirmar con contador"
                        />
                    </li>
                </ul>
            </UCard>
        </div>
    </section>
</template>
