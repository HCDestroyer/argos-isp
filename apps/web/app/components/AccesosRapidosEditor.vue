<script setup lang="ts">
/**
 * Personalizar los accesos rápidos (panel lateral): elegir hasta 12 secciones y ordenarlas
 * arrastrando (cursor `grab`) o con las flechas. Se guarda al pulsar «Guardar accesos».
 */
const abierto = defineModel<boolean>('open', { default: false })
const { ids, guardar } = useAccesosRapidos()
const { puedeSeccion } = usePermisos()
const toast = useToast()

const borrador = ref<string[]>([])
const busqueda = ref('')
const arrastrando = ref<number | null>(null)

watch(abierto, (valor) => {
    if (valor) {
        borrador.value = [...ids.value]
        busqueda.value = ''
    }
})

const elegidas = computed(() => borrador.value.map(id => obtenerSeccion(id)))
const lleno = computed(() => borrador.value.length >= MAX_ACCESOS_RAPIDOS)

function normalizar(texto: string): string {
    return texto.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}

const disponibles = computed(() => {
    const termino = normalizar(busqueda.value.trim())
    return SECCIONES_PANEL
        .filter(seccion => puedeSeccion(seccion) && !borrador.value.includes(seccion.id))
        .filter(seccion => !termino || normalizar(`${seccion.etiqueta} ${seccion.descripcion}`).includes(termino))
})

function mover(indice: number, destino: number) {
    if (destino < 0 || destino >= borrador.value.length) {
        return
    }
    const lista = [...borrador.value]
    const [id] = lista.splice(indice, 1)
    if (id) {
        lista.splice(destino, 0, id)
    }
    borrador.value = lista
}

function agregar(id: string) {
    if (!lleno.value) {
        borrador.value = [...borrador.value, id]
    }
}

function quitar(id: string) {
    borrador.value = borrador.value.filter(actual => actual !== id)
}

function soltar(destino: number) {
    if (arrastrando.value !== null) {
        mover(arrastrando.value, destino)
    }
    arrastrando.value = null
}

const guardando = ref(false)

async function enviar(secciones: string[] | null) {
    guardando.value = true
    const resultado = await guardar(secciones)
    guardando.value = false
    if (resultado.ok) {
        abierto.value = false
        toast.add({ title: secciones === null ? 'Accesos rápidos de tu rol' : 'Accesos rápidos guardados', icon: 'i-lucide-zap', color: 'success' })
        return
    }
    toast.add({ title: 'No se guardaron los accesos', description: resultado.problema.detail ?? resultado.problema.title, icon: 'i-lucide-circle-alert', color: 'error' })
}

function guardarCambios() {
    void enviar(borrador.value)
}

/** Vuelve a los accesos del rol (`secciones: null`): la API borra la lista guardada. */
function deFabrica() {
    void enviar(null)
}
</script>

