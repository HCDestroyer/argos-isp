<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { TableColumn } from '@nuxt/ui'

/**
 * Catálogo de campos personalizados del cliente (A1, `GET /campos-personalizados`): qué datos
 * extra se piden en la ficha de cada cliente, su tipo, si son obligatorios y su orden. Solo admin
 * lo cambia: "Nuevo campo" (`campos_personalizados.crear`), "Editar" (`.editar`), "Desactivar" y
 * "Activar" (`.desactivar`, `.activar`). Un campo nunca se borra: inactivo no se muestra ni se
 * valida, y los valores guardados se conservan. `?campo=<id>` (desde la bitácora) resalta uno.
 */
definePageMeta({ permiso: 'campos_personalizados.editar' })

useHead({ title: 'Campos personalizados · ArgosIsp' })

const route = useRoute()
const toast = useToast()
const { puede } = usePermisos()

const campos = shallowRef<CampoPersonalizado[]>([])
const cargando = ref(true)
const problema = ref<Problem | null>(null)

async function cargar() {
    if (!puede('clientes.ver')) {
        // el catálogo se lee con `clientes.ver`: sin él no hay lista que mostrar
        cargando.value = false
        problema.value = { type: 'about:blank', title: 'Sin permiso', status: 403, detail: 'Falta el permiso clientes.ver para leer el catálogo.' }
        return
    }
    cargando.value = true
    problema.value = null
    const resultado = await useCamposPersonalizados().listar()
    cargando.value = false
    campos.value = resultado.ok ? resultado.data : []
    problema.value = resultado.ok ? null : resultado.problema
}

onMounted(cargar)

const resaltado = computed(() => {
    const id = Number(route.query.campo)
    return Number.isInteger(id) && id > 0 ? id : null
})

const columnas: TableColumn<CampoPersonalizado>[] = [
    { accessorKey: 'etiqueta', header: 'Campo', meta: { class: { td: 'whitespace-normal' } } },
    { accessorKey: 'tipo', header: 'Tipo', meta: SOLO_ANCHO },
    { accessorKey: 'orden', header: 'Orden', meta: SOLO_ESCRITORIO },
    { accessorKey: 'activo', header: 'Estado' },
    { id: 'acciones', header: '', meta: { class: { td: 'text-right w-0' } } },
]

const formularioAbierto = ref(false)
const editando = shallowRef<CampoPersonalizado | null>(null)
const ordenSugerido = computed(() => campos.value.reduce((maximo, campo) => Math.max(maximo, campo.orden), 0) + 10)

function abrirAlta() {
    editando.value = null
    formularioAbierto.value = true
}

function abrirEdicion(campo: CampoPersonalizado) {
    editando.value = campo
    formularioAbierto.value = true
}

function reemplazar(campo: CampoPersonalizado) {
    const existe = campos.value.some(c => c.id === campo.id)
    const lista = existe ? campos.value.map(c => (c.id === campo.id ? campo : c)) : [...campos.value, campo]
    campos.value = lista.sort((a, b) => a.orden - b.orden || a.etiqueta.localeCompare(b.etiqueta) || a.id - b.id)
}

function alGuardar(campo: CampoPersonalizado) {
    const nuevo = editando.value === null
    reemplazar(campo)
    toast.add({ title: nuevo ? `Campo ${campo.etiqueta} creado` : `Campo ${campo.etiqueta} guardado`, icon: 'i-lucide-circle-check', color: 'success' })
}

const aCambiar = shallowRef<CampoPersonalizado | null>(null)
const cambioAbierto = ref(false)

function pedirCambio(campo: CampoPersonalizado) {
    aCambiar.value = campo
    cambioAbierto.value = true
}

function cambiarActivo(): Promise<Resultado<CampoPersonalizado>> {
    const campo = aCambiar.value
    if (!campo) {
        return Promise.resolve({ ok: false, problema: { type: 'about:blank', title: 'Elige un campo', status: 400 } })
    }
    return campo.activo ? useCamposPersonalizados().desactivar(campo) : useCamposPersonalizados().activar(campo)
}

function alCambiar(campo: CampoPersonalizado) {
    reemplazar(campo)
    toast.add({ title: `Campo ${campo.etiqueta} ${campo.activo ? 'activado' : 'desactivado'}`, icon: 'i-lucide-circle-check', color: 'success' })
}

function textoTipo(campo: CampoPersonalizado): string {
    const tipo = TIPOS_CAMPO_PERSONALIZADO[campo.tipo].etiqueta
    return campo.tipo === 'opcion' ? `${tipo}: ${campo.opciones.join(', ')}` : tipo
}
</script>

