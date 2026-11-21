<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { TableColumn, TabsItem } from '@nuxt/ui'

/**
 * Ficha del router (tableros RedRouterFicha y RedRouterFichaMovil): tarjeta de cabecera con el
 * nombre, el estado, el tipo de conexión, el modo de seguridad y el control de velocidad, y las
 * acciones en una sola fila (Probar conexión, Reconciliar, Editar y «⋯»); debajo, una tarjeta con
 * pestañas segmentadas: Resumen, Conexión, Red e IPs, Velocidad, Servicios y Bitácora de comandos.
 * Es el destino del autologin desde Horus (`/routers/:id`); la pestaña va en `?pestana=` (los
 * nombres anteriores `red-acceso`, `pools` y `avanzado` llevan a la pestaña nueva que los tiene).
 * Si el router está registrado dos veces, el aviso de duplicados con «Unir»; si ya se unió a otro
 * (`unido_a_id`), el enlace al que quedó (`contratos/routers.md`). En el teléfono, Reconciliar y
 * Probar conexión quedan fijos abajo.
 */
definePageMeta({ permiso: 'routers.ver' })

const route = useRoute()
const routerId = computed(() => Number(route.params.id))

const nas = shallowRef<RouterNas | null>(null)

/** «Corte por el túnel: sí/no» con el motivo (§5 ter.3, `Router.corte_por_tunel` de A1). */
const corteTunel = computed(() => (nas.value ? presentarCorteTunel(nas.value) : null))
const cargando = ref(true)
const problema = ref<Problem | null>(null)

useHead(() => ({ title: `${nas.value?.nombre ?? 'Router'} · ArgosIsp` }))

async function cargar() {
    cargando.value = true
    problema.value = null
    const resultado = Number.isInteger(routerId.value) && routerId.value > 0
        ? await useRouters().ver(routerId.value)
        : null
    cargando.value = false
    nas.value = resultado?.ok ? resultado.data : null
    problema.value = resultado && !resultado.ok ? resultado.problema : null
}

onMounted(cargar)

/** Sube al unir para volver a leer el direccionamiento (redes y bloques que llegaron o se fueron). */
const lecturas = ref(0)

function alUnir(resultado: UnionRouters) {
    lecturas.value++
    // Si esta ficha era la del absorbido, el router que sigue en uso es el que quedó.
    if (resultado.absorbido_id === routerId.value) {
        nas.value = resultado.absorbido
        return
    }
    nas.value = resultado.router
}

/** Tras probar la conexión o generar un script: estado en línea y sección «Conexión» al día. */
const seccionConexion = useTemplateRef('seccionConexion')
async function refrescar() {
    const resultado = await useRouters().ver(routerId.value)
    if (resultado.ok) {
        nas.value = resultado.data
    }
    await seccionConexion.value?.cargar()
}

const { puede } = usePermisos()
const toast = useToast()

/**
 * Eliminar sin historial (`contratos/eliminar.md`): con `routers.eliminar` (admin) se pregunta si
 * se puede; si nunca se usó, «Eliminar», y si no, los motivos y «Desactivar» (`PUT` con
 * `activo: false`, `routers.editar`). Un router inactivo se vuelve a activar igual.
 */
const puedeEliminar = computed(() => puede('routers.eliminar'))
const eliminable = shallowRef<Eliminable | null>(null)
const problemaEliminable = ref<Problem | null>(null)
const eliminarAbierto = ref(false)
const liberaRouter = ref<string[]>([])

async function cargarEliminable() {
    const actual = nas.value
    if (!actual || !puedeEliminar.value) {
        eliminable.value = null
        return
    }
    problemaEliminable.value = null
    const resultado = await useRouters().eliminable(actual.id)
    eliminable.value = resultado.ok ? resultado.data : null
    problemaEliminable.value = resultado.ok ? null : resultado.problema
}

watch(() => [nas.value?.id, nas.value?.version], () => void cargarEliminable())

