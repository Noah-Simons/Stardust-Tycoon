// Optional cloud sync for Stardust Tycoon.
//
// This module is deliberately isolated: game.js knows nothing about Firebase
// and never imports it. Communication is one-way via DOM events that game.js
// dispatches ("stardust:dirty", "stardust:milestone").
//
// The game must remain fully playable when this file fails to load, when the
// player is signed out, and when the network is down. Every cloud path is
// null-guarded for that reason.
//
// Firebase is pulled in with dynamic import() rather than static imports: a
// static import that 404s or times out aborts the whole module before any of
// its body runs, so the fallback UI below would never execute and the button
// would sit enabled forever, doing nothing.
const CDN = "https://www.gstatic.com/firebasejs/12.17.0";

// Firebase web config is a public project identifier, not a credential. Access
// is controlled by Firestore security rules (uid-scoped) plus the authorized
// domains list — not by keeping this secret.
const firebaseConfig = {
  apiKey: "AIzaSyAOfnY7-01EdAmvMsgWoK29elQxtKpjo5c",
  authDomain: "stardust-tycoon.firebaseapp.com",
  projectId: "stardust-tycoon",
  storageBucket: "stardust-tycoon.firebasestorage.app",
  messagingSenderId: "1000465118064",
  appId: "1:1000465118064:web:5dfb22f5fd3b026860d5b5",
  measurementId: "G-NPNQLGHDSC",
};

// Fields mirrored to the cloud. Explicit whitelist so local-only or transient
// state never leaks into the save document.
const CLOUD_KEYS = [
  "version",
  "stardust",
  "totalMined",
  "clickCount",
  "owned",
  "prestige",
  "achieved",
];

// Firestore Spark free tier allows 20k writes/day. The 5s localStorage
// autosave would be 720 writes/player-hour and exhaust that in ~28
// player-hours, so cloud pushes are throttled far more aggressively.
const PUSH_MS = 60000;

// Firebase error code -> player-facing message. One table, three call sites.
const ERRORS = {
  "resource-exhausted": "Cloud quota reached — playing locally",
  "permission-denied": "Sync blocked — check security rules",
  "unavailable": "Offline — playing locally",
  "auth/popup-blocked": "Popup blocked — allow popups and retry",
  "auth/popup-closed-by-user": "Sign-in cancelled",
  "auth/unauthorized-domain": "This domain isn't authorized in Firebase",
  "auth/network-request-failed": "Network error — playing locally",
};

function fail(e, fallback) {
  // Include the raw code so an unmapped failure is diagnosable from the UI
  // instead of collapsing into a generic message.
  console.warn(fallback, e);
  const known = ERRORS[e?.code];
  setStatus(known || (e?.code ? `${fallback} (${e.code})` : fallback));
}

let auth = null;
let db = null;
let currentUser = null;
let lastPush = 0;
let dirty = false;
let pulling = false;

const btn = document.getElementById("cloudBtn");
const statusEl = document.getElementById("cloudStatus");

function setStatus(msg) {
  if (statusEl) statusEl.textContent = msg;
}

// Firebase SDK bindings, populated by boot(). Null until then, and forever if
// the CDN is unreachable.
let doc, getDoc, setDoc, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged;

try {
  const [app_, auth_, fs_, an_] = await Promise.all([
    import(`${CDN}/firebase-app.js`),
    import(`${CDN}/firebase-auth.js`),
    import(`${CDN}/firebase-firestore.js`),
    import(`${CDN}/firebase-analytics.js`),
  ]);

  ({ doc, getDoc, setDoc } = fs_);
  ({ GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged } = auth_);

  const app = app_.initializeApp(firebaseConfig);
  auth = auth_.getAuth(app);
  db = fs_.getFirestore(app);
  an_.getAnalytics(app);
} catch (e) {
  console.warn("Cloud sync unavailable:", e);
}

// ===== Save snapshot =====

function snapshot() {
  const out = {};
  for (const k of CLOUD_KEYS) {
    // Firestore rejects undefined. (state.version always exists now — see #6 —
    // but other fields may be absent on a corrupt/old save, so keep the guard.)
    if (state[k] !== undefined) out[k] = state[k];
  }
  out.updatedAt = Date.now();
  return out;
}

// ===== Pull (sign-in) =====

// Conflict rule: highest totalMined wins. totalMined is monotonic — it never
// decreases, not even through prestige — so it is a far better progress signal
// than a wall-clock timestamp. Last-write-wins would let an idle background
// tab clobber hours of play on another device.
async function pull(user) {
  if (!db) return;
  pulling = true;
  try {
    const ref = doc(db, "saves", user.uid);
    const snap = await getDoc(ref);

    if (!snap.exists()) {
      await setDoc(ref, snapshot());
      setStatus("Cloud save created");
      return;
    }

    const remote = snap.data();
    const localMined = Number(state.totalMined) || 0;
    const remoteMined = Number(remote.totalMined) || 0;

    if (remoteMined > localMined) {
      // Destructive: always confirm before replacing local progress.
      showModal(
        "Cloud save found with more progress (" +
          fmt(remoteMined) +
          " vs " +
          fmt(localMined) +
          " total mined). Load it? Your local progress will be replaced.",
        () => {
          for (const k of CLOUD_KEYS) {
            if (remote[k] !== undefined) state[k] = remote[k];
          }
          save();
          buildShop();
          render();
          setStatus("Cloud save loaded");
        }
      );
    } else {
      await setDoc(ref, snapshot());
      setStatus("Cloud save updated");
    }
  } finally {
    pulling = false;
  }
}

// ===== Push (throttled) =====

async function push(force = false) {
  if (!currentUser || !db || pulling) return;

  const now = Date.now();
  if (!force && now - lastPush < PUSH_MS) {
    dirty = true;
    return;
  }

  lastPush = now;
  dirty = false;

  try {
    await setDoc(doc(db, "saves", currentUser.uid), snapshot());
    setStatus("Synced " + new Date().toLocaleTimeString());
  } catch (e) {
    fail(e, "Sync failed — playing locally");
  }
}

// ===== Wiring =====

if (auth) {
  onAuthStateChanged(auth, (user) => {
    currentUser = user;
    if (user) {
      if (btn) btn.textContent = "Sign out";
      setStatus("Signed in as " + (user.displayName || "player"));
      pull(user).catch((e) => fail(e, "Sync unavailable — playing locally"));
    } else {
      if (btn) btn.textContent = "Sign in with Google";
      setStatus("Playing locally");
    }
  });

  btn?.addEventListener("click", async () => {
    if (currentUser) {
      await signOut(auth);
      return;
    }
    setStatus("Opening Google sign-in…");
    try {
      await signInWithPopup(auth, new GoogleAuthProvider());
    } catch (e) {
      fail(e, "Sign-in failed");
    }
  });

  // game.js announces state changes; it never calls Firebase directly.
  window.addEventListener("stardust:dirty", () => {
    dirty = true;
  });
  window.addEventListener("stardust:milestone", () => push(true));

  setInterval(() => {
    if (dirty) push();
  }, PUSH_MS);

  window.addEventListener("beforeunload", () => push(true));
} else {
  if (btn) btn.disabled = true;
  setStatus("Cloud sync unavailable");
}
