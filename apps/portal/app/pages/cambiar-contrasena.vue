<script setup lang="ts">
import type { FormSubmitEvent } from '@nuxt/ui'
import { z } from 'zod'

/**
 * Cambiar la contraseña del portal (`POST /portal/contrasena`).
 *
 * - Obligatoria cuando el cliente entró con la contraseña que le dio la empresa: la API responde 403
 *   `cambio_contrasena_requerido` en todo lo demás hasta que la cambie, y `/cuenta` lo trae aquí.
 * - Opcional desde «Mi cuenta» en cualquier momento.
 *
 * Siempre pide la actual (la propia, o la que le dio la empresa si aún no tiene una). Al cambiarla,
 * la API cierra las demás sesiones del cliente.
 */
const { nombre: nombreEmpresa } = useEmpresa()
const contrasena = useContrasenaPortal()
const acceso = useAccesoPortal()

useHead({ title: computed(() => `Cambiar contraseña · ${nombreEmpresa.value}`) })

/** Mientras lee la sesión: `null`; sin sesión se va a `/entrar`. */
const obligatoria = ref<boolean | null>(null)
const errorSesion = ref<string | null>(null)

async function leer() {
    errorSesion.value = null
    const sesion = await contrasena.leerSesion()
    if (!sesion.ok) {
        if (esSinSesion(sesion.problema)) {
            await navigateTo('/entrar')
            return
        }
        errorSesion.value = mensajeProblema(sesion.problema)
        return
    }
    obligatoria.value = sesion.data.debe_cambiar_contrasena
}
onMounted(leer)

// Espejo de `cambiarContrasenaValidator` (apps/api/app/portal/validators.ts) más la confirmación.
const esquema = z.object({
    actual: z.string().min(1, 'Escribe tu contraseña actual').max(128),
    nueva: z.string().min(8, 'Usa al menos 8 caracteres').max(128, 'Usa como máximo 128 caracteres'),
    confirmacion: z.string().min(1, 'Repite la contraseña nueva'),
})
type Datos = z.output<typeof esquema>
const estado = reactive({ actual: '', nueva: '', confirmacion: '' })

const formulario = useTemplateRef('formulario')
const enviando = ref(false)
const error = ref<string | null>(null)

async function guardar(evento: FormSubmitEvent<Datos>) {
    // La confirmación se revisa al enviar (no es un dato que valide la API).
    if (evento.data.nueva !== evento.data.confirmacion) {
        formulario.value?.setErrors([{ name: 'confirmacion', message: 'Las dos contraseñas no coinciden' }])
        return
    }
    enviando.value = true
    error.value = null
    const resultado = await contrasena.cambiar(evento.data.actual, evento.data.nueva)
    enviando.value = false
    if (!resultado.ok) {
        if (esSinSesion(resultado.problema)) {
            await navigateTo('/entrar')
            return
        }
        const errores = erroresDeFormulario(resultado.problema).map(e => ({
            ...e,
            name: e.name === 'contrasena_actual' ? 'actual' : e.name === 'contrasena_nueva' ? 'nueva' : e.name,
        }))
        if (errores.length > 0) {
            formulario.value?.setErrors(errores)
        }
        else {
            error.value = mensajeProblema(resultado.problema)
        }
        return
    }
    clearNuxtData('portal:cuenta')
    await navigateTo({ path: '/cuenta', query: { contrasena: 'cambiada' } })
}

async function salir() {
    await acceso.salir()
    await navigateTo('/entrar')
}
</script>

<template>
    <div class="flex flex-col gap-4">
        <div>
            <h1 class="text-2xl font-semibold text-highlighted">
                {{ obligatoria ? 'Elige tu contraseña' : 'Cambiar contraseña' }}
            </h1>
            <p class="mt-1 text-sm text-muted">
                {{ obligatoria
                    ? 'Entraste con la contraseña que te dio la empresa. Para cuidar tu cuenta, elige una propia antes de seguir.'
                    : 'Escribe tu contraseña actual y la nueva.' }}
            </p>
        </div>

        <UAlert
            v-if="errorSesion"
            color="error"
            variant="subtle"
            icon="i-lucide-cloud-off"
            title="No pudimos revisar tu sesión"
            :description="errorSesion"
            :actions="[{ label: 'Reintentar', icon: 'i-lucide-refresh-cw', color: 'error', variant: 'outline', onClick: () => leer() }]"
            role="alert"
        />

        <USkeleton
            v-else-if="obligatoria === null"
            class="h-72 w-full"
        />

        <UCard v-else>
            <UForm
                ref="formulario"
                :schema="esquema"
                :state="estado"
                class="flex flex-col gap-4"
                data-testid="form-cambiar-contrasena"
                @submit="guardar"
            >
                <UAlert
                    v-if="error"
                    data-testid="error-contrasena"
                    color="error"
                    variant="subtle"
                    icon="i-lucide-circle-alert"
                    :title="error"
                />
                <UFormField
                    :label="obligatoria ? 'Contraseña que te dio la empresa' : 'Contraseña actual'"
                    name="actual"
                    required
                >
                    <PortalCampoContrasena
                        v-model="estado.actual"
                        testid="campo-actual"
                    />
                </UFormField>
                <UFormField
                    label="Contraseña nueva"
                    name="nueva"
                    help="Al menos 8 caracteres. No uses tu número de documento."
                    required
                >
                    <PortalCampoContrasena
                        v-model="estado.nueva"
                        autocomplete="new-password"
                        testid="campo-nueva"
                    />
                </UFormField>
                <UFormField
                    label="Repite la contraseña nueva"
                    name="confirmacion"
                    required
                >
                    <PortalCampoContrasena
                        v-model="estado.confirmacion"
                        autocomplete="new-password"
                        testid="campo-confirmacion"
                    />
                </UFormField>
                <UButton
                    type="submit"
                    label="Guardar contraseña"
                    icon="i-lucide-check"
                    size="xl"
                    block
                    :loading="enviando"
                    data-testid="guardar-contrasena"
                />
            </UForm>
        </UCard>

        <UButton
            v-if="obligatoria"
            label="Salir"
            icon="i-lucide-log-out"
            color="neutral"
            variant="link"
            class="self-center"
            @click="salir"
        />
        <UButton
            v-else-if="obligatoria === false"
            label="Volver a mi cuenta"
            icon="i-lucide-arrow-left"
            color="neutral"
            variant="link"
            to="/cuenta"
            class="self-center"
        />
    </div>
</template>
