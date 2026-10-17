<script setup lang="ts">
/**
 * Aviso discreto (un toast de 20 s, una vez por sesión) cuando faltan menos de 15 min para el tope
 * absoluto de la sesión (`expira_max_en`, login + 72 h): ahí vence aunque se use
 * (`contratos/sesion-panel.md` §4). No dibuja nada propio.
 */
const expiraMax = useExpiraMaxSesion()
const toast = useToast()

const ID_TOAST = 'sesion-tope'
let avisadoPara: string | null = null
let temporizador: ReturnType<typeof setInterval> | null = null

function revisar(): void {
    const tope = expiraMax.value
    if (!tope || avisadoPara === tope || faltaParaTopeSesion(tope) === null) {
        return
    }
    avisadoPara = tope
    toast.add({
        id: ID_TOAST,
        title: 'Tu sesión terminará pronto; guarda tu trabajo',
        description: `Por seguridad vence a las ${formatearFechaHora(tope)} aunque sigas trabajando. Después te pedirá la contraseña.`,
        color: 'warning',
        icon: 'i-lucide-clock-alert',
        duration: 20_000,
    })
}

watch(expiraMax, revisar)

onMounted(() => {
    revisar()
    temporizador = setInterval(revisar, 30_000)
})

onBeforeUnmount(() => {
    if (temporizador) {
        clearInterval(temporizador)
    }
})
</script>

<template>
    <span
        hidden
        aria-hidden="true"
    />
</template>
