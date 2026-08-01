/* ============================================================
   FIREBASE CONFIG
   ------------------------------------------------------------
   To enable Firestore as the data store:
   1. Create a project at https://console.firebase.google.com
   2. Create a Firestore database (test mode is fine to start)
   3. Project settings → General → "Your apps" → Web app → copy the config
   4. Paste the values below, replacing the placeholders
   5. Reload the app - it will detect a real config and switch
      from LocalStorage to Firestore automatically. No other
      code needs to change.

   Leave the placeholders as-is to keep using LocalStorage only
   (fully functional, just local to this browser).
   ============================================================ */

window.FLOWSPACE_FIREBASE_CONFIG = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID"
};
