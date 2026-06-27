# Trastero

Editor de tablaturas y repositorio de canciones (React + Tone.js), con sincronización en la nube vía Supabase y despliegue en GitHub Pages.

- App: https://rikicb9.github.io/Trastero/
- Repo: https://github.com/Rikicb9/Trastero

## Arquitectura

- **Frontend**: Vite + React. El componente vive en `src/Trastero.jsx`.
- **Persistencia local**: `localStorage` (copia de trabajo, funciona offline).
- **Nube**: Supabase Postgres, un documento JSONB por usuario en la tabla `trastero_state`.
- **Auth**: Supabase magic link (sin contraseñas).
- **Sync**: al entrar se hace *pull + merge + push*; después, cada cambio se sube
  con un *debounce* de 0,8 s. La fusión es por id de canción (gana `updatedAt` más reciente).

## Puesta en marcha

### 1. Supabase (una sola vez)
1. En tu proyecto (`zahmumipbltfckexdddn`), abre **SQL Editor** y ejecuta `supabase/schema.sql`.
2. **Authentication → Providers → Email**: activa *Email* (magic link).
3. **Authentication → URL Configuration**:
   - *Site URL*: `https://rikicb9.github.io/Trastero/`
   - *Redirect URLs*: añade `https://rikicb9.github.io/Trastero/`
   - (para desarrollo local añade también `http://localhost:5173/Trastero/`)

### 2. Subir el código a GitHub
```bash
cd trastero-app
git init
git add .
git commit -m "Trastero: app inicial con sync Supabase"
git branch -M main
git remote add origin https://github.com/Rikicb9/Trastero.git
git push -u origin main
```

### 3. Activar Pages
En el repo: **Settings → Pages → Build and deployment → Source = GitHub Actions**.
El primer push dispara el workflow `.github/workflows/deploy.yml`. Cuando termine,
la app estará en `https://rikicb9.github.io/Trastero/`.

## Desarrollo local
```bash
npm install
npm run dev        # http://localhost:5173/Trastero/
npm run build      # genera dist/
npm run preview    # sirve dist/
```

## Migrar tus canciones actuales
1. En la app antigua (el artifact), **Exportar copia → Copiar todo**.
2. En la app nueva (ya con sesión iniciada), **Importar copia** y pega el JSON.
   Se fusiona y se sube a la nube; a partir de ahí, móvil y ordenador van sincronizados.

## Limitaciones conocidas
- La **barra de comandos en lenguaje natural** que llama a la API de Anthropic **no
  funciona** en el despliegue público (requiere clave y un proxy; no se debe exponer
  la clave en el front). La transposición rápida local (subir/bajar trastes/semitonos)
  sí funciona porque es 100 % local.
- Sync a nivel de documento completo: si editas **a la vez** en dos dispositivos sin
  recargar, gana la última escritura. Para uso secuencial normal no hay problema.
