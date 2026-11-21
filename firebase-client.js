import { initializeApp } from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js';
import {
    getAuth, onAuthStateChanged, signInWithEmailAndPassword,
    createUserWithEmailAndPassword, sendPasswordResetEmail, signOut, GoogleAuthProvider, signInWithPopup
} from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js';

// Firebase web configuration identifies the project. Access is enforced by Firebase Authentication and database rules.
const app = initializeApp({
    apiKey: 'AIzaSyCyyNonQnq2_Cl3YHCcxgMmx35fhI1JSjU',
    authDomain: 'pdf-editor-9932d.firebaseapp.com',
    databaseURL: 'https://pdf-editor-9932d-default-rtdb.europe-west1.firebasedatabase.app',
    projectId: 'pdf-editor-9932d',
    storageBucket: 'pdf-editor-9932d.firebasestorage.app',
    messagingSenderId: '20830395281',
    appId: '1:20830395281:web:402105b331a0c6679d5830'
});
const auth = getAuth(app);
export const databaseURL = app.options.databaseURL;
export const observeAccount = listener => onAuthStateChanged(auth, listener);
export const signIn = (email, password) => signInWithEmailAndPassword(auth, email, password);
export const registerAccount = (email, password) => createUserWithEmailAndPassword(auth, email, password);
export const resetPassword = email => sendPasswordResetEmail(auth, email);
export const logOut = () => signOut(auth);

export const signInWithGoogle = () => signInWithPopup(auth, new GoogleAuthProvider());
