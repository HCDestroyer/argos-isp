<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'

/**
 * Tokens de API (A1, tarea 9): integraciones y agentes de IA. Lista con usuario, alcances, último
 * uso y estado; crear (`tokens.crear`, el valor se ve una sola vez y no se guarda en el navegador)
 * y revocar (`tokens.revocar`). Los de Horus viven en Integraciones → Horus.
 */
definePageMeta({ permiso: 'tokens.ver' })

useHead({ title: 'Tokens de API · ArgosIsp' })

const { puede } = usePermisos()
const toast = useToast()

const lista = usePaginacionCursor(cursor => useTokensApi().listar(cursor))

/** Usuarios para el nombre de cada token y para elegir al crear (`usuarios.ver`). */
const usuarios = shallowRef<UsuarioPanel[]>([])
/** Catálogo para recortar permisos (`roles.ver`); sin él, el token hereda los del usuario. */
const catalogo = shallowRef<PermisoCatalogo[]>([])

async function cargarApoyo() {
    const [listaUsuarios, listaPermisos] = await Promise.all([
        puede('usuarios.ver') ? useUsuarios().listar() : null,
        puede('roles.ver') ? useCatalogoPermisos().listar() : null,
    ])
    usuarios.value = listaUsuarios?.ok ? listaUsuarios.data.data : []
    catalogo.value = listaPermisos?.ok ? listaPermisos.data : []
}

onMounted(() => {
    void lista.recargar()
    void cargarApoyo()
})

function nombreUsuario(id: number): string {
    return usuarios.value.find(u => u.id === id)?.nombre ?? `Usuario ${id}`
}

function resumenAlcances(token: TokenApi): string {
    // `AlcancesToken` (A1): una clave ausente no recorta esa dimensión
    const { permisos, routers, zonas, cajas } = token.alcances
    const partes = [permisos === undefined ? 'Permisos del usuario' : `${permisos.length} ${permisos.length === 1 ? 'permiso' : 'permisos'}`]
    if (routers?.length) {
        partes.push(`${routers.length} ${routers.length === 1 ? 'router' : 'routers'}`)
    }
    if (zonas?.length) {
        partes.push(`${zonas.length} ${zonas.length === 1 ? 'zona' : 'zonas'}`)
    }
    if (cajas?.length) {
        partes.push(`${cajas.length} ${cajas.length === 1 ? 'caja' : 'cajas'}`)
    }
    return partes.join(' · ')
}

/* Crear */
const crearAbierto = ref(false)
const creado = shallowRef<TokenApiCreado | null>(null)
const valorAbierto = ref(false)

function alCrear(resultado: TokenApiCreado) {
    creado.value = resultado
    valorAbierto.value = true
    void lista.recargar()
}

/* Revocar */
const aRevocar = shallowRef<TokenApi | null>(null)
const revocarAbierto = ref(false)

function pedirRevocar(token: TokenApi) {
    aRevocar.value = token
    revocarAbierto.value = true
}

function revocar(): Promise<Resultado<TokenApi>> {
    const token = aRevocar.value
    if (!token) {
        return Promise.resolve({ ok: false, problema: { type: 'about:blank', title: 'Elige un token', status: 400 } })
    }
    return useTokensApi().revocar(token.id)
}

function alRevocar(token: TokenApi) {
    lista.filas.value = lista.filas.value.map(t => (t.id === token.id ? token : t))
    toast.add({ title: `Token «${token.nombre}» revocado`, description: 'Deja de funcionar de inmediato.', icon: 'i-lucide-circle-check', color: 'success' })
}

const columnas: TableColumn<TokenApi>[] = [
    { accessorKey: 'nombre', header: 'Token', meta: { class: { td: 'whitespace-normal' } } },
    { id: 'alcances', header: 'Alcance', meta: SOLO_ESCRITORIO },
    { id: 'uso', header: 'Último uso', meta: SOLO_ANCHO },
    { id: 'estado', header: 'Estado' },
    { id: 'acciones', header: '', meta: { class: { td: 'text-right w-0' } } },
]
</script>

