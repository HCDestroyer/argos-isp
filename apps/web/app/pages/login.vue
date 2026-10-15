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
    <div class="flex min-h-dvh flex-col items-center justify-center gap-6 bg-default px-4 py-10">
        <div class="flex items-center gap-2 text-lg font-semibold text-highlighted">
            <UIcon
                name="i-lucide-radar"
                class="size-7 text-primary"
            />
            ArgosIsp
        </div>

        <UPageCard
            variant="subtle"
            class="w-full max-w-sm"
        >
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
                    :loading="enviando"
                />
            </UForm>

            <p
                v-if="config.public.useFixtures"
                class="mt-6 text-center text-xs text-muted"
            >
                Modo fixtures: admin@argos.test o cajero@argos.test, cualquier contraseña.
            </p>
        </UPageCard>

        <UColorModeButton />
    </div>
</template>
