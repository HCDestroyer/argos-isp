<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'

/**
 * Pestaña «Resumen» de la ficha del router (tablero RedRouterFicha): contadores de contacto, túnel
 * y API, RADIUS y CoA, sesiones abiertas e IPs ocupadas; clientes conectados ahora; el equipo; lo
 * que pide atención; las direcciones y lo último que Argos le mandó.
 *
 * El uso del router (CPU, memoria, clientes en 24 h) lo mide Horus (decisión 27 del PM): aquí solo
 * va el enlace «Ver en Horus», sin historial propio ni cifras inventadas. Cada bloque lee su
 * endpoint con su permiso; si falla, dice que no se pudo leer con «Reintentar».
 */
const props = defineProps<{
    router: RouterNas
}>()

const emit = defineEmits<{
    irA: [pestana: string]
}>()

const { puede } = usePermisos()

const conexion = shallowRef<ConexionRouter | null>(null)
const problemaConexion = ref<Problem | null>(null)
const sesiones = shallowRef<ResumenSesionesRouter | null>(null)
const problemaSesiones = ref<Problem | null>(null)
const direcciones = shallowRef<DireccionamientoRouter | null>(null)
const problemaDirecciones = ref<Problem | null>(null)
const eventos = shallowRef<EventoRed[] | null>(null)
const problemaEventos = ref<Problem | null>(null)
const planes = shallowRef<PlanEfectivo[] | null>(null)

async function leerConexion() {
    const resultado = await useRouters().conexion(props.router.id)
    conexion.value = resultado.ok ? resultado.data : null
    problemaConexion.value = resultado.ok ? null : resultado.problema
}

async function leerSesiones() {
    if (!puede('sesiones.ver')) {
        return
    }
    const resultado = await useRouters().resumenSesiones(props.router.id, new Date().toISOString())
    sesiones.value = resultado.ok ? resultado.data : null
    problemaSesiones.value = resultado.ok ? null : resultado.problema
}

async function leerDirecciones() {
    const resultado = await useRouters().direccionamiento(props.router.id)
    direcciones.value = resultado.ok ? resultado.data : null
    problemaDirecciones.value = resultado.ok ? null : resultado.problema
}

async function leerEventos() {
    if (!puede('red.ver')) {
        return
    }
    const resultado = await useRed().eventos({ router_id: props.router.id, limit: 3 })
    eventos.value = resultado.ok ? resultado.data.data : null
    problemaEventos.value = resultado.ok ? null : resultado.problema
}

async function leerPlanes() {
    if (!puede('planes.ver')) {
        return
    }
    const resultado = await useRouters().planes(props.router.id)
    planes.value = resultado.ok ? resultado.data : null
}

function cargar() {
    void Promise.all([leerConexion(), leerSesiones(), leerDirecciones(), leerEventos(), leerPlanes()])
}

onMounted(cargar)
watch(() => [props.router.id, props.router.version], cargar)
defineExpose({ cargar })

const estado = computed(() => ESTADOS_LISTA_ROUTER[estadoListaRouter(props.router)])

const ESTADOS_TUNEL: Record<ConexionRouter['estado'], { etiqueta: string, color: string }> = {
    conectado: { etiqueta: 'Conectado', color: 'bg-success' },
    pendiente: { etiqueta: 'Pendiente', color: 'bg-warning' },
    sin_configurar: { etiqueta: 'Sin túnel', color: 'bg-(--ax-borde)' },
}

const ultimoCoa = computed(() => eventos.value?.find(e => e.tipo === 'coa' || e.tipo === 'disconnect') ?? null)

const ocupacionV4 = computed(() => porcentajeOcupacion(direcciones.value?.ocupacion.ipv4))

/** Lo que pide atención, con su acción: solo lo que dice la API. */
interface Atender {
    clave: string
    titulo: string
    detalle: string
    tono: 'aviso' | 'error' | 'info'
    accion?: { etiqueta: string, pestana: string }
}

