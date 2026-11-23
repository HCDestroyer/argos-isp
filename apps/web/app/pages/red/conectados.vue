<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { SelectItem, TableColumn, TabsItem } from '@nuxt/ui'

/**
 * Conectados ahora (tableros RedSesiones y RedSesionesMovil, decisión 29 del PM): quién está
 * navegando, desde cuándo y por cuál router. Contadores (conectados, sin servicio por router
 * caído, caídas repetidas, activos sin conexión), pestañas, buscador y filtro por router, y el
 * detalle de la sesión elegida al lado con «Abrir cliente» y «Desconectar».
 *
 * Datos: `GET /sesiones?activa=true` (`sesiones.ver`, de 50 en 50 con «Cargar más»), el servicio
 * de cada sesión (`GET /servicios/:id`) para el cliente, el plan y el estado, y
 * `GET /routers/:id/resumen-sesiones` por router para los totales y los activos sin conexión.
 * «Caídas repetidas» no tiene lista en la API todavía (evento `servicio.caidas_repetidas`, pedido
 * a A2 en `.claude/integration/a4.md`): la pestaña lo dice, sin números inventados.
 */
definePageMeta({ permiso: 'sesiones.ver' })

useHead({ title: 'Conectados ahora · ArgosIsp' })

const route = useRoute()
const router = useRouter()
const { puede } = usePermisos()
const toast = useToast()

const TODOS = 'todos'
type Vista = 'conectados' | 'caidas' | 'sin_conexion'
const vista = ref<Vista>(route.query.vista === 'caidas' || route.query.vista === 'sin_conexion' ? route.query.vista : 'conectados')
const routerElegido = ref<string>(typeof route.query.router === 'string' ? route.query.router : TODOS)
const busqueda = ref('')

watch([vista, routerElegido], ([v, r]) => void router.replace({ query: { ...(v !== 'conectados' ? { vista: v } : {}), ...(r !== TODOS ? { router: r } : {}) } }))

/* Routers y su resumen de sesiones (totales y activos sin conexión). */
const routers = shallowRef<RouterNas[]>([])
const resumenes = ref<Record<number, ResumenSesionesRouter | null>>({})
const problemaResumen = ref(false)

async function cargarRouters() {
    if (!puede('routers.ver')) {
        return
    }
    const resultado = await leerTodas(cursor => useRouters().listar({ activo: true, limit: 200 }, cursor))
    routers.value = resultado.ok ? resultado.data.filas : []
    const desde = new Date().toISOString()
    const nuevos: Record<number, ResumenSesionesRouter | null> = {}
    await Promise.all(routers.value.map(async (nas) => {
        const r = await useRouters().resumenSesiones(nas.id, desde)
        nuevos[nas.id] = r.ok ? r.data : null
    }))
    resumenes.value = nuevos
    problemaResumen.value = Object.values(nuevos).some(r => r === null)
}

const routersVista = computed(() => (routerElegido.value === TODOS ? routers.value : routers.value.filter(r => String(r.id) === routerElegido.value)))
const nombreRouter = computed(() => new Map(routers.value.map(r => [r.id, r.nombre])))

const totales = computed(() => {
    const lista = routersVista.value.map(r => resumenes.value[r.id])
    if (!lista.length || lista.some(r => !r)) {
        return null
    }
    return {
        conectados: lista.reduce((suma, r) => suma + (r?.con_sesion_activa ?? 0), 0),
        servicios: lista.reduce((suma, r) => suma + (r?.servicios ?? 0), 0),
    }
})

const caidos = computed(() => routersVista.value.filter(r => estadoListaRouter(r) === 'caido'))
const sinServicioPorCaida = computed(() => {
    if (caidos.value.some(r => !resumenes.value[r.id])) {
        return null
    }
    return caidos.value.reduce((suma, r) => suma + (resumenes.value[r.id]?.servicios ?? 0), 0)
})

/** Activos sin sesión (los de routers caídos no cuentan: no es su falla). */
const sinConexion = computed(() => routersVista.value
    .filter(r => estadoListaRouter(r) !== 'caido')
    .flatMap(r => (resumenes.value[r.id]?.sin_sesion_desde ?? []).filter(s => s.estado === 'activo').map(s => ({ ...s, router_id: r.id }))))

