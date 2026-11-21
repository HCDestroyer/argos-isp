<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { SelectItem } from '@nuxt/ui'

/**
 * Red de acceso (tablero RedAcceso, decisión 29 del PM): por dónde llega cada cliente,
 * OLT → puerto PON → VLAN → servidor PPPoE → red. Tres columnas: las OLT (y «Sin OLT»), los puertos
 * de la OLT elegida con sus VLAN y clientes, y el camino de cada VLAN del puerto elegido. Lo
 * adoptado (ya estaba en el router y Argos no lo toca) va aparte, con «Tomar control» en la ficha
 * del router. Datos: `GET /olts` y `GET /routers/:id/red-acceso` y `/direccionamiento` de cada
 * router (`red_acceso.ver`). Las OLT son para ordenar y filtrar: Argos no se conecta a ellas
 * (el equipo en vivo con SmartOLT está en construcción en `agente/a6-equipos`).
 */
definePageMeta({ permiso: 'red_acceso.ver' })

useHead({ title: 'Red de acceso · ArgosIsp' })

const { puede } = usePermisos()

const olts = shallowRef<Olt[]>([])
const routers = shallowRef<RouterNas[]>([])
const accesos = ref<Record<number, RedAccesoRouter | null>>({})
const direcciones = ref<Record<number, DireccionamientoRouter | null>>({})
const cargando = ref(true)
const problema = ref<Problem | null>(null)

async function cargar() {
    cargando.value = true
    problema.value = null
    const [resultadoOlts, resultadoRouters] = await Promise.all([
        leerTodas(cursor => useOlts().listar(cursor)),
        leerTodas(cursor => useRouters().listar({ activo: true, limit: 200 }, cursor)),
    ])
    if (!resultadoOlts.ok || !resultadoRouters.ok) {
        cargando.value = false
        problema.value = !resultadoOlts.ok ? resultadoOlts.problema : (resultadoRouters.ok ? null : resultadoRouters.problema)
        return
    }
    olts.value = resultadoOlts.data.filas
    routers.value = resultadoRouters.data.filas
    const nuevosAccesos: Record<number, RedAccesoRouter | null> = {}
    const nuevasDirecciones: Record<number, DireccionamientoRouter | null> = {}
    await Promise.all(routers.value.map(async (nas) => {
        const [acceso, dir] = await Promise.all([useRedAcceso().ver(nas.id), useRouters().direccionamiento(nas.id)])
        nuevosAccesos[nas.id] = acceso.ok ? acceso.data : null
        nuevasDirecciones[nas.id] = dir.ok ? dir.data : null
    }))
    accesos.value = nuevosAccesos
    direcciones.value = nuevasDirecciones
    cargando.value = false
    if (oltElegida.value === null) {
        oltElegida.value = olts.value[0]?.id ?? SIN_OLT
    }
}

onMounted(cargar)

const fallidos = computed(() => routers.value.filter(r => accesos.value[r.id] === null))
const nombreRouter = computed(() => new Map(routers.value.map(r => [r.id, r.nombre])))
const vlans = computed(() => routers.value.flatMap(r => accesos.value[r.id]?.vlans ?? []))
const servidores = computed(() => routers.value.flatMap(r => accesos.value[r.id]?.servidores_pppoe ?? []))
const redes = computed(() => new Map(routers.value.flatMap(r => direcciones.value[r.id]?.redes_ipv4 ?? []).map(red => [red.id, red])))

function servidoresDe(vlan: Vlan): ServidorPppoe[] {
    return servidores.value.filter(s => s.vlan_id === vlan.id)
}

function clientesDeVlan(vlan: Vlan): number {
    return servidoresDe(vlan).reduce((t, s) => t + s.servicios, 0)
}

function vlansDePuerto(puertoId: number): Vlan[] {
    return vlans.value.filter(v => v.puerto_pon_id === puertoId)
}

function clientesDePuerto(puertoId: number): number {
    return vlansDePuerto(puertoId).reduce((t, v) => t + clientesDeVlan(v), 0)
}

function clientesDeOlt(olt: Olt): number {
    return olt.puertos.reduce((t, p) => t + clientesDePuerto(p.id), 0)
}

