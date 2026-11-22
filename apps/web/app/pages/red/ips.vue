<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { SelectItem, TableColumn, TabsItem } from '@nuxt/ui'

/**
 * Direcciones IP (tablero RedIps, decisión 29 del PM): todas las redes de todos los routers en un
 * solo lugar. Arriba, «¿De quién es?»: escribe una IPv4, una IPv6 o un prefijo y dice el cliente, su
 * servicio y desde cuándo (`GET /ip/:ip`, `ip.resolver`). Contadores, pestañas IPv4 / IPv6 / IPs
 * fijas y públicas, filtro por router y orden, y el detalle de la red elegida al lado.
 *
 * Lo que la API aún no da, sin datos inventados (anotado en `.claude/integration/a4.md`):
 * - Buscar quién tenía una IP en una fecha pasada (decisión 28, en construcción en
 *   `agente/a1-operacion-pm`): con otra fecha que hoy, la búsqueda dice «no disponible».
 * - IP pública como adicional (decisión 30, misma rama) y la lista de IPs fijas asignadas.
 * - El mapa IP por IP de una red (qué dirección tiene cada quien).
 */
definePageMeta({ permiso: 'redes.ver' })

useHead({ title: 'Direcciones IP · ArgosIsp' })

const route = useRoute()
const { puede } = usePermisos()

/* ¿De quién es? */
const consulta = ref(typeof route.query.ip === 'string' ? route.query.ip : '')
const fecha = ref<'hoy' | 'otra'>('hoy')
const fechaOtra = ref('')
const buscando = ref(false)
const problemaBusqueda = ref<Problem | null>(null)
const encontrado = shallowRef<{ resolucion: ResolucionIp, servicio: Servicio | null, sesion: Sesion | null } | null>(null)
const buscado = ref('')

const itemsFecha: SelectItem[] = [
    { label: 'Hoy', value: 'hoy', icon: 'i-lucide-calendar' },
    { label: 'Otra fecha…', value: 'otra', icon: 'i-lucide-calendar-clock' },
]

async function buscar() {
    const ip = consulta.value.trim()
    if (!ip || fecha.value === 'otra') {
        buscado.value = ip
        encontrado.value = null
        problemaBusqueda.value = null
        return
    }
    buscando.value = true
    problemaBusqueda.value = null
    encontrado.value = null
    buscado.value = ip
    const resultado = await useIp().duenoDe(ip)
    if (!resultado.ok) {
        buscando.value = false
        problemaBusqueda.value = resultado.problema
        return
    }
    const [servicio, sesion] = await Promise.all([
        puede('servicios.ver') ? useServicios().ver(resultado.data.servicio_id) : null,
        puede('sesiones.ver') ? useSesiones().activaDe(resultado.data.servicio_id) : null,
    ])
    buscando.value = false
    encontrado.value = {
        resolucion: resultado.data,
        servicio: servicio?.ok ? servicio.data : null,
        sesion: sesion?.ok ? sesion.data : null,
    }
}

onMounted(() => {
    if (consulta.value) {
        void buscar()
    }
})

/* Redes de todos los routers (`GET /routers/:id/direccionamiento`). */
const routers = shallowRef<RouterNas[]>([])
const direcciones = ref<Record<number, DireccionamientoRouter | null>>({})
const cargando = ref(true)
const problema = ref<Problem | null>(null)

async function cargar() {
    // Las redes salen del direccionamiento de cada router (`routers.ver`); la página pide `redes.ver`.
    if (!puede('routers.ver')) {
        cargando.value = false
        problema.value = problemaSinPermiso('routers.ver')
        return
    }
    cargando.value = true
    problema.value = null
    const resultado = await leerTodas(cursor => useRouters().listar({ activo: true, limit: 200 }, cursor))
    if (!resultado.ok) {
        cargando.value = false
        problema.value = resultado.problema
        return
    }
    routers.value = resultado.data.filas
    const nuevas: Record<number, DireccionamientoRouter | null> = {}
    await Promise.all(routers.value.map(async (nas) => {
        const r = await useRouters().direccionamiento(nas.id)
        nuevas[nas.id] = r.ok ? r.data : null
    }))
    direcciones.value = nuevas
    cargando.value = false
}

