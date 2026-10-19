<script setup lang="ts">
/**
 * Un valor que la API muestra **una sola vez** (token `atk_`, enlace de conexión, secreto del
 * receptor): se ve aquí con "Copiar" y, al cerrar, el padre lo olvida. Nunca se guarda en el
 * navegador. Con `venceEn`, la cuenta regresiva y el aviso cuando venció.
 */
const props = withDefaults(defineProps<{
    titulo: string
    descripcion: string
    /** Lo que se copia, en orden (el primero es el principal). */
    valores: { etiqueta: string, valor: string, secreto?: boolean }[]
    venceEn?: string | null
}>(), {
    venceEn: null,
})

const abierto = defineModel<boolean>('open', { default: false })
const emit = defineEmits<{ cerrado: [] }>()

const toast = useToast()
const ahora = ref(Date.now())
let reloj: ReturnType<typeof setInterval> | undefined

watch(abierto, (valor) => {
    clearInterval(reloj)
    if (valor && props.venceEn) {
        ahora.value = Date.now()
        reloj = setInterval(() => {
            ahora.value = Date.now()
        }, 1000)
    }
    if (!valor) {
        emit('cerrado')
    }
}, { immediate: true })
onBeforeUnmount(() => clearInterval(reloj))

const restante = computed(() => (props.venceEn ? tiempoRestante(props.venceEn, ahora.value) : null))

async function copiar(etiqueta: string, valor: string) {
    try {
        await navigator.clipboard.writeText(valor)
        toast.add({ title: `${etiqueta} copiado`, color: 'neutral', icon: 'i-lucide-clipboard-check' })
    }
    catch {
        toast.add({ title: 'No se pudo copiar', description: 'Selecciona el texto y cópialo a mano.', color: 'warning', icon: 'i-lucide-clipboard-x' })
    }
}
</script>

<template>
    <UModal
        v-model:open="abierto"
        :title="titulo"
        :description="descripcion"
        :dismissible="false"
    >
        <template #body>
            <div
                class="flex flex-col gap-4"
                data-prueba="valor-una-vez"
            >
                <UAlert
                    color="warning"
                    variant="subtle"
                    icon="i-lucide-eye-off"
                    title="Solo se muestra ahora"
                    description="ArgosIsp no lo vuelve a mostrar. Si lo pierdes, genera otro."
                />
                <div
                    v-for="item in valores"
                    :key="item.etiqueta"
                    class="flex flex-col gap-1.5"
                >
                    <span class="text-xs font-medium text-muted">{{ item.etiqueta }}</span>
                    <div class="flex flex-col gap-2 sm:flex-row sm:items-start">
                        <code
                            class="min-w-0 flex-1 select-all break-all rounded-md bg-elevated px-2.5 py-2 font-mono text-sm text-highlighted"
                            :data-prueba="`valor-${item.etiqueta}`"
                        >{{ item.valor }}</code>
                        <UButton
                            label="Copiar"
                            icon="i-lucide-copy"
                            color="neutral"
                            variant="outline"
                            size="sm"
                            class="justify-center"
                            :aria-label="`Copiar ${item.etiqueta.toLowerCase()}`"
                            @click="copiar(item.etiqueta, item.valor)"
                        />
                    </div>
                </div>
                <p
                    v-if="venceEn"
                    class="flex items-center gap-1.5 text-sm"
                    :class="restante ? 'text-muted' : 'text-error'"
                    role="timer"
                    data-prueba="caducidad"
                >
                    <UIcon
                        :name="restante ? 'i-lucide-timer' : 'i-lucide-timer-off'"
                        class="size-4"
                    />
                    <template v-if="restante">
                        Vence en {{ restante }} ({{ formatearHora(venceEn) }}) · un solo uso
                    </template>
                    <template v-else>
                        Venció a las {{ formatearHora(venceEn) }}: genera otro
                    </template>
                </p>
            </div>
        </template>
        <template #footer>
            <div class="flex w-full justify-end">
                <UButton
                    label="Ya lo copié, cerrar"
                    icon="i-lucide-check"
                    data-prueba="cerrar-valor-una-vez"
                    @click="abierto = false"
                />
            </div>
        </template>
    </UModal>
</template>
