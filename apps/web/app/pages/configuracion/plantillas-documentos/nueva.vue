<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { FormSubmitEvent } from '@nuxt/ui'

/**
 * Configuración · nueva plantilla de documento (A5): documento, nombre, formato (carta o POS 80 mm)
 * y desde dónde empieza (la de fábrica de ese formato o una copia de otra del mismo documento).
 * `?tipo=` elige el documento y `?copiar=<id>` la plantilla a duplicar. Al crearla abre su editor.
 */
definePageMeta({ permiso: 'documentos.crear' })

useHead({ title: 'Nueva plantilla · Plantillas de documentos · ArgosIsp' })

const route = useRoute()
const toast = useToast()
const { puede } = usePermisos()
/** Para ofrecer copias de las existentes y abrir el editor al crear (`documentos.ver`). */
const puedeVer = computed(() => puede('documentos.ver'))

const tipoInicial = TIPOS_DOCUMENTO.find(t => t.value === route.query.tipo)?.value ?? 'aviso_cobro'
const copiarInicial = Number(route.query.copiar) || 0

const formulario = useTemplateRef('formulario')
const estado = reactive<SalidaNuevaPlantilla>({ tipo: tipoInicial, nombre: '', formato: 'carta', copiar_de_id: copiarInicial })
const enviando = ref(false)
const problemaCrear = ref<Problem | null>(null)

const existentes = shallowRef<PlantillaDocumentoResumen[] | null>(null)
const problemaLista = ref<Problem | null>(null)
const cargandoLista = ref(false)

async function cargarExistentes() {
    if (!puedeVer.value) {
        existentes.value = []
        estado.copiar_de_id = 0
        return
    }
    cargandoLista.value = true
    const resultado = await usePlantillasDocumentos().listar({ tipo: estado.tipo })
    cargandoLista.value = false
    existentes.value = resultado.ok ? resultado.data : null
    problemaLista.value = resultado.ok ? null : resultado.problema
    const origen = existentes.value?.find(p => p.id === estado.copiar_de_id)
    if (!origen) {
        estado.copiar_de_id = 0
    }
    else if (!estado.nombre) {
        estado.formato = origen.formato
        estado.nombre = `${origen.nombre} (copia)`.slice(0, 80)
    }
}

const origenes = computed(() => [
    { label: 'La plantilla de fábrica', description: 'La que trae ArgosIsp para el formato elegido', value: 0 },
    ...(existentes.value ?? []).map(p => ({
        label: `Copia de «${p.nombre}»`,
        description: `${etiquetaFormato(p.formato)}${p.predeterminada ? ' · predeterminada' : ''}${p.activa ? '' : ' · desactivada'}`,
        value: p.id,
    })),
])

watch(() => estado.tipo, () => {
    estado.copiar_de_id = 0
    void cargarExistentes()
})

watch(() => estado.copiar_de_id, (id) => {
    const origen = existentes.value?.find(p => p.id === id)
    if (origen) {
        estado.formato = origen.formato
    }
})

onMounted(cargarExistentes)

async function crear(evento: FormSubmitEvent<SalidaNuevaPlantilla>) {
    enviando.value = true
    problemaCrear.value = null
    const resultado = await usePlantillasDocumentos().crear({
        tipo: evento.data.tipo,
        nombre: evento.data.nombre,
        formato: evento.data.formato,
        copiar_de_id: evento.data.copiar_de_id || null,
    })
    enviando.value = false
    if (!resultado.ok) {
        problemaCrear.value = resultado.problema
        if (resultado.problema.status === 422) {
            formulario.value?.setErrors(erroresDeFormulario(resultado.problema))
        }
        return
    }
    toast.add({ title: 'Plantilla creada', description: `${resultado.data.nombre} · ${etiquetaFormato(resultado.data.formato)}`, icon: 'i-lucide-file-plus', color: 'success' })
    await navigateTo(puedeVer.value ? `/configuracion/plantillas-documentos/${resultado.data.id}` : '/')
}
</script>

<template>
    <PanelPagina
        id="plantilla-documento-nueva"
        titulo="Nueva plantilla"
        icono="i-lucide-file-plus"
    >
        <template #acciones>
            <UButton
                label="Plantillas"
                icon="i-lucide-arrow-left"
                color="neutral"
                variant="ghost"
                :to="`/configuracion/aviso-cobro${estado.tipo === 'aviso_cobro' ? '' : `?tipo=${estado.tipo}`}`"
            />
        </template>

        <UForm
            ref="formulario"
            :schema="esquemaNuevaPlantilla"
            :state="estado"
            class="flex w-full max-w-2xl flex-col gap-5"
            @submit="crear"
        >
            <UFormField
                name="tipo"
                label="Documento"
                required
                :help="TIPOS_DOCUMENTO.find(t => t.value === estado.tipo)?.descripcion"
            >
                <USelect
                    v-model="estado.tipo"
                    :items="TIPOS_DOCUMENTO"
                    class="w-full"
                    data-prueba="nueva-tipo"
                />
            </UFormField>

            <UFormField
                name="nombre"
                label="Nombre"
                required
                help="Así aparece al elegir con qué imprimir, por ejemplo «POS 80 mm» o «Carta con sello»."
            >
                <UInput
                    v-model="estado.nombre"
                    class="w-full"
                    placeholder="POS 80 mm"
                    data-prueba="nueva-nombre"
                />
            </UFormField>

            <UFormField
                name="formato"
                label="Formato"
                required
            >
                <URadioGroup
                    v-model="estado.formato"
                    :items="FORMATOS_DOCUMENTO"
                    variant="card"
                    orientation="horizontal"
                    :ui="{ fieldset: 'flex-col sm:flex-row', item: 'flex-1' }"
                    data-prueba="nueva-formato"
                />
            </UFormField>

            <UFormField
                name="copiar_de_id"
                label="Empezar desde"
                required
                help="Una copia lleva el HTML de la otra plantilla; luego la editas."
            >
                <ProblemaAlerta
                    v-if="problemaLista"
                    :problema="problemaLista"
                    :reintentar="cargarExistentes"
                    :reintentando="cargandoLista"
                />
                <USelect
                    v-else
                    v-model="estado.copiar_de_id"
                    :items="origenes"
                    :loading="cargandoLista"
                    class="w-full"
                    data-prueba="nueva-origen"
                />
            </UFormField>

            <ProblemaAlerta
                v-if="problemaCrear && problemaCrear.status !== 422"
                :problema="problemaCrear"
            />

            <div class="flex flex-wrap gap-2">
                <UButton
                    type="submit"
                    label="Crear plantilla"
                    icon="i-lucide-check"
                    :loading="enviando"
                    data-prueba="crear-plantilla"
                />
                <UButton
                    label="Cancelar"
                    color="neutral"
                    variant="ghost"
                    :to="`/configuracion/aviso-cobro${estado.tipo === 'aviso_cobro' ? '' : `?tipo=${estado.tipo}`}`"
                />
            </div>
        </UForm>
    </PanelPagina>
</template>
