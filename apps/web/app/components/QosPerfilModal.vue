<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { FormSubmitEvent, SelectItem } from '@nuxt/ui'

/**
 * Crear un perfil de QoS copiando las clases activas de otro (`POST /qos/perfiles`, `qos.gestionar`,
 * `contratos/qos.md` §4). Común a todas las empresas (solo con alcance global) o de una empresa;
 * el origen debe ser común o de esa misma empresa. 409 `qos_nombre_duplicado` junto al nombre.
 */
const props = defineProps<{
    perfiles: PerfilQos[]
    /** Perfil de origen elegido al abrir (por defecto, el predeterminado). */
    copiarDe?: number | null
}>()

const abierto = defineModel<boolean>('open', { default: false })
const emit = defineEmits<{ creado: [perfil: PerfilQos] }>()

const { empresas, empresaId, alcanceGlobal, conSelector } = useEmpresaActiva()

const idFormulario = useId()
const formulario = useTemplateRef('formulario')
const estado = reactive<EntradaPerfilQos>({ nombre: '', descripcion: '', empresa_id: SIN_EMPRESA, copiar_de: 0 })
const enviando = ref(false)
const problema = ref<Problem | null>(null)
let claveIdempotencia = nuevaClaveIdempotencia()

const predeterminado = computed(() => props.perfiles.find(p => p.predeterminado) ?? props.perfiles[0] ?? null)

watch(abierto, (valor) => {
    if (!valor) {
        return
    }
    const origen = props.perfiles.find(p => p.id === props.copiarDe) ?? predeterminado.value
    Object.assign(estado, {
        nombre: origen ? `Copia de ${origen.nombre}` : '',
        descripcion: '',
        // Sin alcance global solo se crean perfiles de una empresa.
        empresa_id: origen?.empresa_id ?? (alcanceGlobal.value ? SIN_EMPRESA : empresaId.value ?? empresas.value[0]?.id ?? SIN_EMPRESA),
        copiar_de: origen?.id ?? 0,
    })
    problema.value = null
    claveIdempotencia = nuevaClaveIdempotencia()
}, { immediate: true })

const itemsEmpresa = computed<SelectItem[]>(() => [
    ...(alcanceGlobal.value ? [{ label: 'Común a todas las empresas', value: SIN_EMPRESA }] : []),
    ...empresas.value.map(e => ({ label: e.nombre_comercial, value: e.id })),
])

/** Solo se copia de un perfil común o de la misma empresa. */
const origenes = computed(() => props.perfiles.filter(p => p.empresa_id === null || p.empresa_id === estado.empresa_id))
const itemsOrigen = computed<SelectItem[]>(() => origenes.value.map(p => ({ label: `${p.nombre}${p.predeterminado ? ' (predeterminado)' : ''} · ${p.clases.filter(c => c.activa).length} clases`, value: p.id })))

watch(() => estado.empresa_id, () => {
    if (!origenes.value.some(p => p.id === estado.copiar_de)) {
        estado.copiar_de = predeterminado.value?.id ?? 0
    }
})

async function enviar(evento: FormSubmitEvent<SalidaPerfilQos>) {
    enviando.value = true
    problema.value = null
    const resultado = await useQos().crearPerfil(cuerpoPerfilQos(evento.data), claveIdempotencia)
    enviando.value = false
    if (resultado.ok) {
        abierto.value = false
        emit('creado', resultado.data)
        return
    }
    if (resultado.problema.type.endsWith(':qos_nombre_duplicado')) {
        formulario.value?.setErrors([{ name: 'nombre', message: resultado.problema.detail ?? 'Ya existe un perfil con ese nombre' }])
        return
    }
    const errores = erroresDeFormulario(resultado.problema)
    if (errores.length) {
        formulario.value?.setErrors(errores)
    }
    problema.value = resultado.problema
}
</script>

<template>
    <UModal
        v-model:open="abierto"
        title="Nuevo perfil de QoS"
        description="Se crea con una copia de las clases activas del perfil de origen. Ningún router lo usa hasta que lo elijas en su ficha."
        :dismissible="!enviando"
    >
        <template #body>
            <UForm
                :id="idFormulario"
                ref="formulario"
                :schema="esquemaPerfilQos"
                :state="estado"
                class="flex flex-col gap-4"
                @submit="enviar"
            >
                <UFormField
                    label="Nombre"
                    name="nombre"
                    required
                >
                    <UInput
                        v-model="estado.nombre"
                        class="w-full"
                        data-prueba="perfil-nombre"
                    />
                </UFormField>
                <UFormField
                    label="Descripción"
                    name="descripcion"
                >
                    <UTextarea
                        v-model="estado.descripcion"
                        :rows="2"
                        class="w-full"
                    />
                </UFormField>
                <UFormField
                    v-if="conSelector || alcanceGlobal"
                    label="Empresa"
                    name="empresa_id"
                    help="Un router solo usa perfiles comunes o de su empresa sugerida."
                >
                    <USelect
                        v-model="estado.empresa_id"
                        :items="itemsEmpresa"
                        class="w-full"
                        data-prueba="perfil-empresa"
                    />
                </UFormField>
                <UFormField
                    label="Copiar las clases de"
                    name="copiar_de"
                    required
                >
                    <USelect
                        v-model="estado.copiar_de"
                        :items="itemsOrigen"
                        class="w-full"
                        data-prueba="perfil-copiar-de"
                    />
                </UFormField>
                <ProblemaAlerta
                    v-if="problema"
                    :problema="problema"
                />
            </UForm>
        </template>
        <template #footer>
            <div class="flex w-full justify-end gap-2">
                <UButton
                    label="Cancelar"
                    color="neutral"
                    variant="ghost"
                    :disabled="enviando"
                    @click="abierto = false"
                />
                <UButton
                    type="submit"
                    :form="idFormulario"
                    label="Crear perfil"
                    icon="i-lucide-copy-plus"
                    :loading="enviando"
                    data-prueba="crear-perfil"
                />
            </div>
        </template>
    </UModal>
</template>
