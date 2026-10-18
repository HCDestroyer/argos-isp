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

useHead({ title: 'Plantillas de documentos · ArgosIsp' })

const route = useRoute()
const router = useRouter()

/** Plantilla que se edita: el aviso de cobro (y la factura FEL) o la nota de crédito (y la NCRE). */
const TIPOS: { label: string, value: TipoDocumento, icon: string }[] = [
    { label: 'Aviso de cobro y factura', value: 'aviso_cobro', icon: 'i-lucide-receipt-text' },
    { label: 'Nota de crédito', value: 'nota_credito', icon: 'i-lucide-file-minus' },
]
const tipo = computed<TipoDocumento>({
    get: () => (route.query.tipo === 'nota_credito' ? 'nota_credito' : 'aviso_cobro'),
    set: (valor) => {
        void router.replace({ query: { ...route.query, tipo: valor === 'aviso_cobro' ? undefined : valor } })
    },
})

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

/*
 * Bloque FEL (A5, fase 3): una plantilla ya guardada no recibe sola las variables nuevas del PDF
 * FEL. La de fábrica (`GET /documentos/plantillas/:tipo/fabrica`) las trae: si la guardada no usa
 * alguna `…fel…` que la de fábrica sí usa, se avisa; el bloque se toma de la de fábrica (nunca se
 * copia en el panel) para insertarlo, y se puede restaurar toda la plantilla o compararla.
 */
const fabrica = shallowRef<PlantillaDocumentoFabrica | null>(null)
const problemaFabrica = ref<Problem | null>(null)
const comparando = ref(false)

const prefijoFel = computed(() => (tipo.value === 'aviso_cobro' ? 'factura' : 'nota'))

/** Variables FEL que la de fábrica usa y la del editor no. */
const faltanFel = computed(() => {
    if (!plantilla.value || plantilla.value.version === 0 || !fabrica.value) {
        return []
    }
    const base = fabrica.value.html
    return fabrica.value.variables
        .map(v => v.nombre)
        .filter(nombre => nombre.startsWith(`${prefijoFel.value}.fel`) && base.includes(nombre) && !estado.html.includes(nombre))
})

/** El bloque `{{#<prefijo>.fel}}…{{/<prefijo>.fel}}` de la plantilla de fábrica, o `null`. */
const bloqueFel = computed(() => {
    const marca = `${prefijoFel.value}.fel`
    const html = fabrica.value?.html ?? ''
    const desde = html.indexOf(`{{#${marca}}}`)
    const cierre = `{{/${marca}}}`
    const hasta = desde < 0 ? -1 : html.indexOf(cierre, desde)
    return desde < 0 || hasta < 0 ? null : `${html.slice(desde, hasta + cierre.length)}\n`
})

/** Líneas de una y otra plantilla que la otra no tiene (para comparar sin herramientas externas). */
const diferencias = computed(() => {
    const propias = estado.html.split('\n').map(l => l.trim()).filter(Boolean)
    const deFabrica = (fabrica.value?.html ?? '').split('\n').map(l => l.trim()).filter(Boolean)
    return {
        soloFabrica: deFabrica.filter(l => !propias.includes(l)),
        soloPropia: propias.filter(l => !deFabrica.includes(l)),
    }
})

function insertarBloqueFel() {
    if (!bloqueFel.value) {
        return
    }
    const area = editor.value?.textareaRef
    const inicio = area?.selectionStart ?? estado.html.length
    const fin = area?.selectionEnd ?? estado.html.length
    estado.html = `${estado.html.slice(0, inicio)}${bloqueFel.value}${estado.html.slice(fin)}`
}

/** Pone la plantilla de fábrica en el editor; se guarda con «Guardar» (con la `version` vigente). */
function restaurarFabrica() {
    if (fabrica.value) {
        estado.html = fabrica.value.html
        comparando.value = false
    }
}

function rellenar(datos: PlantillaDocumento) {
    plantilla.value = datos
    estado.html = datos.html
    formulario.value?.clear()
}

async function cargarFabrica() {
    problemaFabrica.value = null
    const resultado = await useDocumentos().fabrica(tipo.value)
    fabrica.value = resultado.ok ? resultado.data : null
    problemaFabrica.value = resultado.ok ? null : resultado.problema
}

