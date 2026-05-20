// ═══════════════════════════════════════════════════════════════════════════
// DEEP LINK ROUTES (Universal Links iOS + App Links Android)
// ═══════════════════════════════════════════════════════════════════════════
// Routes publiques (hors `/api`) servant :
//   1. `/.well-known/apple-app-site-association` (AASA) — domain verification iOS
//   2. `/.well-known/assetlinks.json` — domain verification Android
//   3. `/reset-password/:token` — page web HTML minimaliste de fallback quand
//      l'utilisateur n'a pas l'app mobile installée.
//
// CONTRAINTES Apple/Google :
//   - Content-Type: application/json (impératif)
//   - Pas de redirect 3xx
//   - Pas d'auth (les OS récupèrent ces fichiers sans cookies)
//   - Pas d'extension `.json` pour AASA (Apple le tolère mais best practice)
// ═══════════════════════════════════════════════════════════════════════════

import express, { Request, Response } from "express";

const router = express.Router();

// ─────────────────────────────────────────────────────────────────────────
// iOS Universal Links : apple-app-site-association
// ─────────────────────────────────────────────────────────────────────────
// Bundle ID : fr.qvarry.app
// Apple Team ID : HB7K49N5TD
// Chemin couvert : /reset-password/* (pour le moment, extensible plus tard)
// ─────────────────────────────────────────────────────────────────────────

const AASA_PAYLOAD = {
  applinks: {
    details: [
      {
        appIDs: ["HB7K49N5TD.fr.qvarry.app"],
        components: [
          {
            "/": "/reset-password/*",
            comment: "Mobile reset password deep link",
          },
        ],
      },
    ],
  },
};

router.get(
  "/.well-known/apple-app-site-association",
  (_req: Request, res: Response) => {
    res
      .status(200)
      .type("application/json")
      .set("Cache-Control", "public, max-age=3600")
      .send(JSON.stringify(AASA_PAYLOAD));
  },
);

// ─────────────────────────────────────────────────────────────────────────
// Android App Links : assetlinks.json
// ─────────────────────────────────────────────────────────────────────────
// applicationId : com.sealfy.qvarryphone
// Empreintes SHA-256 du certificat de signature :
//   - Debug keystore (build local, alias androiddebugkey)
//   - Release keystore (alias qvarry, upload key locale)
//
// NOTE Play App Signing : si l'app est distribuée via Play Store avec Play
// App Signing activé, Google re-signe l'APK avec sa propre clé. Il faudra
// alors AJOUTER la SHA-256 de la "App signing key" récupérable dans
// Play Console > Setup > App Integrity > App Signing. La SHA "upload" ci-
// dessous reste utile pour les installs hors Play (sideload, internal test).
// ─────────────────────────────────────────────────────────────────────────

const ASSETLINKS_PAYLOAD = [
  {
    relation: ["delegate_permission/common.handle_all_urls"],
    target: {
      namespace: "android_app",
      package_name: "com.sealfy.qvarryphone",
      sha256_cert_fingerprints: [
        // Debug keystore (dev builds local)
        "FA:C6:17:45:DC:09:03:78:6F:B9:ED:E6:2A:96:2B:39:9F:73:48:F0:BB:6F:89:9B:83:32:66:75:91:03:3B:9C",
        // Release keystore (upload key — alias qvarry)
        "80:69:1D:50:AA:29:7D:27:DC:25:BE:16:BE:53:34:DB:77:5B:E5:81:58:44:13:45:9A:2E:C1:DB:67:28:6C:56",
      ],
    },
  },
];

router.get("/.well-known/assetlinks.json", (_req: Request, res: Response) => {
  res
    .status(200)
    .type("application/json")
    .set("Cache-Control", "public, max-age=3600")
    .send(JSON.stringify(ASSETLINKS_PAYLOAD));
});

// ─────────────────────────────────────────────────────────────────────────
// Page web fallback : /reset-password/:token
// ─────────────────────────────────────────────────────────────────────────
// Servie quand l'utilisateur clique sur le lien Universal Link mais que l'app
// mobile n'est PAS installée → il atterrit sur cette page web.
//
// Comportement :
//   - Si l'app était installée, iOS/Android intercepte AVANT que la requête
//     n'atteigne notre serveur (domain verification via AASA/assetlinks).
//   - Sinon, le navigateur ouvre cette page. Formulaire simple newPassword +
//     confirmPassword, POST vers /api/v1/auth/reset-password-token (handler
//     web miroir qui partage la logique avec le handler mobile via
//     passwordResetTokenService).
//
// Volontairement minimaliste — pas un chantier UI. Si une UI dédiée est créée
// plus tard côté frontend (Next.js / autre), pointer le mobile vers cette
// URL-là et supprimer cette route.
// ─────────────────────────────────────────────────────────────────────────

const TOKEN_PARAM_REGEX = /^[a-f0-9]{64}$/i;

router.get("/reset-password/:token", (req: Request, res: Response) => {
  const { token } = req.params;

  // Garde-fou : si le format est invalide, on évite d'injecter du HTML
  // potentiellement empoisonné. On affiche une page d'erreur simple.
  if (!TOKEN_PARAM_REGEX.test(token)) {
    res
      .status(400)
      .type("text/html; charset=utf-8")
      .send(renderErrorPage("Lien de réinitialisation invalide."));
    return;
  }

  // Override CSP global (helmet) car la page utilise un script inline.
  // On serre la CSP : 'self' + 'unsafe-inline' uniquement pour les scripts
  // (et seulement sur CETTE route). Pas d'eval. Pas de connect externe sauf
  // self (l'endpoint /api/v1/auth/reset-password-token est en self-origin).
  res
    .status(200)
    .type("text/html; charset=utf-8")
    .set("X-Frame-Options", "DENY")
    .set(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; object-src 'none';",
    )
    .send(renderResetPage(token));
});

