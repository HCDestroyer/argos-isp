<script setup lang="ts">
definePageMeta({ permiso: 'reportes.ver' })

useHead({ title: 'Reportes · ArgosIsp' })

/**
 * Catálogo de reportes (tablero ContaReportes): categorías a la izquierda, la lista con su buscador
 * en medio y, a la derecha, los envíos programados y las descargas recientes. Cada reporte respeta
 * la empresa activa y se descarga con los mismos filtros.
 * - «Rentabilidad» (ganancia por zona, plan y router) no se muestra: decisión 5 del PM, más adelante.
 * - Favoritos, envíos programados (decisión 6) y descargas recientes esperan la API de A3
 *   (`agente/a3-reportes-pm`); se dice qué falta, sin listas inventadas.
 */
const { puede } = usePermisos()

type Categoria = 'cobranza' | 'ingresos' | 'caja' | 'contabilidad' | 'fiscal'

interface EntradaCatalogo {
    clave: string
    titulo: string
    descripcion: string
    icono: string
    to: string
    categoria: Categoria
    permiso?: string
}

const CATEGORIAS: { id: Categoria | 'todos' | 'favoritos', etiqueta: string, icono: string }[] = [
    { id: 'favoritos', etiqueta: 'Favoritos', icono: 'i-lucide-star' },
    { id: 'todos', etiqueta: 'Todos', icono: 'i-lucide-layout-grid' },
    { id: 'cobranza', etiqueta: 'Cobranza y cartera', icono: 'i-lucide-hand-coins' },
    { id: 'ingresos', etiqueta: 'Ingresos y clientes', icono: 'i-lucide-trending-up' },
    { id: 'caja', etiqueta: 'Caja y bancos', icono: 'i-lucide-landmark' },
    { id: 'contabilidad', etiqueta: 'Contabilidad', icono: 'i-lucide-book-open' },
    { id: 'fiscal', etiqueta: 'Fiscal', icono: 'i-lucide-receipt' },
]

const ETIQUETA_CATEGORIA = Object.fromEntries(CATEGORIAS.map(c => [c.id, c.etiqueta])) as Record<Categoria, string>

const CATEGORIA_REPORTE: Record<ClaveReporte, Categoria> = {
    'cartera-vencida': 'cobranza',
    'facturado-vs-cobrado': 'cobranza',
    'cobranza-diaria': 'cobranza',
    'promesas': 'cobranza',
    'ingresos': 'ingresos',
    'altas-bajas': 'ingresos',
    'bonificaciones': 'ingresos',
    'cierres-caja': 'caja',
    'egresos': 'contabilidad',
    'cuentas-por-pagar': 'contabilidad',
    'iva': 'fiscal',
}

const entradas = computed<EntradaCatalogo[]>(() => [
    ...CLAVES_REPORTE.map(clave => ({ clave, ...REPORTES[clave], to: `/reportes/${clave}`, categoria: CATEGORIA_REPORTE[clave] ?? 'contabilidad' })),
    { clave: 'lealtad', titulo: 'Lealtad', descripcion: 'Puntos emitidos, canjeados y vencidos, y lo que se debe en puntos contra 2.1.10.', icono: 'i-lucide-gem', to: '/reportes/lealtad', categoria: 'ingresos' as const },
    { clave: 'balance', titulo: 'Balance general', descripcion: 'Lo que tiene, lo que debe y el capital de cada empresa a una fecha.', icono: 'i-lucide-scale', to: '/reportes/balance', categoria: 'contabilidad' as const, permiso: 'libro.ver' },
    { clave: 'resultados', titulo: 'Estado de resultados', descripcion: 'Ingresos, gastos y la ganancia o pérdida de un periodo.', icono: 'i-lucide-trending-up', to: '/reportes/resultados', categoria: 'contabilidad' as const, permiso: 'libro.ver' },
    { clave: 'libros-legales', titulo: 'Libros de ventas y compras', descripcion: 'Vista previa de los libros que pide la SAT, con folio cuando el mes está cerrado.', icono: 'i-lucide-book-marked', to: '/libros', categoria: 'fiscal' as const, permiso: 'libros.ver' },
    { clave: 'comparador', titulo: 'Comparador de regímenes', descripcion: 'Cuánto ISR pagarías en cada régimen con los datos del libro.', icono: 'i-lucide-git-compare', to: '/fiscal/comparador', categoria: 'fiscal' as const, permiso: 'fiscal.ver' },
].filter(e => !e.permiso || puede(e.permiso)))

