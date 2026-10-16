<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { SelectItem } from '@nuxt/ui'

/**
 * Migración de router (piloto, semana 3). Solo lectura: por router, cuántos servicios tiene,
 * cuántos tienen sesión PPPoE abierta, cuántos no han tenido sesión desde que el router apunta al
 * nuevo `aaa` (fecha que escribe el operador: la API no la guarda) y los errores recientes de red
 * que registra la bitácora. `audit.red` (la respuesta del equipo a cada CoA, Disconnect o comando)
 * no tiene endpoint: pedido a A2 en `.claude/integration/a4.md`. Ningún número se muestra si su
 * lista no se pudo leer completa.
 */
definePageMeta({ permiso: 'routers.ver' })

useHead({ title: 'Migración de router · ArgosIsp' })

const route = useRoute()
const router = useRouter()
const { puede, enlace } = usePermisos()

type Lectura<T> = LecturaMigracion<T>

/* Routers y filtros en la URL (`?router=&desde=`). */
const routers = shallowRef<RouterNas[]>([])
const problemaRouters = ref<Problem | null>(null)
const cargandoRouters = ref(true)
const routerId = ref<number | undefined>(Number(route.query.router) || undefined)
const desdeLocal = ref(typeof route.query.desde === 'string' ? route.query.desde : '')
const desde = computed(() => instanteGuatemala(desdeLocal.value))
const desdeInvalido = computed(() => desdeLocal.value !== '' && desde.value === null)
const routerActual = computed(() => routers.value.find(r => r.id === routerId.value) ?? null)
const itemsRouters = computed<SelectItem[]>(() => routers.value.map(r => ({ label: `${r.nombre} · NAS ${r.nas_ip}`, value: r.id })))

/* Lecturas por router. */
const servicios = shallowRef<Lectura<Servicio[]>>({ estado: 'cargando' })
const activas = shallowRef<Lectura<Set<number>>>({ estado: 'cargando' })
const historial = shallowRef<Lectura<Sesion[]>>({ estado: 'cargando' })
const errores = shallowRef<Lectura<AccionAuditoria[]>>({ estado: 'cargando' })

const vigentes = computed(() => (servicios.value.estado === 'ok' ? serviciosVigentes(servicios.value.valor) : null))
const pppoe = computed(() => vigentes.value?.filter(esPppoe) ?? null)
const idsServicios = computed(() => new Set((vigentes.value ?? []).map(s => s.id)))
const conSesion = computed(() => (activas.value.estado === 'ok' && pppoe.value
    ? pppoe.value.filter(s => (activas.value.estado === 'ok' ? activas.value.valor.has(s.id) : false)).length
    : null))
const pendientes = computed(() => (historial.value.estado === 'ok' && pppoe.value && desde.value
    ? sinSesionDesde(pppoe.value, historial.value.valor, desde.value)
    : null))

/** Errores recientes: desde la fecha del cambio o, sin ella, los últimos 7 días. */
const desdeErrores = computed(() => desde.value ?? new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString())

let solicitud = 0

async function cargarRouters() {
    cargandoRouters.value = true
    const resultado = await leerTodas(cursor => useRouters().listar({}, cursor))
    cargandoRouters.value = false
    problemaRouters.value = resultado.ok ? null : resultado.problema
    routers.value = resultado.ok ? resultado.data.filas : []
    if (!routerId.value && routers.value[0]) {
        routerId.value = routers.value[0].id
    }
}

async function cargarServicios(id: number, actual: number) {
    if (!puede('servicios.ver')) {
        servicios.value = { estado: 'sin_permiso', permiso: 'servicios.ver' }
        return
    }
    servicios.value = { estado: 'cargando' }
    const resultado = await leerTodas(cursor => useServicios().listar({ router_id: id, limit: 200 }, cursor))
    if (actual !== solicitud) {
        return
    }
    servicios.value = !resultado.ok ? { estado: 'error', problema: resultado.problema } : resultado.data.completa ? { estado: 'ok', valor: resultado.data.filas } : { estado: 'incompleta' }
}

