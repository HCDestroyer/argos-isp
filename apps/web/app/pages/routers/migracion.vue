<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { FormSubmitEvent, SelectItem, TableColumn } from '@nuxt/ui'

/**
 * Migración de router al nuevo `aaa` (piloto). Por router:
 * - la fecha del cambio, guardada en la API (`GET /routers/:id/migracion-aaa`, se marca con
 *   `POST /routers/:id/marcar-migrado`, `routers.marcar_migrado`);
 * - el resumen de sesiones desde esa fecha (`GET /routers/:id/resumen-sesiones`, `sesiones.ver`);
 * - los CoA, Disconnect y comandos a RouterOS que fallaron, con la respuesta del equipo
 *   (`GET /red/eventos?resultado=error`, `red.ver`).
 * Ningún número se muestra si su lectura falló.
 */
definePageMeta({ permiso: 'routers.ver' })

useHead({ title: 'Migración de router · ArgosIsp' })

const route = useRoute()
const router = useRouter()
const toast = useToast()
const { puede, enlace } = usePermisos()

/* Routers (`?router=`). */
const routers = shallowRef<RouterNas[]>([])
const problemaRouters = ref<Problem | null>(null)
const cargandoRouters = ref(true)
const routerId = ref<number | undefined>(Number(route.query.router) || undefined)
const routerActual = computed(() => routers.value.find(r => r.id === routerId.value) ?? null)
const itemsRouters = computed<SelectItem[]>(() => routers.value.map(r => ({ label: r.nas_ip ? `${r.nombre} · NAS ${r.nas_ip}` : `${r.nombre} · sin RADIUS`, value: r.id })))

/* Fecha de migración. */
const migracion = shallowRef<LecturaMigracion<MigracionAaa>>({ estado: 'cargando' })
const aaaDesde = computed(() => (migracion.value.estado === 'ok' ? migracion.value.valor.aaa_desde : null))

/* Resumen de sesiones. */
const resumen = shallowRef<LecturaMigracion<ResumenSesionesRouter> | { estado: 'sin_fecha' }>({ estado: 'cargando' })

/* Eventos de red con error, desde la fecha del cambio o los últimos 7 días. */
const tipoEvento = ref<EventoRed['tipo'] | 'todos'>('todos')
const itemsTipo: SelectItem[] = [
    { label: 'CoA, Disconnect y RouterOS', value: 'todos' },
    ...Object.entries(TIPOS_EVENTO_RED).map(([value, t]) => ({ label: t.etiqueta, value })),
]
const desdeEventos = computed(() => aaaDesde.value ?? new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString())
const eventos = usePaginacionCursor((cursor) => {
    const filtros: FiltrosEventosRed = { router_id: routerId.value, resultado: 'error', desde: desdeEventos.value }
    if (tipoEvento.value !== 'todos') {
        filtros.tipo = tipoEvento.value
    }
    return useRed().eventos(filtros, cursor)
})
const columnasEventos: TableColumn<EventoRed>[] = [
    { accessorKey: 'created_at', header: 'Cuándo' },
    { accessorKey: 'comando', header: 'Qué se mandó', meta: { class: { td: 'whitespace-normal' } } },
    { accessorKey: 'respuesta', header: 'Respuesta del equipo', meta: { class: { td: 'whitespace-normal' } } },
]

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

async function cargarResumen(id: number, actual: number) {
    if (!puede('sesiones.ver')) {
        resumen.value = { estado: 'sin_permiso', permiso: 'sesiones.ver' }
        return
    }
    if (!aaaDesde.value) {
        resumen.value = { estado: 'sin_fecha' }
        return
    }
    resumen.value = { estado: 'cargando' }
    const resultado = await useRouters().resumenSesiones(id)
    if (actual !== solicitud) {
        return
    }
    resumen.value = resultado.ok ? { estado: 'ok', valor: resultado.data } : { estado: 'error', problema: resultado.problema }
}

