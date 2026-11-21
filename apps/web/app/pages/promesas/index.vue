<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { SelectItem, TableColumn, TabsItem } from '@nuxt/ui'
import Decimal from 'decimal.js'
import { h } from 'vue'

/**
 * Promesas de pago (tablero OperPromesas): contadores arriba, la lista con pestañas segmentadas,
 * buscador y filtros, y a la derecha la promesa abierta con su evaluación y sus acciones. Las
 * promesas son por servicio y cubren todo lo vencido (Argos calcula el monto). «Nueva promesa» abre
 * el simulador, que muestra la regla que aplica antes de crear. En el teléfono se aprueban o
 * rechazan las pendientes con confirmación (decisión 9).
 */
definePageMeta({ permiso: 'promesas.ver' })

useHead({ title: 'Promesas · ArgosIsp' })

const route = useRoute()
const router = useRouter()
const { puede } = usePermisos()
const toast = useToast()
const nombres = useNombresClientes()

const TODOS = 'todos'

function textoQuery(valor: unknown): string {
    return typeof valor === 'string' ? valor : ''
}

function idQuery(valor: unknown): number {
    const id = Number(textoQuery(valor))
    return Number.isInteger(id) && id > 0 ? id : 0
}

function estadoQuery(valor: unknown): EstadoPromesa | typeof TODOS {
    const texto = textoQuery(valor)
    return texto in ESTADOS_PROMESA ? (texto as EstadoPromesa) : TODOS
}

type TipoPromesa = NonNullable<Promesa['tipo']>

function tipoQuery(valor: unknown): TipoPromesa | typeof TODOS {
    const texto = textoQuery(valor)
    return texto in TIPOS_PROMESA ? (texto as TipoPromesa) : TODOS
}

type MotivoReconexion = NonNullable<Promesa['motivo_reconexion']>

function motivoQuery(valor: unknown): MotivoReconexion | typeof TODOS {
    const texto = textoQuery(valor)
    return texto in MOTIVOS_RECONEXION ? (texto as MotivoReconexion) : TODOS
}

const estado = ref<EstadoPromesa | typeof TODOS>(estadoQuery(route.query.estado))

/**
 * Pestañas del tablero. «Por vencer» son las activas que vencen hoy o mañana: la API no filtra por
 * vencimiento, así que se arman con las activas leídas para los contadores (hasta 200).
 */
type Pestana = 'activas' | 'por_vencer' | 'por_aprobar' | 'cumplidas' | 'incumplidas' | 'reconexion' | 'todas'
function pestanaInicial(): Pestana {
    const texto = textoQuery(route.query.pestana)
    if (['activas', 'por_vencer', 'por_aprobar', 'cumplidas', 'incumplidas', 'reconexion', 'todas'].includes(texto)) {
        return texto as Pestana
    }
    if (route.query.estado || route.query.tipo || route.query.motivo_reconexion || route.query.cliente || route.query.servicio) {
        return 'todas'
    }
    return 'activas'
}
const pestana = ref<Pestana>(pestanaInicial())
/** En el teléfono la promesa abierta va en un panel a pantalla completa. */
const detalleMovil = ref(false)
/** Promesa abierta a la derecha (`?id=`). */
const seleccionada = ref(idQuery(route.query.id))
const tipo = ref<TipoPromesa | typeof TODOS>(tipoQuery(route.query.tipo))
const motivo = ref<MotivoReconexion | typeof TODOS>(motivoQuery(route.query.motivo_reconexion))
const clienteId = ref(idQuery(route.query.cliente))
const servicioId = ref(idQuery(route.query.servicio))
const clienteElegido = shallowRef<Cliente | null>(null)

const aprobarAbierto = ref(false)
const porAprobar = shallowRef<Promesa | null>(null)

const itemsEstado: SelectItem[] = [
    { label: 'Todos los estados', value: TODOS },
    ...Object.entries(ESTADOS_PROMESA).map(([valor, datos]) => ({ label: datos.etiqueta, value: valor, icon: datos.icono })),
]

/** Reconexiones temporales (contrato Iris 0.6.0 §7.3) o promesas normales. */
const itemsTipo: SelectItem[] = [
    { label: 'Todos los tipos', value: TODOS },
    ...Object.entries(TIPOS_PROMESA).map(([valor, datos]) => ({ label: datos.etiqueta, value: valor, icon: datos.icono })),
]

