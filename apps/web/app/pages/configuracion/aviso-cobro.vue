<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { FormSubmitEvent } from '@nuxt/ui'

/**
 * Configuración · plantilla del aviso de cobro (A5): HTML con variables Mustache que genera el
 * PDF de cada factura. Las variables salen de la API (`GET /documentos/plantillas/aviso_cobro`) y
 * se insertan donde está el cursor. La vista previa usa datos de ejemplo y no guarda. Guardar
 * manda la `version` leída (409 si alguien más la guardó). Sin `documentos.editar`, solo lectura.
 */
definePageMeta({ permiso: 'documentos.ver' })

useHead({ title: 'Plantilla del aviso · ArgosIsp' })

const { puede } = usePermisos()
const toast = useToast()

const plantilla = shallowRef<PlantillaDocumento | null>(null)
const cargando = ref(false)
const problema = ref<Problem | null>(null)

const formulario = useTemplateRef('formulario')
const editor = useTemplateRef('editor')
const estado = reactive({ html: '' })
const enviando = ref(false)
const problemaGuardar = ref<Problem | null>(null)

const EJEMPLO_VARIABLE = '{{variable}}'
const EJEMPLO_SECCION = '{{#x}}…{{/x}}'

const editable = computed(() => puede('documentos.editar'))
const sinCambios = computed(() => plantilla.value?.html === estado.html)
const conflicto = computed(() => problemaGuardar.value?.status === 409)

// Vista previa
const urlVista = ref<string | null>(null)
const generando = ref(false)
const problemaVista = ref<Problem | null>(null)
const vistaDesactualizada = ref(false)

const filtro = ref('')
const gruposVariables = computed(() => {
    const texto = filtro.value.trim().toLowerCase()
    const grupos = new Map<string, VariableDocumento[]>()
    for (const variable of plantilla.value?.variables ?? []) {
        if (texto && !variable.nombre.toLowerCase().includes(texto) && !variable.descripcion.toLowerCase().includes(texto)) {
            continue
        }
        const prefijo = variable.nombre.split('.')[0] ?? ''
        const grupo = GRUPOS_VARIABLES[prefijo] ?? 'Otras'
        grupos.set(grupo, [...(grupos.get(grupo) ?? []), variable])
    }
    return [...grupos.entries()].map(([etiqueta, variables]) => ({ etiqueta, variables }))
})

/**
 * Variables del PDF FEL (A5, fase 3) que una plantilla ya guardada no recibe sola: la API solo da
 * la de fábrica mientras nadie la guarde (`version` 0). Si la guardada no las usa y la API sí las
 * ofrece, se avisa y se puede insertar el bloque FEL donde está el cursor.
 */
const VARIABLES_BLOQUE_FEL = ['factura.fel_tipo', 'factura.fel_fecha', 'factura.fel_anulado'] as const
const faltanFel = computed(() => {
    if (!plantilla.value || plantilla.value.version === 0) {
        return []
    }
    const ofrecidas = new Set(plantilla.value.variables.map(v => v.nombre))
    return VARIABLES_BLOQUE_FEL.filter(nombre => ofrecidas.has(nombre) && !estado.html.includes(nombre))
})

/** El bloque FEL de la plantilla de fábrica (A5): tipo, serie, número, autorización, fecha y anulación. */
const BLOQUE_FEL = `{{#factura.fel}}
<p class="tenue"><small>Documento Tributario Electrónico (FEL) · {{factura.fel_tipo}} · Serie {{factura.fel_serie}} · Número {{factura.fel_numero}}<br>Autorización {{factura.fel_uuid}}{{#factura.fel_fecha}}<br>Certificado el {{factura.fel_fecha}}{{/factura.fel_fecha}}</small></p>
{{#factura.fel_anulado}}<p><strong>Documento anulado ante la SAT.</strong></p>{{/factura.fel_anulado}}
{{/factura.fel}}
`

function insertarBloqueFel() {
    const area = editor.value?.textareaRef
    const inicio = area?.selectionStart ?? estado.html.length
    const fin = area?.selectionEnd ?? estado.html.length
    estado.html = `${estado.html.slice(0, inicio)}${BLOQUE_FEL}${estado.html.slice(fin)}`
}

function rellenar(datos: PlantillaDocumento) {
    plantilla.value = datos
    estado.html = datos.html
    formulario.value?.clear()
}

async function cargar() {
    cargando.value = true
    const resultado = await useDocumentos().plantilla()
    cargando.value = false
    problema.value = resultado.ok ? null : resultado.problema
    if (resultado.ok) {
        problemaGuardar.value = null
        rellenar(resultado.data)
    }
}