<template>
    <PanelPagina
        id="campos-personalizados"
        titulo="Campos personalizados"
        icono="i-lucide-text-cursor-input"
    >
        <template #acciones>
            <UButton
                v-if="puede('campos_personalizados.crear')"
                label="Nuevo campo"
                icon="i-lucide-plus"
                data-prueba="nuevo-campo"
                @click="abrirAlta"
            />
        </template>

        <div class="flex flex-col gap-4">
            <p class="text-sm text-muted">
                Datos extra que se piden en la ficha de cada cliente, en este orden. Un campo no se borra: al desactivarlo deja de pedirse y los valores ya guardados se conservan.
            </p>
            <ProblemaAlerta
                v-if="problema"
                :problema="problema"
                :reintentar="cargar"
                :reintentando="cargando"
            />
            <UTable
                v-else
                :data="campos"
                :columns="columnas"
                :loading="cargando"
                :ui="{ td: 'py-3' }"
                data-prueba="tabla-campos"
            >
                <template #etiqueta-cell="{ row }">
                    <div
                        class="flex min-w-0 flex-col gap-0.5"
                        :class="resaltado === row.original.id ? 'rounded-md ring-2 ring-primary ring-offset-4 ring-offset-default' : ''"
                        :data-campo="row.original.clave"
                    >
                        <span class="flex flex-wrap items-center gap-1.5 text-sm font-medium text-highlighted">
                            {{ row.original.etiqueta }}
                            <UBadge
                                v-if="row.original.requerido"
                                label="Obligatorio"
                                color="warning"
                                variant="subtle"
                                size="sm"
                            />
                        </span>
                        <span class="font-mono text-xs text-muted">{{ row.original.clave }}</span>
                        <span class="text-xs text-muted sm:hidden">{{ textoTipo(row.original) }}</span>
                    </div>
                </template>
                <template #tipo-cell="{ row }">
                    <div class="flex flex-col gap-1">
                        <UBadge
                            :label="TIPOS_CAMPO_PERSONALIZADO[row.original.tipo].etiqueta"
                            :icon="TIPOS_CAMPO_PERSONALIZADO[row.original.tipo].icono"
                            color="neutral"
                            variant="subtle"
                            size="sm"
                            class="self-start"
                        />
                        <span
                            v-if="row.original.tipo === 'opcion'"
                            class="text-xs whitespace-normal text-muted"
                        >{{ row.original.opciones.join(' · ') }}</span>
                    </div>
                </template>
                <template #orden-cell="{ row }">
                    <span class="text-sm tabular-nums">{{ row.original.orden }}</span>
                </template>
                <template #activo-cell="{ row }">
                    <UBadge
                        :label="row.original.activo ? 'Activo' : 'Inactivo'"
                        :color="row.original.activo ? 'success' : 'neutral'"
                        variant="subtle"
                        size="sm"
                        :data-prueba="`estado-campo-${row.original.clave}`"
                    />
                </template>
                <template #acciones-cell="{ row }">
                    <div class="flex justify-end gap-1">
                        <UButton
                            v-if="puede('campos_personalizados.editar')"
                            label="Editar"
                            icon="i-lucide-pencil"
                            color="neutral"
                            variant="ghost"
                            size="sm"
                            :aria-label="`Editar el campo ${row.original.etiqueta}`"
                            @click="abrirEdicion(row.original)"
                        />
                        <UButton
                            v-if="row.original.activo ? puede('campos_personalizados.desactivar') : puede('campos_personalizados.activar')"
                            :label="row.original.activo ? 'Desactivar' : 'Activar'"
                            :icon="row.original.activo ? 'i-lucide-circle-pause' : 'i-lucide-circle-play'"
                            :color="row.original.activo ? 'error' : 'primary'"
                            variant="ghost"
                            size="sm"
                            :aria-label="`${row.original.activo ? 'Desactivar' : 'Activar'} el campo ${row.original.etiqueta}`"
                            @click="pedirCambio(row.original)"
                        />
                    </div>
                </template>
                <template #empty>
                    <UEmpty
                        icon="i-lucide-text-cursor-input"
                        title="Sin campos personalizados"
                        description="La ficha del cliente solo pide los datos de siempre. Agrega un campo para pedir uno más."
                        variant="naked"
                    />
                </template>
            </UTable>
        </div>

        <CampoPersonalizadoFormulario
            v-model:open="formularioAbierto"
            :campo="editando"
            :orden-sugerido="ordenSugerido"
            @guardado="alGuardar"
        />
        <ConfirmacionModal
            v-model:open="cambioAbierto"
            :titulo="aCambiar?.activo ? 'Desactivar campo' : 'Activar campo'"
            :efecto="aCambiar?.activo
                ? `«${aCambiar.etiqueta}» deja de pedirse y validarse en la ficha del cliente. Los valores ya guardados se conservan.`
                : `«${aCambiar?.etiqueta ?? ''}» vuelve a pedirse en la ficha del cliente${aCambiar?.requerido ? ' y es obligatorio' : ''}.`"
            :confirmar="aCambiar?.activo ? 'Desactivar' : 'Activar'"
            :icono="aCambiar?.activo ? 'i-lucide-circle-pause' : 'i-lucide-circle-play'"
            :color="aCambiar?.activo ? 'error' : 'primary'"
            :ejecutar="cambiarActivo"
            @hecho="alCambiar"
        />
    </PanelPagina>
</template>