<template>
    <PanelPagina
        id="tokens"
        titulo="Tokens de API"
        icono="i-lucide-key-round"
    >
        <template #acciones>
            <UButton
                v-if="puede('tokens.crear') && puede('usuarios.ver')"
                label="Nuevo token"
                icon="i-lucide-plus"
                data-prueba="nuevo-token"
                @click="crearAbierto = true"
            />
        </template>

        <div class="flex flex-col gap-4">
            <UsuariosNavegacion />

            <p class="text-sm text-muted">
                Un token actúa como su usuario y pasa por el mismo ACL, recortado a sus alcances. Se muestra una sola vez al crearlo; revocarlo lo apaga de inmediato.
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
                    data-prueba="tabla-tokens"
                >
                    <template #nombre-cell="{ row }">
                        <div
                            class="flex min-w-0 flex-col gap-0.5"
                            :data-token="row.original.id"
                        >
                            <span class="text-sm font-medium text-highlighted">{{ row.original.nombre }}</span>
                            <span class="text-xs text-muted">{{ nombreUsuario(row.original.usuario_id) }} · creado {{ formatearFecha(row.original.created_at) }}</span>
                            <span class="text-xs text-muted lg:hidden">{{ resumenAlcances(row.original) }}</span>
                            <span class="text-xs text-muted sm:hidden">{{ row.original.ultimo_uso ? `Usado ${formatearFechaHora(row.original.ultimo_uso)}` : 'Sin usar' }}</span>
                        </div>
                    </template>
                    <template #alcances-cell="{ row }">
                        <span class="text-sm">{{ resumenAlcances(row.original) }}</span>
                    </template>
                    <template #uso-cell="{ row }">
                        <span class="whitespace-nowrap text-sm text-muted">{{ row.original.ultimo_uso ? formatearFechaHora(row.original.ultimo_uso) : 'Sin usar' }}</span>
                    </template>
                    <template #estado-cell="{ row }">
                        <UBadge
                            :label="row.original.revocado_en ? 'Revocado' : 'Activo'"
                            :icon="row.original.revocado_en ? 'i-lucide-ban' : 'i-lucide-circle-check'"
                            :color="row.original.revocado_en ? 'neutral' : 'success'"
                            variant="subtle"
                            size="sm"
                            :title="row.original.revocado_en ? `Revocado ${formatearFechaHora(row.original.revocado_en)}` : undefined"
                            :data-prueba="`estado-token-${row.original.id}`"
                        />
                    </template>
                    <template #acciones-cell="{ row }">
                        <UButton
                            v-if="puede('tokens.revocar') && !row.original.revocado_en"
                            label="Revocar"
                            icon="i-lucide-ban"
                            color="error"
                            variant="ghost"
                            size="sm"
                            :aria-label="`Revocar el token ${row.original.nombre}`"
                            :data-prueba="`revocar-token-${row.original.id}`"
                            @click="pedirRevocar(row.original)"
                        />
                    </template>
                    <template #empty>
                        <UEmpty
                            icon="i-lucide-key-round"
                            title="Todavía no hay tokens de API"
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

        <TokenApiModal
            v-model:open="crearAbierto"
            :usuarios="usuarios"
            :catalogo="catalogo"
            @creado="alCrear"
        />
        <ValorUnaVezModal
            v-if="creado"
            v-model:open="valorAbierto"
            :titulo="`Token «${creado.datos.nombre}»`"
            descripcion="Cópialo ahora y guárdalo en la integración o el agente. Va en el encabezado Authorization: Bearer."
            :valores="[{ etiqueta: 'Token', valor: creado.token, secreto: true }]"
            @cerrado="creado = null"
        />
        <ConfirmacionModal
            v-model:open="revocarAbierto"
            titulo="Revocar token de API"
            :efecto="`«${aRevocar?.nombre ?? ''}» deja de funcionar de inmediato. No se puede deshacer: para volver a conectar, crea otro.`"
            confirmar="Revocar"
            :ejecutar="revocar"
            @hecho="alRevocar"
        />
    </PanelPagina>
</template>
