<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import Decimal from 'decimal.js'

/**
 * Importar estado de cuenta (tablero NuevoImportarExtracto, `bancos.importar_extracto_archivo`):
 * el archivo tal como lo descarga el banco (Excel o CSV).
 *
 * 1. **Subir**: la cuenta y el archivo; la API lo lee (`POST /bancos/extractos/vista-previa`) y
 *    dice si reconoce el formato.
 * 2. **Columnas** (solo si no lo reconoce): qué es cada columna, la fila donde empiezan los datos,
 *    el formato de fecha y cómo vienen los montos; «Recordar este formato» lo guarda para la cuenta.
 * 3. **Revisar**: periodo, movimientos, entradas, salidas, saldos y las revisiones de la API.
 * 4. **Listo**: importado (`POST /bancos/extractos/archivo`) y, con `bancos.conciliar`, las reglas
 *    aplicadas: lo que se concilió solo, lo que queda por confirmar y lo que no tiene pareja.
 */
const props = withDefaults(defineProps<{
    /** Cuenta del libro propuesta (la del filtro de la lista): se elige su cuenta bancaria. */
    cuentaId?: number | null
}>(), {
    cuentaId: null,
})

const abierto = defineModel<boolean>('open', { default: false })

const emit = defineEmits<{
    hecho: [extracto: Extracto]
}>()

const { puede } = usePermisos()

type Paso = 'subir' | 'columnas' | 'revisar' | 'listo'
const paso = ref<Paso>('subir')
const cuentas = shallowRef<CuentaBancaria[]>([])
const problemaCuentas = ref<Problem | null>(null)
const cuentaBancariaId = ref<number | undefined>(undefined)
const archivo = ref<File | null>(null)
const vista = shallowRef<VistaPreviaExtracto | null>(null)
const mapeo = ref<MapeoExtracto | null>(null)
const leyendo = ref(false)
const problemaVista = ref<Problem | null>(null)
const recordar = ref(true)
const importando = ref(false)
const problema = ref<Problem | null>(null)
const motivoNoEncadena = ref('')
const pideMotivo = ref(false)
const importado = shallowRef<ExtractoDesdeArchivo | null>(null)
const reglas = shallowRef<ResultadoAplicarReglas | null>(null)
let clave = nuevaClaveIdempotencia()

const itemsCuenta = computed(() => cuentas.value.filter(c => c.activa).map(c => ({ label: `${c.banco_nombre} · ${c.alias} ···${c.numero.replace(/\D/g, '').slice(-4)}`, value: c.id })))
const cuenta = computed(() => cuentas.value.find(c => c.id === cuentaBancariaId.value) ?? null)
const nombreCuenta = computed(() => (cuenta.value ? `${cuenta.value.banco_nombre} ···${cuenta.value.numero.replace(/\D/g, '').slice(-4)}` : ''))
const desconocido = computed(() => Boolean(vista.value?.requiere_confirmacion))

/** Pasos visibles: «Columnas» solo cuando el formato no se reconoció. */
const pasos = computed(() => [
    { id: 'subir' as const, titulo: 'Subir' },
    ...(desconocido.value || paso.value === 'columnas' ? [{ id: 'columnas' as const, titulo: 'Columnas' }] : []),
    { id: 'revisar' as const, titulo: 'Revisar' },
    { id: 'listo' as const, titulo: 'Listo' },
])
const indicePaso = computed(() => pasos.value.findIndex(p => p.id === paso.value))

async function cargarCuentas() {
    const resultado = await useCuentasBancarias().listar({ activa: true })
    cuentas.value = resultado.ok ? resultado.data : []
    problemaCuentas.value = resultado.ok ? null : resultado.problema
    const propuesta = cuentas.value.find(c => c.cuenta_id === props.cuentaId)
    cuentaBancariaId.value = propuesta?.id ?? (cuentas.value.length === 1 ? cuentas.value[0]?.id : cuentaBancariaId.value)
}