/** Inserta la variable donde está el cursor (o reemplaza la selección) y deja el cursor dentro. */
function insertar(variable: VariableDocumento) {
    const area = editor.value?.textareaRef
    const { texto, cursor } = marcaVariable(variable)
    const inicio = area?.selectionStart ?? estado.html.length
    const fin = area?.selectionEnd ?? estado.html.length
    estado.html = `${estado.html.slice(0, inicio)}${texto}${estado.html.slice(fin)}`
    void nextTick(() => {
        if (area) {
            area.focus()
            area.setSelectionRange(inicio + cursor, inicio + cursor)
        }
    })
}

function liberarVista() {
    if (urlVista.value) {
        URL.revokeObjectURL(urlVista.value)
        urlVista.value = null
    }
}

async function generarVista() {
    const validacion = esquemaPlantillaDocumento.safeParse({ html: estado.html })
    if (!validacion.success) {
        formulario.value?.setErrors(validacion.error.issues.map(i => ({ name: 'html', message: i.message })))
        return
    }
    generando.value = true
    problemaVista.value = null
    const resultado = await useDocumentos().vistaPrevia(estado.html)
    generando.value = false
    if (!resultado.ok) {
        problemaVista.value = resultado.problema
        if (resultado.problema.status === 422) {
            formulario.value?.setErrors(erroresDeFormulario(resultado.problema))
        }
        return
    }
    liberarVista()
    urlVista.value = URL.createObjectURL(resultado.data)
    vistaDesactualizada.value = false
}

async function guardar(evento: FormSubmitEvent<SalidaPlantillaDocumento>) {
    if (!plantilla.value) {
        return
    }
    enviando.value = true
    problemaGuardar.value = null
    const resultado = await useDocumentos().guardarPlantilla(evento.data.html, plantilla.value.version)
    enviando.value = false
    if (!resultado.ok) {
        problemaGuardar.value = resultado.problema
        if (resultado.problema.status === 422) {
            formulario.value?.setErrors(erroresDeFormulario(resultado.problema))
        }
        return
    }
    rellenar(resultado.data)
    toast.add({ title: 'Plantilla guardada', description: `Versión ${resultado.data.version}. Los próximos PDF ya la usan.`, icon: 'i-lucide-file-check', color: 'success' })
}

watch(() => estado.html, () => {
    if (urlVista.value) {
        vistaDesactualizada.value = true
    }
})

onMounted(cargar)
onBeforeUnmount(liberarVista)
</script>

