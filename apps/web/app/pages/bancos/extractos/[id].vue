<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { DropdownMenuItem } from '@nuxt/ui'
import Decimal from 'decimal.js'

/**
 * Conciliación bancaria de un estado de cuenta (tablero NuevoConciliacion): a la izquierda las
 * líneas del banco, a la derecha lo registrado en Argos (movimientos del libro sin conciliar,
 * depósitos de caja y traslados en tránsito hacia la cuenta). Se marca una línea, Argos propone
 * su pareja (igual monto y referencia, en ámbar para confirmar) y «Conciliar» la liga
 * (`POST /bancos/conciliaciones`). «Automático» aplica las reglas. Abajo, lo que queda sin pareja
 * y las acciones para registrar un gasto bancario o un ingreso sin documento.
 */
definePageMeta({ permiso: 'bancos.ver' })

const route = useRoute()
const router = useRouter()
const toast = useToast()
const { puede, enlace } = usePermisos()

const extractoId = computed(() => Number(route.params.id))
const extracto = shallowRef<Extracto | null>(null)
const lineas = shallowRef<LineaExtracto[]>([])
const cargando = ref(true)
const problema = ref<Problem | null>(null)

const partidas = shallowRef<PartidaConciliable[]>([])
const problemaPartidas = ref<Problem | null>(null)
const reporte = shallowRef<ResumenConciliacionBancaria | null>(null)
const problemaReporte = ref<Problem | null>(null)
const otros = shallowRef<Extracto[]>([])
const cuentasBanco = shallowRef<CuentaBancaria[]>([])

const lineaElegida = ref<number | null>(null)
const elegidas = ref<string[]>([])
const conciliando = ref(false)
const problemaConciliar = ref<Problem | null>(null)
const aplicando = ref(false)
const resultadoReglas = shallowRef<ResultadoAplicarReglas | null>(null)
const problemaReglas = ref<Problem | null>(null)
const importarAbierto = ref(false)

