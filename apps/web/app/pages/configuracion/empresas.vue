<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { TableColumn } from '@nuxt/ui'

/**
 * Configuración · Empresas (multiempresa, `contratos/multiempresa.md`): las empresas (NIT) de la
 * instalación con su logo y datos fiscales; alta, edición con `version`, logo y desactivar con
 * motivo. Pestaña "Sugerencias": la empresa sugerida de cada zona y router para los servicios
 * nuevos (servicio > zona > router > empresa activa).
 */
definePageMeta({ permiso: 'empresas.ver' })

useHead({ title: 'Empresas · ArgosIsp' })

const { puede } = usePermisos()
const toast = useToast()
const route = useRoute()
const router = useRouter()

const pestanas = [
    { label: 'Empresas', value: 'empresas', icon: 'i-lucide-building-2' },
    { label: 'Sugerencias por zona y router', value: 'sugerencias', icon: 'i-lucide-route' },
]
const pestana = computed({
    get: () => (route.query.tab === 'sugerencias' ? 'sugerencias' : 'empresas'),
    set: valor => void router.replace({ query: { ...route.query, tab: valor === 'empresas' ? undefined : valor } }),
})

const empresas = shallowRef<EmpresaGrupo[]>([])
const cargando = ref(false)
const problema = ref<Problem | null>(null)

const editando = shallowRef<EmpresaGrupo | null>(null)
const formularioAbierto = ref(false)
const logoDe = shallowRef<EmpresaGrupo | null>(null)
const logoAbierto = ref(false)
const desactivarDe = shallowRef<EmpresaGrupo | null>(null)
const desactivarAbierto = ref(false)

async function cargar() {
    cargando.value = true
    const resultado = await useEmpresas().listar()
    cargando.value = false
    empresas.value = resultado.ok ? resultado.data : []
    problema.value = resultado.ok ? null : resultado.problema
}

onMounted(cargar)

function nueva() {
    editando.value = null
    formularioAbierto.value = true
}

function editar(empresa: EmpresaGrupo) {
    editando.value = empresa
    formularioAbierto.value = true
}

function abrirLogo(empresa: EmpresaGrupo) {
    logoDe.value = empresa
    logoAbierto.value = true
}

function abrirDesactivar(empresa: EmpresaGrupo) {
    desactivarDe.value = empresa
    desactivarAbierto.value = true
}

function reemplazar(empresa: EmpresaGrupo, mensaje: string) {
    const existe = empresas.value.some(e => e.id === empresa.id)
    empresas.value = existe ? empresas.value.map(e => (e.id === empresa.id ? empresa : e)) : [...empresas.value, empresa]
    toast.add({ title: mensaje, description: empresa.nombre_comercial, color: 'success', icon: 'i-lucide-circle-check' })
    // El selector y `GET /me` traen el nombre y el logo: se releen.
    void useAuth().cargarMe()
}

function desactivar(motivo: string, clave: string) {
    const empresa = desactivarDe.value
    if (!empresa) {
        return Promise.resolve<Resultado<EmpresaGrupo>>({ ok: false, problema: { type: 'about:blank', title: 'Sin empresa', status: 400 } })
    }
    return useEmpresas().desactivar(empresa.id, empresa.version, motivo, clave)
}

const columnas: TableColumn<EmpresaGrupo>[] = [
    { accessorKey: 'nombre_comercial', header: 'Empresa' },
    { accessorKey: 'nit', header: 'NIT', meta: SOLO_ANCHO },
    { accessorKey: 'regimen_isr', header: 'Régimen', meta: SOLO_ESCRITORIO },
    { accessorKey: 'activa', header: 'Estado' },
    { id: 'acciones', header: '', meta: { class: { td: 'text-right' } } },
]
</script>

