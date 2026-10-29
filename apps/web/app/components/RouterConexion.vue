<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { FormSubmitEvent, RadioGroupItem } from '@nuxt/ui'

/**
 * Conexión del panel con la API REST de RouterOS (`contratos/routeros.md`): URL, verificación
 * TLS, CA propia en PEM, servidor DHCP de `dhcp_fija` e interfaz del ARP del amarre IP-MAC.
 * `PUT /routers/:id` (`routers.editar`) con `version`; 409 con "Recargar". La CA nunca se muestra
 * de vuelta: solo se sabe si hay una, y se reemplaza o se quita. Abajo, el chequeo del corte de
 * «Probar conexión» (`RouterChequeoCorte`, A2) con el paso a seguir si falla.
 */
const props = defineProps<{
    router: RouterNas
}>()

const abierto = defineModel<boolean>('open', { default: false })

const emit = defineEmits<{
    actualizado: [router: RouterNas]
}>()

const toast = useToast()
const { puede } = usePermisos()
const formulario = useTemplateRef('formulario')

const actual = shallowRef<RouterNas>(props.router)
const estado = reactive<EntradaConexionRouter>(entradaConexionRouter(props.router))
const guardando = ref(false)
const problema = ref<Problem | null>(null)
// `tiene_api_ca` (A1): el PEM nunca sale por la API (`api_ca` llega `***` o null, obsoleto)
const conCa = computed(() => actual.value.tiene_api_ca)
const soloLectura = computed(() => !puede('routers.editar'))

const itemsCa = computed<RadioGroupItem[]>(() => [
    { label: conCa.value ? 'Mantener la CA cargada' : 'Sin CA propia', value: 'mantener' },
    { label: conCa.value ? 'Reemplazar por otra' : 'Cargar una CA', value: 'reemplazar' },
    ...(conCa.value ? [{ label: 'Quitar la CA', value: 'quitar' }] : []),
])

function reiniciar(router: RouterNas) {
    actual.value = router
    Object.assign(estado, entradaConexionRouter(router))
    problema.value = null
}

watch(abierto, (valor) => {
    if (valor) {
        reiniciar(props.router)
    }
}, { immediate: true })

async function recargar() {
    const resultado = await useRouters().ver(actual.value.id)
    if (resultado.ok) {
        reiniciar(resultado.data)
        emit('actualizado', resultado.data)
        return
    }
    problema.value = resultado.problema
}

async function guardar(evento: FormSubmitEvent<SalidaConexionRouter>) {
    guardando.value = true
    problema.value = null
    const resultado = await useRouters().editar(actual.value.id, cambiosConexionRouter(evento.data, actual.value.version))
    guardando.value = false
    if (!resultado.ok) {
        const errores = erroresDeFormulario(resultado.problema)
        if (errores.length) {
            formulario.value?.setErrors(errores)
        }
        const campos = new Set(Object.keys(estado))
        if (!errores.length || errores.some(e => !e.name || !campos.has(e.name))) {
            problema.value = resultado.problema
        }
        return
    }
    reiniciar(resultado.data)
    emit('actualizado', resultado.data)
    abierto.value = false
    toast.add({ title: `${resultado.data.nombre}: conexión guardada`, description: 'El dispatcher usa estos datos en el próximo comando a RouterOS.', icon: 'i-lucide-circle-check', color: 'success' })
}
</script>