// ─────────────────────────────────────────────────────────────────────────
// Templates HTML (inline) — pas de moteur de template à embarquer pour ça.
// Le token est validé par regex avant injection (cf. TOKEN_PARAM_REGEX).
// ─────────────────────────────────────────────────────────────────────────

function renderResetPage(token: string): string {
  // token déjà validé en amont contre TOKEN_PARAM_REGEX → safe en JS string literal.
  return `<!doctype html>
<html lang="fr">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
  <meta name="robots" content="noindex, nofollow" />
  <title>Réinitialiser votre mot de passe — QVARRY</title>
  <style>
    :root {
      --bg: #0f1115;
      --card: #1a1d24;
      --text: #f0f2f5;
      --muted: #8b929b;
      --accent: #4f8cff;
      --error: #ff5c5c;
      --success: #2ecc71;
      --border: #2a2f38;
    }
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; height: 100%; }
    body {
      background: var(--bg);
      color: var(--text);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px;
    }
    .card {
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: 14px;
      padding: 28px;
      width: 100%;
      max-width: 420px;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
    }
    h1 { font-size: 22px; margin: 0 0 8px; }
    p.lead { color: var(--muted); margin: 0 0 20px; font-size: 14px; line-height: 1.5; }
    label { display: block; font-size: 13px; margin-bottom: 6px; color: var(--muted); }
    input {
      width: 100%;
      padding: 12px 14px;
      border-radius: 10px;
      border: 1px solid var(--border);
      background: #11141a;
      color: var(--text);
      font-size: 15px;
      margin-bottom: 14px;
      -webkit-appearance: none;
    }
    input:focus { outline: none; border-color: var(--accent); }
    button {
      width: 100%;
      padding: 13px;
      background: var(--accent);
      color: #fff;
      border: 0;
      border-radius: 10px;
      font-size: 15px;
      font-weight: 600;
      cursor: pointer;
      margin-top: 4px;
    }
    button:disabled { opacity: 0.6; cursor: not-allowed; }
    .msg { font-size: 13px; padding: 10px 12px; border-radius: 8px; margin-bottom: 14px; display: none; }
    .msg.error { background: rgba(255, 92, 92, 0.12); color: var(--error); display: block; }
    .msg.success { background: rgba(46, 204, 113, 0.12); color: var(--success); display: block; }
    .hint { font-size: 12px; color: var(--muted); margin-top: -8px; margin-bottom: 14px; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Réinitialiser votre mot de passe</h1>
    <p class="lead">Choisissez un nouveau mot de passe pour votre compte QVARRY.</p>
    <div id="msg" class="msg" role="status"></div>
    <form id="form" autocomplete="off" novalidate>
      <label for="newPassword">Nouveau mot de passe</label>
      <input id="newPassword" type="password" required autocomplete="new-password" minlength="12" />
      <div class="hint">12 caractères min., 1 majuscule, 1 minuscule, 1 chiffre, 1 spécial.</div>
      <label for="confirmPassword">Confirmer le mot de passe</label>
      <input id="confirmPassword" type="password" required autocomplete="new-password" minlength="12" />
      <button id="submit" type="submit">Valider</button>
    </form>
  </div>
  <script>
    (function () {
      var TOKEN = ${JSON.stringify(token)};
      var ENDPOINT = "/api/v1/auth/reset-password-token";
      var form = document.getElementById("form");
      var btn = document.getElementById("submit");
      var msg = document.getElementById("msg");

      function showMsg(text, ok) {
        msg.textContent = text;
        msg.className = "msg " + (ok ? "success" : "error");
      }

      form.addEventListener("submit", function (e) {
        e.preventDefault();
        var pw = document.getElementById("newPassword").value;
        var pw2 = document.getElementById("confirmPassword").value;
        if (pw !== pw2) {
          showMsg("Les mots de passe ne correspondent pas.", false);
          return;
        }
        btn.disabled = true;
        showMsg("", false);
        msg.className = "msg";
        fetch(ENDPOINT, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token: TOKEN, newPassword: pw })
        })
          .then(function (r) { return r.json().then(function (j) { return { status: r.status, body: j }; }); })
          .then(function (res) {
            if (res.status === 200 && res.body && res.body.success) {
              showMsg("Mot de passe réinitialisé. Vous pouvez vous reconnecter dans l'application.", true);
              form.style.display = "none";
            } else {
              var err = (res.body && (res.body.error || res.body.message)) || "Erreur lors de la réinitialisation.";
              showMsg(err, false);
              btn.disabled = false;
            }
          })
          .catch(function () {
            showMsg("Erreur réseau. Veuillez réessayer.", false);
            btn.disabled = false;
          });
      });
    })();
  </script>
</body>
</html>`;
}

function renderErrorPage(message: string): string {
  // message est une constante interne au backend → safe.
  return `<!doctype html>
<html lang="fr">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="robots" content="noindex, nofollow" />
  <title>Erreur — QVARRY</title>
  <style>
    body {
      margin: 0;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      background: #0f1115;
      color: #f0f2f5;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
      padding: 24px;
    }
    .card {
      background: #1a1d24;
      border: 1px solid #2a2f38;
      border-radius: 14px;
      padding: 28px;
      max-width: 420px;
      text-align: center;
    }
  </style>
</head>
<body>
  <div class="card">
    <h1 style="margin-top:0">Lien invalide</h1>
    <p style="color:#8b929b">${message}</p>
  </div>
</body>
</html>`;
}

export default router;
