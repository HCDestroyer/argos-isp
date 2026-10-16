<script setup lang="ts">
import type { FormSubmitEvent } from '@nuxt/ui'
import { z } from 'zod'

/**
 * Entrada al portal con código de verificación.
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
const paso = ref<'pedir' | 'verificar'>('pedir')
const solicitud = ref<SolicitudCodigo | null>(null)
const enviando = ref(false)
const error = ref<string | null>(null)

// Espejo de `solicitarCodigoValidator` (apps/api/app/portal/validators.ts).
const esquemaPedir = z.object({
    identificador: z.string().trim().min(2, 'Escribe tu NIT, CUI o usuario de conexión').max(64),
})
type Pedir = z.output<typeof esquemaPedir>
const pedir = reactive({ identificador: '' })

const codigo = ref<(number | undefined)[]>([])
const codigoCompleto = computed(() => codigo.value.map(digito => digito ?? '').join(''))

async function enviarCodigo(resultado: Promise<Resultado<SolicitudCodigo>>) {
    enviando.value = true
    error.value = null
    const respuesta = await resultado
    enviando.value = false
    if (!respuesta.ok) {
        error.value = mensajeProblema(respuesta.problema)
        return
    }
    solicitud.value = respuesta.data
    codigo.value = []
    paso.value = 'verificar'
}

function pedirPorIdentificador(evento: FormSubmitEvent<Pedir>) {
    return enviarCodigo(acceso.solicitarPorIdentificador(evento.data.identificador))
}

function pedirPorIp() {
    return enviarCodigo(acceso.solicitarPorIp())
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
    <div class="flex flex-col gap-4">
        <div>
            <h1 class="text-2xl font-semibold text-highlighted">
                Entrar a mi cuenta
            </h1>
            <p class="mt-1 text-sm text-muted">
                Para ver tus facturas, pagos y datos te enviamos un código de 6 dígitos.
            </p>
        </div>

        <UAlert
            v-if="error"
            data-testid="error-acceso"
            color="error"
            variant="subtle"
            icon="i-lucide-circle-alert"
            :title="error"
        />

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
                    to="/entrar"
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
                    help="Aparece en tu aviso de cobro o en tu contrato."
                >
                    <UInput
                        v-model="pedir.identificador"
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

        <UButton
            label="Volver al estado de mi servicio"
            icon="i-lucide-wifi"
            color="neutral"
            variant="link"
            to="/corte"
            class="self-center"
        />
    </div>
</template>
