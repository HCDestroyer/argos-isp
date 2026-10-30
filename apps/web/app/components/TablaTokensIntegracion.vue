<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'

/**
 * Tokens `atk_` del usuario técnico de una integración (Horus, Iris), sin su valor: nombre,
 * creación, último uso, estado y "Revocar". La página decide el permiso y confirma la revocación.
 */
withDefaults(defineProps<{
    tokens: TokenApi[]
    cargando?: boolean
    /** Si se muestra "Revocar" en los tokens vigentes (permiso `<integracion>.revocar_token`). */
    puedeRevocar?: boolean
    /** Texto de la tabla vacía. */
    vacio: string
}>(), {
    cargando: false,
    puedeRevocar: false,
})

const emit = defineEmits<{ revocar: [token: TokenApi] }>()

const columnas: TableColumn<TokenApi>[] = [
    { accessorKey: 'nombre', header: 'Token', meta: { class: { td: 'whitespace-normal' } } },
    { accessorKey: 'created_at', header: 'Creado', meta: SOLO_ESCRITORIO },
    { accessorKey: 'ultimo_uso', header: 'Último uso', meta: SOLO_ESCRITORIO },
    { id: 'estado', header: 'Estado' },
    { id: 'acciones', header: '', meta: { class: { td: 'text-right w-0' } } },
]
</script>

<template>
    <UTable
        :data="tokens"
        :columns="columnas"
        :loading="cargando"
    >
        <template #nombre-cell="{ row }">
            <div class="flex flex-col">
                <span class="text-sm font-medium text-highlighted">{{ row.original.nombre }}</span>
                <span class="text-xs text-muted sm:hidden">Creado {{ formatearFechaHora(row.original.created_at) }}</span>
            </div>
        </template>
        <template #created_at-cell="{ row }">
            {{ formatearFechaHora(row.original.created_at) }}
        </template>
        <template #ultimo_uso-cell="{ row }">
            {{ row.original.ultimo_uso ? formatearFechaHora(row.original.ultimo_uso) : 'Nunca' }}
        </template>
        <template #estado-cell="{ row }">
            <UBadge
                :label="row.original.revocado_en ? 'Revocado' : 'Vigente'"
                :icon="row.original.revocado_en ? 'i-lucide-ban' : 'i-lucide-circle-check'"
                :color="row.original.revocado_en ? 'neutral' : 'success'"
                variant="subtle"
                size="sm"
            />
        </template>
        <template #acciones-cell="{ row }">
            <UButton
                v-if="puedeRevocar && !row.original.revocado_en"
                label="Revocar"
                icon="i-lucide-ban"
                color="error"
                variant="ghost"
                size="sm"
                :aria-label="`Revocar ${row.original.nombre}`"
                :data-prueba="`revocar-token-${row.original.id}`"
                @click="emit('revocar', row.original)"
            />
        </template>
        <template #empty>
            <UEmpty
                icon="i-lucide-key-round"
                :title="vacio"
                variant="naked"
            />
        </template>
    </UTable>
</template>