async function cargarActivas(id: number, actual: number) {
    if (!puede('sesiones.ver')) {
        activas.value = { estado: 'sin_permiso', permiso: 'sesiones.ver' }
        return
    }
    activas.value = { estado: 'cargando' }
    const resultado = await leerTodas(cursor => useSesiones().listar({ router_id: id, activa: true, limit: 200 }, cursor))
    if (actual !== solicitud) {
        return
    }
    activas.value = !resultado.ok ? { estado: 'error', problema: resultado.problema } : resultado.data.completa ? { estado: 'ok', valor: conSesionActiva(resultado.data.filas) } : { estado: 'incompleta' }
}

async function cargarHistorial(id: number, actual: number) {
    if (!puede('sesiones.ver')) {
        historial.value = { estado: 'sin_permiso', permiso: 'sesiones.ver' }
        return
    }
    if (!desde.value) {
        historial.value = { estado: 'cargando' }
        return
    }
    historial.value = { estado: 'cargando' }
    // `GET /sesiones` no filtra por fecha: se leen todas las del router (pedido a A2).
    const resultado = await leerTodas(cursor => useSesiones().listar({ router_id: id, limit: 200 }, cursor))
    if (actual !== solicitud) {
        return
    }
    historial.value = !resultado.ok ? { estado: 'error', problema: resultado.problema } : resultado.data.completa ? { estado: 'ok', valor: resultado.data.filas } : { estado: 'incompleta' }
}

async function cargarErrores(id: number, actual: number) {
    if (!puede('bitacora.ver')) {
        errores.value = { estado: 'sin_permiso', permiso: 'bitacora.ver' }
        return
    }
    errores.value = { estado: 'cargando' }
    const resultados = await Promise.all(ACCIONES_RED.map(accion => useBitacora().acciones({ accion, desde: desdeErrores.value, limit: 200 })))
    if (actual !== solicitud) {
        return
    }
    const fallo = resultados.find(r => !r.ok)
    if (fallo && !fallo.ok) {
        errores.value = { estado: 'error', problema: fallo.problema }
        return
    }
    const filas = resultados.flatMap(r => (r.ok ? r.data.data : []))
    errores.value = { estado: 'ok', valor: erroresDelRouter(filas, id, idsServicios.value) }
}

async function cargar() {
    const id = routerId.value
    if (!id) {
        return
    }
    const actual = ++solicitud
    await Promise.all([cargarServicios(id, actual), cargarActivas(id, actual), cargarHistorial(id, actual)])
    // Los errores de servicios se reconocen por los ids del router: van después de la lista de servicios.
    await cargarErrores(id, actual)
}

watch([routerId, desde], () => {
    const query: Record<string, string> = {}
    if (routerId.value) {
        query.router = String(routerId.value)
    }
    if (desdeLocal.value && desde.value) {
        query.desde = desdeLocal.value
    }
    void router.replace({ query })
    void cargar()
})

onMounted(async () => {
    await cargarRouters()
    await cargar()
})

function plural(cantidad: number, singular: string, varios: string): string {
    return `${cantidad} ${cantidad === 1 ? singular : varios}`
}
</script>

