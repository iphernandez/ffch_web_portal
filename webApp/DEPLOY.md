# Publicar webApp en GitHub Pages (checklist)

Estos pasos son **únicos** (solo la primera vez). Después de esto, cada `push` a `main` que toque
`webApp/**` publica automáticamente vía GitHub Actions.

## 0. Crear el proyecto Firebase (cuentas de usuario y datos compartidos)

Las cuentas (login/roles) y los datos de la app (jugadores, registros semanales, TDP, configuración
de temporada) usan **Firebase Authentication + Firestore**, gratis (plan Spark, sin tarjeta de
crédito). Es necesario configurarlo antes de publicar:

1. Ve a [console.firebase.google.com](https://console.firebase.google.com) → **Add project** →
   dale un nombre (ej. `ffch-puntuacion`) → puedes desactivar Google Analytics, no hace falta.
2. En el menú lateral: **Security → Authentication** → pestaña **Sign-in method** →
   habilita el proveedor **Email/Password** → **Save**.
3. **Databases & Storage → Firestore → Create database** → modo **Production mode** → elige una
   ubicación cercana (ej. `us-central`) → **Create**.
4. En **Databases & Storage → Firestore → Rules**, pega el contenido de [`firestore.rules`](./firestore.rules) de este
   repo y presiona **Publish**.
5. En **Security → Authentication → Settings → Authorized domains**, agrega `iphernandez.github.io` (y
   `localhost` ya viene por defecto, útil para desarrollo local).
6. Registra una app web para obtener el `firebaseConfig`. Dos formas de llegar ahí (la UI de Firebase
   cambia de vez en cuando):
   - Desde el **Project Overview** (la página de inicio del proyecto), busca los íconos de plataforma
     (`</>` Web, Android, iOS) y haz clic en el ícono **`</>`**.
   - O desde el ícono de engrane (arriba a la izquierda) → **Project settings** → pestaña **General**
     → baja hasta la tarjeta **"Your apps"** (si no hay apps todavía, verás los mismos íconos de
     plataforma ahí).
   - Dale un apodo a la app (ej. `webApp`) → **Register app** → copia el objeto `firebaseConfig` que
     te muestra (no hace falta Firebase Hosting, puedes saltar ese paso).
7. Pega esos valores en [`src/environments/environment.ts`](./src/environments/environment.ts)
   (reemplaza los `REPLACE_ME`). Es seguro que este archivo sea público: la seguridad la dan las
   reglas de Firestore/Auth, no el secreto de esta config.
8. (Opcional pero recomendado) En **Security → Authentication → Templates → Password reset**, personaliza el
   correo de restablecimiento de contraseña al español si quieres.

Con esto, al abrir la app por primera vez se crea automáticamente la cuenta administradora inicial
(`i.patricio.hernandez@gmail.com`, contraseña temporal, debe cambiarla al iniciar sesión).

## 1. Activar GitHub Pages con origen "GitHub Actions"

1. Ve a **Settings → Pages** en el repositorio.
2. En **Build and deployment → Source**, selecciona **GitHub Actions** (no "Deploy from a branch").
3. Guarda. No hace falta crear ninguna rama `gh-pages` manualmente.

## 2. Primer despliegue

- Con el origen configurado, simplemente haz `push` a `main` (o dispara manualmente el workflow
  `Deploy webApp to GitHub Pages` desde la pestaña **Actions → Run workflow**).
- El workflow [`../.github/workflows/deploy-webapp.yml`](../.github/workflows/deploy-webapp.yml) compila
  `webApp` con `--base-href=/ffch_web_portal/` y publica `dist/webApp/browser`.
- Al terminar, la app queda disponible en:

  ```
  https://iphernandez.github.io/ffch_web_portal/
  ```

## 3. Verificación

1. Abre `https://iphernandez.github.io/ffch_web_portal/` y confirma que el Dashboard carga.
2. Navega a otra pantalla (ej. `#/roster`) y **refresca la página** — debe seguir funcionando gracias al
   ruteo por hash (`withHashLocation()`), sin dar 404.
3. Inicia sesión como administrador y en **Ajustes** prueba "⬇ Sincronizar desde Firestore" y luego
   "⬆ Guardar cambios en Firestore" para confirmar el flujo de lectura/escritura contra el documento
   `data/ffch-puntuacion`.
