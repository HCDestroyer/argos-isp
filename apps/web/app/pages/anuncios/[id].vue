<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'

/**
 * Ficha de un anuncio: datos, vista previa en el teléfono, imagen, métricas y las acciones
 * explícitas `publicar` y `archivar` (`anuncios.administrar`, con `version`). Un anuncio archivado
 * no se edita (422 `anuncio_archivado`): se publica de nuevo primero. Publicar con el fin ya
 * pasado responde 422 `anuncio_vencido`; ambos errores se ven en la ventana de la acción.
 */
definePageMeta({ permiso: 'anuncios.ver' })

const route = useRoute()
const toast = useToast()
const { puede } = usePermisos()

const anuncioId = computed(() => Number(route.params.id))
const anuncio = shallowRef<Anuncio | null>(null)
const cargando = ref(true)
const problema = ref<Problem | null>(null)

useHead(() => ({ title: `${anuncio.value?.titulo ?? 'Anuncio'} · ArgosIsp` }))

const imagen = useImagenAnuncio(() => anuncio.value)

const administra = computed(() => puede('anuncios.administrar'))
const editable = computed(() => administra.value && anuncio.value !== null && anuncio.value.estado !== 'archivado')
const editando = ref(false)
const imagenAbierta = ref(false)
const publicarAbierto = ref(false)
const archivarAbierto = ref(false)

const noVigente = computed(() => (anuncio.value ? motivoNoVigente(anuncio.value) : null))

const vista = computed(() => {
    const actual = anuncio.value
    if (!actual) {
        return null
    }
    return {
        titulo: actual.titulo,
        texto: actual.texto,
        boton: actual.boton,
        imagen: actual.imagen && imagen.url.value ? { url: imagen.url.value, alt: actual.imagen.alt ?? '', ancho: actual.imagen.ancho, alto: actual.imagen.alto } : null,
        lugares: actual.lugares,
    }
})

async function cargar() {
    cargando.value = true
    problema.value = null
    const resultado = await useAnuncios().ver(anuncioId.value)
    cargando.value = false
    anuncio.value = resultado.ok ? resultado.data : null
    problema.value = resultado.ok ? null : problemaAnuncioLegible(resultado.problema)
}

/** El error de una acción con su título legible (`anuncio_vencido`, `anuncio_archivado`). */
async function legible(promesa: Promise<Resultado<Anuncio>>): Promise<Resultado<Anuncio>> {
    const resultado = await promesa
    return resultado.ok ? resultado : { ok: false, problema: problemaAnuncioLegible(resultado.problema) }
}

function publicar() {
    const actual = anuncio.value
    return actual ? legible(useAnuncios().publicar(actual.id, actual.version)) : Promise.resolve({ ok: false as const, problema: { type: 'about:blank', title: 'Sin anuncio', status: 0 } })
}

function archivar() {
    const actual = anuncio.value
    return actual ? legible(useAnuncios().archivar(actual.id, actual.version)) : Promise.resolve({ ok: false as const, problema: { type: 'about:blank', title: 'Sin anuncio', status: 0 } })
}

function alCambiar(actualizado: Anuncio, titulo: string) {
    anuncio.value = actualizado
    toast.add({ title: titulo, description: actualizado.titulo, icon: 'i-lucide-circle-check', color: 'success' })
}

watch(anuncioId, () => void cargar())
onMounted(cargar)
</script>

