import { initializeApp, getApps, getApp, FirebaseApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getDatabase } from 'firebase/database';
import { getStorage } from 'firebase/storage';
import { firebaseConfig } from '@/firebase/config';

let app: FirebaseApp;
if (!getApps().length) {
    try {
      app = initializeApp();
    } catch (e) {
      if (process.env.NODE_ENV === "production") {
        console.warn('Automatic initialization failed. Falling back to firebase config object.', e);
      }
      app = initializeApp(firebaseConfig);
    }
} else {
    app = getApp();
}

const auth = getAuth(app);
const db = getDatabase(app);
const storage = getStorage(app);

function getFirebase() {
    return { app, auth, db, storage };
}

export { app, auth, db, storage, getFirebase };
