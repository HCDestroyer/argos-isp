<script setup lang="ts">
import type { SelectItem, TableColumn } from '@nuxt/ui'

/**
 * Referidos (A3, `contratos/lealtad.md` §4): quién refirió a quién, su estado y "Rechazar" con
 * motivo (`lealtad.ajustar`), que revierte lo otorgado.
 */
definePageMeta({ permiso: 'lealtad.ver' })

useHead({ title: 'Referidos · ArgosIsp' })

const route = useRoute()
const router = useRouter()
const toast = useToast()
const { puede, enlace } = usePermisos()

const TODOS = 'todos'
const estado = ref<EstadoReferido | typeof TODOS>(typeof route.query.estado === 'string' && Object.hasOwn(ESTADOS_REFERIDO, route.query.estado) ? route.query.estado as EstadoReferido : TODOS)
const itemsEstado: SelectItem[] = [{ label: 'Todos los estados', value: TODOS }, ...Object.entries(ESTADOS_REFERIDO).map(([value, e]) => ({ label: e.etiqueta, value }))]

const lista = usePaginacionCursor(cursor => useReferidos().listar(estado.value === TODOS ? {} : { estado: estado.value }, cursor))
const aRechazar = shallowRef<ReferidoLealtad | null>(null)
const rechazando = computed({
    get: () => aRechazar.value !== null,
    set: (valor: boolean) => {
        if (!valor) {
            aRechazar.value = null
        }
    },
})

const columnas: TableColumn<ReferidoLealtad>[] = [
    { accessorKey: 'referido_nombre', header: 'Referido' },
    { accessorKey: 'referidor_nombre', header: 'Lo refirió', meta: SOLO_ANCHO },
    { accessorKey: 'estado', header: 'Estado' },
    { id: 'acciones', header: '', meta: { class: { td: 'text-right w-0' } } },
]

function rechazar(motivo: string, clave: string) {
    if (!aRechazar.value) {
        return Promise.resolve({ ok: false as const, problema: { type: 'about:blank', title: 'Sin referido', status: 0 } })
    }
    return useReferidos().rechazar(aRechazar.value.id, motivo, clave)
}

function alRechazar(referido: ReferidoLealtad) {
    toast.add({ title: 'Referido rechazado', description: `${referido.referido_nombre}: se revierten los puntos otorgados.`, icon: 'i-lucide-ban', color: 'neutral' })
    void lista.recargar()
}

watch(estado, async (valor) => {
    await router.replace({ query: valor === TODOS ? {} : { estado: valor } })
    await lista.recargar()
})

onMounted(() => {
    void lista.recargar()
})
</script>

<template>
    <PanelPagina
        id="referidos"
        titulo="Referidos"
        icono="i-lucide-user-plus"
    >
        <template #acciones>
            <UButton
                to="/lealtad"
                icon="i-lucide-arrow-left"
                label="Lealtad"
                color="neutral"
                variant="ghost"
                class="hidden sm:inline-flex"
            />
        </template>

        <div class="flex flex-col gap-4">
            <USelect
                v-model="estado"
                :items="itemsEstado"
                aria-label="Estado"
                class="w-full sm:w-56"
            />
            <ProblemaAlerta
                v-if="lista.problema.value"
                :problema="lista.problema.value"
                :reintentar="lista.recargar"
                :reintentando="lista.cargando.value"
                data-prueba="referidos-error"
            />
            <template v-else>
                <UTable
                    :data="lista.filas.value"
                    :columns="columnas"
                    :loading="lista.cargando.value"
                    data-prueba="tabla-referidos"
                >
                    <template #referido_nombre-cell="{ row }">
                        <div class="flex min-w-0 flex-col whitespace-normal">
                            <ULink
                                :to="enlace(`/clientes/${row.original.referido_id}?tab=puntos`)"
                                class="text-sm font-medium text-highlighted hover:text-primary"
                            >
                                {{ row.original.referido_nombre }}
                            </ULink>
                            <span class="text-xs text-muted">Código <span class="font-mono">{{ row.original.codigo }}</span> · {{ formatearFecha(row.original.created_at) }}</span>
                            <span class="text-xs text-muted sm:hidden">Lo refirió {{ row.original.referidor_nombre }}</span>
                            <span
                                v-if="row.original.motivo"
                                class="text-xs text-muted"
                            >{{ row.original.motivo }}</span>
                        </div>
                    </template>
                    <template #referidor_nombre-cell="{ row }">
                        <ULink
                            :to="enlace(`/clientes/${row.original.referidor_id}?tab=puntos`)"
                            class="text-sm hover:text-primary"
                        >
                            {{ row.original.referidor_nombre }}
                        </ULink>
                    </template>
                    <template #estado-cell="{ row }">
                        <div class="flex flex-col gap-0.5">
                            <UBadge
                                :label="ESTADOS_REFERIDO[row.original.estado].etiqueta"
                                :color="ESTADOS_REFERIDO[row.original.estado].color"
                                :icon="ESTADOS_REFERIDO[row.original.estado].icono"
                                variant="subtle"
                                size="sm"
                                class="self-start"
                            />
                            <span
                                v-if="row.original.calificado_en"
                                class="text-xs text-muted"
                            >{{ formatearFecha(row.original.calificado_en) }}</span>
                        </div>
                    </template>
                    <template #acciones-cell="{ row }">
                        <UButton
                            v-if="puede('lealtad.ajustar') && row.original.estado !== 'rechazado'"
                            label="Rechazar"
                            icon="i-lucide-ban"
                            color="error"
                            variant="ghost"
                            size="sm"
                            :ui="{ label: 'hidden sm:inline' }"
                            :aria-label="`Rechazar el referido ${row.original.referido_nombre}`"
                            :data-rechazar="row.original.id"
                            @click="aRechazar = row.original"
                        />
                    </template>
                    <template #empty>
                        <UEmpty
                            icon="i-lucide-user-plus"
                            title="Sin referidos"
                            description="Se registran solos cuando un cliente nuevo llega con el código de otro."
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

        <AccionMotivoModal
            v-model:open="rechazando"
            titulo="Rechazar referido"
            :descripcion="aRechazar ? `${aRechazar.referido_nombre} · lo refirió ${aRechazar.referidor_nombre}` : undefined"
            efecto="El referido queda rechazado y se revierten los puntos que se otorgaron por él (al que refirió y al referido)."
            confirmar="Rechazar"
            placeholder="Ej.: es el mismo hogar que el cliente que lo refirió"
            :ejecutar="rechazar"
            @hecho="alRechazar"
        />
    </PanelPagina>
</template>