/**
 * Motivo de la reconexión temporal (contrato Iris 0.8.0, `motivo_reconexion`). La API lo trata
 * como `tipo=reconexion_temporal`; con «Promesa» elegida el filtro no aplica y se oculta.
 */
const itemsMotivo: SelectItem[] = [
    { label: 'Todos los motivos', value: TODOS },
    ...Object.entries(MOTIVOS_RECONEXION).map(([valor, datos]) => ({ label: datos.etiqueta, value: valor, icon: datos.icono })),
]

const conMotivo = computed(() => tipo.value !== 'promesa')

function filtros(): FiltrosPromesas {
    const resultado: FiltrosPromesas = {}
    if (pestana.value === 'activas' || pestana.value === 'por_vencer') {
        resultado.estado = 'activa'
    }
    else if (pestana.value === 'por_aprobar') {
        resultado.estado = 'pendiente_aprobacion'
    }
    else if (pestana.value === 'cumplidas') {
        resultado.estado = 'cumplida'
    }
    else if (pestana.value === 'incumplidas') {
        resultado.estado = 'incumplida'
    }
    else if (pestana.value === 'reconexion') {
        resultado.estado = 'activa'
        resultado.tipo = 'reconexion_temporal'
    }
    if (pestana.value !== 'todas') {
        if (tipo.value !== TODOS && pestana.value !== 'reconexion') {
            resultado.tipo = tipo.value
        }
        if (clienteId.value) {
            resultado.cliente_id = clienteId.value
        }
        if (servicioId.value) {
            resultado.servicio_id = servicioId.value
        }
        return resultado
    }
    if (estado.value !== TODOS) {
        resultado.estado = estado.value
    }
    if (tipo.value !== TODOS) {
        resultado.tipo = tipo.value
    }
    if (conMotivo.value && motivo.value !== TODOS) {
        resultado.motivo_reconexion = motivo.value
    }
    if (clienteId.value) {
        resultado.cliente_id = clienteId.value
    }
    if (servicioId.value) {
        resultado.servicio_id = servicioId.value
    }
    return resultado
}

const lista = usePaginacionCursor(cursor => usePromesas().listar(filtros(), cursor))

watch(lista.filas, filas => void nombres.cargar(filas.map(p => p.cliente_id)))

const columnas: TableColumn<Promesa>[] = [
    { accessorKey: 'servicio_id', header: 'Servicio' },
    { accessorKey: 'tipo', header: 'Tipo', meta: { class: { th: 'max-2xl:hidden', td: 'max-2xl:hidden' } } },
    { accessorKey: 'canal', header: 'Quién la pidió', meta: { class: { th: 'max-2xl:hidden', td: 'max-2xl:hidden' } } },
    { accessorKey: 'monto', header: 'Cubre', meta: { class: { th: 'text-right max-sm:hidden', td: 'text-right max-sm:hidden' } } },
    { accessorKey: 'vence_en', header: 'Vence', meta: { class: { th: 'max-sm:hidden', td: 'max-sm:hidden' } } },
    { accessorKey: 'estado', header: 'Estado' },
    { id: 'acciones', header: () => h('span', { class: 'sr-only' }, 'Acciones'), meta: { class: { td: 'w-0 text-end', th: 'w-0' } } },
]

/*
 * Contadores (tablero): activas y su monto, las que vencen hoy, cumplidas del mes (reporte de
 * promesas, `reportes.ver`) y las que esperan a un supervisor. La API no da conteos de la lista: se
 * cuentan hasta 200 y, si hay más, se dice «200+». Sin poder leer, «No se pudo leer» con Reintentar.
 */
const LIMITE_CONTEO = 200
const activas = shallowRef<Promesa[] | null>(null)
const activasMas = ref(false)
const pendientes = shallowRef<Promesa[] | null>(null)
const pendientesMas = ref(false)
const problemaConteo = ref<Problem | null>(null)
const cumplimiento = shallowRef<{ tasa: number, cumplidas: number, cerradas: number } | null>(null)
const problemaCumplimiento = ref<Problem | null>(null)