/* Sesiones abiertas. */
const sesiones = shallowRef<Sesion[]>([])
const cursor = ref<string | null>(null)
const cargando = ref(true)
const problema = ref<Problem | null>(null)

async function cargarSesiones(mas = false) {
    cargando.value = true
    problema.value = null
    const resultado = await useSesiones().listar({
        activa: true,
        limit: 50,
        ...(routerElegido.value !== TODOS ? { router_id: Number(routerElegido.value) } : {}),
    }, mas ? (cursor.value ?? undefined) : undefined)
    cargando.value = false
    if (!resultado.ok) {
        problema.value = resultado.problema
        return
    }
    sesiones.value = mas ? [...sesiones.value, ...resultado.data.data] : resultado.data.data
    cursor.value = resultado.data.nextCursor ?? null
    void leerServicios(resultado.data.data.map(s => s.servicio_id).filter((id): id is number => id !== null))
}

/* El servicio de cada sesión (cliente, plan, estado), una vez por id. */
const servicios = ref<Record<number, Servicio | null>>({})
async function leerServicios(ids: number[]) {
    if (!puede('servicios.ver')) {
        return
    }
    const faltan = [...new Set(ids)].filter(id => !(id in servicios.value))
    for (let i = 0; i < faltan.length; i += 8) {
        const lote = faltan.slice(i, i + 8)
        const leidos = await Promise.all(lote.map(id => useServicios().ver(id)))
        const nuevos: Record<number, Servicio | null> = {}
        leidos.forEach((r, indice) => {
            nuevos[lote[indice]!] = r.ok ? r.data : null
        })
        servicios.value = { ...servicios.value, ...nuevos }
    }
}

function servicioDe(sesion: Sesion): Servicio | null {
    return sesion.servicio_id ? (servicios.value[sesion.servicio_id] ?? null) : null
}

function nombreSesion(sesion: Sesion): string {
    const servicio = servicioDe(sesion)
    return servicio?.cliente_nombre ?? (sesion.servicio_id ? `Servicio ${sesion.servicio_id}` : 'Sin servicio')
}

const filas = computed(() => {
    const texto = busqueda.value.trim().toLowerCase()
    if (!texto) {
        return sesiones.value
    }
    return sesiones.value.filter(s => [nombreSesion(s), s.user_ppp, s.ipv4, s.prefijo_delegado_v6].some(v => v?.toLowerCase().includes(texto)))
})

const elegida = shallowRef<Sesion | null>(null)
const detalleAbierto = ref(false)
function elegir(_evento: Event, fila: { original: Sesion }) {
    elegida.value = fila.original
    detalleAbierto.value = true
}
watch(sesiones, (lista) => {
    if (!elegida.value || !lista.some(s => s.id === elegida.value?.id)) {
        elegida.value = lista[0] ?? null
    }
})

/* RADIUS funcionando (salud del sistema, `sistema.ver_salud`). */
const aaa = shallowRef<{ estado: string, detalle: string } | null>(null)
async function leerAaa() {
    if (!puede('sistema.ver_salud')) {
        return
    }
    const resultado = await useSistema().salud()
    const componente = resultado.ok ? resultado.data.componentes.find(c => c.id === 'aaa') : undefined
    aaa.value = componente ? { estado: componente.estado, detalle: componente.detalle } : null
}

function cargarTodo() {
    void cargarSesiones()
    void cargarRouters()
    void leerAaa()
}

onMounted(cargarTodo)
watch(routerElegido, () => void cargarSesiones())

/* Se actualiza sola cada 30 s (pie de la tarjeta). */
let temporizador: ReturnType<typeof setInterval> | undefined
onMounted(() => {
    temporizador = setInterval(() => {
        if (!document.hidden && vista.value === 'conectados') {
            void cargarSesiones()
        }
    }, 30_000)
})
onBeforeUnmount(() => clearInterval(temporizador))

const itemsRouter = computed<SelectItem[]>(() => [{ label: 'Todos', value: TODOS }, ...routers.value.map(r => ({ label: r.nombre, value: String(r.id) }))])

