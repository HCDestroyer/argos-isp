<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'

definePageMeta({ permiso: 'libro.ver' })

useHead({ title: 'Periodos y cierres · ArgosIsp' })

/**
 * Periodos y cierres (tablero ContaCierres): los doce meses del año con su estado arriba; en la
 * tarjeta, el cierre del mes (lista de verificación, cerrar y reabrir, `LibroCierres`) y el cierre
 * del ejercicio (`LibroEjercicios`); a la derecha, los bloqueos del libro y las excepciones vigentes.
 * Cada empresa cierra por separado: con «Todas las empresas» se pide elegir una. Reabrir y cerrar
 * son de la computadora (decisión 9 del PM).
 */
const route = useRoute()
const toast = useToast()
const { puede } = usePermisos()
const { eleccion, empresaId, empresas } = useEmpresaActiva()

const hoy = hoyGuatemala()
const anio = Number(hoy.slice(0, 4))

const pestanas = computed<PestanaConta[]>(() => [
    { label: 'Cierre del mes', value: 'mes', icon: 'i-lucide-calendar-check' },
    { label: `Cierre del ejercicio ${anio}`, value: 'ejercicio', icon: 'i-lucide-flag' },
])
const pestana = ref(route.query.tab === 'ejercicio' ? 'ejercicio' : 'mes')

const cierres = shallowRef<CierrePeriodo[] | null>(null)
const problemaCierres = ref<Problem | null>(null)
const bloqueos = shallowRef<BloqueosEmpresa[] | null>(null)
const problemaBloqueos = ref<Problem | null>(null)
const excepciones = shallowRef<ExcepcionBloqueo[] | null>(null)

async function cargar() {
    const [rCierres, rBloqueos, rExcepciones] = await Promise.all([
        useLibro().periodos(),
        useBloqueosLibro().vigentes(),
        useBloqueosLibro().excepciones({ estado: 'vigente' }),
    ])
    cierres.value = rCierres.ok ? rCierres.data.data : null
    problemaCierres.value = rCierres.ok ? null : rCierres.problema
    bloqueos.value = rBloqueos.ok ? rBloqueos.data : null
    problemaBloqueos.value = rBloqueos.ok ? null : rBloqueos.problema
    excepciones.value = rExcepciones.ok ? rExcepciones.data.data : null
}

onMounted(cargar)

const unaEmpresa = computed(() => eleccion.value !== 'todas' || empresas.value.length <= 1)
const nombreEmpresa = computed(() => empresas.value.find(e => e.id === empresaId.value)?.nombre_comercial ?? empresas.value[0]?.nombre_comercial ?? null)
const vigentes = computed(() => (unaEmpresa.value ? bloqueos.value?.find(b => empresaId.value === null || b.empresa_id === empresaId.value)?.vigentes ?? null : null))

/* Los doce meses del año con su estado (tablero: bloqueo duro, cerrado, por cerrar, abierto). */
type EstadoMes = 'duro' | 'cerrado' | 'por_cerrar' | 'abierto' | 'futuro'

const ESTADOS_MES: Record<EstadoMes, { etiqueta: string, icono: string, clase: string }> = {
    duro: { etiqueta: 'Bloqueo duro', icono: 'i-lucide-lock', clase: 'text-muted' },
    cerrado: { etiqueta: 'Cerrado', icono: 'i-lucide-check', clase: 'border-success/40 bg-success/8 text-success' },
    por_cerrar: { etiqueta: 'Por cerrar', icono: 'i-lucide-clock', clase: 'border-primary ring-1 ring-primary text-primary' },
    abierto: { etiqueta: 'Abierto', icono: 'i-lucide-pencil', clase: '' },
    futuro: { etiqueta: '—', icono: 'i-lucide-calendar', clase: 'border-dashed opacity-50' },
}

const MESES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic']

const meses = computed(() => MESES.map((corto, i) => {
    const periodo = `${anio}-${String(i + 1).padStart(2, '0')}`
    const fin = finDePeriodo(`${periodo}-01`)
    let estado: EstadoMes
    if (periodo > hoy.slice(0, 7)) {
        estado = 'futuro'
    }
    else if (vigentes.value?.duro && fin <= vigentes.value.duro) {
        estado = 'duro'
    }
    else if (cierres.value?.some(c => c.periodo === periodo && c.estado === 'cerrado')) {
        estado = 'cerrado'
    }
    else if (periodo === hoy.slice(0, 7)) {
        estado = 'abierto'
    }
    else {
        estado = 'por_cerrar'
    }
    return { periodo, corto, estado }
}))