async function cargarConteos() {
    problemaConteo.value = null
    activas.value = null
    pendientes.value = null
    const base: FiltrosPromesas = {}
    if (clienteId.value) {
        base.cliente_id = clienteId.value
    }
    const [deActivas, dePendientes] = await Promise.all([
        usePromesas().listar({ ...base, estado: 'activa', limit: LIMITE_CONTEO }),
        usePromesas().listar({ ...base, estado: 'pendiente_aprobacion', limit: LIMITE_CONTEO }),
    ])
    if (!deActivas.ok || !dePendientes.ok) {
        problemaConteo.value = !deActivas.ok ? deActivas.problema : !dePendientes.ok ? dePendientes.problema : null
        return
    }
    activas.value = deActivas.data.data
    activasMas.value = deActivas.data.nextCursor !== null
    pendientes.value = dePendientes.data.data
    pendientesMas.value = dePendientes.data.nextCursor !== null
    void nombres.cargar([...deActivas.data.data, ...dePendientes.data.data].map(p => p.cliente_id))
}

async function cargarCumplimiento() {
    if (!puede('reportes.ver')) {
        return
    }
    cumplimiento.value = null
    problemaCumplimiento.value = null
    const hoy = hoyGuatemala()
    const resultado = await useReportes().reporte('promesas', { desde: `${hoy.slice(0, 8)}01`, hasta: hoy })
    if (!resultado.ok) {
        problemaCumplimiento.value = resultado.problema
        return
    }
    const totales = resultado.data.totales
    cumplimiento.value = { tasa: totales.tasa_cumplimiento, cumplidas: totales.cumplidas, cerradas: totales.cumplidas + totales.incumplidas }
}

/** Activas que vencen hoy o mañana (hora de Guatemala). */
function vencePronto(promesa: Promesa): boolean {
    const manana = new Date(Date.now() + 24 * 3600_000)
    return promesa.vence_en.slice(0, 10) <= hoyGuatemala(manana)
}
function venceHoy(promesa: Promesa): boolean {
    return fechaGuatemala(promesa.vence_en) === hoyGuatemala()
}

const porVencer = computed(() => (activas.value ? activas.value.filter(vencePronto) : null))
const conteo = (lista: Promesa[] | null, mas: boolean) => (lista === null ? null : mas ? `${LIMITE_CONTEO}+` : String(lista.length))
const montoActivas = computed(() => (activas.value ? activas.value.reduce((suma, p) => suma.plus(p.monto), new Decimal(0)) : null))
const reconexiones = computed(() => (activas.value ? activas.value.filter(p => p.tipo === 'reconexion_temporal').length : null))

const pestanas = computed<TabsItem[]>(() => [
    { label: 'Activas', value: 'activas', icon: 'i-lucide-hand', badge: conteo(activas.value, activasMas.value) ?? undefined },
    { label: 'Por vencer', value: 'por_vencer', icon: 'i-lucide-clock', badge: porVencer.value?.length || undefined },
    { label: 'Por aprobar', value: 'por_aprobar', badge: conteo(pendientes.value, pendientesMas.value) ?? undefined },
    { label: 'Cumplidas', value: 'cumplidas' },
    { label: 'Incumplidas', value: 'incumplidas' },
    { label: 'Reconexión temporal', value: 'reconexion', icon: 'i-lucide-power', badge: reconexiones.value || undefined },
    { label: 'Todas', value: 'todas' },
])

/** Filas: «Por vencer» sale de las activas contadas; las demás pestañas, de la API con cursor. */
const filas = computed(() => (pestana.value === 'por_vencer' ? (porVencer.value ?? []) : lista.filas.value))
const promesaAbierta = computed(() => filas.value.find(p => p.id === seleccionada.value) ?? null)
const metaTabla = metaFilaElegida<Promesa>(fila => fila.id === seleccionada.value)

/** Barra de tiempo hasta el vencimiento (desde la creación): roja con menos de un día. */
function avance(promesa: Promesa): { porcentaje: number, texto: string, color: string } {
    const inicio = new Date(promesa.created_at).getTime()
    const fin = new Date(promesa.vence_en).getTime()
    const ahora = Date.now()
    const porcentaje = fin > inicio ? Math.min(100, Math.max(4, Math.round(((ahora - inicio) / (fin - inicio)) * 100))) : 100
    const restante = fin - ahora
    if (restante <= 0) {
        return { porcentaje: 100, texto: 'venció', color: 'bg-error' }
    }
    const horas = Math.floor(restante / 3600_000)
    if (horas < 24) {
        return { porcentaje, texto: horas < 1 ? 'queda menos de 1 h' : `quedan ${horas} h`, color: 'bg-error' }
    }
    const dias = Math.floor(horas / 24)
    return { porcentaje, texto: dias === 1 ? 'queda 1 día' : `quedan ${dias} días`, color: dias <= 2 ? 'bg-warning' : 'bg-primary' }
}

