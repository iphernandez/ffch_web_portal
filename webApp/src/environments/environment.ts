/**
 * Firebase Web SDK config — safe to keep public (it's not a secret, access is controlled by
 * Firestore/Auth security rules, not by hiding this object). Replace with your project's values
 * from Firebase console → Project settings → General → Your apps → SDK setup and configuration.
 */
export const environment = {
  firebase: {
    apiKey: 'AIzaSyDdhx-ptdRMQnqCUq4b7D2xSiz52AFZKN8',
    authDomain: 'ffch-puntuacion.firebaseapp.com',
    projectId: 'ffch-puntuacion',
    storageBucket: 'ffch-puntuacion.firebasestorage.app',
    messagingSenderId: '550652817905',
    appId: '1:550652817905:web:8490e945b9f1535365d450'
  },
  // Continue URL Firebase redirects to after a password-reset email link; must match the deployed app.
  passwordResetContinueUrl: 'https://iphernandez.github.io/ffch_web_portal/#/restablecer-contrasena'
};
