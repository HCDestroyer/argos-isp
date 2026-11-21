<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'

/**
 * Inventario · Por recuperar (tablero NuevoInventario, A3 y A48): los equipos en casa de servicios
 * retirados, con sus intentos de recuperación; «Recibido» los devuelve a una bodega. Si no se
 * recuperan, una persona con `inventario.cobrar_equipo` los declara no recuperados (exige intentos
 * de técnicos distintos o un contacto) y decide si se cobran. Abajo, la cola de cobros de equipo
 * propuestos y los no recuperados del año con lo que se decidió. El técnico nunca decide pérdidas
 * ni cobros: solo registra intentos desde Iris.
 */
definePageMeta({ permiso: 'inventario.ver' })

useHead({ title: 'Por recuperar · Inventario · ArgosIsp' })

const { puede, enlace } = usePermisos()
const toast = useToast()

const busqueda = ref('')
const marco = useTemplateRef<{ recargar: () => void }>('marco')
const accionesRef = useTemplateRef<{ ejecutar: (accion: AccionEquipo, unidad: UnidadInventario, extra?: { pendiente?: PendienteNoRecuperado | null }) => void }>('acciones')

const lista = usePaginacionCursor(cursor => useReportesInventario().porRecuperar({ limit: 100 }, cursor))

const pendientes = shallowRef<PendienteNoRecuperado[]>([])
const problemaPendientes = ref<Problem | null>(null)
const cobros = shallowRef<CobroEquipo[]>([])
const problemaCobros = ref<Problem | null>(null)
const noRecuperadas = shallowRef<UnidadInventario[]>([])
const problemaNoRecuperadas = ref<Problem | null>(null)
const cargandoResto = ref(false)

async function cargarResto() {
    cargandoResto.value = true
    const [p, c, n] = await Promise.all([
        useCobrosEquipo().pendientesDeclarar(),
        useCobrosEquipo().listar(null),
        useUnidadesInventario().listar({ estado: 'no_recuperada', limit: 100 }),
    ])
    cargandoResto.value = false
    pendientes.value = p.ok ? p.data : []
    problemaPendientes.value = p.ok ? null : p.problema
    cobros.value = c.ok ? c.data.data : []
    problemaCobros.value = c.ok ? null : c.problema
    const anio = new Date().getFullYear()
    noRecuperadas.value = n.ok ? n.data.data.filter(u => new Date(u.updated_at).getFullYear() === anio) : []
    problemaNoRecuperadas.value = n.ok ? null : n.problema
}

function recargarTodo() {
    void lista.recargar()
    void cargarResto()
    marco.value?.recargar()
}

onMounted(() => {
    void lista.recargar()
    void cargarResto()
})

const q = computed(() => busqueda.value.trim().toLowerCase())
const coincide = (u: { producto_nombre: string, serie: string | null, mac: string | null }) => !q.value || [u.producto_nombre, u.serie, u.mac].some(v => v?.toLowerCase().includes(q.value))

const porRecuperar = computed(() => lista.filas.value.filter(coincide))
const pendienteDe = (id: number) => pendientes.value.find(p => p.unidad_id === id) ?? null
const propuestos = computed(() => cobros.value.filter(c => c.estado === 'propuesto' && coincide(c)))
const cobroDe = (unidadId: number) => cobros.value.find(c => c.unidad_id === unidadId && c.origen === 'no_recuperado') ?? null
const noRecuperadasVisibles = computed(() => noRecuperadas.value.filter(coincide))

function subtitulo(e: EquipoServicio): string {
    const p = pendienteDe(e.id)
    return [
        e.servicio_id ? `Servicio #${e.servicio_id}` : null,
        e.fecha_asignacion ? `prestado ${formatearFechaCorta(e.fecha_asignacion)}` : null,
        p ? `${p.intentos} ${p.intentos === 1 ? 'intento' : 'intentos'}${p.contactos ? ` · ${p.contactos} ${p.contactos === 1 ? 'contacto' : 'contactos'}` : ''}` : null,
    ].filter(Boolean).join(' · ')
}

