<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { FormSubmitEvent } from '@nuxt/ui'

/**
 * Configuración · empresa (A5): contacto, horario e instrucciones de pago. Salen en el aviso de
 * cobro (`{{empresa.*}}`), en el portal y en las notificaciones. Sin `empresa.editar` se ve en
 * modo lectura. `version: 0` = nunca se guardó (valores por defecto).
 */
definePageMeta({ permiso: 'empresa.ver' })

useHead({ title: 'Empresa · ArgosIsp' })

const { puede } = usePermisos()
const toast = useToast()

const empresa = shallowRef<Empresa | null>(null)
const cargando = ref(false)
const problema = ref<Problem | null>(null)

const formulario = useTemplateRef('formulario')
const estado = reactive<EntradaEmpresa>({
    nombre: '', nit: '', direccion: '', telefono: '', telefono_alterno: '', whatsapp: '', correo: '', horario: '', instrucciones_pago: '',
})
const enviando = ref(false)
const problemaGuardar = ref<Problem | null>(null)

const editable = computed(() => puede('empresa.editar'))
const conflicto = computed(() => problemaGuardar.value?.status === 409)
const sinCambios = computed(() => empresa.value !== null && JSON.stringify(entradaDesdeEmpresa(empresa.value)) === JSON.stringify({ ...estado }))

function rellenar(datos: Empresa) {
    empresa.value = datos
    Object.assign(estado, entradaDesdeEmpresa(datos))
    formulario.value?.clear()
}

async function cargar() {
    cargando.value = true
    const resultado = await useEmpresa().ver()
    cargando.value = false
    problema.value = resultado.ok ? null : resultado.problema
    if (resultado.ok) {
        problemaGuardar.value = null
        rellenar(resultado.data)
    }
}

async function guardar(evento: FormSubmitEvent<SalidaEmpresa>) {
    if (!empresa.value) {
        return
    }
    enviando.value = true
    problemaGuardar.value = null
    const resultado = await useEmpresa().editar({ ...evento.data, version: empresa.value.version })
    enviando.value = false
    if (!resultado.ok) {
        problemaGuardar.value = resultado.problema
        if (resultado.problema.status === 422) {
            formulario.value?.setErrors(erroresDeFormulario(resultado.problema))
        }
        return
    }
    rellenar(resultado.data)
    toast.add({ title: 'Datos de la empresa guardados', description: `Versión ${resultado.data.version}. El próximo aviso de cobro ya los usa.`, icon: 'i-lucide-building-2', color: 'success' })
}

onMounted(cargar)
</script>