function abrir(promesa: Promesa) {
    seleccionada.value = promesa.id
    if (!esEscritorio()) {
        detalleMovil.value = true
    }
}

function alElegirFila(_evento: Event, fila: { original: Promesa }) {
    abrir(fila.original)
}

function accionesPromesa(promesa: Promesa): AccionFila[] {
    const acciones: AccionFila[] = [
        { etiqueta: 'Ver la promesa', icono: ICONOS.ver, alElegir: () => abrir(promesa), soloMenu: true, grupo: 'Ver' },
    ]
    if (puede('servicios.ver')) {
        acciones.push({ etiqueta: 'Abrir servicio', icono: ICONOS.abrir, to: `/servicios/${promesa.servicio_id}`, soloMenu: true, grupo: 'Ver' })
    }
    if (puede('promesas.aprobar') && promesa.estado === 'pendiente_aprobacion') {
        acciones.push({ etiqueta: 'Aprobar', icono: 'i-lucide-check', alElegir: () => abrirAprobar(promesa), soloMenu: true, grupo: 'Decidir' })
    }
    if (puedeRechazar(promesa)) {
        acciones.push({ etiqueta: 'Rechazar', icono: 'i-lucide-x', alElegir: () => abrirCierre(promesa, 'rechazar'), soloMenu: true, grupo: 'Decidir', color: 'error' })
    }
    if (puedeCancelar(promesa)) {
        acciones.push({ etiqueta: 'Cancelar promesa', icono: 'i-lucide-circle-slash', alElegir: () => abrirCierre(promesa, 'cancelar'), soloMenu: true, grupo: 'Decidir', color: 'error' })
    }
    return acciones
}

const menuFila = useMenuFila(accionesPromesa)

const hayFiltros = computed(() => estado.value !== TODOS || tipo.value !== TODOS || motivo.value !== TODOS || clienteId.value !== 0 || servicioId.value !== 0)
/** «Más filtros»: estado y motivo (solo en «Todas»). */
const filtrosAbiertos = ref(estado.value !== TODOS || motivo.value !== TODOS)

async function aplicarFiltros() {
    const query: Record<string, string> = {}
    if (pestana.value !== 'activas') {
        query.pestana = pestana.value
    }
    if (seleccionada.value) {
        query.id = String(seleccionada.value)
    }
    if (estado.value !== TODOS) {
        query.estado = estado.value
    }
    if (tipo.value !== TODOS) {
        query.tipo = tipo.value
    }
    if (conMotivo.value && motivo.value !== TODOS) {
        query.motivo_reconexion = motivo.value
    }
    if (clienteId.value) {
        query.cliente = String(clienteId.value)
    }
    if (servicioId.value) {
        query.servicio = String(servicioId.value)
    }
    await router.replace({ query })
    if (pestana.value !== 'por_vencer') {
        await lista.recargar()
    }
    asegurarSeleccion()
}

function asegurarSeleccion() {
    if (!esEscritorio()) {
        return
    }
    if (!filas.value.some(p => p.id === seleccionada.value)) {
        seleccionada.value = filas.value[0]?.id ?? 0
    }
}

function recargarTodo() {
    void lista.recargar().then(asegurarSeleccion)
    void cargarConteos()
}

function limpiarFiltros() {
    estado.value = TODOS
    tipo.value = TODOS
    motivo.value = TODOS
    clienteId.value = 0
    clienteElegido.value = null
    servicioId.value = 0
}

function alElegirCliente(cliente: Cliente) {
    clienteElegido.value = cliente
    nombres.recordar(cliente.id, cliente.nombre)
}

function abrirAprobar(promesa: Promesa) {
    detalleMovil.value = false
    porAprobar.value = promesa
    aprobarAbierto.value = true
}

// Rechazar (solo pendientes) y cancelar (activa o pendiente), con motivo (A3, día 4).
const cierre = shallowRef<{ promesa: Promesa, accion: 'rechazar' | 'cancelar' } | null>(null)
const cierreAbierto = ref(false)

const puedeRechazar = (promesa: Promesa) => puede('promesas.rechazar') && promesa.estado === 'pendiente_aprobacion'
const puedeCancelar = (promesa: Promesa) => puede('promesas.cancelar') && (promesa.estado === 'activa' || promesa.estado === 'pendiente_aprobacion')

function abrirCierre(promesa: Promesa, accion: 'rechazar' | 'cancelar') {
    detalleMovil.value = false
    cierre.value = { promesa, accion }
    cierreAbierto.value = true
}

