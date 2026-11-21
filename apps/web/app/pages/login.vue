<script setup lang="ts">
import type { FormSubmitEvent } from '@nuxt/ui'
import type { Problem } from '@argosisp/contracts'

definePageMeta({
    layout: false,
    publica: true,
})

useHead({ title: 'Iniciar sesión · ArgosIsp' })

const route = useRoute()
const { login } = useAuth()
const config = useRuntimeConfig()

const estado = reactive<Partial<DatosLogin>>({
    email: '',
    password: '',
})
const enviando = ref(false)
const problema = ref<Problem | null>(null)
/** Contraseña a la vista (botón del ojo). */
const verClave = ref(false)
/** Últimos datos enviados, para «Reintentar» tras un error de red o del servidor. */
const ultimo = shallowRef<DatosLogin | null>(null)
const reintentable = computed(() => !problema.value || problema.value.status === undefined || problema.value.status === 0 || problema.value.status >= 500)

function destino(): string {
    const redirect = route.query.redirect
    return typeof redirect === 'string' && redirect.startsWith('/') && !redirect.startsWith('//') ? redirect : '/'
}

async function alEnviar(evento: FormSubmitEvent<DatosLogin>) {
    await entrarCon(evento.data)
}

async function entrarCon(datos: DatosLogin) {
    ultimo.value = datos
    enviando.value = true
    problema.value = null
    const resultado = await login(datos)
    enviando.value = false
    if (resultado.ok) {
        await navigateTo(destino(), { replace: true })
        return
    }
    problema.value = resultado.problema
}
</script>

<template>
    <div class="min-h-dvh bg-(--ax-fondo)">
        <!-- Escritorio: marca a la izquierda (degradado índigo → cian) y formulario a la derecha;
             en el teléfono, solo el formulario con el logo arriba. -->
        <main class="grid min-h-dvh lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
            <section
                class="bienvenida relative hidden flex-col justify-between overflow-hidden rounded-none p-10 text-white lg:flex"
                aria-label="ArgosIsp"
            >
                <div class="flex items-center gap-3">
                    <span class="flex size-11 items-center justify-center rounded-xl bg-white/15 ring ring-white/30">
                        <LogoArgos
                            variante="linea"
                            class="size-8"
                        />
                    </span>
                    <span class="text-2xl font-bold tracking-[-0.02em]">ArgosIsp</span>
                </div>
                <div class="relative flex max-w-md flex-col gap-3">
                    <p class="text-3xl leading-tight font-bold tracking-[-0.02em]">
                        Tu red, tus clientes y tu cobro, en un solo lugar.
                    </p>
                    <p class="text-base text-white/90">
                        Clientes y servicios PPPoE, facturación con su libro contable, cobros y corte automático.
                    </p>
                </div>
                <svg
                    class="pointer-events-none absolute -right-16 -bottom-16 h-96 opacity-25"
                    viewBox="0 0 64 64"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    aria-hidden="true"
                >
                    <path d="M5 42 C14.5 27 49.5 27 59 42 C49.5 57 14.5 57 5 42 Z" />
                    <circle
                        cx="32"
                        cy="42"
                        r="6.4"
                    />
                    <path d="M22.75 25.98 A18.5 18.5 0 0 1 41.25 25.98" />
                    <path d="M19.12 20.57 A25 25 0 0 1 44.88 20.57" />
                    <path d="M15.31 15.29 A31.5 31.5 0 0 1 48.69 15.29" />
                </svg>
                <p class="relative text-xs text-white/80">
                    Panel de administración
                </p>
            </section>

            <div class="relative flex flex-col items-center justify-center gap-6 px-4 py-10">
                <div class="absolute top-4 right-4">
                    <UColorModeButton />
                </div>
                <div class="flex flex-col items-center gap-2 lg:hidden">
                    <LogoArgos class="size-14" />
                    <span class="text-xl font-bold tracking-[-0.02em] text-highlighted">ArgosIsp</span>
                </div>

                <div class="surface-card w-full max-w-md p-6 sm:p-8">
                    <div class="mb-6">
                        <h1 class="text-2xl font-bold tracking-[-0.02em] text-highlighted">
                            Iniciar sesión
                        </h1>
                        <p class="mt-1 text-sm text-muted">
                            Entra con el correo que te dio tu administrador.
                        </p>
                    </div>

                    <UForm
                        :schema="esquemaLogin"
                        :state="estado"
                        class="flex flex-col gap-4"
                        @submit="alEnviar"
                    >
                        <UFormField
                            name="email"
                            label="Correo"
                            required
                        >
                            <UInput
                                v-model="estado.email"
                                type="email"
                                autocomplete="username"
                                placeholder="usuario@empresa.gt"
                                icon="i-lucide-mail"
                                size="lg"
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
                                :type="verClave ? 'text' : 'password'"
                                autocomplete="current-password"
                                icon="i-lucide-lock"
                                size="lg"
                                class="w-full"
                                :ui="{ trailing: 'pe-1' }"
                            >
                                <template #trailing>
                                    <UButton
                                        :icon="verClave ? 'i-lucide-eye-off' : 'i-lucide-eye'"
                                        color="neutral"
                                        variant="link"
                                        size="sm"
                                        :aria-label="verClave ? 'Ocultar lo escrito' : 'Mostrar lo escrito'"
                                        :aria-pressed="verClave"
                                        :title="verClave ? 'Ocultar lo escrito' : 'Mostrar lo escrito'"
                                        @click="verClave = !verClave"
                                    />
                                </template>
                            </UInput>
                        </UFormField>

                        <UAlert
                            v-if="problema"
                            color="error"
                            variant="subtle"
                            icon="i-lucide-circle-alert"
                            :title="problema.title"
                            :description="problema.detail"
                            :actions="reintentable && ultimo ? [{ label: 'Reintentar', icon: 'i-lucide-refresh-cw', color: 'error', variant: 'outline', onClick: () => { if (ultimo) void entrarCon(ultimo) } }] : undefined"
                            data-prueba="error-login"
                        />

                        <UButton
                            type="submit"
                            label="Entrar"
                            icon="i-lucide-log-in"
                            size="lg"
                            block
                            class="glow-brand mt-1"
                            :loading="enviando"
                        />
                    </UForm>

                    <p
                        v-if="config.public.useFixtures"
                        class="mt-6 text-center text-xs text-muted"
                    >
                        Modo fixtures: admin@argos.test o cajero@argos.test, cualquier contraseña.
                    </p>
                </div>
            </div>
        </main>
    </div>
</template>