watch(abierto, (valor) => {
    if (valor) {
        paso.value = 'subir'
        archivo.value = null
        vista.value = null
        mapeo.value = null
        problemaVista.value = null
        problema.value = null
        recordar.value = true
        pideMotivo.value = false
        motivoNoEncadena.value = ''
        importado.value = null
        reglas.value = null
        clave = nuevaClaveIdempotencia()
        void cargarCuentas()
    }
}, { immediate: true })

/** Lee el archivo en la API (sin importar): con `conMapeo`, con las columnas confirmadas aquí. */
async function leer(conMapeo = false) {
    if (!archivo.value || !cuentaBancariaId.value) {
        return
    }
    leyendo.value = true
    problemaVista.value = null
    const resultado = await useExtractos().vistaPrevia({ cuentaBancariaId: cuentaBancariaId.value, archivo: archivo.value, mapeo: conMapeo ? mapeo.value : null })
    leyendo.value = false
    if (!resultado.ok) {
        problemaVista.value = resultado.problema
        if (!conMapeo) {
            vista.value = null
        }
        return
    }
    vista.value = resultado.data
    if (!conMapeo) {
        mapeo.value = structuredClone(toRaw(resultado.data.mapeo))
    }
}

watch([archivo, cuentaBancariaId], () => {
    clave = nuevaClaveIdempotencia()
    void leer()
})

// Columnas (formato no reconocido)
type Papel = 'fecha' | 'descripcion' | 'referencia' | 'debito' | 'credito' | 'monto' | 'saldo' | 'ninguno'
const ITEMS_PAPEL: { label: string, value: Papel }[] = [
    { label: 'Fecha', value: 'fecha' },
    { label: 'Descripción', value: 'descripcion' },
    { label: 'Referencia', value: 'referencia' },
    { label: 'Sale (−)', value: 'debito' },
    { label: 'Entra (+)', value: 'credito' },
    { label: 'Monto (±)', value: 'monto' },
    { label: 'Saldo', value: 'saldo' },
    { label: 'No usar', value: 'ninguno' },
]
const ITEMS_FECHA = [
    { label: 'día/mes/año', value: 'dmy' },
    { label: 'mes/día/año', value: 'mdy' },
    { label: 'año-mes-día', value: 'ymd' },
]
const ITEMS_MONTOS = [
    { label: 'Cargos y abonos en columnas separadas', value: 'separadas' },
    { label: 'Una columna con signo (+ entra, − sale)', value: 'una' },
]

function papelDe(indice: number): Papel {
    const columnas = mapeo.value?.columnas
    if (!columnas) {
        return 'ninguno'
    }
    const encontrado = (Object.entries(columnas) as [Exclude<Papel, 'ninguno'>, number | null][]).find(([, valor]) => valor === indice)
    return encontrado?.[0] ?? 'ninguno'
}

function cambiarPapel(indice: number, papel: unknown) {
    if (!mapeo.value) {
        return
    }
    const columnas = { ...mapeo.value.columnas }
    for (const clavePapel of Object.keys(columnas) as (keyof typeof columnas)[]) {
        if (columnas[clavePapel] === indice) {
            if (clavePapel === 'fecha' || clavePapel === 'descripcion') {
                continue
            }
            columnas[clavePapel] = null
        }
    }
    if (typeof papel === 'string' && papel !== 'ninguno' && papel in columnas) {
        columnas[papel as keyof typeof columnas] = indice
        if (papel === 'monto') {
            columnas.debito = null
            columnas.credito = null
        }
        if (papel === 'debito' || papel === 'credito') {
            columnas.monto = null
        }
    }
    mapeo.value = { ...mapeo.value, columnas }
}