onMounted(cargar)

const fallidos = computed(() => routers.value.filter(r => direcciones.value[r.id] === null))
const nombreRouter = computed(() => new Map(routers.value.map(r => [r.id, r.nombre])))

/** ¿Pública? Todo lo que no es privado (RFC 1918), CGNAT (100.64/10) ni enlace local. */
function esPublica(cidr: string): boolean {
    const [a = 0, b = 0] = (cidr.split('/')[0] ?? '').split('.').map(Number)
    return !(a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || a === 127)
}

const TODOS = 'todos'
const routerFiltro = ref<string>(TODOS)
const orden = ref<'llenas' | 'nombre'>('llenas')
const vista = ref<'ipv4' | 'ipv6' | 'fijas'>('ipv4')

const redes = computed(() => routers.value
    .filter(r => routerFiltro.value === TODOS || String(r.id) === routerFiltro.value)
    .flatMap(r => direcciones.value[r.id]?.redes_ipv4 ?? [])
    .sort((x, y) => (orden.value === 'llenas' ? y.ocupacion.porcentaje - x.ocupacion.porcentaje : x.cidr.localeCompare(y.cidr))))

const bloques = computed(() => routers.value
    .filter(r => routerFiltro.value === TODOS || String(r.id) === routerFiltro.value)
    .flatMap(r => (direcciones.value[r.id]?.bloques_ipv6 ?? []).map(b => ({ ...b, router_id: r.id }))))

const todasRedes = computed(() => routers.value.flatMap(r => direcciones.value[r.id]?.redes_ipv4 ?? []))
const contadores = computed(() => {
    const privadas = todasRedes.value.filter(r => !esPublica(r.cidr))
    const publicas = todasRedes.value.filter(r => esPublica(r.cidr))
    const suma = (lista: RedIpv4[], campo: 'asignadas' | 'total' | 'libres') => lista.reduce((t, r) => t + r.ocupacion[campo], 0)
    const pools = routers.value.flatMap(r => direcciones.value[r.id]?.bloques_ipv6.flatMap(b => b.pools) ?? [])
    return {
        privadas: { asignadas: suma(privadas, 'asignadas'), total: suma(privadas, 'total') },
        publicas: { asignadas: suma(publicas, 'asignadas'), total: suma(publicas, 'total'), libres: suma(publicas, 'libres') },
        llenas: todasRedes.value.filter(r => r.ocupacion.porcentaje >= UMBRAL_RED_LLENA),
        pools: pools.length,
    }
})

function porcentaje(asignadas: number, total: number): string {
    return total ? `${Math.round((asignadas / total) * 100)} %` : '—'
}

const pestanas = computed<TabsItem[]>(() => [
    { label: 'IPv4', value: 'ipv4', badge: { label: String(redes.value.length), color: 'neutral', variant: 'soft' } },
    { label: 'IPv6', value: 'ipv6', badge: { label: String(bloques.value.length), color: 'neutral', variant: 'soft' } },
    { label: 'IPs fijas y públicas', value: 'fijas' },
])

const itemsRouter = computed<SelectItem[]>(() => [{ label: 'Todos los routers', value: TODOS }, ...routers.value.map(r => ({ label: r.nombre, value: String(r.id) }))])
const itemsOrden: SelectItem[] = [
    { label: 'Más llenas primero', value: 'llenas' },
    { label: 'Por dirección', value: 'nombre' },
]

const columnas: TableColumn<RedIpv4>[] = [
    { accessorKey: 'cidr', header: 'Red' },
    { id: 'router', header: 'Router', meta: SOLO_ANCHO },
    { accessorKey: 'tipo', header: 'Tipo', meta: SOLO_ESCRITORIO },
    { id: 'ocupacion', header: 'Ocupación', meta: { class: { td: 'min-w-36' } } },
]