<template>
    <PanelPagina
        id="empresa"
        titulo="Empresa"
        icono="i-lucide-building-2"
    >
        <div class="mx-auto flex w-full max-w-3xl flex-col gap-4">
            <ProblemaAlerta
                v-if="problema"
                :problema="problema"
                :reintentar="cargar"
                :reintentando="cargando"
            />
            <div
                v-else-if="!empresa"
                class="flex flex-col gap-3"
            >
                <USkeleton class="h-10" />
                <USkeleton class="h-40" />
            </div>
            <template v-else>
                <UAlert
                    v-if="empresa.version === 0"
                    color="info"
                    variant="subtle"
                    icon="i-lucide-info"
                    title="Aún no se ha guardado"
                    description="Se muestran los valores por defecto. Complétalos para que el aviso de cobro y el portal muestren tus datos de contacto."
                />
                <UForm
                    ref="formulario"
                    :schema="esquemaEmpresa"
                    :state="estado"
                    :disabled="!editable"
                    class="flex flex-col gap-6"
                    @submit="guardar"
                >
                    <UPageCard
                        title="Datos generales"
                        variant="subtle"
                        :ui="{ container: 'gap-4 sm:p-5' }"
                    >
                        <div class="grid gap-4 sm:grid-cols-2">
                            <UFormField
                                label="Nombre comercial"
                                name="nombre"
                                required
                                class="sm:col-span-2"
                            >
                                <UInput
                                    v-model="estado.nombre"
                                    class="w-full"
                                />
                            </UFormField>
                            <UFormField
                                label="NIT"
                                name="nit"
                            >
                                <UInput
                                    v-model="estado.nit"
                                    placeholder="1234567-8"
                                    class="w-full"
                                />
                            </UFormField>
                            <UFormField
                                label="Correo"
                                name="correo"
                            >
                                <UInput
                                    v-model="estado.correo"
                                    type="email"
                                    placeholder="cobros@tuempresa.com.gt"
                                    class="w-full"
                                />
                            </UFormField>
                            <UFormField
                                label="Dirección"
                                name="direccion"
                                class="sm:col-span-2"
                            >
                                <UInput
                                    v-model="estado.direccion"
                                    class="w-full"
                                />
                            </UFormField>
                        </div>
                    </UPageCard>

                    <UPageCard
                        title="Atención al cliente"
                        variant="subtle"
                        :ui="{ container: 'gap-4 sm:p-5' }"
                    >
                        <div class="grid gap-4 sm:grid-cols-3">
                            <UFormField
                                label="Teléfono"
                                name="telefono"
                            >
                                <UInput
                                    v-model="estado.telefono"
                                    inputmode="tel"
                                    placeholder="7765-4321"
                                    class="w-full"
                                />
                            </UFormField>
                            <UFormField
                                label="Teléfono alterno"
                                name="telefono_alterno"
                            >
                                <UInput
                                    v-model="estado.telefono_alterno"
                                    inputmode="tel"
                                    class="w-full"
                                />
                            </UFormField>
                            <UFormField
                                label="WhatsApp"
                                name="whatsapp"
                            >
                                <UInput
                                    v-model="estado.whatsapp"
                                    inputmode="tel"
                                    placeholder="5555-1234"
                                    class="w-full"
                                />
                            </UFormField>
                            <UFormField
                                label="Horario"
                                name="horario"
                                class="sm:col-span-3"
                            >
                                <UInput
                                    v-model="estado.horario"
                                    placeholder="Lunes a viernes de 8:00 a 17:00, sábado de 8:00 a 12:00"
                                    class="w-full"
                                />
                            </UFormField>
                        </div>
                    </UPageCard>

                    <UPageCard
                        title="Instrucciones de pago"
                        description="Acompañan las cuentas para depósito en el aviso de cobro y en el portal."
                        variant="subtle"
                        :ui="{ container: 'gap-4 sm:p-5' }"
                    >
                        <UFormField
                            name="instrucciones_pago"
                            :help="`${(estado.instrucciones_pago ?? '').length} / 1000`"
                        >
                            <UTextarea
                                v-model="estado.instrucciones_pago"
                                :rows="4"
                                autoresize
                                placeholder="Deposita a nombre de… y envía la boleta por WhatsApp con tu número de cliente."
                                class="w-full"
                            />
                        </UFormField>
                    </UPageCard>

                    <UAlert
                        v-if="conflicto"
                        color="warning"
                        variant="subtle"
                        icon="i-lucide-git-compare"
                        title="Alguien más guardó estos datos"
                        description="Recarga para ver la versión actual; tus cambios sin guardar se perderán."
                        :actions="[{ label: 'Recargar', icon: 'i-lucide-refresh-cw', color: 'neutral', variant: 'outline', onClick: cargar }]"
                        data-prueba="conflicto-version"
                    />
                    <ProblemaAlerta
                        v-else-if="problemaGuardar && problemaGuardar.status !== 422"
                        :problema="problemaGuardar"
                    />

                    <div
                        v-if="editable"
                        class="flex flex-wrap items-center gap-2"
                    >
                        <UButton
                            type="submit"
                            label="Guardar"
                            icon="i-lucide-check"
                            :loading="enviando"
                            :disabled="sinCambios"
                        />
                        <UButton
                            label="Descartar cambios"
                            color="neutral"
                            variant="ghost"
                            :disabled="sinCambios || enviando"
                            @click="empresa && rellenar(empresa)"
                        />
                        <span class="text-xs text-muted">Versión {{ empresa.version }}</span>
                    </div>
                    <p
                        v-else
                        class="text-sm text-muted"
                    >
                        Solo lectura: editar requiere el permiso empresa.editar.
                    </p>
                </UForm>
            </template>
        </div>
    </PanelPagina>
</template>