function menuEquipo(e: EquipoServicio) {
    const acciones = accionesEquipo(e, puede).filter(a => a !== 'recibir')
    return [
        [
            { label: 'Ver historial', icon: 'i-lucide-history', to: `/inventario/unidades?unidad=${e.id}` },
            ...(e.servicio_id ? [{ label: 'Abrir el servicio', icon: ICONOS.abrir, to: enlace(`/servicios/${e.servicio_id}#equipos`) }] : []),
        ],
        acciones.map(a => ({ label: ACCIONES_EQUIPO[a].etiqueta, icon: ACCIONES_EQUIPO[a].icono, color: ACCIONES_EQUIPO[a].color, onSelect: () => accionesRef.value?.ejecutar(a, e, { pendiente: pendienteDe(e.id) }) })),
    ]
}

function estadoNoRecuperada(u: UnidadInventario) {
    const cobro = cobroDe(u.id)
    return cobro ? ESTADOS_COBRO_EQUIPO[cobro.estado] : { etiqueta: 'Sin cobro', color: 'neutral' as const, icono: 'i-lucide-circle-slash' }
}

/* Cola de cobros */
const aprobarAbierto = ref(false)
const rechazarAbierto = ref(false)
const cobroElegido = shallowRef<CobroEquipo | null>(null)

function aprobar(cobro: CobroEquipo) {
    cobroElegido.value = cobro
    aprobarAbierto.value = true
}

function rechazar(cobro: CobroEquipo) {
    cobroElegido.value = cobro
    rechazarAbierto.value = true
}

function ejecutarRechazo(motivo: string, clave: string): Promise<Resultado<CobroEquipo>> {
    return useCobrosEquipo().rechazar(cobroElegido.value ?? { id: 0, version: 0 }, motivo, clave)
}

function cobroDecidido(titulo: string) {
    toast.add({ title: titulo, icon: 'i-lucide-circle-check', color: 'success' })
    void cargarResto()
}
</script>

