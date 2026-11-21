<script setup lang="ts">
/**
 * Estado del sistema en la barra superior (header liviano): un icono con punto de color cuando hay
 * algo que revisar, que lleva a «Salud del sistema». Solo con `sistema.ver_salud`. Se lee al
 * montar y cada 60 s con la pestaña visible; con error no muestra punto (nunca un estado inventado).
 */
const { puede } = usePermisos()
const salud = useState<SaludSistema | null>('salud-sistema-barra', () => null)
const visible = computed(() => puede('sistema.ver_salud'))

async function cargar() {
    if (!visible.value || document.visibilityState !== 'visible') {
        return
    }
    const resultado = await useSistema().salud()
    salud.value = resultado.ok ? resultado.data : null
}

let temporizador: ReturnType<typeof setInterval> | undefined
onMounted(() => {
    void cargar()
    temporizador = setInterval(cargar, 60_000)
})
onBeforeUnmount(() => clearInterval(temporizador))

const estado = computed(() => salud.value?.estado_general ?? null)
const texto = computed(() => (estado.value ? `Sistema: ${ESTADO_GENERAL[estado.value].etiqueta.toLowerCase()}` : 'Salud del sistema'))
</script>

<template>
    <UChip
        v-if="visible"
        :show="estado === 'degradado' || estado === 'caido'"
        :color="estado === 'caido' ? 'error' : 'warning'"
        size="md"
        inset
    >
        <UButton
            to="/sistema/salud"
            icon="i-lucide-activity"
            color="neutral"
            variant="ghost"
            :title="texto"
            :aria-label="texto"
            data-prueba="estado-sistema"
        />
    </UChip>
</template>