const modoMontos = computed({
    get: () => (mapeo.value?.columnas.monto !== null && mapeo.value?.columnas.monto !== undefined ? 'una' : 'separadas'),
    set: (valor: string) => {
        if (!mapeo.value) {
            return
        }
        const c = mapeo.value.columnas
        mapeo.value = valor === 'una'
            ? { ...mapeo.value, columnas: { ...c, monto: c.credito ?? c.debito, debito: null, credito: null } }
            : { ...mapeo.value, columnas: { ...c, credito: c.monto, monto: null } }
    },
})
const filaDatos = computed({
    get: () => String(mapeo.value?.fila_datos ?? ''),
    set: (valor: string) => {
        const numero = Number(valor)
        if (mapeo.value && Number.isInteger(numero) && numero > 0) {
            mapeo.value = { ...mapeo.value, fila_datos: numero, fila_encabezado: numero > 1 ? numero - 1 : null }
        }
    },
})
const formatoFecha = computed({
    get: () => mapeo.value?.formato_fecha ?? 'dmy',
    set: (valor: string) => {
        if (mapeo.value && (valor === 'dmy' || valor === 'mdy' || valor === 'ymd')) {
            mapeo.value = { ...mapeo.value, formato_fecha: valor }
        }
    },
})

let temporizador: ReturnType<typeof setTimeout> | undefined
watch(mapeo, () => {
    if (paso.value !== 'columnas') {
        return
    }
    clearTimeout(temporizador)
    temporizador = setTimeout(() => {
        void leer(true)
    }, 300)
}, { deep: true })

const mapeoCompleto = computed(() => {
    const c = mapeo.value?.columnas
    return Boolean(c && c.fecha !== null && c.descripcion !== null && (c.monto !== null || c.debito !== null || c.credito !== null))
})

// Navegación
const puedeSeguir = computed(() => {
    if (paso.value === 'subir') {
        return Boolean(vista.value && !leyendo.value && !problemaVista.value)
    }
    if (paso.value === 'columnas') {
        return Boolean(mapeoCompleto.value && vista.value?.lineas && !vista.value.errores.length && !leyendo.value)
    }
    return false
})
const textoPie = computed(() => {
    if (paso.value === 'subir') {
        return archivo.value ? (leyendo.value ? 'Leyendo el archivo…' : 'Listo para seguir') : 'Elige el archivo para seguir'
    }
    if (paso.value === 'columnas') {
        return 'Solo hace falta fecha, descripción y monto.'
    }
    return 'Solo se agregan movimientos; nada se borra.'
})

function siguiente() {
    if (!puedeSeguir.value) {
        return
    }
    paso.value = paso.value === 'subir' && desconocido.value ? 'columnas' : 'revisar'
}

function atras() {
    paso.value = paso.value === 'revisar' && desconocido.value ? 'columnas' : 'subir'
}

const nuevos = computed(() => (vista.value ? vista.value.lineas - vista.value.revisiones.repetidos.cantidad : 0))

async function importar() {
    if (!archivo.value || !cuentaBancariaId.value || importando.value) {
        return
    }
    importando.value = true
    problema.value = null
    const resultado = await useExtractos().importarArchivo({
        cuentaBancariaId: cuentaBancariaId.value,
        archivo: archivo.value,
        mapeo: desconocido.value ? mapeo.value : null,
        guardarMapeo: puede('bancos.guardar_mapeo_extracto') ? recordar.value : false,
        motivoNoEncadena: pideMotivo.value ? motivoNoEncadena.value.trim() : null,
    }, clave)
    if (!resultado.ok) {
        importando.value = false
        problema.value = resultado.problema
        if (codigoProblema(resultado.problema) === 'extracto_no_encadena') {
            pideMotivo.value = true
        }
        if (resultado.problema.status >= 400 && resultado.problema.status < 500) {
            clave = nuevaClaveIdempotencia()
        }
        return
    }
    importado.value = resultado.data
    if (puede('bancos.conciliar')) {
        const aplicado = await useExtractos().aplicarReglas(resultado.data.extracto.id, nuevaClaveIdempotencia())
        reglas.value = aplicado.ok ? aplicado.data : null
    }
    importando.value = false
    paso.value = 'listo'
    emit('hecho', resultado.data.extracto)
}