const categoria = ref<Categoria | 'todos' | 'favoritos'>('todos')
const busqueda = ref('')

function sinAcentos(texto: string): string {
    return texto.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}

const visibles = computed(() => {
    const q = sinAcentos(busqueda.value.trim())
    return entradas.value.filter(e => (categoria.value === 'todos' || e.categoria === categoria.value)
        && (!q || sinAcentos(`${e.titulo} ${e.descripcion}`).includes(q)))
})

function cuenta(id: Categoria | 'todos' | 'favoritos'): number | null {
    if (id === 'favoritos') {
        return null
    }
    return id === 'todos' ? entradas.value.length : entradas.value.filter(e => e.categoria === id).length
}

const vistaMovil = ref<'lista' | 'categorias'>('lista')
</script>

<template>
    <PanelPagina
        id="reportes"
        titulo="Reportes"
        icono="i-lucide-file-chart-column"
        :descripcion="`${entradas.length} reportes · se descargan en Excel y respetan la empresa activa`"
    >
        <template #acciones>
            <ContaSelectorEmpresa />
        </template>

        <ContaCuerpo>
            <div class="grid min-h-0 flex-1 gap-4 lg:grid-cols-[14.5rem_minmax(0,1fr)_20rem]">
                <!-- Categorías. -->
                <nav
                    class="surface-card flex min-h-0 flex-col gap-1 overflow-auto rounded-[1.375rem] p-3"
                    :class="vistaMovil === 'categorias' ? '' : 'max-lg:hidden'"
                    aria-label="Categorías de reportes"
                    data-prueba="categorias-reportes"
                >
                    <UButton
                        v-for="cat in CATEGORIAS"
                        :key="cat.id"
                        :icon="cat.icono"
                        color="neutral"
                        :variant="categoria === cat.id ? 'soft' : 'ghost'"
                        :aria-pressed="categoria === cat.id"
                        class="justify-start rounded-xl px-3 py-2.5"
                        :class="categoria === cat.id ? 'text-primary' : ''"
                        :data-categoria="cat.id"
                        @click="categoria = cat.id; vistaMovil = 'lista'"
                    >
                        <span class="flex-1 text-start">{{ cat.etiqueta }}</span>
                        <span
                            v-if="cuenta(cat.id) !== null"
                            class="text-xs text-muted tabular-nums"
                        >{{ cuenta(cat.id) }}</span>
                    </UButton>
                    <p class="mt-auto flex gap-2 rounded-xl bg-(--ax-panel) p-3 text-xs text-muted">
                        <UIcon
                            name="i-lucide-info"
                            class="mt-px size-3.5 shrink-0"
                        />
                        Cada número de un reporte abre su detalle: de un total llegas a la factura y a su asiento.
                    </p>
                </nav>

                <!-- Lista con buscador. -->
                <ContaIsla
                    llenar
                    :class="vistaMovil === 'lista' ? '' : 'max-lg:hidden'"
                >
                    <template #cabecera>
                        <div class="flex items-center gap-2">
                            <UButton
                                icon="i-lucide-list-filter"
                                color="neutral"
                                variant="outline"
                                class="rounded-full lg:hidden"
                                aria-label="Elegir categoría"
                                @click="vistaMovil = 'categorias'"
                            />
                            <UInput
                                v-model="busqueda"
                                icon="i-lucide-search"
                                placeholder="Buscar un reporte: «morosos», «IVA», «caja»…"
                                aria-label="Buscar un reporte"
                                class="w-full xl:w-[30rem]"
                                :ui="{ base: 'rounded-full' }"
                                data-prueba="buscar-reporte"
                            />
                        </div>
                    </template>
                    <template #herramientas>
                        <span class="text-xs text-muted tabular-nums">{{ visibles.length }} de {{ entradas.length }}</span>
                    </template>

                    <SeccionSinApi
                        v-if="categoria === 'favoritos'"
                        titulo="Tus favoritos llegan pronto"
                        descripcion="Marcar un reporte como favorito se guarda en tu usuario; llega con la API de reportes."
                        icono="i-lucide-star"
                    />
                    <UEmpty
                        v-else-if="!visibles.length"
                        icon="i-lucide-search-x"
                        title="Ningún reporte coincide"
                        description="Prueba con otra palabra o elige «Todos»."
                        variant="naked"
                    />
                    <ul
                        v-else
                        class="divide-y divide-(--ax-borde)"
                        data-prueba="lista-reportes"
                    >
                        <li
                            v-for="entrada in visibles"
                            :key="entrada.clave"
                        >
                            <ULink
                                :to="entrada.to"
                                class="flex items-center gap-3 px-4 py-3 hover:bg-(--ax-fila-hover)"
                                :data-prueba="`reporte-${entrada.clave}`"
                            >
                                <span class="pastilla-icono pastilla-tono tono-marca size-10 shrink-0 rounded-xl">
                                    <UIcon
                                        :name="entrada.icono"
                                        class="size-5"
                                    />
                                </span>
                                <span class="flex min-w-0 flex-1 flex-col">
                                    <span class="truncate text-sm font-semibold text-highlighted">{{ entrada.titulo }}</span>
                                    <span class="truncate text-xs text-muted sm:text-sm">{{ entrada.descripcion }}</span>
                                </span>
                                <UBadge
                                    :label="ETIQUETA_CATEGORIA[entrada.categoria]"
                                    color="neutral"
                                    variant="soft"
                                    class="hidden shrink-0 md:inline-flex"
                                />
                                <UIcon
                                    name="i-lucide-chevron-right"
                                    class="size-4 shrink-0 text-muted"
                                />
                            </ULink>
                        </li>
                    </ul>
                </ContaIsla>

                <!-- Envíos programados y descargas recientes. -->
                <div class="flex min-h-0 flex-col gap-4 max-lg:hidden">
                    <section
                        class="surface-card flex flex-col gap-2 rounded-[1.375rem] p-4"
                        aria-labelledby="titulo-envios"
                        data-prueba="envios-programados"
                    >
                        <div class="flex items-center justify-between gap-2">
                            <h2
                                id="titulo-envios"
                                class="text-base font-semibold text-highlighted"
                            >
                                Envíos programados
                            </h2>
                            <UBadge
                                label="Nuevo"
                                color="secondary"
                                variant="soft"
                                size="sm"
                            />
                        </div>
                        <p class="text-xs text-muted">
                            Llegan por correo como archivo, solo a personas con permiso o a correos de la lista aprobada; nunca con datos de otra empresa.
                        </p>
                        <SeccionSinApi
                            titulo="Todavía sin envíos"
                            descripcion="Programar un envío desde un reporte llega con la API de envíos programados."
                            icono="i-lucide-send"
                        />
                    </section>
                    <section
                        class="surface-card flex min-h-0 flex-1 flex-col gap-2 rounded-[1.375rem] p-4"
                        aria-labelledby="titulo-descargas"
                    >
                        <h2
                            id="titulo-descargas"
                            class="text-base font-semibold text-highlighted"
                        >
                            Descargas recientes
                        </h2>
                        <p class="text-xs text-muted">
                            Quedan en la bitácora: quién exportó qué
                        </p>
                        <UButton
                            v-if="puede('bitacora.ver')"
                            label="Ver en la bitácora"
                            icon="i-lucide-scroll-text"
                            to="/bitacora"
                            color="neutral"
                            variant="outline"
                            class="self-start rounded-full"
                        />
                    </section>
                </div>
            </div>
        </ContaCuerpo>
    </PanelPagina>
</template>