const atender = computed<Atender[]>(() => {
    const lista: Atender[] = []
    if (estadoListaRouter(props.router) === 'caido') {
        lista.push({ clave: 'caido', titulo: 'El router no responde', detalle: props.router.ultimo_contacto ? `Último contacto ${haceCuanto(props.router.ultimo_contacto)}.` : 'Nunca respondió.', tono: 'error', accion: { etiqueta: 'Probar', pestana: 'conexion' } })
    }
    const excepciones = (planes.value ?? []).filter(p => tieneExcepcion(p.implementacion?.estrategia_velocidad))
    if (excepciones.length) {
        lista.push({
            clave: 'excepciones',
            titulo: `${excepciones.length} ${excepciones.length === 1 ? 'plan con velocidad propia' : 'planes con velocidad propia'}`,
            detalle: `Excepciones heredadas: ${excepciones.map(p => `«${p.nombre}»`).join(', ')}.`,
            tono: 'aviso',
            accion: { etiqueta: 'Unificar', pestana: 'velocidad' },
        })
    }
    for (const red of direcciones.value?.redes_ipv4 ?? []) {
        if ((porcentajeOcupacion(red.ocupacion) ?? 0) >= UMBRAL_RED_LLENA) {
            lista.push({ clave: `red-${red.id}`, titulo: `Red ${red.cidr} casi llena`, detalle: `${Math.round(red.ocupacion.porcentaje)} % ocupada · ${formatearEntero(red.ocupacion.libres)} libres.`, tono: 'aviso', accion: { etiqueta: 'Ver redes', pestana: 'red' } })
        }
    }
    if (esSinRadius(props.router) && !tieneCredencialesApi(props.router)) {
        lista.push({ clave: 'api', titulo: 'Sin usuario y clave de la API', detalle: 'Sin RADIUS no se pueden crear servicios PPPoE aquí.', tono: 'aviso', accion: { etiqueta: 'Conexión', pestana: 'conexion' } })
    }
    const fallo = eventos.value?.find(e => !e.ok)
    if (fallo) {
        lista.push({ clave: 'fallo', titulo: 'Un comando reciente falló', detalle: `${resumenComando(fallo)} · ${formatearFechaHora(fallo.created_at)}`, tono: 'info', accion: { etiqueta: 'Bitácora', pestana: 'bitacora' } })
    }
    return lista
})

const CLASE_ATENDER: Record<Atender['tono'], string> = {
    aviso: 'border-warning/40 bg-warning/10',
    error: 'border-error/40 bg-error/10',
    info: 'border-primary/30 bg-primary/5',
}
const TEXTO_ATENDER: Record<Atender['tono'], string> = {
    aviso: 'text-warning',
    error: 'text-error',
    info: 'text-primary',
}
</script>

