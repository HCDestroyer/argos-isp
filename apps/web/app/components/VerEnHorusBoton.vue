<script setup lang="ts">
import type { ButtonProps } from '@nuxt/ui'

/**
 * "Ver en Horus" (`contratos/horus.md` §1.5): pide a la API la URL de autologin (el servidor de
 * Argos pide el ticket a Horus; el navegador nunca lo ve) y la abre en otra pestaña. La pestaña se
 * abre antes de la petición, con el clic, para que el navegador no la bloquee. Si falta
 * `horus.abrir` o el conector está apagado, el botón queda deshabilitado y un "¿Por qué?" al lado
 * explica el motivo (un botón deshabilitado no recibe el puntero ni el foco).
 */
const props = withDefaults(defineProps<{
    tipo: TipoDestinoHorus
    idExterno: string | number
    size?: ButtonProps['size']
    variant?: ButtonProps['variant']
}>(), {
    size: 'md',
    variant: 'outline',
})

const { puede } = usePermisos()
const horus = useHorus()
const toast = useToast()

const abriendo = ref(false)

/** Con Horus en pausa (`reintentar_en`), el botón vuelve solo cuando termina la pausa. */
const ahora = ref(Date.now())
let finPausa: ReturnType<typeof setTimeout> | undefined
watch(horus.pausa, (hasta) => {
    clearTimeout(finPausa)
    ahora.value = Date.now()
    const espera = hasta ? new Date(hasta).getTime() - ahora.value : 0
    if (espera > 0) {
        finPausa = setTimeout(() => {
            ahora.value = Date.now()
        }, espera + 500)
    }
}, { immediate: true })
onBeforeUnmount(() => clearTimeout(finPausa))

const explicacion = computed<string | null>(() => {
    if (!puede('horus.abrir')) {
        return EXPLICACION_HORUS.sinPermiso
    }
    if (horus.estado.value === 'apagado') {
        return EXPLICACION_HORUS.apagado
    }
    const pausa = textoPausaHorus(horus.pausa.value, ahora.value)
    return pausa ? `${pausa}: no respondió y ArgosIsp espera antes de volver a llamarlo.` : null
})

onMounted(() => void horus.conocerEstado())

function avisarBloqueo(url: string) {
    toast.add({
        title: 'El navegador bloqueó la pestaña de Horus',
        description: 'El enlace dura 60 segundos.',
        color: 'warning',
        icon: 'i-lucide-external-link',
        actions: [{ label: 'Abrir Horus', color: 'warning', variant: 'outline', onClick: () => void window.open(url, '_blank', 'noopener') }],
    })
}

async function abrir() {
    if (explicacion.value || abriendo.value) {
        return
    }
    const ventana = window.open('', '_blank')
    if (ventana) {
        ventana.opener = null
    }
    abriendo.value = true
    const resultado = await horus.abrir({ tipo: props.tipo, id_externo: String(props.idExterno) })
    abriendo.value = false
    if (resultado.ok) {
        if (ventana) {
            ventana.location.replace(resultado.data.url)
        }
        else {
            avisarBloqueo(resultado.data.url)
        }
        return
    }
    ventana?.close()
    const apagado = esHorusApagado(resultado.problema)
    const pausa = textoPausaHorus(reintentarEnDe(resultado.problema))
    toast.add({
        title: apagado ? 'La integración con Horus está apagada' : (pausa ?? 'No se pudo abrir Horus'),
        description: apagado ? EXPLICACION_HORUS.apagado : (resultado.problema.detail ?? resultado.problema.title),
        color: 'error',
        icon: 'i-lucide-circle-alert',
    })
}
</script>

<template>
    <span class="inline-flex items-center gap-1">
        <UButton
            label="Ver en Horus"
            icon="i-lucide-radar"
            trailing-icon="i-lucide-external-link"
            color="neutral"
            :variant="variant"
            :size="size"
            :disabled="explicacion !== null"
            :loading="abriendo"
            aria-label="Ver en Horus"
            :ui="{ label: 'hidden sm:inline', trailingIcon: 'hidden sm:inline-flex' }"
            :data-prueba="`ver-en-horus-${tipo}`"
            @click="abrir"
        />
        <UPopover
            v-if="explicacion"
            :content="{ side: 'bottom', align: 'end', collisionPadding: 12 }"
        >
            <UButton
                icon="i-lucide-circle-help"
                color="neutral"
                variant="ghost"
                :size="size"
                aria-label="¿Por qué no se puede ver en Horus?"
                data-prueba="por-que-horus"
            />
            <template #content>
                <p
                    class="max-w-64 p-3 text-sm text-default"
                    data-prueba="explicacion-horus"
                >
                    {{ explicacion }}
                </p>
            </template>
        </UPopover>
    </span>
</template>
