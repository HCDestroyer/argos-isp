<script setup lang="ts">
/**
 * «Correr corte ahora» (`POST /facturas/corte`, `facturas.generar`): vence lo pendiente y evalúa el
 * estado de los servicios cuya hora de corte ya pasó hoy, sin esperar al cron. Con `servicioId`,
 * solo ese servicio. El resultado (evaluados, cambiados, errores) va en un aviso.
 */
const props = withDefaults(defineProps<{
    servicioId?: number
}>(), {
    servicioId: undefined,
})

const emit = defineEmits<{ hecho: [resultado: ResultadoCorte] }>()

const toast = useToast()
const abierto = ref(false)

function correr(): Promise<Resultado<ResultadoCorte>> {
    return useFacturas().corte(nuevaClaveIdempotencia(), props.servicioId)
}

function alCorrer(r: ResultadoCorte) {
    toast.add({
        title: r.cambiados ? `${r.cambiados} ${r.cambiados === 1 ? 'servicio cambió' : 'servicios cambiaron'} de estado` : 'Ningún servicio cambió de estado',
        description: `${r.evaluados} evaluados${r.errores ? ` · ${r.errores} con error (ver bitácora)` : ''}${r.horas.length ? ` · horas ${r.horas.join(', ')}` : ''}`,
        color: r.errores ? 'warning' : 'success',
        icon: r.errores ? 'i-lucide-triangle-alert' : 'i-lucide-circle-check',
    })
    emit('hecho', r)
}
</script>

<template>
    <UButton
        :label="servicioId ? 'Evaluar corte' : 'Correr corte'"
        icon="i-lucide-scissors"
        color="neutral"
        variant="outline"
        data-prueba="correr-corte"
        @click="abierto = true"
    />
    <ConfirmacionModal
        v-model:open="abierto"
        :titulo="servicioId ? 'Evaluar el corte de este servicio' : 'Correr el corte ahora'"
        :efecto="servicioId ? 'Vence sus facturas pendientes y decide su estado con las reglas de su plantilla.' : 'Vence lo pendiente y decide el estado de los servicios cuya hora de corte ya pasó hoy. Es lo mismo que hace el cron; los cortes y reactivaciones se aplican de inmediato.'"
        confirmar="Correr"
        icono="i-lucide-scissors"
        color="warning"
        :ejecutar="correr"
        @hecho="alCorrer"
    />
</template>
