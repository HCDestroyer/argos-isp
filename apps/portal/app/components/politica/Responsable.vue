<script setup lang="ts">
import type { EmpresaPublica } from '~/composables/useEmpresa'

/**
 * Datos de la empresa responsable, tal como están configurados en el panel (Empresa): nombre legal,
 * nombre comercial, NIT, dirección, correo y teléfonos. Solo lo que existe: un dato vacío no se
 * inventa; sin correo ni teléfono se remite a la página de contacto.
 */
const props = defineProps<{
    empresa: EmpresaPublica | null
}>()

const filas = computed(() => {
    const empresa = props.empresa
    if (!empresa) {
        return []
    }
    const legal = nombreLegal(empresa)
    const lista: { etiqueta: string, valor: string, to?: string, prueba: string }[] = [
        { etiqueta: 'Nombre legal', valor: legal, prueba: 'responsable-nombre-legal' },
    ]
    if (legal !== empresa.nombre) {
        lista.push({ etiqueta: 'Nombre comercial', valor: empresa.nombre, prueba: 'responsable-nombre' })
    }
    if (empresa.nit) {
        lista.push({ etiqueta: 'NIT', valor: empresa.nit, prueba: 'responsable-nit' })
    }
    if (empresa.direccion) {
        lista.push({ etiqueta: 'Dirección', valor: empresa.direccion, prueba: 'responsable-direccion' })
    }
    if (empresa.correo) {
        lista.push({ etiqueta: 'Correo', valor: empresa.correo, to: `mailto:${empresa.correo}`, prueba: 'responsable-correo' })
    }
    for (const telefono of [empresa.telefono, empresa.telefono_alterno]) {
        if (telefono) {
            lista.push({ etiqueta: 'Teléfono', valor: telefono, to: `tel:${telefono.replace(/[^\d+]/g, '')}`, prueba: 'responsable-telefono' })
        }
    }
    if (empresa.horario) {
        lista.push({ etiqueta: 'Horario de atención', valor: empresa.horario, prueba: 'responsable-horario' })
    }
    return lista
})

const sinMedios = computed(() => !!props.empresa && !props.empresa.correo && !props.empresa.telefono && !props.empresa.telefono_alterno)
const contacto = computed(() => props.empresa ? `/contacto?empresa=${props.empresa.id}` : '/contacto')
</script>

<template>
    <UCard
        variant="subtle"
        :ui="{ body: 'flex flex-col gap-3' }"
        data-testid="politica-responsable"
    >
        <dl
            v-if="filas.length > 0"
            class="grid grid-cols-1 gap-x-4 gap-y-2 text-sm sm:grid-cols-[auto_1fr]"
        >
            <template
                v-for="fila in filas"
                :key="`${fila.etiqueta}-${fila.valor}`"
            >
                <dt class="text-muted">
                    {{ fila.etiqueta }}
                </dt>
                <dd
                    class="font-medium text-highlighted [overflow-wrap:anywhere]"
                    :data-testid="fila.prueba"
                >
                    <ULink
                        v-if="fila.to"
                        :to="fila.to"
                        external
                        class="text-primary underline underline-offset-2"
                    >
                        {{ fila.valor }}
                    </ULink>
                    <template v-else>
                        {{ fila.valor }}
                    </template>
                </dd>
            </template>
        </dl>
        <p class="text-sm text-muted">
            <template v-if="sinMedios">
                Para cualquier solicitud sobre tus datos, comunícate por los medios de nuestra
            </template>
            <template v-else>
                También puedes ver todos nuestros medios de atención en la
            </template>
            <ULink
                :to="contacto"
                class="text-primary underline underline-offset-2"
            >página de contacto</ULink>.
        </p>
    </UCard>
</template>
