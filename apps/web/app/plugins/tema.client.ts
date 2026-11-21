/**
 * Al arrancar el panel (también en el login, sin sesión) aplica la apariencia de la instalación.
 * Corre después de `api` (orden alfabético de los plugins): usa `$api`.
 */
export default defineNuxtPlugin(() => {
    void useTemaApariencia().cargar()
})
