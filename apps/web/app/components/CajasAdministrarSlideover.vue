<script setup lang="ts">
/**
 * Cajas e impresión (panel lateral de la pantalla Cajas): cada caja con su estado, quién la tiene
 * y cómo imprime (decisión 20: ticket de 80 mm o carta; cada caja recuerda). Desde aquí se abre o
 * se cierra cualquier caja con permiso, y se crea una nueva.
 */
defineProps<{
    cajas: Caja[]
}>()

const abierto = defineModel<boolean>('open', { default: false })

const emit = defineEmits<{
    abrir: [caja: Caja]
    cerrar: [caja: Caja]
    nueva: []
}>()

const { puede } = usePermisos()
const { conSelector: variasEmpresas, empresas } = useEmpresaActiva()
function nombreEmpresa(id: number | undefined): string {
    return empresas.value.find(e => e.id === id)?.nombre_comercial ?? (id ? `Empresa ${id}` : '')
}
const impresion = useImpresionCaja()
const itemsFormato = FORMATOS_IMPRESION.map(f => ({ label: f.etiqueta, value: f.valor, icon: f.icono }))

function cambiarFormato(caja: Caja, valor: unknown) {
    if (valor === 'pos_80' || valor === 'carta') {
        impresion.guardar(caja.id, valor)
    }
}
</script>

<template>
    <USlideover
        v-model:open="abierto"
        :ui="{ content: 'sm:max-w-[28.75rem] sm:m-4 sm:rounded-[1.375rem] sm:h-[calc(100dvh-2rem)]' }"
    >
        <template #title>
            <ModalTitulo
                texto="Cajas e impresión"
                icono="i-lucide-settings-2"
            />
        </template>
        <template #description>
            <span class="ps-13">Estado de cada caja y cómo imprime sus recibos</span>
        </template>
        <template #body>
            <ul
                class="flex flex-col gap-3"
                aria-label="Cajas"
            >
                <li
                    v-for="caja in cajas"
                    :key="caja.id"
                    class="flex flex-col gap-3 rounded-2xl border border-(--ax-borde) p-3"
                    :data-caja="caja.id"
                >
                    <div class="flex items-center gap-3">
                        <span
                            class="pastilla-icono size-9 shrink-0"
                            :class="caja.turno_abierto_id ? 'bg-success/10 text-success' : 'bg-(--ax-panel) text-muted'"
                        >
                            <UIcon
                                :name="caja.turno_abierto_id ? 'i-lucide-lock-open' : 'i-lucide-lock'"
                                class="size-4"
                            />
                        </span>
                        <span class="flex min-w-0 flex-1 flex-col">
                            <span class="font-semibold text-highlighted">{{ caja.nombre }}</span>
                            <span
                                v-if="variasEmpresas"
                                class="text-xs text-muted"
                                :data-empresa-caja="caja.empresa_id"
                            >{{ nombreEmpresa(caja.empresa_id) }}</span>
                            <span class="truncate text-xs text-muted">{{ caja.turno_abierto_id ? `Abierta${caja.turno_abierto_por_nombre ? ` · ${caja.turno_abierto_por_nombre}` : ''}` : `Cerrada${caja.cajero_nombre ? ` · ${caja.cajero_nombre}` : ''}` }}</span>
                        </span>
                        <UButton
                            v-if="caja.turno_abierto_id && puede('cajas.cerrar')"
                            label="Cerrar"
                            icon="i-lucide-lock"
                            color="neutral"
                            variant="outline"
                            size="sm"
                            class="rounded-full"
                            @click="emit('cerrar', caja)"
                        />
                        <UButton
                            v-else-if="!caja.turno_abierto_id && caja.activa && puede('cajas.abrir')"
                            label="Abrir"
                            icon="i-lucide-lock-open"
                            color="success"
                            variant="soft"
                            size="sm"
                            class="rounded-full"
                            @click="emit('abrir', caja)"
                        />
                    </div>
                    <UFormField
                        label="Imprime los recibos en"
                        :ui="{ root: 'flex items-center justify-between gap-3', label: 'text-xs text-muted font-normal' }"
                    >
                        <USelect
                            :model-value="impresion.formatoDe(caja.id)"
                            :items="itemsFormato"
                            size="sm"
                            class="w-44"
                            :aria-label="`Impresión de ${caja.nombre}`"
                            :data-prueba="`impresion-caja-${caja.id}`"
                            @update:model-value="cambiarFormato(caja, $event)"
                        />
                    </UFormField>
                </li>
            </ul>
        </template>
        <template
            v-if="puede('cajas.crear')"
            #footer
        >
            <UButton
                label="Nueva caja"
                icon="i-lucide-plus"
                class="glow-brand ms-auto rounded-full"
                @click="emit('nueva')"
            />
        </template>
    </USlideover>
</template>
