<script setup lang="ts">
/**
 * Comandos de RouterOS para pegar en New Terminal, en un bloque con «Copiar». Los manda la API
 * (`DiagnosticoCorte.chequeos[].comandos`, hasta 12 por chequeo); el panel no los arma.
 */
const props = defineProps<{
    comandos: string[]
}>()

const toast = useToast()
const texto = computed(() => props.comandos.join('\n'))

async function copiar() {
    try {
        await navigator.clipboard.writeText(texto.value)
        toast.add({ title: 'Comandos copiados', description: 'Pégalos en New Terminal del router.', color: 'neutral', icon: 'i-lucide-clipboard-check' })
    }
    catch {
        toast.add({ title: 'No se pudo copiar', description: 'Selecciona el texto y cópialo a mano.', color: 'warning' })
    }
}
</script>

<template>
    <div
        v-if="comandos.length"
        class="flex flex-col gap-1 rounded-md border border-default bg-elevated/50"
    >
        <div class="flex items-center justify-between gap-2 px-3 pt-2">
            <span class="text-xs font-medium text-default">Comandos de RouterOS (New Terminal)</span>
            <UButton
                label="Copiar"
                icon="i-lucide-clipboard-copy"
                color="neutral"
                variant="ghost"
                size="xs"
                aria-label="Copiar los comandos de RouterOS"
                data-prueba="copiar-comandos"
                @click="copiar"
            />
        </div>
        <pre
            class="overflow-x-auto px-3 pb-3 font-mono text-xs whitespace-pre text-highlighted"
            data-prueba="comandos-routeros"
        >{{ texto }}</pre>
    </div>
</template>
