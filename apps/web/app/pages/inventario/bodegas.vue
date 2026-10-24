<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'

/**
 * Bodegas del inventario (A3): lugares y bodegas de técnico. La de un técnico solo la mueve su
 * usuario o quien tenga el permiso con alcance global (tope por técnico, `contratos/inventario.md`
 * §5). «Nueva bodega» (`bodegas.crear`), «Editar» (`bodegas.editar`) y «Desactivar»
 * (`bodegas.desactivar`, sin existencias). Cada fila lleva a sus existencias.
 */
definePageMeta({ permiso: 'inventario.ver' })

useHead({ title: 'Bodegas · ArgosIsp' })

const toast = useToast()
const { puede } = usePermisos()

const lista = usePaginacionCursor(cursor => useBodegas().listar({}, cursor))
onMounted(() => void lista.recargar())

const columnas: TableColumn<Bodega>[] = [
    { accessorKey: 'nombre', header: 'Bodega', meta: { class: { td: 'whitespace-normal' } } },
    { accessorKey: 'tipo', header: 'Tipo', meta: SOLO_ANCHO },
    { accessorKey: 'activo', header: 'Estado' },
    { id: 'acciones', header: '', meta: { class: { td: 'text-right w-0' } } },
]

const formularioAbierto = ref(false)
const editando = shallowRef<Bodega | null>(null)

function abrir(bodega: Bodega | null) {
    editando.value = bodega
    formularioAbierto.value = true
}

function alGuardar(bodega: Bodega) {
    const existia = lista.filas.value.some(b => b.id === bodega.id)
    lista.filas.value = existia ? lista.filas.value.map(b => (b.id === bodega.id ? bodega : b)) : [...lista.filas.value, bodega]
    toast.add({ title: existia ? `${bodega.nombre} guardada` : `${bodega.nombre} creada`, icon: 'i-lucide-circle-check', color: 'success' })
}

const aDesactivar = shallowRef<Bodega | null>(null)
const desactivarAbierto = ref(false)

function desactivar(motivo: string): Promise<Resultado<Bodega>> {
    const bodega = aDesactivar.value
    return bodega ? useBodegas().desactivar(bodega, motivo) : Promise.resolve({ ok: false, problema: { type: 'about:blank', title: 'Elige una bodega', status: 400 } })
}

function alDesactivar(bodega: Bodega) {
    lista.filas.value = lista.filas.value.map(b => (b.id === bodega.id ? bodega : b))
    toast.add({ title: `${bodega.nombre} desactivada`, icon: 'i-lucide-circle-check', color: 'success' })
}
</script>

<template>
    <PanelPagina
        id="inventario-bodegas"
        titulo="Bodegas"
        icono="i-lucide-warehouse"
    >
        <template #acciones>
            <UButton
                v-if="puede('bodegas.crear')"
                label="Nueva bodega"
                icon="i-lucide-plus"
                data-prueba="nueva-bodega"
                @click="abrir(null)"
            />
        </template>

        <div class="flex flex-col gap-4">
            <p class="text-sm text-muted">
                La bodega de un técnico es su vehículo: solo él la mueve, o quien tenga el permiso con alcance global. Para que el técnico opere solo su bodega, asígnale el rol con alcance de zona o router.
            </p>
            <ProblemaAlerta
                v-if="lista.problema.value"
                :problema="lista.problema.value"
                :reintentar="lista.recargar"
                :reintentando="lista.cargando.value"
            />
            <template v-else>
                <UTable
                    :data="lista.filas.value"
                    :columns="columnas"
                    :loading="lista.cargando.value"
                    :ui="{ td: 'py-3' }"
                    data-prueba="tabla-bodegas"
                >
                    <template #nombre-cell="{ row }">
                        <div
                            class="flex min-w-0 flex-col gap-0.5"
                            :data-bodega="row.original.nombre"
                        >
                            <ULink
                                :to="`/inventario?bodega=${row.original.id}`"
                                class="text-sm font-medium text-highlighted hover:text-primary"
                            >{{ row.original.nombre }}</ULink>
                            <span
                                v-if="row.original.tipo === 'tecnico'"
                                class="flex items-center gap-1 text-xs text-muted"
                                data-prueba="bodega-tope"
                            >
                                <UIcon
                                    name="i-lucide-lock"
                                    class="size-3.5"
                                />
                                Solo la mueve {{ row.original.usuario_nombre ?? `el usuario #${row.original.usuario_id}` }}
                            </span>
                            <span class="text-xs text-muted sm:hidden">{{ TIPOS_BODEGA[row.original.tipo].etiqueta }}</span>
                        </div>
                    </template>
                    <template #tipo-cell="{ row }">
                        <UBadge
                            :label="TIPOS_BODEGA[row.original.tipo].etiqueta"
                            :icon="TIPOS_BODEGA[row.original.tipo].icono"
                            color="neutral"
                            variant="subtle"
                            size="sm"
                        />
                    </template>
                    <template #activo-cell="{ row }">
                        <UBadge
                            :label="row.original.activo ? 'Activa' : 'Desactivada'"
                            :color="row.original.activo ? 'success' : 'neutral'"
                            variant="subtle"
                            size="sm"
                        />
                    </template>
                    <template #acciones-cell="{ row }">
                        <div class="flex justify-end gap-1">
                            <UButton
                                v-if="puede('bodegas.editar')"
                                icon="i-lucide-pencil"
                                color="neutral"
                                variant="ghost"
                                size="sm"
                                :aria-label="`Editar ${row.original.nombre}`"
                                @click="abrir(row.original)"
                            />
                            <UButton
                                v-if="row.original.activo && puede('bodegas.desactivar')"
                                icon="i-lucide-circle-pause"
                                color="error"
                                variant="ghost"
                                size="sm"
                                :aria-label="`Desactivar ${row.original.nombre}`"
                                @click="aDesactivar = row.original; desactivarAbierto = true"
                            />
                        </div>
                    </template>
                    <template #empty>
                        <UEmpty
                            icon="i-lucide-warehouse"
                            title="Sin bodegas"
                            description="Crea la bodega central y la de cada técnico."
                            variant="naked"
                        />
                    </template>
                </UTable>
                <PaginacionCursor
                    :pagina="lista.pagina.value"
                    :hay-anterior="lista.hayAnterior.value"
                    :hay-siguiente="lista.haySiguiente.value"
                    :cargando="lista.cargando.value"
                    :filas="lista.filas.value.length"
                    @anterior="lista.anterior"
                    @siguiente="lista.siguiente"
                />
            </template>
        </div>

        <BodegaFormulario
            v-model:open="formularioAbierto"
            :bodega="editando"
            @guardado="alGuardar"
        />
        <AccionMotivoModal
            v-model:open="desactivarAbierto"
            titulo="Desactivar bodega"
            :efecto="`«${aDesactivar?.nombre ?? ''}» deja de recibir movimientos. Solo se puede sin existencias.`"
            confirmar="Desactivar"
            icono="i-lucide-circle-pause"
            :ejecutar="motivo => desactivar(motivo)"
            @hecho="alDesactivar"
        />
    </PanelPagina>
</template>
