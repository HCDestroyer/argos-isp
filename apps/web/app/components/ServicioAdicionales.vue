<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { TableColumn } from '@nuxt/ui'

/**
 * Adicionales del servicio (A1, `contratos/adicionales.md`): incluido, cortesía o cobrado, con su
 * identificador. Agregar, editar y quitar con su permiso; la cortesía pide además
 * `servicios.adicional_cortesia`, y la credencial solo se ve con `servicios.ver_credencial_adicional`
 * (cada consulta queda en la bitácora). Un servicio retirado ya no admite cambios.
 */
const props = defineProps<{
    servicio: Servicio
}>()

const emit = defineEmits<{
    /** Algo cambió (alta, edición, baja o consulta de credencial): la bitácora del servicio se relee. */
    cambiado: []
}>()

const { puede } = usePermisos()
const toast = useToast()

const filas = shallowRef<AdicionalServicio[]>([])
const cargando = ref(false)
const problema = ref<Problem | null>(null)
const conBajas = ref(false)

const editable = computed(() => props.servicio.estado !== 'retirado')
const puedeAgregar = computed(() => editable.value && puede('servicios.agregar_adicional') && puede('adicionales.ver'))
const puedeEditar = computed(() => editable.value && puede('servicios.editar_adicional'))
const puedeQuitar = computed(() => editable.value && puede('servicios.quitar_adicional'))
const puedeVerCredencial = computed(() => puede('servicios.ver_credencial_adicional'))

const columnas: TableColumn<AdicionalServicio>[] = [
    { accessorKey: 'adicional_nombre', header: 'Adicional', meta: { class: { td: 'whitespace-normal' } } },
    { accessorKey: 'modalidad', header: 'Modalidad' },
    { accessorKey: 'identificador', header: 'Identificador', meta: SOLO_ANCHO },
    { id: 'acciones', header: '', meta: { class: { td: 'text-right w-0' } } },
]

const modalAbierto = ref(false)
const editando = shallowRef<AdicionalServicio | null>(null)
const quitarAbierto = ref(false)
const quitando = shallowRef<AdicionalServicio | null>(null)
const credencialAbierta = ref(false)
const consultando = shallowRef<AdicionalServicio | null>(null)

async function cargar() {
    cargando.value = true
    problema.value = null
    const leidas: AdicionalServicio[] = []
    let cursor: string | undefined
    let fallo: Problem | null = null
    for (let pagina = 0; pagina < 5; pagina++) {
        const resultado = await useAdicionalesServicio().listar(props.servicio.id, conBajas.value ? undefined : 'activo', cursor)
        if (!resultado.ok) {
            fallo = resultado.problema
            break
        }
        leidas.push(...resultado.data.data)
        if (!resultado.data.nextCursor) {
            break
        }
        cursor = resultado.data.nextCursor
    }
    cargando.value = false
    filas.value = fallo ? [] : leidas
    problema.value = fallo
}

function abrirAlta() {
    editando.value = null
    modalAbierto.value = true
}

function abrirEdicion(asignacion: AdicionalServicio) {
    editando.value = asignacion
    modalAbierto.value = true
}

function abrirQuitar(asignacion: AdicionalServicio) {
    quitando.value = asignacion
    quitarAbierto.value = true
}

function abrirCredencial(asignacion: AdicionalServicio) {
    consultando.value = asignacion
    credencialAbierta.value = true
}

function alGuardar(asignacion: AdicionalServicio, nuevo: boolean) {
    toast.add({
        title: nuevo ? `${asignacion.adicional_nombre} agregado` : `${asignacion.adicional_nombre} actualizado`,
        description: `${MODALIDADES_ADICIONAL[asignacion.modalidad].etiqueta}${asignacion.precio ? ` · ${formatearQuetzales(asignacion.precio)} al mes` : ''}${asignacion.identificador ? ` · ${asignacion.identificador}` : ''}`,
        icon: 'i-lucide-circle-check',
        color: 'success',
    })
    void cargar()
    emit('cambiado')
}

function alQuitar(asignacion: AdicionalServicio) {
    toast.add({ title: `${asignacion.adicional_nombre} dado de baja`, description: asignacion.motivo_baja ?? undefined, icon: 'i-lucide-circle-check', color: 'success' })
    void cargar()
    emit('cambiado')
}

watch(conBajas, () => void cargar())
watch(() => props.servicio.id, () => void cargar())
onMounted(cargar)
</script>

