<script setup lang="ts">
import type { FormSubmitEvent } from '@nuxt/ui'
import type { Problem } from '@argosisp/contracts'

/**
 * Cambiar la contraseña con el enlace del correo (tableros OperLogin y OperLoginMovil, decisión 22
 * del PM): `<panel>/restablecer-contrasena#token=…` (el token va en el fragmento: no llega a ningún
 * servidor ni queda en registros). Nueva contraseña → «Contraseña cambiada» (cierra todas las
 * sesiones); un enlace usado o vencido (422 `enlace_invalido`) muestra «El enlace ya no sirve».
 */
definePageMeta({
    layout: false,
    publica: true,
})

useHead({ title: 'Nueva contraseña · ArgosIsp' })

type Vista = 'nueva' | 'listo' | 'invalido'
const vista = ref<Vista>('nueva')

const token = ref<string | null>(null)

/** Lee el token del fragmento y lo saca de la barra de direcciones (y del historial). */
function leerToken() {
    if (!window.location.hash) {
        return
    }
    const valor = new URLSearchParams(window.location.hash.replace(/^#/, '')).get('token')
    token.value = valor && valor.length >= 20 ? valor : ''
    vista.value = 'nueva'
    history.replaceState(history.state, '', window.location.pathname)
}

onMounted(() => {
    leerToken()
    token.value ??= ''
    // Otro enlace abierto en la misma pestaña solo cambia el fragmento: no recarga la página.
    window.addEventListener('hashchange', leerToken)
})
onBeforeUnmount(() => window.removeEventListener('hashchange', leerToken))
const enlaceInvalido = computed(() => vista.value === 'invalido' || token.value === '')

const estado = reactive<Partial<DatosRestablecerContrasena>>({ password: '', repetir: '' })
watch(token, () => Object.assign(estado, { password: '', repetir: '' }))
const verClave = ref(false)
const enviando = ref(false)
const problema = ref<Problem | null>(null)
const sesionesCerradas = ref(0)
const largoOk = computed(() => (estado.password ?? '').length >= 8)

async function guardar(evento: FormSubmitEvent<DatosRestablecerContrasena>) {
    if (!token.value) {
        return
    }
    enviando.value = true
    problema.value = null
    const r = await useRecuperacionContrasena().restablecer(token.value, evento.data.password)
    enviando.value = false
    if (r.ok) {
        sesionesCerradas.value = r.data.sesiones_cerradas
        vista.value = 'listo'
        return
    }
    if (codigoProblema(r.problema) === 'enlace_invalido') {
        vista.value = 'invalido'
        return
    }
    problema.value = r.problema
}
</script>

<template>
    <LoginMarco id="tarjeta-restablecer">
        <USkeleton
            v-if="token === null"
            class="h-48 w-full"
        />

        <div
            v-else-if="enlaceInvalido"
            class="flex flex-col items-center gap-3 text-center"
            data-prueba="enlace-invalido"
        >
            <span class="flex size-12 items-center justify-center rounded-2xl bg-warning/10 text-warning">
                <UIcon
                    name="i-lucide-triangle-alert"
                    class="size-6"
                />
            </span>
            <h1 class="text-2xl font-bold tracking-[-0.02em] text-highlighted">
                El enlace ya no sirve
            </h1>
            <p class="text-sm text-muted">
                Ya se usó o pasaron más de 30 minutos. Pide otro: el nuevo anula los anteriores.
            </p>
            <UButton
                label="Pedir otro enlace"
                size="lg"
                block
                class="glow-brand"
                to="/login?recuperar=1"
            />
        </div>

        <div
            v-else-if="vista === 'listo'"
            class="flex flex-col items-center gap-3 text-center"
            data-prueba="contrasena-cambiada"
        >
            <span class="flex size-12 items-center justify-center rounded-2xl bg-success/10 text-success">
                <UIcon
                    name="i-lucide-check"
                    class="size-6"
                />
            </span>
            <h1 class="text-2xl font-bold tracking-[-0.02em] text-highlighted">
                Contraseña cambiada
            </h1>
            <p class="text-sm text-muted">
                {{ sesionesCerradas === 1 ? 'Cerramos tu sesión abierta.' : sesionesCerradas > 1 ? `Cerramos tus ${sesionesCerradas} sesiones abiertas.` : 'No tenías sesiones abiertas.' }} Entra con la contraseña nueva.
            </p>
            <UButton
                label="Iniciar sesión"
                size="lg"
                block
                class="glow-brand"
                to="/login"
            />
        </div>

        <template v-else>
            <h1 class="text-2xl font-bold tracking-[-0.02em] text-highlighted">
                Nueva contraseña
            </h1>
            <p class="mt-0.5 mb-5 text-sm text-muted">
                Escríbela dos veces. Al menos 8 caracteres.
            </p>
            <UForm
                :schema="esquemaRestablecerContrasena"
                :state="estado"
                class="flex flex-col gap-4"
                @submit="guardar"
            >
                <UFormField
                    name="password"
                    label="Contraseña nueva"
                    required
                >
                    <UInput
                        v-model="estado.password"
                        :type="verClave ? 'text' : 'password'"
                        autocomplete="new-password"
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
                                @click="verClave = !verClave"
                            />
                        </template>
                    </UInput>
                    <template #help>
                        <span
                            class="inline-flex items-center gap-1"
                            :class="largoOk ? 'text-success' : 'text-muted'"
                        >
                            <UIcon
                                :name="largoOk ? 'i-lucide-check' : 'i-lucide-circle'"
                                class="size-3.5"
                            />
                            Al menos 8 caracteres
                        </span>
                    </template>
                </UFormField>
                <UFormField
                    name="repetir"
                    label="Escríbela otra vez"
                    required
                >
                    <UInput
                        v-model="estado.repetir"
                        :type="verClave ? 'text' : 'password'"
                        autocomplete="new-password"
                        icon="i-lucide-lock"
                        size="lg"
                        class="w-full"
                    />
                </UFormField>
                <UAlert
                    color="primary"
                    variant="subtle"
                    icon="i-lucide-info"
                    description="Al guardarla se cierran todas tus sesiones abiertas, en todos los equipos."
                />
                <ProblemaAlerta
                    v-if="problema"
                    :problema="problema"
                />
                <UButton
                    type="submit"
                    label="Guardar contraseña"
                    size="lg"
                    block
                    class="glow-brand"
                    :loading="enviando"
                    data-prueba="guardar-contrasena"
                />
            </UForm>
        </template>
    </LoginMarco>
</template>
