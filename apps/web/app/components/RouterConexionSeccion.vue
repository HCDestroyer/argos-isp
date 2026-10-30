<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'

/**
 * Sección «Conexión» de la ficha del router (`GET /routers/:id/conexion`, `routers.ver`): estado
 * del túnel WireGuard con icono + texto + color, IP del túnel, último handshake y versión de
 * RouterOS. Botones con su permiso exacto: «Script de conexión» (`routers.generar_script`), «Pegar
 * clave pública» (`routers.conexion_clave`) y «Rotar conexión» (`routers.rotar_conexion`).
 * Un router sin RADIUS (`modo_seguridad = 'api'`) no admite el script (la API responde 422
 * `script_requiere_radius`, también al rotar): los dos botones quedan deshabilitados con su motivo.
 */
const props = defineProps<{
    router: RouterNas
}>()

const { puede } = usePermisos()

const conexion = shallowRef<ConexionRouter | null>(null)
const problema = ref<Problem | null>(null)
const cargando = ref(false)

async function cargar() {
    cargando.value = true
    const resultado = await useRouters().conexion(props.router.id)
    cargando.value = false
    conexion.value = resultado.ok ? resultado.data : null
    problema.value = resultado.ok ? null : resultado.problema
}

watch(() => props.router.id, () => void cargar(), { immediate: true })

defineExpose({ cargar })

const estado = computed(() => (conexion.value ? ESTADOS_TUNEL[conexion.value.estado] : null))
const sinRadius = computed(() => esSinRadius(props.router))
const scriptAbierto = ref(false)
const rotarAbierto = ref(false)
const claveAbierta = ref(false)
</script>

<template>
    <section
        class="surface-card flex flex-col gap-4 p-4 sm:p-6"
        aria-labelledby="titulo-conexion-router"
        data-prueba="conexion-router"
    >
        <div class="flex flex-wrap items-start justify-between gap-3">
            <div class="flex flex-col gap-1">
                <h2
                    id="titulo-conexion-router"
                    class="flex items-center gap-2 text-base font-semibold text-highlighted"
                >
                    <UIcon
                        name="i-lucide-plug-zap"
                        class="size-5 text-primary"
                    />
                    Conexión
                </h2>
                <p class="text-sm text-muted">
                    Túnel WireGuard entre el router y ArgosIsp: RADIUS, CoA y la API del router viajan por dentro.
                </p>
            </div>
            <div class="flex flex-wrap gap-2">
                <!-- Sin RADIUS: deshabilitado, con el motivo en un tooltip (el botón deshabilitado no recibe el puntero). -->
                <UTooltip
                    v-if="puede('routers.generar_script') && sinRadius"
                    :text="MENSAJE_SCRIPT_SIN_RADIUS"
                    :content="{ side: 'bottom' }"
                    :ui="{ content: 'h-auto max-w-xs whitespace-normal py-1.5' }"
                >
                    <span
                        class="inline-flex"
                        tabindex="0"
                        data-prueba="script-deshabilitado"
                    >
                        <UButton
                            label="Script de conexión"
                            icon="i-lucide-file-code-2"
                            color="neutral"
                            variant="outline"
                            disabled
                            data-prueba="abrir-script"
                        />
                    </span>
                </UTooltip>
                <UButton
                    v-else-if="puede('routers.generar_script')"
                    label="Script de conexión"
                    icon="i-lucide-file-code-2"
                    :class="conexion?.estado === 'conectado' ? '' : 'glow-brand'"
                    :color="conexion?.estado === 'conectado' ? 'neutral' : 'primary'"
                    :variant="conexion?.estado === 'conectado' ? 'outline' : 'solid'"
                    data-prueba="abrir-script"
                    @click="scriptAbierto = true"
                />
                <UButton
                    v-if="puede('routers.conexion_clave') && conexion && conexion.estado !== 'sin_configurar'"
                    label="Pegar clave pública"
                    icon="i-lucide-clipboard-paste"
                    color="neutral"
                    variant="outline"
                    data-prueba="abrir-clave"
                    @click="claveAbierta = true"
                />
                <UButton
                    v-if="puede('routers.rotar_conexion') && conexion && conexion.estado !== 'sin_configurar'"
                    :disabled="sinRadius"
                    :title="sinRadius ? MENSAJE_SCRIPT_SIN_RADIUS : undefined"
                    label="Rotar conexión"
                    icon="i-lucide-rotate-ccw-key"
                    color="error"
                    variant="ghost"
                    data-prueba="abrir-rotar"
                    @click="rotarAbierto = true"
                />
            </div>
        </div>

        <UAlert
            v-if="sinRadius"
            color="info"
            variant="subtle"
            icon="i-lucide-plug"
            title="Router sin RADIUS: sin script de conexión"
            :description="MENSAJE_SCRIPT_SIN_RADIUS"
            data-prueba="script-sin-radius"
        />
        <ProblemaAlerta
            v-if="problema"
            :problema="problema"
            :reintentar="cargar"
            :reintentando="cargando"
        />
        <USkeleton
            v-else-if="!conexion"
            class="h-16 w-full"
        />
        <dl
            v-else-if="estado"
            class="grid gap-4 sm:grid-cols-4"
        >
            <DatoFicha etiqueta="Estado">
                <UBadge
                    :label="estado.etiqueta"
                    :icon="estado.icono"
                    :color="estado.color"
                    variant="subtle"
                    size="sm"
                    data-prueba="estado-tunel"
                />
                <p class="mt-1 text-xs text-muted">
                    {{ estado.descripcion }}
                </p>
            </DatoFicha>
            <DatoFicha
                etiqueta="IP del túnel"
                :valor="conexion.ip_tunel"
                mono
            />
            <DatoFicha
                etiqueta="Último handshake"
                :valor="conexion.ultimo_handshake ? formatearFechaHora(conexion.ultimo_handshake) : 'Nunca'"
                data-prueba="ultimo-handshake"
            />
            <DatoFicha
                etiqueta="RouterOS"
                :valor="conexion.routeros_version ?? (conexion.token_vence ? `Script vigente hasta ${formatearFechaHora(conexion.token_vence)}` : null)"
            />
        </dl>

        <RouterScriptModal
            v-if="puede('routers.generar_script')"
            v-model:open="scriptAbierto"
            :router="router"
            @generado="cargar"
        />
        <RouterScriptModal
            v-if="puede('routers.rotar_conexion')"
            v-model:open="rotarAbierto"
            :router="router"
            modo="rotar"
            @generado="cargar"
        />
        <RouterClaveModal
            v-if="puede('routers.conexion_clave')"
            v-model:open="claveAbierta"
            :router="router"
            @guardado="conexion = $event"
        />
    </section>
</template>
