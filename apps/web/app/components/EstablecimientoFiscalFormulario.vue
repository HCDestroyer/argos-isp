<script setup lang="ts">
import type { Problem, Schema } from '@argosisp/contracts'
import type { FormSubmitEvent } from '@nuxt/ui'

/**
 * Alta o edición de un establecimiento de la SAT (`fiscal.configurar`). El código SAT no se edita;
 * la edición manda la `version` (409 si alguien más lo cambió). El por defecto no se desmarca ni
 * se desactiva: se marca otro (422 `establecimiento_por_defecto`).
 */
const props = defineProps<{
    establecimiento: EstablecimientoFiscal | null
}>()

const abierto = defineModel<boolean>('open', { default: false })
const emit = defineEmits<{ guardado: [establecimiento: EstablecimientoFiscal, nuevo: boolean], recargar: [] }>()

const formulario = useTemplateRef('formulario')
const idFormulario = useId()
const estado = reactive<EntradaEstablecimiento>({ codigo: '', nombre: '', direccion: '', municipio: '', departamento: '', codigo_postal: '', cajas: [], por_defecto: false, activo: true })

/* Cajas de la empresa (P1: la factura sale de la sucursal de la caja que la cobra). */
const cajas = shallowRef<Schema<'Caja'>[]>([])
const itemsCajas = computed(() => cajas.value
    .filter(c => props.establecimiento ? c.empresa_id === props.establecimiento.empresa_id : true)
    .map(c => ({ label: c.nombre, value: c.id })))
onMounted(async () => {
    const resultado = await useCajas().listar()
    cajas.value = resultado.ok ? resultado.data : []
})
const enviando = ref(false)
const problema = ref<Problem | null>(null)
let clave = nuevaClaveIdempotencia()

const editando = computed(() => props.establecimiento !== null)
const conflicto = computed(() => editando.value && problema.value?.status === 409 && !(codigoProblema(problema.value) ?? '').startsWith('establecimiento'))

function reiniciar() {
    const e = props.establecimiento
    estado.codigo = e ? String(e.codigo) : ''
    estado.nombre = e?.nombre ?? ''
    estado.direccion = e?.direccion ?? ''
    estado.municipio = e?.municipio ?? ''
    estado.departamento = e?.departamento ?? ''
    estado.codigo_postal = e?.codigo_postal ?? ''
    estado.cajas = [...(e?.cajas ?? [])]
    estado.por_defecto = e?.por_defecto ?? false
    estado.activo = e?.activo ?? true
    problema.value = null
    clave = nuevaClaveIdempotencia()
    formulario.value?.clear()
}

watch(abierto, (valor) => {
    if (valor) {
        reiniciar()
    }
})
watch(() => props.establecimiento, () => {
    if (abierto.value) {
        reiniciar()
    }
})

async function guardar(evento: FormSubmitEvent<SalidaEstablecimiento>) {
    enviando.value = true
    problema.value = null
    const d = evento.data
    const cambios = { nombre: d.nombre, direccion: d.direccion, municipio: d.municipio, departamento: d.departamento, codigo_postal: d.codigo_postal, cajas: d.cajas, por_defecto: d.por_defecto, activo: d.activo }
    const api = useEstablecimientosFiscales()
    const resultado = props.establecimiento
        ? await api.editar(props.establecimiento.id, { ...cambios, version: props.establecimiento.version })
        : await api.crear(cuerpoEstablecimiento(evento.data), clave)
    enviando.value = false
    if (resultado.ok) {
        abierto.value = false
        emit('guardado', resultado.data, !props.establecimiento)
        return
    }
    if (codigoProblema(resultado.problema) === 'establecimiento_duplicado') {
        formulario.value?.setErrors([{ name: 'codigo', message: resultado.problema.detail ?? 'Ese código ya existe en la empresa' }])
        return
    }
    if (resultado.problema.status === 422 && resultado.problema.errors?.length) {
        formulario.value?.setErrors(erroresDeFormulario(resultado.problema))
        return
    }
    problema.value = resultado.problema.status === 409 ? resultado.problema : problemaFiscalLegible(resultado.problema)
}
</script>

