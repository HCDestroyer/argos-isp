<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'

/**
 * La persona abierta en `/usuarios` (tablero OperUsuarios): roles y alcance, empresas que opera,
 * seguridad y lo último que hizo, con Editar, Contraseña y Desactivar al pie. Lo que la API todavía
 * no da (sesiones abiertas, cuentas vinculadas, último ingreso) se dice, sin datos inventados.
 */
const props = withDefaults(defineProps<{
    usuario: UsuarioPanel
    /** Nombre de cada empresa por id. */
    nombreEmpresa: (id: number) => string
    ultimas: AccionAuditoria[] | null
    problemaUltimas: Problem | null
    esYo: boolean
    sinEncabezado?: boolean
}>(), {
    sinEncabezado: false,
})

const emit = defineEmits<{
    editar: [usuario: UsuarioPanel]
    activo: [usuario: UsuarioPanel]
    empresas: [usuario: UsuarioPanel]
    reintentar: []
}>()

const { puede } = usePermisos()

function textoAlcance(rol: AsignacionRol): string {
    return rol.alcance_tipo ? `${ALCANCES_ROL[rol.alcance_tipo].etiqueta} ${rol.alcance_id}` : 'Toda la empresa'
}

const desde = computed(() => new Intl.DateTimeFormat('es-GT', { month: 'short', year: 'numeric', timeZone: 'America/Guatemala' }).format(new Date(props.usuario.created_at)))
</script>

<template>
    <OperPanelLateral data-prueba="detalle-usuario">
        <template
            v-if="!sinEncabezado"
            #encabezado
        >
            <AvatarIniciales
                :nombre="usuario.nombre"
                size="lg"
            />
            <div class="flex min-w-0 flex-1 flex-col">
                <h2 class="truncate text-lg font-bold text-highlighted">
                    {{ usuario.nombre }}<span
                        v-if="esYo"
                        class="font-normal text-muted"
                    > (tú)</span>
                </h2>
                <p class="truncate text-[0.8125rem] text-muted">
                    {{ usuario.email }} · desde {{ desde }}
                </p>
            </div>
            <UBadge
                :label="usuario.activo ? 'Activo' : 'Desactivado'"
                :icon="usuario.activo ? 'i-lucide-circle-check' : 'i-lucide-circle-pause'"
                :color="usuario.activo ? 'success' : 'neutral'"
                variant="subtle"
            />
        </template>

        <section class="flex flex-col gap-1">
            <h3 class="text-xs font-semibold tracking-[0.06em] text-muted uppercase">
                Roles y alcance
            </h3>
            <ul class="flex flex-col divide-y divide-(--ax-borde)">
                <li
                    v-for="rol in usuario.roles"
                    :key="`${rol.role_id}-${rol.alcance_tipo}-${rol.alcance_id}`"
                    class="flex items-center justify-between gap-3 py-2"
                >
                    <span class="text-sm font-semibold text-highlighted capitalize">{{ rol.rol }}</span>
                    <UBadge
                        :label="textoAlcance(rol)"
                        :icon="rol.alcance_tipo ? ALCANCES_ROL[rol.alcance_tipo].icono : undefined"
                        :color="rol.alcance_tipo ? 'primary' : 'neutral'"
                        variant="subtle"
                        size="sm"
                    />
                </li>
                <li
                    v-if="!usuario.roles.length"
                    class="py-2 text-sm text-muted"
                >
                    Sin roles: no puede hacer nada en el panel.
                </li>
            </ul>
            <UButton
                v-if="puede('usuarios.editar')"
                label="Agregar rol"
                icon="i-lucide-plus"
                color="primary"
                variant="link"
                size="sm"
                class="self-start px-0"
                @click="emit('editar', usuario)"
            />
        </section>

        <section class="flex flex-col gap-2">
            <h3 class="text-xs font-semibold tracking-[0.06em] text-muted uppercase">
                Empresas
            </h3>
            <div class="flex flex-wrap gap-1.5">
                <UBadge
                    v-if="usuario.alcance_global"
                    label="Todas (alcance global)"
                    icon="i-lucide-layers"
                    color="primary"
                    variant="solid"
                />
                <template v-else>
                    <UBadge
                        v-for="id in usuario.empresas ?? []"
                        :key="id"
                        :label="nombreEmpresa(id)"
                        color="neutral"
                        variant="outline"
                    />
                </template>
                <UButton
                    v-if="puede('usuarios.asignar_empresas')"
                    label="Cambiar"
                    icon="i-lucide-building-2"
                    color="neutral"
                    variant="ghost"
                    size="xs"
                    @click="emit('empresas', usuario)"
                />
            </div>
        </section>

        <section class="flex flex-col gap-1">
            <h3 class="text-xs font-semibold tracking-[0.06em] text-muted uppercase">
                Seguridad
            </h3>
            <p class="text-sm text-muted">
                Sesiones abiertas, cuentas vinculadas y último ingreso llegan cuando la API los publique.
            </p>
        </section>

        <section
            v-if="puede('bitacora.ver')"
            class="flex flex-col gap-1"
        >
            <h3 class="text-xs font-semibold tracking-[0.06em] text-muted uppercase">
                Lo último que hizo
            </h3>
            <ProblemaAlerta
                v-if="problemaUltimas"
                :problema="problemaUltimas"
                :reintentar="() => emit('reintentar')"
            />
            <USkeleton
                v-else-if="ultimas === null"
                class="h-16 w-full"
            />
            <p
                v-else-if="!ultimas.length"
                class="text-sm text-muted"
            >
                Todavía no hizo nada en el panel.
            </p>
            <ul
                v-else
                class="flex flex-col"
            >
                <li
                    v-for="accion in ultimas"
                    :key="accion.id"
                    class="flex justify-between gap-3 py-1.5 text-sm"
                >
                    <span class="truncate text-highlighted">{{ tituloAccion(accion) }}</span>
                    <span class="shrink-0 text-muted tabular-nums">{{ formatearFechaCorta(accion.created_at) }}</span>
                </li>
            </ul>
            <ULink
                :to="`/bitacora?actor=${usuario.id}`"
                class="text-sm font-semibold text-primary"
            >
                Ver todo en la bitácora
            </ULink>
        </section>

        <template
            v-if="puede('usuarios.editar')"
            #pie
        >
            <UButton
                label="Editar"
                :icon="ICONOS.editar"
                color="neutral"
                variant="outline"
                :data-prueba="`editar-usuario-${usuario.id}`"
                @click="emit('editar', usuario)"
            />
            <UButton
                label="Contraseña"
                icon="i-lucide-key-round"
                color="neutral"
                variant="outline"
                @click="emit('editar', usuario)"
            />
            <UButton
                v-if="!esYo"
                :label="usuario.activo ? 'Desactivar' : 'Reactivar'"
                :icon="usuario.activo ? 'i-lucide-user-x' : 'i-lucide-user-check'"
                :color="usuario.activo ? 'error' : 'neutral'"
                variant="outline"
                class="ms-auto"
                :data-prueba="`activo-usuario-${usuario.id}`"
                @click="emit('activo', usuario)"
            />
        </template>
    </OperPanelLateral>
</template>