useHead(() => ({ title: `Conciliación · ${extracto.value?.cuenta_nombre ?? `extracto #${route.params.id}`} · ArgosIsp` }))

const linea = computed(() => lineas.value.find(l => l.id === lineaElegida.value) ?? null)
const seleccion = computed(() => partidas.value.filter(p => elegidas.value.includes(p.clave)))
const sugeridas = computed(() => (linea.value && !linea.value.conciliada ? sugerenciaConciliacion(linea.value, partidas.value).map(p => p.clave) : []))
const diferencia = computed(() => (linea.value ? diferenciaConciliacion(linea.value, seleccion.value) : null))
const conciliadas = computed(() => lineas.value.filter(l => l.conciliada).length)
const sinPareja = computed(() => lineas.value.filter(l => !l.conciliada))

/** Lo de Argos ya conciliado con alguna línea del extracto (se pinta en verde). */
const movimientosConciliados = computed(() => lineas.value.filter(l => l.conciliada).flatMap(l => l.movimientos.map(m => ({ ...m, lineaId: l.id }))))

const itemsPeriodo = computed(() => otros.value.map(e => ({ label: `${formatearFechaCorta(e.desde)} al ${formatearFechaCorta(e.hasta)}`, value: e.id })))
const periodo = computed({
    get: () => extractoId.value,
    set: (id: number) => {
        void router.push(`/bancos/extractos/${id}`)
    },
})
const itemsCuenta = computed<DropdownMenuItem[][]>(() => [cuentasBanco.value.filter(c => c.activa).map(c => ({
    label: `${c.banco_nombre} · ${c.alias} ···${c.numero.replace(/\D/g, '').slice(-4)}`,
    icon: 'i-lucide-landmark',
    type: 'checkbox' as const,
    checked: c.cuenta_id === extracto.value?.cuenta_id,
    onSelect: () => {
        void irACuenta(c.cuenta_id)
    },
}))])

async function irACuenta(cuentaId: number) {
    const resultado = await useExtractos().listar(cuentaId)
    const ultimo = resultado.ok ? resultado.data.data[0] : undefined
    if (ultimo) {
        await router.push(`/bancos/extractos/${ultimo.id}`)
    }
    else {
        await router.push(`/bancos/extractos?cuenta=${cuentaId}`)
    }
}

async function cargarPartidas(cuentaId: number) {
    const transito = useFondosEnTransito()
    const [movimientos, depositos, traslados] = await Promise.all([
        useConciliaciones().sinConciliar(cuentaId),
        transito.depositos('en_transito', undefined, 200),
        transito.traslados('en_transito', undefined, 200),
    ])
    const fallo = (!movimientos.ok ? movimientos.problema : null) ?? (!depositos.ok ? depositos.problema : null) ?? (!traslados.ok ? traslados.problema : null)
    if (fallo || !movimientos.ok || !depositos.ok || !traslados.ok) {
        partidas.value = []
        problemaPartidas.value = fallo
        return
    }
    problemaPartidas.value = null
    partidas.value = [
        ...movimientos.data.map((m): PartidaConciliable => ({ clave: `m${m.movimiento_id}`, tipo: 'movimiento', id: m.movimiento_id, fecha: m.fecha, descripcion: m.descripcion, monto: m.monto })),
        ...depositos.data.data.filter(d => d.cuenta_id === cuentaId).map((d): PartidaConciliable => ({ clave: `d${d.id}`, tipo: 'deposito', id: d.id, fecha: d.fecha, descripcion: `Depósito #${d.id} · boleta ${d.boleta} · ${d.caja_nombre}`, monto: d.monto })),
        ...traslados.data.data.filter(t => t.cuenta_destino_id === cuentaId).map((t): PartidaConciliable => ({ clave: `t${t.id}`, tipo: 'traslado', id: t.id, fecha: t.fecha, descripcion: `Traslado #${t.id} · ${t.referencia} · desde ${t.cuenta_origen_codigo}`, monto: t.monto })),
    ].sort((a, b) => a.fecha.localeCompare(b.fecha))
}

async function cargarReporte(datos: Extracto) {
    if (!puede('reportes.ver')) {
        return
    }
    const resultado = await useConciliaciones().reporte(datos.cuenta_id, datos.hasta)
    reporte.value = resultado.ok ? (resultado.data.find(r => r.cuenta_id === datos.cuenta_id) ?? null) : null
    problemaReporte.value = resultado.ok ? null : resultado.problema
}

async function cargar() {
    cargando.value = true
    problema.value = null
    const [rExtracto, rLineas] = await Promise.all([useExtractos().ver(extractoId.value), useExtractos().lineas(extractoId.value)])
    cargando.value = false
    if (!rExtracto.ok || !rLineas.ok) {
        extracto.value = null
        lineas.value = []
        problema.value = !rExtracto.ok ? rExtracto.problema : (!rLineas.ok ? rLineas.problema : null)
        return
    }
    extracto.value = rExtracto.data
    lineas.value = rLineas.data
    if (lineaElegida.value === null || lineas.value.find(l => l.id === lineaElegida.value)?.conciliada) {
        lineaElegida.value = lineas.value.find(l => !l.conciliada)?.id ?? null
    }
    await Promise.all([
        cargarPartidas(rExtracto.data.cuenta_id),
        cargarReporte(rExtracto.data),
        useExtractos().listar(rExtracto.data.cuenta_id).then((r) => {
            otros.value = r.ok ? r.data.data : [rExtracto.data]
        }),
        cuentasBanco.value.length || !puede('cuentas_bancarias.ver')
            ? Promise.resolve()
            : useCuentasBancarias().listar({ activa: true }).then((r) => {
                    cuentasBanco.value = r.ok ? r.data : []
                }),
    ])
    elegidas.value = sugeridas.value
}

function elegirLinea(l: LineaExtracto) {
    lineaElegida.value = l.id
    problemaConciliar.value = null
    elegidas.value = l.conciliada ? [] : sugeridas.value
}

function alternarPartida(clave: string) {
    if (!linea.value || linea.value.conciliada) {
        return
    }
    elegidas.value = elegidas.value.includes(clave) ? elegidas.value.filter(c => c !== clave) : [...elegidas.value, clave]
}

async function conciliar() {
    if (!linea.value || !seleccion.value.length || conciliando.value) {
        return
    }
    conciliando.value = true
    problemaConciliar.value = null
    const resultado = await useConciliaciones().conciliar(cuerpoConciliacion(linea.value.id, seleccion.value), nuevaClaveIdempotencia())
    conciliando.value = false
    if (!resultado.ok) {
        problemaConciliar.value = resultado.problema
        return
    }
    toast.add({ title: 'Línea conciliada', description: `${resultado.data.movimientos.length} ${resultado.data.movimientos.length === 1 ? 'movimiento' : 'movimientos'} · ${formatearQuetzales(resultado.data.monto)}`, icon: 'i-lucide-link', color: 'success' })
    lineaElegida.value = null
    await cargar()
}

async function aplicarReglas() {
    aplicando.value = true
    problemaReglas.value = null
    const resultado = await useExtractos().aplicarReglas(extractoId.value, nuevaClaveIdempotencia())
    aplicando.value = false
    if (!resultado.ok) {
        problemaReglas.value = resultado.problema
        return
    }
    resultadoReglas.value = resultado.data
    await cargar()
}

// Registrar sin documento, deshacer y reatribuir (como antes, en sus ventanas)
const aRegistrar = shallowRef<LineaExtracto | null>(null)
const aAnular = shallowRef<LineaExtracto | null>(null)
const aReatribuir = shallowRef<{ linea: LineaExtracto, llegada: MovimientoConciliado } | null>(null)
function modelo<T>(referencia: Ref<T | null>) {
    return computed({
        get: () => referencia.value !== null,
        set: (valor: boolean) => {
            if (!valor) {
                referencia.value = null
            }
        },
    })
}
const registrando = modelo(aRegistrar)
const anulando = modelo(aAnular)
const reatribuyendo = modelo(aReatribuir)

function llegadaDe(l: LineaExtracto): MovimientoConciliado | null {
    return l.movimientos.find(m => m.origen_tipo === 'deposito' || m.origen_tipo === 'traslado') ?? null
}

function accionesLinea(l: LineaExtracto): DropdownMenuItem[][] {
    if (!puede('bancos.conciliar')) {
        return []
    }
    if (!l.conciliada) {
        return [[{ label: new Decimal(l.monto).isNegative() ? 'Registrar gasto bancario' : 'Registrar pago recibido', icon: 'i-lucide-file-plus', onSelect: () => registrarLinea(l) }]]
    }
    const llegada = llegadaDe(l)
    return [
        ...(llegada && puede('bancos.reatribuir_llegada') ? [[{ label: 'Reatribuir la llegada', icon: 'i-lucide-arrow-left-right', onSelect: () => { aReatribuir.value = { linea: l, llegada } } }]] : []),
        [{ label: 'Deshacer conciliación', icon: 'i-lucide-unlink', color: 'error' as const, onSelect: () => { aAnular.value = l } }],
    ]
}

function registrarLinea(l: LineaExtracto) {
    aRegistrar.value = l
}

function anularSeleccionada(motivo: string, clave: string) {
    const id = aAnular.value?.conciliacion_id
    if (!id) {
        return Promise.resolve({ ok: false as const, problema: { type: 'about:blank', title: 'La línea no está conciliada', status: 0 } })
    }
    return useConciliaciones().anular(id, motivo, clave)
}

function alRegistrar(conciliacion: Conciliacion) {
    toast.add({ title: 'Línea registrada y conciliada', description: `Asiento #${conciliacion.movimientos[0]?.asiento_id ?? '—'} · ${formatearQuetzales(conciliacion.monto)}`, icon: 'i-lucide-file-plus', color: 'success' })
    void cargar()
}

function alAnular() {
    toast.add({ title: 'Conciliación deshecha', description: 'La línea y sus movimientos vuelven a estar por conciliar.', icon: 'i-lucide-unlink', color: 'neutral' })
    void cargar()
}

function alReatribuir() {
    toast.add({ title: 'Llegada reatribuida', description: 'El documento anterior volvió a tránsito y la línea quedó con el correcto.', icon: 'i-lucide-arrow-left-right', color: 'success' })
    void cargar()
}

function alImportar(nuevo: Extracto) {
    if (nuevo.id !== extractoId.value) {
        void router.push(`/bancos/extractos/${nuevo.id}`)
    }
}

const resumenSinPareja = computed(() => {
    const banco = sinPareja.value.slice(0, 3).map(l => `${l.descripcion.slice(0, 28)} ${montoConSigno(l.monto)}`).join(' y ')
    const argos = partidas.value.filter(p => !sugeridas.value.includes(p.clave)).slice(0, 2).map(p => `${p.descripcion.slice(0, 28)} ${formatearQuetzales(p.monto)}`).join(' y ')
    return { banco, argos }
})

watch(extractoId, () => {
    lineaElegida.value = null
    resultadoReglas.value = null
    void cargar()
})
onMounted(cargar)
</script>

<template>
    <PanelPagina
        id="extracto"
        titulo="Conciliación bancaria"
        icono="i-lucide-scale"
        descripcion=""
        sin-descripcion
    >
        <template #acciones>
            <UDropdownMenu
                v-if="cuentasBanco.length"
                :items="itemsCuenta"
                :content="{ align: 'end' }"
            >
                <UButton
                    :label="extracto?.cuenta_nombre ?? 'Cuenta'"
                    icon="i-lucide-landmark"
                    trailing-icon="i-lucide-chevron-down"
                    color="neutral"
                    variant="outline"
                    class="max-w-72 rounded-xl"
                    :ui="{ label: 'truncate' }"
                    data-prueba="conciliacion-cuenta"
                />
            </UDropdownMenu>
            <USelect
                v-if="itemsPeriodo.length"
                v-model="periodo"
                :items="itemsPeriodo"
                icon="i-lucide-calendar"
                aria-label="Estado de cuenta"
                class="w-52"
                :ui="{ base: 'rounded-xl' }"
                data-prueba="conciliacion-periodo"
            />
            <UButton
                v-if="puede('bancos.importar_extracto_archivo')"
                label="Importar estado de cuenta"
                icon="i-lucide-file-up"
                color="neutral"
                variant="outline"
                class="rounded-xl"
                :ui="{ label: 'hidden sm:inline' }"
                aria-label="Importar estado de cuenta"
                data-prueba="importar-extracto"
                @click="importarAbierto = true"
            />
        </template>

        <USkeleton
            v-if="cargando && !extracto"
            class="h-80 w-full"
        />
        <UEmpty
            v-else-if="problema?.status === 404"
            icon="i-lucide-file-x"
            title="Estado de cuenta no encontrado"
            :actions="[{ label: 'Volver', to: '/bancos/extractos', icon: 'i-lucide-arrow-left', color: 'neutral', variant: 'subtle' }]"
        />
        <ProblemaAlerta
            v-else-if="problema"
            :problema="problema"
            :reintentar="cargar"
            :reintentando="cargando"
        />

        <div
            v-else-if="extracto"
            class="flex min-h-0 flex-1 flex-col gap-4"
        >
            <div
                class="grid grid-cols-2 gap-3 lg:grid-cols-4"
                data-prueba="contadores-conciliacion"
            >
                <div class="surface-card flex flex-col rounded-2xl p-3 sm:p-4">
                    <span class="text-xs text-muted">Saldo según el banco</span>
                    <span
                        class="text-lg font-bold tabular-nums text-highlighted sm:text-xl"
                        data-prueba="saldo-extracto"
                    >{{ formatearQuetzales(extracto.saldo_final) }}</span>
                </div>
                <div class="surface-card flex flex-col rounded-2xl p-3 sm:p-4">
                    <span class="text-xs text-muted">Saldo según Argos</span>
                    <span
                        class="text-lg font-bold tabular-nums text-highlighted sm:text-xl"
                        data-prueba="saldo-libro"
                    >{{ reporte ? formatearQuetzales(reporte.saldo_libro) : '—' }}</span>
                </div>
                <div
                    class="flex flex-col rounded-2xl border p-3 sm:p-4"
                    :class="reporte && !reporte.cuadra ? 'border-warning/50 bg-warning/10' : 'surface-card'"
                >
                    <span
                        class="text-xs"
                        :class="reporte && !reporte.cuadra ? 'text-warning' : 'text-muted'"
                    >Diferencia por explicar</span>
                    <span
                        class="text-lg font-bold tabular-nums sm:text-xl"
                        :class="reporte && !reporte.cuadra ? 'text-warning' : 'text-highlighted'"
                        data-prueba="cuadra-conciliacion"
                    >{{ reporte ? (reporte.cuadra ? 'Cuadra' : montoConSigno(reporte.diferencia)) : '—' }}</span>
                </div>
                <div class="surface-card flex flex-col gap-1 rounded-2xl p-3 sm:p-4">
                    <span class="text-xs text-muted">Conciliados</span>
                    <span
                        class="text-lg font-bold tabular-nums text-highlighted sm:text-xl"
                        data-prueba="avance-conciliacion"
                    >{{ conciliadas }} de {{ lineas.length }}</span>
                    <UProgress
                        :model-value="lineas.length ? (conciliadas / lineas.length) * 100 : 0"
                        color="success"
                        size="sm"
                        :aria-label="`${conciliadas} de ${lineas.length} conciliados`"
                    />
                </div>
            </div>
            <p
                v-if="problemaReporte"
                class="text-xs text-muted"
            >
                No se pudo leer el saldo del libro ({{ problemaReporte.title }}).
                <UButton
                    label="Reintentar"
                    variant="link"
                    size="xs"
                    @click="cargarReporte(extracto)"
                />
            </p>

            <ProblemaAlerta
                v-if="problemaReglas"
                :problema="problemaReglas"
                :reintentar="aplicarReglas"
                :reintentando="aplicando"
            />
            <UAlert
                v-else-if="resultadoReglas"
                :color="resultadoReglas.conciliadas.length ? 'success' : 'neutral'"
                variant="subtle"
                icon="i-lucide-zap"
                :title="`Automático: ${resultadoReglas.conciliadas.length} ${resultadoReglas.conciliadas.length === 1 ? 'línea conciliada' : 'líneas conciliadas'}`"
                :description="[
                    resultadoReglas.sin_regla.length ? `${resultadoReglas.sin_regla.length} sin regla que aplique` : null,
                    resultadoReglas.sin_pago.length ? `${resultadoReglas.sin_pago.length} con regla de cliente sin un pago único que coincida` : null,
                ].filter(Boolean).join(' · ') || undefined"
                data-prueba="resultado-reglas"
            />

            <div class="grid min-h-0 flex-1 gap-3 lg:grid-cols-[minmax(0,1fr)_9.5rem_minmax(0,1fr)]">
                <!-- Banco -->
                <section
                    class="surface-card flex min-h-64 flex-col overflow-hidden rounded-2xl"
                    aria-label="Estado de cuenta del banco"
                >
                    <h2 class="flex items-center gap-2 border-b border-(--ax-borde) px-4 py-3">
                        <UIcon
                            name="i-lucide-landmark"
                            class="size-4 text-muted"
                        />
                        <span class="font-bold text-highlighted">Estado de cuenta del banco</span>
                        <span class="truncate text-xs font-normal text-muted">importado {{ formatearFechaCorta(extracto.created_at) }} {{ formatearHora(extracto.created_at) }}</span>
                    </h2>
                    <ul
                        class="min-h-0 flex-1 overflow-y-auto"
                        role="listbox"
                        aria-label="Líneas del banco"
                        data-prueba="tabla-lineas"
                    >
                        <li
                            v-for="l in lineas"
                            :key="l.id"
                            role="option"
                            :aria-selected="lineaElegida === l.id"
                            tabindex="0"
                            class="flex cursor-pointer items-center gap-3 border-b border-(--ax-borde) border-l-3 px-3 py-2.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary"
                            :class="l.conciliada ? 'border-l-success bg-success/5' : lineaElegida === l.id ? 'border-l-primary bg-primary/5' : 'border-l-transparent hover:bg-(--ax-fila-hover)'"
                            :data-linea="l.id"
                            @click="elegirLinea(l)"
                            @keydown.enter.prevent="elegirLinea(l)"
                            @keydown.space.prevent="elegirLinea(l)"
                        >
                            <UIcon
                                :name="l.conciliada ? 'i-lucide-circle-check' : lineaElegida === l.id ? 'i-lucide-circle-dot' : 'i-lucide-circle'"
                                class="size-5 shrink-0"
                                :class="l.conciliada ? 'text-success' : lineaElegida === l.id ? 'text-primary' : 'text-dimmed'"
                            />
                            <span class="w-12 shrink-0 text-muted">{{ formatearFechaCorta(l.fecha) }}</span>
                            <span class="min-w-0 flex-1">
                                <span class="block truncate">{{ l.descripcion }}</span>
                                <span
                                    v-if="l.referencia"
                                    class="block truncate text-xs text-muted"
                                >ref. {{ l.referencia }}</span>
                            </span>
                            <span
                                class="shrink-0 font-bold tabular-nums"
                                :class="l.monto.startsWith('-') ? 'text-error' : 'text-highlighted'"
                            >{{ l.monto.startsWith('-') ? `− ${formatearQuetzales(new Decimal(l.monto).abs())}` : formatearQuetzales(l.monto) }}</span>
                            <UDropdownMenu
                                v-if="accionesLinea(l).length"
                                :items="accionesLinea(l)"
                                :content="{ align: 'end' }"
                            >
                                <UButton
                                    icon="i-lucide-ellipsis"
                                    color="neutral"
                                    variant="ghost"
                                    size="xs"
                                    :aria-label="`Más acciones de la línea ${l.orden}`"
                                    :data-acciones-linea="l.id"
                                    @click.stop
                                />
                            </UDropdownMenu>
                        </li>
                        <li
                            v-if="!lineas.length"
                            class="p-6"
                        >
                            <UEmpty
                                icon="i-lucide-list"
                                title="El estado de cuenta no tiene líneas"
                                variant="naked"
                            />
                        </li>
                    </ul>
                </section>

                <!-- Acciones centrales -->
                <div class="flex flex-col items-stretch justify-center gap-2 max-lg:order-last lg:pb-24">
                    <UButton
                        v-if="puede('bancos.conciliar')"
                        icon="i-lucide-check"
                        color="primary"
                        class="glow-brand flex-col gap-0.5 rounded-3xl py-4 text-center"
                        :disabled="!linea || linea.conciliada || !seleccion.length"
                        :loading="conciliando"
                        data-prueba="conciliar"
                        @click="conciliar"
                    >
                        <span class="font-bold">Conciliar</span>
                        <span class="text-[0.6875rem] font-normal opacity-90">la pareja marcada</span>
                    </UButton>
                    <UButton
                        v-if="puede('bancos.conciliar')"
                        label="Automático"
                        icon="i-lucide-zap"
                        color="neutral"
                        variant="outline"
                        class="justify-center rounded-full"
                        :loading="aplicando"
                        :disabled="!sinPareja.length"
                        data-prueba="aplicar-reglas"
                        @click="aplicarReglas"
                    />
                    <p class="text-center text-[0.6875rem] text-muted">
                        Une por monto, fecha y referencia. Lo dudoso queda en amarillo para que lo confirmes.
                    </p>
                    <p
                        v-if="linea && diferencia && seleccion.length && !diferencia.isZero()"
                        class="text-center text-xs text-warning"
                        data-prueba="diferencia-pareja"
                    >
                        Falta {{ formatearQuetzales(diferencia.abs()) }} para cuadrar
                    </p>
                    <ProblemaAlerta
                        v-if="problemaConciliar"
                        :problema="problemaConciliar"
                    />
                </div>

                <!-- Argos -->
                <section
                    class="surface-card flex min-h-64 flex-col overflow-hidden rounded-2xl"
                    aria-label="Registrado en Argos"
                >
                    <h2 class="flex items-center gap-2 border-b border-(--ax-borde) px-4 py-3">
                        <UIcon
                            name="i-lucide-book-open"
                            class="size-4 text-muted"
                        />
                        <span class="font-bold text-highlighted">Registrado en Argos</span>
                        <span class="truncate text-xs font-normal text-muted">depósitos, transferencias y movimientos</span>
                    </h2>
                    <div
                        v-if="problemaPartidas"
                        class="p-3"
                    >
                        <ProblemaAlerta
                            :problema="problemaPartidas"
                            :reintentar="() => extracto && cargarPartidas(extracto.cuenta_id)"
                        />
                    </div>
                    <ul
                        v-else
                        class="min-h-0 flex-1 overflow-y-auto"
                        aria-label="Movimientos de Argos"
                        data-prueba="partidas-argos"
                    >
                        <li
                            v-for="m in movimientosConciliados"
                            :key="`c${m.movimiento_id}`"
                            class="flex items-center gap-3 border-b border-(--ax-borde) border-l-3 border-l-success bg-success/5 px-3 py-2.5 text-sm"
                        >
                            <UIcon
                                name="i-lucide-circle-check"
                                class="size-5 shrink-0 text-success"
                            />
                            <span class="min-w-0 flex-1 truncate">{{ origenAsiento(m.origen_tipo).etiqueta }} · {{ m.descripcion }}</span>
                            <span class="shrink-0 font-bold tabular-nums">{{ formatearQuetzales(m.monto) }}</span>
                        </li>
                        <li
                            v-for="p in partidas"
                            :key="p.clave"
                            class="border-b border-(--ax-borde)"
                        >
                            <UButton
                                color="neutral"
                                variant="ghost"
                                block
                                :aria-pressed="elegidas.includes(p.clave)"
                                :disabled="!linea || linea.conciliada || !puede('bancos.conciliar')"
                                class="justify-start gap-3 rounded-none border-l-3 px-3 py-2.5 text-start text-sm font-normal disabled:opacity-100"
                                :class="elegidas.includes(p.clave) ? (sugeridas.includes(p.clave) ? 'border-l-warning bg-warning/10' : 'border-l-primary bg-primary/5') : 'border-l-transparent'"
                                :data-partida="p.clave"
                                @click="alternarPartida(p.clave)"
                            >
                                <UIcon
                                    :name="elegidas.includes(p.clave) ? (sugeridas.includes(p.clave) ? 'i-lucide-circle-help' : 'i-lucide-circle-check') : 'i-lucide-circle'"
                                    class="size-5 shrink-0"
                                    :class="elegidas.includes(p.clave) ? (sugeridas.includes(p.clave) ? 'text-warning' : 'text-primary') : 'text-dimmed'"
                                />
                                <span class="w-12 shrink-0 text-muted">{{ formatearFechaCorta(p.fecha) }}</span>
                                <span class="min-w-0 flex-1 truncate text-default">{{ p.tipo === 'movimiento' ? 'Libro' : p.tipo === 'deposito' ? 'Depósito' : 'Traslado' }} · {{ p.descripcion }}</span>
                                <span class="shrink-0 font-bold tabular-nums text-highlighted">{{ formatearQuetzales(p.monto) }}</span>
                            </UButton>
                        </li>
                        <li
                            v-if="!partidas.length && !movimientosConciliados.length"
                            class="p-6"
                        >
                            <UEmpty
                                icon="i-lucide-book-open"
                                title="Nada pendiente en Argos para esta cuenta"
                                variant="naked"
                            />
                        </li>
                    </ul>
                </section>
            </div>

            <div class="surface-card flex flex-wrap items-center gap-3 rounded-2xl p-3 sm:px-4">
                <UBadge
                    :label="sinPareja.length ? `Sin pareja · ${sinPareja.length}` : 'Todo conciliado'"
                    :color="sinPareja.length ? 'warning' : 'success'"
                    :icon="sinPareja.length ? 'i-lucide-circle-dashed' : 'i-lucide-circle-check'"
                    variant="subtle"
                    class="rounded-full"
                />
                <p
                    v-if="sinPareja.length"
                    class="min-w-0 flex-1 truncate text-sm text-muted"
                >
                    Banco: <strong class="text-highlighted">{{ resumenSinPareja.banco }}</strong><template v-if="resumenSinPareja.argos">
                        · Argos: <strong class="text-highlighted">{{ resumenSinPareja.argos }}</strong>
                    </template>
                </p>
                <span
                    v-else
                    class="flex-1"
                />
                <template v-if="puede('bancos.conciliar') && linea && !linea.conciliada">
                    <UButton
                        v-if="linea.monto.startsWith('-')"
                        label="Registrar gasto bancario"
                        icon="i-lucide-plus"
                        color="neutral"
                        variant="outline"
                        class="rounded-full"
                        :data-registrar="linea.id"
                        @click="aRegistrar = linea"
                    />
                    <UButton
                        v-else
                        label="Registrar pago recibido"
                        icon="i-lucide-banknote"
                        color="neutral"
                        variant="outline"
                        class="rounded-full"
                        :data-registrar="linea.id"
                        @click="aRegistrar = linea"
                    />
                </template>
                <UButton
                    v-if="enlace(`/bancos/conciliacion?cuenta=${extracto.cuenta_id}`)"
                    :to="enlace(`/bancos/conciliacion?cuenta=${extracto.cuenta_id}`)"
                    label="Ver reporte"
                    icon="i-lucide-file-check"
                    color="success"
                    class="rounded-full"
                />
            </div>
        </div>

        <ExtractoImportarModal
            v-if="extracto"
            v-model:open="importarAbierto"
            :cuenta-id="extracto.cuenta_id"
            @hecho="alImportar"
        />
        <LineaRegistrarModal
            v-if="aRegistrar"
            v-model:open="registrando"
            :linea="aRegistrar"
            @hecho="alRegistrar"
        />
        <LlegadaReatribuirModal
            v-if="aReatribuir"
            v-model:open="reatribuyendo"
            :linea="aReatribuir.linea"
            :llegada="aReatribuir.llegada"
            @hecho="alReatribuir"
        />
        <AccionMotivoModal
            v-model:open="anulando"
            titulo="Deshacer conciliación"
            :descripcion="aAnular ? `${formatearFecha(aAnular.fecha)} · ${aAnular.descripcion} · ${montoConSigno(aAnular.monto)}` : undefined"
            efecto="La línea y sus movimientos vuelven a estar por conciliar. La llegada de un depósito o traslado ya registrada no se revierte (el dinero llegó)."
            confirmar="Deshacer conciliación"
            icono="i-lucide-unlink"
            placeholder="Ej.: se concilió con la liquidación equivocada"
            :ejecutar="anularSeleccionada"
            @hecho="alAnular"
        />
    </PanelPagina>
</template>