<template>
    <PanelPagina
        id="migracion-router"
        titulo="Migración de router"
        icono="i-lucide-arrow-right-left"
    >
        <template #acciones>
            <UButton
                to="/routers"
                label="Routers"
                icon="i-lucide-arrow-left"
                color="neutral"
                variant="ghost"
                class="hidden sm:inline-flex"
            />
        </template>

        <div
            class="flex flex-col gap-6"
            data-prueba="migracion-routers"
        >
            <p class="max-w-3xl text-sm text-muted">
                Solo lectura. Sigue a un router mientras pasa al nuevo servidor RADIUS (<span class="font-mono">aaa</span>):
                quién ya volvió a conectarse, quién no, y qué falló en la red. Los números salen de las listas de la API;
                si una no se pudo leer, se muestra el error en lugar del número.
            </p>

            <ProblemaAlerta
                v-if="problemaRouters"
                :problema="problemaRouters"
                :reintentar="cargarRouters"
                :reintentando="cargandoRouters"
            />

            <div
                v-else
                class="grid gap-4 sm:grid-cols-2 lg:max-w-3xl"
            >
                <UFormField
                    label="Router"
                    name="router"
                >
                    <USelect
                        v-model="routerId"
                        :items="itemsRouters"
                        :loading="cargandoRouters"
                        placeholder="Elige un router"
                        class="w-full"
                        data-prueba="migracion-router"
                    />
                </UFormField>
                <UFormField
                    label="Apunta al nuevo aaa desde"
                    name="desde"
                    help="Fecha y hora de Guatemala del cambio. La API no la guarda todavía."
                    :error="desdeInvalido ? 'Fecha y hora no válidas' : undefined"
                >
                    <UInput
                        v-model="desdeLocal"
                        type="datetime-local"
                        class="w-full"
                        data-prueba="migracion-desde"
                    />
                </UFormField>
            </div>

            <template v-if="routerActual">
                <div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                    <!-- Servicios -->
                    <div class="flex min-w-0 flex-col gap-1 rounded-lg border border-default p-4">
                        <span class="flex items-center gap-1.5 text-sm text-muted">
                            <UIcon
                                name="i-lucide-wifi"
                                class="size-4"
                            />
                            Servicios del router
                        </span>
                        <MigracionLectura
                            :lectura="servicios"
                            @reintentar="cargar"
                        >
                            <p
                                class="text-2xl font-semibold text-highlighted tabular-nums"
                                data-prueba="migracion-servicios"
                            >
                                {{ vigentes?.length }}
                            </p>
                            <p class="text-xs text-muted">
                                {{ plural(pppoe?.length ?? 0, 'PPPoE', 'PPPoE') }} · {{ (vigentes?.length ?? 0) - (pppoe?.length ?? 0) }} WISP (sin RADIUS) · sin contar retirados
                            </p>
                        </MigracionLectura>
                    </div>

                    <!-- Con sesión activa -->
                    <div class="flex min-w-0 flex-col gap-1 rounded-lg border border-default p-4">
                        <span class="flex items-center gap-1.5 text-sm text-muted">
                            <UIcon
                                name="i-lucide-plug"
                                class="size-4"
                            />
                            Con sesión PPPoE activa
                        </span>
                        <MigracionLectura
                            :lectura="servicios.estado === 'ok' ? activas : servicios"
                            @reintentar="cargar"
                        >
                            <p
                                class="text-2xl font-semibold text-highlighted tabular-nums"
                                data-prueba="migracion-activas"
                            >
                                {{ conSesion }}
                            </p>
                            <p class="text-xs text-muted">
                                de {{ plural(pppoe?.length ?? 0, 'servicio PPPoE', 'servicios PPPoE') }}
                            </p>
                        </MigracionLectura>
                    </div>

                    <!-- Sin sesión desde el cambio -->
                    <div class="flex min-w-0 flex-col gap-1 rounded-lg border border-default p-4">
                        <span class="flex items-center gap-1.5 text-sm text-muted">
                            <UIcon
                                name="i-lucide-unplug"
                                class="size-4"
                            />
                            Sin sesión desde el cambio
                        </span>
                        <p
                            v-if="!desde"
                            class="text-sm text-muted"
                            data-prueba="migracion-sin-fecha"
                        >
                            Escribe desde cuándo el router apunta al nuevo aaa para contarlos.
                        </p>
                        <MigracionLectura
                            v-else
                            :lectura="servicios.estado === 'ok' ? historial : servicios"
                            @reintentar="cargar"
                        >
                            <p
                                class="text-2xl font-semibold tabular-nums"
                                :class="pendientes?.length ? 'text-warning' : 'text-highlighted'"
                                data-prueba="migracion-pendientes"
                            >
                                {{ pendientes?.length }}
                            </p>
                            <p class="text-xs text-muted">
                                PPPoE sin sesión abierta ni cerrada después del {{ formatearFechaHora(desde) }}
                            </p>
                        </MigracionLectura>
                    </div>

                    <!-- Errores -->
                    <div class="flex min-w-0 flex-col gap-1 rounded-lg border border-default p-4">
                        <span class="flex items-center gap-1.5 text-sm text-muted">
                            <UIcon
                                name="i-lucide-triangle-alert"
                                class="size-4"
                            />
                            Errores de red en la bitácora
                        </span>
                        <MigracionLectura
                            :lectura="servicios.estado === 'ok' || errores.estado === 'sin_permiso' ? errores : servicios"
                            @reintentar="cargar"
                        >
                            <p
                                class="text-2xl font-semibold tabular-nums"
                                :class="errores.estado === 'ok' && errores.valor.length ? 'text-error' : 'text-highlighted'"
                                data-prueba="migracion-errores"
                            >
                                {{ errores.estado === 'ok' ? errores.valor.length : '' }}
                            </p>
                            <p class="text-xs text-muted">
                                {{ desde ? 'Desde el cambio' : 'Últimos 7 días' }}; hasta 200 registros por acción
                            </p>
                        </MigracionLectura>
                    </div>
                </div>

                <UAlert
                    color="neutral"
                    variant="subtle"
                    icon="i-lucide-info"
                    title="Falta la respuesta de los equipos (audit.red)"
                    description="Los CoA y Disconnect que manda el servicio coa y los comandos a RouterOS guardan la respuesta del equipo en audit.red, pero la API todavía no la expone. Aquí solo se ven los errores que quedaron en la bitácora (aplicar en RouterOS, reconciliar, cambiar de modo y desconectar). Pedido a A2."
                    data-prueba="migracion-sin-red"
                />

                <section
                    v-if="pendientes && pendientes.length"
                    class="flex flex-col gap-2"
                    aria-labelledby="titulo-pendientes"
                >
                    <h3
                        id="titulo-pendientes"
                        class="text-sm font-semibold text-highlighted"
                    >
                        Servicios PPPoE que no se han conectado desde el cambio
                    </h3>
                    <ul
                        class="flex flex-col divide-y divide-default rounded-lg border border-default"
                        data-prueba="migracion-lista-pendientes"
                    >
                        <li
                            v-for="servicio in pendientes.slice(0, 100)"
                            :key="servicio.id"
                            class="flex flex-wrap items-center justify-between gap-2 px-3 py-2"
                        >
                            <div class="flex min-w-0 flex-col">
                                <ULink
                                    :to="enlace(`/servicios/${servicio.id}`)"
                                    class="truncate text-sm font-medium text-highlighted"
                                >
                                    {{ etiquetaServicio(servicio) }}
                                </ULink>
                                <span class="truncate text-xs text-muted">{{ servicio.cliente_nombre ?? `Cliente #${servicio.cliente_id}` }} · {{ servicio.ipv4 ?? 'sin IPv4' }}</span>
                            </div>
                            <EstadoServicioBadge :estado="servicio.estado" />
                        </li>
                    </ul>
                    <p
                        v-if="pendientes.length > 100"
                        class="text-xs text-muted"
                    >
                        Y {{ pendientes.length - 100 }} más.
                    </p>
                </section>

                <section
                    v-if="errores.estado === 'ok' && errores.valor.length"
                    class="flex flex-col gap-2"
                    aria-labelledby="titulo-errores"
                >
                    <h3
                        id="titulo-errores"
                        class="text-sm font-semibold text-highlighted"
                    >
                        Errores recientes
                    </h3>
                    <ul
                        class="flex flex-col divide-y divide-default rounded-lg border border-default"
                        data-prueba="migracion-lista-errores"
                    >
                        <li
                            v-for="accion in errores.valor.slice(0, 50)"
                            :key="accion.id"
                            class="flex flex-col gap-0.5 px-3 py-2"
                        >
                            <span class="flex flex-wrap items-center gap-x-2 text-sm font-medium text-highlighted">
                                {{ tituloAccion(accion) }}
                                <span class="text-xs font-normal text-muted">{{ formatearFechaHora(accion.created_at) }} · {{ etiquetaEntidad(accion) }}</span>
                            </span>
                            <span class="text-xs break-words text-error">{{ accion.error ?? 'sin detalle' }}</span>
                        </li>
                    </ul>
                </section>
            </template>
        </div>
    </PanelPagina>
</template>