/* «Sin OLT»: VLAN sin puerto y servidores sin VLAN. */
const SIN_OLT = 0
const vlansSinPuerto = computed(() => vlans.value.filter(v => v.puerto_pon_id === null))
const servidoresSinVlan = computed(() => servidores.value.filter(s => s.vlan_id === null))
const clientesSinOlt = computed(() => vlansSinPuerto.value.reduce((t, v) => t + clientesDeVlan(v), 0) + servidoresSinVlan.value.reduce((t, s) => t + s.servicios, 0))

const busqueda = ref('')
const oltsVistas = computed(() => {
    const texto = busqueda.value.trim().toLowerCase()
    return olts.value.filter(o => !texto || [o.nombre, o.marca, o.modelo].some(v => v?.toLowerCase().includes(texto)))
})

const oltElegida = ref<number | null>(null)
const olt = computed(() => olts.value.find(o => o.id === oltElegida.value) ?? null)
const puertoElegido = ref<number | null>(null)
watch(olt, (valor) => {
    if (!valor || !valor.puertos.some(p => p.id === puertoElegido.value)) {
        puertoElegido.value = valor?.puertos[0]?.id ?? null
    }
})
const puerto = computed(() => olt.value?.puertos.find(p => p.id === puertoElegido.value) ?? null)

/** VLAN que muestra la tercera columna: las del puerto o, en «Sin OLT», las que no tienen puerto. */
const vlansVistas = computed(() => (oltElegida.value === SIN_OLT ? vlansSinPuerto.value : (puerto.value ? vlansDePuerto(puerto.value.id) : [])))
const administradas = computed(() => vlansVistas.value.filter(v => v.estado !== 'adoptado'))
const adoptadas = computed(() => vlansVistas.value.filter(v => v.estado === 'adoptado'))

function textoRedDe(servidor: ServidorPppoe): { titulo: string, detalle: string } {
    const red = servidor.red_ipv4_id ? redes.value.get(servidor.red_ipv4_id) : undefined
    if (!red) {
        return { titulo: 'Sin red asignada', detalle: 'No se puede tomar control todavía' }
    }
    return { titulo: red.cidr, detalle: `local ${servidor.local_address ?? red.gateway_efectivo}${servidor.local_address_derivado ? ' (sale del gateway)' : ''}` }
}

/* Acciones: agregar OLT (catálogo) y detectar en un router. */
const oltsAbierto = ref(false)
const detectarAbierto = ref(false)
const routerDetectar = ref<string>('')
const descubrirAbierto = ref(false)
const routerElegido = computed(() => routers.value.find(r => String(r.id) === routerDetectar.value) ?? null)
const itemsRouter = computed<SelectItem[]>(() => routers.value.map(r => ({ label: r.nombre, value: String(r.id) })))

function detectar() {
    detectarAbierto.value = false
    descubrirAbierto.value = true
}

const vistaMovil = ref<'olts' | 'puertos' | 'vlans'>('olts')
function elegirOlt(id: number) {
    oltElegida.value = id
    vistaMovil.value = id === SIN_OLT ? 'vlans' : 'puertos'
}
function elegirPuerto(id: number) {
    puertoElegido.value = id
    vistaMovil.value = 'vlans'
}
</script>

