<script setup lang="ts">
import type { FormSubmitEvent } from '@nuxt/ui'
import type { Problem } from '@argosisp/contracts'

/**
 * Autologin desde Horus o Iris (`contratos/horus.md` §1.5, lado receptor de A1): el otro sistema abre
 * `/sso/entrar#<ticket>`. El ticket va en el fragmento (el navegador no lo manda al servidor ni lo
 * deja en registros); aquí se borra de la URL antes de nada y se canjea una sola vez (60 s).
 * - Con vinculación: la API abre la sesión del usuario local (con **sus** permisos) y se va a la ruta.
 * - Sin vinculación: el login normal de ArgosIsp; al entrar, la API guarda la vinculación. Nunca se
 *   crea un usuario ni se vincula por correo. Antes del login se muestra a quién se le da acceso
 *   (sistema, nombre, correo e instalación) con un aviso: un enlace reenviado por otra persona no
 *   debe vincularse a la cuenta de quien lo abre.
 */
definePageMeta({
    layout: false,
    publica: true,
})

const { canjear, vincular } = useSso()

type Fase = 'canjeando' | 'vincular' | 'error' | 'entrando'
const fase = ref<Fase>('canjeando')
const error = ref<{ titulo: string, detalle: string } | null>(null)
const vinculacion = shallowRef<NonNullable<CanjeSso['vinculacion']> | null>(null)
const conector = ref<string | null>(null)
const sistema = computed(() => nombreSistemaSso(conector.value))

useHead({ title: () => (conector.value ? `Entrar desde ${sistema.value} · ArgosIsp` : 'Entrar · ArgosIsp') })

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
        error.value = { titulo: 'Enlace incompleto', detalle: 'Abre de nuevo el registro con "Ver en ArgosIsp" desde el sistema donde estabas (Horus o Iris).' }
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
    conector.value = resultado.data.conector
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

/** Datos de la persona del otro sistema; el id externo solo cuando el ticket no trajo nombre ni correo. */
const datosExternos = computed(() => {
    const externo = vinculacion.value?.usuario_externo
    if (!externo) {
        return []
    }
    const filas: { clave: string, etiqueta: string, valor: string, informado: boolean, mono: boolean }[] = [
        { clave: 'nombre', etiqueta: 'Nombre', valor: externo.nombre ?? 'nombre no informado', informado: externo.nombre !== null, mono: false },
        { clave: 'correo', etiqueta: 'Correo', valor: externo.correo ?? 'correo no informado', informado: externo.correo !== null, mono: false },
    ]
    if (externo.nombre === null && externo.correo === null) {
        filas.push({ clave: 'id_externo', etiqueta: `Usuario en ${sistema.value}`, valor: externo.id_externo, informado: true, mono: true })
    }
    const instalacion = vinculacion.value?.instalacion ?? null
    filas.push({ clave: 'instalacion', etiqueta: 'Instalación', valor: instalacion ?? 'instalación no informada', informado: instalacion !== null, mono: instalacion !== null })
    return filas
})
</script>

<template>
    <div class="relative min-h-dvh overflow-hidden bg-(--ax-fondo)">
        <!-- Mismo marco que el login (tableros OperLogin y OperLoginMovil). -->
        <div
            class="bienvenida absolute inset-x-0 top-0 h-48 rounded-none rounded-b-[2.5rem] lg:inset-0 lg:h-auto lg:rounded-none"
            aria-hidden="true"
        />
        <div class="absolute top-4 right-4 z-10">
            <UColorModeButton class="boton-flotante boton-circulo" />
        </div>
        <main class="relative flex min-h-dvh flex-col items-center justify-start gap-6 px-4 pt-28 pb-10 lg:justify-center lg:pt-10">
            <div
                class="w-full max-w-md rounded-[1.75rem] bg-(--ax-tarjeta) p-6 shadow-(--ax-sombra-flotante) ring ring-(--ax-borde) sm:p-8"
                data-prueba="sso-entrar"
                :data-fase="fase"
            >
                <div class="mb-5 flex items-center gap-3">
                    <span class="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-(image:--ax-gradiente) text-white shadow-lg">
                        <LogoArgos
                            variante="linea"
                            class="size-8"
                        />
                    </span>
                    <div class="flex min-w-0 flex-col">
                        <span class="text-xl font-bold tracking-[-0.02em] text-highlighted">ArgosIsp</span>
                        <span class="text-[0.8125rem] text-muted">{{ conector ? `Entrando desde ${sistema}` : 'Entrando desde otro sistema' }}</span>
                    </div>
                </div>
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
                        {{ fase === 'canjeando' ? 'Entrando…' : 'Abriendo…' }}
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
                        <h1
                            class="text-xl font-semibold tracking-[-0.015em] text-highlighted"
                            data-prueba="sso-titulo"
                        >
                            Vincula tu cuenta de {{ sistema }}
                        </h1>
                    </div>
                    <div
                        class="mb-4 flex flex-col gap-3 rounded-lg border border-default bg-elevated/50 p-3"
                        data-prueba="sso-vincular"
                    >
                        <p class="flex items-center gap-2 text-sm font-medium text-highlighted">
                            <UIcon
                                name="i-lucide-user-round"
                                class="size-4 shrink-0 text-muted"
                            />
                            Persona de {{ sistema }}
                        </p>
                        <dl class="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-sm">
                            <template
                                v-for="fila in datosExternos"
                                :key="fila.clave"
                            >
                                <dt class="text-muted">
                                    {{ fila.etiqueta }}
                                </dt>
                                <dd
                                    class="break-all"
                                    :class="[fila.informado ? 'font-medium text-highlighted' : 'italic text-muted', fila.mono ? 'font-mono' : '']"
                                    :data-prueba="`sso-dato-${fila.clave}`"
                                >
                                    {{ fila.valor }}
                                </dd>
                            </template>
                        </dl>
                    </div>
                    <UAlert
                        color="warning"
                        variant="subtle"
                        icon="i-lucide-triangle-alert"
                        :title="`Vas a dar acceso a tu cuenta de ArgosIsp a esta persona de ${sistema}. Si no eres tú, no continúes.`"
                        class="mb-4"
                        data-prueba="sso-aviso"
                    />
                    <p
                        class="mb-4 text-sm text-muted"
                        data-prueba="sso-explicacion"
                    >
                        Inicia sesión con tu usuario de ArgosIsp. Desde ahora {{ sistema }} te abrirá ArgosIsp con tus propios permisos, sin pedirte la contraseña.
                    </p>
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
        </main>
    </div>
</template>
