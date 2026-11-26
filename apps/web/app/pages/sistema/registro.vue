<script setup lang="ts">
import type { SelectItem, TableColumn } from '@nuxt/ui'

definePageMeta({ permiso: 'sistema.ver_registro' })

useHead({ title: 'Registro del sistema · ArgosIsp' })

const { enlace } = usePermisos()
const TODOS = 'todos'
const nivel = ref<string>(TODOS)
const origen = ref<string>(TODOS)
/** Desde qué día (la API acepta hasta 31 días atrás; por defecto, 7). */
const desde = ref('')

const itemsNivel: SelectItem[] = [
    { label: 'Todos los niveles', value: TODOS },
    ...(Object.keys(NIVELES_REGISTRO) as EntradaRegistro['nivel'][]).map(clave => ({ label: NIVELES_REGISTRO[clave].etiqueta, value: clave, icon: NIVELES_REGISTRO[clave].icono })),
]
const itemsOrigen: SelectItem[] = [
    { label: 'Todos los orígenes', value: TODOS },
    ...(Object.keys(ORIGENES_REGISTRO) as EntradaRegistro['origen'][]).map(clave => ({ label: ORIGENES_REGISTRO[clave], value: clave })),
]

function filtros(): FiltrosRegistro {
    return {
        ...(nivel.value !== TODOS ? { nivel: nivel.value as EntradaRegistro['nivel'] } : {}),
        ...(origen.value !== TODOS ? { origen: origen.value as EntradaRegistro['origen'] } : {}),
        ...(desde.value ? { desde: new Date(`${desde.value}T00:00:00-06:00`).toISOString() } : {}),
    }
}

const lista = usePaginacionCursor(cursor => useSistema().registro(filtros(), cursor))

watch([nivel, origen, desde], () => void lista.recargar())
onMounted(() => void lista.recargar())

const columnas: TableColumn<EntradaRegistro>[] = [
    { accessorKey: 'nivel', header: 'Nivel' },
    { accessorKey: 'titulo', header: 'Qué pasó' },
    { accessorKey: 'origen', header: 'Origen', meta: SOLO_ANCHO },
    { accessorKey: 'momento', header: 'Cuándo' },
]
</script>

<template>
    <ConfiguracionMarco
        id="registro-sistema"
        titulo="Sistema"
        descripcion="Cómo está el servidor: salud, registro de fallos y espacio en disco"
    >
        <div class="flex flex-col gap-4">
            <div
                class="grid gap-3 rounded-2xl border border-(--ax-borde) p-3 sm:grid-cols-3"
                role="group"
                aria-label="Filtros del registro"
            >
                <UFormField label="Nivel">
                    <USelect
                        v-model="nivel"
                        :items="itemsNivel"
                        class="w-full"
                        aria-label="Filtrar por nivel"
                    />
                </UFormField>
                <UFormField label="Origen">
                    <USelect
                        v-model="origen"
                        :items="itemsOrigen"
                        class="w-full"
                        aria-label="Filtrar por origen"
                    />
                </UFormField>
                <UFormField
                    label="Desde"
                    help="Hasta 31 días atrás; vacío = últimos 7 días."
                >
                    <CampoFecha
                        v-model="desde"
                        class="w-full"
                        aria-label="Desde qué día"
                    />
                </UFormField>
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
                    data-prueba="tabla-registro"
                >
                    <template #nivel-cell="{ row }">
                        <UBadge
                            :label="NIVELES_REGISTRO[row.original.nivel].etiqueta"
                            :color="NIVELES_REGISTRO[row.original.nivel].color"
                            :icon="NIVELES_REGISTRO[row.original.nivel].icono"
                            variant="subtle"
                            size="sm"
                        />
                    </template>
                    <template #titulo-cell="{ row }">
                        <div class="flex min-w-56 flex-col whitespace-normal">
                            <ULink
                                v-if="rutaEntidadRegistro(row.original.entidad) && enlace(rutaEntidadRegistro(row.original.entidad) ?? '')"
                                :to="enlace(rutaEntidadRegistro(row.original.entidad) ?? '')"
                                class="font-semibold text-highlighted hover:text-primary"
                            >{{ row.original.titulo }}</ULink>
                            <span
                                v-else
                                class="font-semibold text-highlighted"
                            >{{ row.original.titulo }}</span>
                            <span
                                v-if="row.original.detalle"
                                class="text-xs text-muted"
                            >{{ row.original.detalle }}</span>
                            <span
                                v-if="row.original.request_id"
                                class="font-mono text-xs text-dimmed"
                                data-copiar
                            >request_id {{ row.original.request_id }}</span>
                        </div>
                    </template>
                    <template #origen-cell="{ row }">
                        {{ ORIGENES_REGISTRO[row.original.origen] }}
                    </template>
                    <template #momento-cell="{ row }">
                        <span class="flex flex-col text-sm">
                            <span>{{ formatearFechaHora(row.original.momento) }}</span>
                            <span class="text-xs text-muted">{{ haceCuanto(row.original.momento) }}</span>
                        </span>
                    </template>
                    <template #empty>
                        <UEmpty
                            icon="i-lucide-check-circle-2"
                            title="Sin eventos con estos filtros"
                            description="Prueba con otro nivel, origen o fecha."
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
    </ConfiguracionMarco>
</template>