<template>
    <PanelPagina
        id="red-acceso"
        titulo="Red de acceso"
        icono="i-lucide-cable"
        descripcion="Por dónde llega cada cliente: OLT → puerto PON → VLAN → servidor PPPoE → red"
    >
        <template #acciones>
            <UButton
                v-if="puede('red_acceso.descubrir')"
                label="Detectar en un router"
                icon="i-lucide-search"
                color="neutral"
                variant="outline"
                class="rounded-full"
                data-prueba="detectar-red-acceso"
                @click="detectarAbierto = true"
            />
            <UButton
                v-if="puede('olts.crear') || puede('olts.editar')"
                label="Agregar OLT"
                icon="i-lucide-plus"
                size="lg"
                class="glow-brand rounded-full px-5"
                data-prueba="agregar-olt"
                @click="oltsAbierto = true"
            />
        </template>

        <div class="flex flex-col gap-4">
            <ProblemaAlerta
                v-if="problema"
                :problema="problema"
                :reintentar="cargar"
                :reintentando="cargando"
            />
            <UAlert
                v-if="fallidos.length"
                color="warning"
                variant="subtle"
                icon="i-lucide-triangle-alert"
                :title="`No se pudo leer la red de acceso de ${fallidos.map(r => r.nombre).join(', ')}`"
                description="Sus VLAN y servidores no aparecen abajo."
                :actions="[{ label: 'Reintentar', icon: 'i-lucide-refresh-cw', color: 'warning', variant: 'outline', onClick: () => void cargar() }]"
            />

            <div
                v-if="!problema"
                class="grid min-w-0 gap-4 lg:grid-cols-[17rem_minmax(0,1fr)] 2xl:grid-cols-[17rem_minmax(0,22rem)_minmax(0,1fr)]"
            >
                <!-- 1 · OLT. -->
                <section
                    class="surface-card flex min-w-0 flex-col overflow-hidden rounded-2xl"
                    :class="vistaMovil === 'olts' ? 'flex' : 'hidden lg:flex'"
                    aria-label="OLT"
                    data-prueba="columna-olts"
                >
                    <div class="p-3">
                        <UInput
                            v-model="busqueda"
                            icon="i-lucide-search"
                            placeholder="Buscar OLT…"
                            aria-label="Buscar OLT"
                            class="w-full"
                            :ui="{ base: 'rounded-full' }"
                        />
                    </div>
                    <USkeleton
                        v-if="cargando"
                        class="mx-3 mb-3 h-32"
                    />
                    <ul
                        v-else
                        class="flex flex-col"
                    >
                        <li
                            v-for="item in oltsVistas"
                            :key="item.id"
                        >
                            <UButton
                                color="neutral"
                                variant="ghost"
                                block
                                class="justify-start gap-3 rounded-none border-s-2 px-3 py-3 text-start"
                                :class="oltElegida === item.id ? 'border-primary bg-primary/5' : 'border-transparent'"
                                :aria-pressed="oltElegida === item.id"
                                @click="elegirOlt(item.id)"
                            >
                                <span class="pastilla-icono pastilla-tono tono-marca size-9 shrink-0 rounded-xl">
                                    <UIcon
                                        name="i-lucide-server"
                                        class="size-4"
                                    />
                                </span>
                                <span class="flex min-w-0 flex-1 flex-col">
                                    <span class="truncate font-semibold text-highlighted">{{ item.nombre }}</span>
                                    <span class="truncate text-xs text-muted">{{ [item.marca, item.modelo].filter(Boolean).join(' ') || `${item.puertos.length} puertos` }}</span>
                                </span>
                                <span class="text-sm font-semibold text-highlighted tabular-nums">{{ formatearEntero(clientesDeOlt(item)) }}</span>
                            </UButton>
                        </li>
                        <li>
                            <UButton
                                color="neutral"
                                variant="ghost"
                                block
                                class="justify-start gap-3 rounded-none border-s-2 px-3 py-3 text-start"
                                :class="oltElegida === SIN_OLT ? 'border-primary bg-primary/5' : 'border-transparent'"
                                :aria-pressed="oltElegida === SIN_OLT"
                                data-prueba="sin-olt"
                                @click="elegirOlt(SIN_OLT)"
                            >
                                <span class="pastilla-icono size-9 shrink-0 rounded-xl bg-(--ax-panel) text-muted">
                                    <UIcon
                                        name="i-lucide-server-off"
                                        class="size-4"
                                    />
                                </span>
                                <span class="flex min-w-0 flex-1 flex-col">
                                    <span class="font-semibold text-highlighted">Sin OLT</span>
                                    <span class="text-xs text-muted">Radio, cobre o sin puerto</span>
                                </span>
                                <span class="text-sm font-semibold text-highlighted tabular-nums">{{ formatearEntero(clientesSinOlt) }}</span>
                            </UButton>
                        </li>
                    </ul>
                    <p class="mt-auto border-t border-(--ax-borde) p-3 text-xs text-muted">
                        Las OLT son para ordenar y filtrar: Argos no se conecta a ellas (SmartOLT llegará después).
                    </p>
                </section>

                <!-- 2 · Puertos de la OLT. -->
                <section
                    v-if="oltElegida !== SIN_OLT"
                    class="surface-card min-w-0 flex-col overflow-hidden rounded-2xl"
                    :class="vistaMovil === 'puertos' ? 'flex' : 'hidden 2xl:flex'"
                    aria-label="Puertos PON"
                    data-prueba="columna-puertos"
                >
                    <div class="flex items-center justify-between gap-2 border-b border-(--ax-borde) p-3">
                        <div class="flex min-w-0 items-center gap-2">
                            <UButton
                                icon="i-lucide-chevron-left"
                                color="neutral"
                                variant="ghost"
                                size="sm"
                                class="rounded-full lg:hidden"
                                aria-label="Volver a las OLT"
                                @click="vistaMovil = 'olts'"
                            />
                            <div class="flex min-w-0 flex-col">
                                <span class="truncate font-semibold text-highlighted">{{ olt?.nombre ?? 'Elige una OLT' }}</span>
                                <span
                                    v-if="olt"
                                    class="truncate text-xs text-muted"
                                >{{ [olt.marca, olt.modelo].filter(Boolean).join(' ') }}{{ olt.marca || olt.modelo ? ' · ' : '' }}{{ olt.puertos.length }} puertos</span>
                            </div>
                        </div>
                        <UButton
                            v-if="olt && puede('olts.editar')"
                            label="Puerto"
                            icon="i-lucide-plus"
                            color="neutral"
                            variant="outline"
                            size="sm"
                            class="rounded-full"
                            @click="oltsAbierto = true"
                        />
                    </div>
                    <div class="grid grid-cols-[5rem_minmax(0,1fr)_4rem] gap-2 bg-(--ax-cabecera-tabla) px-3 py-2 text-xs font-semibold tracking-wide text-muted uppercase">
                        <span>Puerto</span><span>VLAN (máx. 2)</span><span class="text-end">Clientes</span>
                    </div>
                    <ul class="flex flex-col">
                        <li
                            v-for="p in olt?.puertos ?? []"
                            :key="p.id"
                        >
                            <UButton
                                color="neutral"
                                variant="ghost"
                                block
                                class="grid grid-cols-[5rem_minmax(0,1fr)_4rem] items-center gap-2 rounded-none border-s-2 px-3 py-2.5 text-start"
                                :class="puertoElegido === p.id ? 'border-primary bg-primary/5' : 'border-transparent'"
                                :aria-pressed="puertoElegido === p.id"
                                @click="elegirPuerto(p.id)"
                            >
                                <span class="font-mono text-sm font-semibold text-highlighted">{{ p.identificador }}</span>
                                <span class="flex flex-wrap gap-1">
                                    <UBadge
                                        v-for="v in vlansDePuerto(p.id)"
                                        :key="v.id"
                                        :label="`VLAN ${v.vlan_id}`"
                                        color="primary"
                                        variant="soft"
                                        size="sm"
                                    />
                                    <span
                                        v-if="!vlansDePuerto(p.id).length"
                                        class="text-xs text-muted"
                                    >Sin VLAN</span>
                                </span>
                                <span class="text-end text-sm font-semibold text-highlighted tabular-nums">{{ formatearEntero(clientesDePuerto(p.id)) }}</span>
                            </UButton>
                        </li>
                        <li
                            v-if="olt && !olt.puertos.length"
                            class="p-4"
                        >
                            <UEmpty
                                icon="i-lucide-cable"
                                title="Sin puertos"
                                description="Agrega sus puertos PON para ordenar las VLAN."
                                variant="naked"
                            />
                        </li>
                    </ul>
                </section>

                <!-- 3 · El camino de cada VLAN. -->
                <section
                    class="surface-card min-w-0 flex-col gap-3 overflow-hidden rounded-2xl p-3 sm:p-4 lg:col-start-2 2xl:col-start-auto"
                    :class="vistaMovil === 'vlans' ? 'flex' : 'hidden lg:flex'"
                    :aria-label="oltElegida === SIN_OLT ? 'Sin OLT' : `Puerto ${puerto?.identificador ?? ''}`"
                    data-prueba="columna-vlans"
                >
                    <div class="flex items-center gap-2">
                        <UButton
                            icon="i-lucide-chevron-left"
                            color="neutral"
                            variant="ghost"
                            size="sm"
                            class="rounded-full lg:hidden"
                            aria-label="Volver"
                            @click="vistaMovil = oltElegida === SIN_OLT ? 'olts' : 'puertos'"
                        />
                        <div class="flex min-w-0 flex-col">
                            <span class="font-semibold text-highlighted">{{ oltElegida === SIN_OLT ? 'Sin OLT' : (puerto ? `Puerto PON ${puerto.identificador}` : 'Elige un puerto') }}</span>
                            <span class="text-xs text-muted">{{ formatearEntero(vlansVistas.reduce((t, v) => t + clientesDeVlan(v), 0)) }} clientes · {{ vlansVistas.length }} VLAN{{ puerto && vlansVistas.length >= 2 ? ' (lleno)' : '' }}</span>
                        </div>
                    </div>

                    <div
                        v-for="vlan in administradas"
                        :key="vlan.id"
                        class="flex flex-col gap-2"
                        :data-vlan="vlan.vlan_id"
                    >
                        <div class="flex flex-wrap items-center gap-2 text-sm">
                            <UBadge
                                :label="`VLAN ${vlan.vlan_id}`"
                                color="primary"
                                variant="soft"
                            />
                            <UBadge
                                label="Administrado"
                                icon="i-lucide-shield-check"
                                color="success"
                                variant="soft"
                            />
                            <span class="text-xs text-muted">{{ vlan.nombre }} · {{ nombreRouter.get(vlan.router_id) }} · {{ vlan.interfaz_padre }}</span>
                        </div>
                        <div
                            v-for="servidor in servidoresDe(vlan)"
                            :key="servidor.id"
                            class="grid items-stretch gap-2 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_auto_minmax(0,0.8fr)]"
                        >
                            <div class="flex min-w-0 flex-col rounded-xl border border-(--ax-borde) px-3 py-2">
                                <span class="flex items-center gap-1 text-xs text-muted"><UIcon
                                    name="i-lucide-server"
                                    class="size-3.5"
                                />Servidor PPPoE</span>
                                <span class="truncate font-semibold text-highlighted">{{ servidor.nombre }}</span>
                                <span class="truncate text-xs text-muted">{{ nombreRouter.get(servidor.router_id) }} · {{ servidor.interfaz }}</span>
                            </div>
                            <UIcon
                                name="i-lucide-chevron-right"
                                class="hidden size-4 self-center text-dimmed sm:block"
                            />
                            <div class="flex min-w-0 flex-col rounded-xl border border-(--ax-borde) px-3 py-2">
                                <span class="flex items-center gap-1 text-xs text-muted"><UIcon
                                    name="i-lucide-network"
                                    class="size-3.5"
                                />Red IPv4{{ servidor.ipv6_pool_delegacion_id ? ' + IPv6' : '' }}</span>
                                <span class="truncate font-mono font-semibold text-highlighted">{{ textoRedDe(servidor).titulo }}</span>
                                <span class="truncate text-xs text-muted">{{ textoRedDe(servidor).detalle }}</span>
                            </div>
                            <UIcon
                                name="i-lucide-chevron-right"
                                class="hidden size-4 self-center text-dimmed sm:block"
                            />
                            <div class="flex min-w-0 flex-col rounded-xl border border-(--ax-borde) px-3 py-2">
                                <span class="flex items-center gap-1 text-xs text-muted"><UIcon
                                    name="i-lucide-users"
                                    class="size-3.5"
                                />Clientes</span>
                                <span class="font-semibold text-highlighted tabular-nums">{{ formatearEntero(servidor.servicios) }}</span>
                            </div>
                        </div>
                        <p
                            v-if="!servidoresDe(vlan).length"
                            class="text-xs text-muted"
                        >
                            Sin servidor PPPoE en esta VLAN.
                        </p>
                    </div>

                    <template v-if="adoptadas.length">
                        <h3 class="mt-2 border-t border-dashed border-(--ax-borde) pt-3 text-xs font-semibold tracking-[0.06em] text-muted uppercase">
                            Ya estaba en el router · Argos no lo toca
                        </h3>
                        <div
                            v-for="vlan in adoptadas"
                            :key="vlan.id"
                            class="flex flex-col gap-2 rounded-xl border border-warning/40 bg-warning/10 p-3 sm:flex-row sm:items-center"
                        >
                            <span class="pastilla-icono pastilla-tono tono-aviso size-9 shrink-0 rounded-xl">
                                <UIcon
                                    name="i-lucide-layers"
                                    class="size-4"
                                />
                            </span>
                            <div class="flex min-w-0 flex-1 flex-col">
                                <span class="font-semibold text-highlighted">VLAN {{ vlan.vlan_id }} «{{ vlan.nombre }}»{{ servidoresDe(vlan)[0] ? ` → ${servidoresDe(vlan)[0]!.nombre}` : '' }}</span>
                                <span class="text-xs text-warning">Argos la conoce pero no la toca. {{ formatearEntero(clientesDeVlan(vlan)) }} clientes. Para que la administre, toma el control desde el router.</span>
                            </div>
                            <UButton
                                v-if="puede('red_acceso.tomar_control') && puede('routers.ver')"
                                :to="`/routers/${vlan.router_id}?pestana=red`"
                                label="Tomar control"
                                color="neutral"
                                variant="outline"
                                size="sm"
                                class="rounded-full"
                            />
                        </div>
                        <p class="text-xs text-muted">
                            «Tomar control» muestra antes qué cambiaría en el router, propiedad por propiedad.
                        </p>
                    </template>

                    <template v-if="oltElegida === SIN_OLT && servidoresSinVlan.length">
                        <h3 class="mt-2 text-xs font-semibold tracking-[0.06em] text-muted uppercase">
                            Servidores PPPoE sin VLAN
                        </h3>
                        <div
                            v-for="servidor in servidoresSinVlan"
                            :key="servidor.id"
                            class="flex items-center justify-between gap-2 rounded-xl border border-(--ax-borde) px-3 py-2"
                        >
                            <span class="flex min-w-0 flex-col">
                                <span class="truncate font-semibold text-highlighted">{{ servidor.nombre }}</span>
                                <span class="truncate text-xs text-muted">{{ nombreRouter.get(servidor.router_id) }} · {{ servidor.interfaz }} · {{ textoRedDe(servidor).titulo }}</span>
                            </span>
                            <span class="text-sm font-semibold tabular-nums">{{ formatearEntero(servidor.servicios) }}</span>
                        </div>
                    </template>

                    <UEmpty
                        v-if="!cargando && !vlansVistas.length && !(oltElegida === SIN_OLT && servidoresSinVlan.length)"
                        icon="i-lucide-layers"
                        title="Sin VLAN aquí"
                        :description="oltElegida === SIN_OLT ? 'Todas las VLAN tienen su puerto PON.' : 'Asigna VLAN a este puerto desde la ficha del router, pestaña «Red e IPs».'"
                        variant="naked"
                    />
                </section>
            </div>
        </div>

        <OltsSlideover
            v-model:open="oltsAbierto"
            @cambiado="cargar"
        />

        <UModal
            v-model:open="detectarAbierto"
            title="Detectar en un router"
            description="Argos lee las VLAN y los servidores PPPoE del router y te muestra lo que no conocía. Nada se toca hasta que lo importes."
        >
            <template #body>
                <USelect
                    v-model="routerDetectar"
                    :items="itemsRouter"
                    placeholder="Elige el router"
                    aria-label="Router"
                    class="w-full"
                />
            </template>
            <template #footer>
                <div class="flex w-full justify-end gap-2">
                    <UButton
                        label="Cancelar"
                        color="neutral"
                        variant="ghost"
                        @click="detectarAbierto = false"
                    />
                    <UButton
                        label="Detectar"
                        icon="i-lucide-search"
                        :disabled="!routerDetectar"
                        @click="detectar"
                    />
                </div>
            </template>
        </UModal>
        <RedAccesoDescubrir
            v-if="routerElegido"
            v-model:open="descubrirAbierto"
            :router="routerElegido"
            :direccionamiento="direcciones[routerElegido.id] ?? null"
            @importado="cargar"
        />
    </PanelPagina>
</template>
