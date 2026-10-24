<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { FormSubmitEvent, SelectItem, TableColumn } from '@nuxt/ui'
import * as z from 'zod'

/**
 * Equipos en comodato del servicio (A3, fase B): router, ONU o antena prestados al cliente, con
 * su valor en libros. «Asignar» busca un equipo disponible por serie o MAC
 * (`inventario.asignar_comodato`; da de alta su activo fijo); «Devolver» lo recibe en una bodega,
 * nuevo o usado o a reparación (`inventario.devolver_comodato`); «Declarar pérdida» lo da de baja
 * a pérdida (`inventario.declarar_perdida_comodato`). Se monta con `inventario.ver`.
 */
const props = defineProps<{
    servicio: Pick<Servicio, 'id' | 'estado' | 'empresa_id'>
}>()

const emit = defineEmits<{ cambiado: [] }>()

const { puede } = usePermisos()
const toast = useToast()

const equipos = shallowRef<EquipoServicio[]>([])
const cargando = ref(false)
const problema = ref<Problem | null>(null)

async function cargar() {
    cargando.value = true
    problema.value = null
    const resultado = await useEquiposServicio().listar(props.servicio.id)
    cargando.value = false
    equipos.value = resultado.ok ? resultado.data : []
    problema.value = resultado.ok ? null : resultado.problema
}

watch(() => props.servicio.id, () => void cargar(), { immediate: true })

const columnas: TableColumn<EquipoServicio>[] = [
    { id: 'equipo', header: 'Equipo', meta: { class: { td: 'whitespace-normal' } } },
    { accessorKey: 'estado', header: 'Estado', meta: SOLO_ANCHO },
    { accessorKey: 'valor_libros', header: 'En libros', meta: { class: { th: 'text-right hidden sm:table-cell', td: 'text-right hidden sm:table-cell' } } },
    { id: 'acciones', header: '', meta: { class: { td: 'text-right w-0' } } },
]

function terminar(titulo: string) {
    toast.add({ title: titulo, icon: 'i-lucide-circle-check', color: 'success' })
    void cargar()
    emit('cambiado')
}

/* Asignar */
const asignarAbierto = ref(false)
const busqueda = ref('')
const disponibles = shallowRef<UnidadInventario[]>([])
const buscando = ref(false)
const esquemaAsignar = z.object({
    unidad_id: z.number({ message: 'Elige el equipo' }).int().positive('Elige el equipo'),
    fecha: z.string().trim(),
})
const asignacion = reactive<{ unidad_id: number | undefined, fecha: string }>({ unidad_id: undefined, fecha: '' })
const asignando = ref(false)
const problemaAsignar = ref<Problem | null>(null)
let claveAsignar = nuevaClaveIdempotencia()

async function buscarDisponibles() {
    buscando.value = true
    const resultado = await useUnidadesInventario().listar({ estado: 'disponible', ...(busqueda.value.trim() ? { q: busqueda.value.trim() } : {}), limit: 50 })
    buscando.value = false
    disponibles.value = resultado.ok ? resultado.data.data.filter(u => u.empresa_id === props.servicio.empresa_id) : []
    problemaAsignar.value = resultado.ok ? null : resultado.problema
}

let espera: ReturnType<typeof setTimeout> | undefined
watch(busqueda, () => {
    clearTimeout(espera)
    espera = setTimeout(() => void buscarDisponibles(), 300)
})

function abrirAsignar() {
    Object.assign(asignacion, { unidad_id: undefined, fecha: '' })
    busqueda.value = ''
    problemaAsignar.value = null
    claveAsignar = nuevaClaveIdempotencia()
    asignarAbierto.value = true
    void buscarDisponibles()
}

const itemsDisponibles = computed<SelectItem[]>(() => disponibles.value.map(u => ({
    label: `${identificacionUnidad(u)} · ${u.producto_nombre}`,
    value: u.id,
    description: `${u.bodega_nombre ?? ''} · ${CONDICIONES_UNIDAD[u.condicion]} · ${formatearQuetzales(u.costo)}`,
})))

