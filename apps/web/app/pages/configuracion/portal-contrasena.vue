<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { FormSubmitEvent } from '@nuxt/ui'

/**
 * Ajustes → Contraseña del portal (A5): la contraseña por defecto con la que entran al
 * portal los clientes de la empresa activa que aún no eligieron la suya. La API nunca la devuelve:
 * se ve si está configurada y desde cuándo, y solo se puede escribir una nueva. Cambiarla requiere
 * `portal.configurar_contrasena_defecto` (solo admin); un 409 relee la versión actual.
 */
definePageMeta({ permiso: 'empresa.ver' })

const { puede } = usePermisos()
const { empresa: empresaActiva } = useEmpresaActiva()
const toast = useToast()

useHead(() => ({ title: `Contraseña del portal${empresaActiva.value ? ` · ${empresaActiva.value.nombre_comercial}` : ''} · ArgosIsp` }))

const defecto = shallowRef<PortalContrasenaDefecto | null>(null)
const cargando = ref(false)
const problema = ref<Problem | null>(null)

const formulario = useTemplateRef('formulario')
const estado = reactive<EntradaContrasenaDefecto>({ contrasena: '', confirmacion: '' })
const visible = ref(false)
const enviando = ref(false)
const problemaGuardar = ref<Problem | null>(null)
/** La API respondió 409: ya se releyó la versión actual y se puede volver a guardar. */
const conflicto = ref(false)

const editable = computed(() => puede('portal.configurar_contrasena_defecto'))

/** Sin empresa activa («Todas»), la API responde 422 `empresa_requerida`: se pide elegir una. */
const problemaVisible = computed<Problem | null>(() => {
    if (problema.value && codigoProblema(problema.value) === 'empresa_requerida') {
        return { ...problema.value, title: 'Elige una empresa', detail: 'La contraseña del portal es de cada empresa: elige una en el selector de empresa de arriba.' }
    }
    return problema.value
})

function limpiarFormulario() {
    estado.contrasena = ''
    estado.confirmacion = ''
    visible.value = false
    formulario.value?.clear()
}

async function cargar() {
    cargando.value = true
    const resultado = await usePortalContrasena().verDefecto()
    cargando.value = false
    problema.value = resultado.ok ? null : resultado.problema
    defecto.value = resultado.ok ? resultado.data : null
}

async function guardar(evento: FormSubmitEvent<SalidaContrasenaDefecto>) {
    if (!defecto.value) {
        return
    }
    enviando.value = true
    problemaGuardar.value = null
    conflicto.value = false
    const resultado = await usePortalContrasena().configurarDefecto({ contrasena: evento.data.contrasena, version: defecto.value.version })
    enviando.value = false
    if (!resultado.ok) {
        if (resultado.problema.status === 409) {
            // Otra persona la cambió: se relee la versión y lo escrito se conserva para volver a guardar.
            conflicto.value = true
            await cargar()
            return
        }
        problemaGuardar.value = resultado.problema
        if (resultado.problema.status === 422) {
            formulario.value?.setErrors(erroresDeFormulario(resultado.problema))
        }
        return
    }
    const primera = !defecto.value.configurada
    defecto.value = resultado.data
    limpiarFormulario()
    toast.add({
        title: primera ? 'Contraseña del portal configurada' : 'Contraseña del portal cambiada',
        description: 'Los clientes sin contraseña propia entran con ella y el portal les pide cambiarla.',
        icon: 'i-lucide-key-round',
        color: 'success',
    })
}

onMounted(cargar)
</script>

