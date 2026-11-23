<script setup lang="ts">
import type { FormSubmitEvent } from '@nuxt/ui'
import type { Problem } from '@argosisp/contracts'

/**
 * Inicio de sesión (tableros OperLogin y OperLoginMovil, decisión 22 del PM): entrar, «¿La olvidaste?»
 * (pedir el enlace por correo), «Revisa tu correo» (misma respuesta exista o no el correo),
 * demasiadas solicitudes y la recuperación apagada por el admin. Los botones de Iris y Horus solo
 * aparecen si están conectados (`GET /auth/opciones`). `?recuperar=1` abre directo la recuperación
 * (desde el enlace vencido).
 */
definePageMeta({
    layout: false,
    publica: true,
})

useHead({ title: 'Iniciar sesión · ArgosIsp' })

const route = useRoute()
const { login } = useAuth()
const config = useRuntimeConfig()
const recuperacion = useRecuperacionContrasena()

type Vista = 'login' | 'recuperar' | 'enviado'
const vista = ref<Vista>(route.query.recuperar === '1' ? 'recuperar' : 'login')

/* Opciones públicas: si fallan, el login sigue (sin botones de Iris ni Horus y sin «¿La olvidaste?»). */
const opciones = shallowRef<OpcionesLogin | null>(null)
onMounted(async () => {
    const r = await recuperacion.opciones()
    opciones.value = r.ok ? r.data : null
})
const recuperarApagada = computed(() => opciones.value?.recuperar_contrasena === false)
const conectores = computed(() => [
    ...(opciones.value?.iris_url ? [{ id: 'iris', nombre: 'Iris', url: opciones.value.iris_url }] : []),
    ...(opciones.value?.horus_url ? [{ id: 'horus', nombre: 'Horus', url: opciones.value.horus_url }] : []),
])

/* Entrar */
const estado = reactive<Partial<DatosLogin>>({ email: '', password: '' })
const enviando = ref(false)
const problema = ref<Problem | null>(null)
const verClave = ref(false)
const ultimo = shallowRef<DatosLogin | null>(null)
const reintentable = computed(() => !problema.value || problema.value.status === undefined || problema.value.status === 0 || problema.value.status >= 500)

/** Cuenta regresiva del 429 `demasiados_intentos` (segundos del `detail`, como `Retry-After`). */
const esperaHasta = ref<number | null>(null)
const ahoraMs = ref(Date.now())
let reloj: ReturnType<typeof setInterval> | null = null
const restanteS = computed(() => (esperaHasta.value === null ? 0 : Math.max(0, Math.ceil((esperaHasta.value - ahoraMs.value) / 1000))))
const textoEspera = computed(() => `${Math.floor(restanteS.value / 60)}:${String(restanteS.value % 60).padStart(2, '0')} min`)

function empezarEspera(problemaLogin: Problem) {
    const s = /(\d+)\s*s\b/.exec(problemaLogin.detail ?? '')
    if (!s) {
        return
    }
    esperaHasta.value = Date.now() + Number(s[1]) * 1000
    ahoraMs.value = Date.now()
    reloj ??= setInterval(() => {
        ahoraMs.value = Date.now()
        if (restanteS.value === 0 && reloj) {
            clearInterval(reloj)
            reloj = null
            esperaHasta.value = null
        }
    }, 1000)
}

onBeforeUnmount(() => {
    if (reloj) {
        clearInterval(reloj)
    }
})

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
    if (resultado.problema.status === 429) {
        empezarEspera(resultado.problema)
    }
}

/* Recuperar */
const estadoRecuperar = reactive<Partial<DatosRecuperarContrasena>>({ email: '' })
const pidiendo = ref(false)
const problemaRecuperar = ref<Problem | null>(null)
const enviadoA = ref('')

function abrirRecuperar() {
    estadoRecuperar.email = estadoRecuperar.email || estado.email || ''
    problemaRecuperar.value = null
    vista.value = 'recuperar'
}

function volverAlLogin() {
    problemaRecuperar.value = null
    vista.value = 'login'
}

async function pedirEnlace(evento: FormSubmitEvent<DatosRecuperarContrasena>) {
    pidiendo.value = true
    problemaRecuperar.value = null
    const r = await recuperacion.pedirEnlace(evento.data.email)
    pidiendo.value = false
    if (r.ok) {
        enviadoA.value = evento.data.email
        vista.value = 'enviado'
        return
    }
    if (codigoProblema(r.problema) === 'recuperacion_apagada') {
        opciones.value = { ...(opciones.value ?? { iris: false, horus: false, iris_url: null, horus_url: null }), recuperar_contrasena: false }
    }
    problemaRecuperar.value = r.problema
}

const demasiadasSolicitudes = computed(() => problemaRecuperar.value !== null && codigoProblema(problemaRecuperar.value) === 'demasiadas_solicitudes')
</script>

