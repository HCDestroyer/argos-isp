/**
 * Apariencia del portal elegida por el admin (`utils/apariencia.ts`): la lee `plugins/apariencia.ts`
 * en el servidor y viaja en el payload; sin ella, lo de fábrica (índigo).
 */
export function useApariencia() {
    return useState<Apariencia>('portal:apariencia', () => APARIENCIA_DE_FABRICA)
}
