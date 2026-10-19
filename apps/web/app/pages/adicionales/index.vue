<script setup lang="ts">
import type { SelectItem, TableColumn } from '@nuxt/ui'

/**
 * Catálogo de servicios adicionales de la empresa activa (A1, `contratos/adicionales.md`):
 * streaming, IPTV… Crear (`adicionales.crear`), editar con `version` (`adicionales.editar`) y
 * desactivar (`adicionales.desactivar`); nada se borra. Los motivos de cortesía, en su página.
 */
definePageMeta({ permiso: 'adicionales.ver' })

useHead({ title: 'Adicionales · ArgosIsp' })

const route = useRoute()
const router = useRouter()
const toast = useToast()
const { puede } = usePermisos()
const { conSelector: variasEmpresas, nombre: nombreEmpresa } = useEmpresaActiva()

const TODOS = 'todos'
type FiltroActivo = 'activos' | 'inactivos' | typeof TODOS
const busqueda = ref(typeof route.query.q === 'string' ? route.query.q : '')
const activo = ref<FiltroActivo>(route.query.activo === 'inactivos' || route.query.activo === TODOS ? route.query.activo : 'activos')
const itemsActivo: SelectItem[] = [
    { label: 'Activos', value: 'activos' },
    { label: 'Desactivados', value: 'inactivos' },
    { label: 'Todos', value: TODOS },
]

function filtros(): FiltrosAdicionales {
    const resultado: FiltrosAdicionales = {}
    const q = busqueda.value.trim()
    if (q) {
        resultado.q = q
    }
    if (activo.value !== TODOS) {
        resultado.activo = activo.value === 'activos'
    }
    return resultado
}

const lista = usePaginacionCursor(cursor => useAdicionales().listar(filtros(), cursor))

const columnas = computed<TableColumn<Adicional>[]>(() => [
    { accessorKey: 'nombre', header: 'Adicional', meta: { class: { td: 'whitespace-normal' } } },
    ...(variasEmpresas.value ? [{ accessorKey: 'empresa_id', header: 'Empresa', meta: SOLO_ESCRITORIO }] : []),
    { accessorKey: 'precio_sugerido', header: 'Precio sugerido', meta: { class: { th: 'hidden text-right sm:table-cell', td: 'hidden text-right sm:table-cell' } } },
    { accessorKey: 'activo', header: 'Estado', meta: SOLO_ANCHO },
    { id: 'acciones', header: '', meta: { class: { td: 'text-right w-0' } } },
])

const formularioAbierto = ref(false)
const editando = shallowRef<Adicional | null>(null)
const desactivarAbierto = ref(false)
const aDesactivar = shallowRef<Adicional | null>(null)

function abrir(adicional: Adicional | null) {
    editando.value = adicional
    formularioAbierto.value = true
}

function pedirDesactivar(adicional: Adicional) {
    aDesactivar.value = adicional
    desactivarAbierto.value = true
}

function desactivar() {
    const actual = aDesactivar.value
    if (!actual) {
        return Promise.resolve({ ok: false as const, problema: { type: 'about:blank', title: 'Sin adicional', status: 0 } })
    }
    return useAdicionales().desactivar(actual.id, actual.version)
}

function alGuardar(adicional: Adicional, nuevo: boolean) {
    toast.add({ title: nuevo ? `${adicional.nombre} creado` : `${adicional.nombre} actualizado`, description: adicional.codigo, icon: 'i-lucide-circle-check', color: 'success' })
    void lista.recargar()
}

function alDesactivar(adicional: Adicional) {
    toast.add({ title: `${adicional.nombre} desactivado`, description: 'Ya no se asigna ni lo traen los planes; las asignaciones vigentes siguen.', icon: 'i-lucide-ban', color: 'neutral' })
    void lista.recargar()
}

async function aplicarFiltros() {
    const query: Record<string, string> = {}
    const q = busqueda.value.trim()
    if (q) {
        query.q = q
    }
    if (activo.value !== 'activos') {
        query.activo = activo.value
    }
    await router.replace({ query })
    await lista.recargar()
}

let temporizador: ReturnType<typeof setTimeout> | undefined
watch(busqueda, () => {
    clearTimeout(temporizador)
    temporizador = setTimeout(aplicarFiltros, 300)
})
watch(activo, aplicarFiltros)
onBeforeUnmount(() => clearTimeout(temporizador))

onMounted(() => void lista.recargar())
</script>

