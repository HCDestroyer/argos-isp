<script setup lang="ts">
import type { FormSubmitEvent } from '@nuxt/ui'
import type { Problem } from '@argosisp/contracts'

/**
 * Ventana de bloqueo de la sesión vencida (decisión del PM, semana 3, tanda 3). Se abre con un
 * 401 `sesion_expirada` (`plugins/sesion.ts`) y no se cierra con Esc ni con clic fuera: la página
 * de debajo sigue montada con sus filtros y formularios. Solo pide la contraseña del usuario de
 * la sesión; al desbloquear se repiten las peticiones que fallaron.
 */
const bloqueada = useSesionBloqueada()
const usuario = useUsuarioActual()
const { desbloquear, salir } = useAuth()

const estado = reactive<Partial<DatosDesbloqueo>>({ password: '' })
const enviando = ref(false)
const saliendo = ref(false)
const problema = ref<Problem | null>(null)
/** Con 429: hasta cuándo no se puede volver a intentar (ms desde epoch). */
const esperarHasta = ref<number | null>(null)
const ahora = ref(Date.now())
let reloj: ReturnType<typeof setInterval> | null = null

const segundosRestantes = computed(() => esperarHasta.value === null
    ? 0
    : Math.max(0, Math.ceil((esperarHasta.value - ahora.value) / 1000)))

function detenerReloj(): void {
    if (reloj) {
        clearInterval(reloj)
        reloj = null
    }
}

function iniciarEspera(segundos: number): void {
    esperarHasta.value = Date.now() + segundos * 1000
    ahora.value = Date.now()
    detenerReloj()
    reloj = setInterval(() => {
        ahora.value = Date.now()
        if (segundosRestantes.value === 0) {
            detenerReloj()
            esperarHasta.value = null
        }
    }, 1000)
}

watch(bloqueada, (abierta) => {
    if (abierta) {
        estado.password = ''
        problema.value = null
    }
})

onBeforeUnmount(detenerReloj)

async function alEnviar(evento: FormSubmitEvent<DatosDesbloqueo>): Promise<void> {
    enviando.value = true
    problema.value = null
    const resultado = await desbloquear(evento.data.password)
    enviando.value = false
    if (resultado.ok) {
        estado.password = ''
        return
    }
    if (resultado.motivo === 'credenciales') {
        problema.value = resultado.problema
        if (resultado.esperarS) {
            iniciarEspera(resultado.esperarS)
        }
    }
}

async function noSoyYo(): Promise<void> {
    saliendo.value = true
    await salir()
    saliendo.value = false
}
</script>

<template>
    <UModal
        :open="bloqueada && usuario !== null"
        fullscreen
        :dismissible="false"
        :close="false"
        title="Sesión bloqueada"
        description="Tu sesión expiró. Escribe tu contraseña para seguir donde estabas."
        :ui="{
            // Por encima de cualquier modal o panel lateral abierto (un alta a medias, por ejemplo).
            overlay: 'z-[70]',
            content: 'z-[71]',
            body: 'flex items-center justify-center',
        }"
    >
        <template #body>
            <div class="flex w-full max-w-sm flex-col gap-6">
                <div class="flex items-center gap-3">
                    <UAvatar
                        :alt="usuario?.nombre"
                        size="lg"
                    />
                    <div class="min-w-0">
                        <p class="truncate font-medium text-highlighted">
                            {{ usuario?.nombre }}
                        </p>
                        <p class="truncate text-sm text-muted">
                            {{ usuario?.email }}
                        </p>
                    </div>
                </div>

                <UForm
                    :schema="esquemaDesbloqueo"
                    :state="estado"
                    class="flex flex-col gap-4"
                    @submit="alEnviar"
                >
                    <UFormField
                        name="password"
                        label="Contraseña"
                        required
                    >
                        <UInput
                            v-model="estado.password"
                            type="password"
                            autocomplete="current-password"
                            icon="i-lucide-lock"
                            autofocus
                            class="w-full"
                        />
                    </UFormField>

                    <UAlert
                        v-if="problema"
                        color="error"
                        variant="subtle"
                        icon="i-lucide-circle-alert"
                        :title="problema.title"
                        :description="segundosRestantes > 0 ? `Espera ${segundosRestantes} s para volver a intentar.` : problema.detail"
                    />

                    <UButton
                        type="submit"
                        label="Desbloquear"
                        icon="i-lucide-lock-open"
                        block
                        :loading="enviando"
                        :disabled="segundosRestantes > 0 || saliendo"
                    />

                    <UButton
                        label="No soy yo / Salir"
                        variant="link"
                        color="neutral"
                        class="self-center"
                        :loading="saliendo"
                        :disabled="enviando"
                        @click="noSoyYo"
                    />
                </UForm>
            </div>
        </template>
    </UModal>
</template>