const pestanas = computed<TabsItem[]>(() => [
    { label: 'Conectados', value: 'conectados', badge: totales.value ? { label: formatearEntero(totales.value.conectados), color: 'neutral', variant: 'soft' } : undefined },
    { label: 'Caídas repetidas', value: 'caidas' },
    { label: 'Activos sin conexión', value: 'sin_conexion', badge: problemaResumen.value ? undefined : { label: String(sinConexion.value.length), color: 'neutral', variant: 'soft' } },
])

const columnas = computed<TableColumn<Sesion>[]>(() => [
    { id: 'cliente', header: 'Cliente', meta: { class: { td: 'whitespace-normal' } } },
    { accessorKey: 'ipv4', header: 'IP', meta: SOLO_ANCHO },
    { id: 'router', header: 'Router', meta: SOLO_ESCRITORIO },
    { id: 'conectado', header: 'Conectado' },
    { id: 'consumo', header: 'Consumo ↓ / ↑', meta: SOLO_ESCRITORIO },
    { id: 'estado', header: 'Servicio', meta: SOLO_ANCHO },
])

/* Desconectar (`sesiones.desconectar`, con motivo). */
const desconectarAbierto = ref(false)
function alDesconectar() {
    toast.add({ title: 'Desconexión enviada', description: 'La sesión se cierra cuando el router confirma.', icon: 'i-lucide-unplug', color: 'success' })
    void cargarSesiones()
}
</script>

