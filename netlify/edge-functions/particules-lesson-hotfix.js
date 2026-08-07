const PRELUDE = String.raw`
(() => {
  const SHARED_KEY = "pongdang_student_v1";
  const LEGACY_KEY = "coreen_particules_eleve";
  const SESSION_KEY = "pongdang_particules_session_start";

  const parse = (value) => {
    try { return JSON.parse(value || "null"); } catch (_) { return null; }
  };
  const makeId = () => {
    if (globalThis.crypto && typeof globalThis.crypto.randomUUID === "function") return globalThis.crypto.randomUUID();
    return "student_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 10);
  };

  try {
    let shared = parse(localStorage.getItem(SHARED_KEY));
    const legacy = parse(localStorage.getItem(LEGACY_KEY));
    let student = shared || legacy;
    if (student && student.nom && student.email) {
      if (!student.studentId) student.studentId = makeId();
      shared = { studentId: student.studentId, nom: student.nom, email: student.email };
      localStorage.setItem(SHARED_KEY, JSON.stringify(shared));
      localStorage.setItem(LEGACY_KEY, JSON.stringify(shared));

      const sid = shared.studentId;
      const scopedStats = localStorage.getItem("coreen_stats_" + sid);
      const legacyStats = localStorage.getItem("coreen_stats");
      if (scopedStats) localStorage.setItem("coreen_stats", scopedStats);
      else if (legacyStats) localStorage.setItem("coreen_stats_" + sid, legacyStats);

      for (let n = 1; n <= 4; n++) {
        const scopedKey = "coreen_particules_meilleur_" + sid + "_" + n;
        const legacyScoreKey = "coreen_particules_meilleur_" + n;
        const scoped = localStorage.getItem(scopedKey);
        const old = localStorage.getItem(legacyScoreKey);
        if (scoped !== null) localStorage.setItem(legacyScoreKey, scoped);
        else if (old !== null) localStorage.setItem(scopedKey, old);
      }
    }
    sessionStorage.setItem(SESSION_KEY, new Date().toISOString());
  } catch (_) {}

  const originalFetch = globalThis.fetch.bind(globalThis);
  globalThis.fetch = async (input, init = {}) => {
    const url = typeof input === "string" ? input : (input && input.url) || "";
    if (url.includes("/.netlify/functions/send-results") && init && init.body) {
      try {
        const payload = JSON.parse(init.body);
        const aid = String(payload.assignmentId || "").toLowerCase();
        if (aid === "particules_sujet_objet" || aid === "particules-sujet-objet") {
          payload.startTime = sessionStorage.getItem(SESSION_KEY) || payload.startTime || new Date().toISOString();
          if (payload.trigger !== "session_complete") {
            return new Response(JSON.stringify({ ok: true, suppressed: true }), {
              status: 200,
              headers: { "content-type": "application/json; charset=utf-8" }
            });
          }
          init = { ...init, body: JSON.stringify(payload) };
          input = "/.netlify/functions/send-results-particules";
        }
      } catch (_) {}
    }
    return originalFetch(input, init);
  };

  try {
    const originalBeacon = navigator.sendBeacon && navigator.sendBeacon.bind(navigator);
    if (originalBeacon) {
      navigator.sendBeacon = (url, data) => {
        if (String(url).includes("/.netlify/functions/send-results")) return true;
        return originalBeacon(url, data);
      };
    }
  } catch (_) {}
})();
`;

