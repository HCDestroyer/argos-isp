<script setup lang="ts">
import type { FormSubmitEvent } from '@nuxt/ui'
import { z } from '~/lib/zod'

/**
 * Entrada al portal, en dos pestañas:
 *
 * **Documento y contraseña** (la de siempre para quien ya tiene contraseña). El documento es su NIT,
 * CUI o pasaporte. Si entra con la contraseña que le dio la empresa, la API lo marca y pasamos a
 * `/cambiar-contrasena` antes de `/cuenta`. `?empresa=<id>` (enlace del sitio de una empresa) limita
 * la búsqueda a esa empresa.
 *
 * **Código de verificación** (`?con=codigo`, y siempre con `?por_ip=1` desde `/corte`):
 *
 * 1. El cliente escribe su NIT, CUI o usuario de conexión (o, desde `/corte`, se identifica por la
 *    IP con `?por_ip=1`). La API manda un código de 6 dígitos al correo o Telegram REGISTRADO.
 * 2. Escribe el código; la API abre la sesión con una cookie httpOnly y pasamos a `/cuenta`.
 *
 * Por identificador la API responde igual exista o no el cliente: el texto nunca confirma que
 * el NIT sea de alguien.
 */
const { nombre: nombreEmpresa } = useEmpresa()
const route = useRoute()
const acceso = useAccesoPortal()

useHead({ title: computed(() => `Entrar · ${nombreEmpresa.value}`) })

const porIp = computed(() => route.query.por_ip === '1')
const empresaId = computed(() => {
    const valor = Number(route.query.empresa)
    return Number.isInteger(valor) && valor > 0 ? valor : null
})

type Forma = 'contrasena' | 'codigo'
const forma = ref<Forma>(porIp.value || route.query.con === 'codigo' ? 'codigo' : 'contrasena')
const formas = [
    { label: 'Documento y contraseña', value: 'contrasena', icon: 'i-lucide-key-round', slot: 'contrasena' as const },
    { label: 'Código', value: 'codigo', icon: 'i-lucide-mail', slot: 'codigo' as const },
]

// Espejo de `entrarConContrasenaValidator` (apps/api/app/portal/validators.ts).
const esquemaContrasena = z.object({
    documento: z.string().trim().min(2, 'Escribe tu NIT, CUI o pasaporte').max(30),
    contrasena: z.string().min(1, 'Escribe tu contraseña').max(128),
})
type Credenciales = z.output<typeof esquemaContrasena>
const credenciales = reactive({ documento: '', contrasena: '' })

const formContrasena = useTemplateRef<{ submit: () => Promise<void> }>('formContrasena')

async function entrarConContrasena(evento: FormSubmitEvent<Credenciales>) {
    enviando.value = true
    error.value = null
    reintentar.value = null
    const respuesta = await acceso.entrarConContrasena(evento.data.documento, evento.data.contrasena, empresaId.value)
    enviando.value = false
    if (!respuesta.ok) {
        error.value = mensajeProblema(respuesta.problema)
        // Sin conexión o falla del servidor: «Reintentar» con lo mismo. Si la contraseña no era,
        // se borra para escribirla de nuevo.
        if (esFallaTransitoria(respuesta.problema)) {
            reintentar.value = () => void formContrasena.value?.submit()
        }
        else {
            credenciales.contrasena = ''
        }
        return
    }
    clearNuxtData('portal:cuenta')
    await navigateTo(respuesta.data.debe_cambiar_contrasena ? '/cambiar-contrasena' : '/cuenta')
}

watch(forma, () => {
    error.value = null
    reintentar.value = null
})
const paso = ref<'pedir' | 'verificar'>('pedir')
const solicitud = ref<SolicitudCodigo | null>(null)
const enviando = ref(false)
const error = ref<string | null>(null)
/** «Reintentar» del error: solo si falló la conexión o el servidor (no con datos incorrectos). */
const reintentar = ref<(() => void) | null>(null)