const elegida = shallowRef<RedIpv4 | null>(null)
watch(redes, (lista) => {
    if (!elegida.value || !lista.some(r => r.id === elegida.value?.id)) {
        elegida.value = lista[0] ?? null
    }
})
const detalleAbierto = ref(false)
function elegir(_evento: Event, fila: { original: RedIpv4 }) {
    elegida.value = fila.original
    detalleAbierto.value = true
}

/* Agregar o editar una red (`RedIpv4Modal`, `redes.crear` / `redes.editar`). */
const modalAbierto = ref(false)
const modalRed = shallowRef<RedIpv4 | null>(null)
const routerParaAgregar = ref<string>('')
const elegirRouterAbierto = ref(false)

function editar(red: RedIpv4) {
    if (!puede('redes.editar')) {
        return
    }
    modalRed.value = red
    modalAbierto.value = true
}

function agregar() {
    modalRed.value = null
    if (routers.value.length === 1) {
        routerParaAgregar.value = String(routers.value[0]!.id)
        modalAbierto.value = true
        return
    }
    routerParaAgregar.value = routerFiltro.value !== TODOS ? routerFiltro.value : ''
    elegirRouterAbierto.value = true
}

const routerDelModal = computed(() => modalRed.value?.router_id ?? (Number(routerParaAgregar.value) || null))
</script>