async function cargar() {
    cargando.value = true
    void cargarFabrica()
    const resultado = await useDocumentos().plantilla(tipo.value)
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
    const resultado = await useDocumentos().vistaPrevia(estado.html, tipo.value)
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
    const resultado = await useDocumentos().guardarPlantilla(evento.data.html, plantilla.value.version, tipo.value)
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

watch(tipo, () => {
    plantilla.value = null
    fabrica.value = null
    liberarVista()
    void cargar()
})
onMounted(cargar)
onBeforeUnmount(liberarVista)
</script>

<template>
    <PanelPagina
        id="aviso-cobro"
        titulo="Plantillas de documentos"
        icono="i-lucide-file-code-2"
    >
        <div class="mb-4 flex shrink-0 flex-col">
            <UTabs
                v-model="tipo"
                :items="TIPOS"
                :content="false"
                variant="link"
                class="w-full overflow-x-auto"
                :ui="{ list: 'w-max sm:w-full', label: 'whitespace-nowrap' }"
                data-prueba="tipo-plantilla"
            />
        </div>
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
                    :description="`Una plantilla ya guardada no recibe sola las variables nuevas del PDF FEL: falta ${faltanFel.join(', ')}. Inserta el bloque de la plantilla de fábrica donde está el cursor (quita el anterior si lo tenías) o compárala, y guarda.`"
                    :actions="editable && bloqueFel ? [{ label: 'Insertar bloque FEL', icon: 'i-lucide-text-cursor-input', color: 'warning', variant: 'outline', onClick: insertarBloqueFel }] : undefined"
                    data-prueba="falta-bloque-fel"
                />
                <ProblemaAlerta
                    v-if="problemaFabrica"
                    :problema="problemaFabrica"
                    :reintentar="cargarFabrica"
                />
                <div
                    v-if="fabrica && plantilla.version > 0"
                    class="flex flex-wrap gap-2"
                >
                    <UButton
                        label="Comparar con la de fábrica"
                        icon="i-lucide-git-compare"
                        color="neutral"
                        variant="outline"
                        size="sm"
                        data-prueba="comparar-fabrica"
                        @click="comparando = true"
                    />
                </div>

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
                    :title="`Vista previa de ${tipo === 'aviso_cobro' ? 'el aviso de cobro' : 'la nota de crédito'}`"
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

        <UModal
            v-model:open="comparando"
            title="Tu plantilla y la de fábrica"
            description="Líneas que solo están en una de las dos (sin espacios al inicio)."
            :ui="{ content: 'sm:max-w-4xl' }"
        >
            <template #body>
                <div
                    class="grid gap-4 lg:grid-cols-2"
                    data-prueba="diferencias-fabrica"
                >
                    <section class="flex min-w-0 flex-col gap-2">
                        <h3 class="text-sm font-semibold text-highlighted">
                            Solo en la de fábrica ({{ diferencias.soloFabrica.length }})
                        </h3>
                        <pre class="max-h-[50vh] overflow-auto whitespace-pre-wrap break-all rounded-md bg-elevated p-3 font-mono text-xs text-success">{{ diferencias.soloFabrica.join('\n') || 'Ninguna' }}</pre>
                    </section>
                    <section class="flex min-w-0 flex-col gap-2">
                        <h3 class="text-sm font-semibold text-highlighted">
                            Solo en la tuya ({{ diferencias.soloPropia.length }})
                        </h3>
                        <pre class="max-h-[50vh] overflow-auto whitespace-pre-wrap break-all rounded-md bg-elevated p-3 font-mono text-xs text-warning">{{ diferencias.soloPropia.join('\n') || 'Ninguna' }}</pre>
                    </section>
                </div>
            </template>
            <template #footer>
                <div class="flex w-full flex-wrap justify-end gap-2">
                    <UButton
                        label="Cerrar"
                        color="neutral"
                        variant="ghost"
                        @click="comparando = false"
                    />
                    <UButton
                        v-if="editable"
                        label="Restaurar la de fábrica en el editor"
                        icon="i-lucide-rotate-ccw"
                        color="warning"
                        variant="outline"
                        data-prueba="restaurar-fabrica"
                        @click="restaurarFabrica"
                    />
                </div>
            </template>
        </UModal>
    </PanelPagina>
</template>