function ejecutarCierre(motivo: string, clave: string) {
    const actual = cierre.value
    if (!actual) {
        return Promise.resolve<Resultado<Promesa>>({ ok: false, problema: { type: 'about:blank', title: 'Sin promesa', status: 0 } })
    }
    return actual.accion === 'rechazar'
        ? usePromesas().rechazar(actual.promesa.id, motivo, clave)
        : usePromesas().cancelar(actual.promesa.id, motivo, clave)
}

function alCerrar(promesa: Promesa) {
    toast.add({
        title: promesa.estado === 'rechazada' ? 'Promesa rechazada' : 'Promesa cancelada',
        description: `Promesa #${promesa.id} · servicio ${promesa.servicio_id}`,
        icon: 'i-lucide-circle-slash',
        color: 'success',
    })
    recargarTodo()
}

function alAprobar(promesa: Promesa) {
    toast.add({ title: 'Promesa aprobada', description: `Promesa #${promesa.id} · servicio ${promesa.servicio_id}`, icon: 'i-lucide-check', color: 'success' })
    recargarTodo()
}

function alCrear(promesa: Promesa) {
    seleccionada.value = promesa.id
    recargarTodo()
}

watch(tipo, (valor) => {
    // Con «Promesa» no hay motivo de reconexión: la API devolvería la lista vacía.
    if (valor === 'promesa') {
        motivo.value = TODOS
    }
})
watch([pestana, estado, tipo, motivo, clienteId, servicioId], aplicarFiltros)
watch(clienteId, () => void cargarConteos())
watch(porVencer, () => {
    if (pestana.value === 'por_vencer') {
        asegurarSeleccion()
    }
})
watch(seleccionada, (id) => {
    if (id && String(id) !== route.query.id) {
        void router.replace({ query: { ...route.query, id: String(id) } })
    }
})

const simuladorAbierto = ref(false)

onMounted(async () => {
    recargarTodo()
    void cargarCumplimiento()
    // Sin `clientes.ver` el filtro por cliente sigue por id, sin pedir su nombre (revisión de ACL).
    if (clienteId.value && puede('clientes.ver')) {
        const resultado = await useClientes().ver(clienteId.value)
        if (resultado.ok) {
            alElegirCliente(resultado.data)
        }
    }
})
</script>