<template>
    <PanelPagina
        id="direcciones-ip"
        titulo="Direcciones IP"
        icono="i-lucide-network"
        descripcion="Todas las redes de todos los routers en un solo lugar"
    >
        <div class="flex flex-col gap-4">
            <!-- ¿De quién es? (un solo campo destacado). -->
            <section
                v-if="puede('ip.resolver')"
                class="surface-card flex flex-col gap-2 rounded-2xl p-3 sm:p-4"
                aria-label="¿De quién es esta IP?"
                data-prueba="de-quien-es"
            >
                <UForm
                    :state="{ consulta }"
                    class="flex flex-col gap-2 lg:flex-row lg:items-center"
                    @submit="buscar"
                >
                    <UInput
                        v-model="consulta"
                        icon="i-lucide-search"
                        placeholder="Escribe una IP…"
                        aria-label="IP o prefijo a buscar"
                        size="xl"
                        class="w-full font-mono lg:flex-1"
                        :ui="{ base: 'rounded-full ring-2 ring-primary/60' }"
                        autocomplete="off"
                    />
                    <div class="flex flex-wrap items-center gap-2">
                        <USelect
                            v-model="fecha"
                            :items="itemsFecha"
                            aria-label="Cuándo"
                            size="xl"
                            class="w-40 rounded-full"
                        />
                        <UInput
                            v-if="fecha === 'otra'"
                            v-model="fechaOtra"
                            type="datetime-local"
                            aria-label="Fecha y hora a consultar"
                            size="xl"
                            class="w-56"
                        />
                        <UButton
                            type="submit"
                            label="¿De quién es?"
                            size="xl"
                            class="glow-brand rounded-full px-6"
                            :loading="buscando"
                            data-prueba="buscar-ip"
                        />
                    </div>
                </UForm>
                <p class="flex items-start gap-1.5 text-xs text-muted">
                    <UIcon
                        name="i-lucide-info"
                        class="mt-0.5 size-3.5 shrink-0"
                    />
                    Escribe una IPv4, una IPv6 o un prefijo. Sirve para reclamos y requerimientos: te dice el cliente, su servicio y desde cuándo.
                </p>

                <SeccionSinApi
                    v-if="fecha === 'otra' && buscado"
                    titulo="Buscar por fecha: no disponible todavía"
                    descripcion="Decidido por el PM: por IP más fecha y hora, con permiso propio y consulta auditada. La API lo está construyendo; mientras, solo se puede saber quién la tiene hoy."
                    icono="i-lucide-calendar-clock"
                    data-prueba="ip-por-fecha-no-disponible"
                />
                <UAlert
                    v-else-if="problemaBusqueda?.status === 404"
                    color="neutral"
                    variant="subtle"
                    icon="i-lucide-search-x"
                    :title="`Nadie tiene ${buscado} ahora`"
                    description="Ni una sesión abierta ni una asignación vigente la usan."
                    data-prueba="ip-sin-dueno"
                />
                <ProblemaAlerta
                    v-else-if="problemaBusqueda"
                    :problema="problemaBusqueda"
                    :reintentar="buscar"
                    :reintentando="buscando"
                />
                <div
                    v-else-if="encontrado"
                    class="flex flex-wrap items-center gap-3 rounded-xl border border-(--ax-borde) px-4 py-3"
                    data-prueba="ip-dueno"
                >
                    <span class="font-mono text-sm font-semibold text-highlighted">{{ buscado }}</span>
                    <div class="flex min-w-0 flex-1 flex-col">
                        <span class="text-sm">
                            <span class="font-semibold text-highlighted">{{ encontrado.servicio?.cliente_nombre ?? `Cliente ${encontrado.resolucion.cliente_id}` }}</span>
                            <span class="text-muted"> · {{ encontrado.servicio ? [encontrado.servicio.user_ppp, encontrado.servicio.plan_nombre].filter(Boolean).join(' · ') : `Servicio ${encontrado.resolucion.servicio_id}` }}</span>
                        </span>
                        <span class="text-xs text-muted">
                            {{ encontrado.sesion ? `Conectada desde ${formatearFechaHora(encontrado.sesion.inicio)} (${formatearDuracion(encontrado.sesion.inicio)})` : 'Asignada al servicio, sin sesión abierta' }} · en {{ encontrado.resolucion.prefijo }}
                        </span>
                    </div>
                    <UButton
                        :to="`/servicios/${encontrado.resolucion.servicio_id}`"
                        label="Abrir"
                        variant="link"
                        trailing-icon="i-lucide-arrow-right"
                    />
                </div>
            </section>

            <div
                class="grid grid-cols-2 gap-3 lg:grid-cols-4"
                data-prueba="contadores-ips"
            >
                <TarjetaDato
                    etiqueta="IPv4 privadas"
                    icono="i-lucide-network"
                    :valor="cargando ? null : formatearEntero(contadores.privadas.asignadas)"
                    :detalle="`de ${formatearEntero(contadores.privadas.total)} · ${porcentaje(contadores.privadas.asignadas, contadores.privadas.total)}`"
                    :problema="problema"
                    @reintentar="cargar"
                />
                <TarjetaDato
                    etiqueta="IPv4 públicas"
                    icono="i-lucide-globe"
                    tono="tono-2"
                    :valor="cargando ? null : formatearEntero(contadores.publicas.asignadas)"
                    :detalle="`de ${formatearEntero(contadores.publicas.total)} · ${formatearEntero(contadores.publicas.libres)} libres`"
                    :problema="problema"
                    @reintentar="cargar"
                />
                <TarjetaDato
                    etiqueta="Redes casi llenas"
                    icono="i-lucide-triangle-alert"
                    tono="tono-aviso"
                    :valor="cargando ? null : String(contadores.llenas.length)"
                    :detalle="contadores.llenas[0] ? `${contadores.llenas[0].cidr} al ${Math.round(contadores.llenas[0].ocupacion.porcentaje)} %` : `Ninguna arriba de ${UMBRAL_RED_LLENA} %`"
                    :problema="problema"
                    @reintentar="cargar"
                />
                <TarjetaDato
                    etiqueta="Pools IPv6"
                    icono="i-lucide-globe"
                    tono="tono-exito"
                    :valor="cargando ? null : String(contadores.pools)"
                    :detalle="`en ${bloques.length} bloques`"
                    :problema="problema"
                    @reintentar="cargar"
                />
            </div>

            <UAlert
                v-if="fallidos.length"
                color="warning"
                variant="subtle"
                icon="i-lucide-triangle-alert"
                :title="`No se pudieron leer las redes de ${fallidos.map(r => r.nombre).join(', ')}`"
                description="Las cifras de arriba no las incluyen."
                :actions="[{ label: 'Reintentar', icon: 'i-lucide-refresh-cw', color: 'warning', variant: 'outline', onClick: () => void cargar() }]"
            />

            <div class="surface-card grid min-w-0 overflow-hidden rounded-2xl xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
                <div class="flex min-w-0 flex-col">
                    <div class="flex flex-col gap-3 p-3 sm:p-4 lg:flex-row lg:items-center lg:justify-between">
                        <RedPestanas
                            v-model="vista"
                            :items="pestanas"
                            etiqueta="Ver direcciones"
                            data-prueba="pestanas-ips"
                        />
                        <div class="flex flex-wrap gap-2">
                            <USelect
                                v-model="routerFiltro"
                                :items="itemsRouter"
                                icon="i-lucide-router"
                                aria-label="Filtrar por router"
                                class="w-48"
                            />
                            <USelect
                                v-if="vista === 'ipv4'"
                                v-model="orden"
                                :items="itemsOrden"
                                aria-label="Ordenar"
                                class="w-48"
                            />
                        </div>
                    </div>

                    <ProblemaAlerta
                        v-if="problema"
                        :problema="problema"
                        :reintentar="cargar"
                        :reintentando="cargando"
                        class="mx-3 mb-3 sm:mx-4"
                    />
                    <UTable
                        v-else-if="vista === 'ipv4'"
                        :data="redes"
                        :columns="columnas"
                        :loading="cargando"
                        :ui="{ thead: 'bg-(--ax-cabecera-tabla)', th: 'text-xs', td: 'py-2.5', tr: 'cursor-pointer' }"
                        data-prueba="tabla-redes"
                        @select="elegir"
                    >
                        <template #cidr-cell="{ row }">
                            <div
                                class="flex min-w-0 flex-col"
                                :class="elegida?.id === row.original.id ? 'xl:border-s-2 xl:border-primary xl:ps-2' : ''"
                            >
                                <span class="flex items-center gap-1.5">
                                    <span class="font-mono text-sm font-semibold text-highlighted">{{ row.original.cidr }}</span>
                                    <UBadge
                                        v-if="esPublica(row.original.cidr)"
                                        label="pública"
                                        color="secondary"
                                        variant="soft"
                                        size="sm"
                                    />
                                </span>
                                <span class="text-xs text-muted">{{ row.original.nombre ?? '—' }}<span class="sm:hidden"> · {{ nombreRouter.get(row.original.router_id) }}</span></span>
                            </div>
                        </template>
                        <template #router-cell="{ row }">
                            <span class="text-sm">{{ nombreRouter.get(row.original.router_id) ?? `Router ${row.original.router_id}` }}</span>
                        </template>
                        <template #tipo-cell="{ row }">
                            <UBadge
                                :label="row.original.tipo === 'pool' ? 'Pool' : 'Estático'"
                                color="neutral"
                                variant="soft"
                                size="sm"
                                class="rounded-full"
                            />
                        </template>
                        <template #ocupacion-cell="{ row }">
                            <RedOcupacion
                                :porcentaje="row.original.ocupacion.porcentaje"
                                :detalle="`${formatearEntero(row.original.ocupacion.libres)} libres`"
                            />
                        </template>
                        <template #empty>
                            <UEmpty
                                icon="i-lucide-network"
                                title="Sin redes IPv4"
                                description="Agrega la primera en la ficha de un router, pestaña «Red e IPs»."
                                variant="naked"
                            />
                        </template>
                    </UTable>
                    <ul
                        v-else-if="vista === 'ipv6'"
                        class="flex flex-col"
                        data-prueba="lista-ipv6"
                    >
                        <li
                            v-for="bloque in bloques"
                            :key="bloque.id"
                            class="flex flex-col gap-2 border-t border-(--ax-borde) px-3 py-3 sm:px-4"
                        >
                            <div class="flex flex-wrap items-center justify-between gap-2">
                                <span class="font-mono text-sm font-semibold text-highlighted">{{ bloque.prefijo }}</span>
                                <span class="text-xs text-muted">{{ nombreRouter.get(bloque.router_id) }}{{ bloque.proveedor ? ` · ${bloque.proveedor}` : '' }}</span>
                            </div>
                            <div
                                v-for="pool in bloque.pools"
                                :key="pool.id"
                                class="grid grid-cols-[minmax(0,1fr)_minmax(0,10rem)] items-center gap-3"
                            >
                                <span class="truncate font-mono text-xs text-default">{{ pool.prefijo }} · {{ pool.tipo === 'enlace' ? 'enlace' : 'delegación' }} /{{ pool.tamano_entrega }}</span>
                                <RedOcupacion
                                    :porcentaje="pool.ocupacion.porcentaje"
                                    :detalle="`${formatearEntero(pool.ocupacion.asignadas)} / ${formatearEntero(pool.ocupacion.total)}`"
                                />
                            </div>
                        </li>
                        <li
                            v-if="!bloques.length"
                            class="p-4"
                        >
                            <UEmpty
                                icon="i-lucide-globe"
                                title="Sin bloques IPv6"
                                variant="naked"
                            />
                        </li>
                    </ul>
                    <div
                        v-else
                        class="p-4"
                    >
                        <SeccionSinApi
                            titulo="IPs fijas y públicas: no disponible todavía"
                            descripcion="La IP pública como adicional cobrado (se libera al quitarla o al retirar el servicio) y la lista de IPs fijas asignadas están en construcción en la API. Las redes estáticas y públicas ya se ven en la pestaña IPv4."
                            icono="i-lucide-globe"
                        />
                    </div>

                    <div class="mt-auto flex items-center justify-between gap-2 border-t border-(--ax-borde) px-3 py-2.5 text-xs text-muted sm:px-4">
                        <span>{{ redes.length }} redes · {{ routers.length }} routers</span>
                        <UButton
                            v-if="puede('redes.crear') && routers.length"
                            label="Agregar red"
                            :icon="ICONOS.crear"
                            color="neutral"
                            variant="outline"
                            size="sm"
                            class="rounded-full"
                            data-prueba="agregar-red"
                            @click="agregar"
                        />
                    </div>
                </div>

                <!-- Detalle de la red elegida (escritorio). -->
                <aside
                    v-if="elegida && vista === 'ipv4'"
                    class="hidden flex-col gap-3 border-s border-(--ax-borde) p-4 xl:flex"
                    aria-label="Detalle de la red"
                    data-prueba="detalle-red"
                >
                    <RedIpv4Detalle
                        :red="elegida"
                        :router-nombre="nombreRouter.get(elegida.router_id) ?? null"
                        @editar="editar(elegida)"
                    />
                </aside>
            </div>
        </div>

        <USlideover
            v-if="elegida"
            v-model:open="detalleAbierto"
            :title="elegida.cidr"
            :description="nombreRouter.get(elegida.router_id)"
            class="xl:hidden"
        >
            <template #body>
                <RedIpv4Detalle
                    :red="elegida"
                    :router-nombre="nombreRouter.get(elegida.router_id) ?? null"
                    @editar="editar(elegida)"
                />
            </template>
        </USlideover>

        <UModal
            v-model:open="elegirRouterAbierto"
            title="Agregar red"
            description="¿En qué router va la red?"
        >
            <template #body>
                <USelect
                    v-model="routerParaAgregar"
                    :items="routers.map(r => ({ label: r.nombre, value: String(r.id) }))"
                    placeholder="Elige el router"
                    aria-label="Router de la red"
                    class="w-full"
                />
            </template>
            <template #footer>
                <div class="flex w-full justify-end gap-2">
                    <UButton
                        label="Cancelar"
                        color="neutral"
                        variant="ghost"
                        @click="elegirRouterAbierto = false"
                    />
                    <UButton
                        label="Seguir"
                        :disabled="!routerParaAgregar"
                        @click="elegirRouterAbierto = false; modalAbierto = true"
                    />
                </div>
            </template>
        </UModal>

        <RedIpv4Modal
            v-if="routerDelModal"
            v-model:open="modalAbierto"
            :router-id="routerDelModal"
            :red="modalRed"
            @guardado="cargar"
        />
    </PanelPagina>
</template>