<template>
    <USlideover
        v-model:open="abierto"
        title="Personalizar accesos rápidos"
        :description="`Elige hasta ${MAX_ACCESOS_RAPIDOS} secciones y ordénalas: las 9 primeras se abren con Alt+1…9.`"
        :ui="{ content: 'max-w-md', body: 'flex flex-col gap-5' }"
    >
        <template #body>
            <section
                class="flex flex-col gap-2"
                aria-labelledby="accesos-elegidos"
            >
                <h3
                    id="accesos-elegidos"
                    class="text-xs font-semibold tracking-[0.04em] text-muted uppercase"
                >
                    Tus accesos · {{ borrador.length }} de {{ MAX_ACCESOS_RAPIDOS }}
                </h3>
                <ol
                    class="flex flex-col gap-1"
                    data-prueba="accesos-elegidos"
                >
                    <li
                        v-for="(seccion, indice) in elegidas"
                        :key="seccion.id"
                        draggable="true"
                        class="flex items-center gap-2 rounded-lg bg-(--ax-panel) px-2 py-1.5"
                        :class="arrastrando === indice ? 'opacity-50' : ''"
                        @dragstart="arrastrando = indice"
                        @dragover.prevent
                        @drop.prevent="soltar(indice)"
                        @dragend="arrastrando = null"
                    >
                        <UIcon
                            name="i-lucide-grip-vertical"
                            class="size-4 shrink-0 text-dimmed"
                        />
                        <span class="w-5 text-xs tabular-nums text-muted">{{ indice + 1 }}</span>
                        <UIcon
                            :name="seccion.icono"
                            class="size-4 shrink-0 text-primary"
                        />
                        <span class="flex-1 truncate text-sm">{{ seccion.etiqueta }}</span>
                        <UButton
                            icon="i-lucide-arrow-up"
                            color="neutral"
                            variant="ghost"
                            size="xs"
                            :disabled="indice === 0"
                            :title="`Subir ${seccion.etiqueta}`"
                            :aria-label="`Subir ${seccion.etiqueta}`"
                            @click="mover(indice, indice - 1)"
                        />
                        <UButton
                            icon="i-lucide-arrow-down"
                            color="neutral"
                            variant="ghost"
                            size="xs"
                            :disabled="indice === elegidas.length - 1"
                            :title="`Bajar ${seccion.etiqueta}`"
                            :aria-label="`Bajar ${seccion.etiqueta}`"
                            @click="mover(indice, indice + 1)"
                        />
                        <UButton
                            :icon="ICONOS.cancelar"
                            color="error"
                            variant="ghost"
                            size="xs"
                            :title="`Quitar ${seccion.etiqueta}`"
                            :aria-label="`Quitar ${seccion.etiqueta}`"
                            @click="quitar(seccion.id)"
                        />
                    </li>
                </ol>
            </section>

            <section
                class="flex flex-col gap-2"
                aria-labelledby="accesos-disponibles"
            >
                <h3
                    id="accesos-disponibles"
                    class="text-xs font-semibold tracking-[0.04em] text-muted uppercase"
                >
                    Agregar
                </h3>
                <UInput
                    v-model="busqueda"
                    :icon="ICONOS.buscar"
                    placeholder="Buscar sección…"
                    aria-label="Buscar sección para agregar"
                    class="w-full"
                />
                <p
                    v-if="lleno"
                    class="text-xs text-muted"
                >
                    Ya tienes {{ MAX_ACCESOS_RAPIDOS }}: quita uno para agregar otro.
                </p>
                <ul class="flex max-h-72 flex-col gap-0.5 overflow-y-auto">
                    <li
                        v-for="seccion in disponibles"
                        :key="seccion.id"
                        class="flex items-center gap-2 px-1 py-1"
                    >
                        <UIcon
                            :name="seccion.icono"
                            class="size-4 shrink-0 text-dimmed"
                        />
                        <span class="flex-1 truncate text-sm">{{ seccion.etiqueta }}</span>
                        <UButton
                            label="Agregar"
                            :icon="ICONOS.crear"
                            color="neutral"
                            variant="outline"
                            size="xs"
                            :disabled="lleno"
                            :aria-label="`Agregar ${seccion.etiqueta}`"
                            @click="agregar(seccion.id)"
                        />
                    </li>
                </ul>
            </section>
        </template>
        <template #footer>
            <UButton
                label="Usar los de mi rol"
                icon="i-lucide-rotate-ccw"
                color="neutral"
                variant="ghost"
                :disabled="guardando"
                @click="deFabrica"
            />
            <UButton
                label="Cancelar"
                :icon="ICONOS.cancelar"
                color="neutral"
                variant="outline"
                @click="abierto = false"
            />
            <UButton
                label="Guardar accesos"
                :icon="ICONOS.guardar"
                :loading="guardando"
                data-prueba="guardar-accesos"
                @click="guardarCambios"
            />
        </template>
    </USlideover>
</template>