// Espejo de `solicitarCodigoValidator` (apps/api/app/portal/validators.ts).
const esquemaPedir = z.object({
    identificador: z.string().trim().min(2, 'Escribe tu NIT, CUI o usuario de conexión').max(64),
})
type Pedir = z.output<typeof esquemaPedir>
const pedir = reactive({ identificador: '' })

const codigo = ref<(number | undefined)[]>([])
const codigoCompleto = computed(() => codigo.value.map(digito => digito ?? '').join(''))

async function enviarCodigo(resultado: Promise<Resultado<SolicitudCodigo>>, repetir?: () => void) {
    enviando.value = true
    error.value = null
    reintentar.value = null
    const respuesta = await resultado
    enviando.value = false
    if (!respuesta.ok) {
        error.value = mensajeProblema(respuesta.problema)
        if (repetir && esFallaTransitoria(respuesta.problema)) {
            reintentar.value = repetir
        }
        return
    }
    solicitud.value = respuesta.data
    codigo.value = []
    paso.value = 'verificar'
}

function pedirPorIdentificador(evento: FormSubmitEvent<Pedir>) {
    return enviarCodigo(acceso.solicitarPorIdentificador(evento.data.identificador), () => void pedirPorIdentificador(evento))
}

function pedirPorIp() {
    return enviarCodigo(acceso.solicitarPorIp(), () => void pedirPorIp())
}

function pedirOtro() {
    return porIp.value ? pedirPorIp() : enviarCodigo(acceso.solicitarPorIdentificador(pedir.identificador))
}

async function verificar() {
    if (!solicitud.value || !/^\d{6}$/.test(codigoCompleto.value)) {
        error.value = 'Escribe los 6 dígitos del código.'
        return
    }
    enviando.value = true
    error.value = null
    const respuesta = await acceso.verificar(solicitud.value.solicitud, codigoCompleto.value)
    enviando.value = false
    if (!respuesta.ok) {
        error.value = mensajeProblema(respuesta.problema)
        codigo.value = []
        return
    }
    clearNuxtData('portal:cuenta')
    await navigateTo('/cuenta')
}

function volver() {
    paso.value = 'pedir'
    error.value = null
}

const destinoTexto = computed(() => solicitud.value?.destino
    ? `Te lo enviamos a ${solicitud.value.destino}.`
    : 'Si los datos corresponden a un cliente, lo enviamos al correo o Telegram que tenemos registrado.')
</script>

