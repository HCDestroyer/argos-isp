<script setup lang="ts">
import type { FormSubmitEvent } from '@nuxt/ui'
import type { Problem } from '@argosisp/contracts'

/**
 * Entrar al panel (tableros OperLogin y OperLoginMovil): fondo de la marca a todo lo ancho (color o
 * foto de Configuración → Apariencia) y la tarjeta a la derecha con logo, marca y eslogan; en el
 * teléfono, la tarjeta sobre una franja de color. Decisión 22: los botones «Iris» y «Horus» solo
 * aparecen si están conectados y «¿La olvidaste?» manda un enlace por correo; la API todavía no
 * publica ni las conexiones sin sesión ni el envío del enlace (A1, `.claude/integration/a4.md`):
 * mientras tanto no se muestran.
 */
definePageMeta({
    layout: false,
    publica: true,
})

useHead({ title: 'Iniciar sesión · ArgosIsp' })

const route = useRoute()
/** Marca, eslogan, logo y fondo de la instalación (`GET /apariencia/publica`, sin sesión). */
const tema = useTemaApariencia()
const marca = computed(() => tema.publica.value?.nombre_marca ?? 'ArgosIsp')
const eslogan = computed(() => tema.publica.value?.eslogan ?? null)
const logo = computed(() => tema.urlArchivo(tema.publica.value?.logo_login_url ?? null))
const fondo = computed(() => tema.urlArchivo(tema.publica.value?.fondo_login_url ?? null))
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
/**
 * Sistemas conectados para entrar desde ellos (Iris, Horus). Sin dato público de la API la lista
 * queda vacía y la sección «o entra desde» no se pinta: nunca se ofrece un botón que no funciona.
 */
const conectados: { nombre: string, url: string }[] = []
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
    <div
        class="relative min-h-dvh overflow-hidden bg-(--ax-fondo)"
        :style="fondo ? { backgroundImage: `linear-gradient(rgb(15 23 42 / 0.45), rgb(15 23 42 / 0.55)), url(${fondo})`, backgroundSize: 'cover', backgroundPosition: 'center' } : undefined"
    >
        <!-- Fondo de la marca: a todo lo ancho en escritorio; franja arriba en el teléfono. -->
        <div
            v-if="!fondo"
            class="bienvenida absolute inset-x-0 top-0 h-48 rounded-none rounded-b-[2.5rem] lg:inset-0 lg:h-auto lg:rounded-none"
            aria-hidden="true"
        />

        <div class="absolute top-4 right-4 z-10">
            <UColorModeButton class="boton-flotante boton-circulo" />
        </div>

        <main class="relative grid min-h-dvh lg:grid-cols-[minmax(0,1fr)_minmax(0,28rem)] lg:gap-10 lg:px-16 xl:px-24">
            <!-- Escritorio: la frase de la marca abajo a la izquierda. -->
            <section
                class="hidden flex-col justify-end pb-16 text-white lg:flex"
                :aria-label="marca"
            >
                <p class="max-w-lg text-[2.75rem] leading-tight font-bold tracking-[-0.03em]">
                    {{ eslogan ?? 'Todo tu ISP en un solo lugar.' }}
                </p>
                <p class="mt-3 text-lg text-white/85">
                    Clientes, cobros, red e inventario.
                </p>
            </section>

            <div class="flex flex-col items-center justify-start px-4 pt-28 pb-10 lg:justify-center lg:px-0 lg:pt-10">
                <div
                    class="w-full max-w-md rounded-[1.75rem] bg-(--ax-tarjeta) p-6 shadow-(--ax-sombra-flotante) ring ring-(--ax-borde) sm:p-8"
                    data-prueba="tarjeta-login"
                >
                    <div class="mb-6 flex items-center gap-3">
                        <img
                            v-if="logo"
                            :src="logo"
                            alt=""
                            class="h-12 max-w-32 rounded-xl object-contain"
                        >
                        <span
                            v-else
                            class="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-(image:--ax-gradiente) text-white shadow-lg"
                        >
                            <LogoArgos
                                variante="linea"
                                class="size-8"
                            />
                        </span>
                        <div class="flex min-w-0 flex-col">
                            <span class="truncate text-xl font-bold tracking-[-0.02em] text-highlighted">{{ marca }}</span>
                            <span
                                v-if="eslogan"
                                class="truncate text-[0.8125rem] text-muted"
                            >{{ eslogan }}</span>
                        </div>
                    </div>

                    <div class="mb-5">
                        <h1 class="text-2xl font-bold tracking-[-0.02em] text-highlighted">
                            Inicia sesión
                        </h1>
                        <p class="mt-0.5 text-sm text-muted">
                            Con el correo que te dio tu administrador
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
                                size="xl"
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
                                size="xl"
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
                            size="xl"
                            block
                            class="glow-brand mt-1 rounded-xl"
                            :loading="enviando"
                        />
                    </UForm>

                    <template v-if="conectados.length">
                        <USeparator
                            label="o entra desde"
                            class="my-5"
                            :ui="{ label: 'text-xs font-normal text-muted' }"
                        />
                        <div class="grid grid-cols-2 gap-3">
                            <UButton
                                v-for="sistema in conectados"
                                :key="sistema.nombre"
                                :to="sistema.url"
                                :label="sistema.nombre"
                                icon="i-lucide-link"
                                color="neutral"
                                variant="outline"
                                size="lg"
                                class="justify-center"
                            />
                        </div>
                    </template>

                    <p class="mt-5 text-center text-xs text-muted">
                        La sesión se cierra sola a los 3 días
                    </p>
                    <p
                        v-if="config.public.useFixtures"
                        class="mt-2 text-center text-xs text-muted"
                    >
                        Modo fixtures: admin@argos.test o cajero@argos.test, cualquier contraseña.
                    </p>
                </div>

                <p class="mt-6 text-center text-xs text-muted lg:text-white/80">
                    {{ marca === 'ArgosIsp' ? 'ArgosIsp' : `${marca} · con ArgosIsp` }}
                </p>
            </div>
        </main>
    </div>
</template>