<template>
    <PanelPagina
        id="conectados"
        titulo="Conectados ahora"
        icono="i-lucide-wifi"
    >
        <template #acciones>
            <UBadge
                v-if="aaa"
                :label="aaa.estado === 'ok' ? 'RADIUS funcionando' : `RADIUS: ${aaa.detalle}`"
                :icon="aaa.estado === 'ok' ? 'i-lucide-shield-check' : 'i-lucide-shield-alert'"
                :color="aaa.estado === 'ok' ? 'success' : aaa.estado === 'degradado' ? 'warning' : 'error'"
                variant="soft"
                size="lg"
                class="rounded-full"
                data-prueba="estado-radius"
            />
        </template>

        <div class="flex flex-col gap-4">
            <div
                class="grid grid-cols-2 gap-3 lg:grid-cols-4"
                data-prueba="contadores-conectados"
            >
                <TarjetaDato
                    etiqueta="Conectados"
                    icono="i-lucide-wifi"
                    tono="tono-exito"
                    :valor="totales ? formatearEntero(totales.conectados) : (problemaResumen ? '—' : null)"
                    :detalle="totales ? `de ${formatearEntero(totales.servicios)} servicios` : (problemaResumen ? 'No se pudo leer' : undefined)"
                />
                <TarjetaDato
                    etiqueta="Sin servicio por router caído"
                    icono="i-lucide-router"
                    tono="tono-error"
                    :valor="sinServicioPorCaida === null ? '—' : formatearEntero(sinServicioPorCaida)"
                    :detalle="caidos.length ? caidos.map(r => r.nombre).join(', ') : 'Ningún router caído'"
                    :peligro="(sinServicioPorCaida ?? 0) > 0"
                />
                <TarjetaDato
                    etiqueta="Caídas repetidas"
                    icono="i-lucide-activity"
                    tono="tono-aviso"
                    class="hidden lg:flex"
                    valor="No disponible"
                    detalle="La API aún no da la lista"
                />
                <TarjetaDato
                    etiqueta="Activos sin conexión"
                    icono="i-lucide-ban"
                    class="hidden lg:flex"
                    :valor="problemaResumen ? '—' : String(sinConexion.length)"
                    :detalle="caidos.length ? `sin contar los de ${caidos.map(r => r.nombre).join(', ')}` : 'servicios activos sin sesión'"
                />
            </div>

            <div class="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
                <div class="surface-card flex min-w-0 flex-col overflow-hidden rounded-2xl">
                    <div class="flex flex-col gap-3 p-3 sm:p-4 lg:flex-row lg:items-center lg:justify-between">
                        <RedPestanas
                            v-model="vista"
                            :items="pestanas"
                            etiqueta="Ver sesiones"
                            data-prueba="pestanas-conectados"
                        />
                        <div class="flex flex-wrap items-center gap-2">
                            <UInput
                                v-model="busqueda"
                                icon="i-lucide-search"
                                placeholder="Cliente, usuario o IP…"
                                aria-label="Buscar por cliente, usuario o IP"
                                class="w-full sm:w-56"
                                :ui="{ base: 'rounded-full' }"
                            />
                            <USelect
                                v-if="routers.length"
                                v-model="routerElegido"
                                :items="itemsRouter"
                                icon="i-lucide-router"
                                aria-label="Filtrar por router"
                                class="w-44"
                            />
                        </div>
                    </div>

                    <template v-if="vista === 'conectados'">
                        <div
                            v-if="problema"
                            class="p-3 sm:p-4"
                        >
                            <ProblemaAlerta
                                :problema="problema"
                                :reintentar="cargarSesiones"
                                :reintentando="cargando"
                            />
                        </div>
                        <UTable
                            v-else
                            :data="filas"
                            :columns="columnas"
                            :loading="cargando && !sesiones.length"
                            sticky
                            :ui="{ thead: 'bg-(--ax-cabecera-tabla)', th: 'text-xs', td: 'py-2.5', tr: 'cursor-pointer' }"
                            data-prueba="tabla-conectados"
                            @select="elegir"
                        >
                            <template #cliente-cell="{ row }">
                                <div
                                    class="flex min-w-0 flex-col"
                                    :class="elegida?.id === row.original.id ? 'xl:border-s-2 xl:border-primary xl:ps-2' : ''"
                                >
                                    <span class="font-semibold text-highlighted">{{ nombreSesion(row.original) }}</span>
                                    <span class="font-mono text-xs text-muted">{{ row.original.user_ppp }}</span>
                                    <span class="font-mono text-xs text-muted sm:hidden">{{ row.original.ipv4 ?? '—' }} · {{ row.original.router_id ? (nombreRouter.get(row.original.router_id) ?? `Router ${row.original.router_id}`) : '—' }}</span>
                                </div>
                            </template>
                            <template #ipv4-cell="{ row }">
                                <span class="font-mono text-sm">{{ row.original.ipv4 ?? '—' }}</span>
                            </template>
                            <template #router-cell="{ row }">
                                <span class="text-sm">{{ row.original.router_id ? (nombreRouter.get(row.original.router_id) ?? `Router ${row.original.router_id}`) : '—' }}</span>
                            </template>
                            <template #conectado-cell="{ row }">
                                <div class="flex flex-col items-end gap-1 sm:items-start">
                                    <EstadoServicioBadge
                                        v-if="servicioDe(row.original)"
                                        :estado="servicioDe(row.original)!.estado"
                                        size="sm"
                                        class="sm:hidden"
                                    />
                                    <span
                                        class="text-sm whitespace-nowrap"
                                        :title="formatearFechaHora(row.original.inicio)"
                                    >{{ formatearDuracion(row.original.inicio) }}</span>
                                </div>
                            </template>
                            <template #consumo-cell="{ row }">
                                <span class="text-sm whitespace-nowrap text-muted">{{ esSesionPorSondeo(row.original) ? '— / —' : `${formatearBytes(row.original.bytes_in)} / ${formatearBytes(row.original.bytes_out)}` }}</span>
                            </template>
                            <template #estado-cell="{ row }">
                                <EstadoServicioBadge
                                    v-if="servicioDe(row.original)"
                                    :estado="servicioDe(row.original)!.estado"
                                    size="sm"
                                />
                                <span
                                    v-else
                                    class="text-xs text-muted"
                                >—</span>
                            </template>
                            <template #empty>
                                <UEmpty
                                    :icon="busqueda ? 'i-lucide-search-x' : 'i-lucide-wifi-off'"
                                    :title="busqueda ? 'Nadie coincide' : 'Nadie conectado'"
                                    :description="busqueda ? 'La búsqueda mira lo ya cargado: prueba «Cargar más».' : undefined"
                                    variant="naked"
                                />
                            </template>
                        </UTable>
                        <div class="flex flex-wrap items-center gap-x-2 border-t border-(--ax-borde) px-3 py-2.5 text-xs text-muted sm:px-4">
                            <span>{{ filas.length }}{{ totales ? ` de ${formatearEntero(totales.conectados)}` : '' }}</span>
                            <UButton
                                v-if="cursor"
                                label="Cargar más"
                                variant="link"
                                size="xs"
                                class="px-0"
                                :loading="cargando"
                                @click="cargarSesiones(true)"
                            />
                            <span>· se actualiza sola cada 30 s</span>
                        </div>
                    </template>

                    <div
                        v-else-if="vista === 'caidas'"
                        class="p-4"
                    >
                        <SeccionSinApi
                            titulo="Caídas repetidas: no disponible todavía"
                            descripcion="Argos ya detecta los servicios que se caen varias veces seguidas (y abre el ticket en Iris), pero la API aún no da la lista para mostrarla aquí. Está pedida."
                            icono="i-lucide-activity"
                        />
                    </div>

                    <template v-else>
                        <UAlert
                            v-if="problemaResumen"
                            color="warning"
                            variant="subtle"
                            icon="i-lucide-triangle-alert"
                            title="No se pudo leer el resumen de algún router"
                            class="mx-3 mb-3 sm:mx-4"
                            :actions="[{ label: 'Reintentar', icon: 'i-lucide-refresh-cw', color: 'warning', variant: 'outline', onClick: () => void cargarRouters() }]"
                        />
                        <ul
                            class="flex flex-col"
                            data-prueba="activos-sin-conexion"
                        >
                            <li
                                v-for="servicio in sinConexion"
                                :key="servicio.servicio_id"
                                class="flex items-center justify-between gap-3 border-t border-(--ax-borde) px-3 py-2.5 sm:px-4"
                            >
                                <div class="flex min-w-0 flex-col">
                                    <ULink
                                        :to="`/servicios/${servicio.servicio_id}`"
                                        class="font-semibold text-highlighted hover:text-primary"
                                    >{{ servicio.cliente_nombre }}</ULink>
                                    <span class="font-mono text-xs text-muted">{{ servicio.user_ppp ?? '—' }} · {{ nombreRouter.get(servicio.router_id) }}</span>
                                </div>
                                <span class="text-end text-xs text-muted">{{ servicio.ultima_sesion_fin ? `última sesión ${haceCuanto(servicio.ultima_sesion_fin)}` : 'nunca se conectó' }}</span>
                            </li>
                            <li
                                v-if="!sinConexion.length && !problemaResumen"
                                class="p-4"
                            >
                                <UEmpty
                                    icon="i-lucide-circle-check"
                                    title="Todos los activos tienen sesión"
                                    variant="naked"
                                />
                            </li>
                        </ul>
                    </template>
                </div>

                <!-- Detalle de la sesión elegida (escritorio: al lado; teléfono: panel). -->
                <aside
                    v-if="elegida && vista === 'conectados'"
                    class="surface-card hidden h-fit flex-col gap-3 rounded-2xl p-4 xl:flex"
                    aria-label="Detalle de la sesión"
                    data-prueba="detalle-sesion"
                >
                    <RedSesionDetalle
                        :sesion="elegida"
                        :servicio="servicioDe(elegida)"
                        :router-nombre="elegida.router_id ? (nombreRouter.get(elegida.router_id) ?? null) : null"
                        @desconectar="desconectarAbierto = true"
                    />
                </aside>
            </div>
        </div>

        <USlideover
            v-if="elegida"
            v-model:open="detalleAbierto"
            :title="nombreSesion(elegida)"
            :description="elegida.user_ppp"
            class="xl:hidden"
        >
            <template #body>
                <RedSesionDetalle
                    :sesion="elegida"
                    :servicio="servicioDe(elegida)"
                    :router-nombre="elegida.router_id ? (nombreRouter.get(elegida.router_id) ?? null) : null"
                    sin-encabezado
                    @desconectar="desconectarAbierto = true"
                />
            </template>
        </USlideover>

        <AccionMotivoModal
            v-if="elegida && puede('sesiones.desconectar')"
            v-model:open="desconectarAbierto"
            :titulo="`Desconectar a ${nombreSesion(elegida)}`"
            efecto="Argos manda el Disconnect al router; el equipo del cliente vuelve a marcar solo."
            confirmar="Desconectar"
            icono="i-lucide-unplug"
            placeholder="Ej.: no navega, se reinicia la sesión"
            :ejecutar="(motivo, clave) => useSesiones().desconectar(elegida!.id, motivo, clave)"
            @hecho="alDesconectar"
        />
    </PanelPagina>
</template>