<template>
    <PortalAcceso
        titulo="Entrar a mi cuenta"
        descripcion="Para ver tus facturas, pagos y datos."
    >
        <UAlert
            v-if="error"
            data-testid="error-acceso"
            color="error"
            variant="subtle"
            icon="i-lucide-circle-alert"
            :title="error"
            :actions="reintentar ? [{ label: 'Reintentar', icon: 'i-lucide-refresh-cw', color: 'error', variant: 'outline', onClick: reintentar }] : undefined"
        />

        <UTabs
            v-model="forma"
            :items="formas"
            :content="false"
            color="neutral"
            variant="pill"
            class="w-full"
            data-testid="formas-entrar"
        />

        <UCard v-if="forma === 'contrasena'">
            <UForm
                ref="formContrasena"
                :schema="esquemaContrasena"
                :state="credenciales"
                class="flex flex-col gap-4"
                data-testid="form-contrasena"
                @submit="entrarConContrasena"
            >
                <UFormField
                    label="NIT, CUI o pasaporte"
                    name="documento"
                    help="El documento con el que te registraste. Puedes escribirlo con o sin guion."
                    required
                >
                    <UInput
                        v-model="credenciales.documento"
                        icon="i-lucide-id-card"
                        autocomplete="username"
                        autocapitalize="characters"
                        size="xl"
                        class="w-full"
                        data-testid="campo-documento"
                    />
                </UFormField>
                <UFormField
                    label="Contraseña"
                    name="contrasena"
                    help="Si es tu primera vez, usa la contraseña que te dio la empresa."
                    required
                >
                    <PortalCampoContrasena
                        v-model="credenciales.contrasena"
                        icon="i-lucide-lock"
                        testid="campo-contrasena"
                    />
                </UFormField>
                <UButton
                    type="submit"
                    label="Entrar"
                    icon="i-lucide-log-in"
                    size="xl"
                    block
                    :loading="enviando"
                    data-testid="entrar-contrasena"
                />
                <div class="flex flex-col items-center gap-1 text-center text-xs text-muted">
                    <p>¿No sabes tu contraseña? Entra con un código y cámbiala desde tu cuenta, o pide a soporte que la restaure.</p>
                    <UButton
                        label="Entrar con un código"
                        icon="i-lucide-mail"
                        variant="link"
                        size="sm"
                        @click="forma = 'codigo'"
                    />
                </div>
            </UForm>
        </UCard>

        <template v-else>
            <UCard v-if="paso === 'pedir' && porIp">
                <div class="flex flex-col gap-3">
                    <p class="text-sm text-default">
                        Te enviaremos el código al correo o Telegram que tenemos registrado para tu servicio.
                    </p>
                    <UButton
                        label="Enviarme el código"
                        icon="i-lucide-send"
                        size="xl"
                        block
                        :loading="enviando"
                        @click="pedirPorIp"
                    />
                    <UButton
                        label="Usar mi NIT o usuario en su lugar"
                        color="neutral"
                        variant="ghost"
                        block
                        to="/entrar?con=codigo"
                    />
                </div>
            </UCard>

            <UCard v-else-if="paso === 'pedir'">
                <UForm
                    :schema="esquemaPedir"
                    :state="pedir"
                    class="flex flex-col gap-4"
                    @submit="pedirPorIdentificador"
                >
                    <UFormField
                        label="NIT, CUI o usuario de conexión"
                        name="identificador"
                        help="Aparece en tu aviso de cobro. Con él buscamos tu cuenta para enviarte el código."
                        required
                    >
                        <UInput
                            v-model="pedir.identificador"
                            icon="i-lucide-id-card"
                            autocomplete="username"
                            inputmode="text"
                            size="xl"
                            class="w-full"
                        />
                    </UFormField>
                    <UButton
                        type="submit"
                        label="Enviarme un código"
                        icon="i-lucide-send"
                        size="xl"
                        block
                        :loading="enviando"
                    />
                </UForm>
            </UCard>

            <UCard v-else>
                <div class="flex flex-col gap-4">
                    <p
                        class="text-sm text-default"
                        data-testid="destino-codigo"
                    >
                        {{ destinoTexto }} Vence en unos minutos.
                    </p>
                    <UFormField
                        label="Código de 6 dígitos"
                        name="codigo"
                        help="Confirma que eres el titular antes de mostrarte tus facturas y pagos."
                        required
                    >
                        <UPinInput
                            v-model="codigo"
                            :length="6"
                            type="number"
                            otp
                            size="xl"
                            @complete="verificar"
                        />
                    </UFormField>
                    <UButton
                        label="Entrar"
                        icon="i-lucide-log-in"
                        size="xl"
                        block
                        :loading="enviando"
                        @click="verificar"
                    />
                    <div class="flex flex-wrap justify-between gap-2">
                        <UButton
                            label="Cambiar datos"
                            icon="i-lucide-arrow-left"
                            color="neutral"
                            variant="ghost"
                            @click="volver"
                        />
                        <UButton
                            label="Pedir otro código"
                            icon="i-lucide-refresh-cw"
                            color="neutral"
                            variant="ghost"
                            :disabled="enviando"
                            @click="pedirOtro"
                        />
                    </div>
                </div>
            </UCard>
        </template>

        <UButton
            label="Volver al estado de mi servicio"
            icon="i-lucide-wifi"
            color="neutral"
            variant="link"
            to="/corte"
            class="self-center"
        />
    </PortalAcceso>
</template>
