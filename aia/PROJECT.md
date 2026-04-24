# phone-directory — PROJECT.md

## Visión general
Aplicación de escritorio Electron para gestionar el directorio telefónico de un hospital. Permite al personal buscar, filtrar, crear y editar contactos con soporte para múltiples teléfonos, emails, tipos de registro y áreas. UI completamente en español. Persistencia local en JSON (sin base de datos).

## Stack tecnológico
| Capa | Tecnología |
|------|-----------|
| Desktop runtime | Electron 32.1.0 |
| Frontend | React 18.3.1 + React Router 6.26.2 (hash) |
| Estado | Zustand 4.5.5 |
| Estilos | Tailwind CSS 3.4.13 (paleta SCS personalizada) |
| Validación | Zod 3.23.8 |
| Búsqueda | Fuse.js 7.0.0 |
| CSV | PapaParse 5.5.3 |
| Build | Vite 5.4.8 + TypeScript 5.6.2 |
| Tests | Vitest 2.1.1 + @testing-library/react + jsdom |
| Issues | Linear |

## Arquitectura

### Procesos Electron
```
Main Process (Node.js)
├── src/main/index.ts                  ← Bootstrap, ventana, registro IPC
├── src/main/services/
│   ├── app-data.service.ts            ← CRUD, backups, recuperación de datos
│   └── csv-import.service.ts         ← Validación y normalización de CSV
└── src/main/ipc/
    ├── contacts.ipc.ts                ← 10 canales IPC para contactos
    └── settings.ipc.ts               ← Persistencia de ajustes

Preload Bridge
└── src/preload/index.cts              ← window.hospitalDirectory API (context isolation)

Renderer Process (React)
├── src/renderer/main.tsx              ← Punto de entrada React
├── src/renderer/app/App.tsx           ← Bootstrap, recovery, routing
├── src/renderer/app/router.tsx        ← Hash router (5 páginas + 404)
├── src/renderer/pages/                ← DirectoryPage, ContactFormPage, ImportExportPage, SettingsPage, NotFoundPage
├── src/renderer/components/           ← feedback/, inputs/, layout/
├── src/renderer/store/useAppStore.ts  ← Store Zustand global
└── src/renderer/services/search.service.ts ← Fuse.js + filtros

Capa compartida
└── src/shared/
    ├── types/contact.ts               ← Tipos del dominio
    ├── schemas/contact.ts             ← Schemas Zod (fuente de verdad)
    ├── constants/catalogs.ts          ← Enums RecordType y AreaType
    └── utils/contacts.ts             ← Utilidades (privacidad, detección de primarios)
```

### Flujo de datos
1. Electron main lanza `AppDataService`, registra IPC handlers
2. Renderer llama `window.hospitalDirectory.getBootstrapData()`
3. Main carga `contacts.json` y `settings.json` desde el directorio de usuario de Electron
4. Renderer hidrata el store Zustand con el dataset y settings
5. Búsqueda/filtrado en cliente mediante `search.service` (Fuse.js)
6. CRUD → IPC invoke → AppDataService → JSON + backup automático
7. Si `contacts.json` está corrupto → flujo de recuperación activado en App.tsx

### Persistencia
- JSON local en `app.getPath('userData')` (sin base de datos externa)
- Backup automático antes de cada importación
- Modo recuperación ante fichero corrupto (restore desde backup)
- Audit trail en cada registro: `createdAt`, `updatedAt`, `createdBy`, `updatedBy`

## Archivos clave
| Archivo | Rol |
|---------|-----|
| `src/main/index.ts` | Bootstrap Electron, ventana, IPC |
| `src/preload/index.cts` | Bridge context-isolation → API pública renderer |
| `src/main/services/app-data.service.ts` | CRUD + backups + recuperación |
| `src/main/services/csv-import.service.ts` | Validación y preview CSV |
| `src/renderer/app/App.tsx` | Bootstrap y recovery del renderer |
| `src/renderer/app/router.tsx` | Rutas hash (5 páginas + 404) |
| `src/renderer/store/useAppStore.ts` | Estado global Zustand |
| `src/renderer/services/search.service.ts` | Búsqueda Fuse.js + filtros |
| `src/shared/schemas/contact.ts` | Schemas Zod (fuente de verdad de tipos) |
| `src/shared/types/contact.ts` | Tipos TypeScript del dominio |
| `docs/MVP_PLAN.md` | Hoja de ruta y fases del MVP |
| `docs/DECISIONS.md` | Log de decisiones arquitectónicas |

## Convenciones
- **Naming:** Componentes PascalCase `.tsx`, servicios `*.service.ts`, IPC `*.ipc.ts`
- **Tipos:** Siempre derivados de schemas Zod con `z.infer<>` — nunca tipos manuales paralelos
- **IPC:** Solo `ipcRenderer.invoke` (sin eventos push del main al renderer)
- **Estado:** Zustand únicamente (sin Redux, sin Context API para estado global)
- **Estilos:** Clases Tailwind exclusivamente (sin CSS Modules, sin styled-components)
- **Tests:** Co-ubicados con el módulo (`.test.tsx` / `.test.ts`)
- **Ramas:** `feat/oir-XX-descripcion` → PR a `develop`. Nunca merge directo a `main` o `develop`
- **Issues:** Linear — cada issue tiene su propia rama independiente
- **tsconfig:** `tsconfig.app.json` excluye tests explícitamente para no romper el build

## Testing
```bash
npm run test          # 141 tests (~860ms)
npm run typecheck     # tsc noEmit sobre app + electron tsconfig
npm run build         # build:renderer → build:electron
npm run ci            # Gate completo: typecheck → test → build
```
- Entorno: jsdom + @testing-library/react
- `tsconfig.vitest.json` extiende app config e incluye todos los tests
- Todos los tests de renderer necesitan mock de `window.hospitalDirectory`
- `tsconfig.app.json` debe excluir tests para evitar TS2339 en build de producción

## Flujo de trabajo Git
```
feat/oir-XX-descripcion
        ↓ PR (target: develop)
     develop   ← merge manual solo por el usuario
      main     ← merge manual solo por el usuario
```
Los agentes NUNCA hacen merge de PRs ni operan directamente sobre `develop` o `main`.
