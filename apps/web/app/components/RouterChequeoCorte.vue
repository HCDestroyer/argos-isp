<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { DiagnosticoCorte } from '~/types/controlVelocidad'

/**
 * Chequeo `corte` de «Probar conexión» (`GET /routers/:id/diagnostico-corte`, `routers.ver`;
 * `contratos/control-velocidad.md` §10): reglas de corte, lista y perfil del suspendido, walled
 * garden y si el router llega al portal. Cada problema trae el paso a seguir de la API y, si
 * «Reconciliar ahora» lo arregla, el botón (con `routeros.reconciliar`).
 */
const props = defineProps<{
    router: Pick<RouterNas, 'id' | 'nombre'>
}>()

const emit = defineEmits<{
    reconciliado: []
}>()

const { puede } = usePermisos()
const diagnostico = shallowRef<DiagnosticoCorte | null>(null)
const cargando = ref(false)
const problema = ref<Problem | null>(null)
const reconciliarAbierto = ref(false)

const ICONOS: Record<DiagnosticoCorte['problemas'][number]['codigo'], string> = {
    sin_api: 'i-lucide-key-round',
    router_no_responde: 'i-lucide-unplug',
    faltan_reglas: 'i-lucide-shield-off',
    reglas_desordenadas: 'i-lucide-list-ordered',
    falta_lista_suspendidos: 'i-lucide-list-x',
    falta_perfil_suspendido: 'i-lucide-user-x',
    walled_garden: 'i-lucide-fence',
    portal_sin_configurar: 'i-lucide-settings',
    portal_inalcanzable: 'i-lucide-globe-lock',
}

const reconciliable = computed(() => diagnostico.value?.problemas.some(p => p.reconciliar) ?? false)

async function probar() {
    cargando.value = true
    problema.value = null
    const resultado = await useControlVelocidad().diagnosticoCorte(props.router.id)
    cargando.value = false
    diagnostico.value = resultado.ok ? resultado.data : null
    problema.value = resultado.ok ? null : resultado.problema
}

function alReconciliar() {
    emit('reconciliado')
    void probar()
}

defineExpose({ probar })
</script>

<template>
    <div
        class="flex flex-col gap-3"
        data-prueba="chequeo-corte"
    >
        <div class="flex flex-wrap items-center justify-between gap-2">
            <p class="text-sm text-muted">
                Revisa que el router pueda cortar y avisar: reglas de corte, perfil del suspendido, walled garden y acceso al portal.
            </p>
            <UButton
                :label="diagnostico || problema ? 'Probar otra vez' : 'Probar el corte'"
                icon="i-lucide-shield-check"
                color="neutral"
                variant="outline"
                size="sm"
                :loading="cargando"
                data-prueba="probar-corte"
                @click="probar"
            />
        </div>
        <ProblemaAlerta
            v-if="problema"
            :problema="problema"
            :reintentar="probar"
            :reintentando="cargando"
            data-prueba="corte-error"
        />
        <template v-else-if="diagnostico">
            <UAlert
                v-if="diagnostico.ok"
                color="success"
                variant="subtle"
                icon="i-lucide-circle-check"
                title="El corte está listo"
                :description="diagnostico.portal.url ? `Reglas en orden y el router llega al portal (${diagnostico.portal.url}).` : 'Reglas en orden.'"
                data-prueba="corte-ok"
            />
            <ul
                v-else
                class="flex flex-col gap-2"
                data-prueba="corte-problemas"
            >
                <li
                    v-for="item in diagnostico.problemas"
                    :key="item.codigo"
                >
                    <UAlert
                        color="error"
                        variant="subtle"
                        :icon="ICONOS[item.codigo]"
                        :title="item.mensaje"
                        :description="item.reconciliar ? 'Paso a seguir: «Reconciliar ahora» lo deja como debe estar.' : 'Paso a seguir: hazlo en el equipo o en el servidor; «Reconciliar ahora» no lo arregla.'"
                        :data-prueba="`corte-${item.codigo}`"
                    />
                </li>
            </ul>
            <p
                v-if="diagnostico.portal.alcanzable === false && diagnostico.portal.detalle"
                class="font-mono text-xs break-all text-muted"
            >
                {{ diagnostico.portal.detalle }}
            </p>
            <p
                v-if="diagnostico.faltan.length"
                class="text-xs text-muted"
            >
                {{ diagnostico.faltan.length }} {{ diagnostico.faltan.length === 1 ? 'objeto de corte' : 'objetos de corte' }} por crear o mover.
            </p>
            <UButton
                v-if="reconciliable && puede('routeros.reconciliar')"
                label="Reconciliar ahora"
                icon="i-lucide-refresh-cw"
                class="self-start"
                data-prueba="corte-reconciliar"
                @click="reconciliarAbierto = true"
            />
            <p
                v-else-if="reconciliable"
                class="text-xs text-muted"
            >
                Pide a un administrador o a un técnico que use «Reconciliar ahora».
            </p>
        </template>
        <RouterReconciliarModal
            v-if="puede('routeros.reconciliar')"
            v-model:open="reconciliarAbierto"
            :router="router"
            @reconciliado="alReconciliar"
        />
    </div>
</template>
