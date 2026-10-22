<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'

/**
 * Error de una acción sobre una declaración con qué hacer: las NCRE sin certificar (409
 * `ncre_sin_certificar`) enlazadas a su nota o su DTE, los checks de impuestos que no pasan (422
 * `checks_pendientes`) con el botón a la lista de verificación, y «Recalcular» cuando los datos
 * cambiaron (409 `declaracion_desactualizada`).
 */
const props = defineProps<{
    problema: Problem
    /** Muestra «Recalcular» con 409 `declaracion_desactualizada`. */
    puedeRecalcular?: boolean
}>()

const emit = defineEmits<{ checklist: [], recalcular: [] }>()

const { puede } = usePermisos()
const codigo = computed(() => codigoProblema(props.problema))
const legible = computed(() => problemaDeclaracionLegible(props.problema))
const notas = computed(() => (codigo.value === 'ncre_sin_certificar' ? ncreDeProblema(props.problema) : []))
const checks = computed(() => checksPendientesDe(props.problema))
</script>

<template>
    <div
        class="flex flex-col gap-3"
        data-prueba="problema-declaracion"
        :data-codigo="codigo ?? undefined"
    >
        <ProblemaAlerta :problema="legible" />
        <ul
            v-if="notas.length"
            class="flex flex-col divide-y divide-default rounded-lg border border-default"
            data-prueba="declaracion-ncre"
        >
            <li
                v-for="nota in notas"
                :key="nota.dteId"
                class="flex items-center justify-between gap-2 px-3 py-2"
            >
                <ULink
                    v-if="nota.notaId !== null && puede('facturas.ver')"
                    :to="`/notas-credito/${nota.notaId}`"
                    class="text-sm font-medium text-highlighted hover:text-primary"
                >
                    Nota de crédito #{{ nota.notaId }}
                </ULink>
                <ULink
                    v-else-if="puede('fel.ver')"
                    :to="`/dte/${nota.dteId}`"
                    class="text-sm font-medium text-highlighted hover:text-primary"
                >
                    NCRE · DTE #{{ nota.dteId }}
                </ULink>
                <span
                    v-else
                    class="text-sm text-highlighted"
                >NCRE · DTE #{{ nota.dteId }}</span>
                <EstadoDteBadge
                    v-if="nota.estado"
                    :estado="nota.estado"
                    size="sm"
                />
            </li>
        </ul>
        <ul
            v-if="checks.length"
            class="flex flex-col divide-y divide-default rounded-lg border border-default"
            data-prueba="declaracion-checks"
        >
            <li
                v-for="c in checks"
                :key="c.clave"
                class="px-3 py-2 text-sm"
                :data-clave="c.clave"
            >
                {{ c.mensaje }}
            </li>
        </ul>
        <div class="flex flex-wrap gap-2">
            <UButton
                v-if="checks.length && puede('libro.ver')"
                label="Ver la lista de verificación"
                icon="i-lucide-list-checks"
                color="neutral"
                variant="outline"
                size="sm"
                data-prueba="problema-a-checklist"
                @click="emit('checklist')"
            />
            <UButton
                v-if="codigo === 'ncre_sin_certificar' && puede('fel.ver')"
                label="NCRE en la cola de DTE"
                icon="i-lucide-badge-check"
                color="neutral"
                variant="outline"
                size="sm"
                to="/dte?documento=nota_credito"
            />
            <UButton
                v-if="codigo === 'declaracion_desactualizada' && puedeRecalcular && puede('declaraciones.calcular')"
                label="Recalcular"
                icon="i-lucide-refresh-cw"
                color="neutral"
                variant="outline"
                size="sm"
                data-prueba="problema-recalcular"
                @click="emit('recalcular')"
            />
        </div>
    </div>
</template>