<template>
    <ConfiguracionMarco
        id="portal-contrasena"
        empresas
    >
        <div class="flex w-full max-w-3xl flex-col gap-4">
            <ProblemaAlerta
                v-if="problemaVisible"
                :problema="problemaVisible"
                :reintentar="cargar"
                :reintentando="cargando"
            />
            <div
                v-else-if="!defecto"
                class="flex flex-col gap-3"
            >
                <USkeleton class="h-16" />
                <USkeleton class="h-48" />
            </div>
            <template v-else>
                <ConfiguracionBloque
                    titulo="Contraseña del portal por defecto"
                    :descripcion="empresaActiva ? `Empresa: ${empresaActiva.nombre_comercial}` : undefined"
                    icono="i-lucide-key-round"
                >
                    <div
                        class="flex flex-wrap items-center gap-2"
                        data-prueba="estado-contrasena-defecto"
                        :data-estado="defecto.configurada ? 'configurada' : 'sin-configurar'"
                    >
                        <UBadge
                            :label="defecto.configurada ? 'Configurada' : 'Sin configurar'"
                            :icon="defecto.configurada ? 'i-lucide-lock' : 'i-lucide-lock-open'"
                            :color="defecto.configurada ? 'success' : 'warning'"
                            variant="subtle"
                        />
                        <span class="text-sm text-muted">{{ textoEstadoDefecto(defecto, formatearFechaHora) }}</span>
                    </div>
                    <p class="text-sm text-muted">
                        Con ella entran al portal, con su número de documento, los clientes que aún no eligieron una contraseña propia. Por seguridad nunca se vuelve a mostrar; si la olvidas, escribe una nueva.
                    </p>
                </ConfiguracionBloque>

                <UAlert
                    color="info"
                    variant="subtle"
                    icon="i-lucide-shield-alert"
                    title="El cliente debe cambiarla la primera vez que entre"
                    description="El portal no le deja ver su cuenta hasta que elija una propia. Cambiar esta contraseña no afecta a los clientes que ya tienen la suya ni cierra sesiones."
                    data-prueba="aviso-cambio-obligatorio"
                />

                <UForm
                    v-if="editable"
                    ref="formulario"
                    :schema="esquemaContrasenaDefecto"
                    :state="estado"
                    class="surface-card flex flex-col gap-4 p-4 sm:p-5"
                    @submit="guardar"
                >
                    <h3 class="text-sm font-semibold text-highlighted">
                        {{ defecto.configurada ? 'Cambiar la contraseña' : 'Configurar la contraseña' }}
                    </h3>
                    <div class="grid gap-4 sm:grid-cols-2">
                        <UFormField
                            label="Contraseña nueva"
                            name="contrasena"
                            help="De 8 a 128 caracteres."
                            required
                        >
                            <UInput
                                v-model="estado.contrasena"
                                :type="visible ? 'text' : 'password'"
                                autocomplete="new-password"
                                class="w-full"
                                data-prueba="contrasena-defecto"
                                :ui="{ trailing: 'pe-1' }"
                            >
                                <template #trailing>
                                    <UButton
                                        color="neutral"
                                        variant="link"
                                        size="sm"
                                        :icon="visible ? 'i-lucide-eye-off' : 'i-lucide-eye'"
                                        :aria-label="visible ? 'Ocultar contraseña' : 'Mostrar contraseña'"
                                        :aria-pressed="visible"
                                        @click="visible = !visible"
                                    />
                                </template>
                            </UInput>
                        </UFormField>
                        <UFormField
                            label="Confirmar contraseña"
                            name="confirmacion"
                            required
                        >
                            <UInput
                                v-model="estado.confirmacion"
                                :type="visible ? 'text' : 'password'"
                                autocomplete="new-password"
                                class="w-full"
                                data-prueba="confirmacion-defecto"
                            />
                        </UFormField>
                    </div>

                    <UAlert
                        v-if="conflicto"
                        color="warning"
                        variant="subtle"
                        icon="i-lucide-git-compare"
                        title="Alguien más cambió la contraseña mientras escribías"
                        description="Ya se cargó el estado actual. Si igual quieres reemplazarla por la tuya, vuelve a guardar."
                        data-prueba="conflicto-version"
                    />
                    <ProblemaAlerta
                        v-else-if="problemaGuardar && problemaGuardar.status !== 422"
                        :problema="problemaGuardar"
                    />

                    <div class="flex flex-wrap items-center gap-2">
                        <UButton
                            type="submit"
                            :label="defecto.configurada ? 'Cambiar contraseña' : 'Guardar contraseña'"
                            icon="i-lucide-check"
                            :loading="enviando"
                            data-prueba="guardar-contrasena-defecto"
                        />
                        <UButton
                            label="Limpiar"
                            color="neutral"
                            variant="ghost"
                            :disabled="enviando || (!estado.contrasena && !estado.confirmacion)"
                            @click="limpiarFormulario"
                        />
                    </div>
                </UForm>
                <p
                    v-else
                    class="text-sm text-muted"
                    data-prueba="solo-lectura"
                >
                    Solo lectura: cambiarla requiere el permiso portal.configurar_contrasena_defecto (rol admin).
                </p>
            </template>
        </div>
    </ConfiguracionMarco>
</template>
