/* ============================================================
   SkyBridge Travels — firebase-config.js
   Firebase project configuration + SDK initialization.
   Loaded on every page, BEFORE main.js, right after the Firebase
   SDK <script> tags. See README.md → "Firebase backend" for full
   setup instructions (enabling the Realtime Database, enabling
   Email/Password sign-in, creating the admin user, and applying
   database.rules.json).
   ============================================================ */

// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyALazN87V8tWuBEa4v2sr09ZMrjQmTP4XI",
  authDomain: "skybridge-travels-database.firebaseapp.com",
  databaseURL: "https://skybridge-travels-database-default-rtdb.firebaseio.com",
  projectId: "skybridge-travels-database",
  storageBucket: "skybridge-travels-database.firebasestorage.app",
  messagingSenderId: "190130877689",
  appId: "1:190130877689:web:7b1fed715323c394e19e28",
  measurementId: "G-QBYWJ4N9N8"
};

// The email address of the one admin account, created in
// Firebase Console → Authentication → Users (Email/Password provider).
// The login page only asks for a password; it signs in with this
// fixed email behind the scenes. Change it here if you create the
// Firebase user under a different address.
window.ADMIN_EMAIL = 'admin@skybridgetravelsgh.com';

// Attached to `window` explicitly (not just `let`/`const`) so every other
// script on the page — regardless of load order quirks — can reliably
// reach these via `window.wwFirebaseDB` / `window.wwFirebaseAuth`.
window.wwFirebaseDB = null;
window.wwFirebaseAuth = null;

try {
    if (typeof firebase !== 'undefined') {
        firebase.initializeApp(firebaseConfig);
        window.wwFirebaseDB = firebase.database();
        window.wwFirebaseAuth = firebase.auth();
        // Keep the admin signed in across page loads/tabs until they log out.
        window.wwFirebaseAuth.setPersistence(firebase.auth.Auth.Persistence.LOCAL).catch(() => {});
    } else {
        console.warn('Firebase SDK did not load — the site will fall back to this browser\'s local storage only. Check your internet connection or ad/script blockers.');
    }
} catch (err) {
    console.error('Firebase failed to initialize:', err);
}
