<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { FormSubmitEvent, SelectItem } from '@nuxt/ui'

/**
 * Nuevo token de API (`POST /tokens`, `tokens.crear`) para un usuario: integraciones y agentes de
 * IA pasan por el mismo ACL que el usuario, recortado a los permisos y routers, zonas o cajas que
 * se elijan aquí. El valor llega una sola vez: el padre lo muestra con `ValorUnaVezModal`.
 */
const props = defineProps<{
    usuarios: readonly UsuarioPanel[]
    catalogo: readonly PermisoCatalogo[]
}>()

const abierto = defineModel<boolean>('open', { default: false })
const emit = defineEmits<{ creado: [creado: TokenApiCreado] }>()

const { puede } = usePermisos()
const formulario = useTemplateRef('formulario')
const estado = reactive<EntradaToken>(entradaTokenVacia())
const enviando = ref(false)
const problema = ref<Problem | null>(null)
const opciones = reactive<Record<'routers' | 'zonas' | 'cajas', SelectItem[] | null>>({ routers: null, zonas: null, cajas: null })

/** Las listas para acotar el alcance, cada una con su permiso; sin él no se ofrece ese alcance. */
async function cargarAlcances() {
    const [routers, zonas, cajas] = await Promise.all([
        puede('routers.ver') ? useRouters().listar() : null,
        puede('zonas.ver') ? useZonas().listar() : null,
        puede('cajas.ver') ? useCajas().listar() : null,
    ])
    opciones.routers = routers?.ok ? routers.data.data.map(r => ({ label: r.nombre, value: r.id })) : null
    opciones.zonas = zonas?.ok ? zonas.data.map(z => ({ label: z.nombre, value: z.id })) : null
    opciones.cajas = cajas?.ok ? cajas.data.map(c => ({ label: c.nombre, value: c.id })) : null
}

watch(abierto, (valor) => {
    if (valor) {
        Object.assign(estado, entradaTokenVacia())
        problema.value = null
        void cargarAlcances()
    }
}, { immediate: true })

const itemsUsuarios = computed<SelectItem[]>(() => props.usuarios.filter(u => u.activo).map(u => ({ label: u.nombre, description: `${u.email} · ${u.roles.map(r => r.rol).join(', ') || 'sin roles'}`, value: u.id })))
const usuario = computed(() => props.usuarios.find(u => u.id === estado.usuario_id) ?? null)

function numeros(valor: unknown): number[] {
    return Array.isArray(valor) ? valor.filter((n): n is number => typeof n === 'number') : []
}

async function enviar(evento: FormSubmitEvent<SalidaToken>) {
    enviando.value = true
    problema.value = null
    const resultado = await useTokensApi().crear(cuerpoToken(evento.data))
    enviando.value = false
    if (resultado.ok) {
        abierto.value = false
        emit('creado', resultado.data)
        return
    }
    const errores = erroresDeFormulario(resultado.problema).map(e => ({ ...e, name: e.name?.startsWith('alcances.') ? e.name.slice('alcances.'.length) : e.name }))
    if (errores.length) {
        formulario.value?.setErrors(errores)
    }
    problema.value = resultado.problema
}
</script>

<template>
    <USlideover
        v-model:open="abierto"
        title="Nuevo token de API"
        description="Para integraciones y agentes de IA. Actúa como el usuario elegido, con los recortes de abajo."
        :dismissible="!enviando"
        :ui="{ content: 'sm:max-w-3xl' }"
    >
        <template #body>
            <UForm
                id="form-token"
                ref="formulario"
                :schema="esquemaToken"
                :state="estado"
                class="flex flex-col gap-6"
                @submit="enviar"
            >
                <div class="grid gap-4 sm:grid-cols-2">
                    <UFormField
                        label="Usuario"
                        name="usuario_id"
                        help="El token nunca tiene más permisos que su usuario."
                        required
                    >
                        <USelectMenu
                            :model-value="estado.usuario_id ?? undefined"
                            :items="itemsUsuarios"
                            value-key="value"
                            placeholder="Elige el usuario"
                            class="w-full"
                            data-prueba="token-usuario"
                            @update:model-value="v => estado.usuario_id = typeof v === 'number' ? v : null"
                        />
                    </UFormField>
                    <UFormField
                        label="Nombre"
                        name="nombre"
                        help="Para reconocerlo después (ej. «Agente de cobranza»)."
                        required
                    >
                        <UInput
                            v-model="estado.nombre"
                            class="w-full"
                            data-prueba="token-nombre"
                        />
                    </UFormField>
                </div>

                <section class="flex flex-col gap-3">
                    <h3 class="text-sm font-medium text-highlighted">
                        Alcance
                    </h3>
                    <div class="grid gap-4 sm:grid-cols-3">
                        <UFormField
                            v-if="opciones.routers"
                            label="Solo estos routers"
                            name="routers"
                            help="Vacío = los del usuario."
                        >
                            <USelectMenu
                                :model-value="estado.routers"
                                :items="opciones.routers"
                                value-key="value"
                                multiple
                                placeholder="Todos"
                                class="w-full"
                                @update:model-value="v => estado.routers = numeros(v)"
                            />
                        </UFormField>
                        <UFormField
                            v-if="opciones.zonas"
                            label="Solo estas zonas"
                            name="zonas"
                            help="Vacío = las del usuario."
                        >
                            <USelectMenu
                                :model-value="estado.zonas"
                                :items="opciones.zonas"
                                value-key="value"
                                multiple
                                placeholder="Todas"
                                class="w-full"
                                @update:model-value="v => estado.zonas = numeros(v)"
                            />
                        </UFormField>
                        <UFormField
                            v-if="opciones.cajas"
                            label="Solo estas cajas"
                            name="cajas"
                            help="Vacío = las del usuario."
                        >
                            <USelectMenu
                                :model-value="estado.cajas"
                                :items="opciones.cajas"
                                value-key="value"
                                multiple
                                placeholder="Todas"
                                class="w-full"
                                @update:model-value="v => estado.cajas = numeros(v)"
                            />
                        </UFormField>
                    </div>
                    <p
                        v-if="!catalogo.length"
                        class="text-xs text-muted"
                    >
                        Para recortar los permisos hace falta leer el catálogo (permiso «roles.ver»).
                    </p>
                    <USwitch
                        v-if="catalogo.length"
                        v-model="estado.recortar"
                        label="Recortar los permisos"
                        :description="usuario ? `Sin recorte, el token puede todo lo que pueden los roles de ${usuario.nombre}.` : 'Sin recorte, el token puede todo lo que puede su usuario.'"
                        data-prueba="token-recortar"
                    />
                    <UFormField
                        v-if="estado.recortar && catalogo.length"
                        name="permisos"
                        label="Permisos del token"
                        help="Elegir uno que el usuario no tiene no se lo da: el ACL los cruza."
                    >
                        <PermisosSelector
                            v-model="estado.permisos"
                            :catalogo="catalogo"
                            prueba="token-permisos"
                        />
                    </UFormField>
                </section>

                <ProblemaAlerta
                    v-if="problema"
                    :problema="problema"
                    data-prueba="token-error"
                />
            </UForm>
        </template>

        <template #footer>
            <div class="flex w-full justify-end gap-2">
                <UButton
                    label="Cancelar"
                    color="neutral"
                    variant="ghost"
                    :disabled="enviando"
                    @click="abierto = false"
                />
                <UButton
                    type="submit"
                    form="form-token"
                    label="Crear token"
                    icon="i-lucide-key-round"
                    :loading="enviando"
                    data-prueba="token-crear"
                />
            </div>
        </template>
    </USlideover>
</template>
