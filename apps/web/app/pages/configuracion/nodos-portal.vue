<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { FormSubmitEvent, TableColumn } from '@nuxt/ui'
import * as z from 'zod'

/**
 * Nodos portal remotos (A5, `.claude/integration/a5.md`): un portal del cliente instalado en otro
 * sitio que llama al central con su token (`NODO_PORTAL_TOKEN`, cabecera `X-Argos-Nodo-Token`).
 * Alta con el token una sola vez, último uso e IP, y revocar (401 desde su siguiente petición).
 * Todo con `nodos_portal.administrar`.
 */
definePageMeta({ permiso: 'nodos_portal.administrar' })

useHead({ title: 'Nodos del portal · ArgosIsp' })

const toast = useToast()
const lista = usePaginacionCursor(cursor => useNodosPortal().listar(cursor))
onMounted(() => void lista.recargar())

const columnas: TableColumn<NodoPortal>[] = [
    { accessorKey: 'nombre', header: 'Nodo' },
    { id: 'uso', header: 'Último uso', meta: SOLO_ANCHO },
    { id: 'estado', header: 'Estado' },
    { id: 'acciones', header: '', meta: { class: { td: 'text-right w-0' } } },
]

/** Espejo del validador de A5: `^[a-z0-9][a-z0-9-]{0,62}$`. */
const esquema = z.object({
    nombre: z.string().trim().regex(/^[a-z0-9][a-z0-9-]{0,62}$/, 'Minúsculas, números y guiones; empieza con letra o número (ej. portal-mixco)'),
})
const formulario = useTemplateRef('formulario')
const estado = reactive<z.input<typeof esquema>>({ nombre: '' })
const altaAbierta = ref(false)
const enviando = ref(false)
const problema = ref<Problem | null>(null)
const creado = shallowRef<NodoPortalCreado | null>(null)
const tokenAbierto = ref(false)

function abrirAlta() {
    estado.nombre = ''
    problema.value = null
    altaAbierta.value = true
}

async function crear(evento: FormSubmitEvent<z.output<typeof esquema>>) {
    enviando.value = true
    problema.value = null
    const resultado = await useNodosPortal().crear(evento.data.nombre)
    enviando.value = false
    if (!resultado.ok) {
        const errores = erroresDeFormulario(resultado.problema)
        if (errores.length) {
            formulario.value?.setErrors(errores)
        }
        problema.value = resultado.problema
        return
    }
    altaAbierta.value = false
    creado.value = resultado.data
    tokenAbierto.value = true
    void lista.recargar()
}

const aRevocar = shallowRef<NodoPortal | null>(null)
const revocarAbierto = ref(false)

function pedirRevocar(nodo: NodoPortal) {
    aRevocar.value = nodo
    revocarAbierto.value = true
}

function revocar(): Promise<Resultado<NodoPortal>> {
    const nodo = aRevocar.value
    return nodo ? useNodosPortal().revocar(nodo.id) : Promise.resolve({ ok: false, problema: { type: 'about:blank', title: 'Elige un nodo', status: 400 } })
}

function alRevocar(nodo: NodoPortal) {
    lista.filas.value = lista.filas.value.map(n => (n.id === nodo.id ? nodo : n))
    toast.add({ title: `Nodo ${nodo.nombre} revocado`, color: 'success', icon: 'i-lucide-circle-check' })
}
</script>