function irAConciliar() {
    const id = importado.value?.extracto.id
    abierto.value = false
    if (id) {
        void navigateTo(`/bancos/extractos/${id}`)
    }
}
</script>

<template>
    <UModal
        v-model:open="abierto"
        :dismissible="!importando"
        :ui="{ content: 'sm:max-w-[56.25rem] max-sm:h-dvh max-sm:max-h-dvh max-sm:rounded-none', header: 'gap-3', footer: 'bg-(--ax-cabecera-tabla)' }"
    >
        <template #title>
            <ModalTitulo
                texto="Importar estado de cuenta"
                icono="i-lucide-landmark"
            />
        </template>
        <template #description>
            <span class="ps-13">Movimientos del banco para conciliar</span>
        </template>
        <template #actions>
            <ol
                class="hidden flex-1 items-center gap-2 px-2 md:flex"
                aria-label="Pasos de la importación"
            >
                <template
                    v-for="(p, indice) in pasos"
                    :key="p.id"
                >
                    <li
                        class="flex items-center gap-2 text-sm font-semibold"
                        :class="indice < indicePaso || (p.id === 'listo' && paso === 'listo') ? 'text-success' : indice === indicePaso ? 'text-primary' : 'text-muted'"
                        :aria-current="indice === indicePaso ? 'step' : undefined"
                    >
                        <span
                            class="flex size-6 items-center justify-center rounded-full text-xs"
                            :class="indice < indicePaso || (p.id === 'listo' && paso === 'listo') ? 'bg-success/15 text-success' : indice === indicePaso ? 'bg-primary text-inverted ring-4 ring-primary/15' : 'bg-(--ax-panel) text-muted'"
                        >
                            <UIcon
                                v-if="indice < indicePaso || p.id === 'listo'"
                                name="i-lucide-check"
                                class="size-3.5"
                            />
                            <template v-else>{{ indice + 1 }}</template>
                        </span>
                        {{ p.titulo }}
                    </li>
                    <li
                        v-if="indice < pasos.length - 1"
                        class="h-px min-w-8 flex-1 bg-(--ax-borde)"
                        aria-hidden="true"
                    />
                </template>
            </ol>
            <span class="me-8 flex">
                <AyudaBoton solo-icono />
            </span>
        </template>

        <template #body>
            <!-- 1 · Subir -->
            <div
                v-if="paso === 'subir'"
                class="flex flex-col gap-4"
                data-prueba="importar-subir"
            >
                <UFormField
                    label="Cuenta bancaria"
                    required
                >
                    <USelect
                        v-model="cuentaBancariaId"
                        :items="itemsCuenta"
                        placeholder="Elige la cuenta del estado de cuenta"
                        icon="i-lucide-landmark"
                        class="w-full"
                        data-prueba="importar-cuenta"
                    />
                    <ProblemaAlerta
                        v-if="problemaCuentas"
                        :problema="problemaCuentas"
                        :reintentar="cargarCuentas"
                        class="mt-2"
                    />
                </UFormField>
                <UFileUpload
                    v-model="archivo"
                    accept=".xlsx,.xls,.csv,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                    :label="archivo ? `${archivo.name}${vista ? ` · ${vista.lineas} movimientos` : ''}` : 'Arrastra aquí el archivo del banco'"
                    :description="archivo ? 'Toca para cambiar de archivo' : 'o toca para elegirlo · Excel o CSV, tal como lo descargas'"
                    icon="i-lucide-file-text"
                    :disabled="!cuentaBancariaId"
                    :preview="false"
                    class="w-full"
                    :ui="{ base: ['min-h-40 rounded-2xl border-2 border-dashed', vista && !desconocido ? 'border-success bg-success/5' : vista ? 'border-warning bg-warning/5' : 'border-primary/40 bg-primary/5'].join(' '), avatar: 'size-14 rounded-2xl bg-(--ax-tarjeta) shadow-sm', label: 'text-base font-bold text-highlighted' }"
                    data-prueba="extracto-archivo"
                />
                <p
                    v-if="leyendo"
                    class="flex items-center gap-2 text-sm text-muted"
                >
                    <UIcon
                        name="i-lucide-loader-circle"
                        class="size-4 animate-spin"
                    />
                    Leyendo el archivo…
                </p>
                <ProblemaAlerta
                    v-else-if="problemaVista"
                    :problema="problemaVista"
                    :reintentar="() => leer()"
                />
                <UAlert
                    v-else-if="vista && !desconocido"
                    color="success"
                    variant="subtle"
                    icon="i-lucide-check"
                    :title="`Formato reconocido: ${vista.formato.banco ?? vista.cuenta.banco ?? 'del banco'}${vista.formato.origen === 'mapeo_guardado' ? ' · el que recordaste para esta cuenta' : ''}.`"
                    description="Argos lo convierte solo."
                    data-prueba="formato-reconocido"
                />
                <UAlert
                    v-else-if="vista"
                    color="warning"
                    variant="subtle"
                    icon="i-lucide-columns-3"
                    title="No reconocimos este formato."
                    description="En el siguiente paso confirmas qué es cada columna; Argos ya sugirió lo más probable."
                    data-prueba="formato-desconocido"
                />
                <p class="flex items-start gap-1.5 text-xs text-muted">
                    <UIcon
                        name="i-lucide-circle-help"
                        class="mt-0.5 size-3.5 shrink-0"
                    />
                    <span>Descárgalo de tu banca en línea: <strong>Estado de cuenta → Exportar a Excel</strong>, del mes completo. Se aceptan Excel (.xlsx, .xls) y CSV. No hace falta editarlo.</span>
                </p>
            </div>

            <!-- 2 · Columnas (solo si no se reconoció) -->
            <div
                v-else-if="paso === 'columnas' && vista && mapeo"
                class="flex flex-col gap-4"
                data-prueba="importar-columnas"
            >
                <div>
                    <h3 class="text-base font-bold text-highlighted">
                        ¿Qué es cada columna?
                    </h3>
                    <p class="text-sm text-muted">
                        Argos ya sugirió lo más probable. Revisa y corrige si hace falta.
                    </p>
                </div>
                <div class="flex gap-2 overflow-x-auto pb-1">
                    <div
                        v-for="columna in vista.columnas"
                        :key="columna.indice"
                        class="flex w-36 shrink-0 flex-col overflow-hidden rounded-2xl border border-(--ax-borde)"
                        :data-columna="columna.letra"
                    >
                        <p class="px-3 pt-2 text-[0.6875rem] font-semibold tracking-wide text-muted uppercase">
                            Columna {{ columna.letra }}<template v-if="columna.encabezado">
                                · «{{ columna.encabezado }}»
                            </template>
                        </p>
                        <div class="p-2">
                            <USelect
                                :model-value="papelDe(columna.indice)"
                                :items="ITEMS_PAPEL"
                                size="sm"
                                :color="papelDe(columna.indice) === 'ninguno' ? 'neutral' : 'primary'"
                                class="w-full"
                                :aria-label="`Qué es la columna ${columna.letra}`"
                                @update:model-value="cambiarPapel(columna.indice, $event)"
                            />
                        </div>
                        <ul class="divide-y divide-(--ax-borde) border-t border-(--ax-borde) text-xs">
                            <li
                                v-for="(muestra, i) in columna.muestra"
                                :key="i"
                                class="truncate px-3 py-1.5"
                            >
                                {{ muestra || '—' }}
                            </li>
                        </ul>
                    </div>
                </div>
                <div class="grid gap-3 sm:grid-cols-3">
                    <UFormField
                        label="Los datos empiezan en la fila"
                        help="Antes hay encabezados del banco"
                    >
                        <UInput
                            v-model="filaDatos"
                            inputmode="numeric"
                            class="w-full"
                        />
                    </UFormField>
                    <UFormField label="Formato de fecha">
                        <USelect
                            v-model="formatoFecha"
                            :items="ITEMS_FECHA"
                            class="w-full"
                        />
                    </UFormField>
                    <UFormField label="Montos">
                        <USelect
                            v-model="modoMontos"
                            :items="ITEMS_MONTOS"
                            class="w-full"
                        />
                    </UFormField>
                </div>
                <UAlert
                    v-if="!mapeoCompleto"
                    color="warning"
                    variant="subtle"
                    icon="i-lucide-triangle-alert"
                    title="Falta marcar la fecha, la descripción o el monto."
                />
                <UAlert
                    v-else-if="vista.errores.length"
                    color="warning"
                    variant="subtle"
                    icon="i-lucide-triangle-alert"
                    :title="`${vista.errores.length} ${vista.errores.length === 1 ? 'fila no se entiende' : 'filas no se entienden'} con estas columnas`"
                    :description="vista.errores.slice(0, 3).map(e => `Fila ${e.fila}: ${e.mensaje}`).join(' · ')"
                />
                <UAlert
                    v-else
                    color="success"
                    variant="subtle"
                    icon="i-lucide-check"
                    :title="`Con esto Argos entiende ${vista.lineas} movimientos: fecha, descripción y monto en todos.`"
                    data-prueba="columnas-ok"
                />
                <USwitch
                    v-if="puede('bancos.guardar_mapeo_extracto')"
                    v-model="recordar"
                    size="lg"
                    :label="`Recordar este formato para ${nombreCuenta}`"
                    description="La próxima vez se reconoce solo."
                    data-prueba="recordar-formato"
                />
            </div>

            <!-- 3 · Revisar -->
            <div
                v-else-if="paso === 'revisar' && vista"
                class="flex flex-col gap-3"
                data-prueba="importar-revisar"
            >
                <div class="grid grid-cols-2 gap-2 lg:grid-cols-4">
                    <div class="rounded-xl bg-(--ax-panel) p-3">
                        <p class="text-xs text-muted">
                            Periodo
                        </p>
                        <p class="font-bold text-highlighted">
                            {{ vista.periodo ? `${formatearFechaCorta(vista.periodo.desde)} al ${formatearFechaCorta(vista.periodo.hasta)}` : '—' }}
                        </p>
                    </div>
                    <div class="rounded-xl bg-(--ax-panel) p-3">
                        <p class="text-xs text-muted">
                            Movimientos
                        </p>
                        <p class="text-xl font-bold tabular-nums text-highlighted">
                            {{ vista.lineas }}
                        </p>
                    </div>
                    <div class="rounded-xl bg-(--ax-panel) p-3">
                        <p class="text-xs text-muted">
                            Entradas
                        </p>
                        <p class="text-xl font-bold tabular-nums text-success">
                            + {{ formatearQuetzales(vista.entradas) }}
                        </p>
                    </div>
                    <div class="rounded-xl bg-(--ax-panel) p-3">
                        <p class="text-xs text-muted">
                            Salidas
                        </p>
                        <p class="text-xl font-bold tabular-nums text-error">
                            − {{ formatearQuetzales(vista.salidas) }}
                        </p>
                    </div>
                </div>
                <div class="grid gap-2 sm:grid-cols-2">
                    <div class="flex items-center justify-between rounded-xl border border-(--ax-borde) px-3 py-2.5 text-sm">
                        <span class="text-muted">Saldo inicial</span>
                        <span class="font-bold tabular-nums text-highlighted">{{ formatearQuetzales(vista.saldo_inicial) }}</span>
                    </div>
                    <div class="flex items-center justify-between rounded-xl border border-(--ax-borde) px-3 py-2.5 text-sm">
                        <span class="text-muted">Saldo final</span>
                        <span class="font-bold tabular-nums text-highlighted">{{ formatearQuetzales(vista.saldo_final) }}</span>
                    </div>
                </div>
                <UAlert
                    :color="vista.revisiones.cuadra.ok ? 'success' : 'error'"
                    variant="subtle"
                    :icon="vista.revisiones.cuadra.ok ? 'i-lucide-check' : 'i-lucide-circle-x'"
                    :title="vista.revisiones.cuadra.ok ? 'Los movimientos cuadran con los saldos inicial y final.' : `Los movimientos no cuadran con los saldos${vista.revisiones.cuadra.diferencia ? ` (diferencia ${formatearQuetzales(vista.revisiones.cuadra.diferencia)})` : ''}.`"
                    data-prueba="revision-cuadra"
                />
                <UAlert
                    v-if="vista.revisiones.encadena.ok !== null"
                    :color="vista.revisiones.encadena.ok ? 'success' : 'warning'"
                    variant="subtle"
                    :icon="vista.revisiones.encadena.ok ? 'i-lucide-check' : 'i-lucide-triangle-alert'"
                    :title="vista.revisiones.encadena.ok ? `El saldo inicial sigue al estado de cuenta anterior (${formatearQuetzales(vista.revisiones.encadena.saldo_anterior)}).` : `El saldo inicial no sigue al anterior (${formatearQuetzales(vista.revisiones.encadena.saldo_anterior)}).`"
                />
                <UAlert
                    v-if="vista.revisiones.repetidos.cantidad"
                    color="warning"
                    variant="subtle"
                    icon="i-lucide-triangle-alert"
                    :title="`${vista.revisiones.repetidos.cantidad} ${vista.revisiones.repetidos.cantidad === 1 ? 'movimiento ya estaba importado y se omite' : 'movimientos ya estaban importados y se omiten'}.`"
                    data-prueba="revision-repetidos"
                />
                <div class="overflow-hidden rounded-2xl border border-(--ax-borde)">
                    <p class="flex items-center gap-2 px-3 py-2 text-sm">
                        <span class="font-bold text-highlighted">Así lo leyó Argos</span>
                        <span class="text-xs text-muted">primeros {{ vista.filas.length }} de {{ vista.lineas }}</span>
                    </p>
                    <ul
                        class="divide-y divide-(--ax-borde) border-t border-(--ax-borde) text-sm"
                        aria-label="Primeros movimientos leídos"
                    >
                        <li
                            v-for="fila in vista.filas"
                            :key="fila.fila"
                            class="flex items-center gap-3 px-3 py-2"
                        >
                            <span class="w-12 shrink-0 text-muted">{{ fila.fecha.slice(8, 10) }}/{{ fila.fecha.slice(5, 7) }}</span>
                            <span class="min-w-0 flex-1 truncate">{{ fila.descripcion }}</span>
                            <span class="hidden w-28 truncate font-mono text-xs text-muted sm:block">{{ fila.referencia ?? '—' }}</span>
                            <span
                                class="w-28 shrink-0 text-end font-semibold tabular-nums"
                                :class="fila.monto.startsWith('-') ? 'text-error' : 'text-success'"
                            >{{ fila.monto.startsWith('-') ? '−' : '+' }} {{ formatearQuetzales(new Decimal(fila.monto).abs()) }}</span>
                        </li>
                    </ul>
                </div>
                <UFormField
                    v-if="pideMotivo"
                    label="Motivo para importarlo aunque no siga al anterior"
                    required
                >
                    <UTextarea
                        v-model="motivoNoEncadena"
                        :rows="2"
                        placeholder="Ej.: el estado de cuenta anterior no se importó"
                        class="w-full"
                    />
                </UFormField>
                <ProblemaAlerta
                    v-if="problema"
                    :problema="problema"
                />
            </div>

            <!-- 4 · Listo -->
            <div
                v-else-if="paso === 'listo' && importado"
                class="flex flex-col items-center gap-4 py-10 text-center"
                data-prueba="importar-listo"
            >
                <span class="flex size-20 items-center justify-center rounded-full bg-success/15 text-success">
                    <UIcon
                        name="i-lucide-check"
                        class="size-10"
                    />
                </span>
                <h3 class="text-2xl font-bold text-highlighted">
                    Estado de cuenta importado
                </h3>
                <p class="text-sm text-muted">
                    {{ importado.extracto.lineas }} movimientos nuevos de {{ nombreCuenta || importado.extracto.cuenta_nombre }}<template v-if="vista?.periodo">
                        · {{ etiquetaPeriodo(`${vista.periodo.desde.slice(0, 7)}-01`) }}
                    </template>
                </p>
                <div
                    v-if="reglas"
                    class="grid w-full max-w-lg grid-cols-3 gap-2"
                >
                    <div class="rounded-xl bg-success/10 p-3 text-start">
                        <p class="text-xs text-muted">
                            Conciliados solos
                        </p>
                        <p class="text-2xl font-bold text-success">
                            {{ reglas.conciliadas.length }}
                        </p>
                    </div>
                    <div class="rounded-xl bg-warning/10 p-3 text-start">
                        <p class="text-xs text-muted">
                            Para confirmar
                        </p>
                        <p class="text-2xl font-bold text-warning">
                            {{ reglas.sin_pago.length }}
                        </p>
                    </div>
                    <div class="rounded-xl bg-(--ax-panel) p-3 text-start">
                        <p class="text-xs text-muted">
                            Sin pareja
                        </p>
                        <p class="text-2xl font-bold text-highlighted">
                            {{ reglas.sin_regla.length }}
                        </p>
                    </div>
                </div>
                <p
                    v-if="importado.mapeo_guardado"
                    class="text-xs text-muted"
                >
                    El formato quedó guardado para esta cuenta.
                </p>
                <UButton
                    label="Ir a conciliar"
                    trailing-icon="i-lucide-chevron-right"
                    size="lg"
                    class="glow-brand rounded-full px-6"
                    data-prueba="ir-a-conciliar"
                    @click="irAConciliar"
                />
            </div>
        </template>

        <template
            v-if="paso !== 'listo'"
            #footer
        >
            <div class="flex w-full flex-wrap items-center justify-between gap-3">
                <p class="text-sm text-muted">
                    {{ textoPie }}
                </p>
                <div class="flex gap-2">
                    <UButton
                        v-if="paso !== 'subir'"
                        :label="paso === 'revisar' && desconocido ? 'Columnas' : 'Otro archivo'"
                        :icon="ICONOS.volver"
                        color="neutral"
                        variant="outline"
                        class="rounded-full"
                        :disabled="importando"
                        @click="atras"
                    />
                    <UButton
                        v-if="paso !== 'revisar'"
                        :label="paso === 'subir' && desconocido ? 'Acomodar columnas' : 'Revisar'"
                        trailing-icon="i-lucide-chevron-right"
                        class="glow-brand rounded-full"
                        :disabled="!puedeSeguir"
                        data-prueba="importar-siguiente"
                        @click="siguiente"
                    />
                    <UButton
                        v-else
                        :label="`Importar ${nuevos} movimientos`"
                        icon="i-lucide-check"
                        color="success"
                        class="rounded-full"
                        :loading="importando"
                        :disabled="!vista?.revisiones.cuadra.ok || (pideMotivo && motivoNoEncadena.trim().length < 3)"
                        data-prueba="importar-confirmar"
                        @click="importar"
                    />
                </div>
            </div>
        </template>
    </UModal>
</template>
