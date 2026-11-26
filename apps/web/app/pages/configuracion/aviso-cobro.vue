<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { DropdownMenuItem } from '@nuxt/ui'

/**
 * Configuración · plantillas de documentos (A5): por documento (aviso de cobro y factura, recibo de
 * cobro, nota de crédito), la lista de plantillas con su nombre, formato (carta o POS 80 mm) y cuál
 * es la predeterminada (la que usan el portal, el correo y los procesos automáticos). Desde aquí se
 * crea, edita, duplica, predetermina, desactiva o activa una; al imprimir desde el panel se elige con
 * cuál. La URL es la de siempre (`/configuracion/aviso-cobro`) para no romper enlaces ni el menú.
 */
definePageMeta({ permiso: 'documentos.ver' })

useHead({ title: 'Plantillas de documentos · ArgosIsp' })

const route = useRoute()
const router = useRouter()
const toast = useToast()
const { puede } = usePermisos()

const tipo = computed<TipoDocumento>({
    get: () => TIPOS_DOCUMENTO.find(t => t.value === route.query.tipo)?.value ?? 'aviso_cobro',
    set: (valor) => {
        void router.replace({ query: { ...route.query, tipo: valor === 'aviso_cobro' ? undefined : valor } })
    },
})
const tipoActual = computed(() => TIPOS_DOCUMENTO.find(t => t.value === tipo.value) ?? TIPOS_DOCUMENTO[0]!)

const plantillas = shallowRef<PlantillaDocumentoResumen[] | null>(null)
const problema = ref<Problem | null>(null)
const cargando = ref(false)

async function cargar() {
    cargando.value = true
    const resultado = await usePlantillasDocumentos().listar({ tipo: tipo.value })
    cargando.value = false
    problema.value = resultado.ok ? null : resultado.problema
    plantillas.value = resultado.ok ? resultado.data : null
}

watch(tipo, () => {
    plantillas.value = null
    void cargar()
})
onMounted(cargar)

function rutaEditor(plantilla: PlantillaDocumentoResumen): string {
    return `/configuracion/plantillas-documentos/${plantilla.id}`
}

function rutaNueva(copiar?: PlantillaDocumentoResumen): string {
    const query = new URLSearchParams({ tipo: tipo.value })
    if (copiar) {
        query.set('copiar', String(copiar.id))
    }
    return `/configuracion/plantillas-documentos/nueva?${query.toString()}`
}

/* Confirmación de predeterminar, desactivar o activar (acciones cortas: diálogo). */
type Accion = 'predeterminar' | 'desactivar' | 'activar'
const confirmacion = ref<{ accion: Accion, plantilla: PlantillaDocumentoResumen } | null>(null)
const abierta = computed({
    get: () => confirmacion.value !== null,
    set: (valor) => {
        if (!valor) {
            confirmacion.value = null
        }
    },
})
const enviando = ref(false)

const TEXTOS: Record<Accion, { titulo: string, boton: string, exito: string, descripcion: (p: PlantillaDocumentoResumen) => string }> = {
    predeterminar: {
        titulo: 'Usar como predeterminada',
        boton: 'Usar como predeterminada',
        exito: 'Plantilla predeterminada',
        descripcion: p => `«${p.nombre}» (${etiquetaFormato(p.formato)}) pasará a ser la que usan el portal del cliente, el correo y los procesos automáticos. La anterior sigue disponible para imprimir.`,
    },
    desactivar: {
        titulo: 'Desactivar plantilla',
        boton: 'Desactivar',
        exito: 'Plantilla desactivada',
        descripcion: p => `«${p.nombre}» ya no se ofrecerá al imprimir. No se borra: puedes activarla de nuevo.`,
    },
    activar: {
        titulo: 'Activar plantilla',
        boton: 'Activar',
        exito: 'Plantilla activada',
        descripcion: p => `«${p.nombre}» se ofrecerá otra vez al imprimir.`,
    },
}