<template>
    <PanelPagina
        id="promesas"
        titulo="Promesas de pago"
        icono="i-lucide-hand"
        descripcion="Compromisos de pago por servicio y reconexiones temporales mientras caja revisa un comprobante"
    >
        <template #acciones>
            <UButton
                v-if="puede('plantillas.ver')"
                to="/plantillas?seccion=promesas"
                label="Reglas por plantilla"
                icon="i-lucide-gauge"
                color="neutral"
                variant="outline"
                size="lg"
                class="boton-flotante"
            />
            <UButton
                v-if="puede('promesas.crear')"
                label="Nueva promesa"
                icon="i-lucide-plus"
                size="lg"
                class="glow-brand px-5"
                data-prueba="abrir-simulador"
                @click="simuladorAbierto = true"
            />
        </template>

        <div class="flex flex-col gap-4 lg:min-h-0 lg:flex-1">
            <!-- Contadores. -->
            <div
                class="grid grid-cols-2 gap-3 xl:grid-cols-4"
                data-prueba="contadores-promesas"
            >
                <TarjetaDato
                    etiqueta="Activas"
                    icono="i-lucide-hand"
                    :valor="conteo(activas, activasMas)"
                    :detalle="montoActivas ? `${formatearQuetzales(montoActivas)} comprometidos` : undefined"
                    :problema="problemaConteo"
                    @reintentar="cargarConteos"
                />
                <TarjetaDato
                    etiqueta="Vencen hoy"
                    icono="i-lucide-clock"
                    tono="tono-error"
                    :valor="activas ? String(activas.filter(venceHoy).length) : null"
                    detalle="se cortan a la hora de corte si no pagan"
                    :problema="problemaConteo"
                    @reintentar="cargarConteos"
                />
                <TarjetaDato
                    v-if="puede('reportes.ver')"
                    etiqueta="Cumplidas este mes"
                    icono="i-lucide-circle-check"
                    tono="tono-exito"
                    :valor="cumplimiento ? `${Math.round(cumplimiento.tasa)} %` : null"
                    :detalle="cumplimiento ? `${cumplimiento.cumplidas} de ${cumplimiento.cerradas}` : undefined"
                    :problema="problemaCumplimiento"
                    @reintentar="cargarCumplimiento"
                />
                <TarjetaDato
                    etiqueta="Esperan a un supervisor"
                    icono="i-lucide-user-round"
                    tono="tono-aviso"
                    :valor="conteo(pendientes, pendientesMas)"
                    detalle="fuera de política"
                    :problema="problemaConteo"
                    @reintentar="cargarConteos"
                />
            </div>

            <div class="grid gap-4 lg:min-h-0 lg:flex-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
                <section class="surface-card flex min-h-0 min-w-0 flex-col overflow-hidden rounded-[1.375rem] lg:max-h-[calc(100dvh-17rem)]">
                    <div class="flex flex-col gap-3 border-b border-(--ax-borde) p-3 sm:p-4">
                        <OperPestanas
                            v-model="pestana"
                            :items="pestanas"
                            etiqueta="Promesas por estado"
                        />
                        <div class="flex flex-wrap items-center gap-2">
                            <ClienteSelector
                                v-model="clienteId"
                                :seleccionado="clienteElegido"
                                placeholder="Cliente: nombre, NIT o teléfono"
                                aria-label="Filtrar por cliente"
                                class="w-full min-w-0 sm:min-w-60 sm:flex-1"
                                @elegido="alElegirCliente"
                            />
                            <USelect
                                v-if="pestana !== 'reconexion'"
                                v-model="tipo"
                                :items="itemsTipo"
                                icon="i-lucide-tag"
                                aria-label="Filtrar por tipo"
                                class="w-full sm:w-52"
                                data-prueba="filtro-tipo-promesa"
                            />
                            <UButton
                                v-if="pestana === 'todas'"
                                icon="i-lucide-filter"
                                label="Más filtros"
                                color="neutral"
                                :variant="filtrosAbiertos ? 'subtle' : 'outline'"
                                :aria-expanded="filtrosAbiertos"
                                aria-controls="filtros-promesas"
                                @click="filtrosAbiertos = !filtrosAbiertos"
                            />
                            <UBadge
                                v-if="servicioId"
                                :label="`Servicio ${servicioId}`"
                                icon="i-lucide-wifi"
                                color="neutral"
                                variant="outline"
                            />
                            <UButton
                                v-if="hayFiltros"
                                label="Limpiar"
                                icon="i-lucide-filter-x"
                                color="neutral"
                                variant="ghost"
                                @click="limpiarFiltros"
                            />
                        </div>
                        <div
                            v-if="pestana === 'todas' && filtrosAbiertos"
                            id="filtros-promesas"
                            class="grid gap-3 rounded-xl bg-(--ax-panel) p-3 sm:grid-cols-2"
                            role="group"
                            aria-label="Más filtros de promesas"
                        >
                            <USelect
                                v-model="estado"
                                :items="itemsEstado"
                                icon="i-lucide-activity"
                                aria-label="Filtrar por estado"
                                class="w-full"
                            />
                            <USelect
                                v-if="conMotivo"
                                v-model="motivo"
                                :items="itemsMotivo"
                                icon="i-lucide-clock-alert"
                                aria-label="Filtrar por motivo de reconexión"
                                class="w-full"
                                data-prueba="filtro-motivo-reconexion"
                            />
                        </div>
                    </div>

                    <div
                        v-if="pestana !== 'por_vencer' && lista.problema.value"
                        class="p-4"
                    >
                        <ProblemaAlerta
                            :problema="lista.problema.value"
                            :reintentar="lista.recargar"
                            :reintentando="lista.cargando.value"
                        />
                    </div>
                    <div
                        v-else-if="pestana === 'por_vencer' && problemaConteo"
                        class="p-4"
                    >
                        <ProblemaAlerta
                            :problema="problemaConteo"
                            :reintentar="cargarConteos"
                        />
                    </div>

                    <template v-else>
                        <div class="min-h-0 flex-1 overflow-y-auto">
                            <UContextMenu :items="menuFila.items.value">
                                <UTable
                                    :data="filas"
                                    :columns="columnas"
                                    :loading="pestana === 'por_vencer' ? activas === null : lista.cargando.value"
                                    :meta="metaTabla"
                                    sticky
                                    :ui="{ root: 'rounded-none bg-transparent ring-0 shadow-none dark:shadow-none', td: 'py-3' }"
                                    data-menu-contextual
                                    @select="alElegirFila"
                                    @contextmenu="menuFila.alContextmenu"
                                >
                                    <template #servicio_id-cell="{ row }">
                                        <div class="flex min-w-40 items-center gap-3">
                                            <span class="pastilla-icono pastilla-tono tono-marca hidden size-9 shrink-0 rounded-xl sm:inline-flex">
                                                <UIcon
                                                    :name="row.original.tipo === 'reconexion_temporal' ? 'i-lucide-power' : 'i-lucide-hand'"
                                                    class="size-4"
                                                />
                                            </span>
                                            <div class="flex min-w-0 flex-col">
                                                <span class="font-mono font-semibold text-highlighted">Servicio {{ row.original.servicio_id }}</span>
                                                <span class="truncate text-xs text-muted">{{ nombres.nombre(row.original.cliente_id) }}</span>
                                                <span class="text-xs text-muted sm:hidden">{{ formatearQuetzales(row.original.monto) }} · vence {{ formatearFechaHora(row.original.vence_en) }}</span>
                                                <PromesaOrigen
                                                    :promesa="row.original"
                                                    class="mt-0.5"
                                                />
                                            </div>
                                        </div>
                                    </template>

                                    <template #tipo-cell="{ row }">
                                        <span
                                            class="pastilla-tono rounded-full px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap"
                                            :class="row.original.tipo === 'reconexion_temporal' ? 'tono-2' : 'tono-marca'"
                                        >{{ TIPOS_PROMESA[row.original.tipo ?? 'promesa'].etiqueta }}</span>
                                    </template>

                                    <template #canal-cell="{ row }">
                                        <span class="text-sm">{{ CANALES_PROMESA[row.original.canal] }}</span>
                                        <span
                                            v-if="row.original.motivo_reconexion"
                                            class="block text-xs text-muted"
                                        >{{ etiquetaMotivoReconexion(row.original) }}</span>
                                    </template>

                                    <template #monto-cell="{ row }">
                                        <span class="font-bold whitespace-nowrap tabular-nums text-highlighted">{{ formatearQuetzales(row.original.monto) }}</span>
                                    </template>

                                    <template #vence_en-cell="{ row }">
                                        <div class="flex w-36 flex-col gap-1">
                                            <span class="text-sm font-semibold text-highlighted">{{ formatearFechaHora(row.original.vence_en) }}</span>
                                            <template v-if="row.original.estado === 'activa'">
                                                <UProgress
                                                    :model-value="avance(row.original).porcentaje"
                                                    size="xs"
                                                    :ui="{ indicator: avance(row.original).color }"
                                                    :aria-label="`Tiempo que pasó de la promesa ${row.original.id}`"
                                                />
                                                <span
                                                    class="text-xs"
                                                    :class="avance(row.original).color === 'bg-error' ? 'text-error' : 'text-muted'"
                                                >{{ avance(row.original).texto }}</span>
                                            </template>
                                        </div>
                                    </template>

                                    <template #estado-cell="{ row }">
                                        <div class="flex max-w-56 flex-col gap-1">
                                            <UBadge
                                                :label="ESTADOS_PROMESA[row.original.estado].etiqueta"
                                                :icon="ESTADOS_PROMESA[row.original.estado].icono"
                                                :color="ESTADOS_PROMESA[row.original.estado].color"
                                                variant="subtle"
                                                size="sm"
                                                class="self-start"
                                            />
                                            <EvaluacionPromesa
                                                v-if="row.original.estado !== 'activa'"
                                                :promesa="row.original"
                                                compacta
                                            />
                                        </div>
                                    </template>

                                    <template #acciones-cell="{ row }">
                                        <UDropdownMenu
                                            :items="menuFila.itemsDe(row.original)"
                                            :content="{ align: 'end' }"
                                        >
                                            <UButton
                                                icon="i-lucide-ellipsis"
                                                color="neutral"
                                                variant="ghost"
                                                size="sm"
                                                :aria-label="`Más acciones: promesa ${row.original.id}`"
                                                @click.stop
                                            />
                                        </UDropdownMenu>
                                    </template>

                                    <template #empty>
                                        <UEmpty
                                            icon="i-lucide-calendar-x"
                                            :title="hayFiltros ? 'Ninguna promesa coincide' : 'No hay promesas aquí'"
                                            :description="puede('promesas.crear') ? 'Crea una con «Nueva promesa»: verás la regla que aplica antes de guardarla.' : undefined"
                                            variant="naked"
                                        />
                                    </template>
                                </UTable>
                            </UContextMenu>
                        </div>

                        <div
                            v-if="pestana !== 'por_vencer' && (lista.hayAnterior.value || lista.haySiguiente.value)"
                            class="border-t border-(--ax-borde) px-4 py-2"
                        >
                            <PaginacionCursor
                                :pagina="lista.pagina.value"
                                :hay-anterior="lista.hayAnterior.value"
                                :hay-siguiente="lista.haySiguiente.value"
                                :cargando="lista.cargando.value"
                                :filas="lista.filas.value.length"
                                @anterior="lista.anterior"
                                @siguiente="lista.siguiente"
                            />
                        </div>
                        <footer class="flex items-center justify-between gap-3 border-t border-(--ax-borde) px-4 py-2.5 text-xs text-muted">
                            <span class="flex items-center gap-1.5">
                                <UIcon
                                    name="i-lucide-info"
                                    class="size-3.5 shrink-0"
                                />
                                <span>Una promesa es <strong>por servicio</strong> y cubre todo lo vencido de ese servicio. Argos calcula el monto.</span>
                            </span>
                            <span class="shrink-0 tabular-nums">{{ filas.length }} {{ filas.length === 1 ? 'promesa' : 'promesas' }}</span>
                        </footer>
                    </template>
                </section>

                <!-- La promesa abierta (escritorio). -->
                <PromesaDetalle
                    v-if="promesaAbierta"
                    :promesa="promesaAbierta"
                    :nombre-cliente="nombres.nombre(promesaAbierta.cliente_id)"
                    class="hidden lg:flex lg:max-h-[calc(100dvh-17rem)]"
                    @aprobar="abrirAprobar"
                    @cerrar="abrirCierre"
                />
                <div
                    v-else
                    class="surface-card hidden items-center justify-center rounded-[1.375rem] p-6 lg:flex"
                >
                    <UEmpty
                        icon="i-lucide-mouse-pointer-click"
                        title="Elige una promesa"
                        description="Aquí ves qué cubre, la regla que aplicó y sus acciones."
                        variant="naked"
                    />
                </div>
            </div>
        </div>

        <!-- Teléfono: la promesa abierta a pantalla completa, con aprobar o rechazar abajo (decisión 9). -->
        <USlideover
            v-model:open="detalleMovil"
            :title="promesaAbierta ? `Servicio ${promesaAbierta.servicio_id}` : 'Promesa'"
            :description="promesaAbierta ? nombres.nombre(promesaAbierta.cliente_id) : undefined"
            :ui="{ content: 'max-w-none', body: 'p-0 sm:p-0' }"
        >
            <template #body>
                <PromesaDetalle
                    v-if="promesaAbierta"
                    :promesa="promesaAbierta"
                    :nombre-cliente="nombres.nombre(promesaAbierta.cliente_id)"
                    sin-encabezado
                    class="h-full rounded-none border-0 shadow-none"
                    @aprobar="abrirAprobar"
                    @cerrar="abrirCierre"
                />
            </template>
        </USlideover>

        <PromesaAprobarModal
            v-model:open="aprobarAbierto"
            :promesa="porAprobar"
            :nombre-cliente="porAprobar ? nombres.nombre(porAprobar.cliente_id) : undefined"
            @aprobada="alAprobar"
        />

        <AccionMotivoModal
            v-model:open="cierreAbierto"
            :titulo="cierre?.accion === 'rechazar' ? 'Rechazar promesa' : 'Cancelar promesa'"
            :descripcion="cierre ? `Promesa #${cierre.promesa.id} · ${nombres.nombre(cierre.promesa.cliente_id)} · ${formatearQuetzales(cierre.promesa.monto)}` : undefined"
            :efecto="cierre?.accion === 'rechazar'
                ? 'La promesa no se activa y el servicio sigue como está.'
                : cierre?.promesa.estado === 'activa'
                    ? 'La promesa deja de proteger el servicio: se vuelve a evaluar y puede cortarse si tiene avisos vencidos.'
                    : 'La promesa pendiente se descarta sin activarse.'"
            :confirmar="cierre?.accion === 'rechazar' ? 'Rechazar' : 'Cancelar promesa'"
            :icono="cierre?.accion === 'rechazar' ? 'i-lucide-x' : 'i-lucide-circle-slash'"
            placeholder="Ej.: el cliente ya no puede pagar en esa fecha"
            :ejecutar="ejecutarCierre"
            @hecho="alCerrar"
        />

        <PromesaSimularModal
            v-model:open="simuladorAbierto"
            :cliente-inicial="clienteElegido"
            @creada="alCrear"
        />
    </PanelPagina>
</template>