<template>
    <LoginMarco id="tarjeta-login">
        <!-- Entrar -->
        <template v-if="vista === 'login'">
            <h1 class="text-2xl font-bold tracking-[-0.02em] text-highlighted">
                Inicia sesión
            </h1>
            <p class="mt-0.5 mb-5 text-sm text-muted">
                Con el correo que te dio tu administrador
            </p>

            <UForm
                :schema="esquemaLogin"
                :state="estado"
                class="flex flex-col gap-4"
                @submit="alEnviar"
            >
                <UAlert
                    v-if="problema && problema.status === 429"
                    color="warning"
                    variant="subtle"
                    icon="i-lucide-clock"
                    :title="restanteS > 0 ? `Demasiados intentos. Espera ${textoEspera} para volver a intentar.` : 'Demasiados intentos. Ya puedes volver a intentar.'"
                    data-prueba="login-bloqueado"
                />
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
                    <template
                        v-if="!recuperarApagada"
                        #hint
                    >
                        <UButton
                            label="¿La olvidaste?"
                            variant="link"
                            size="xs"
                            class="p-0 underline"
                            data-prueba="olvidaste"
                            @click="abrirRecuperar"
                        />
                    </template>
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
                    v-if="problema && problema.status !== 429"
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
                    size="lg"
                    block
                    class="glow-brand mt-1"
                    :loading="enviando"
                    :disabled="restanteS > 0"
                />
            </UForm>

            <template v-if="conectores.length">
                <USeparator
                    label="o entra desde"
                    class="my-4"
                    :ui="{ label: 'text-xs text-muted' }"
                />
                <div
                    class="grid gap-2"
                    :class="conectores.length > 1 ? 'grid-cols-2' : 'grid-cols-1'"
                    data-prueba="login-conectores"
                >
                    <UButton
                        v-for="c in conectores"
                        :key="c.id"
                        :label="c.nombre"
                        :href="c.url"
                        external
                        icon="i-lucide-link"
                        color="neutral"
                        variant="outline"
                        block
                        :data-conector="c.id"
                    />
                </div>
                <p class="mt-2 text-center text-xs text-muted">
                    Inicia sesión allí y usa «Abrir en Argos»: entras aquí sin escribir tu contraseña.
                </p>
            </template>

            <p class="mt-4 text-center text-xs text-muted">
                La sesión se cierra sola a los 3 días
            </p>
            <p
                v-if="config.public.useFixtures"
                class="mt-2 text-center text-xs text-muted"
            >
                Modo fixtures: admin@argos.test o cajero@argos.test, cualquier contraseña.
            </p>
        </template>

        <!-- ¿Olvidaste tu contraseña? (o apagada por el admin) -->
        <template v-else-if="vista === 'recuperar'">
            <h1 class="text-2xl font-bold tracking-[-0.02em] text-highlighted">
                ¿Olvidaste tu contraseña?
            </h1>
            <template v-if="recuperarApagada">
                <p
                    class="mt-1 mb-5 text-sm text-muted"
                    data-prueba="recuperacion-apagada"
                >
                    La recuperación por correo está apagada. Pide a tu administrador que te asigne una nueva desde Usuarios.
                </p>
                <UButton
                    label="Volver"
                    icon="i-lucide-chevron-left"
                    color="neutral"
                    variant="outline"
                    block
                    @click="volverAlLogin"
                />
            </template>
            <template v-else>
                <p class="mt-1 mb-5 text-sm text-muted">
                    Escribe tu correo y te mandamos un enlace para cambiarla. Vale una sola vez y por 30 minutos.
                </p>
                <UForm
                    :schema="esquemaRecuperarContrasena"
                    :state="estadoRecuperar"
                    class="flex flex-col gap-4"
                    @submit="pedirEnlace"
                >
                    <UAlert
                        v-if="demasiadasSolicitudes"
                        color="warning"
                        variant="subtle"
                        icon="i-lucide-clock"
                        title="Demasiadas solicitudes."
                        description="Espera unos minutos antes de pedir otro enlace."
                        data-prueba="recuperar-limite"
                    />
                    <ProblemaAlerta
                        v-else-if="problemaRecuperar"
                        :problema="problemaRecuperar"
                    />
                    <UFormField
                        name="email"
                        label="Correo"
                        required
                    >
                        <UInput
                            v-model="estadoRecuperar.email"
                            type="email"
                            autocomplete="username"
                            placeholder="usuario@empresa.gt"
                            icon="i-lucide-mail"
                            size="lg"
                            class="w-full"
                        />
                    </UFormField>
                    <UButton
                        type="submit"
                        label="Mandar enlace"
                        icon="i-lucide-send"
                        size="lg"
                        block
                        class="glow-brand"
                        :loading="pidiendo"
                        data-prueba="mandar-enlace"
                    />
                </UForm>
                <div class="mt-3 flex justify-center">
                    <UButton
                        label="Volver a iniciar sesión"
                        icon="i-lucide-chevron-left"
                        color="neutral"
                        variant="ghost"
                        @click="volverAlLogin"
                    />
                </div>
            </template>
        </template>

        <!-- Revisa tu correo: la misma respuesta exista o no la cuenta -->
        <div
            v-else
            class="flex flex-col items-center gap-3 text-center"
            data-prueba="recuperar-enviado"
        >
            <span class="flex size-12 items-center justify-center rounded-2xl bg-success/10 text-success">
                <UIcon
                    name="i-lucide-mail"
                    class="size-6"
                />
            </span>
            <h1 class="text-2xl font-bold tracking-[-0.02em] text-highlighted">
                Revisa tu correo
            </h1>
            <p class="text-sm text-muted">
                Si <b class="text-highlighted">{{ enviadoA }}</b> tiene cuenta en Argos, le llegó un enlace para cambiar la contraseña. Vence en 30 minutos. Revisa también el correo no deseado.
            </p>
            <UButton
                label="Volver a iniciar sesión"
                color="neutral"
                variant="outline"
                block
                @click="volverAlLogin"
            />
            <p class="text-xs text-muted">
                ¿No llegó?
                <UButton
                    label="Pedir otro"
                    variant="link"
                    size="xs"
                    class="p-0 underline"
                    @click="abrirRecuperar"
                />
            </p>
        </div>
    </LoginMarco>
</template>
