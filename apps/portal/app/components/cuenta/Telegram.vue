<script setup lang="ts">
/**
 * Vincular Telegram desde "Mis datos". Pide un enlace de un solo uso al bot, lo ofrece como botón
 * "Abrir Telegram" (un enlace real: los navegadores del teléfono bloquean `window.open` después de
 * un `await`) y consulta cada 3 s hasta que el bot lo canjea. Al cambiar el vínculo avisa al
 * padre para que recargue el contacto (la API sube `version` y puede cambiar el canal preferido).
 */
const props = withDefaults(defineProps<{
    vinculado: boolean
    intervaloMs?: number
}>(), {
    intervaloMs: 3_000,
})

const emit = defineEmits<{
    cambio: [vinculado: boolean]
}>()

const telegram = useTelegram({ intervaloMs: props.intervaloMs })
const toast = useToast()

const enlace = ref<VinculoTelegram | null>(null)
const generando = ref(false)
const quitando = ref(false)
const confirmarQuitar = ref(false)
const error = ref<string | null>(null)

const vinculado = computed(() => telegram.estado.value?.vinculado ?? props.vinculado)
const disponible = computed(() => telegram.estado.value?.disponible ?? false)
/** Se pidió un código y dejó de esperarse sin vincular: venció. */
const enlaceVencido = computed(() => enlace.value !== null && !telegram.esperando.value && !vinculado.value)
/** Recargó la página con un código vigente: se sigue esperando, aunque el código ya no se muestra. */
const reanudado = ref(false)

onMounted(async () => {
    const resultado = await telegram.cargar()
    if (resultado.ok && !resultado.data.vinculado) {
        reanudado.value = telegram.reanudar()
    }
})

watch(() => telegram.esperando.value, (actual) => {
    if (!actual) {
        reanudado.value = false
    }
})

watch(vinculado, (actual, anterior) => {
    if (actual === anterior) {
        return
    }
    if (actual) {
        enlace.value = null
        toast.add({ title: 'Telegram vinculado', description: 'Te avisaremos también por Telegram.', icon: 'i-lucide-check', color: 'success' })
    }
    emit('cambio', actual)
})

async function generar() {
    generando.value = true
    error.value = null
    const resultado = await telegram.vincular()
    generando.value = false
    if (!resultado.ok) {
        error.value = mensajeProblema(resultado.problema)
        return
    }
    enlace.value = resultado.data
    reanudado.value = false
}

async function quitar() {
    quitando.value = true
    error.value = null
    const resultado = await telegram.desvincular()
    quitando.value = false
    confirmarQuitar.value = false
    if (!resultado.ok) {
        error.value = mensajeProblema(resultado.problema)
        return
    }
    enlace.value = null
    toast.add({ title: 'Telegram desvinculado', icon: 'i-lucide-check', color: 'neutral' })
}
</script>

<template>
    <section
        class="flex flex-col gap-3 rounded-lg border border-default p-3"
        aria-labelledby="titulo-telegram"
        data-testid="telegram"
    >
        <div class="flex items-center justify-between gap-3">
            <h2
                id="titulo-telegram"
                class="flex items-center gap-2 text-sm font-semibold text-highlighted"
            >
                <UIcon
                    name="i-lucide-send"
                    class="size-4 text-primary"
                    aria-hidden="true"
                />
                Telegram
            </h2>
            <UBadge
                v-if="vinculado"
                label="Vinculado"
                icon="i-lucide-check"
                color="success"
                variant="subtle"
                data-testid="telegram-vinculado"
            />
        </div>

        <UAlert
            v-if="error"
            color="error"
            variant="subtle"
            icon="i-lucide-circle-alert"
            :title="error"
        />

        <template v-if="vinculado">
            <p class="text-sm text-muted">
                Recibes tus avisos de cobro y pagos en Telegram. Puedes elegirlo como canal preferido abajo.
            </p>
            <UButton
                label="Desvincular Telegram"
                icon="i-lucide-unlink"
                color="neutral"
                variant="outline"
                size="lg"
                block
                data-testid="telegram-desvincular"
                @click="confirmarQuitar = true"
            />
        </template>

        <template v-else-if="enlace && !enlaceVencido">
            <p class="text-sm text-default">
                Abre el chat con <span class="font-medium">@{{ enlace.bot }}</span> y pulsa
                <span class="font-medium">Iniciar</span>. Esta pantalla se actualiza sola.
            </p>
            <UButton
                :to="enlace.enlace"
                target="_blank"
                external
                label="Abrir Telegram"
                icon="i-lucide-external-link"
                size="lg"
                block
                data-testid="telegram-abrir"
            />
            <p
                class="flex items-center gap-2 text-xs text-muted"
                role="status"
            >
                <UIcon
                    v-if="telegram.esperando.value"
                    name="i-lucide-loader-circle"
                    class="size-4 animate-spin"
                    aria-hidden="true"
                />
                Esperando la confirmación del bot. El código vence el {{ formatearFechaHora(enlace.vence_en) }}.
            </p>
            <p class="text-xs text-muted">
                ¿No se abrió? Busca <span class="font-medium">@{{ enlace.bot }}</span> en Telegram y envíale
                <span
                    class="font-mono font-medium text-highlighted"
                    data-testid="telegram-codigo"
                >/start {{ enlace.codigo }}</span>
            </p>
        </template>

        <template v-else-if="reanudado">
            <p
                class="flex items-center gap-2 text-sm text-muted"
                role="status"
            >
                <UIcon
                    name="i-lucide-loader-circle"
                    class="size-4 animate-spin"
                    aria-hidden="true"
                />
                Esperando la confirmación del bot de Telegram.
            </p>
            <UButton
                label="Generar otro enlace"
                icon="i-lucide-refresh-cw"
                color="neutral"
                variant="outline"
                size="lg"
                block
                :loading="generando"
                @click="generar"
            />
        </template>

        <template v-else>
            <p class="text-sm text-muted">
                {{ enlaceVencido
                    ? 'El código venció sin confirmarse. Genera uno nuevo.'
                    : 'Recibe tus avisos de cobro y pagos en Telegram. Te llevamos al chat con nuestro bot.' }}
            </p>
            <UButton
                label="Vincular Telegram"
                icon="i-lucide-send"
                size="lg"
                block
                :loading="generando"
                :disabled="!disponible"
                data-testid="telegram-vincular"
                @click="generar"
            />
            <p
                v-if="telegram.estado.value && !disponible"
                class="text-xs text-muted"
            >
                La vinculación con Telegram aún no está disponible.
            </p>
        </template>

        <UModal
            v-model:open="confirmarQuitar"
            title="¿Desvincular Telegram?"
            description="Dejarás de recibir avisos por Telegram. Si era tu canal preferido, te avisaremos por correo."
        >
            <template #footer>
                <div class="flex w-full flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                    <UButton
                        label="Cancelar"
                        color="neutral"
                        variant="ghost"
                        size="lg"
                        @click="confirmarQuitar = false"
                    />
                    <UButton
                        label="Desvincular"
                        color="error"
                        size="lg"
                        :loading="quitando"
                        data-testid="telegram-confirmar-desvincular"
                        @click="quitar"
                    />
                </div>
            </template>
        </UModal>
    </section>
</template>