<template>
    <USlideover
        v-model:open="abierto"
        :title="`Conexión · ${actual.nombre}`"
        :description="`API REST de RouterOS · ${actual.host}`"
        :dismissible="!guardando"
        :ui="{ content: 'sm:max-w-xl' }"
    >
        <template #body>
            <UForm
                id="form-conexion-router"
                ref="formulario"
                :schema="esquemaConexionRouter"
                :state="estado"
                :disabled="soloLectura"
                class="flex flex-col gap-5"
                @submit="guardar"
            >
                <UFormField
                    label="URL de la API"
                    name="api_url"
                    :help="`Vacía: https://${actual.host}`"
                >
                    <UInput
                        v-model="estado.api_url"
                        :placeholder="`https://${actual.host}:443`"
                        inputmode="url"
                        autocomplete="off"
                        class="w-full font-mono"
                        data-prueba="router-api-url"
                    />
                </UFormField>

                <UFormField
                    name="api_tls_verificar"
                    help="Apágalo solo para un router con certificado autofirmado y sin CA cargada."
                >
                    <USwitch
                        v-model="estado.api_tls_verificar"
                        label="Verificar el certificado TLS"
                        data-prueba="router-tls"
                    />
                </UFormField>

                <UFormField
                    label="CA propia (PEM)"
                    name="accion_ca"
                >
                    <div class="flex flex-col gap-3">
                        <div class="flex flex-wrap items-center gap-2">
                            <UBadge
                                :label="conCa ? 'CA cargada' : 'Sin CA propia'"
                                :icon="conCa ? 'i-lucide-shield-check' : 'i-lucide-shield'"
                                :color="conCa ? 'success' : 'neutral'"
                                variant="subtle"
                                data-prueba="router-ca-estado"
                            />
                            <span class="text-xs text-muted">El certificado no se vuelve a mostrar.</span>
                        </div>
                        <URadioGroup
                            v-if="!soloLectura"
                            v-model="estado.accion_ca"
                            :items="itemsCa"
                            orientation="vertical"
                            data-prueba="router-ca-accion"
                        />
                    </div>
                </UFormField>

                <UFormField
                    v-if="estado.accion_ca === 'reemplazar'"
                    label="Certificado"
                    name="api_ca"
                    required
                >
                    <UTextarea
                        v-model="estado.api_ca"
                        :rows="6"
                        autoresize
                        :maxrows="12"
                        placeholder="-----BEGIN CERTIFICATE-----"
                        autocomplete="off"
                        spellcheck="false"
                        class="w-full font-mono text-xs"
                        data-prueba="router-ca"
                    />
                </UFormField>

                <div class="grid gap-4 sm:grid-cols-2">
                    <UFormField
                        label="Servidor DHCP"
                        name="dhcp_servidor"
                        help="Lease de los servicios con IP fija por DHCP. Vacío: el de la API o all."
                    >
                        <UInput
                            v-model="estado.dhcp_servidor"
                            placeholder="dhcp-clientes"
                            autocomplete="off"
                            class="w-full font-mono"
                            data-prueba="router-dhcp"
                        />
                    </UFormField>
                    <UFormField
                        label="Interfaz de clientes"
                        name="interfaz_clientes"
                        help="ARP estático del amarre IP-MAC. Vacía: la de la API."
                    >
                        <UInput
                            v-model="estado.interfaz_clientes"
                            placeholder="bridge-clientes"
                            autocomplete="off"
                            class="w-full font-mono"
                            data-prueba="router-interfaz"
                        />
                    </UFormField>
                </div>

                <ProblemaAlerta
                    v-if="problema"
                    :problema="problema"
                    :reintentar="problema.status === 409 ? recargar : undefined"
                    data-prueba="router-conexion-error"
                />
            </UForm>
            <section
                class="mt-6 flex flex-col gap-3 border-t border-default pt-6"
                aria-labelledby="titulo-probar-corte"
            >
                <h3
                    id="titulo-probar-corte"
                    class="text-sm font-medium text-highlighted"
                >
                    Probar conexión · corte
                </h3>
                <RouterChequeoCorte :router="actual" />
            </section>
        </template>

        <template #footer>
            <div class="flex w-full justify-end gap-2">
                <UButton
                    :label="soloLectura ? 'Cerrar' : 'Cancelar'"
                    color="neutral"
                    variant="ghost"
                    :disabled="guardando"
                    @click="abierto = false"
                />
                <UButton
                    v-if="!soloLectura"
                    type="submit"
                    form="form-conexion-router"
                    label="Guardar conexión"
                    icon="i-lucide-save"
                    :loading="guardando"
                    data-prueba="router-conexion-guardar"
                />
            </div>
        </template>
    </USlideover>
</template>
