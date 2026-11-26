<script setup lang="ts">
/**
 * Ajustes (respuestas del PM del 26 nov 2026; tablero AjustesMovil): la página de tarjetas. Arriba,
 * el título y el buscador; debajo, una tarjeta por grupo con sus ajustes (en el teléfono, el nombre
 * del grupo y sus filas). Solo aparece lo que el usuario puede abrir y un grupo sin nada permitido no
 * se muestra. Dentro de cada ajuste sigue la lista de grupos a la izquierda (`ConfiguracionMarco`).
 *
 * El permiso es la unión del catálogo (`PERMISOS_AJUSTES`), escrito literal porque `aclPantallas` y
 * `verificar-permisos` leen el texto; `ajustesCatalogo.test.ts` vigila que sigan iguales.
 */
definePageMeta({ permiso: ['empresas.ver', 'fiscal.ver', 'fel.ver', 'empresa.ver', 'plantillas.ver', 'documentos.ver', 'ajustes_cobro.ver', 'cuentas_bancarias.ver', 'bancos.ver', 'campos_personalizados.editar', 'nodos_portal.administrar', 'portal_corte.ver', 'inventario.configurar', 'notificaciones.ver', 'horus.ver', 'iris.ver', 'smartolt.ver', 'acs.ver', 'usuarios.ver', 'roles.ver', 'tokens.ver', 'apariencia.ver', 'reportes.ver', 'sistema.ver_salud', 'sistema.ver_registro', 'sistema.ver_almacenamiento', 'sistema.ver_crons'] })

useHead({ title: 'Ajustes · ArgosIsp' })
</script>

<template>
    <PanelPagina
        id="configuracion"
        titulo="Ajustes"
        encabezado-propio
        sin-migas
    >
        <div
            class="flex min-w-0 flex-col gap-1"
            data-prueba="encabezado-pagina"
        >
            <div class="flex items-center gap-1">
                <h1 class="text-[1.625rem] font-bold tracking-[-0.02em] text-highlighted sm:text-[1.75rem]">
                    Ajustes
                </h1>
                <AyudaBoton
                    solo-icono
                    class="max-lg:hidden"
                />
            </div>
            <p class="hidden max-w-3xl text-sm text-muted lg:block">
                Lo que se ajusta una vez y casi no se toca, por grupo.
            </p>
        </div>
        <AjustesNavegacion variante="indice" />
    </PanelPagina>
</template>
