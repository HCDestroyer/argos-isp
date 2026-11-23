<script setup lang="ts">
import type { TabsItem } from '@nuxt/ui'

/**
 * Pestañas segmentadas de Finanzas (tableros Conta*): barra gris con la activa en blanco, siempre
 * dentro de la misma tarjeta que su contenido. Con `to` en las pestañas, cada una es una página
 * (Compras y gastos: compras, borradores, proveedores, pagos, activos y diferidos) y elegirla
 * navega; sin `to`, cambia el `v-model`.
 */
const props = withDefaults(defineProps<{
    items: PestanaConta[]
    etiqueta: string
}>(), {})

const modelo = defineModel<string>({ required: true })

const items = computed<TabsItem[]>(() => props.items.map(p => ({
    label: p.label,
    value: p.value,
    icon: p.icon,
    badge: p.contador === undefined || p.contador === null
        ? undefined
        : { label: p.contador.toLocaleString('es-GT'), color: p.tono === 'error' ? 'error' as const : 'neutral' as const, variant: 'soft' as const, size: 'sm' as const },
})))

const valor = computed({
    get: () => modelo.value,
    set: (nuevo: string | number) => {
        const elegido = props.items.find(p => p.value === String(nuevo))
        if (elegido?.to) {
            void navigateTo(elegido.to)
            return
        }
        modelo.value = String(nuevo)
    },
})
</script>

<template>
    <UTabs
        v-model="valor"
        :items="items"
        variant="pill"
        color="neutral"
        :content="false"
        :aria-label="etiqueta"
        class="min-w-0"
        :ui="{
            list: 'w-auto max-w-full justify-start self-start overflow-x-auto rounded-xl bg-(--ax-panel) p-1',
            indicator: 'rounded-lg bg-(--ax-tarjeta) shadow-sm ring ring-(--ax-borde)',
            trigger: 'shrink-0 grow-0 rounded-lg px-3 text-muted data-[state=active]:text-primary',
            leadingIcon: 'size-4',
            label: 'whitespace-nowrap',
        }"
        data-prueba="pestanas-conta"
    />
</template>