const POSTLUDE = String.raw`
(() => {
  const SHARED_KEY = "pongdang_student_v1";
  const LEGACY_KEY = "coreen_particules_eleve";
  const SESSION_KEY = "pongdang_particules_session_start";

  const parse = (value) => {
    try { return JSON.parse(value || "null"); } catch (_) { return null; }
  };
  const makeId = () => {
    if (globalThis.crypto && typeof globalThis.crypto.randomUUID === "function") return globalThis.crypto.randomUUID();
    return "student_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 10);
  };
  const getStudent = () => {
    const shared = parse(localStorage.getItem(SHARED_KEY));
    const legacy = parse(localStorage.getItem(LEGACY_KEY));
    const raw = shared || legacy;
    if (!raw || !raw.nom || !raw.email) return null;
    const student = { studentId: raw.studentId || makeId(), nom: raw.nom, email: raw.email };
    try {
      localStorage.setItem(SHARED_KEY, JSON.stringify(student));
      localStorage.setItem(LEGACY_KEY, JSON.stringify(student));
    } catch (_) {}
    return student;
  };

  const syncProgress = () => {
    const student = getStudent();
    if (!student) return;
    const sid = student.studentId;
    try {
      const stats = localStorage.getItem("coreen_stats");
      if (stats) localStorage.setItem("coreen_stats_" + sid, stats);

      const active = document.querySelectorAll("#onglets button");
      let level = 1;
      active.forEach((button, index) => { if (button.classList.contains("actif")) level = index + 1; });
      const match = (document.getElementById("score")?.textContent || "").match(/(\d+)\s*\/\s*(\d+)/);
      if (match) {
        const score = Number(match[1]);
        const legacyKey = "coreen_particules_meilleur_" + level;
        const scopedKey = "coreen_particules_meilleur_" + sid + "_" + level;
        const old = Number(localStorage.getItem(scopedKey) ?? localStorage.getItem(legacyKey) ?? -1);
        const best = Math.max(old, score);
        localStorage.setItem(scopedKey, String(best));
        localStorage.setItem(legacyKey, String(best));
        const bestEl = document.getElementById("meilleur");
        if (bestEl) bestEl.textContent = "🏆 Meilleur score : " + best + "/" + match[2];
      }
    } catch (_) {}
  };

  const clearForAnotherStudent = () => {
    syncProgress();
    try {
      localStorage.removeItem(SHARED_KEY);
      localStorage.removeItem(LEGACY_KEY);
      localStorage.removeItem("coreen_stats");
      for (let n = 1; n <= 4; n++) localStorage.removeItem("coreen_particules_meilleur_" + n);
      for (let i = sessionStorage.length - 1; i >= 0; i--) {
        const key = sessionStorage.key(i);
        if (key && (key.startsWith("coreen_warmup_fait_") || key === SESSION_KEY)) sessionStorage.removeItem(key);
      }
    } catch (_) {}
    location.reload();
  };

  const hello = document.getElementById("bonjour-eleve");
  if (hello && !document.getElementById("btn-pongdang-change-student")) {
    const wrap = document.createElement("div");
    wrap.style.cssText = "display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin:4px 0 6px";
    hello.parentNode.insertBefore(wrap, hello);
    wrap.appendChild(hello);
    const change = document.createElement("button");
    change.id = "btn-pongdang-change-student";
    change.type = "button";
    change.textContent = "Ce n'est pas toi ? Changer d'élève";
    change.style.cssText = "border:0;background:transparent;color:#2563eb;text-decoration:underline;cursor:pointer;padding:4px 0;font:inherit;font-size:.85rem";
    change.addEventListener("click", clearForAnotherStudent);
    wrap.appendChild(change);
  }

  const welcome = document.querySelector("#accueil-eleve .carte > p");
  if (welcome && !document.getElementById("pongdang-memory-note")) {
    welcome.textContent = "Dis-nous qui tu es : tes résultats pourront t'être envoyés par email.";
    const note = document.createElement("p");
    note.id = "pongdang-memory-note";
    note.className = "niveau-info";
    note.style.marginBottom = "12px";
    note.textContent = "Cet appareil te reconnaîtra automatiquement la prochaine fois. Tu pourras changer d'élève à tout moment.";
    welcome.insertAdjacentElement("afterend", note);
  }

  const accueilButton = document.getElementById("btn-accueil");
  if (accueilButton) {
    accueilButton.addEventListener("click", () => setTimeout(() => {
      getStudent();
      syncProgress();
    }, 0));
  }

  const title = document.querySelector("header h1");
  if (title && title.textContent.includes("structure basique")) title.textContent = "La structure de base : le coréen vs le français";
  const orderTitle = document.querySelector("#ordre h2");
  if (orderTitle) orderTitle.textContent = "1️⃣ L'ordre des mots : le prédicat généralement à la fin";
  const attention = document.querySelector("#ordre .attention");
  if (attention) attention.innerHTML = '<strong>🚨 À retenir</strong>En coréen, <strong>le prédicat (verbe ou adjectif) se place généralement à la fin de la phrase</strong>. Pour commencer, retiens le schéma simple : noms + particules, puis prédicat.';
  const astuce = document.querySelector("#ordre .astuce");
  if (astuce) astuce.innerHTML = '<strong>💡 Les particules</strong>Les noms <strong>peuvent être suivis</strong> de petites particules qui indiquent leur rôle dans la phrase : sujet, objet, lieu, temps… Grâce à elles, le rôle des mots reste souvent clair <strong>même lorsque l’ordre varie</strong>.';
  document.querySelectorAll("#iga .phrase").forEach((el) => {
    if (el.textContent.includes("Je suis Paul.")) {
      el.innerHTML = '누가 폴이에요? — 제<span class="particule">가</span><span class="role">Sujet</span> 폴이에요. — <em>Qui est Paul ? — C’est moi.</em> (Ici, 제가 met l’accent sur « moi ».)';
    }
  });

  const reminder = document.getElementById("rappel-regle");
  const softenReminder = () => {
    if (!reminder) return;
    reminder.innerHTML = reminder.innerHTML
      .replace("Le verbe est toujours à la fin !", "Le verbe vient à la fin dans ces phrases d’entraînement.")
      .replace("Le verbe est toujours à la fin", "Le verbe vient à la fin dans ces phrases d’entraînement");
  };
  softenReminder();
  if (reminder) new MutationObserver(softenReminder).observe(reminder, { childList: true, subtree: true, characterData: true });

  document.addEventListener("click", (event) => {
    const verify = event.target.closest && event.target.closest("#btn-verifier");
    if (verify) {
      if (verify.dataset.pongdangLocked === "1") {
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }
      verify.dataset.pongdangLocked = "1";
      setTimeout(() => {
        verify.disabled = true;
        syncProgress();
      }, 0);
      return;
    }
    const reset = event.target.closest && event.target.closest("#btn-memes, #btn-nouvelles, #btn-vocab, #btn-suivant, #onglets button");
    if (reset) {
      const verifyButton = document.getElementById("btn-verifier");
      if (verifyButton) delete verifyButton.dataset.pongdangLocked;
    }
  }, true);

  const actions = document.getElementById("actions-exo");
  if (actions && !document.getElementById("btn-pongdang-finish")) {
    const finish = document.createElement("button");
    finish.id = "btn-pongdang-finish";
    finish.type = "button";
    finish.textContent = "📨 Terminer ma session et envoyer le bilan";
    actions.appendChild(finish);
    finish.addEventListener("click", async () => {
      if (finish.disabled) return;
      const student = getStudent();
      if (!student || typeof globalThis.construirePayload !== "function") return;
      syncProgress();
      finish.disabled = true;
      const originalText = finish.textContent;
      finish.textContent = "⏳ Envoi du bilan…";
      try {
        const payload = globalThis.construirePayload("session_complete");
        payload.trigger = "session_complete";
        payload.studentId = student.studentId;
        payload.startTime = sessionStorage.getItem(SESSION_KEY) || payload.startTime || new Date().toISOString();
        payload.endTime = new Date().toISOString();
        payload.submissionId = student.studentId + "_" + Date.now().toString(36);
        const response = await fetch("/.netlify/functions/send-results", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });
        if (!response.ok) throw new Error("HTTP " + response.status);
        finish.textContent = "✅ Bilan envoyé !";
        const msg = document.getElementById("resultat-message");
        if (msg) msg.textContent = "Ton bilan a bien été envoyé. Tu peux continuer à t’entraîner si tu veux.";
      } catch (_) {
        finish.disabled = false;
        finish.textContent = originalText;
        const msg = document.getElementById("resultat-message");
        if (msg) msg.textContent = "L’envoi n’a pas fonctionné. Tes progrès restent enregistrés sur cet appareil : réessaie dans un instant.";
      }
    });
  }
})();
`;

function escapeScript(value) {
  return value.replace(/<\/script/gi, "<\\/script");
}

export default async (request, context) => {
  const response = await context.next();
  const type = response.headers.get("content-type") || "";
  if (!type.includes("text/html") || !response.ok) return response;

  let html = await response.text();
  const scriptIndex = html.lastIndexOf("<script>");
  if (scriptIndex === -1) return new Response(html, response);

  const pre = `<script>${escapeScript(PRELUDE)}</script>\n`;
  const post = `\n<script>${escapeScript(POSTLUDE)}</script>`;
  html = html.slice(0, scriptIndex) + pre + html.slice(scriptIndex);
  html = html.replace("</body>", post + "\n</body>");

  const headers = new Headers(response.headers);
  headers.delete("content-length");
  headers.set("cache-control", "no-cache");
  return new Response(html, { status: response.status, statusText: response.statusText, headers });
};

export const config = {
  path: [
    "/assignments/particules_sujet_objet_00",
    "/assignments/particules_sujet_objet_00.html",
    "/assignments/Particules_sujet_objet_00.html"
  ],
  method: "GET",
  onError: "bypass"
};
