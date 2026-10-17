<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { FormSubmitEvent } from '@nuxt/ui'

/**
 * Alta de caja (`POST /cajas`, `cajas.crear`, A3). Cada empresa (NIT) tiene sus cajas: la caja es
 * de la empresa elegida (por defecto la activa) y el nombre es único dentro de ella (409
 * `caja_duplicada`). El cajero asignado es opcional; la lista sale de Usuarios si se puede leer.
 */
const abierto = defineModel<boolean>('open', { default: false })

const emit = defineEmits<{
    hecho: [caja: Caja]
}>()

const { puede } = usePermisos()
const { empresas, empresaId } = useEmpresaActiva()

const formulario = useTemplateRef('formulario')
const estado = reactive<DatosCrearCaja>({ nombre: '', cajero_id: null, empresa_id: null })
const enviando = ref(false)
const problema = ref<Problem | null>(null)
let clave = nuevaClaveIdempotencia()

const itemsEmpresa = computed(() => empresas.value.map(e => ({ label: e.nombre_comercial, value: e.id })))

const usuarios = shallowRef<UsuarioPanel[]>([])
const problemaUsuarios = ref<Problem | null>(null)
const cargandoUsuarios = ref(false)
const itemsCajero = computed(() => usuarios.value
    .filter(u => u.activo && (estado.empresa_id === null || u.alcance_global || (u.empresas ?? []).includes(estado.empresa_id)))
    .map(u => ({ label: u.nombre, description: u.email, value: u.id })))

/** Los selectores de Nuxt UI usan `undefined` para "sin elegir"; el esquema, `null`. */
const empresa = computed<number | undefined>({
    get: () => estado.empresa_id ?? undefined,
    set: (valor) => {
        estado.empresa_id = valor ?? null
    },
})
const cajero = computed<number | undefined>({
    get: () => estado.cajero_id ?? undefined,
    set: (valor) => {
        estado.cajero_id = valor ?? null
    },
})

async function cargarUsuarios() {
    if (!puede('usuarios.ver')) {
        return
    }
    cargandoUsuarios.value = true
    const resultado = await useUsuarios().listar()
    cargandoUsuarios.value = false
    usuarios.value = resultado.ok ? resultado.data.data : []
    problemaUsuarios.value = resultado.ok ? null : resultado.problema
}

watch(abierto, (valor) => {
    if (valor) {
        estado.nombre = ''
        estado.cajero_id = null
        estado.empresa_id = empresaId.value ?? (empresas.value.length === 1 ? empresas.value[0]?.id ?? null : null)
        problema.value = null
        clave = nuevaClaveIdempotencia()
        void cargarUsuarios()
    }
}, { immediate: true })

async function enviar(evento: FormSubmitEvent<DatosCrearCaja>) {
    enviando.value = true
    problema.value = null
    const resultado = await useCajas().crear(evento.data, clave)
    enviando.value = false
    if (resultado.ok) {
        abierto.value = false
        emit('hecho', resultado.data)
        return
    }
    problema.value = resultado.problema
    const { status } = resultado.problema
    if (status >= 400 && status < 500 && status !== 409) {
        clave = nuevaClaveIdempotencia()
    }
    if (codigoProblema(resultado.problema) === 'caja_duplicada') {
        clave = nuevaClaveIdempotencia()
        formulario.value?.setErrors([{ name: 'nombre', message: 'Esta empresa ya tiene una caja con ese nombre.' }])
    }
    else if (status === 422) {
        formulario.value?.setErrors(erroresDeFormulario(resultado.problema))
    }
}
</script>

<template>
    <UModal
        v-model:open="abierto"
        title="Nueva caja"
        description="La caja es de una empresa: cobra en efectivo solo sus facturas."
        :dismissible="!enviando"
    >
        <template #body>
            <UForm
                id="form-crear-caja"
                ref="formulario"
                :schema="esquemaCrearCaja"
                :state="estado"
                class="flex flex-col gap-4"
                @submit="enviar"
            >
                <UFormField
                    label="Nombre"
                    name="nombre"
                    required
                    help="Único dentro de la empresa (ej. Caja Sur, Ventanilla 2)."
                >
                    <UInput
                        v-model="estado.nombre"
                        autocomplete="off"
                        autofocus
                        class="w-full"
                    />
                </UFormField>

                <UFormField
                    v-if="empresas.length > 1"
                    label="Empresa"
                    name="empresa_id"
                    required
                >
                    <USelect
                        v-model="empresa"
                        :items="itemsEmpresa"
                        placeholder="Elige la empresa"
                        class="w-full"
                    />
                </UFormField>

                <UFormField
                    v-if="puede('usuarios.ver')"
                    label="Cajero asignado"
                    name="cajero_id"
                    help="Opcional. Cualquier usuario con permiso puede abrir el turno."
                >
                    <USelectMenu
                        v-model="cajero"
                        :items="itemsCajero"
                        value-key="value"
                        :loading="cargandoUsuarios"
                        placeholder="Sin cajero asignado"
                        clear
                        class="w-full"
                    />
                </UFormField>
                <ProblemaAlerta
                    v-if="problemaUsuarios"
                    :problema="problemaUsuarios"
                    :reintentar="cargarUsuarios"
                    :reintentando="cargandoUsuarios"
                />

                <ProblemaAlerta
                    v-if="problema && (problema.status !== 422 || !problema.errors?.length)"
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
                    form="form-crear-caja"
                    label="Crear caja"
                    icon="i-lucide-plus"
                    :loading="enviando"
                />
            </div>
        </template>
    </UModal>
</template>