async function confirmar() {
    if (!confirmacion.value) {
        return
    }
    const { accion, plantilla } = confirmacion.value
    enviando.value = true
    const resultado = await usePlantillasDocumentos()[accion](plantilla.id, plantilla.version)
    enviando.value = false
    confirmacion.value = null
    if (!resultado.ok) {
        const conflicto = resultado.problema.status === 409
        toast.add({
            title: conflicto ? 'Alguien más cambió la plantilla' : 'No se pudo completar',
            description: conflicto ? 'Se recargó la lista: revisa y vuelve a intentar.' : (resultado.problema.detail ?? resultado.problema.title),
            icon: 'i-lucide-circle-alert',
            color: conflicto ? 'warning' : 'error',
        })
        void cargar()
        return
    }
    toast.add({ title: TEXTOS[accion].exito, description: resultado.data.nombre, icon: 'i-lucide-file-check', color: 'success' })
    void cargar()
}

function pedir(accion: Accion, plantilla: PlantillaDocumentoResumen) {
    confirmacion.value = { accion, plantilla }
}

function acciones(plantilla: PlantillaDocumentoResumen): DropdownMenuItem[][] {
    const principales: DropdownMenuItem[] = [
        { label: puede('documentos.editar') ? 'Editar' : 'Ver', icon: puede('documentos.editar') ? 'i-lucide-pencil' : 'i-lucide-eye', to: rutaEditor(plantilla) },
    ]
    if (puede('documentos.crear')) {
        principales.push({ label: 'Duplicar', icon: 'i-lucide-copy', to: rutaNueva(plantilla) })
    }
    const estado: DropdownMenuItem[] = []
    if (!plantilla.predeterminada && plantilla.activa && puede('documentos.predeterminar')) {
        estado.push({ label: 'Usar como predeterminada', icon: 'i-lucide-star', onSelect: () => pedir('predeterminar', plantilla) })
    }
    if (!plantilla.predeterminada && plantilla.activa && puede('documentos.desactivar')) {
        estado.push({ label: 'Desactivar', icon: 'i-lucide-eye-off', color: 'error', onSelect: () => pedir('desactivar', plantilla) })
    }
    if (!plantilla.activa && puede('documentos.activar')) {
        estado.push({ label: 'Activar', icon: 'i-lucide-eye', onSelect: () => pedir('activar', plantilla) })
    }
    return estado.length ? [principales, estado] : [principales]
}
</script>

