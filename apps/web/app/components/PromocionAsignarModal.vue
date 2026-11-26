<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'

/**
 * «Asignar servicios» a una promoción (tablero PendPromociones, ventana `asig`):
 * `POST /promociones-velocidad/:id/servicios` (`promociones_velocidad.asignar`). Todo o nada: si
 * uno de los elegidos no puede recibirla, la API responde 422 con la regla y aquí se marca cuál y
 * por qué; no se asigna ninguno. Una `Idempotency-Key` por apertura.
 */
const props = defineProps<{
    promocion: PromocionVelocidad
    /** Los que ya la tienen (salen marcados y deshabilitados). */
    yaAsignados: number[]
}>()

const abierto = defineModel<boolean>('open', { default: false })

const emit = defineEmits<{
    hecho: [promocion: PromocionVelocidad, asignados: number]
}>()

const elegidos = ref<Servicio[]>([])
const enviando = ref(false)
const problema = ref<Problem | null>(null)
const falla = computed(() => (problema.value ? fallaPromocion(problema.value) : null))
let claveIdempotencia = nuevaClaveIdempotencia()

watch(abierto, (valor) => {
    if (valor) {
        elegidos.value = []
        problema.value = null
        claveIdempotencia = nuevaClaveIdempotencia()
    }
})

// Cambiar la lista es otro intento: otra clave.
watch(elegidos, () => {
    claveIdempotencia = nuevaClaveIdempotencia()
})

async function asignar() {
    if (!elegidos.value.length) {
        return
    }
    enviando.value = true
    problema.value = null
    const resultado = await usePromocionesVelocidad().asignar(props.promocion.id, elegidos.value.map(s => s.id), claveIdempotencia)
    enviando.value = false
    if (resultado.ok) {
        const cuantos = elegidos.value.length
        abierto.value = false
        emit('hecho', resultado.data, cuantos)
        return
    }
    problema.value = resultado.problema
}
</script>

<template>
    <UModal
        v-model:open="abierto"
        :title="`Asignar «${promocion.nombre}»`"
        description="Elige los servicios que reciben la promoción."
        :dismissible="!enviando"
        :ui="{ content: 'sm:max-w-lg' }"
    >
        <template #title>
            <ModalTitulo
                :texto="`Asignar «${promocion.nombre}»`"
                icono="i-lucide-plus"
                tipo="info"
            />
        </template>
        <template #body>
            <div class="flex flex-col gap-4">
                <PromocionServiciosElegir
                    v-model="elegidos"
                    :ya-asignados="yaAsignados"
                    :falla="falla && falla.servicioId !== null ? { servicioId: falla.servicioId, titulo: falla.titulo, ayuda: falla.ayuda } : null"
                />

                <UAlert
                    v-if="falla"
                    color="error"
                    variant="subtle"
                    icon="i-lucide-triangle-alert"
                    :title="falla.titulo"
                    :description="`${falla.detalle} No se asignó ninguno.`"
                    data-prueba="falla-asignar"
                />
                <ProblemaAlerta
                    v-else-if="problema"
                    :problema="problema"
                />
                <UAlert
                    color="primary"
                    variant="subtle"
                    icon="i-lucide-info"
                    description="Todo o nada: si uno de los elegidos no puede recibirla, no se asigna ninguno y te decimos cuál y por qué. Si el horario ya empezó, la velocidad sube al guardar."
                />
            </div>
        </template>
        <template #footer>
            <div class="flex w-full items-center gap-2">
                <span class="text-sm text-muted">{{ elegidos.length === 1 ? '1 elegido' : `${elegidos.length} elegidos` }}</span>
                <UButton
                    label="Cancelar"
                    color="neutral"
                    variant="ghost"
                    class="ms-auto"
                    :disabled="enviando"
                    @click="abierto = false"
                />
                <UButton
                    :label="elegidos.length ? `Asignar ${elegidos.length}` : 'Asignar'"
                    :icon="ICONOS.guardar"
                    class="rounded-full"
                    :loading="enviando"
                    :disabled="!elegidos.length"
                    data-prueba="confirmar-asignar"
                    @click="asignar"
                />
            </div>
        </template>
    </UModal>
</template>