<template>
    <PanelPagina
        id="inventario-por-recuperar"
        titulo="Inventario"
        icono="i-lucide-undo-2"
        sin-descripcion
    >
        <template #acciones>
            <InventarioAcciones @hecho="recargarTodo" />
        </template>

        <InventarioMarco
            ref="marco"
            pestana="recuperar"
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

            <div class="flex flex-col gap-3 p-3 sm:p-4">
                <ProblemaAlerta
                    v-if="lista.problema.value"
                    :problema="lista.problema.value"
                    :reintentar="lista.recargar"
                    :reintentando="lista.cargando.value"
                />
                <template v-else>
                    <USkeleton
                        v-if="lista.cargando.value && !lista.filas.value.length"
                        class="h-16 w-full rounded-2xl"
                    />
                    <ul
                        class="flex flex-col gap-2.5"
                        data-prueba="tabla-por-recuperar"
                    >
                        <li
                            v-for="equipo in porRecuperar"
                            :key="equipo.id"
                            class="flex flex-col gap-3 rounded-2xl border border-warning/40 bg-warning/5 p-3 sm:flex-row sm:items-center"
                            :data-por-recuperar="equipo.serie ?? equipo.mac ?? equipo.id"
                        >
                            <div class="flex min-w-0 flex-1 items-center gap-3">
                                <span class="pastilla-icono pastilla-tono tono-aviso size-10 shrink-0 rounded-xl">
                                    <UIcon
                                        name="i-lucide-barcode"
                                        class="size-5"
                                    />
                                </span>
                                <div class="flex min-w-0 flex-col">
                                    <span class="truncate font-semibold text-highlighted">{{ equipo.producto_nombre }} · <span class="font-mono">{{ identificacionUnidad(equipo) }}</span></span>
                                    <span class="truncate text-xs text-warning">{{ subtitulo(equipo) }}</span>
                                    <span
                                        v-if="pendienteDe(equipo.id) && faltaParaDeclarar(pendienteDe(equipo.id)!)"
                                        class="text-xs text-muted"
                                    >{{ faltaParaDeclarar(pendienteDe(equipo.id)!) }}</span>
                                </div>
                            </div>
                            <div class="flex flex-wrap items-center gap-2">
                                <UButton
                                    label="Crear orden de retiro (Iris)"
                                    icon="i-lucide-clipboard-plus"
                                    color="neutral"
                                    variant="outline"
                                    size="sm"
                                    class="rounded-full"
                                    disabled
                                    title="Argos crea la orden de retiro en Iris al retirar el servicio; crearla a mano aún no está en la API"
                                />
                                <UButton
                                    v-if="puede('inventario.devolver_comodato')"
                                    label="Recibido"
                                    icon="i-lucide-package-check"
                                    color="neutral"
                                    variant="outline"
                                    size="sm"
                                    class="rounded-full"
                                    :data-recibir="identificacionUnidad(equipo)"
                                    @click="accionesRef?.ejecutar('recibir', equipo)"
                                />
                                <UDropdownMenu
                                    :items="menuEquipo(equipo)"
                                    :content="{ align: 'end' }"
                                >
                                    <UButton
                                        icon="i-lucide-ellipsis"
                                        color="neutral"
                                        variant="ghost"
                                        size="sm"
                                        :aria-label="`Más acciones: ${identificacionUnidad(equipo)}`"
                                    />
                                </UDropdownMenu>
                            </div>
                        </li>
                        <li v-if="!lista.cargando.value && !porRecuperar.length">
                            <UEmpty
                                icon="i-lucide-undo-2"
                                title="Nada por recuperar"
                                description="Ningún servicio retirado tiene equipos en comodato."
                                variant="naked"
                            />
                        </li>
                    </ul>
                    <PaginacionCursor
                        v-if="lista.hayAnterior.value || lista.haySiguiente.value"
                        :pagina="lista.pagina.value"
                        :hay-anterior="lista.hayAnterior.value"
                        :hay-siguiente="lista.haySiguiente.value"
                        :cargando="lista.cargando.value"
                        :filas="lista.filas.value.length"
                        @anterior="lista.anterior"
                        @siguiente="lista.siguiente"
                    />
                </template>

                <div class="flex items-start gap-2.5 rounded-2xl border border-dashed border-error/50 p-3 text-sm">
                    <UIcon
                        name="i-lucide-triangle-alert"
                        class="mt-0.5 size-4 shrink-0 text-error"
                    />
                    <span>Si no se recupera, «Declarar no recuperado» lo da de baja como pérdida y ofrece <b>cobrarlo al cliente</b> con un cargo «Equipo no devuelto». Lo decide una persona, nunca el técnico.</span>
                </div>
                <ProblemaAlerta
                    v-if="problemaPendientes"
                    :problema="problemaPendientes"
                    :reintentar="cargarResto"
                    :reintentando="cargandoResto"
                />

                <section
                    class="flex flex-col gap-2"
                    data-prueba="cobros-equipo"
                >
                    <h3 class="flex items-center gap-2 pt-2 text-xs font-bold uppercase tracking-wide text-muted">
                        Cobros de equipo por decidir
                        <UBadge
                            v-if="propuestos.length"
                            :label="String(propuestos.length)"
                            color="warning"
                            variant="subtle"
                            size="sm"
                        />
                    </h3>
                    <ProblemaAlerta
                        v-if="problemaCobros"
                        :problema="problemaCobros"
                        :reintentar="cargarResto"
                        :reintentando="cargandoResto"
                    />
                    <template v-else>
                        <div
                            v-for="cobro in propuestos"
                            :key="cobro.id"
                            class="flex flex-col gap-3 rounded-2xl border border-(--ax-borde) p-3 sm:flex-row sm:items-center"
                            :data-cobro="cobro.id"
                        >
                            <div class="flex min-w-0 flex-1 items-center gap-3">
                                <span class="pastilla-icono pastilla-tono tono-aviso size-10 shrink-0 rounded-xl">
                                    <UIcon
                                        name="i-lucide-hourglass"
                                        class="size-5"
                                    />
                                </span>
                                <div class="flex min-w-0 flex-col">
                                    <span class="truncate font-semibold text-highlighted">{{ cobro.producto_nombre }} · <span class="font-mono">{{ identificacionUnidad(cobro) }}</span></span>
                                    <span class="truncate text-xs text-muted">{{ ORIGENES_COBRO_EQUIPO[cobro.origen] }} · {{ cobro.cliente_nombre }} · {{ formatearFechaCorta(cobro.created_at) }}{{ cobro.nota ? ` · ${cobro.nota}` : '' }}</span>
                                </div>
                            </div>
                            <div
                                v-if="puede('inventario.cobrar_equipo')"
                                class="flex flex-wrap gap-2"
                            >
                                <UButton
                                    label="Cobrar"
                                    :icon="ICONOS.cobrar"
                                    color="success"
                                    variant="soft"
                                    size="sm"
                                    class="rounded-full"
                                    data-prueba="cobro-aprobar"
                                    @click="aprobar(cobro)"
                                />
                                <UButton
                                    label="Sin cobro"
                                    icon="i-lucide-circle-slash"
                                    color="neutral"
                                    variant="outline"
                                    size="sm"
                                    class="rounded-full"
                                    data-prueba="cobro-rechazar"
                                    @click="rechazar(cobro)"
                                />
                            </div>
                            <UBadge
                                v-else
                                label="Por decidir"
                                icon="i-lucide-hourglass"
                                color="warning"
                                variant="subtle"
                                class="rounded-full"
                            />
                        </div>
                        <p
                            v-if="!cargandoResto && !propuestos.length"
                            class="text-sm text-muted"
                        >
                            Ningún cobro de equipo espera decisión.
                        </p>
                    </template>
                </section>

                <section
                    class="flex flex-col gap-2"
                    data-prueba="no-recuperados"
                >
                    <h3 class="pt-2 text-xs font-bold uppercase tracking-wide text-muted">
                        No recuperados (este año)
                    </h3>
                    <ProblemaAlerta
                        v-if="problemaNoRecuperadas"
                        :problema="problemaNoRecuperadas"
                        :reintentar="cargarResto"
                        :reintentando="cargandoResto"
                    />
                    <template v-else>
                        <div
                            v-for="u in noRecuperadasVisibles"
                            :key="u.id"
                            class="flex items-center gap-3 rounded-2xl border border-(--ax-borde) p-3"
                        >
                            <span class="pastilla-icono pastilla-tono tono-error size-10 shrink-0 rounded-xl">
                                <UIcon
                                    name="i-lucide-barcode"
                                    class="size-5"
                                />
                            </span>
                            <div class="flex min-w-0 flex-1 flex-col">
                                <span class="truncate font-semibold text-highlighted">{{ u.producto_nombre }} · <span class="font-mono">{{ identificacionUnidad(u) }}</span></span>
                                <span class="truncate text-xs text-muted">{{ u.servicio_id ? `Servicio #${u.servicio_id} · ` : '' }}declarado {{ formatearFechaCorta(u.updated_at) }} · {{ formatearQuetzales(cobroDe(u.id)?.monto ?? u.costo) }}</span>
                            </div>
                            <UBadge
                                :label="estadoNoRecuperada(u).etiqueta"
                                :icon="estadoNoRecuperada(u).icono"
                                :color="estadoNoRecuperada(u).color"
                                variant="subtle"
                                class="shrink-0 rounded-full"
                            />
                        </div>
                        <p
                            v-if="!cargandoResto && !noRecuperadasVisibles.length"
                            class="text-sm text-muted"
                        >
                            Ningún equipo declarado no recuperado este año.
                        </p>
                    </template>
                </section>
            </div>
        </InventarioMarco>

        <EquipoAcciones
            ref="acciones"
            @hecho="recargarTodo"
        />
        <CobroEquipoAprobarModal
            v-model:open="aprobarAbierto"
            :cobro="cobroElegido"
            @hecho="cobroDecidido('Cobro aprobado: el cargo quedó en la cuenta del cliente')"
        />
        <AccionMotivoModal
            v-model:open="rechazarAbierto"
            titulo="Sin cobro"
            :efecto="`No se cobra ${cobroElegido ? identificacionUnidad(cobroElegido) : 'el equipo'} al cliente. Queda en la bitácora con el motivo.`"
            confirmar="Decidir sin cobro"
            icono="i-lucide-circle-slash"
            color="neutral"
            placeholder="Ej.: el daño fue por una descarga eléctrica"
            :ejecutar="ejecutarRechazo"
            @hecho="cobroDecidido('Decidido sin cobro')"
        />
    </PanelPagina>
</template>