async function cargar() {
    const id = routerId.value
    if (!id) {
        return
    }
    const actual = ++solicitud
    migracion.value = { estado: 'cargando' }
    const resultado = await useRouters().migracionAaa(id)
    if (actual !== solicitud) {
        return
    }
    if (resultado.ok) {
        migracion.value = { estado: 'ok', valor: resultado.data }
    }
    else {
        // Sin la fecha no se sabe desde cuándo contar: el resumen muestra el mismo error.
        migracion.value = { estado: 'error', problema: resultado.problema }
        resumen.value = { estado: 'error', problema: resultado.problema }
    }
    await Promise.all([
        resultado.ok ? cargarResumen(id, actual) : Promise.resolve(),
        puede('red.ver') ? eventos.recargar() : Promise.resolve(),
    ])
}

watch(routerId, () => {
    void router.replace({ query: routerId.value ? { router: String(routerId.value) } : {} })
    void cargar()
})

watch(tipoEvento, () => void eventos.recargar())

onMounted(async () => {
    await cargarRouters()
    await cargar()
})

/* Marcar o desmarcar la migración. */
const marcarAbierto = ref(false)
const desmarcando = ref(false)
const guardando = ref(false)
const problemaMarcar = ref<Problem | null>(null)
const formularioMarcar = useTemplateRef('formularioMarcar')
const estadoMarcar = reactive<EntradaMarcarMigrado>({ desde: '', motivo: '' })
const esquemaMarcar = computed(() => esquemaMarcarMigrado())
let claveMarcar = nuevaClaveIdempotencia()

function abrirMarcar(desmarcar: boolean) {
    desmarcando.value = desmarcar
    estadoMarcar.desde = desmarcar || !aaaDesde.value ? '' : localGuatemala(aaaDesde.value)
    estadoMarcar.motivo = ''
    problemaMarcar.value = null
    claveMarcar = nuevaClaveIdempotencia()
    marcarAbierto.value = true
}