const cerrados = computed(() => (cierres.value ?? [])
    .filter(c => c.estado === 'cerrado' && !(vigentes.value?.duro && finDePeriodo(`${c.periodo}-01`) <= vigentes.value.duro))
    .map(c => c.periodo)
    .sort()
    .reverse())

const reabriendo = ref(false)

function alReabrir(cierre: CierrePeriodo) {
    toast.add({ title: `${capitalizarConta(etiquetaPeriodo(cierre.periodo))} reabierto`, description: 'Se pueden volver a registrar asientos en ese mes.', icon: 'i-lucide-lock-open', color: 'warning' })
    void cargar()
}

const FILAS_BLOQUEO: { tipo: 'duro' | 'global' | 'impuestos' | 'ventas' | 'compras', titulo: string, detalle: string, icono: string }[] = [
    { tipo: 'duro', titulo: 'Bloqueo duro', detalle: 'Nunca se mueve hacia atrás', icono: 'i-lucide-lock' },
    { tipo: 'global', titulo: 'Todo el libro', detalle: 'Nada con fecha anterior entra', icono: 'i-lucide-book' },
    { tipo: 'impuestos', titulo: 'Impuestos', detalle: 'Automático al revisar el IVA', icono: 'i-lucide-calculator' },
    { tipo: 'ventas', titulo: 'Ventas', detalle: 'Facturas y notas de crédito', icono: 'i-lucide-receipt' },
    { tipo: 'compras', titulo: 'Compras', detalle: 'Compras y gastos', icono: 'i-lucide-truck' },
]
</script>