/** Lo que se libera: sus redes IPv4 y sus bloques IPv6 con sus pools (los planes se conservan). */
async function abrirEliminar() {
    const actual = nas.value
    if (!actual) {
        return
    }
    // Sin `redes.ver` / `ipv6.ver` no se listan: se dice en general.
    const [redes, bloques] = await Promise.all([
        puede('redes.ver') ? useRouters().redesIpv4(actual.id) : null,
        puede('ipv6.ver') ? useRouters().ipv6Bloques(actual.id) : null,
    ])
    liberaRouter.value = [
        ...(actual.nas_ip ? [`NAS ${actual.nas_ip}`] : []),
        ...(redes?.ok ? redes.data.map(r => `Red IPv4 ${r.cidr}`) : ['Sus redes IPv4']),
        ...(bloques?.ok ? bloques.data.map(b => `Bloque IPv6 ${b.prefijo} con sus pools`) : ['Sus bloques y pools IPv6']),
        'Los planes no se borran: solo deja de estar en ellos',
    ]
    eliminarAbierto.value = true
}

function alEliminar() {
    toast.add({ title: `${nas.value?.nombre ?? 'Router'} eliminado`, description: 'Sus redes y pools quedaron libres.', icon: 'i-lucide-trash-2', color: 'success' })
    void navigateTo('/routers')
}

const cambiarActivoAbierto = ref(false)
const cambiandoActivo = ref(false)
const problemaActivo = ref<Problem | null>(null)

async function cambiarActivo() {
    const actual = nas.value
    if (!actual) {
        return
    }
    cambiandoActivo.value = true
    problemaActivo.value = null
    const resultado = await useRouters().editar(actual.id, { version: actual.version, activo: !actual.activo })
    cambiandoActivo.value = false
    if (!resultado.ok) {
        problemaActivo.value = resultado.problema
        return
    }
    nas.value = resultado.data
    cambiarActivoAbierto.value = false
    toast.add({ title: resultado.data.activo ? `${resultado.data.nombre} activado` : `${resultado.data.nombre} desactivado`, icon: 'i-lucide-circle-check', color: 'success' })
}

watch(cambiarActivoAbierto, (valor) => {
    if (valor) {
        problemaActivo.value = null
    }
})

/* Pestañas (tablero RedRouterFicha): «Resumen» primero; la elegida va en `?pestana=`. */
const PESTANAS = ['resumen', 'conexion', 'red', 'velocidad', 'servicios', 'bitacora'] as const
type Pestana = typeof PESTANAS[number]
/** Pestañas de la ficha anterior (enlaces guardados y autologin de Horus). */
const ALIAS_PESTANA: Record<string, Pestana> = { 'red-acceso': 'red', 'pools': 'red', 'avanzado': 'conexion' }

function esPestana(valor: unknown): valor is Pestana {
    return typeof valor === 'string' && (PESTANAS as readonly string[]).includes(valor)
}

const pestana = computed<Pestana>({
    get: () => {
        const valor = route.query.pestana
        if (esPestana(valor)) {
            return valor
        }
        return typeof valor === 'string' ? (ALIAS_PESTANA[valor] ?? 'resumen') : 'resumen'
    },
    set: (valor) => {
        void navigateTo({ query: { ...route.query, pestana: valor === 'resumen' ? undefined : valor } }, { replace: true })
    },
})

function irA(valor: string) {
    if (esPestana(valor)) {
        pestana.value = valor
    }
}

const pestanas = computed<TabsItem[]>(() => [
    { label: 'Resumen', value: 'resumen', icon: 'i-lucide-house' },
    { label: 'Conexión', value: 'conexion', icon: 'i-lucide-plug' },
    { label: 'Red e IPs', value: 'red', icon: 'i-lucide-network' },
    { label: 'Velocidad', value: 'velocidad', icon: 'i-lucide-gauge' },
    ...(puede('servicios.ver') ? [{ label: 'Servicios', value: 'servicios', icon: 'i-lucide-users' }] : []),
    ...(puede('red.ver') ? [{ label: 'Bitácora de comandos', value: 'bitacora', icon: 'i-lucide-history' }] : []),
])