<template>
    <ConfiguracionMarco
        id="aviso-cobro"
        titulo="Plantillas de documentos"
        descripcion="Aviso, recibo y nota en carta o POS 80 mm"
        volver="/configuracion/plantillas-conceptos"
    >
        <template #accion-principal>
            <UButton
                v-if="puede('documentos.crear')"
                label="Nueva plantilla"
                icon="i-lucide-plus"
                class="glow-brand"
                :to="rutaNueva()"
                data-prueba="nueva-plantilla"
            />
        </template>
        <template #cabecera>
            <UTabs
                v-model="tipo"
                :items="TIPOS_DOCUMENTO"
                variant="pill"
                color="neutral"
                :content="false"
                class="min-w-0 max-w-full"
                :ui="{
                    list: 'w-auto max-w-full justify-start self-start overflow-x-auto rounded-xl bg-(--ax-panel) p-1',
                    indicator: 'rounded-lg bg-(--ax-tarjeta) shadow-sm ring ring-(--ax-borde)',
                    trigger: 'shrink-0 grow-0 rounded-lg px-3 text-muted data-[state=active]:text-primary',
                    leadingIcon: 'size-4',
                }"
                data-prueba="tipo-plantilla"
            />
        </template>

        <div class="flex shrink-0 flex-col gap-2">
            <p class="text-sm text-muted">
                {{ tipoActual.descripcion }} La <strong class="text-highlighted">predeterminada</strong> es la que usan el portal, el correo y los procesos automáticos; al imprimir desde el panel puedes elegir otra activa.
            </p>
        </div>

        <ProblemaAlerta
            v-if="problema"
            :problema="problema"
            :reintentar="cargar"
            :reintentando="cargando"
        />
        <div
            v-else-if="!plantillas"
            class="flex flex-col gap-2"
        >
            <USkeleton
                v-for="n in 3"
                :key="n"
                class="h-16"
            />
        </div>
        <UEmpty
            v-else-if="!plantillas.length"
            icon="i-lucide-file-text"
            title="Sin plantillas guardadas"
            description="Mientras no crees una, los PDF de este documento salen con la plantilla de fábrica en carta."
            :actions="puede('documentos.crear') ? [{ label: 'Nueva plantilla', icon: 'i-lucide-plus', to: rutaNueva() }] : undefined"
            variant="outline"
        />
        <ul
            v-else
            class="flex flex-col divide-y divide-(--ax-borde) rounded-2xl border border-(--ax-borde)"
            aria-label="Plantillas"
            data-prueba="lista-plantillas"
        >
            <li
                v-for="plantilla in plantillas"
                :key="plantilla.id"
                class="flex flex-wrap items-center gap-3 p-3"
                :class="{ 'opacity-70': !plantilla.activa }"
                :data-plantilla="plantilla.id"
            >
                <UIcon
                    :name="plantilla.formato === 'pos_80' ? 'i-lucide-receipt' : 'i-lucide-file-text'"
                    class="size-5 shrink-0 text-muted"
                />
                <div class="flex min-w-0 flex-1 flex-col gap-1">
                    <div class="flex flex-wrap items-center gap-2">
                        <ULink
                            :to="rutaEditor(plantilla)"
                            class="font-medium text-highlighted hover:text-primary"
                        >
                            {{ plantilla.nombre }}
                        </ULink>
                        <UBadge
                            v-if="plantilla.predeterminada"
                            label="Predeterminada"
                            icon="i-lucide-star"
                            color="primary"
                            variant="subtle"
                            size="sm"
                        />
                        <UBadge
                            v-if="!plantilla.activa"
                            label="Desactivada"
                            icon="i-lucide-eye-off"
                            color="neutral"
                            variant="subtle"
                            size="sm"
                        />
                    </div>
                    <p class="text-xs text-muted">
                        {{ etiquetaFormato(plantilla.formato) }} · {{ plantilla.de_fabrica ? 'De fábrica' : `Versión ${plantilla.version}` }} · Actualizada {{ formatearFechaHora(plantilla.updated_at) }}
                    </p>
                </div>
                <UDropdownMenu
                    :items="acciones(plantilla)"
                    :content="{ align: 'end' }"
                >
                    <UButton
                        icon="i-lucide-ellipsis"
                        color="neutral"
                        variant="ghost"
                        :aria-label="`Acciones de ${plantilla.nombre}`"
                        :data-prueba="`acciones-plantilla-${plantilla.id}`"
                    />
                </UDropdownMenu>
            </li>
        </ul>

        <UModal
            v-model:open="abierta"
            :title="confirmacion ? TEXTOS[confirmacion.accion].titulo : ''"
            :description="confirmacion ? TEXTOS[confirmacion.accion].descripcion(confirmacion.plantilla) : ''"
        >
            <template #footer>
                <div class="flex w-full flex-wrap justify-end gap-2">
                    <UButton
                        label="Cancelar"
                        color="neutral"
                        variant="ghost"
                        :disabled="enviando"
                        @click="confirmacion = null"
                    />
                    <UButton
                        v-if="confirmacion"
                        :label="TEXTOS[confirmacion.accion].boton"
                        :color="confirmacion.accion === 'desactivar' ? 'error' : 'primary'"
                        :loading="enviando"
                        data-prueba="confirmar-plantilla"
                        @click="confirmar"
                    />
                </div>
            </template>
        </UModal>
    </ConfiguracionMarco>
</template>
