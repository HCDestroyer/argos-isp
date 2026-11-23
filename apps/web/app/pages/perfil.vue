<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { TableColumn } from '@nuxt/ui'

/**
 * Mi cuenta: datos del usuario de la sesión y sus vinculaciones de autologin (`contratos/horus.md`
 * §1.5): la cuenta de Horus o Iris con la que entra a ArgosIsp sin volver a escribir la contraseña. Cada
 * usuario quita las suyas; el administrador las revoca todas desde Configuración → Integraciones.
 */
useHead({ title: 'Mi cuenta · ArgosIsp' })

const { usuario } = useAuth()
const toast = useToast()

const vinculaciones = shallowRef<VinculacionExterna[]>([])
const cargando = ref(false)
const problema = ref<Problem | null>(null)

async function cargar() {
    cargando.value = true
    problema.value = null
    const resultado = await useVinculaciones().mias()
    cargando.value = false
    vinculaciones.value = resultado.ok ? resultado.data : []
    problema.value = resultado.ok ? null : resultado.problema
}

onMounted(cargar)

const columnas: TableColumn<VinculacionExterna>[] = [
    { accessorKey: 'conector', header: 'Sistema' },
    { accessorKey: 'nombre_externo', header: 'Cuenta en el otro sistema', meta: { class: { td: 'whitespace-normal' } } },
    { accessorKey: 'created_at', header: 'Vinculada', meta: SOLO_ESCRITORIO },
    { id: 'acciones', header: '', meta: { class: { td: 'text-right w-0' } } },
]

const elegida = shallowRef<VinculacionExterna | null>(null)
const quitarAbierto = ref(false)

function pedirQuitar(vinculacion: VinculacionExterna) {
    elegida.value = vinculacion
    quitarAbierto.value = true
}

function quitar(): Promise<Resultado<VinculacionExterna>> {
    return elegida.value ? useVinculaciones().quitar(elegida.value.id) : Promise.resolve({ ok: false, problema: PROBLEMA_SIN_CONEXION })
}

function alQuitar(vinculacion: VinculacionExterna) {
    toast.add({ title: 'Vinculación quitada', description: `La próxima vez que entres desde ${nombreSistemaSso(vinculacion.conector)} te pediremos la contraseña.`, color: 'success', icon: 'i-lucide-circle-check' })
    void cargar()
}
</script>

<template>
    <PanelPagina
        id="perfil"
        titulo="Mi cuenta"
        icono="i-lucide-circle-user"
        descripcion="Tus datos y las cuentas de Iris u Horus con las que entras sin contraseña"
    >
        <div class="mx-auto flex w-full max-w-4xl flex-col gap-4">
            <section
                v-if="usuario"
                class="surface-card flex flex-col gap-4 rounded-[1.375rem] p-4 sm:flex-row sm:items-center sm:p-5"
                aria-label="Mis datos"
            >
                <AvatarIniciales
                    :nombre="usuario.nombre"
                    size="3xl"
                />
                <div class="flex min-w-0 flex-1 flex-col gap-1">
                    <p class="truncate text-xl font-bold text-highlighted">
                        {{ usuario.nombre }}
                    </p>
                    <p class="truncate text-sm text-muted">
                        {{ usuario.email }}
                    </p>
                    <div class="flex flex-wrap gap-1.5 pt-1">
                        <UBadge
                            v-for="rol in usuario.roles"
                            :key="rol"
                            :label="rol"
                            icon="i-lucide-shield"
                            color="primary"
                            variant="subtle"
                            class="capitalize"
                        />
                    </div>
                </div>
            </section>

            <section
                class="surface-card flex flex-col gap-4 rounded-[1.375rem] p-4 sm:p-5"
                aria-labelledby="titulo-vinculaciones"
            >
                <div>
                    <h2
                        id="titulo-vinculaciones"
                        class="flex items-center gap-2 text-base font-semibold text-highlighted"
                    >
                        <UIcon
                            name="i-lucide-link"
                            class="size-5"
                        />
                        Cuentas vinculadas
                    </h2>
                    <p class="text-sm text-muted">
                        Con una cuenta vinculada, "Ver en ArgosIsp" desde Horus o Iris te abre ArgosIsp con tus permisos, sin pedirte la contraseña.
                    </p>
                </div>
                <ProblemaAlerta
                    v-if="problema"
                    :problema="problema"
                    :reintentar="cargar"
                    :reintentando="cargando"
                />
                <UTable
                    v-else
                    :data="vinculaciones"
                    :columns="columnas"
                    :loading="cargando"
                    data-prueba="tabla-vinculaciones"
                >
                    <template #conector-cell="{ row }">
                        <span class="text-sm font-medium text-highlighted">{{ nombreSistemaSso(row.original.conector) }}</span>
                    </template>
                    <template #nombre_externo-cell="{ row }">
                        <div class="flex min-w-0 flex-col">
                            <span class="text-sm">{{ row.original.nombre_externo ?? row.original.id_externo }}</span>
                            <span
                                v-if="row.original.correo_externo"
                                class="break-all text-xs text-muted"
                            >{{ row.original.correo_externo }}</span>
                        </div>
                    </template>
                    <template #created_at-cell="{ row }">
                        {{ formatearFechaHora(row.original.created_at) }}
                    </template>
                    <template #acciones-cell="{ row }">
                        <UButton
                            label="Quitar"
                            icon="i-lucide-unlink"
                            color="error"
                            variant="ghost"
                            size="sm"
                            :aria-label="`Quitar la vinculación con ${nombreSistemaSso(row.original.conector)}`"
                            :data-prueba="`quitar-vinculacion-${row.original.id}`"
                            @click="pedirQuitar(row.original)"
                        />
                    </template>
                    <template #empty>
                        <UEmpty
                            icon="i-lucide-link-2-off"
                            title="Sin cuentas vinculadas"
                            description="Se vinculan solas la primera vez que entras desde Horus o Iris e inicias sesión."
                            variant="naked"
                        />
                    </template>
                </UTable>
            </section>
        </div>

        <ConfirmacionModal
            v-model:open="quitarAbierto"
            titulo="Quitar vinculación"
            :efecto="`Tu cuenta ${elegida?.nombre_externo ?? elegida?.id_externo ?? ''} de ${nombreSistemaSso(elegida?.conector)} ya no abrirá ArgosIsp sin contraseña.`"
            confirmar="Quitar"
            icono="i-lucide-unlink"
            :ejecutar="quitar"
            @hecho="alQuitar"
        />
    </PanelPagina>
</template>
