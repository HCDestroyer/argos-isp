<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'

/**
 * Pestaña «Contactos» de la ficha (tablero NuevoClienteFicha; A1 #281): «A cargo de sus servicios»
 * (el titular primero, con sus números adicionales) y «Está a cargo de» (servicios de otros
 * clientes que esta persona tiene a cargo). Alta y baja con `contactos.gestionar`.
 */
const props = defineProps<{
    clienteId: number
    servicios: Servicio[] | null
}>()

const emit = defineEmits<{
    cambiados: [cantidad: number]
}>()

const { puede, enlace } = usePermisos()
const toast = useToast()
const contactosApi = useContactos()

const contactos = shallowRef<ContactoCliente[] | null>(null)
const problema = ref<Problem | null>(null)
const aCargo = shallowRef<ContactoCliente[] | null>(null)
const problemaACargo = ref<Problem | null>(null)
const agregando = ref(false)
const quitando = ref<number | null>(null)

const codigos = computed(() => new Map((props.servicios ?? []).map(s => [s.id, s.codigo ?? etiquetaServicio(s)])))

async function cargar() {
    contactos.value = null
    problema.value = null
    const resultado = await contactosApi.listar(props.clienteId)
    contactos.value = resultado.ok ? resultado.data.data : null
    problema.value = resultado.ok ? null : resultado.problema
    if (resultado.ok) {
        emit('cambiados', resultado.data.data.filter(c => !c.es_titular).length)
    }
}

async function cargarACargo() {
    aCargo.value = null
    problemaACargo.value = null
    const resultado = await contactosApi.aCargo(props.clienteId)
    aCargo.value = resultado.ok ? resultado.data.data : null
    problemaACargo.value = resultado.ok ? null : resultado.problema
    // Nombre de cada cliente del que está a cargo (la fila trae solo su id).
    for (const contacto of aCargo.value ?? []) {
        if (!nombres.value.has(contacto.cliente_id)) {
            void useClientes().ver(contacto.cliente_id).then((leido) => {
                if (leido.ok) {
                    nombres.value = new Map(nombres.value).set(leido.data.id, leido.data.nombre)
                }
            })
        }
    }
}

const nombres = shallowRef(new Map<number, string>())

function textoServicios(contacto: ContactoCliente): string {
    if (contacto.servicios === null) {
        return 'Todos sus servicios'
    }
    return contacto.servicios.map(id => codigos.value.get(id) ?? `Servicio #${id}`).join(', ')
}

function textoTelefonos(contacto: ContactoCliente): string {
    return contacto.telefonos.map(t => `${telefonoLegible(t.numero)}${t.whatsapp ? ' · WhatsApp' : ''}`).join(' · ')
}

async function quitar(contacto: ContactoCliente) {
    quitando.value = contacto.contacto_id
    const resultado = await contactosApi.quitar(contacto, nuevaClaveIdempotencia())
    quitando.value = null
    if (!resultado.ok) {
        toast.add({ title: 'No se pudo quitar el contacto', description: resultado.problema.detail ?? resultado.problema.title, color: 'error', icon: 'i-lucide-circle-alert' })
        return
    }
    toast.add({ title: 'Contacto quitado', description: contacto.nombre, color: 'success', icon: 'i-lucide-user-minus' })
    await cargar()
}

onMounted(() => {
    void cargar()
    void cargarACargo()
})
</script>

