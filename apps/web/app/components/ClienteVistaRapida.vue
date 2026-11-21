<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'

/**
 * Vista rápida de un cliente desde la lista (maestro-detalle): datos de contacto y fiscales, sus
 * servicios con estado y las acciones frecuentes, sin salir de la lista. La ficha completa sigue en
 * `/clientes/:id`.
 */
const props = defineProps<{
    cliente: Cliente | null
    nombreZona?: string | null
}>()

const abierto = defineModel<boolean>('open', { default: false })

const { puede, enlace } = usePermisos()
const verServicios = computed(() => puede('servicios.ver'))

const servicios = shallowRef<Servicio[] | null>(null)
const problema = ref<Problem | null>(null)

async function cargarServicios() {
    servicios.value = null
    problema.value = null
    if (!props.cliente || !verServicios.value) {
        return
    }
    const resultado = await useServicios().listar({ cliente_id: props.cliente.id })
    servicios.value = resultado.ok ? resultado.data.data : null
    problema.value = resultado.ok ? null : resultado.problema
}

watch(() => [abierto.value, props.cliente?.id], () => {
    if (abierto.value) {
        void cargarServicios()
    }
}, { immediate: true })

const activos = computed(() => servicios.value?.filter(s => s.estado === 'activo').length ?? 0)
</script>

<template>
    <VistaRapida
        v-if="cliente"
        v-model:open="abierto"
        :titulo="cliente.nombre"
        :subtitulo="`${cliente.codigo} · ${cliente.email ?? 'Sin correo'}`"
        :avatar="cliente.nombre"
    >
        <template #estado>
            <UBadge
                :label="cliente.tipo === 'empresa' ? 'Empresa' : 'Persona'"
                :icon="cliente.tipo === 'empresa' ? 'i-lucide-building-2' : 'i-lucide-user'"
                color="neutral"
                variant="subtle"
                size="sm"
            />
            <UBadge
                v-if="cliente.nit_cui_invalido"
                label="NIT por corregir"
                icon="i-lucide-triangle-alert"
                color="warning"
                variant="subtle"
                size="sm"
            />
        </template>

        <div
            v-if="verServicios && servicios"
            class="grid grid-cols-2 gap-3"
        >
            <div class="flex flex-col gap-0.5 rounded-lg bg-(--ax-panel) p-3">
                <span class="text-xs text-muted">Servicios</span>
                <span class="text-xl font-bold tabular-nums text-highlighted">{{ servicios.length }}</span>
            </div>
            <div class="flex flex-col gap-0.5 rounded-lg bg-(--ax-panel) p-3">
                <span class="text-xs text-muted">Activos</span>
                <span class="text-xl font-bold tabular-nums text-highlighted">{{ activos }}</span>
            </div>
        </div>

        <section class="flex flex-col gap-3">
            <h3 class="text-xs font-semibold tracking-[0.04em] text-muted uppercase">
                Contacto
            </h3>
            <dl class="grid grid-cols-2 gap-x-4 gap-y-3">
                <DatoFicha
                    etiqueta="Teléfono"
                    :valor="cliente.telefono"
                />
                <DatoFicha
                    etiqueta="Móvil"
                    :valor="cliente.movil"
                />
                <DatoFicha
                    etiqueta="NIT / CUI"
                    :valor="cliente.nit_cui"
                    mono
                />
                <DatoFicha
                    etiqueta="Zona"
                    :valor="nombreZona"
                />
                <DatoFicha
                    etiqueta="Dirección"
                    :valor="cliente.direccion"
                    class="col-span-2"
                />
                <DatoFicha
                    etiqueta="Alta"
                    :valor="formatearFecha(cliente.created_at)"
                />
            </dl>
        </section>

        <section
            v-if="verServicios"
            class="flex flex-col gap-2"
        >
            <h3 class="text-xs font-semibold tracking-[0.04em] text-muted uppercase">
                Servicios
            </h3>
            <ProblemaAlerta
                v-if="problema"
                :problema="problema"
                :reintentar="cargarServicios"
            />
            <div
                v-else-if="servicios === null"
                class="flex flex-col gap-2"
            >
                <USkeleton
                    v-for="i in 2"
                    :key="i"
                    class="h-12 w-full"
                />
            </div>
            <ul
                v-else-if="servicios.length"
                class="-mx-2 flex flex-col"
            >
                <ListaItem
                    v-for="servicio in servicios"
                    :key="servicio.id"
                    :titulo="etiquetaServicio(servicio)"
                    :subtitulo="servicio.ipv4 ?? 'Sin IPv4'"
                    icono="i-lucide-wifi"
                    :to="`/servicios/${servicio.id}`"
                >
                    <template #derecha>
                        <EstadoServicioBadge
                            :estado="servicio.estado"
                            size="sm"
                        />
                    </template>
                </ListaItem>
            </ul>
            <UEmpty
                v-else
                icon="i-lucide-wifi-off"
                title="Sin servicios"
                description="Este cliente todavía no tiene servicios."
                :actions="puede('servicios.crear') ? [{ label: 'Agregar servicio', icon: 'i-lucide-plus', to: `/clientes/${cliente.id}?tab=servicios&nuevo_servicio=1` }] : undefined"
                variant="naked"
                size="sm"
            />
        </section>

        <template #acciones>
            <UButton
                v-if="enlace(`/cobro?cliente=${cliente.id}`)"
                :to="`/cobro?cliente=${cliente.id}`"
                label="Cobrar"
                icon="i-lucide-hand-coins"
                color="neutral"
                variant="outline"
            />
            <UButton
                :to="`/clientes/${cliente.id}`"
                label="Abrir ficha"
                trailing-icon="i-lucide-arrow-right"
            />
        </template>
    </VistaRapida>
</template>
