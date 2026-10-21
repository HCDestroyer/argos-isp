<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { FormSubmitEvent, SelectItem } from '@nuxt/ui'

/**
 * Excepción a un bloqueo (`POST /libro/bloqueos/excepciones`, `libro.excepcion_bloqueo`, solo admin):
 * deja a un usuario (o a todos) registrar bajo un tipo de bloqueo hasta una fecha y hora de fin, que
 * siempre lleva (422 `excepcion_sin_fin`). Cubre solo su tipo y nunca el duro. Cada asiento que entra
 * por ella guarda su id.
 */
const props = defineProps<{
    empresaId: number
    empresa?: string | null
    vigentes: BloqueosEmpresa['vigentes']
}>()

const abierto = defineModel<boolean>('open', { default: false })
const emit = defineEmits<{ hecho: [excepcion: ExcepcionBloqueo] }>()

const { puede } = usePermisos()
const formulario = useTemplateRef('formulario')
const enviando = ref(false)
const problema = ref<Problem | null>(null)
let clave = nuevaClaveIdempotencia()

interface Entrada {
    tipo: TipoBloqueoNormal
    usuario_id: number | null
    motivo: string
    hasta_en: string
}

const estado = reactive<Entrada>({ tipo: 'global', usuario_id: null, motivo: '', hasta_en: '' })
const esquema = computed(() => esquemaExcepcion(Date.now()))
const usuarios = shallowRef<UsuarioPanel[]>([])
const problemaUsuarios = ref<Problem | null>(null)

const itemsTipo = computed<SelectItem[]>(() => TIPOS_NORMALES.map(t => ({ label: TIPOS_BLOQUEO[t].etiqueta, value: t, description: props.vigentes[t] ? `Bloqueado hasta ${formatearFecha(props.vigentes[t] ?? '')}` : 'Sin bloqueo' })))
const TODOS = 0
const itemsUsuario = computed<SelectItem[]>(() => [
    { label: 'Todos los usuarios', value: TODOS },
    ...usuarios.value.filter(u => u.activo).map(u => ({ label: u.nombre, value: u.id, description: u.email })),
])
const usuarioElegido = computed({
    get: () => estado.usuario_id ?? TODOS,
    set: (valor: number) => {
        estado.usuario_id = valor === TODOS ? null : valor
    },
})

async function cargarUsuarios() {
    if (!puede('usuarios.ver')) {
        return
    }
    problemaUsuarios.value = null
    const resultado = await useUsuarios().listar()
    usuarios.value = resultado.ok ? resultado.data.data : []
    problemaUsuarios.value = resultado.ok ? null : resultado.problema
}

watch(abierto, (valor) => {
    if (valor) {
        const primero = TIPOS_NORMALES.find(t => props.vigentes[t]) ?? 'global'
        Object.assign(estado, { tipo: primero, usuario_id: null, motivo: '', hasta_en: '' })
        problema.value = null
        clave = nuevaClaveIdempotencia()
        void cargarUsuarios()
    }
})

async function enviar(evento: FormSubmitEvent<Entrada>) {
    enviando.value = true
    problema.value = null
    const d = evento.data
    const resultado = await useBloqueosLibro().crearExcepcion({
        empresa_id: props.empresaId,
        tipo: d.tipo,
        usuario_id: d.usuario_id,
        motivo: d.motivo,
        hasta_en: instanteGuatemala(d.hasta_en),
    }, clave)
    enviando.value = false
    if (resultado.ok) {
        abierto.value = false
        emit('hecho', resultado.data)
        return
    }
    const errores = erroresDeFormulario(resultado.problema).filter(e => e.name && e.name in estado)
    if (errores.length) {
        formulario.value?.setErrors(errores)
    }
    problema.value = problemaBloqueoLegible(resultado.problema)
}
</script>

<template>
    <UModal
        v-model:open="abierto"
        title="Excepción a un bloqueo"
        :description="empresa ?? undefined"
        :dismissible="!enviando"
    >
        <template #body>
            <UForm
                id="form-excepcion-bloqueo"
                ref="formulario"
                :schema="esquema"
                :state="estado"
                class="flex flex-col gap-4"
                @submit="enviar"
            >
                <UAlert
                    color="warning"
                    variant="subtle"
                    icon="i-lucide-key-round"
                    description="Mientras esté vigente, quien la tenga puede registrar con fecha bajo ese bloqueo. Cubre solo su tipo y nunca el bloqueo duro; cada asiento que entra por ella queda marcado."
                />
                <UFormField
                    label="Bloqueo que cubre"
                    name="tipo"
                    required
                >
                    <USelect
                        v-model="estado.tipo"
                        :items="itemsTipo"
                        class="w-full"
                        data-prueba="excepcion-tipo"
                    />
                </UFormField>
                <UFormField
                    label="Usuario"
                    name="usuario_id"
                    :help="puede('usuarios.ver') ? undefined : 'Sin permiso para ver usuarios: la excepción será para todos.'"
                >
                    <USelect
                        v-model="usuarioElegido"
                        :items="itemsUsuario"
                        :disabled="!puede('usuarios.ver')"
                        class="w-full"
                        data-prueba="excepcion-usuario"
                    />
                </UFormField>
                <ProblemaAlerta
                    v-if="problemaUsuarios"
                    :problema="problemaUsuarios"
                    :reintentar="cargarUsuarios"
                />
                <UFormField
                    label="Vigente hasta"
                    name="hasta_en"
                    required
                    help="Fecha y hora de Guatemala. Después deja de cubrir asientos nuevos."
                >
                    <UInput
                        v-model="estado.hasta_en"
                        type="datetime-local"
                        class="w-full"
                        data-prueba="excepcion-hasta"
                    />
                </UFormField>
                <UFormField
                    label="Motivo"
                    name="motivo"
                    required
                >
                    <UTextarea
                        v-model="estado.motivo"
                        :rows="2"
                        autoresize
                        class="w-full"
                        data-prueba="excepcion-motivo"
                    />
                </UFormField>
                <ProblemaAlerta
                    v-if="problema"
                    :problema="problema"
                    data-prueba="excepcion-problema"
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
                    form="form-excepcion-bloqueo"
                    label="Crear excepción"
                    icon="i-lucide-key-round"
                    :loading="enviando"
                    data-prueba="confirmar-excepcion"
                />
            </div>
        </template>
    </UModal>
</template>
