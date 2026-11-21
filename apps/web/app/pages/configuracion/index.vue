<script setup lang="ts">
/**
 * Índice de la configuración: las secciones del grupo «Configuración» del menú, por categoría
 * (los subgrupos de `navegacion.ts`), con buscador. Cada tarjeta respeta el permiso de su página;
 * una categoría sin nada permitido no aparece.
 */
definePageMeta({ permiso: ['empresas.ver', 'fiscal.ver', 'fel.ver', 'empresa.ver', 'plantillas.ver', 'documentos.ver', 'cuentas_bancarias.ver', 'bancos.ver', 'campos_personalizados.editar', 'portal_corte.ver', 'nodos_portal.administrar', 'inventario.configurar', 'usuarios.ver', 'roles.ver', 'tokens.ver', 'notificaciones.ver', 'horus.ver', 'iris.ver', 'sistema.ver_salud', 'sistema.ver_registro', 'sistema.ver_almacenamiento', 'sistema.ver_crons', 'apariencia.ver'] })

useHead({ title: 'Configuración · ArgosIsp' })

const { puede } = usePermisos()
const busqueda = ref('')

function normalizar(texto: string): string {
    return texto.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}

const categorias = computed(() => {
    const grupo = GRUPOS_PANEL.find(g => g.id === 'configuracion')
    const termino = normalizar(busqueda.value.trim())
    return (grupo?.subgrupos ?? [])
        .map(subgrupo => ({
            ...subgrupo,
            secciones: subgrupo.secciones
                .filter(seccion => puede(seccion.permiso))
                .filter(seccion => !termino || normalizar(`${seccion.etiqueta} ${seccion.descripcion} ${subgrupo.etiqueta}`).includes(termino)),
        }))
        .filter(subgrupo => subgrupo.secciones.length > 0)
})
</script>

<template>
    <PanelPagina
        id="configuracion"
        titulo="Configuración"
        icono="i-lucide-settings"
    >
        <div class="flex flex-col gap-6">
            <UInput
                v-model="busqueda"
                icon="i-lucide-search"
                placeholder="Buscar en la configuración (correo, FEL, roles…)"
                aria-label="Buscar en la configuración"
                class="w-full sm:max-w-md"
                data-prueba="buscar-configuracion"
            />

            <section
                v-for="categoria in categorias"
                :key="categoria.id"
                class="flex flex-col gap-3"
                :aria-labelledby="`titulo-${categoria.id}`"
                :data-prueba="`categoria-${categoria.id}`"
            >
                <div class="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
                    <h2
                        :id="`titulo-${categoria.id}`"
                        class="text-xs font-bold tracking-[0.06em] text-highlighted uppercase"
                    >
                        {{ categoria.etiqueta }}
                    </h2>
                    <p
                        v-if="categoria.descripcion"
                        class="text-xs text-muted"
                    >
                        {{ categoria.descripcion }}
                    </p>
                </div>
                <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                    <TarjetaAcceso
                        v-for="seccion in categoria.secciones"
                        :key="seccion.id"
                        :titulo="seccion.etiqueta"
                        :descripcion="seccion.descripcion"
                        :icono="seccion.icono"
                        :to="seccion.ruta"
                    />
                </div>
            </section>

            <UEmpty
                v-if="!categorias.length"
                icon="i-lucide-search-x"
                title="Nada coincide con la búsqueda"
                description="Prueba con otra palabra: «correo», «FEL», «roles», «portal»…"
                :actions="[{ label: 'Borrar búsqueda', icon: 'i-lucide-x', color: 'neutral', variant: 'subtle', onClick: () => { busqueda = '' } }]"
                variant="naked"
            />
        </div>
    </PanelPagina>
</template>
