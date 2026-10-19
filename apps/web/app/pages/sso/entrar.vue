<script setup lang="ts">
import type { FormSubmitEvent } from '@nuxt/ui'
import type { Problem } from '@argosisp/contracts'

/**
 * Autologin desde Horus (`contratos/horus.md` §1.5, lado receptor de A1): Horus abre
 * `/sso/entrar#<ticket>`. El ticket va en el fragmento (el navegador no lo manda al servidor ni lo
 * deja en registros); aquí se borra de la URL antes de nada y se canjea una sola vez (60 s).
 * - Con vinculación: la API abre la sesión del usuario local (con **sus** permisos) y se va a la ruta.
 * - Sin vinculación: el login normal de ArgosIsp; al entrar, la API guarda la vinculación. Nunca se
 *   crea un usuario ni se vincula por correo.
 */
definePageMeta({
    layout: false,
    publica: true,
})

useHead({ title: 'Entrar desde Horus · ArgosIsp' })

const { canjear, vincular } = useSso()

type Fase = 'canjeando' | 'vincular' | 'error' | 'entrando'
const fase = ref<Fase>('canjeando')
const error = ref<{ titulo: string, detalle: string } | null>(null)
const vinculacion = shallowRef<NonNullable<CanjeSso['vinculacion']> | null>(null)

const estado = reactive<Partial<DatosLogin>>({ email: '', password: '' })
const enviando = ref(false)
const problemaLogin = ref<Problem | null>(null)

async function entrar(canje: CanjeSso) {
    fase.value = 'entrando'
    await navigateTo(rutaLocalSegura(canje.ruta), { replace: true })
}

onMounted(async () => {
    const ticket = ticketDelFragmento(window.location.hash)
    // El ticket sale de la URL (y del historial) antes de cualquier petición.
    window.history.replaceState(window.history.state, '', window.location.pathname + window.location.search)
    if (!ticket) {
        error.value = { titulo: 'Enlace incompleto', detalle: 'Abre de nuevo el registro desde Horus con "Ver en ArgosIsp".' }
        fase.value = 'error'
        return
    }
    const resultado = await canjear(ticket)
    if (!resultado.ok) {
        error.value = mensajeErrorSso(resultado.problema)
        fase.value = 'error'
        return
    }
    if (resultado.data.resultado === 'sesion') {
        await entrar(resultado.data)
        return
    }
    vinculacion.value = resultado.data.vinculacion
    fase.value = 'vincular'
})

async function alEnviar(evento: FormSubmitEvent<DatosLogin>) {
    if (!vinculacion.value) {
        return
    }
    enviando.value = true
    problemaLogin.value = null
    const resultado = await vincular({ token_vinculacion: vinculacion.value.token, ...evento.data })
    enviando.value = false
    if (resultado.ok) {
        await entrar(resultado.data)
        return
    }
    const { status } = resultado.problema
    if (status === 410) {
        error.value = mensajeErrorSso(resultado.problema)
        fase.value = 'error'
        return
    }
    const mensaje = mensajeErrorSso(resultado.problema)
    problemaLogin.value = { ...resultado.problema, title: mensaje.titulo, detail: mensaje.detalle }
}

const nombreExterno = computed(() => vinculacion.value?.usuario_externo.nombre ?? vinculacion.value?.usuario_externo.correo ?? vinculacion.value?.usuario_externo.id_externo ?? '')
</script>

<template>
    <div class="min-h-dvh">
        <div
            class="app-aura"
            aria-hidden="true"
        />
        <main class="relative flex min-h-dvh flex-col items-center justify-center gap-6 px-4 py-10">
            <div class="flex flex-col items-center gap-3 text-highlighted">
                <LogoArgos
                    variante="linea"
                    class="size-16 text-primary"
                />
                <span class="text-2xl font-semibold tracking-[-0.015em]">ArgosIsp</span>
            </div>

            <div
                class="surface-card w-full max-w-sm p-6"
                data-prueba="sso-entrar"
                :data-fase="fase"
            >
                <div
                    v-if="fase === 'canjeando' || fase === 'entrando'"
                    class="flex flex-col items-center gap-3 py-4 text-center"
                    role="status"
                >
                    <UIcon
                        name="i-lucide-loader-circle"
                        class="size-8 animate-spin text-muted motion-reduce:animate-none"
                    />
                    <p class="text-sm text-muted">
                        {{ fase === 'canjeando' ? 'Entrando desde Horus…' : 'Abriendo…' }}
                    </p>
                </div>

                <div
                    v-else-if="fase === 'error' && error"
                    class="flex flex-col gap-4"
                >
                    <UAlert
                        color="error"
                        variant="subtle"
                        icon="i-lucide-link-2-off"
                        :title="error.titulo"
                        :description="error.detalle"
                        data-prueba="sso-error"
                    />
                    <UButton
                        to="/login"
                        label="Iniciar sesión en ArgosIsp"
                        icon="i-lucide-log-in"
                        color="neutral"
                        variant="outline"
                        block
                    />
                </div>

                <template v-else-if="fase === 'vincular' && vinculacion">
                    <div class="mb-4 text-center">
                        <h1 class="text-xl font-semibold text-highlighted">
                            Vincula tu cuenta de Horus
                        </h1>
                    </div>
                    <UAlert
                        color="info"
                        variant="subtle"
                        icon="i-lucide-link"
                        :title="`Usuario de Horus: ${nombreExterno}`"
                        description="Inicia sesión con tu usuario de ArgosIsp. Desde ahora Horus te abrirá ArgosIsp con tus propios permisos, sin pedirte la contraseña."
                        class="mb-4"
                        data-prueba="sso-vincular"
                    />
                    <UForm
                        :schema="esquemaLogin"
                        :state="estado"
                        class="flex flex-col gap-4"
                        @submit="alEnviar"
                    >
                        <UFormField
                            name="email"
                            label="Correo de ArgosIsp"
                            required
                        >
                            <UInput
                                v-model="estado.email"
                                type="email"
                                autocomplete="username"
                                placeholder="usuario@empresa.gt"
                                icon="i-lucide-mail"
                                class="w-full"
                            />
                        </UFormField>
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
                                class="w-full"
                            />
                        </UFormField>
                        <UAlert
                            v-if="problemaLogin"
                            color="error"
                            variant="subtle"
                            icon="i-lucide-circle-alert"
                            :title="problemaLogin.title"
                            :description="problemaLogin.detail"
                        />
                        <UButton
                            type="submit"
                            label="Entrar y vincular"
                            block
                            class="glow-brand"
                            :loading="enviando"
                        />
                    </UForm>
                    <p class="mt-4 text-center text-xs text-muted">
                        La vinculación vence a las {{ formatearHora(vinculacion.expira_en) }}. Puedes quitarla en Mi cuenta.
                    </p>
                </template>
            </div>

            <UColorModeButton />
        </main>
    </div>
</template>
