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

### 0.1 (Opcional) Correos de confirmación de inscripción a eventos

La app no tiene servidor, así que no puede enviar correos por sí misma. Al inscribirse a un evento escribe un
documento en la colección `mail` de Firestore, y la Cloud Function `sendQueuedMail`
([`../functions/index.js`](../functions/index.js)) lo envía por SMTP con `nodemailer` y anota el resultado en el
campo `delivery` del documento (`SUCCESS` / `ERROR`). Sin la función desplegada, los documentos simplemente se
acumulan en `mail` sin enviarse (no rompe nada).

> No usamos la extensión "Trigger Email from Firestore" porque Firebase Extensions se retira el 31 de marzo de
> 2027. La función propia usa Cloud Functions 2nd gen y vive en este repo.

Una sola vez:

1. El proyecto debe estar en el plan **Blaze** (Cloud Functions lo requiere). El uso de la liga entra en la cuota
   gratuita; crea una alerta de presupuesto en Google Cloud Console → **Billing → Budgets & alerts** (ej. $5).
2. Crea una **App password** de Gmail para la cuenta que enviará los correos (requiere verificación en 2 pasos):
   [myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords). Guárdala, se usa en el paso 5.
3. Instala Node.js 20+ y la Firebase CLI, e inicia sesión (desde la raíz del repo):

   ```bash
   npm install -g firebase-tools
   firebase login
   firebase use ffch-puntuacion        # ya está en .firebaserc
   ```

4. Instala las dependencias de la función:

   ```bash
   cd functions && npm install && cd ..
   ```

5. Guarda la App password como secreto (Secret Manager; nunca va en el código):

   ```bash
   firebase functions:secrets:set SMTP_PASSWORD     # pega la App password cuando lo pida
   ```

6. Despliega la función y las reglas:

   ```bash
   firebase deploy --only functions,firestore:rules
   ```

   La primera vez la CLI pregunta los parámetros y los guarda en `functions/.env.ffch-puntuacion`:
   - `SMTP_USER`: el correo de Gmail (ej. `ffch@gmail.com`)
   - `MAIL_FROM`: el remitente que verán los usuarios (ej. `F.F.C.H. <ffch@gmail.com>`)
   - `SMTP_HOST` / `SMTP_PORT`: deja los valores por defecto (`smtp.gmail.com` / `465`) para Gmail.

   Si aparece un aviso para habilitar APIs (Cloud Functions, Cloud Build, Eventarc, Artifact Registry, Secret
   Manager), acepta. Si pregunta por la política de limpieza de imágenes, acepta (o ejecuta
   `firebase functions:artifacts:setpolicy`) para no acumular costos de almacenamiento.

7. Prueba: inscríbete a un evento habilitado y revisa tu correo. En Firestore → `mail` el documento debe
   tener `delivery.state = SUCCESS`; si dice `ERROR`, el campo `delivery.error` y `firebase functions:log`
   muestran la causa (lo más común: App password incorrecta).

Mantenimiento:

- Cambiar la App password: repite el paso 5 y vuelve a desplegar (`firebase deploy --only functions`).
- Cambiar remitente/usuario: edita `functions/.env.ffch-puntuacion` y vuelve a desplegar.
- Desactivar los correos: pon `mailCollection: null` en
  [`src/environments/environment.ts`](./src/environments/environment.ts) (la app deja de escribir en `mail`).
- La función no se despliega con GitHub Actions; solo con `firebase deploy` cuando cambie `functions/`.
- [`../functions/.npmrc`](../functions/.npmrc) fuerza el registro público de npm: si el `~/.npmrc` apunta a un
  registro interno (corporativo), el `package-lock.json` quedaría con URLs que Cloud Build no puede alcanzar y el
  build falla con `npm error Exit handler never called!`.
- Si un deploy falla en el build, la función queda en estado `FAILED` y el siguiente deploy dice "Changing from an
  HTTPS function to a background triggered function is not allowed". Bórrala y vuelve a desplegar:
  `firebase functions:delete sendQueuedMail --region us-west1 --force`.

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
