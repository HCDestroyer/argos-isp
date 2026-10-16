<script setup lang="ts">
/**
 * Contacto de la empresa, configurado en el panel (`GET /portal/empresa`): teléfonos, WhatsApp,
 * correo, horario y dirección. Si no se pudo leer, error con "Reintentar".
 */
const { empresa, problema, cargando, nombre, recargar } = useEmpresa()

useHead({ title: computed(() => `Contacto · ${nombre.value}`) })

const enlaces = computed(() => enlacesContacto(empresa.value))
</script>

<template>
    <div class="flex flex-col gap-4">
        <div>
            <h1 class="text-2xl font-semibold text-highlighted">
                Contacto
            </h1>
            <p class="mt-1 text-sm text-muted">
                Escríbenos o llámanos si tienes dudas sobre tu servicio o tus pagos.
            </p>
        </div>

        <template v-if="cargando">
            <USkeleton class="h-12 w-full" />
            <USkeleton class="h-12 w-full" />
            <USkeleton class="h-24 w-full" />
        </template>

        <UAlert
            v-else-if="problema"
            color="error"
            variant="subtle"
            icon="i-lucide-cloud-off"
            title="No pudimos cargar los datos de contacto"
            :description="mensajeProblema(problema)"
            :actions="[{ label: 'Reintentar', icon: 'i-lucide-refresh-cw', color: 'error', variant: 'outline', onClick: () => recargar() }]"
        />

        <template v-else-if="empresa">
            <div
                v-if="enlaces.length > 0"
                class="flex flex-col gap-2"
            >
                <UButton
                    v-for="(enlace, i) in enlaces"
                    :key="enlace.to"
                    :data-testid="`contacto-${enlace.tipo}`"
                    :label="enlace.label"
                    :icon="enlace.icon"
                    :to="enlace.to"
                    :color="i === 0 ? 'primary' : 'neutral'"
                    :variant="i === 0 ? 'solid' : 'outline'"
                    :target="enlace.tipo === 'whatsapp' ? '_blank' : undefined"
                    external
                    size="xl"
                    block
                />
                <p
                    v-if="enlaces.some(e => e.tipo === 'whatsapp')"
                    class="text-center text-xs text-muted"
                >
                    Con el servicio suspendido WhatsApp no funciona en esta conexión; llámanos.
                </p>
            </div>

            <UAlert
                v-else
                color="neutral"
                variant="subtle"
                icon="i-lucide-phone-off"
                title="Aún no hay datos de contacto configurados"
            />

            <UCard
                v-if="empresa.horario || empresa.direccion"
                :ui="{ body: 'flex flex-col gap-3' }"
            >
                <div
                    v-if="empresa.horario"
                    class="flex items-start gap-3"
                >
                    <UIcon
                        name="i-lucide-clock"
                        class="mt-0.5 size-5 shrink-0 text-muted"
                    />
                    <div>
                        <p class="text-sm font-medium text-highlighted">
                            Horario de atención
                        </p>
                        <p
                            class="text-sm text-default"
                            data-testid="contacto-horario"
                        >
                            {{ empresa.horario }}
                        </p>
                    </div>
                </div>
                <div
                    v-if="empresa.direccion"
                    class="flex items-start gap-3"
                >
                    <UIcon
                        name="i-lucide-map-pin"
                        class="mt-0.5 size-5 shrink-0 text-muted"
                    />
                    <div>
                        <p class="text-sm font-medium text-highlighted">
                            Oficina
                        </p>
                        <p class="text-sm text-default">
                            {{ empresa.direccion }}
                        </p>
                    </div>
                </div>
            </UCard>
        </template>

        <UButton
            label="Volver al estado de mi servicio"
            icon="i-lucide-wifi"
            color="neutral"
            variant="link"
            to="/corte"
            class="self-center"
        />
    </div>
</template>
