<script setup lang="ts">
/**
 * Elegir permisos del catálogo de la API (`GET /permisos`), agrupados por módulo, con búsqueda y
 * «todos» por grupo. Lo eligen el formulario de rol y el recorte de un token de API. No inventa
 * nombres: solo ofrece los del catálogo (el panel nunca escribe un permiso a mano).
 */
const props = withDefaults(defineProps<{
    catalogo: readonly PermisoCatalogo[]
    disabled?: boolean
    /** Prefijo de `data-prueba` (hay dos selectores en algunas pantallas). */
    prueba?: string
}>(), {
    disabled: false,
    prueba: 'permisos',
})

const elegidos = defineModel<string[]>({ default: () => [] })

const filtro = ref('')
const grupos = computed(() => agruparPermisos(props.catalogo, filtro.value))
const elegidosSet = computed(() => new Set(elegidos.value))

function itemsDe(grupo: GrupoPermisos) {
    return grupo.permisos.map(p => ({ label: p.nombre, description: p.descripcion ?? undefined, value: p.nombre }))
}

function elegidosDe(grupo: GrupoPermisos): string[] {
    return grupo.permisos.map(p => p.nombre).filter(n => elegidosSet.value.has(n))
}

function cambiarGrupo(grupo: GrupoPermisos, valores: unknown) {
    const nuevos = Array.isArray(valores) ? valores.filter((v): v is string => typeof v === 'string') : []
    const delGrupo = new Set(grupo.permisos.map(p => p.nombre))
    elegidos.value = [...elegidos.value.filter(n => !delGrupo.has(n)), ...nuevos].sort()
}

function todos(grupo: GrupoPermisos, marcar: boolean) {
    cambiarGrupo(grupo, marcar ? grupo.permisos.map(p => p.nombre) : [])
}
</script>

<template>
    <div
        class="flex flex-col gap-4"
        :data-prueba="prueba"
    >
        <div class="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <UInput
                v-model="filtro"
                icon="i-lucide-search"
                placeholder="Buscar permiso o módulo"
                aria-label="Buscar permiso"
                class="w-full sm:w-72"
                :data-prueba="`${prueba}-buscar`"
            />
            <span
                class="text-sm text-muted"
                :data-prueba="`${prueba}-cuenta`"
            >{{ elegidos.length }} de {{ catalogo.length }} permisos</span>
        </div>
        <p
            v-if="!grupos.length"
            class="text-sm text-muted"
        >
            Ningún permiso coincide con «{{ filtro }}».
        </p>
        <div
            v-for="grupo in grupos"
            :key="grupo.modulo"
            class="flex flex-col gap-2 rounded-md border border-default p-3"
            :data-modulo="grupo.modulo"
        >
            <div class="flex items-center justify-between gap-2">
                <span class="text-sm font-medium text-highlighted">
                    {{ grupo.etiqueta }}
                    <span class="font-normal text-muted">· {{ elegidosDe(grupo).length }}/{{ grupo.permisos.length }}</span>
                </span>
                <UButton
                    v-if="!disabled"
                    :label="elegidosDe(grupo).length === grupo.permisos.length ? 'Ninguno' : 'Todos'"
                    color="neutral"
                    variant="link"
                    size="xs"
                    :aria-label="`${elegidosDe(grupo).length === grupo.permisos.length ? 'Quitar todos' : 'Marcar todos'} los permisos de ${grupo.etiqueta}`"
                    @click="todos(grupo, elegidosDe(grupo).length !== grupo.permisos.length)"
                />
            </div>
            <UCheckboxGroup
                :model-value="elegidosDe(grupo)"
                :items="itemsDe(grupo)"
                :aria-label="`Permisos de ${grupo.etiqueta}`"
                :disabled="disabled"
                :ui="{ fieldset: 'grid gap-2 sm:grid-cols-2', label: 'font-mono text-xs', description: 'text-xs' }"
                @update:model-value="v => cambiarGrupo(grupo, v)"
            />
        </div>
    </div>
</template>