<template>
    <section
        class="flex flex-col gap-3"
        aria-label="Adicionales del servicio"
        data-prueba="servicio-adicionales"
    >
        <div class="flex flex-wrap items-center justify-between gap-2">
            <h3 class="text-sm font-semibold text-highlighted">
                Adicionales
            </h3>
            <div class="flex flex-wrap items-center gap-3">
                <USwitch
                    v-model="conBajas"
                    label="Mostrar bajas"
                    size="sm"
                />
                <UButton
                    v-if="puedeAgregar"
                    label="Agregar"
                    icon="i-lucide-plus"
                    color="neutral"
                    variant="outline"
                    size="sm"
                    data-prueba="agregar-adicional"
                    @click="abrirAlta"
                />
            </div>
        </div>

        <ProblemaAlerta
            v-if="problema"
            :problema="problema"
            :reintentar="cargar"
            :reintentando="cargando"
        />
        <UTable
            v-else
            :data="filas"
            :columns="columnas"
            :loading="cargando"
            :ui="{ td: 'py-2.5' }"
        >
            <template #adicional_nombre-cell="{ row }">
                <div
                    class="flex min-w-32 flex-col"
                    :data-asignacion="row.original.id"
                >
                    <span class="flex flex-wrap items-center gap-1.5 text-sm font-medium text-highlighted">
                        {{ row.original.adicional_nombre }}
                        <UBadge
                            v-if="row.original.estado === 'baja'"
                            label="Baja"
                            color="neutral"
                            variant="subtle"
                            size="sm"
                        />
                    </span>
                    <span class="font-mono text-xs text-muted">{{ row.original.adicional_codigo }}</span>
                    <span
                        v-if="row.original.identificador"
                        class="break-all font-mono text-xs text-muted sm:hidden"
                    >{{ row.original.identificador }}</span>
                    <span
                        v-if="row.original.estado === 'baja'"
                        class="text-xs text-muted"
                    >Baja {{ formatearFecha(row.original.baja_en) }}<template v-if="motivoBajaLegible(row.original.motivo_baja)"> · {{ motivoBajaLegible(row.original.motivo_baja) }}</template></span>
                </div>
            </template>
            <template #modalidad-cell="{ row }">
                <div class="flex flex-col items-start gap-0.5">
                    <UBadge
                        :label="MODALIDADES_ADICIONAL[row.original.modalidad].etiqueta"
                        :icon="MODALIDADES_ADICIONAL[row.original.modalidad].icono"
                        :color="MODALIDADES_ADICIONAL[row.original.modalidad].color"
                        variant="subtle"
                        size="sm"
                        :data-modalidad="row.original.modalidad"
                    />
                    <span
                        v-if="row.original.modalidad === 'cobrado' && row.original.precio"
                        class="text-xs tabular-nums text-muted"
                    >{{ formatearQuetzales(row.original.precio) }} al mes</span>
                    <span
                        v-if="row.original.modalidad === 'cortesia' && row.original.motivo_nombre"
                        class="text-xs text-muted"
                    >{{ row.original.motivo_nombre }}<template v-if="row.original.motivo_detalle"> · {{ row.original.motivo_detalle }}</template></span>
                </div>
            </template>
            <template #identificador-cell="{ row }">
                <span class="break-all font-mono text-sm">{{ row.original.identificador ?? '—' }}</span>
            </template>
            <template #acciones-cell="{ row }">
                <div class="flex justify-end gap-1">
                    <UButton
                        v-if="row.original.tiene_credencial && puedeVerCredencial"
                        label="Ver credencial"
                        icon="i-lucide-key-round"
                        color="neutral"
                        variant="ghost"
                        size="sm"
                        :ui="{ label: 'hidden lg:inline' }"
                        :aria-label="`Ver credencial de ${row.original.adicional_nombre}`"
                        :data-prueba="`ver-credencial-${row.original.id}`"
                        @click="abrirCredencial(row.original)"
                    />
                    <UButton
                        v-if="puedeEditar && row.original.estado === 'activo'"
                        icon="i-lucide-pencil"
                        color="neutral"
                        variant="ghost"
                        size="sm"
                        :aria-label="`Editar ${row.original.adicional_nombre}`"
                        :data-prueba="`editar-adicional-${row.original.id}`"
                        @click="abrirEdicion(row.original)"
                    />
                    <UButton
                        v-if="puedeQuitar && row.original.estado === 'activo'"
                        icon="i-lucide-trash-2"
                        color="error"
                        variant="ghost"
                        size="sm"
                        :aria-label="`Quitar ${row.original.adicional_nombre}`"
                        :data-prueba="`quitar-adicional-${row.original.id}`"
                        @click="abrirQuitar(row.original)"
                    />
                </div>
            </template>
            <template #empty>
                <UEmpty
                    icon="i-lucide-package"
                    :title="conBajas ? 'Sin adicionales' : 'Sin adicionales activos'"
                    description="Streaming, IPTV y otros servicios que acompañan al internet."
                    variant="naked"
                />
            </template>
        </UTable>

        <AdicionalServicioModal
            v-if="puedeAgregar || puedeEditar"
            v-model:open="modalAbierto"
            :servicio="servicio"
            :asignacion="editando"
            @guardado="alGuardar"
        />
        <AdicionalQuitarModal
            v-if="puedeQuitar && quitando"
            v-model:open="quitarAbierto"
            :servicio-id="servicio.id"
            :asignacion="quitando"
            @hecho="alQuitar"
        />
        <AdicionalCredencialModal
            v-if="puedeVerCredencial && consultando"
            v-model:open="credencialAbierta"
            :servicio-id="servicio.id"
            :asignacion="consultando"
            @consultado="emit('cambiado')"
        />
    </section>
</template>
