<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { SelectItem } from '@nuxt/ui'

/**
 * Emisión oficial con folio de un libro (`POST /libros/:libro/emitir`, `libros.emitir`). Antes muestra
 * los folios del libro (`GET /libros/folios`: el siguiente y cuántos quedan) y pide confirmar, porque
 * una emisión gasta folios y no se deshace. Meses completos; la API exige cada mes cerrado y el
 * bloqueo global o duro hasta el fin del rango (422 `periodo_sin_bloqueo`), la cadena verificada (409
 * `integridad_rota`) y folios suficientes (422 `folios_agotados`): cada error dice qué hacer.
 */
const props = defineProps<{
    libro: LibroEmitible
    empresaId: number
    /** Nombre de la empresa (varias empresas). */
    empresa?: string | null
    /** Mes (`AAAA-MM`) con el que abre el formulario. */
    desdeInicial: string
    hastaInicial: string
}>()

const abierto = defineModel<boolean>('open', { default: false })
const emit = defineEmits<{ hecho: [emision: EmisionLibro] }>()

const hoy = hoyGuatemala()
const esquema = esquemaEmitir(hoy)
const meses = mesesRecientes(hoy, 36)
const itemsMes: SelectItem[] = meses.map(m => ({ label: etiquetaPeriodo(m), value: m }))
const itemsFormato: SelectItem[] = Object.entries(FORMATOS_EMISION).map(([value, f]) => ({ label: f.etiqueta, value, description: f.descripcion, icon: f.icono }))

interface Entrada {
    desde: string
    hasta: string
    formato: FormatoEmision
    confirmo: boolean
}

const estado = reactive<Entrada>({ desde: '', hasta: '', formato: 'pdf', confirmo: false })
const formulario = useTemplateRef('formulario')
const enviando = ref(false)
const problema = ref<Problem | null>(null)
let clave = nuevaClaveIdempotencia()

/* Folios del libro: se leen al abrir; sin ellos no se emite a ciegas. */
const folios = shallowRef<FoliosLibro | null>(null)
const cargandoFolios = ref(false)
const problemaFolios = ref<Problem | null>(null)

async function cargarFolios() {
    cargandoFolios.value = true
    const resultado = await useLibros().folios(props.empresaId)
    cargandoFolios.value = false
    folios.value = resultado.ok ? (resultado.data.find(f => f.libro === props.libro) ?? null) : null
    problemaFolios.value = resultado.ok ? null : resultado.problema
}

const sinFolios = computed(() => folios.value !== null && (folios.value.siguiente === null || folios.value.disponibles === 0))

watch(abierto, (valor) => {
    if (valor) {
        const desde = meses.includes(props.desdeInicial) ? props.desdeInicial : (meses[1] ?? '')
        const hasta = meses.includes(props.hastaInicial) && props.hastaInicial >= desde ? props.hastaInicial : desde
        Object.assign(estado, { desde, hasta, formato: 'pdf', confirmo: false })
        problema.value = null
        clave = nuevaClaveIdempotencia()
        void cargarFolios()
    }
})

// Otro rango u otro formato es otra emisión: otra clave.
watch(() => [estado.desde, estado.hasta, estado.formato], () => {
    clave = nuevaClaveIdempotencia()
})

const rango = computed(() => (estado.desde && estado.hasta ? periodoEmision(primerDiaMes(estado.desde), ultimoDiaMes(estado.hasta)) : '—'))

async function enviar() {
    enviando.value = true
    problema.value = null
    const resultado = await useLibros().emitir(props.libro, {
        empresa_id: props.empresaId,
        desde: primerDiaMes(estado.desde),
        hasta: ultimoDiaMes(estado.hasta),
        formato: estado.formato,
    }, clave)
    enviando.value = false
    if (resultado.ok) {
        abierto.value = false
        emit('hecho', resultado.data)
        return
    }
    if (codigoProblema(resultado.problema) === null) {
        const errores = erroresDeFormulario(resultado.problema).filter(e => e.name === 'desde' || e.name === 'hasta' || e.name === 'formato')
        if (errores.length) {
            formulario.value?.setErrors(errores)
        }
    }
    problema.value = resultado.problema
    // Los folios pudieron cambiar (otra emisión, una habilitación nueva).
    void cargarFolios()
}
</script>

<template>
    <UModal
        v-model:open="abierto"
        :title="`Emitir ${LIBROS[libro].legal}`"
        :description="empresa ?? 'Emisión oficial con folio'"
        :dismissible="!enviando"
    >
        <template #body>
            <UForm
                id="form-emitir-libro"
                ref="formulario"
                :schema="esquema"
                :state="estado"
                class="flex flex-col gap-4"
                @submit="enviar"
            >
                <div class="grid gap-4 sm:grid-cols-2">
                    <UFormField
                        label="Desde el mes"
                        name="desde"
                        required
                    >
                        <USelect
                            v-model="estado.desde"
                            :items="itemsMes"
                            class="w-full"
                            data-prueba="emitir-desde"
                        />
                    </UFormField>
                    <UFormField
                        label="Hasta el mes"
                        name="hasta"
                        required
                    >
                        <USelect
                            v-model="estado.hasta"
                            :items="itemsMes"
                            class="w-full"
                            data-prueba="emitir-hasta"
                        />
                    </UFormField>
                </div>
                <UFormField
                    label="Formato"
                    name="formato"
                    :help="FORMATOS_EMISION[estado.formato].descripcion"
                >
                    <USelect
                        v-model="estado.formato"
                        :items="itemsFormato"
                        class="w-full"
                        data-prueba="emitir-formato"
                    />
                </UFormField>

                <ProblemaAlerta
                    v-if="problemaFolios"
                    :problema="problemaFolios"
                    :reintentar="cargarFolios"
                    :reintentando="cargandoFolios"
                />
                <USkeleton
                    v-else-if="cargandoFolios && !folios"
                    class="h-16 w-full"
                />
                <UAlert
                    v-else-if="folios"
                    :color="sinFolios ? 'error' : 'neutral'"
                    variant="subtle"
                    icon="i-lucide-hash"
                    :title="folios.siguiente === null ? 'El libro no tiene folios habilitados' : `Empieza en el folio ${folios.siguiente}`"
                    :description="folios.siguiente === null
                        ? 'Registre la habilitación de folios (autorización SAT-7121) antes de emitir: sin ella la API rechaza la emisión.'
                        : `Quedan ${folios.disponibles} folios habilitados (hasta el ${folios.ultimo_habilitado ?? '—'}). Se usa un folio por página.`"
                    data-prueba="emitir-folios"
                />

                <UAlert
                    color="warning"
                    variant="subtle"
                    icon="i-lucide-triangle-alert"
                    :title="`${LIBROS[libro].legal} · ${rango}`"
                    description="Una emisión no se deshace: los folios que use no vuelven. Si el rango se cruza con una emisión anterior del libro, es una reimpresión con folios nuevos."
                />
                <UFormField name="confirmo">
                    <UCheckbox
                        v-model="estado.confirmo"
                        label="Entiendo que la emisión gasta folios"
                        data-prueba="emitir-confirmo"
                    />
                </UFormField>

                <ProblemaLibro
                    v-if="problema"
                    :problema="problema"
                    :libro="libro"
                    data-prueba="emitir-problema"
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
                    form="form-emitir-libro"
                    label="Emitir con folio"
                    icon="i-lucide-stamp"
                    :loading="enviando"
                    :disabled="!folios || !estado.confirmo"
                    data-prueba="confirmar-emitir"
                />
            </div>
        </template>
    </UModal>
</template>