<template>
    <div
        class="flex flex-col gap-4"
        data-prueba="router-resumen"
    >
        <!-- Contadores (en el teléfono, contacto, conectados e IPs). -->
        <dl class="grid grid-cols-2 gap-3 lg:grid-cols-5">
            <div class="flex min-w-0 flex-col gap-0.5 rounded-2xl border border-(--ax-borde) px-4 py-3">
                <dt class="flex items-center gap-1.5 text-xs text-muted">
                    <UIcon
                        name="i-lucide-activity"
                        class="size-3.5"
                    />Contacto
                </dt>
                <dd
                    class="flex items-center gap-1.5 font-semibold"
                    :class="estado.color === 'success' ? 'text-success' : estado.color === 'error' ? 'text-error' : 'text-highlighted'"
                    data-prueba="router-estado"
                >
                    <UIcon
                        :name="estado.icono"
                        class="size-4"
                    />{{ estado.etiqueta }}
                </dd>
                <dd class="truncate text-xs text-muted">
                    {{ router.ultimo_contacto ? haceCuanto(router.ultimo_contacto) : 'nunca respondió' }}
                </dd>
            </div>
            <div class="hidden min-w-0 flex-col gap-0.5 rounded-2xl border border-(--ax-borde) px-4 py-3 lg:flex">
                <dt class="flex items-center gap-1.5 text-xs text-muted">
                    <UIcon
                        name="i-lucide-plug"
                        class="size-3.5"
                    />Túnel y API
                </dt>
                <template v-if="conexion">
                    <dd class="flex items-center gap-1.5 font-semibold text-highlighted">
                        <span
                            class="size-2 rounded-full"
                            :class="ESTADOS_TUNEL[conexion.estado].color"
                        />{{ ESTADOS_TUNEL[conexion.estado].etiqueta }}
                    </dd>
                    <dd class="truncate text-xs text-muted">
                        {{ conexion.ultimo_handshake ? `saludo ${haceCuanto(conexion.ultimo_handshake)}` : 'sin saludo' }}{{ conexion.ip_tunel ? ` · ${conexion.ip_tunel}` : '' }}
                    </dd>
                </template>
                <dd
                    v-else-if="problemaConexion"
                    class="text-xs text-muted"
                >
                    No se pudo leer
                </dd>
                <USkeleton
                    v-else
                    class="h-5 w-24"
                />
            </div>
            <div class="hidden min-w-0 flex-col gap-0.5 rounded-2xl border border-(--ax-borde) px-4 py-3 lg:flex">
                <dt class="flex items-center gap-1.5 text-xs text-muted">
                    <UIcon
                        name="i-lucide-shield"
                        class="size-3.5"
                    />RADIUS y CoA
                </dt>
                <dd class="font-semibold text-highlighted">
                    {{ esSinRadius(router) ? 'Sin RADIUS' : (router.nas_ip ? `NAS ${router.nas_ip}` : 'Sin IP de NAS') }}
                </dd>
                <dd class="truncate text-xs text-muted">
                    <template v-if="esSinRadius(router)">
                        Todo por la API del router
                    </template>
                    <template v-else-if="ultimoCoa">
                        último {{ TIPOS_EVENTO_RED[ultimoCoa.tipo].etiqueta }} {{ ultimoCoa.ok ? 'aceptado' : 'rechazado' }} {{ formatearHora(ultimoCoa.created_at) }}
                    </template>
                    <template v-else>
                        {{ puede('red.ver') ? 'sin CoA recientes' : 'CoA y Disconnect' }}
                    </template>
                </dd>
            </div>
            <div
                v-if="puede('sesiones.ver')"
                class="flex min-w-0 flex-col gap-0.5 rounded-2xl border border-(--ax-borde) px-4 py-3"
            >
                <dt class="flex items-center gap-1.5 text-xs text-muted">
                    <UIcon
                        name="i-lucide-users"
                        class="size-3.5"
                    />Sesiones abiertas
                </dt>
                <template v-if="sesiones">
                    <dd
                        class="font-semibold text-highlighted tabular-nums"
                        data-prueba="router-sesiones-abiertas"
                    >
                        {{ formatearEntero(sesiones.sesiones_activas) }}
                    </dd>
                    <dd class="truncate text-xs text-muted">
                        de {{ formatearEntero(sesiones.servicios) }} servicios PPPoE
                    </dd>
                </template>
                <dd
                    v-else-if="problemaSesiones"
                    class="text-xs text-muted"
                >
                    No se pudo leer
                </dd>
                <USkeleton
                    v-else
                    class="h-5 w-16"
                />
            </div>
            <div class="flex min-w-0 flex-col gap-0.5 rounded-2xl border border-(--ax-borde) px-4 py-3">
                <dt class="flex items-center gap-1.5 text-xs text-muted">
                    <UIcon
                        name="i-lucide-network"
                        class="size-3.5"
                    />IPs ocupadas
                </dt>
                <template v-if="direcciones">
                    <dd class="font-semibold text-highlighted tabular-nums">
                        {{ ocupacionV4 === null ? 'Sin redes' : `${Math.round(ocupacionV4)} %` }}
                    </dd>
                    <dd class="truncate text-xs text-muted">
                        IPv4{{ direcciones.ocupacion.ipv6.length ? ` · IPv6 ${direcciones.ocupacion.ipv6.map(p => `/${p.tamano_entrega} al ${Math.round(p.ocupacion.porcentaje)} %`).join(' · ')}` : '' }}
                    </dd>
                </template>
                <dd
                    v-else-if="problemaDirecciones"
                    class="text-xs text-muted"
                >
                    No se pudo leer
                </dd>
                <USkeleton
                    v-else
                    class="h-5 w-16"
                />
            </div>
        </dl>

        <div class="grid gap-4 lg:grid-cols-3">
            <RedTarjeta
                v-if="puede('sesiones.ver')"
                titulo="Clientes conectados"
                icono="i-lucide-users"
            >
                <template #accion>
                    <UButton
                        :to="`/red/conectados?router=${router.id}`"
                        label="Ver sesiones"
                        variant="link"
                        size="sm"
                    />
                </template>
                <ProblemaAlerta
                    v-if="problemaSesiones"
                    :problema="problemaSesiones"
                    :reintentar="leerSesiones"
                />
                <template v-else-if="sesiones">
                    <p class="flex flex-wrap items-baseline gap-x-2">
                        <span class="text-3xl font-bold text-highlighted tabular-nums">{{ formatearEntero(sesiones.con_sesion_activa) }}</span>
                        <span class="text-sm text-muted">de {{ formatearEntero(sesiones.servicios) }} servicios · {{ formatearEntero(sesiones.sin_sesion_desde.length) }} sin sesión</span>
                    </p>
                    <ul
                        v-if="sesiones.sin_sesion_desde.length"
                        class="flex flex-col"
                    >
                        <li
                            v-for="servicio in sesiones.sin_sesion_desde.slice(0, 4)"
                            :key="servicio.servicio_id"
                            class="flex items-center justify-between gap-2 border-t border-(--ax-borde) py-1.5 text-sm first:border-t-0"
                        >
                            <ULink
                                v-if="puede('servicios.ver')"
                                :to="`/servicios/${servicio.servicio_id}`"
                                class="truncate text-highlighted hover:text-primary"
                            >{{ servicio.cliente_nombre }}</ULink>
                            <span
                                v-else
                                class="truncate text-highlighted"
                            >{{ servicio.cliente_nombre }}</span>
                            <EstadoServicioBadge
                                :estado="servicio.estado"
                                size="sm"
                            />
                        </li>
                    </ul>
                    <p class="text-xs text-muted">
                        La gráfica de clientes de las últimas 24 h vive en Horus.
                    </p>
                </template>
                <USkeleton
                    v-else
                    class="h-16 w-full"
                />
            </RedTarjeta>

            <RedTarjeta
                titulo="Equipo"
                icono="i-lucide-cpu"
            >
                <dl>
                    <RedFila
                        etiqueta="RouterOS"
                        :valor="router.routeros_version ?? 'Sin leer'"
                    />
                    <RedFila
                        etiqueta="Serie"
                        :valor="router.serial ?? 'Sin leer'"
                        :mono="Boolean(router.serial)"
                    />
                    <RedFila
                        etiqueta="Dirección de la API"
                        :valor="router.api_url ?? router.host"
                        mono
                    />
                </dl>
                <div class="mt-auto flex flex-col gap-2 rounded-xl bg-(--ax-panel) p-3">
                    <p class="text-xs text-muted">
                        El uso del router (CPU, memoria y clientes en el día) lo mide Horus; Argos no guarda historial propio.
                    </p>
                    <VerEnHorusBoton
                        tipo="router"
                        :id-externo="router.id"
                        size="sm"
                    />
                </div>
            </RedTarjeta>

            <RedTarjeta
                titulo="Para atender"
                icono="i-lucide-triangle-alert"
                :marca="atender.length ? String(atender.length) : undefined"
            >
                <ul
                    v-if="atender.length"
                    class="flex flex-col gap-2"
                    data-prueba="router-atender"
                >
                    <li
                        v-for="item in atender"
                        :key="item.clave"
                        class="flex items-start justify-between gap-2 rounded-xl border px-3 py-2"
                        :class="CLASE_ATENDER[item.tono]"
                    >
                        <span class="flex min-w-0 flex-col">
                            <span
                                class="text-sm font-semibold"
                                :class="TEXTO_ATENDER[item.tono]"
                            >{{ item.titulo }}</span>
                            <span class="text-xs text-default">{{ item.detalle }}</span>
                        </span>
                        <UButton
                            v-if="item.accion"
                            :label="item.accion.etiqueta"
                            variant="link"
                            size="sm"
                            class="shrink-0"
                            @click="emit('irA', item.accion.pestana)"
                        />
                    </li>
                </ul>
                <UEmpty
                    v-else
                    icon="i-lucide-circle-check"
                    title="Nada pendiente"
                    description="Sin avisos de este router."
                    variant="naked"
                    size="sm"
                />
            </RedTarjeta>
        </div>

        <div class="grid gap-4 lg:grid-cols-2">
            <RedTarjeta
                titulo="Direcciones"
                icono="i-lucide-network"
            >
                <template #accion>
                    <UButton
                        label="Ver redes"
                        variant="link"
                        size="sm"
                        @click="emit('irA', 'red')"
                    />
                </template>
                <ProblemaAlerta
                    v-if="problemaDirecciones"
                    :problema="problemaDirecciones"
                    :reintentar="leerDirecciones"
                />
                <ul
                    v-else-if="direcciones"
                    class="flex flex-col"
                >
                    <li
                        v-for="red in direcciones.redes_ipv4"
                        :key="red.id"
                        class="grid grid-cols-[minmax(0,1fr)_minmax(0,9rem)_auto] items-center gap-3 border-t border-(--ax-borde) py-2 first:border-t-0"
                    >
                        <span class="flex min-w-0 items-center gap-2">
                            <span class="truncate font-mono text-sm text-highlighted">{{ red.cidr }}</span>
                            <UBadge
                                v-if="red.tipo === 'estatico'"
                                label="estática"
                                color="neutral"
                                variant="soft"
                                size="sm"
                            />
                        </span>
                        <RedOcupacion
                            :porcentaje="red.ocupacion.porcentaje"
                            solo-barra
                        />
                        <span class="text-end text-sm font-semibold text-highlighted tabular-nums">{{ formatearEntero(red.ocupacion.asignadas) }} / {{ formatearEntero(red.ocupacion.total) }}</span>
                    </li>
                    <li
                        v-for="bloque in direcciones.bloques_ipv6"
                        :key="`v6-${bloque.id}`"
                        class="flex items-center justify-between gap-3 border-t border-(--ax-borde) py-2"
                    >
                        <span class="truncate font-mono text-sm text-highlighted">{{ bloque.prefijo }}</span>
                        <span class="text-xs text-muted">{{ bloque.nombre ?? 'Bloque IPv6' }}</span>
                    </li>
                    <li
                        v-if="!direcciones.redes_ipv4.length && !direcciones.bloques_ipv6.length"
                        class="py-2 text-sm text-muted"
                    >
                        Sin redes todavía: agrégalas en «Red e IPs».
                    </li>
                </ul>
                <USkeleton
                    v-else
                    class="h-16 w-full"
                />
            </RedTarjeta>

            <RedTarjeta
                v-if="puede('red.ver')"
                titulo="Lo último que Argos le mandó"
                icono="i-lucide-history"
            >
                <template #accion>
                    <UButton
                        label="Bitácora"
                        variant="link"
                        size="sm"
                        @click="emit('irA', 'bitacora')"
                    />
                </template>
                <ProblemaAlerta
                    v-if="problemaEventos"
                    :problema="problemaEventos"
                    :reintentar="leerEventos"
                />
                <ul
                    v-else-if="eventos?.length"
                    class="flex flex-col"
                >
                    <li
                        v-for="evento in eventos"
                        :key="evento.id"
                        class="flex items-center gap-2 border-t border-(--ax-borde) py-2 text-sm first:border-t-0"
                    >
                        <UBadge
                            :label="TIPOS_EVENTO_RED[evento.tipo].etiqueta"
                            :color="colorEventoRed(evento)"
                            variant="soft"
                            size="sm"
                        />
                        <span class="min-w-0 flex-1 truncate text-default">{{ resumenComando(evento) }}</span>
                        <span class="shrink-0 text-xs text-muted">{{ formatearHora(evento.created_at) }} · {{ evento.ok ? 'aceptado' : 'falló' }}</span>
                    </li>
                </ul>
                <p
                    v-else-if="eventos"
                    class="text-sm text-muted"
                >
                    Argos todavía no le mandó nada.
                </p>
                <USkeleton
                    v-else
                    class="h-16 w-full"
                />
            </RedTarjeta>
        </div>
    </div>
</template>