<template>
    <PanelPagina
        id="empresas"
        titulo="Empresas"
        icono="i-lucide-building-2"
    >
        <template #acciones>
            <UButton
                v-if="puede('empresas.crear') && pestana === 'empresas'"
                label="Nueva empresa"
                icon="i-lucide-plus"
                class="glow-brand"
                :ui="{ label: 'hidden sm:inline' }"
                aria-label="Nueva empresa"
                @click="nueva"
            />
        </template>

        <div class="flex flex-col gap-4">
            <p class="max-w-3xl text-sm text-muted">
                Cada empresa factura con su NIT y lleva su contabilidad. Un servicio pertenece a una
                empresa; un cliente puede tener servicios de varias.
            </p>

            <UTabs
                v-model="pestana"
                :items="pestanas"
                :content="false"
                variant="link"
                class="w-full"
            />

            <template v-if="pestana === 'empresas'">
                <ProblemaAlerta
                    v-if="problema"
                    :problema="problema"
                    :reintentar="cargar"
                    :reintentando="cargando"
                />
                <UTable
                    v-else
                    :data="empresas"
                    :columns="columnas"
                    :loading="cargando"
                    :ui="{ td: 'py-3' }"
                    data-prueba="tabla-empresas"
                >
                    <template #nombre_comercial-cell="{ row }">
                        <div class="flex min-w-48 items-center gap-3">
                            <UAvatar
                                :src="urlLogoEmpresa(row.original.logo_url)"
                                :alt="row.original.nombre_comercial"
                                size="md"
                            />
                            <div class="flex min-w-0 flex-col">
                                <span class="flex flex-wrap items-center gap-1.5 font-medium text-highlighted">
                                    {{ row.original.nombre_comercial }}
                                    <UBadge
                                        v-if="row.original.principal"
                                        label="Principal"
                                        icon="i-lucide-star"
                                        color="neutral"
                                        variant="outline"
                                        size="sm"
                                    />
                                </span>
                                <span class="truncate text-xs text-muted">{{ row.original.razon_social ?? 'Sin razón social' }}</span>
                                <span class="font-mono text-xs text-muted sm:hidden">{{ row.original.nit ?? 'Sin NIT' }}</span>
                            </div>
                        </div>
                    </template>
                    <template #nit-cell="{ row }">
                        <span class="font-mono text-sm">{{ row.original.nit ?? '—' }}</span>
                    </template>
                    <template #regimen_isr-cell="{ row }">
                        {{ row.original.regimen_isr ? REGIMENES_ISR[row.original.regimen_isr] : '—' }}
                    </template>
                    <template #activa-cell="{ row }">
                        <UBadge
                            :label="row.original.activa ? 'Activa' : 'Inactiva'"
                            :icon="row.original.activa ? 'i-lucide-circle-check' : 'i-lucide-circle-pause'"
                            :color="row.original.activa ? 'success' : 'neutral'"
                            variant="subtle"
                            size="sm"
                        />
                    </template>
                    <template #acciones-cell="{ row }">
                        <div class="flex flex-wrap justify-end gap-2">
                            <UButton
                                v-if="puede('empresas.editar')"
                                label="Editar"
                                icon="i-lucide-pencil"
                                color="neutral"
                                variant="outline"
                                size="sm"
                                :aria-label="`Editar ${row.original.nombre_comercial}`"
                                @click="editar(row.original)"
                            />
                            <UButton
                                v-if="puede('empresas.cambiar_logo')"
                                label="Logo"
                                icon="i-lucide-image"
                                color="neutral"
                                variant="outline"
                                size="sm"
                                :aria-label="`Logo de ${row.original.nombre_comercial}`"
                                @click="abrirLogo(row.original)"
                            />
                            <UButton
                                v-if="puede('empresas.desactivar') && row.original.activa && !row.original.principal"
                                label="Desactivar"
                                icon="i-lucide-circle-pause"
                                color="error"
                                variant="outline"
                                size="sm"
                                :aria-label="`Desactivar ${row.original.nombre_comercial}`"
                                @click="abrirDesactivar(row.original)"
                            />
                        </div>
                    </template>
                    <template #empty>
                        <UEmpty
                            icon="i-lucide-building-2"
                            title="Sin empresas"
                            variant="naked"
                        />
                    </template>
                </UTable>
            </template>

            <EmpresasSugeridas
                v-else
                :empresas="empresas.filter(e => e.activa)"
            />
        </div>

        <EmpresaFormulario
            v-model:open="formularioAbierto"
            :empresa="editando"
            @guardada="empresa => reemplazar(empresa, editando ? 'Empresa actualizada' : 'Empresa creada')"
        />
        <EmpresaLogoModal
            v-if="logoDe"
            v-model:open="logoAbierto"
            :empresa="logoDe"
            @guardada="empresa => reemplazar(empresa, 'Logo actualizado')"
        />
        <AccionMotivoModal
            v-model:open="desactivarAbierto"
            titulo="Desactivar empresa"
            :descripcion="desactivarDe ? `${desactivarDe.nombre_comercial} · NIT ${desactivarDe.nit ?? '—'}` : undefined"
            efecto="La empresa deja de aparecer en el selector y su NIT queda libre. No se borra: sus documentos siguen. Si tiene servicios sin retirar, primero hay que pasarlos a otra empresa."
            confirmar="Desactivar empresa"
            icono="i-lucide-circle-pause"
            placeholder="Ej.: el NIT dejó de operar"
            :ejecutar="desactivar"
            @hecho="empresa => reemplazar(empresa, 'Empresa desactivada')"
        />
    </PanelPagina>
</template>