async function asignar(evento: FormSubmitEvent<z.output<typeof esquemaAsignar>>) {
    asignando.value = true
    problemaAsignar.value = null
    const resultado = await useEquiposServicio().asignar(props.servicio.id, evento.data.unidad_id, evento.data.fecha || null, claveAsignar)
    asignando.value = false
    if (!resultado.ok) {
        problemaAsignar.value = resultado.problema
        return
    }
    asignarAbierto.value = false
    terminar(`${identificacionUnidad(resultado.data)} en comodato`)
}

/* Devolver */
const devolverAbierto = ref(false)
const aDevolver = shallowRef<EquipoServicio | null>(null)
const bodegas = shallowRef<SelectItem[]>([])
const esquemaDevolver = z.object({
    bodega_id: z.number({ message: 'Elige la bodega' }).int().positive('Elige la bodega'),
    condicion: z.enum(['nuevo', 'usado']),
    en_reparacion: z.boolean(),
    fecha: z.string().trim(),
    motivo: z.string().trim().max(500, 'Máximo 500 caracteres'),
})
const devolucion = reactive<{ bodega_id: number | undefined, condicion: 'nuevo' | 'usado', en_reparacion: boolean, fecha: string, motivo: string }>({ bodega_id: undefined, condicion: 'usado', en_reparacion: false, fecha: '', motivo: '' })
const devolviendo = ref(false)
const problemaDevolver = ref<Problem | null>(null)
let claveDevolver = nuevaClaveIdempotencia()
const itemsCondicion: SelectItem[] = Object.entries(CONDICIONES_UNIDAD).map(([value, label]) => ({ label, value }))

async function abrirDevolver(equipo: EquipoServicio) {
    aDevolver.value = equipo
    Object.assign(devolucion, { bodega_id: undefined, condicion: 'usado', en_reparacion: false, fecha: '', motivo: '' })
    problemaDevolver.value = null
    claveDevolver = nuevaClaveIdempotencia()
    devolverAbierto.value = true
    const resultado = await useBodegas().activas()
    bodegas.value = resultado.ok ? resultado.data.filter(b => b.empresa_id === props.servicio.empresa_id).map(b => ({ label: b.nombre, value: b.id, icon: TIPOS_BODEGA[b.tipo].icono })) : []
    if (!resultado.ok) {
        problemaDevolver.value = resultado.problema
    }
}

async function devolver(evento: FormSubmitEvent<z.output<typeof esquemaDevolver>>) {
    const equipo = aDevolver.value
    if (!equipo) {
        return
    }
    devolviendo.value = true
    problemaDevolver.value = null
    const resultado = await useEquiposServicio().devolver(props.servicio.id, equipo.id, {
        bodega_id: evento.data.bodega_id,
        condicion: evento.data.condicion,
        en_reparacion: evento.data.en_reparacion,
        fecha: evento.data.fecha || null,
        motivo: evento.data.motivo || null,
    }, claveDevolver)
    devolviendo.value = false
    if (!resultado.ok) {
        problemaDevolver.value = resultado.problema
        return
    }
    devolverAbierto.value = false
    terminar(`${identificacionUnidad(resultado.data)} devuelto a ${resultado.data.bodega_nombre ?? 'la bodega'}`)
}

/* Pérdida */
const perdidaAbierto = ref(false)
const aPerder = shallowRef<EquipoServicio | null>(null)

function pedirPerdida(equipo: EquipoServicio) {
    aPerder.value = equipo
    perdidaAbierto.value = true
}

function declararPerdida(motivo: string, clave: string): Promise<Resultado<UnidadInventario>> {
    return useEquiposServicio().declararPerdida(props.servicio.id, aPerder.value?.id ?? 0, motivo, clave)
}
</script>

