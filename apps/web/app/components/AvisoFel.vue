<script setup lang="ts">
/**
 * Aviso de la FEL en todo el panel (contrato §8.3; fila 17 de §15): con la FEL de la empresa activa
 * desactivada, la alerta permanente; con la contingencia activa, desde cuándo. Solo con `fel.ver`
 * y una empresa elegida. Lee `GET /fel/configuracion` una vez por empresa (`useFel().estadoDe`)
 * y se actualiza cuando Configuración → FEL guarda. Si la lectura falla no muestra nada: la
 * pantalla de FEL es la que enseña el error.
 */
const { puede } = usePermisos()
const { empresaId } = useEmpresaActiva()
const fel = useFel()
const route = useRoute()

const estado = computed(() => (fel.estado.value && fel.estado.value.empresaId === empresaId.value ? fel.estado.value : null))
const visible = computed(() => puede('fel.ver') && empresaId.value !== null)
const enConfiguracion = computed(() => route.path === '/configuracion/fel')

watch([visible, empresaId], () => {
    if (visible.value && empresaId.value !== null) {
        void fel.estadoDe(empresaId.value)
    }
}, { immediate: true })
</script>

<template>
    <div
        v-if="visible && estado && !enConfiguracion && (estado.modo === 'desactivada' || estado.contingenciaActiva)"
        class="mb-4 flex flex-col gap-2"
        data-prueba="aviso-fel"
    >
        <UAlert
            v-if="estado.modo === 'desactivada'"
            color="error"
            variant="subtle"
            icon="i-lucide-shield-off"
            title="FEL desactivada"
            :description="AVISO_FEL_DESACTIVADA"
            :actions="[{ label: 'Configurar FEL', to: '/configuracion/fel', color: 'error', variant: 'outline', icon: 'i-lucide-settings' }]"
            orientation="horizontal"
            :ui="{ root: 'py-2', description: 'text-xs' }"
            data-prueba="aviso-fel-desactivada"
        />
        <UAlert
            v-if="estado.contingenciaActiva"
            color="warning"
            variant="subtle"
            icon="i-lucide-cloud-off"
            title="Contingencia FEL activa"
            :description="`Desde ${estado.contingenciaDesde ? formatearFechaHora(estado.contingenciaDesde) : '—'}: las facturas se emiten y sus DTE esperan en cola.`"
            :actions="[{ label: 'Ver FEL', to: '/configuracion/fel', color: 'warning', variant: 'outline', icon: 'i-lucide-settings' }]"
            orientation="horizontal"
            :ui="{ root: 'py-2', description: 'text-xs' }"
            data-prueba="aviso-fel-contingencia"
        />
    </div>
</template>
