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

function destino(): string {
    const redirect = route.query.redirect
    return typeof redirect === 'string' && redirect.startsWith('/') && !redirect.startsWith('//') ? redirect : '/'
}

async function alEnviar(evento: FormSubmitEvent<DatosLogin>) {
    enviando.value = true
    problema.value = null
    const resultado = await login(evento.data)
    enviando.value = false
    if (resultado.ok) {
        await navigateTo(destino(), { replace: true })
        return
    }
    problema.value = resultado.problema
}
</script>

<template>
    <div class="min-h-dvh">
        <div
            class="app-aura"
            aria-hidden="true"
        />
        <!-- `relative` para quedar sobre el aura (que es `fixed`). -->
        <main class="relative flex min-h-dvh flex-col items-center justify-center gap-6 px-4 py-10">
            <div class="flex flex-col items-center gap-3 text-highlighted">
                <LogoArgos
                    variante="linea"
                    class="size-16 text-primary"
                />
                <span class="text-2xl font-semibold tracking-[-0.015em]">ArgosIsp</span>
            </div>

            <div class="surface-card w-full max-w-sm p-6">
                <div class="mb-6 text-center">
                    <h1 class="text-xl font-semibold text-highlighted">
                        Iniciar sesión
                    </h1>
                    <p class="mt-1 text-sm text-muted">
                        Panel de administración
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
                        v-if="problema"
                        color="error"
                        variant="subtle"
                        icon="i-lucide-circle-alert"
                        :title="problema.title"
                        :description="problema.detail"
                    />

                    <UButton
                        type="submit"
                        label="Entrar"
                        block
                        class="glow-brand"
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

            <UColorModeButton />
        </main>
    </div>
</template>