<template>
    <PanelPagina
        id="nodos-portal"
        titulo="Nodos del portal"
        icono="i-lucide-server"
    >
        <template #acciones>
            <UButton
                label="Nuevo nodo"
                icon="i-lucide-plus"
                data-prueba="nuevo-nodo"
                @click="abrirAlta"
            />
        </template>

        <div class="flex flex-col gap-4">
            <p class="text-sm text-muted">
                Portales del cliente instalados en otro sitio (otra oficina o nube) que hablan con este servidor. Cada nodo usa su propio token; revócalo si el equipo se pierde o deja de usarse.
            </p>
            <ProblemaAlerta
                v-if="lista.problema.value"
                :problema="lista.problema.value"
                :reintentar="lista.recargar"
                :reintentando="lista.cargando.value"
            />
            <template v-else>
                <UTable
                    :data="lista.filas.value"
                    :columns="columnas"
                    :loading="lista.cargando.value"
                    :ui="{ td: 'py-3' }"
                    data-prueba="tabla-nodos"
                >
                    <template #nombre-cell="{ row }">
                        <div
                            class="flex flex-col gap-0.5"
                            :data-nodo="row.original.nombre"
                        >
                            <span class="font-mono text-sm font-medium text-highlighted">{{ row.original.nombre }}</span>
                            <span class="text-xs text-muted">Alta {{ formatearFecha(row.original.created_at) }}</span>
                            <span class="text-xs text-muted sm:hidden">{{ row.original.ultimo_uso ? `Usado ${formatearFechaHora(row.original.ultimo_uso)}` : 'Sin usar' }}</span>
                        </div>
                    </template>
                    <template #uso-cell="{ row }">
                        <div class="flex flex-col text-sm">
                            <span>{{ row.original.ultimo_uso ? formatearFechaHora(row.original.ultimo_uso) : 'Sin usar' }}</span>
                            <span
                                v-if="row.original.ultima_ip"
                                class="font-mono text-xs text-muted"
                            >{{ row.original.ultima_ip }}</span>
                        </div>
                    </template>
                    <template #estado-cell="{ row }">
                        <UBadge
                            :label="row.original.revocado_en ? 'Revocado' : 'Activo'"
                            :color="row.original.revocado_en ? 'neutral' : 'success'"
                            variant="subtle"
                            size="sm"
                        />
                    </template>
                    <template #acciones-cell="{ row }">
                        <UButton
                            v-if="!row.original.revocado_en"
                            label="Revocar"
                            icon="i-lucide-ban"
                            color="error"
                            variant="ghost"
                            size="sm"
                            :aria-label="`Revocar el nodo ${row.original.nombre}`"
                            @click="pedirRevocar(row.original)"
                        />
                    </template>
                    <template #empty>
                        <UEmpty
                            icon="i-lucide-server"
                            title="Sin nodos remotos"
                            description="El portal del cliente de este servidor no necesita nodo."
                            variant="naked"
                        />
                    </template>
                </UTable>
                <PaginacionCursor
                    :pagina="lista.pagina.value"
                    :hay-anterior="lista.hayAnterior.value"
                    :hay-siguiente="lista.haySiguiente.value"
                    :cargando="lista.cargando.value"
                    :filas="lista.filas.value.length"
                    @anterior="lista.anterior"
                    @siguiente="lista.siguiente"
                />
            </template>
        </div>

        <UModal
            v-model:open="altaAbierta"
            title="Nuevo nodo del portal"
            :dismissible="!enviando"
        >
            <template #body>
                <UForm
                    id="form-nodo"
                    ref="formulario"
                    :schema="esquema"
                    :state="estado"
                    class="flex flex-col gap-4"
                    @submit="crear"
                >
                    <UFormField
                        label="Nombre"
                        name="nombre"
                        help="Identifica el nodo en los registros (ej. portal-mixco)."
                        required
                    >
                        <UInput
                            v-model="estado.nombre"
                            class="w-full font-mono"
                            data-prueba="nodo-nombre"
                        />
                    </UFormField>
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
                        @click="altaAbierta = false"
                    />
                    <UButton
                        type="submit"
                        form="form-nodo"
                        label="Crear nodo"
                        icon="i-lucide-server"
                        :loading="enviando"
                        data-prueba="nodo-crear"
                    />
                </div>
            </template>
        </UModal>
        <ValorUnaVezModal
            v-if="creado"
            v-model:open="tokenAbierto"
            :titulo="`Token del nodo ${creado.datos.nombre}`"
            descripcion="Va en NODO_PORTAL_TOKEN del .env del nodo (cabecera X-Argos-Nodo-Token)."
            :valores="[{ etiqueta: 'Token', valor: creado.token, secreto: true }]"
            @cerrado="creado = null"
        />
        <ConfirmacionModal
            v-model:open="revocarAbierto"
            titulo="Revocar nodo del portal"
            :efecto="`El portal «${aRevocar?.nombre ?? ''}» deja de funcionar desde su siguiente petición. Para volver a conectarlo, crea otro nodo.`"
            confirmar="Revocar"
            :ejecutar="revocar"
            @hecho="alRevocar"
        />
    </PanelPagina>
</template>