<template>
    <div
        class="flex flex-col gap-5"
        data-prueba="cliente-contactos"
    >
        <section
            class="flex flex-col gap-2"
            aria-labelledby="contactos-a-cargo-de-sus-servicios"
        >
            <div class="flex items-center justify-between gap-2">
                <h3
                    id="contactos-a-cargo-de-sus-servicios"
                    class="text-xs font-bold tracking-[0.06em] text-muted uppercase"
                >
                    A cargo de sus servicios
                </h3>
                <UButton
                    v-if="puede('contactos.gestionar')"
                    icon="i-lucide-plus"
                    label="Agregar contacto"
                    color="primary"
                    variant="link"
                    size="sm"
                    data-prueba="agregar-contacto"
                    @click="agregando = true"
                />
            </div>
            <ProblemaAlerta
                v-if="problema"
                :problema="problema"
                :reintentar="cargar"
            />
            <div
                v-else-if="!contactos"
                class="flex flex-col gap-2"
            >
                <USkeleton
                    v-for="i in 2"
                    :key="i"
                    class="h-14 w-full"
                />
            </div>
            <ul
                v-else
                class="flex flex-col divide-y divide-(--ax-borde) rounded-2xl ring ring-(--ax-borde)"
            >
                <li
                    v-for="contacto in contactos"
                    :key="contacto.contacto_id"
                    class="flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:gap-3"
                    :data-contacto="contacto.contacto_id"
                >
                    <div class="flex min-w-0 flex-1 items-center gap-3">
                        <AvatarIniciales :nombre="contacto.nombre" />
                        <div class="flex min-w-0 flex-col">
                            <span class="truncate font-semibold text-highlighted">{{ contacto.nombre }}</span>
                            <span class="truncate text-xs text-muted">
                                {{ ETIQUETAS_RELACION[contacto.relacion] }}<template v-if="contacto.telefonos.length"> · {{ textoTelefonos(contacto) }}</template><template v-if="contacto.es_titular && contacto.telefonos.length"> (adicionales)</template>
                            </span>
                            <span
                                v-if="!contacto.es_titular"
                                class="truncate text-xs text-dimmed"
                            >{{ textoServicios(contacto) }}<template v-if="contacto.origen === 'iris'"> · creado en Iris</template></span>
                        </div>
                    </div>
                    <div class="flex flex-wrap items-center gap-1.5">
                        <UBadge
                            v-for="permiso in PERMISOS_CONTACTO.filter(p => contacto.permisos[p.clave])"
                            :key="permiso.clave"
                            :label="permiso.etiqueta"
                            :title="permiso.detalle"
                            color="neutral"
                            variant="soft"
                            size="sm"
                            class="rounded-full"
                        />
                        <UButton
                            v-if="contacto.persona_cliente_id && enlace(`/clientes/${contacto.persona_cliente_id}`)"
                            :to="enlace(`/clientes/${contacto.persona_cliente_id}`)"
                            icon="i-lucide-user-round"
                            color="neutral"
                            variant="ghost"
                            size="sm"
                            title="Es otro cliente: abrir su ficha"
                            :aria-label="`Abrir la ficha de ${contacto.nombre}`"
                        />
                        <UButton
                            v-if="!contacto.es_titular && puede('contactos.gestionar')"
                            icon="i-lucide-user-minus"
                            color="error"
                            variant="ghost"
                            size="sm"
                            :loading="quitando === contacto.contacto_id"
                            title="Quitar contacto"
                            :aria-label="`Quitar a ${contacto.nombre}`"
                            @click="quitar(contacto)"
                        />
                    </div>
                </li>
            </ul>
        </section>

        <section
            class="flex flex-col gap-2"
            aria-labelledby="contactos-esta-a-cargo-de"
        >
            <h3
                id="contactos-esta-a-cargo-de"
                class="text-xs font-bold tracking-[0.06em] text-muted uppercase"
            >
                Está a cargo de
            </h3>
            <ProblemaAlerta
                v-if="problemaACargo"
                :problema="problemaACargo"
                :reintentar="cargarACargo"
            />
            <USkeleton
                v-else-if="!aCargo"
                class="h-14 w-full"
            />
            <ul
                v-else-if="aCargo.length"
                class="-mx-2 flex flex-col"
            >
                <ListaItem
                    v-for="contacto in aCargo"
                    :key="contacto.contacto_id"
                    :titulo="nombres.get(contacto.cliente_id) ?? `Cliente #${contacto.cliente_id}`"
                    :subtitulo="`${ETIQUETAS_RELACION[contacto.relacion]} · ${contacto.servicios === null ? 'todos sus servicios' : `${contacto.servicios.length} ${contacto.servicios.length === 1 ? 'servicio' : 'servicios'}`}`"
                    icono="i-lucide-users"
                    :to="enlace(`/clientes/${contacto.cliente_id}?tab=contactos`)"
                />
            </ul>
            <p
                v-else
                class="text-sm text-muted"
            >
                No está a cargo de servicios de otros clientes.
            </p>
        </section>

        <ContactoAgregarSlideover
            v-if="puede('contactos.gestionar')"
            v-model:open="agregando"
            :cliente-id="clienteId"
            @creado="cargar"
        />
    </div>
</template>