<template>
    <section
        id="equipos"
        class="flex scroll-mt-20 flex-col gap-3"
        aria-label="Equipos en comodato"
        data-prueba="servicio-equipos"
    >
        <div class="flex items-center justify-between gap-2">
            <h3 class="text-sm font-semibold text-highlighted">
                Equipos en comodato
            </h3>
            <UButton
                v-if="puede('inventario.asignar_comodato') && servicio.estado !== 'retirado'"
                label="Asignar equipo"
                icon="i-lucide-plus"
                size="sm"
                variant="outline"
                data-prueba="asignar-equipo"
                @click="abrirAsignar"
            />
        </div>
        <ProblemaAlerta
            v-if="problema"
            :problema="problema"
            :reintentar="cargar"
            :reintentando="cargando"
        />
        <UTable
            v-else
            :data="equipos"
            :columns="columnas"
            :loading="cargando"
            :ui="{ td: 'py-2.5' }"
            data-prueba="tabla-equipos-servicio"
        >
            <template #equipo-cell="{ row }">
                <div
                    class="flex min-w-0 flex-col gap-0.5"
                    :data-equipo="row.original.serie ?? row.original.mac"
                >
                    <span class="font-mono text-sm font-medium text-highlighted">{{ identificacionUnidad(row.original) }}</span>
                    <span class="text-xs text-muted">{{ row.original.producto_nombre }}<template v-if="row.original.fecha_asignacion">
                        · desde {{ formatearFecha(row.original.fecha_asignacion) }}
                    </template></span>
                    <UBadge
                        v-if="row.original.estado === 'por_recuperar'"
                        label="Por recuperar"
                        color="warning"
                        variant="subtle"
                        size="sm"
                        class="self-start sm:hidden"
                    />
                </div>
            </template>
            <template #estado-cell="{ row }">
                <UBadge
                    :label="ESTADOS_UNIDAD[row.original.estado].etiqueta"
                    :icon="ESTADOS_UNIDAD[row.original.estado].icono"
                    :color="ESTADOS_UNIDAD[row.original.estado].color"
                    variant="subtle"
                    size="sm"
                />
            </template>
            <template #valor_libros-cell="{ row }">
                <span class="text-sm tabular-nums">{{ row.original.valor_libros ? formatearQuetzales(row.original.valor_libros) : '—' }}</span>
            </template>
            <template #acciones-cell="{ row }">
                <div class="flex justify-end gap-1">
                    <UButton
                        v-if="puede('inventario.devolver_comodato')"
                        label="Devolver"
                        icon="i-lucide-undo-2"
                        color="neutral"
                        variant="ghost"
                        size="sm"
                        :aria-label="`Devolver ${identificacionUnidad(row.original)}`"
                        @click="abrirDevolver(row.original)"
                    />
                    <UButton
                        v-if="puede('inventario.declarar_perdida_comodato')"
                        icon="i-lucide-circle-x"
                        color="error"
                        variant="ghost"
                        size="sm"
                        :aria-label="`Declarar pérdida de ${identificacionUnidad(row.original)}`"
                        @click="pedirPerdida(row.original)"
                    />
                </div>
            </template>
            <template #empty>
                <UEmpty
                    icon="i-lucide-router"
                    title="Sin equipos prestados"
                    description="Asigna el router u ONU que se instaló en casa del cliente."
                    variant="naked"
                />
            </template>
        </UTable>

        <UModal
            v-model:open="asignarAbierto"
            title="Asignar equipo en comodato"
            description="Sale de su bodega y pasa a activo fijo; se deprecia desde el mes siguiente."
            :dismissible="!asignando"
        >
            <template #body>
                <UForm
                    id="form-asignar-equipo"
                    :schema="esquemaAsignar"
                    :state="asignacion"
                    class="flex flex-col gap-4"
                    @submit="asignar"
                >
                    <UInput
                        v-model="busqueda"
                        icon="i-lucide-search"
                        placeholder="Busca por serie o MAC"
                        class="w-full"
                        aria-label="Buscar equipo disponible"
                        data-prueba="asignar-buscar"
                    />
                    <UFormField
                        label="Equipo disponible"
                        name="unidad_id"
                        :help="buscando ? 'Buscando…' : (itemsDisponibles.length ? undefined : 'No hay equipos disponibles con esa búsqueda.')"
                        required
                    >
                        <USelect
                            :model-value="asignacion.unidad_id"
                            :items="itemsDisponibles"
                            placeholder="Elige el equipo"
                            class="w-full"
                            data-prueba="asignar-unidad"
                            @update:model-value="v => asignacion.unidad_id = typeof v === 'number' ? v : undefined"
                        />
                    </UFormField>
                    <UFormField
                        label="Fecha"
                        name="fecha"
                        help="Vacío = hoy."
                    >
                        <UInput
                            v-model="asignacion.fecha"
                            type="date"
                            class="w-full"
                        />
                    </UFormField>
                    <ProblemaAlerta
                        v-if="problemaAsignar"
                        :problema="problemaAsignar"
                    />
                </UForm>
            </template>
            <template #footer>
                <div class="flex w-full justify-end gap-2">
                    <UButton
                        label="Cancelar"
                        color="neutral"
                        variant="ghost"
                        :disabled="asignando"
                        @click="asignarAbierto = false"
                    />
                    <UButton
                        type="submit"
                        form="form-asignar-equipo"
                        label="Asignar"
                        icon="i-lucide-check"
                        :loading="asignando"
                        data-prueba="asignar-confirmar"
                    />
                </div>
            </template>
        </UModal>

        <UModal
            v-model:open="devolverAbierto"
            :title="aDevolver ? `Devolver ${identificacionUnidad(aDevolver)}` : 'Devolver equipo'"
            description="Vuelve a la bodega a su valor en libros; el activo se da de baja sin resultado."
            :dismissible="!devolviendo"
        >
            <template #body>
                <UForm
                    id="form-devolver-equipo"
                    :schema="esquemaDevolver"
                    :state="devolucion"
                    class="flex flex-col gap-4"
                    @submit="devolver"
                >
                    <UFormField
                        label="Bodega que lo recibe"
                        name="bodega_id"
                        required
                    >
                        <USelect
                            :model-value="devolucion.bodega_id"
                            :items="bodegas"
                            placeholder="Elige la bodega"
                            class="w-full"
                            data-prueba="devolver-bodega"
                            @update:model-value="v => devolucion.bodega_id = typeof v === 'number' ? v : undefined"
                        />
                    </UFormField>
                    <div class="grid gap-4 sm:grid-cols-2">
                        <UFormField
                            label="Condición"
                            name="condicion"
                        >
                            <USelect
                                v-model="devolucion.condicion"
                                :items="itemsCondicion"
                                class="w-full"
                            />
                        </UFormField>
                        <UFormField
                            label="Fecha"
                            name="fecha"
                            help="Vacío = hoy."
                        >
                            <UInput
                                v-model="devolucion.fecha"
                                type="date"
                                class="w-full"
                            />
                        </UFormField>
                    </div>
                    <USwitch
                        v-model="devolucion.en_reparacion"
                        label="Entra a reparación"
                        description="Cuenta en la bodega pero no se presta hasta marcarla reparada."
                        data-prueba="devolver-reparacion"
                    />
                    <UFormField
                        label="Nota"
                        name="motivo"
                    >
                        <UInput
                            v-model="devolucion.motivo"
                            class="w-full"
                        />
                    </UFormField>
                    <ProblemaAlerta
                        v-if="problemaDevolver"
                        :problema="problemaDevolver"
                    />
                </UForm>
            </template>
            <template #footer>
                <div class="flex w-full justify-end gap-2">
                    <UButton
                        label="Cancelar"
                        color="neutral"
                        variant="ghost"
                        :disabled="devolviendo"
                        @click="devolverAbierto = false"
                    />
                    <UButton
                        type="submit"
                        form="form-devolver-equipo"
                        label="Devolver"
                        icon="i-lucide-undo-2"
                        :loading="devolviendo"
                        data-prueba="devolver-confirmar"
                    />
                </div>
            </template>
        </UModal>

        <AccionMotivoModal
            v-model:open="perdidaAbierto"
            titulo="Declarar pérdida"
            :efecto="`${aPerder ? identificacionUnidad(aPerder) : 'El equipo'} se da de baja a pérdida (5.3.06). Cobrarlo al cliente va aparte, con un cargo único.`"
            confirmar="Declarar pérdida"
            placeholder="Ej.: el cliente no lo devolvió al retirar el servicio"
            :ejecutar="declararPerdida"
            @hecho="terminar('Pérdida declarada')"
        />
    </section>
</template>
