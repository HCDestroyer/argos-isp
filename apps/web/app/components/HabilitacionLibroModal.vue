<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { SelectItem } from '@nuxt/ui'

/**
 * Registrar un rango de folios habilitado (`POST /libros/habilitaciones`, `libros.habilitar`). Por
 * libro los rangos son correlativos: si ya hay uno, el nuevo empieza en el folio siguiente al último
 * habilitado (`GET /libros/folios` → `ultimo_habilitado + 1`, que se propone); el primero empieza
 * donde diga la autorización. Fecha no futura. Una habilitación no se edita ni se borra.
 */
const props = defineProps<{
    empresaId: number
    empresa?: string | null
    libroInicial: LibroHabilitable
}>()

const abierto = defineModel<boolean>('open', { default: false })
const emit = defineEmits<{ hecho: [habilitacion: HabilitacionLibro] }>()

const hoy = hoyGuatemala()
const formulario = useTemplateRef('formulario')
const enviando = ref(false)
const problema = ref<Problem | null>(null)
let clave = nuevaClaveIdempotencia()

interface Entrada {
    libro: LibroHabilitable
    autorizacion: string
    folio_desde: number | undefined
    folio_hasta: number | undefined
    fecha: string
    nota: string
}

const estado = reactive<Entrada>({ libro: 'diario', autorizacion: '', folio_desde: undefined, folio_hasta: undefined, fecha: hoy, nota: '' })

const folios = shallowRef<FoliosLibro[]>([])
const cargandoFolios = ref(false)
const problemaFolios = ref<Problem | null>(null)

async function cargarFolios() {
    cargandoFolios.value = true
    const resultado = await useLibros().folios(props.empresaId)
    cargandoFolios.value = false
    folios.value = resultado.ok ? resultado.data : []
    problemaFolios.value = resultado.ok ? null : resultado.problema
    proponer()
}

const propuesto = computed(() => folioDesdePropuesto(folios.value, estado.libro))
const esquema = computed(() => esquemaHabilitar(hoy, folios.value))
const itemsLibro: SelectItem[] = LIBROS_HABILITABLES.map(l => ({ label: LIBROS[l].legal, value: l }))

/** Con habilitaciones previas, el folio inicial es el siguiente al último habilitado. */
function proponer() {
    if (propuesto.value !== null) {
        estado.folio_desde = propuesto.value
    }
}

watch(() => estado.libro, () => {
    estado.folio_desde = undefined
    proponer()
})

watch(abierto, (valor) => {
    if (valor) {
        Object.assign(estado, { libro: props.libroInicial, autorizacion: '', folio_desde: undefined, folio_hasta: undefined, fecha: hoy, nota: '' })
        problema.value = null
        clave = nuevaClaveIdempotencia()
        void cargarFolios()
    }
})

const cantidad = computed(() => (estado.folio_desde && estado.folio_hasta && estado.folio_hasta >= estado.folio_desde ? estado.folio_hasta - estado.folio_desde + 1 : null))

async function enviar() {
    if (estado.folio_desde === undefined || estado.folio_hasta === undefined) {
        return
    }
    enviando.value = true
    problema.value = null
    const nota = estado.nota.trim()
    const resultado = await useLibros().habilitar({
        empresa_id: props.empresaId,
        libro: estado.libro,
        autorizacion: estado.autorizacion.trim(),
        folio_desde: estado.folio_desde,
        folio_hasta: estado.folio_hasta,
        fecha: estado.fecha,
        nota: nota || null,
    }, clave)
    enviando.value = false
    if (resultado.ok) {
        abierto.value = false
        emit('hecho', resultado.data)
        return
    }
    const errores = erroresDeFormulario(resultado.problema).filter(e => ['libro', 'autorizacion', 'folio_desde', 'folio_hasta', 'fecha', 'nota'].includes(e.name ?? ''))
    if (errores.length) {
        formulario.value?.setErrors(errores)
    }
    problema.value = problemaLibroLegible(resultado.problema)
    if (codigoProblema(resultado.problema) === 'habilitacion_no_correlativa') {
        void cargarFolios()
    }
}
</script>

<template>
    <UModal
        v-model:open="abierto"
        title="Registrar habilitación de folios"
        :description="empresa ?? 'Autorización SAT-7121 y Registro Mercantil'"
        :dismissible="!enviando"
    >
        <template #body>
            <UForm
                id="form-habilitacion-libro"
                ref="formulario"
                :schema="esquema"
                :state="estado"
                class="flex flex-col gap-4"
                @submit="enviar"
            >
                <UFormField
                    label="Libro"
                    name="libro"
                    required
                    :help="LIBROS[estado.libro].descripcion"
                >
                    <USelect
                        v-model="estado.libro"
                        :items="itemsLibro"
                        class="w-full"
                        data-prueba="habilitacion-libro"
                    />
                </UFormField>
                <UFormField
                    label="Número de autorización"
                    name="autorizacion"
                    required
                >
                    <UInput
                        v-model="estado.autorizacion"
                        placeholder="Ej.: SAT-7121-2026-000187"
                        class="w-full"
                        data-prueba="habilitacion-autorizacion"
                    />
                </UFormField>
                <ProblemaAlerta
                    v-if="problemaFolios"
                    :problema="problemaFolios"
                    :reintentar="cargarFolios"
                    :reintentando="cargandoFolios"
                />
                <div class="grid gap-4 sm:grid-cols-2">
                    <UFormField
                        label="Del folio"
                        name="folio_desde"
                        required
                        :help="propuesto !== null ? `El siguiente al último habilitado (${propuesto - 1}).` : 'Primera habilitación del libro: donde diga la autorización.'"
                    >
                        <UInputNumber
                            v-model="estado.folio_desde"
                            :min="1"
                            :step="1"
                            :disabled="cargandoFolios"
                            class="w-full"
                            data-prueba="habilitacion-desde"
                        />
                    </UFormField>
                    <UFormField
                        label="Al folio"
                        name="folio_hasta"
                        required
                        :help="cantidad !== null ? `${cantidad} ${cantidad === 1 ? 'folio' : 'folios'}` : undefined"
                    >
                        <UInputNumber
                            v-model="estado.folio_hasta"
                            :min="estado.folio_desde ?? 1"
                            :step="1"
                            class="w-full"
                            data-prueba="habilitacion-hasta"
                        />
                    </UFormField>
                </div>
                <UFormField
                    label="Fecha de la autorización"
                    name="fecha"
                    required
                >
                    <UInput
                        v-model="estado.fecha"
                        type="date"
                        :max="hoy"
                        class="w-full"
                        data-prueba="habilitacion-fecha"
                    />
                </UFormField>
                <UFormField
                    label="Nota"
                    name="nota"
                    help="Opcional. Una habilitación no se edita ni se borra."
                >
                    <UTextarea
                        v-model="estado.nota"
                        :rows="2"
                        autoresize
                        class="w-full"
                        data-prueba="habilitacion-nota"
                    />
                </UFormField>
                <ProblemaAlerta
                    v-if="problema"
                    :problema="problema"
                    data-prueba="habilitacion-problema"
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
                    form="form-habilitacion-libro"
                    label="Registrar"
                    icon="i-lucide-book-plus"
                    :loading="enviando"
                    data-prueba="confirmar-habilitacion"
                />
            </div>
        </template>
    </UModal>
</template>
