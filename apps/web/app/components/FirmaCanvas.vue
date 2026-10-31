<script setup lang="ts">
/**
 * Firma en pantalla con el dedo, el lápiz o el ratón (teléfono o tableta del técnico). Al soltar
 * genera el PNG del trazo dentro de los límites del contrato (D.1: ≤ 200 KB, de 50×20 a 1000×400
 * px) y su SHA-256 en el navegador, y lo emite en `v-model`. El lienzo es blanco en claro y en
 * oscuro (como el papel), así el trazo negro se ve igual que en el PDF.
 */
const props = withDefaults(defineProps<{
    disabled?: boolean
    /** Texto bajo la línea de la firma (nombre de quien firma). */
    firmante?: string | null
}>(), {
    disabled: false,
    firmante: null,
})

const firma = defineModel<FirmaCapturada | null>({ default: null })
const error = ref<string | null>(null)

const lienzo = useTemplateRef<HTMLCanvasElement>('lienzo')
const contenedor = useTemplateRef<HTMLDivElement>('contenedor')
let contexto: CanvasRenderingContext2D | null = null
let dibujando = false
let trazos = 0
let escala = 1

function preparar() {
    const canvas = lienzo.value
    const caja = contenedor.value
    if (!canvas || !caja) {
        return
    }
    const medidas = medidasLienzo(caja.clientWidth || 600, 200)
    canvas.width = medidas.ancho
    canvas.height = medidas.alto
    escala = medidas.ancho / (caja.clientWidth || medidas.ancho)
    contexto = canvas.getContext('2d')
    if (contexto) {
        contexto.lineWidth = 2.5
        contexto.lineCap = 'round'
        contexto.lineJoin = 'round'
        contexto.strokeStyle = '#111827'
    }
}

onMounted(preparar)

function punto(evento: PointerEvent): { x: number, y: number } {
    const caja = lienzo.value?.getBoundingClientRect()
    return { x: (evento.clientX - (caja?.left ?? 0)) * escala, y: (evento.clientY - (caja?.top ?? 0)) * ((lienzo.value?.height ?? 200) / (caja?.height || 200)) }
}

function empezar(evento: PointerEvent) {
    if (props.disabled || !contexto) {
        return
    }
    dibujando = true
    lienzo.value?.setPointerCapture?.(evento.pointerId)
    const { x, y } = punto(evento)
    contexto.beginPath()
    contexto.moveTo(x, y)
    contexto.lineTo(x + 0.1, y + 0.1)
    contexto.stroke()
}

function mover(evento: PointerEvent) {
    if (!dibujando || !contexto) {
        return
    }
    const { x, y } = punto(evento)
    contexto.lineTo(x, y)
    contexto.stroke()
}

async function terminar() {
    if (!dibujando) {
        return
    }
    dibujando = false
    trazos += 1
    await capturar()
}

async function capturar() {
    const canvas = lienzo.value
    if (!canvas) {
        return
    }
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'))
    if (!blob) {
        error.value = 'El navegador no pudo generar la imagen de la firma'
        firma.value = null
        return
    }
    const resultado = await firmaDesdePng(new Uint8Array(await blob.arrayBuffer()))
    error.value = resultado.ok ? null : resultado.error
    firma.value = resultado.ok ? resultado.firma : null
}

function borrar() {
    if (contexto && lienzo.value) {
        contexto.clearRect(0, 0, lienzo.value.width, lienzo.value.height)
    }
    trazos = 0
    firma.value = null
    error.value = null
}

defineExpose({ borrar, trazos: () => trazos })
</script>

<template>
    <div class="flex flex-col gap-2">
        <div
            ref="contenedor"
            class="relative w-full overflow-hidden rounded-md border border-default bg-white"
        >
            <canvas
                ref="lienzo"
                class="block h-[200px] w-full touch-none"
                :class="disabled ? 'cursor-not-allowed opacity-60' : 'cursor-crosshair'"
                role="img"
                aria-label="Área de firma: firma con el dedo, el lápiz o el ratón"
                data-prueba="firma-lienzo"
                @pointerdown.prevent="empezar"
                @pointermove.prevent="mover"
                @pointerup="terminar"
                @pointerleave="terminar"
                @pointercancel="terminar"
            />
            <div class="pointer-events-none absolute inset-x-6 bottom-8 border-t border-dashed border-gray-400" />
            <span class="pointer-events-none absolute bottom-2 left-6 text-xs text-gray-500">{{ firmante ? `Firma de ${firmante}` : 'Firma de quien recibe' }}</span>
        </div>
        <div class="flex flex-wrap items-center justify-between gap-2">
            <span
                v-if="firma"
                class="font-mono text-xs text-muted"
                data-prueba="firma-huella"
            >
                {{ firma.ancho }}×{{ firma.alto }} px · {{ Math.max(1, Math.round(firma.bytes / 1024)) }} KB · SHA-256 {{ huellaCorta(firma.sha256) }}
            </span>
            <span
                v-else
                class="text-xs text-muted"
            >Sin firma todavía.</span>
            <UButton
                label="Borrar firma"
                icon="i-lucide-eraser"
                color="neutral"
                variant="ghost"
                size="xs"
                :disabled="disabled"
                data-prueba="firma-borrar"
                @click="borrar"
            />
        </div>
        <UAlert
            v-if="error"
            color="error"
            variant="subtle"
            icon="i-lucide-circle-alert"
            :title="error"
        />
    </div>
</template>