<template>
    <PanelPagina
        id="adicionales"
        titulo="Adicionales"
        icono="i-lucide-package-plus"
    >
        <template #acciones>
            <UButton
                v-if="puede('adicionales.crear')"
                label="Nuevo adicional"
                icon="i-lucide-plus"
                :ui="{ label: 'hidden sm:inline' }"
                aria-label="Nuevo adicional"
                data-prueba="nuevo-adicional"
                @click="abrir(null)"
            />
        </template>

        <div class="flex flex-col gap-4">
            <div class="flex flex-wrap items-start justify-between gap-3">
                <p class="max-w-3xl text-sm text-muted">
                    Servicios que acompañan al internet: una cuenta de streaming, usuarios de IPTV… Cada servicio los tiene incluidos en su plan, de cortesía o cobrados aparte. El catálogo es de cada empresa.
                </p>
                <UButton
                    to="/adicionales/motivos"
                    label="Motivos de cortesía"
                    icon="i-lucide-gift"
                    color="neutral"
                    variant="outline"
                    size="sm"
                />
            </div>

            <div class="flex flex-col gap-3 sm:flex-row">
                <UInput
                    v-model="busqueda"
                    icon="i-lucide-search"
                    placeholder="Código o nombre"
                    aria-label="Buscar adicionales"
                    class="w-full sm:max-w-sm"
                    :loading="lista.cargando.value"
                />
                <USelect
                    v-model="activo"
                    :items="itemsActivo"
                    aria-label="Filtrar por estado"
                    class="w-full sm:w-44"
                />
            </div>

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
                    :ui="{ td: 'py-2.5' }"
                    data-prueba="tabla-adicionales"
                >
                    <template #nombre-cell="{ row }">
                        <div class="flex min-w-0 flex-col gap-0.5">
                            <span class="flex flex-wrap items-center gap-1.5 text-sm font-medium text-highlighted">
                                {{ row.original.nombre }}
                                <UBadge
                                    v-if="!row.original.activo"
                                    label="Desactivado"
                                    color="neutral"
                                    variant="subtle"
                                    size="sm"
                                    class="sm:hidden"
                                />
                            </span>
                            <span class="font-mono text-xs text-muted">{{ row.original.codigo }}</span>
                            <span
                                v-if="row.original.descripcion"
                                class="text-xs text-muted"
                            >{{ row.original.descripcion }}</span>
                            <span
                                v-if="row.original.precio_sugerido"
                                class="text-xs text-muted sm:hidden"
                            >Sugerido {{ formatearQuetzales(row.original.precio_sugerido) }}</span>
                        </div>
                    </template>
                    <template #empresa_id-cell="{ row }">
                        <span class="text-sm">{{ nombreEmpresa(row.original.empresa_id) }}</span>
                    </template>
                    <template #precio_sugerido-cell="{ row }">
                        <span class="whitespace-nowrap tabular-nums">{{ row.original.precio_sugerido ? formatearQuetzales(row.original.precio_sugerido) : '—' }}</span>
                    </template>
                    <template #activo-cell="{ row }">
                        <UBadge
                            :label="row.original.activo ? 'Activo' : 'Desactivado'"
                            :icon="row.original.activo ? 'i-lucide-circle-check' : 'i-lucide-circle-off'"
                            :color="row.original.activo ? 'success' : 'neutral'"
                            variant="subtle"
                            size="sm"
                        />
                    </template>
                    <template #acciones-cell="{ row }">
                        <div class="flex justify-end gap-1">
                            <UButton
                                v-if="puede('adicionales.editar')"
                                icon="i-lucide-pencil"
                                color="neutral"
                                variant="ghost"
                                size="sm"
                                :aria-label="`Editar ${row.original.nombre}`"
                                :data-prueba="`editar-adicional-${row.original.id}`"
                                @click="abrir(row.original)"
                            />
                            <UButton
                                v-if="puede('adicionales.desactivar') && row.original.activo"
                                icon="i-lucide-ban"
                                color="error"
                                variant="ghost"
                                size="sm"
                                :aria-label="`Desactivar ${row.original.nombre}`"
                                :data-prueba="`desactivar-adicional-${row.original.id}`"
                                @click="pedirDesactivar(row.original)"
                            />
                        </div>
                    </template>
                    <template #empty>
                        <UEmpty
                            icon="i-lucide-package-plus"
                            :title="busqueda || activo !== 'activos' ? 'Ningún adicional con esos filtros' : 'Todavía no hay adicionales'"
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

        <AdicionalModal
            v-if="puede('adicionales.crear') || puede('adicionales.editar')"
            v-model:open="formularioAbierto"
            :adicional="editando"
            @guardado="alGuardar"
        />
        <ConfirmacionModal
            v-if="aDesactivar && puede('adicionales.desactivar')"
            v-model:open="desactivarAbierto"
            :titulo="`Desactivar ${aDesactivar.nombre}`"
            efecto="Ya no se podrá asignar ni lo traerán los planes. Las asignaciones vigentes siguen; nada se borra."
            confirmar="Desactivar"
            :ejecutar="desactivar"
            @hecho="alDesactivar"
        />
    </PanelPagina>
</template>
