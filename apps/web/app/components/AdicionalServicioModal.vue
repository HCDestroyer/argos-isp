<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { FormSubmitEvent, RadioGroupItem, SelectItem } from '@nuxt/ui'

/**
 * Agregar (`POST /servicios/:id/adicionales`, `servicios.agregar_adicional`) o editar
 * (`PUT …/:asignacionId`, `servicios.editar_adicional`, con `version`) un adicional del servicio.
 * La cortesía solo se ofrece con `servicios.adicional_cortesia` y exige motivo; el cobrado, precio.
 * La credencial se guarda cifrada y nunca vuelve: aquí solo se escribe, reemplaza o borra.
 */
const props = defineProps<{
    servicio: Servicio
    /** Asignación a editar; sin ella, alta. */
    asignacion: AdicionalServicio | null
}>()

const abierto = defineModel<boolean>('open', { default: false })
const emit = defineEmits<{ guardado: [asignacion: AdicionalServicio, nuevo: boolean] }>()

const { puede } = usePermisos()
const usuario = useUsuarioActual()
const idFormulario = useId()
const formulario = useTemplateRef('formulario')

const estado = reactive<EntradaAsignacion>(entradaAsignacion(null))
const credencial = ref<Secreto>({ accion: 'conservar', valor: '' })
const catalogo = shallowRef<Adicional[]>([])
const motivos = shallowRef<MotivoCortesia[]>([])
const cargandoListas = ref(false)
const problemaListas = ref<Problem | null>(null)
const enviando = ref(false)
const problema = ref<Problem | null>(null)
let claveIdempotencia = nuevaClaveIdempotencia()

const puedeCortesia = computed(() => puede('servicios.adicional_cortesia'))
/** Sin el permiso, una cortesía existente se conserva tal cual: no se cambia su motivo. */
const motivoBloqueado = computed(() => !puedeCortesia.value)

const itemsModalidad = computed<SelectItem[]>(() => (Object.keys(MODALIDADES_ADICIONAL) as ModalidadAdicional[])
    .filter(m => m !== 'cortesia' || puedeCortesia.value || props.asignacion?.modalidad === 'cortesia')
    .map(m => ({ label: MODALIDADES_ADICIONAL[m].etiqueta, value: m, icon: MODALIDADES_ADICIONAL[m].icono })))

const itemsAdicional = computed<SelectItem[]>(() => catalogo.value.map(a => ({
    label: `${a.nombre} · ${a.codigo}${a.precio_sugerido ? ` · sugerido ${formatearQuetzales(a.precio_sugerido)}` : ''}`,
    value: a.id,
})))

const itemsPrimerPeriodo: RadioGroupItem[] = (Object.keys(PRIMEROS_PERIODOS_ADICIONAL) as PrimerPeriodoAdicional[])
    .map(valor => ({ label: PRIMEROS_PERIODOS_ADICIONAL[valor].etiqueta, description: PRIMEROS_PERIODOS_ADICIONAL[valor].ayuda, value: valor }))
/** Al editar un cobrado, el periodo ya empezó a cobrarse: cambiarlo afecta la próxima factura. */
const yaCobrado = computed(() => props.asignacion?.modalidad === 'cobrado')

const itemsMotivo = computed<SelectItem[]>(() => motivos.value.map(m => ({ label: m.nombre, value: m.id })))

async function cargarListas() {
    cargandoListas.value = true
    problemaListas.value = null
    const necesitaMotivos = puedeCortesia.value || props.asignacion?.modalidad === 'cortesia'
    const [adicionales, listaMotivos] = await Promise.all([
        // Con alcance global, el catálogo de todas las empresas (el servicio puede ser de otra que la activa).
        props.asignacion ? null : useAdicionales().activos(usuario.value?.alcance_global ? { empresas: 'todas' } : {}),
        necesitaMotivos ? useAdicionales().motivos(usuario.value?.alcance_global ? { activo: true, empresas: 'todas' } : { activo: true }) : null,
    ])
    cargandoListas.value = false
    if (adicionales) {
        // Solo los de la empresa del servicio (422 `adicional_de_otra_empresa` si no).
        catalogo.value = adicionales.ok ? adicionales.data.filter(a => a.empresa_id === props.servicio.empresa_id) : []
    }
    if (listaMotivos) {
        // Los comunes (`empresa_id = null`) y los de la empresa del servicio.
        motivos.value = listaMotivos.ok ? listaMotivos.data.filter(m => m.empresa_id === null || m.empresa_id === props.servicio.empresa_id) : []
    }
    const fallo = (adicionales && !adicionales.ok ? adicionales.problema : null) ?? (listaMotivos && !listaMotivos.ok ? listaMotivos.problema : null)
    problemaListas.value = fallo
}

watch(abierto, (valor) => {
    if (valor) {
        Object.assign(estado, entradaAsignacion(props.asignacion))
        credencial.value = { accion: 'conservar', valor: '' }
        problema.value = null
        claveIdempotencia = nuevaClaveIdempotencia()
        void cargarListas()
    }
}, { immediate: true })

/** Al elegir un adicional cobrado sin precio escrito, se propone el sugerido del catálogo. */
watch(() => estado.adicional_id, (id) => {
    const elegido = catalogo.value.find(a => a.id === id)
    if (elegido?.precio_sugerido && !estado.precio) {
        estado.precio = elegido.precio_sugerido
    }
})