<template>
    <PanelPagina
        id="aviso-cobro"
        titulo="Plantilla del aviso de cobro"
        icono="i-lucide-file-code-2"
    >
        <ProblemaAlerta
            v-if="problema"
            :problema="problema"
            :reintentar="cargar"
            :reintentando="cargando"
        />
        <div
            v-else-if="!plantilla"
            class="grid gap-4 lg:grid-cols-2"
        >
            <USkeleton class="h-96" />
            <USkeleton class="h-96" />
        </div>
        <div
            v-else
            class="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]"
        >
            <UForm
                ref="formulario"
                :schema="esquemaPlantillaDocumento"
                :state="estado"
                :disabled="!editable"
                class="flex min-w-0 flex-col gap-4"
                @submit="guardar"
            >
                <div class="flex flex-wrap items-center gap-2 text-sm text-muted">
                    <UBadge
                        :label="plantilla.version === 0 ? 'Plantilla de fábrica' : `Versión ${plantilla.version}`"
                        :color="plantilla.version === 0 ? 'neutral' : 'info'"
                        variant="subtle"
                    />
                    <span>HTML con variables <span class="font-mono">{{ EJEMPLO_VARIABLE }}</span>; una sección <span class="font-mono">{{ EJEMPLO_SECCION }}</span> se oculta si el dato está vacío.</span>
                </div>

                <UAlert
                    v-if="faltanFel.length"
                    color="warning"
                    variant="subtle"
                    icon="i-lucide-badge-check"
                    title="Tu plantilla guardada no tiene el bloque FEL nuevo"
                    :description="`Una plantilla ya guardada no recibe sola las variables nuevas del PDF FEL: falta ${faltanFel.join(', ')}. Inserta el bloque donde está el cursor (o reemplaza el anterior) y guarda.`"
                    :actions="editable ? [{ label: 'Insertar bloque FEL', icon: 'i-lucide-text-cursor-input', color: 'warning', variant: 'outline', onClick: insertarBloqueFel }] : undefined"
                    data-prueba="falta-bloque-fel"
                />

                <UFormField
                    name="html"
                    label="HTML de la plantilla"
                    :help="`${estado.html.length.toLocaleString('es-GT')} / 100,000 caracteres`"
                >
                    <UTextarea
                        ref="editor"
                        v-model="estado.html"
                        :rows="22"
                        spellcheck="false"
                        aria-label="HTML de la plantilla"
                        class="w-full"
                        :ui="{ base: 'font-mono text-xs leading-5' }"
                    />
                </UFormField>

                <UAlert
                    v-if="conflicto"
                    color="warning"
                    variant="subtle"
                    icon="i-lucide-git-compare"
                    title="Alguien más guardó la plantilla"
                    description="Recarga para ver la versión actual. Copia antes tus cambios si quieres conservarlos: se reemplazan."
                    :actions="[{ label: 'Recargar', icon: 'i-lucide-refresh-cw', color: 'neutral', variant: 'outline', onClick: cargar }]"
                    data-prueba="conflicto-version"
                />
                <ProblemaAlerta
                    v-else-if="problemaGuardar && problemaGuardar.status !== 422"
                    :problema="problemaGuardar"
                />

                <div class="flex flex-wrap items-center gap-2">
                    <UButton
                        v-if="editable"
                        type="submit"
                        label="Guardar"
                        icon="i-lucide-check"
                        :loading="enviando"
                        :disabled="sinCambios"
                    />
                    <UButton
                        v-if="editable"
                        label="Vista previa"
                        icon="i-lucide-eye"
                        color="neutral"
                        variant="outline"
                        :loading="generando"
                        @click="generarVista"
                    />
                    <UButton
                        v-if="editable"
                        label="Descartar cambios"
                        color="neutral"
                        variant="ghost"
                        :disabled="sinCambios || enviando"
                        @click="plantilla && rellenar(plantilla)"
                    />
                    <span
                        v-if="!editable"
                        class="text-sm text-muted"
                    >Solo lectura: editar requiere el permiso documentos.editar.</span>
                </div>

                <section
                    class="flex flex-col gap-3"
                    aria-label="Variables disponibles"
                >
                    <div class="flex flex-wrap items-center justify-between gap-2">
                        <h3 class="text-sm font-semibold text-highlighted">
                            Variables
                        </h3>
                        <UInput
                            v-model="filtro"
                            icon="i-lucide-search"
                            placeholder="Buscar variable…"
                            size="sm"
                            class="w-full sm:w-56"
                            aria-label="Buscar variable"
                        />
                    </div>
                    <div
                        v-for="grupo in gruposVariables"
                        :key="grupo.etiqueta"
                        class="flex flex-col gap-1.5"
                    >
                        <p class="text-xs font-medium text-muted">
                            {{ grupo.etiqueta }}
                        </p>
                        <div class="flex flex-wrap gap-1.5">
                            <UButton
                                v-for="variable in grupo.variables"
                                :key="variable.nombre"
                                :label="variable.nombre"
                                :title="variable.descripcion"
                                color="neutral"
                                variant="soft"
                                size="xs"
                                class="font-mono"
                                :disabled="!editable"
                                :data-variable="variable.nombre"
                                @click="insertar(variable)"
                            />
                        </div>
                    </div>
                    <p
                        v-if="!gruposVariables.length"
                        class="text-sm text-muted"
                    >
                        Ninguna variable coincide.
                    </p>
                </section>
            </UForm>

            <section
                class="flex min-w-0 flex-col gap-3"
                aria-label="Vista previa"
            >
                <div class="flex flex-wrap items-center justify-between gap-2">
                    <h3 class="text-sm font-semibold text-highlighted">
                        Vista previa (datos de ejemplo)
                    </h3>
                    <UButton
                        v-if="urlVista"
                        :to="urlVista"
                        target="_blank"
                        label="Abrir PDF"
                        icon="i-lucide-external-link"
                        color="neutral"
                        variant="link"
                        size="sm"
                    />
                </div>
                <UAlert
                    v-if="vistaDesactualizada"
                    color="neutral"
                    variant="subtle"
                    icon="i-lucide-refresh-cw"
                    title="Cambiaste la plantilla después de esta vista previa"
                    :actions="[{ label: 'Actualizar', color: 'neutral', variant: 'outline', loading: generando, onClick: generarVista }]"
                />
                <ProblemaAlerta
                    v-if="problemaVista && problemaVista.status !== 422"
                    :problema="problemaVista"
                    :reintentar="generarVista"
                    :reintentando="generando"
                />
                <iframe
                    v-if="urlVista"
                    :src="urlVista"
                    title="Vista previa del aviso de cobro"
                    class="h-[70vh] w-full rounded-md border border-default bg-default"
                    data-prueba="vista-previa"
                />
                <UEmpty
                    v-else
                    icon="i-lucide-file-text"
                    title="Sin vista previa"
                    :description="editable ? 'Pulsa «Vista previa» para generar el PDF con datos de ejemplo, sin guardar.' : 'La vista previa requiere el permiso documentos.editar.'"
                    variant="outline"
                    class="min-h-64"
                />
            </section>
        </div>
    </PanelPagina>
</template>