/* Servicios del router (pestaña Servicios): la primera página, con el enlace a la lista completa. */
const serviciosRouter = usePaginacionCursor(cursor => useServicios().listar({ router_id: routerId.value, excluir_retirados: true, limit: 25 }, cursor))
watch(pestana, (valor) => {
    if (valor === 'servicios' && puede('servicios.ver') && !serviciosRouter.filas.value.length) {
        void serviciosRouter.recargar()
    }
}, { immediate: true })
const columnasServicios: TableColumn<Servicio>[] = [
    { accessorKey: 'cliente_nombre', header: 'Cliente', meta: { class: { td: 'whitespace-normal' } } },
    { accessorKey: 'plan_nombre', header: 'Plan', meta: SOLO_ANCHO },
    { accessorKey: 'ipv4', header: 'IPv4', meta: SOLO_ESCRITORIO },
    { accessorKey: 'estado', header: 'Estado' },
]

/* Cabecera: estado y datos del equipo en una línea. */
const estadoRouter = computed(() => (nas.value ? ESTADOS_LISTA_ROUTER[estadoListaRouter(nas.value)] : null))
const lineaEquipo = computed(() => {
    const actual = nas.value
    if (!actual) {
        return ''
    }
    return [
        actual.routeros_version ? `RouterOS ${actual.routeros_version}` : 'RouterOS sin leer',
        `host ${actual.host}`,
        `NAS ${textoNas(actual)}`,
    ].join(' · ')
})

const reconciliarAbierto = ref(false)
const editarAbierto = ref(false)
const resumen = useTemplateRef('resumen')

const pruebaAbierta = ref(false)

function alActualizar(router: RouterNas) {
    nas.value = router
}

async function alProbar() {
    await refrescar()
    resumen.value?.cargar()
}
</script>

