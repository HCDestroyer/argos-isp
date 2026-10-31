<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'

/**
 * «Sincronizar con el router» (`POST /servicios/:id/sincronizar-router`, `servicios.sincronizar_router`):
 * aplica ya en el MikroTik la cola, la address-list, el lease y el ARP del servicio. Muestra lo
 * que se corrigió o «Ya estaba sincronizado»; si el router no responde, el motivo con sus comandos
 * de RouterOS; los 422 (`servicio_pendiente_instalacion`, `router_sin_api`) en lenguaje simple.
 */
const props = defineProps<{
    servicio: Servicio
    nombreRouter: string | null
}>()

const abierto = defineModel<boolean>('open', { default: false })

const resultado = shallowRef<SincronizacionServicio | null>(null)
const problema = ref<Problem | null>(null)
const sincronizando = ref(false)

const ACCIONES: Record<SincronizacionServicio['cambios'][number]['accion'], { etiqueta: string, color: 'success' | 'info' | 'warning' }> = {
    creado: { etiqueta: 'Creado', color: 'success' },
    actualizado: { etiqueta: 'Corregido', color: 'info' },
    borrado: { etiqueta: 'Borrado', color: 'warning' },
    desconectado: { etiqueta: 'Sesión desconectada', color: 'warning' },
}

watch(abierto, (valor) => {
    if (valor) {
        resultado.value = null
        problema.value = null
    }
})

async function sincronizar() {
    sincronizando.value = true
    problema.value = null
    const respuesta = await useServicios().sincronizarRouter(props.servicio.id, nuevaClaveIdempotencia())
    sincronizando.value = false
    resultado.value = respuesta.ok ? respuesta.data : null
    problema.value = respuesta.ok ? null : respuesta.problema
}

const explicado = computed(() => {
    const codigo = problema.value ? codigoProblema(problema.value) : null
    return codigo ? ERRORES_SINCRONIZAR_ROUTER[codigo] ?? null : null
})
</script>

<template>
    <UModal
        v-model:open="abierto"
        :title="`Sincronizar con el router · ${etiquetaServicio(servicio)}`"
        :description="`Revisa en ${nombreRouter ?? 'el router'} la cola, la address-list, el lease y el ARP de este servicio y corrige lo que no coincida con Argos.`"
        :dismissible="!sincronizando"
        :ui="{ content: 'sm:max-w-xl' }"
    >
        <template #body>
            <div
                class="flex flex-col gap-4"
                data-prueba="sincronizar-router"
            >
                <p
                    v-if="!resultado && !problema"
                    class="text-sm text-muted"
                >
                    No desconecta al cliente. Úsalo si alguien tocó el router a mano o si el servicio no navega como debería.
                </p>

                <UAlert
                    v-if="problema && explicado"
                    color="warning"
                    variant="subtle"
                    icon="i-lucide-circle-alert"
                    :title="explicado.titulo"
                    :description="`${explicado.ayuda} ${problema.detail ?? ''}`.trim()"
                    data-prueba="sincronizar-422"
                />
                <ProblemaAlerta
                    v-else-if="problema"
                    :problema="problema"
                    :reintentar="sincronizar"
                    :reintentando="sincronizando"
                />

                <template v-if="resultado">
                    <UAlert
                        v-if="resultado.error"
                        color="error"
                        variant="subtle"
                        icon="i-lucide-unplug"
                        title="El router no respondió como se esperaba"
                        data-prueba="sincronizar-error"
                    >
                        <template #description>
                            <DetalleRouterOs :detalle="resultado.error.detalle" />
                        </template>
                    </UAlert>
                    <UAlert
                        v-else-if="resultado.ya_estaba_bien"
                        color="success"
                        variant="subtle"
                        icon="i-lucide-circle-check"
                        title="Ya estaba sincronizado"
                        description="El router tenía todo como en Argos: no se cambió nada."
                        data-prueba="sincronizar-al-dia"
                    />
                    <div
                        v-if="resultado.cambios.length"
                        class="flex flex-col gap-2"
                        data-prueba="sincronizar-cambios"
                    >
                        <p class="text-sm font-medium text-highlighted">
                            {{ resultado.cambios.length === 1 ? 'Se corrigió 1 cosa en el router' : `Se corrigieron ${resultado.cambios.length} cosas en el router` }}
                        </p>
                        <ul class="flex flex-col divide-y divide-default rounded-md border border-default">
                            <li
                                v-for="(cambio, indice) in resultado.cambios"
                                :key="indice"
                                class="flex flex-wrap items-center justify-between gap-2 px-3 py-2"
                            >
                                <span class="flex min-w-0 flex-col">
                                    <span class="font-mono text-sm text-default">{{ cambio.ruta }}</span>
                                    <span class="truncate font-mono text-xs text-muted">{{ cambio.comment }}</span>
                                </span>
                                <span class="flex items-center gap-2">
                                    <span
                                        v-if="cambio.duplicados"
                                        class="text-xs text-muted"
                                    >{{ cambio.duplicados === 1 ? '1 duplicado quitado' : `${cambio.duplicados} duplicados quitados` }}</span>
                                    <UBadge
                                        :label="ACCIONES[cambio.accion].etiqueta"
                                        :color="ACCIONES[cambio.accion].color"
                                        variant="subtle"
                                        size="sm"
                                    />
                                </span>
                            </li>
                        </ul>
                    </div>
                    <ul
                        v-if="resultado.avisos.length"
                        class="flex flex-col gap-1"
                        data-prueba="sincronizar-avisos"
                    >
                        <li
                            v-for="aviso in resultado.avisos"
                            :key="aviso"
                            class="flex items-start gap-1.5 text-xs text-warning"
                        >
                            <UIcon
                                name="i-lucide-triangle-alert"
                                class="mt-0.5 size-3.5 shrink-0"
                            />
                            <span>{{ aviso }}</span>
                        </li>
                    </ul>
                </template>
            </div>
        </template>
        <template #footer>
            <div class="flex w-full justify-end gap-2">
                <UButton
                    label="Cerrar"
                    color="neutral"
                    variant="ghost"
                    :disabled="sincronizando"
                    @click="abierto = false"
                />
                <UButton
                    :label="resultado || problema ? 'Sincronizar de nuevo' : 'Sincronizar'"
                    icon="i-lucide-refresh-cw"
                    :loading="sincronizando"
                    data-prueba="sincronizar-router-confirmar"
                    @click="sincronizar"
                />
            </div>
        </template>
    </UModal>
</template>