async function enviar(evento: FormSubmitEvent<SalidaAsignacion>) {
    enviando.value = true
    problema.value = null
    const resultado = props.asignacion
        ? await useAdicionalesServicio().editar(props.servicio.id, props.asignacion.id, cambiosAsignacion(props.asignacion, evento.data, credencial.value))
        : await useAdicionalesServicio().agregar(props.servicio.id, cuerpoAsignacion(evento.data, credencial.value.accion === 'reemplazar' ? credencial.value.valor : ''), claveIdempotencia)
    enviando.value = false
    if (resultado.ok) {
        abierto.value = false
        emit('guardado', resultado.data, props.asignacion === null)
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
        :title="asignacion ? `Editar ${asignacion.adicional_nombre}` : 'Agregar adicional'"
        :description="asignacion ? `${asignacion.adicional_codigo} · versión ${asignacion.version}` : 'Del catálogo de la empresa del servicio.'"
        :dismissible="!enviando"
    >
        <template #body>
            <UForm
                :id="idFormulario"
                ref="formulario"
                :schema="esquemaAsignacion"
                :state="estado"
                class="flex flex-col gap-4"
                @submit="enviar"
            >
                <ProblemaAlerta
                    v-if="problemaListas"
                    :problema="problemaListas"
                    :reintentar="cargarListas"
                    :reintentando="cargandoListas"
                />

                <UFormField
                    v-if="!asignacion"
                    label="Adicional"
                    name="adicional_id"
                    required
                >
                    <USelect
                        v-model="estado.adicional_id"
                        :items="itemsAdicional"
                        :loading="cargandoListas"
                        placeholder="Elige del catálogo"
                        class="w-full"
                        data-prueba="asignacion-adicional"
                    />
                    <template
                        v-if="!cargandoListas && !problemaListas && !catalogo.length"
                        #help
                    >
                        No hay adicionales activos en el catálogo de esta empresa.
                    </template>
                </UFormField>

                <UFormField
                    label="Modalidad"
                    name="modalidad"
                    :help="MODALIDADES_ADICIONAL[estado.modalidad].ayuda"
                    required
                >
                    <USelect
                        v-model="estado.modalidad"
                        :items="itemsModalidad"
                        class="w-full"
                        data-prueba="asignacion-modalidad"
                    />
                </UFormField>

                <UFormField
                    v-if="estado.modalidad === 'cobrado'"
                    label="Precio mensual"
                    name="precio"
                    required
                >
                    <UInput
                        v-model="estado.precio"
                        inputmode="decimal"
                        placeholder="35.00"
                        class="w-full"
                        data-prueba="asignacion-precio"
                    >
                        <template #leading>
                            <span class="text-sm text-muted">Q</span>
                        </template>
                    </UInput>
                </UFormField>

                <UFormField
                    v-if="estado.modalidad === 'cobrado'"
                    label="Este mes"
                    name="primer_periodo"
                    :help="yaCobrado && asignacion?.cobrado_desde ? `Se cobra desde el ${formatearFecha(asignacion.cobrado_desde)}; el cambio aplica en la siguiente factura.` : undefined"
                    required
                >
                    <URadioGroup
                        v-model="estado.primer_periodo"
                        :items="itemsPrimerPeriodo"
                        data-prueba="asignacion-primer-periodo"
                    />
                </UFormField>

                <template v-if="estado.modalidad === 'cortesia'">
                    <UFormField
                        label="Motivo de la cortesía"
                        name="motivo_id"
                        :help="motivoBloqueado ? 'Cambiar el motivo pide el permiso servicios.adicional_cortesia.' : undefined"
                        required
                    >
                        <USelect
                            v-model="estado.motivo_id"
                            :items="itemsMotivo"
                            :loading="cargandoListas"
                            :disabled="motivoBloqueado"
                            placeholder="Elige el motivo"
                            class="w-full"
                            data-prueba="asignacion-motivo"
                        />
                    </UFormField>
                    <UFormField
                        label="Detalle (opcional)"
                        name="motivo_detalle"
                    >
                        <UTextarea
                            v-model="estado.motivo_detalle"
                            :rows="2"
                            :disabled="motivoBloqueado"
                            placeholder="Ej.: tres días sin servicio por la avería de la zona"
                            class="w-full"
                        />
                    </UFormField>
                </template>

                <UFormField
                    label="Identificador"
                    name="identificador"
                    help="Usuario de IPTV, correo de la cuenta de streaming…"
                >
                    <UInput
                        v-model="estado.identificador"
                        autocomplete="off"
                        class="w-full"
                        data-prueba="asignacion-identificador"
                    />
                </UFormField>

                <CampoSecreto
                    v-model="credencial"
                    :guardado="asignacion?.tiene_credencial ? '***' : null"
                    etiqueta="Credencial"
                    nombre="credencial"
                    placeholder="Contraseña o PIN del adicional"
                />

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
                    :label="asignacion ? 'Guardar' : 'Agregar'"
                    icon="i-lucide-save"
                    :loading="enviando"
                    data-prueba="guardar-asignacion"
                />
            </div>
        </template>
    </UModal>
</template>