<template>
    <PanelPagina
        id="router"
        :titulo="nas?.nombre ?? 'Router'"
        icono="i-lucide-router"
        encabezado-propio
    >
        <div class="flex flex-col gap-4">
            <UAlert
                v-if="!cargando && nas?.unido_a_id"
                color="info"
                variant="subtle"
                icon="i-lucide-merge"
                title="Este router se unió a otro"
                description="Era el mismo MikroTik registrado dos veces: sus servicios, sesiones, redes y planes pasaron al router que quedó. Este registro queda desactivado con su historial."
                :actions="[{ label: 'Ver el router que quedó', to: `/routers/${nas.unido_a_id}`, icon: 'i-lucide-arrow-right', color: 'info', variant: 'outline' }]"
                data-prueba="router-unido"
            />
            <RoutersDuplicadosAviso
                v-if="!cargando && nas?.activo"
                :router-id="nas.id"
                @unido="alUnir"
            />
            <USkeleton
                v-if="cargando"
                class="h-24 w-full rounded-[1.375rem]"
            />
            <UEmpty
                v-else-if="problema?.status === 404 || (!problema && !nas)"
                icon="i-lucide-router"
                title="Router no encontrado"
                :description="`No existe un router con id ${route.params.id}.`"
                :actions="[{ label: 'Volver a routers', to: '/routers', icon: 'i-lucide-arrow-left', color: 'neutral', variant: 'subtle' }]"
            />
            <ProblemaAlerta
                v-else-if="problema"
                :problema="problema"
                :reintentar="cargar"
                :reintentando="cargando"
            />
            <template v-else-if="nas">
                <!-- Cabecera (tablero RedRouterFicha): nombre, estados y acciones en una sola fila. -->
                <header
                    class="surface-card flex flex-col gap-3 rounded-[1.375rem] p-4 sm:flex-row sm:items-center sm:justify-between sm:px-5"
                    aria-label="Router"
                    data-prueba="router-cabecera"
                >
                    <div class="flex min-w-0 items-center gap-3">
                        <span
                            class="pastilla-icono pastilla-tono size-12 shrink-0 rounded-2xl"
                            :class="estadoRouter?.tono || 'bg-(--ax-panel) text-muted'"
                        >
                            <UIcon
                                name="i-lucide-router"
                                class="size-6"
                            />
                        </span>
                        <div class="flex min-w-0 flex-col gap-1">
                            <div class="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                                <h1 class="truncate text-xl font-bold tracking-[-0.02em] text-highlighted sm:text-[1.3125rem]">
                                    {{ nas.nombre }}
                                </h1>
                                <UBadge
                                    v-if="estadoRouter"
                                    :label="estadoRouter.etiqueta"
                                    :icon="estadoRouter.icono"
                                    :color="estadoRouter.color"
                                    variant="subtle"
                                    size="sm"
                                    class="rounded-full"
                                    data-prueba="router-estado-cabecera"
                                />
                                <UBadge
                                    :label="tipoConexionCorto(nas.tipo_conexion)"
                                    color="primary"
                                    variant="soft"
                                    size="sm"
                                    class="rounded-full"
                                />
                                <UBadge
                                    :label="MODOS_SEGURIDAD[nas.modo_seguridad].etiqueta"
                                    :icon="MODOS_SEGURIDAD[nas.modo_seguridad].icono"
                                    color="primary"
                                    variant="soft"
                                    size="sm"
                                    class="rounded-full"
                                    data-prueba="router-modo-seguridad"
                                />
                                <UBadge
                                    :label="controlRouter(nas).etiqueta"
                                    color="neutral"
                                    variant="soft"
                                    size="sm"
                                    class="hidden rounded-full sm:inline-flex"
                                />
                                <UBadge
                                    v-if="!nas.activo"
                                    label="Inactivo"
                                    icon="i-lucide-circle-pause"
                                    color="neutral"
                                    variant="subtle"
                                    size="sm"
                                    class="rounded-full"
                                    data-prueba="router-estado"
                                />
                            </div>
                            <p
                                class="truncate text-[0.8125rem] text-muted"
                                data-prueba="router-nas-ip"
                            >
                                {{ lineaEquipo }}
                            </p>
                            <p class="flex flex-wrap items-center gap-1.5 text-xs text-muted">
                                <UBadge
                                    :label="`Corte ${CORTE_IDENTIFICACION[nas.corte_identificacion].etiqueta.toLowerCase()}`"
                                    :icon="CORTE_IDENTIFICACION[nas.corte_identificacion].icono"
                                    :title="CORTE_IDENTIFICACION[nas.corte_identificacion].descripcion"
                                    color="neutral"
                                    variant="outline"
                                    size="sm"
                                    class="rounded-full"
                                    data-prueba="router-corte-identificacion"
                                />
                                <UBadge
                                    v-if="corteTunel"
                                    :label="corteTunel.etiqueta"
                                    :icon="corteTunel.icono"
                                    :color="corteTunel.color"
                                    variant="outline"
                                    size="sm"
                                    class="rounded-full"
                                    :title="corteTunel.motivo ?? undefined"
                                    data-prueba="router-corte-tunel"
                                />
                                <span
                                    v-if="esSinRadius(nas)"
                                    data-prueba="router-pppoe-sin-radius"
                                >{{ PPPOE_EN_ROUTER_SIN_RADIUS }}</span>
                            </p>
                        </div>
                    </div>
                    <div class="flex shrink-0 items-center gap-2">
                        <UButton
                            v-if="puede('routers.probar_conexion')"
                            label="Probar conexión"
                            icon="i-lucide-activity"
                            color="neutral"
                            variant="outline"
                            class="hidden rounded-full sm:inline-flex"
                            data-prueba="probar-conexion-cabecera"
                            @click="pruebaAbierta = true"
                        />
                        <UButton
                            v-if="puede('routers.reconciliar')"
                            label="Reconciliar"
                            icon="i-lucide-refresh-cw"
                            color="neutral"
                            variant="outline"
                            class="hidden rounded-full lg:inline-flex"
                            data-prueba="reconciliar-cabecera"
                            @click="reconciliarAbierto = true"
                        />
                        <UButton
                            v-if="puede('routers.editar')"
                            label="Editar"
                            icon="i-lucide-pencil"
                            color="neutral"
                            variant="outline"
                            class="hidden rounded-full lg:inline-flex"
                            data-prueba="editar-router"
                            @click="editarAbierto = true"
                        />
                        <RouterAcciones
                            :router="nas"
                            solo-icono
                            @actualizado="alActualizar"
                            @probado="alProbar"
                        />
                    </div>
                </header>

                <!-- Pestañas segmentadas dentro de la tarjeta de su contenido. -->
                <section
                    class="surface-card flex min-w-0 flex-col gap-4 rounded-[1.375rem] p-3 sm:p-4"
                    aria-label="Detalle del router"
                >
                    <RedPestanas
                        v-model="pestana"
                        :items="pestanas"
                        etiqueta="Secciones del router"
                        data-prueba="pestanas-router"
                    />

                    <RouterResumen
                        v-if="pestana === 'resumen'"
                        ref="resumen"
                        :router="nas"
                        @ir-a="irA"
                    />

                    <div
                        v-else-if="pestana === 'conexion'"
                        class="flex flex-col gap-4"
                    >
                        <RouterConexionSeccion
                            ref="seccionConexion"
                            :router="nas"
                        />
                        <div class="grid gap-4 lg:grid-cols-2">
                            <RedTarjeta
                                titulo="Datos del equipo"
                                icono="i-lucide-hard-drive"
                            >
                                <dl>
                                    <RedFila
                                        etiqueta="Host"
                                        :valor="nas.host"
                                        mono
                                    />
                                    <RedFila
                                        etiqueta="API"
                                        :valor="nas.api_url ?? `https://${nas.host}`"
                                        mono
                                    />
                                    <RedFila
                                        etiqueta="Serial"
                                        :valor="nas.serial ?? 'Sin leer'"
                                        :mono="Boolean(nas.serial)"
                                    />
                                    <RedFila
                                        etiqueta="Servidor DHCP"
                                        :valor="nas.dhcp_servidor ?? 'El de la configuración'"
                                        :mono="Boolean(nas.dhcp_servidor)"
                                    />
                                    <RedFila
                                        etiqueta="Interfaz de clientes"
                                        :valor="nas.interfaz_clientes ?? 'La de la configuración'"
                                        :mono="Boolean(nas.interfaz_clientes)"
                                    />
                                    <RedFila
                                        etiqueta="Último contacto"
                                        :valor="nas.ultimo_contacto ? `${formatearFechaHora(nas.ultimo_contacto)} (${textoUltimoContacto(nas)})` : 'Nunca respondió'"
                                    />
                                </dl>
                            </RedTarjeta>
                            <RedTarjeta
                                v-if="puede('routers.editar') || puedeEliminar"
                                titulo="Baja del router"
                                icono="i-lucide-power"
                                data-prueba="router-baja"
                            >
                                <ProblemaAlerta
                                    v-if="problemaEliminable"
                                    :problema="problemaEliminable"
                                    :reintentar="cargarEliminable"
                                />
                                <p
                                    v-if="puedeEliminar && eliminable?.eliminable"
                                    class="text-sm text-muted"
                                >
                                    Nunca se usó: se puede borrar del todo.
                                </p>
                                <p
                                    v-else-if="puedeEliminar && eliminable"
                                    class="flex items-start gap-1.5 text-sm text-muted"
                                    data-prueba="no-eliminable"
                                >
                                    <UIcon
                                        name="i-lucide-history"
                                        class="mt-0.5 size-4 shrink-0"
                                    />
                                    <span>{{ textoNoEliminable('router', eliminable.motivos, !nas.activo) }}</span>
                                </p>
                                <div class="flex flex-wrap items-center gap-2">
                                    <UButton
                                        v-if="puede('routers.editar') && !eliminable?.eliminable"
                                        :label="nas.activo ? 'Desactivar' : 'Activar'"
                                        :icon="nas.activo ? 'i-lucide-circle-pause' : 'i-lucide-circle-play'"
                                        color="neutral"
                                        variant="outline"
                                        class="rounded-full"
                                        data-prueba="cambiar-activo-router"
                                        @click="cambiarActivoAbierto = true"
                                    />
                                    <UButton
                                        v-if="puedeEliminar && eliminable?.eliminable"
                                        label="Eliminar"
                                        :icon="ICONOS.eliminar"
                                        color="error"
                                        variant="outline"
                                        class="rounded-full"
                                        data-prueba="eliminar-router"
                                        @click="abrirEliminar"
                                    />
                                </div>
                            </RedTarjeta>
                        </div>
                    </div>

                    <div
                        v-else-if="pestana === 'red'"
                        class="grid gap-4 2xl:grid-cols-2"
                    >
                        <RouterDireccionamiento
                            :key="lecturas"
                            :router-id="nas.id"
                        />
                        <RouterRedAcceso
                            v-if="puede('red_acceso.ver')"
                            :router="nas"
                        />
                        <UEmpty
                            v-else
                            icon="i-lucide-lock"
                            title="Sin permiso para ver la red de acceso"
                            description="Pide a un administrador el permiso «red_acceso.ver»."
                            variant="naked"
                        />
                    </div>

                    <RouterVelocidadPanel
                        v-else-if="pestana === 'velocidad'"
                        :router="nas"
                        @actualizado="alActualizar"
                    />

                    <div
                        v-else-if="pestana === 'servicios'"
                        class="flex flex-col gap-3"
                        data-prueba="router-servicios"
                    >
                        <div class="flex flex-wrap items-center justify-between gap-2">
                            <p class="text-sm text-muted">
                                Servicios de este router que no están retirados.
                            </p>
                            <UButton
                                :to="`/servicios?router=${nas.id}`"
                                label="Ver servicios del router"
                                icon="i-lucide-arrow-right"
                                color="neutral"
                                variant="outline"
                                class="rounded-full"
                                data-prueba="ver-servicios-router"
                            />
                        </div>
                        <ProblemaAlerta
                            v-if="serviciosRouter.problema.value"
                            :problema="serviciosRouter.problema.value"
                            :reintentar="serviciosRouter.recargar"
                            :reintentando="serviciosRouter.cargando.value"
                        />
                        <template v-else>
                            <UTable
                                :data="serviciosRouter.filas.value"
                                :columns="columnasServicios"
                                :loading="serviciosRouter.cargando.value"
                                :ui="{ thead: 'bg-(--ax-cabecera-tabla)', th: 'text-xs', td: 'py-2.5' }"
                            >
                                <template #cliente_nombre-cell="{ row }">
                                    <div class="flex min-w-0 flex-col">
                                        <ULink
                                            :to="`/servicios/${row.original.id}`"
                                            class="font-semibold text-highlighted hover:text-primary"
                                        >{{ row.original.cliente_nombre ?? `Servicio ${row.original.id}` }}</ULink>
                                        <span class="font-mono text-xs text-muted">{{ row.original.codigo }}{{ row.original.user_ppp ? ` · ${row.original.user_ppp}` : '' }}</span>
                                    </div>
                                </template>
                                <template #ipv4-cell="{ row }">
                                    <span class="font-mono text-sm">{{ row.original.ipv4 ?? '—' }}</span>
                                </template>
                                <template #estado-cell="{ row }">
                                    <EstadoServicioBadge
                                        :estado="row.original.estado"
                                        size="sm"
                                    />
                                </template>
                                <template #empty>
                                    <UEmpty
                                        icon="i-lucide-wifi-off"
                                        title="Sin servicios en este router"
                                        variant="naked"
                                    />
                                </template>
                            </UTable>
                            <PaginacionCursor
                                :pagina="serviciosRouter.pagina.value"
                                :hay-anterior="serviciosRouter.hayAnterior.value"
                                :hay-siguiente="serviciosRouter.haySiguiente.value"
                                :cargando="serviciosRouter.cargando.value"
                                :filas="serviciosRouter.filas.value.length"
                                @anterior="serviciosRouter.anterior"
                                @siguiente="serviciosRouter.siguiente"
                            />
                        </template>
                    </div>

                    <RouterBitacoraComandos
                        v-else-if="pestana === 'bitacora'"
                        :router-id="nas.id"
                    />
                </section>

                <RedBarraTelefono v-if="puede('routers.probar_conexion') || puede('routers.reconciliar')">
                    <UButton
                        v-if="puede('routers.reconciliar')"
                        label="Reconciliar"
                        icon="i-lucide-refresh-cw"
                        color="neutral"
                        variant="outline"
                        size="lg"
                        class="flex-1 justify-center rounded-full"
                        @click="reconciliarAbierto = true"
                    />
                    <UButton
                        v-if="puede('routers.probar_conexion')"
                        label="Probar conexión"
                        icon="i-lucide-activity"
                        size="lg"
                        class="flex-[2] justify-center rounded-full"
                        @click="pruebaAbierta = true"
                    />
                </RedBarraTelefono>
            </template>
        </div>

        <RouterReconciliarModal
            v-if="nas && puede('routers.reconciliar')"
            v-model:open="reconciliarAbierto"
            :router="nas"
            @reconciliado="alProbar"
        />
        <RouterEditarModal
            v-if="nas && puede('routers.editar')"
            v-model:open="editarAbierto"
            :router="nas"
            @actualizado="alActualizar"
        />
        <RouterPruebaConexionModal
            v-if="nas && puede('routers.probar_conexion')"
            v-model:open="pruebaAbierta"
            :router="nas"
            @probado="alProbar"
            @actualizado="alActualizar"
        />
        <EliminarRegistroModal
            v-if="nas && puedeEliminar && eliminable?.eliminable"
            :id="nas.id"
            v-model:open="eliminarAbierto"
            tipo="router"
            :nombre="nas.nombre"
            :version="nas.version"
            :libera="liberaRouter"
            @eliminado="alEliminar"
            @recargar="cargar"
        />

        <UModal
            v-if="nas && puede('routers.editar')"
            v-model:open="cambiarActivoAbierto"
            :title="nas.activo ? `Desactivar ${nas.nombre}` : `Activar ${nas.nombre}`"
            :description="nas.activo ? 'Argos deja de enviarle comandos. Su historial se conserva y lo encuentras en «Inactivos» de la lista de routers.' : 'Argos vuelve a enviarle comandos y aparece en la lista de routers activos.'"
            :dismissible="!cambiandoActivo"
        >
            <template #body>
                <ProblemaAlerta
                    v-if="problemaActivo"
                    :problema="problemaActivo"
                    :reintentar="problemaActivo.status === 409 ? cargar : undefined"
                />
                <p
                    v-else
                    class="text-sm text-muted"
                >
                    {{ nas.activo ? 'Puedes volver a activarlo cuando quieras.' : 'Revisa que el router esté en línea antes de activarlo.' }}
                </p>
            </template>
            <template #footer>
                <div class="flex w-full justify-end gap-2">
                    <UButton
                        label="Cancelar"
                        :icon="ICONOS.cancelar"
                        color="neutral"
                        variant="ghost"
                        :disabled="cambiandoActivo"
                        @click="cambiarActivoAbierto = false"
                    />
                    <UButton
                        :label="nas.activo ? 'Desactivar' : 'Activar'"
                        :color="nas.activo ? 'warning' : 'primary'"
                        :loading="cambiandoActivo"
                        data-prueba="confirmar-activo-router"
                        @click="cambiarActivo"
                    />
                </div>
            </template>
        </UModal>
    </PanelPagina>
</template>