<template>
    <USlideover
        v-model:open="abierto"
        :title="editando ? 'Editar establecimiento' : 'Nuevo establecimiento'"
        description="Establecimiento registrado en la SAT con el que se emiten los DTE."
        :dismissible="!enviando"
    >
        <template #body>
            <UForm
                :id="idFormulario"
                ref="formulario"
                :schema="esquemaEstablecimiento"
                :state="estado"
                class="flex flex-col gap-4"
                @submit="guardar"
            >
                <UFormField
                    label="Código SAT"
                    name="codigo"
                    required
                    :help="editando ? 'El código asignado por la SAT no se edita.' : 'Número que asignó la SAT al establecimiento.'"
                >
                    <UInput
                        v-model="estado.codigo"
                        inputmode="numeric"
                        :disabled="editando"
                        class="w-full font-mono"
                        autocomplete="off"
                    />
                </UFormField>
                <UFormField
                    label="Nombre"
                    name="nombre"
                    required
                >
                    <UInput
                        v-model="estado.nombre"
                        class="w-full"
                    />
                </UFormField>
                <UFormField
                    label="Dirección"
                    name="direccion"
                >
                    <UInput
                        v-model="estado.direccion"
                        class="w-full"
                    />
                </UFormField>
                <div class="grid gap-4 sm:grid-cols-2">
                    <UFormField
                        label="Municipio"
                        name="municipio"
                    >
                        <UInput
                            v-model="estado.municipio"
                            class="w-full"
                        />
                    </UFormField>
                    <UFormField
                        label="Departamento"
                        name="departamento"
                    >
                        <UInput
                            v-model="estado.departamento"
                            class="w-full"
                        />
                    </UFormField>
                    <UFormField
                        label="Código postal"
                        name="codigo_postal"
                        hint="Opcional"
                        help="El del RTU. Sin él, el DTE sale con 01001."
                    >
                        <UInput
                            v-model="estado.codigo_postal"
                            inputmode="numeric"
                            maxlength="5"
                            class="w-full font-mono"
                            data-prueba="establecimiento-codigo-postal"
                        />
                    </UFormField>
                </div>
                <UFormField
                    label="Cajas que cobran por esta sucursal"
                    name="cajas"
                    help="Las facturas cobradas en estas cajas salen por este establecimiento; las demás (cron, Iris, API), por el establecimiento por defecto."
                >
                    <USelectMenu
                        v-model="estado.cajas"
                        :items="itemsCajas"
                        value-key="value"
                        multiple
                        placeholder="Ninguna"
                        class="w-full"
                        data-prueba="establecimiento-cajas"
                    />
                </UFormField>
                <UFormField
                    name="por_defecto"
                    :help="establecimiento?.por_defecto ? 'Es el por defecto: para cambiarlo, marca otro como por defecto.' : 'Con él se emiten los DTE; el anterior deja de serlo.'"
                >
                    <USwitch
                        v-model="estado.por_defecto"
                        :disabled="establecimiento?.por_defecto === true"
                        label="Por defecto"
                    />
                </UFormField>
                <UFormField
                    v-if="editando"
                    name="activo"
                    :help="estado.activo ? undefined : 'Inactivo: deja de usarse para emitir; no se borra.'"
                >
                    <USwitch
                        v-model="estado.activo"
                        :disabled="establecimiento?.por_defecto === true"
                        label="Activo"
                    />
                </UFormField>
                <p
                    v-if="establecimiento"
                    class="text-xs text-muted"
                >
                    Versión {{ establecimiento.version }}
                </p>

                <UAlert
                    v-if="conflicto"
                    color="warning"
                    variant="subtle"
                    icon="i-lucide-git-compare"
                    title="Alguien más cambió este establecimiento"
                    description="Recarga para ver la versión actual y vuelve a aplicar tus cambios."
                    :actions="[{ label: 'Recargar', icon: 'i-lucide-refresh-cw', color: 'neutral', variant: 'outline', onClick: () => emit('recargar') }]"
                />
                <ProblemaAlerta
                    v-else-if="problema"
                    :problema="problema"
                />
            </UForm>
        </template>
        <template #footer>
            <div class="flex w-full justify-end gap-2">
                <UButton
                    label="Cancelar"
                    :icon="ICONOS.cancelar"
                    color="neutral"
                    variant="ghost"
                    :disabled="enviando"
                    @click="abierto = false"
                />
                <UButton
                    type="submit"
                    :form="idFormulario"
                    :label="editando ? 'Guardar cambios' : 'Crear establecimiento'"
                    icon="i-lucide-check"
                    :loading="enviando"
                />
            </div>
        </template>
    </USlideover>
</template>