<template>
    <PanelPagina
        id="anuncio"
        :titulo="anuncio?.titulo ?? 'Anuncio'"
        icono="i-lucide-megaphone"
    >
        <div class="flex flex-col gap-6">
            <UButton
                to="/anuncios"
                label="Anuncios"
                icon="i-lucide-arrow-left"
                color="neutral"
                variant="link"
                class="self-start px-0"
            />

            <ProblemaAlerta
                v-if="problema"
                :problema="problema"
                :reintentar="cargar"
                :reintentando="cargando"
            />
            <USkeleton
                v-else-if="cargando && !anuncio"
                class="h-40 w-full"
            />

            <template v-else-if="anuncio && vista">
                <div class="flex flex-col gap-1">
                    <div class="flex flex-wrap items-center gap-2">
                        <h2 class="text-xl font-semibold text-highlighted">
                            {{ anuncio.titulo }}
                        </h2>
                        <UBadge
                            :label="ESTADOS_ANUNCIO[anuncio.estado].etiqueta"
                            :icon="ESTADOS_ANUNCIO[anuncio.estado].icono"
                            :color="ESTADOS_ANUNCIO[anuncio.estado].color"
                            variant="subtle"
                            data-prueba="anuncio-estado"
                        />
                        <UBadge
                            v-if="anuncio.vigente"
                            label="Se ve ahora"
                            icon="i-lucide-eye"
                            color="success"
                            variant="outline"
                            data-prueba="anuncio-vigente"
                        />
                    </div>
                    <p class="text-sm text-muted">
                        Anuncio #{{ anuncio.id }} · versión {{ anuncio.version }}
                    </p>
                </div>

                <div
                    v-if="administra"
                    class="flex flex-wrap gap-2"
                    role="group"
                    aria-label="Acciones del anuncio"
                >
                    <UButton
                        v-if="anuncio.estado !== 'publicado'"
                        label="Publicar"
                        icon="i-lucide-megaphone"
                        data-prueba="publicar-anuncio"
                        @click="publicarAbierto = true"
                    />
                    <UButton
                        label="Editar"
                        icon="i-lucide-pencil"
                        color="neutral"
                        variant="outline"
                        :disabled="!editable"
                        data-prueba="editar-anuncio"
                        @click="editando = true"
                    />
                    <UButton
                        :label="anuncio.imagen ? 'Cambiar imagen' : 'Agregar imagen'"
                        icon="i-lucide-image-up"
                        color="neutral"
                        variant="outline"
                        :disabled="!editable"
                        data-prueba="imagen-anuncio"
                        @click="imagenAbierta = true"
                    />
                    <UButton
                        v-if="anuncio.estado !== 'archivado'"
                        label="Archivar"
                        icon="i-lucide-archive"
                        color="error"
                        variant="outline"
                        data-prueba="archivar-anuncio"
                        @click="archivarAbierto = true"
                    />
                </div>
                <UAlert
                    v-if="administra && anuncio.estado === 'archivado'"
                    color="neutral"
                    variant="subtle"
                    icon="i-lucide-archive"
                    title="Archivado: no se ve ni se edita"
                    description="Publícalo de nuevo para que vuelva al portal y poder editarlo."
                />
                <UAlert
                    v-if="noVigente"
                    color="warning"
                    variant="subtle"
                    icon="i-lucide-calendar-clock"
                    :title="noVigente"
                    data-prueba="anuncio-no-vigente"
                />

                <div class="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
                    <div class="flex flex-col gap-6">
                        <UPageCard
                            title="Datos"
                            icon="i-lucide-info"
                            variant="subtle"
                        >
                            <dl class="grid gap-x-6 gap-y-4 sm:grid-cols-2">
                                <DatoFicha
                                    etiqueta="Audiencia"
                                    :valor="AUDIENCIAS_ANUNCIO[anuncio.audiencia].etiqueta"
                                />
                                <DatoFicha
                                    etiqueta="Dónde se ve"
                                    :valor="anuncio.lugares.map(l => LUGARES_ANUNCIO[l].etiqueta).join(' y ')"
                                />
                                <DatoFicha
                                    etiqueta="Vigencia"
                                    :valor="vigenciaAnuncio(anuncio)"
                                />
                                <DatoFicha
                                    etiqueta="Orden"
                                    :valor="`${anuncio.orden} (mayor, primero)`"
                                />
                                <DatoFicha
                                    etiqueta="Botón"
                                    :valor="anuncio.boton ? `${anuncio.boton.texto} → ${anuncio.boton.url}` : 'Sin botón'"
                                />
                                <DatoFicha
                                    etiqueta="Imagen"
                                    :valor="anuncio.imagen ? `${anuncio.imagen.ancho}×${anuncio.imagen.alto} px · «${anuncio.imagen.alt ?? ''}»` : 'Sin imagen'"
                                />
                                <DatoFicha
                                    v-if="anuncio.publicado_en"
                                    etiqueta="Publicado"
                                    :valor="formatearFechaHora(anuncio.publicado_en)"
                                />
                                <DatoFicha
                                    v-if="anuncio.archivado_en"
                                    etiqueta="Archivado"
                                    :valor="formatearFechaHora(anuncio.archivado_en)"
                                />
                            </dl>
                        </UPageCard>

                        <AnuncioMetricas
                            :anuncio-id="anuncio.id"
                        />
                    </div>

                    <div class="flex flex-col gap-2 lg:sticky lg:top-0 lg:self-start">
                        <ProblemaAlerta
                            v-if="imagen.problema.value"
                            :problema="{ ...imagen.problema.value, title: `Imagen: ${imagen.problema.value.title}` }"
                            :reintentar="imagen.cargar"
                            :reintentando="imagen.cargando.value"
                        />
                        <AnuncioVistaPrevia
                            :titulo="vista.titulo"
                            :texto="vista.texto"
                            :boton="vista.boton"
                            :imagen="vista.imagen"
                            :lugares="vista.lugares"
                        />
                    </div>
                </div>
            </template>
        </div>

        <template v-if="anuncio && administra">
            <AnuncioFormulario
                v-model:open="editando"
                :anuncio="anuncio"
                :imagen-url="imagen.url.value"
                @guardado="(a: Anuncio) => alCambiar(a, 'Anuncio guardado')"
            />
            <AnuncioImagenModal
                v-model:open="imagenAbierta"
                :anuncio="anuncio"
                :actual="imagen.url.value"
                @guardado="(a: Anuncio) => alCambiar(a, a.imagen ? 'Imagen guardada' : 'Imagen quitada')"
            />
            <ConfirmacionModal
                v-model:open="publicarAbierto"
                :titulo="`Publicar «${anuncio.titulo}»`"
                :efecto="`Se verá en ${anuncio.lugares.map(l => LUGARES_ANUNCIO[l].etiqueta.toLowerCase()).join(' y ')} para ${AUDIENCIAS_ANUNCIO[anuncio.audiencia].etiqueta.toLowerCase()}, ${vigenciaAnuncio(anuncio).toLowerCase()}.`"
                confirmar="Publicar"
                icono="i-lucide-megaphone"
                color="primary"
                :ejecutar="publicar"
                @hecho="(a: Anuncio) => alCambiar(a, 'Anuncio publicado')"
            />
            <ConfirmacionModal
                v-model:open="archivarAbierto"
                :titulo="`Archivar «${anuncio.titulo}»`"
                efecto="Deja de verse en el portal y ya no se edita. Sus métricas se conservan y se puede publicar de nuevo."
                confirmar="Archivar"
                icono="i-lucide-archive"
                :ejecutar="archivar"
                @hecho="(a: Anuncio) => alCambiar(a, 'Anuncio archivado')"
            />
        </template>
    </PanelPagina>
</template>
