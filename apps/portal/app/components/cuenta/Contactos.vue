<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'

/**
 * «Mis contactos» en «Cuenta» (contrato Iris 0.10.0 §3.5; decisión del PM «También el titular desde
 * el portal»): quién más puede consultar, reportar fallas, pagar o recibir avisos de tus servicios.
 * Agregar y editar abren su página (`/contactos/nuevo`, `/contactos/:id`). Con la sesión de
 * `/corte` (por la IP) la API responde 403 y se pide entrar con código o contraseña.
 */
const contactos = useContactosCliente()
const lista = ref<ContactoCliente[] | null>(null)
const problema = ref<Problem | null>(null)
const cargando = ref(true)

async function cargar() {
    cargando.value = true
    problema.value = null
    const leidos = await contactos.listar()
    cargando.value = false
    if (leidos.ok) {
        lista.value = leidos.data.data
    }
    else {
        problema.value = leidos.problema
    }
}
onMounted(cargar)

const otros = computed(() => (lista.value ?? []).filter(c => !c.es_titular))
const sesionInsuficiente = computed(() => problema.value?.status === 403 && codigoProblema(problema.value) === 'sesion_insuficiente')
</script>

<template>
    <UCard
        :ui="{ body: 'p-4 sm:p-5' }"
        data-testid="mis-contactos"
    >
        <div class="flex flex-wrap items-center gap-3">
            <span class="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <UIcon
                    name="i-lucide-users"
                    class="size-5"
                />
            </span>
            <div class="min-w-0 flex-1">
                <h3 class="font-semibold text-highlighted">
                    Mis contactos
                </h3>
                <p class="text-sm text-muted">
                    Personas que pueden ayudarte con tus servicios.
                </p>
            </div>
            <UButton
                v-if="lista"
                label="Agregar"
                icon="i-lucide-user-plus"
                color="neutral"
                variant="outline"
                to="/contactos/nuevo"
                data-testid="contacto-agregar"
            />
        </div>

        <div class="mt-4">
            <USkeleton
                v-if="cargando && !lista"
                class="h-16 w-full"
            />
            <UAlert
                v-else-if="sesionInsuficiente"
                color="info"
                variant="subtle"
                icon="i-lucide-lock"
                title="Entra con tu código o tu contraseña para ver tus contactos"
            />
            <UAlert
                v-else-if="problema"
                color="error"
                variant="subtle"
                icon="i-lucide-cloud-off"
                title="No pudimos cargar tus contactos"
                :description="mensajeProblema(problema)"
                :actions="[{ label: 'Reintentar', icon: 'i-lucide-refresh-cw', color: 'error', variant: 'outline', onClick: cargar }]"
            />
            <UEmpty
                v-else-if="otros.length === 0"
                icon="i-lucide-users"
                title="No has agregado a nadie"
                description="Un familiar o inquilino puede reportar fallas o pagar por ti."
                variant="naked"
            />
            <ul
                v-else
                class="flex flex-col divide-y divide-default"
            >
                <li
                    v-for="contacto in otros"
                    :key="contacto.contacto_id"
                >
                    <ULink
                        :to="`/contactos/${contacto.contacto_id}`"
                        class="flex min-h-14 items-center gap-3 rounded-lg py-3 hover:bg-elevated/60"
                        data-testid="contacto"
                    >
                        <UAvatar
                            :alt="contacto.nombre"
                            size="md"
                        />
                        <span class="flex min-w-0 flex-1 flex-col">
                            <span class="truncate font-medium text-highlighted">
                                {{ contacto.nombre }}
                                <span class="font-normal text-muted">· {{ NOMBRE_RELACION[contacto.relacion] }}</span>
                            </span>
                            <span class="truncate text-xs text-muted">
                                {{ contacto.telefonos[0] ? numeroLegible(contacto.telefonos[0].numero) : '' }} · {{ resumenPermisos(contacto.permisos) }}
                            </span>
                        </span>
                        <UBadge
                            v-if="contacto.vinculado"
                            label="También es cliente"
                            color="info"
                            variant="subtle"
                            class="shrink-0 max-sm:hidden"
                        />
                        <UIcon
                            name="i-lucide-chevron-right"
                            class="size-4 shrink-0 text-dimmed"
                        />
                    </ULink>
                </li>
            </ul>
        </div>
    </UCard>
</template>