async function marcar(evento: FormSubmitEvent<EntradaMarcarMigrado>) {
    const id = routerId.value
    if (!id || migracion.value.estado !== 'ok') {
        return
    }
    guardando.value = true
    problemaMarcar.value = null
    const datos: DatosMarcarMigrado = { motivo: evento.data.motivo.trim(), version: migracion.value.valor.version }
    if (desmarcando.value) {
        datos.desde = null
    }
    else if (evento.data.desde) {
        datos.desde = instanteGuatemala(evento.data.desde)
    }
    const resultado = await useRouters().marcarMigrado(id, datos, claveMarcar)
    guardando.value = false
    if (!resultado.ok) {
        const errores = erroresDeFormulario(resultado.problema)
        if (errores.length) {
            formularioMarcar.value?.setErrors(errores)
        }
        problemaMarcar.value = errores.length ? null : resultado.problema
        return
    }
    marcarAbierto.value = false
    toast.add({
        title: resultado.data.aaa_desde ? `Migrado desde ${formatearFechaHora(resultado.data.aaa_desde)}` : 'Migración desmarcada',
        icon: 'i-lucide-circle-check',
        color: 'success',
    })
    await cargar()
}

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
                Sigue a un router mientras pasa al nuevo servidor RADIUS: desde cuándo,
                quién ya volvió a conectarse, quién no, y qué respondieron los equipos a los CoA, Disconnect y comandos que fallaron.
            </p>

            <ProblemaAlerta
                v-if="problemaRouters"
                :problema="problemaRouters"
                :reintentar="cargarRouters"
                :reintentando="cargandoRouters"
            />

            <UFormField
                v-else
                label="Router"
                name="router"
                class="lg:max-w-md"
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

            <template v-if="routerActual">
                <!-- Fecha de migración -->
                <section
                    class="flex flex-col gap-3 surface-card p-4"
                    aria-labelledby="titulo-fecha"
                    data-prueba="migracion-fecha"
                >
                    <div class="flex flex-wrap items-center justify-between gap-2">
                        <h3
                            id="titulo-fecha"
                            class="flex items-center gap-1.5 text-sm font-semibold text-highlighted"
                        >
                            <UIcon
                                name="i-lucide-calendar-check"
                                class="size-4"
                            />
                            Paso al nuevo servidor RADIUS
                        </h3>
                        <div
                            v-if="migracion.estado === 'ok' && puede('routers.marcar_migrado')"
                            class="flex flex-wrap gap-2"
                        >
                            <UButton
                                :label="aaaDesde ? 'Cambiar fecha' : 'Marcar migrado'"
                                icon="i-lucide-flag"
                                size="sm"
                                data-prueba="abrir-marcar-migrado"
                                @click="abrirMarcar(false)"
                            />
                            <UButton
                                v-if="aaaDesde"
                                label="Desmarcar"
                                icon="i-lucide-undo-2"
                                color="neutral"
                                variant="outline"
                                size="sm"
                                data-prueba="abrir-desmarcar"
                                @click="abrirMarcar(true)"
                            />
                        </div>
                    </div>
                    <MigracionLectura
                        :lectura="migracion"
                        @reintentar="cargar"
                    >
                        <template v-if="migracion.estado === 'ok'">
                            <p
                                class="text-lg font-semibold text-highlighted"
                                data-prueba="migracion-aaa-desde"
                            >
                                {{ migracion.valor.aaa_desde ? formatearFechaHora(migracion.valor.aaa_desde) : 'Sin marcar' }}
                            </p>
                            <p class="text-xs text-muted">
                                <template v-if="migracion.valor.motivo">
                                    {{ migracion.valor.motivo }} ·
                                </template>
                                <template v-if="migracion.valor.primer_accounting">
                                    primera sesión registrada {{ formatearFechaHora(migracion.valor.primer_accounting) }}
                                </template>
                                <template v-else>
                                    sin sesiones registradas todavía
                                </template>
                            </p>
                        </template>
                    </MigracionLectura>
                </section>

                <!-- Resumen de sesiones -->
                <p
                    v-if="resumen.estado === 'sin_fecha'"
                    class="text-sm text-muted"
                    data-prueba="migracion-sin-fecha"
                >
                    Marca desde cuándo el router apunta al nuevo servidor RADIUS para contar quién se conectó y quién no.
                </p>
                <MigracionLectura
                    v-else-if="resumen.estado !== 'ok'"
                    :lectura="resumen"
                    @reintentar="cargar"
                />
                <div
                    v-else
                    class="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"
                >
                    <div class="flex min-w-0 flex-col gap-1 surface-card p-4">
                        <span class="text-sm text-muted">Servicios PPPoE</span>
                        <p
                            class="text-2xl font-semibold text-highlighted tabular-nums"
                            data-prueba="migracion-servicios"
                        >
                            {{ resumen.valor.servicios }}
                        </p>
                        <p class="text-xs text-muted">
                            Sin retirados; WISP no usa RADIUS
                        </p>
                    </div>
                    <div class="flex min-w-0 flex-col gap-1 surface-card p-4">
                        <span class="text-sm text-muted">Con sesión activa</span>
                        <p
                            class="text-2xl font-semibold text-highlighted tabular-nums"
                            data-prueba="migracion-activas"
                        >
                            {{ resumen.valor.con_sesion_activa }}
                        </p>
                        <p class="text-xs text-muted">
                            {{ plural(resumen.valor.sesiones_activas, 'sesión abierta', 'sesiones abiertas') }} en el router
                        </p>
                    </div>
                    <div class="flex min-w-0 flex-col gap-1 surface-card p-4">
                        <span class="text-sm text-muted">Conectados desde el cambio</span>
                        <p
                            class="text-2xl font-semibold text-highlighted tabular-nums"
                            data-prueba="migracion-conectados"
                        >
                            {{ resumen.valor.con_sesion_desde }}
                        </p>
                        <p class="text-xs text-muted">
                            Desde {{ formatearFechaHora(resumen.valor.desde) }}
                        </p>
                    </div>
                    <div class="flex min-w-0 flex-col gap-1 surface-card p-4">
                        <span class="text-sm text-muted">Sin sesión desde el cambio</span>
                        <p
                            class="text-2xl font-semibold tabular-nums"
                            :class="resumen.valor.sin_sesion_desde.length ? 'text-warning' : 'text-highlighted'"
                            data-prueba="migracion-pendientes"
                        >
                            {{ resumen.valor.sin_sesion_desde.length }}
                        </p>
                        <p class="text-xs text-muted">
                            Ni abierta ni cerrada después de la fecha
                        </p>
                    </div>
                </div>

                <section
                    v-if="resumen.estado === 'ok' && resumen.valor.sin_sesion_desde.length"
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
                        class="flex flex-col divide-y divide-default surface-card"
                        data-prueba="migracion-lista-pendientes"
                    >
                        <li
                            v-for="servicio in resumen.valor.sin_sesion_desde.slice(0, 100)"
                            :key="servicio.servicio_id"
                            class="flex flex-wrap items-center justify-between gap-2 px-3 py-2"
                        >
                            <div class="flex min-w-0 flex-col">
                                <ULink
                                    :to="enlace(`/servicios/${servicio.servicio_id}`)"
                                    class="truncate font-mono text-sm font-medium text-highlighted"
                                >
                                    {{ servicio.user_ppp }}
                                </ULink>
                                <span class="truncate text-xs text-muted">
                                    {{ servicio.cliente_nombre }} ·
                                    {{ servicio.ultima_sesion_inicio ? `última sesión ${formatearFechaHora(servicio.ultima_sesion_inicio)}` : 'nunca tuvo sesión' }}
                                </span>
                            </div>
                            <EstadoServicioBadge :estado="servicio.estado" />
                        </li>
                    </ul>
                    <p
                        v-if="resumen.valor.sin_sesion_desde.length > 100"
                        class="text-xs text-muted"
                    >
                        Y {{ resumen.valor.sin_sesion_desde.length - 100 }} más.
                    </p>
                </section>

                <!-- Eventos de red con error -->
                <section
                    class="flex flex-col gap-3"
                    aria-labelledby="titulo-eventos"
                    data-prueba="migracion-eventos"
                >
                    <div class="flex flex-wrap items-center justify-between gap-2">
                        <h3
                            id="titulo-eventos"
                            class="text-sm font-semibold text-highlighted"
                        >
                            Fallos de red {{ aaaDesde ? 'desde el cambio' : 'de los últimos 7 días' }}
                        </h3>
                        <USelect
                            v-if="puede('red.ver')"
                            v-model="tipoEvento"
                            :items="itemsTipo"
                            size="sm"
                            class="w-full sm:w-64"
                            aria-label="Tipo de evento"
                        />
                    </div>
                    <p
                        v-if="!puede('red.ver')"
                        class="text-sm text-muted"
                    >
                        Sin permiso red.ver.
                    </p>
                    <ProblemaAlerta
                        v-else-if="eventos.problema.value"
                        :problema="eventos.problema.value"
                        :reintentar="eventos.recargar"
                        :reintentando="eventos.cargando.value"
                    />
                    <template v-else>
                        <UTable
                            :data="eventos.filas.value"
                            :columns="columnasEventos"
                            :loading="eventos.cargando.value"
                            :ui="{ td: 'py-2.5 align-top' }"
                            data-prueba="migracion-lista-eventos"
                        >
                            <template #created_at-cell="{ row }">
                                <div class="flex flex-col gap-1">
                                    <UBadge
                                        :label="TIPOS_EVENTO_RED[row.original.tipo].etiqueta"
                                        :icon="TIPOS_EVENTO_RED[row.original.tipo].icono"
                                        :color="colorEventoRed(row.original)"
                                        variant="subtle"
                                        size="sm"
                                        class="self-start"
                                    />
                                    <span class="whitespace-nowrap text-xs text-muted">{{ formatearFechaHora(row.original.created_at) }}</span>
                                </div>
                            </template>
                            <template #comando-cell="{ row }">
                                <div class="flex min-w-0 flex-col">
                                    <span class="font-mono text-xs break-all">{{ resumenComando(row.original) }}</span>
                                    <ULink
                                        v-if="row.original.servicio_id"
                                        :to="enlace(`/servicios/${row.original.servicio_id}`)"
                                        class="text-xs text-muted hover:text-primary"
                                    >
                                        Servicio #{{ row.original.servicio_id }}
                                    </ULink>
                                </div>
                            </template>
                            <template #respuesta-cell="{ row }">
                                <span class="text-xs break-words text-error">{{ resumenRespuesta(row.original) }}</span>
                            </template>
                            <template #empty>
                                <UEmpty
                                    icon="i-lucide-shield-check"
                                    title="Sin fallos de red"
                                    variant="naked"
                                />
                            </template>
                        </UTable>
                        <PaginacionCursor
                            :pagina="eventos.pagina.value"
                            :hay-anterior="eventos.hayAnterior.value"
                            :hay-siguiente="eventos.haySiguiente.value"
                            :cargando="eventos.cargando.value"
                            :filas="eventos.filas.value.length"
                            @anterior="eventos.anterior"
                            @siguiente="eventos.siguiente"
                        />
                    </template>
                </section>
            </template>
        </div>

        <UModal
            v-model:open="marcarAbierto"
            :title="desmarcando ? 'Desmarcar la migración' : 'Marcar el paso al nuevo servidor RADIUS'"
            :description="desmarcando ? 'Vuelta atrás: el router queda sin fecha de migración. No toca el router ni las sesiones.' : 'Desde cuándo este router usa el nuevo servidor RADIUS. No toca el router ni las sesiones.'"
            :dismissible="!guardando"
        >
            <template #body>
                <UForm
                    id="form-marcar-migrado"
                    ref="formularioMarcar"
                    :schema="esquemaMarcar"
                    :state="estadoMarcar"
                    class="flex flex-col gap-4"
                    @submit="marcar"
                >
                    <UFormField
                        v-if="!desmarcando"
                        label="Desde"
                        name="desde"
                        help="Hora de Guatemala. Vacía: ahora."
                    >
                        <UInput
                            v-model="estadoMarcar.desde"
                            type="datetime-local"
                            class="w-full"
                            data-prueba="marcar-desde"
                        />
                    </UFormField>
                    <UFormField
                        label="Motivo"
                        name="motivo"
                        required
                    >
                        <UTextarea
                            v-model="estadoMarcar.motivo"
                            :rows="2"
                            placeholder="Cambio de RADIUS en la ventana de mantenimiento"
                            class="w-full"
                            data-prueba="marcar-motivo"
                        />
                    </UFormField>
                    <ProblemaAlerta
                        v-if="problemaMarcar"
                        :problema="problemaMarcar"
                        :reintentar="problemaMarcar.status === 409 ? cargar : undefined"
                    />
                </UForm>
            </template>
            <template #footer>
                <div class="flex w-full justify-end gap-2">
                    <UButton
                        label="Cancelar"
                        color="neutral"
                        variant="ghost"
                        :disabled="guardando"
                        @click="marcarAbierto = false"
                    />
                    <UButton
                        type="submit"
                        form="form-marcar-migrado"
                        :label="desmarcando ? 'Desmarcar' : 'Guardar fecha'"
                        :color="desmarcando ? 'warning' : 'primary'"
                        icon="i-lucide-save"
                        :loading="guardando"
                        data-prueba="marcar-guardar"
                    />
                </div>
            </template>
        </UModal>
    </PanelPagina>
</template>