<template>
    <PanelPagina
        id="cierres-libro"
        titulo="Periodos y cierres"
        icono="i-lucide-calendar-check-2"
        :descripcion="`${nombreEmpresa && unaEmpresa ? `${nombreEmpresa} · ` : ''}ejercicio ${anio} · cada empresa cierra por separado`"
    >
        <template #acciones>
            <ContaSelectorEmpresa />
        </template>

        <template #accion-principal>
            <UButton
                v-if="puede('libro.reabrir_periodo') && unaEmpresa"
                label="Reabrir un mes"
                icon="i-lucide-rotate-ccw"
                color="neutral"
                variant="ghost"
                class="boton-flotante boton-pastilla max-lg:hidden"
                :disabled="!cerrados.length"
                data-prueba="abrir-reabrir-mes"
                @click="reabriendo = true"
            />
        </template>

        <ContaCuerpo>
            <!-- Los doce meses. -->
            <UAlert
                v-if="!unaEmpresa"
                color="info"
                variant="subtle"
                icon="i-lucide-building-2"
                title="Elige una empresa para ver sus meses"
                description="Cada empresa (NIT) lleva su libro y cierra sus meses por separado. Elige una arriba para ver sus periodos."
                data-prueba="cierres-elige-empresa"
            />
            <ProblemaAlerta
                v-else-if="problemaCierres"
                :problema="problemaCierres"
                :reintentar="cargar"
            />
            <div
                v-else
                class="grid grid-cols-4 gap-2 sm:grid-cols-6 xl:grid-cols-12"
                role="list"
                aria-label="Meses del ejercicio"
                data-prueba="meses-ejercicio"
            >
                <div
                    v-for="m in meses"
                    :key="m.periodo"
                    role="listitem"
                    class="surface-card flex flex-col items-center gap-0.5 rounded-xl border px-2 py-2 text-center"
                    :class="ESTADOS_MES[m.estado].clase"
                    :data-mes="m.periodo"
                    :data-estado="m.estado"
                >
                    <span class="text-sm font-semibold">{{ m.corto }}</span>
                    <span class="flex items-center gap-1 text-[0.6875rem]">
                        <UIcon
                            :name="ESTADOS_MES[m.estado].icono"
                            class="size-3"
                        />
                        {{ ESTADOS_MES[m.estado].etiqueta }}
                    </span>
                </div>
            </div>

            <div class="grid min-h-0 flex-1 gap-4 lg:grid-cols-[minmax(0,1fr)_23rem]">
                <ContaIsla llenar>
                    <template #cabecera>
                        <ContaPestanas
                            v-model="pestana"
                            :items="pestanas"
                            etiqueta="Cierres"
                        />
                    </template>
                    <div class="p-3 sm:p-4">
                        <LibroCierres v-if="pestana === 'mes'" />
                        <LibroEjercicios v-else />
                    </div>
                    <template #pie>
                        Una anomalía se resuelve en su pantalla o el contador la supervisa con una nota. Las verificaciones nunca se marcan a mano.
                    </template>
                </ContaIsla>

                <div class="flex min-h-0 flex-col gap-4 overflow-auto">
                    <section
                        class="surface-card flex flex-col gap-2 rounded-[1.375rem] p-4"
                        aria-labelledby="titulo-bloqueos"
                        data-prueba="bloqueos-resumen"
                    >
                        <div class="flex items-center justify-between gap-2">
                            <h2
                                id="titulo-bloqueos"
                                class="text-base font-semibold text-highlighted"
                            >
                                Bloqueos del libro
                            </h2>
                            <UButton
                                v-if="puede('libro.bloquear')"
                                label="Bloquear"
                                icon="i-lucide-lock"
                                to="/libro/bloqueos"
                                color="neutral"
                                variant="outline"
                                size="sm"
                                class="rounded-full"
                            />
                        </div>
                        <p class="text-xs text-muted">
                            Nada con fecha anterior puede registrarse ni cambiarse
                        </p>
                        <ProblemaAlerta
                            v-if="problemaBloqueos"
                            :problema="problemaBloqueos"
                            :reintentar="cargar"
                        />
                        <USkeleton
                            v-else-if="!bloqueos"
                            class="h-40 w-full"
                        />
                        <p
                            v-else-if="!unaEmpresa"
                            class="text-sm text-muted"
                        >
                            Elige una empresa: cada una tiene sus bloqueos.
                        </p>
                        <ul
                            v-else
                            class="divide-y divide-(--ax-borde)"
                        >
                            <li
                                v-for="fila in FILAS_BLOQUEO"
                                :key="fila.tipo"
                                class="flex items-center gap-3 py-2.5"
                                :data-bloqueo="fila.tipo"
                            >
                                <span class="pastilla-icono pastilla-tono tono-marca size-8 shrink-0 rounded-lg">
                                    <UIcon
                                        :name="fila.icono"
                                        class="size-4"
                                    />
                                </span>
                                <span class="flex min-w-0 flex-1 flex-col">
                                    <span class="text-sm font-semibold text-highlighted">{{ fila.titulo }}</span>
                                    <span class="truncate text-xs text-muted">{{ fila.detalle }}</span>
                                </span>
                                <span class="flex shrink-0 flex-col items-end">
                                    <span class="text-sm font-semibold text-highlighted">{{ vigentes?.[fila.tipo] ? `hasta ${formatearFecha(vigentes[fila.tipo])}` : 'Sin bloqueo' }}</span>
                                    <span
                                        v-if="fila.tipo === 'duro' && vigentes?.duro"
                                        class="text-xs text-muted"
                                    >irreversible</span>
                                </span>
                            </li>
                        </ul>
                        <UButton
                            label="Ver bloqueos y su historial"
                            trailing-icon="i-lucide-chevron-right"
                            to="/libro/bloqueos"
                            color="primary"
                            variant="link"
                            size="sm"
                            class="self-end px-0"
                        />
                    </section>

                    <section
                        class="surface-card flex flex-col gap-2 rounded-[1.375rem] p-4"
                        aria-labelledby="titulo-excepciones"
                    >
                        <h2
                            id="titulo-excepciones"
                            class="text-base font-semibold text-highlighted"
                        >
                            Excepciones vigentes
                        </h2>
                        <p class="text-xs text-muted">
                            Solo un administrador; siempre con fecha de fin
                        </p>
                        <UEmpty
                            v-if="excepciones && !excepciones.length"
                            icon="i-lucide-key-round"
                            title="Ninguna excepción vigente"
                            variant="naked"
                        />
                        <ul
                            v-else-if="excepciones"
                            class="flex flex-col gap-2"
                        >
                            <li
                                v-for="ex in excepciones"
                                :key="ex.id"
                                class="flex gap-3 rounded-xl border border-(--ax-borde) p-3"
                            >
                                <span class="pastilla-icono pastilla-tono tono-aviso size-8 shrink-0 rounded-lg">
                                    <UIcon
                                        name="i-lucide-key-round"
                                        class="size-4"
                                    />
                                </span>
                                <span class="flex min-w-0 flex-col text-xs text-muted">
                                    <span class="text-sm font-semibold text-highlighted">{{ TIPOS_BLOQUEO[ex.tipo].etiqueta }} · {{ ex.usuario_nombre ?? 'Todos los usuarios' }}</span>
                                    <span>«{{ ex.motivo }}»</span>
                                    <span>hasta el {{ formatearFechaHora(ex.hasta_en) }}</span>
                                </span>
                            </li>
                        </ul>
                    </section>
                </div>
            </div>
        </ContaCuerpo>

        <ContaReabrirMesModal
            v-model:open="reabriendo"
            :cerrados="cerrados"
            :duro-hasta="vigentes?.duro ?? null"
            @hecho="alReabrir"
        />
    </PanelPagina>
</template>
