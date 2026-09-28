"use client";

import { useEffect, useState } from "react";
import { MoreVertical, PlusSquare, Share, Smartphone, X } from "lucide-react";

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

declare global {
  interface Navigator {
    standalone?: boolean;
  }
}

export function InstallAppButton() {
  const [ready, setReady] = useState(false);
  const [isIos, setIsIos] = useState(false);
  const [isAndroid, setIsAndroid] = useState(false);
  const [isStandalone, setIsStandalone] = useState(false);
  const [installPrompt, setInstallPrompt] = useState<InstallPromptEvent | null>(null);
  const [showGuide, setShowGuide] = useState(false);

  useEffect(() => {
    // Register before Android checks installability. This is intentionally a
    // network-only worker: it enables a genuine standalone install without
    // ever caching private rota or household API responses on a shared phone.
    if ("serviceWorker" in navigator) {
      void navigator.serviceWorker.register("/sw.js").catch(() => undefined);
    }

    const standalone =
      window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
    setIsStandalone(standalone);
    setIsIos(/iPad|iPhone|iPod/.test(navigator.userAgent));
    setIsAndroid(/Android/.test(navigator.userAgent));
    setReady(true);

    function captureInstallPrompt(event: Event) {
      event.preventDefault();
      setInstallPrompt(event as InstallPromptEvent);
    }

    function markInstalled() {
      setIsStandalone(true);
      setShowGuide(false);
    }

    window.addEventListener("beforeinstallprompt", captureInstallPrompt);
    window.addEventListener("appinstalled", markInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", captureInstallPrompt);
      window.removeEventListener("appinstalled", markInstalled);
    };
  }, []);

  async function install() {
    if (installPrompt) {
      await installPrompt.prompt();
      const choice = await installPrompt.userChoice;
      if (choice.outcome === "accepted") setIsStandalone(true);
      setInstallPrompt(null);
      return;
    }

    setShowGuide(true);
  }

  if (!ready || isStandalone) return null;

  return (
    <>
      <button className="install-app-button" type="button" onClick={install}>
        <Smartphone size={16} aria-hidden="true" />
        <span>{isIos ? "Add to iPhone" : isAndroid ? "Install app" : "Get app"}</span>
      </button>

      {showGuide && (
        <div className="install-guide-backdrop" role="presentation" onMouseDown={() => setShowGuide(false)}>
          <section
            className="install-guide"
            role="dialog"
            aria-modal="true"
            aria-labelledby="install-guide-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="install-guide-hero">
              <div className="install-guide-icon">☀️</div>
              <div>
                <span>ONE-TIME SETUP</span>
                <h2 id="install-guide-title">
                  {isIos ? "Put Our Days on her iPhone" : isAndroid ? "Install Our Days on Android" : "Put Our Days on your phone"}
                </h2>
                <p>
                  It will open from {isIos ? "her" : "your"} Home Screen just like a normal app.
                </p>
              </div>
              <button
                className="icon-button"
                type="button"
                onClick={() => setShowGuide(false)}
                aria-label="Close instructions"
              >
                <X size={18} />
              </button>
            </div>

            {isAndroid ? (
              <ol className="install-steps">
                <li>
                  <strong>1</strong>
                  <span>Open Our Days in <b>Chrome</b> on your Android phone.</span>
                </li>
                <li>
                  <strong>2</strong>
                  <span>Tap Chrome’s <b>three-dot menu</b> in the top-right.</span>
                  <MoreVertical size={22} aria-label="Three-dot menu symbol" />
                </li>
                <li>
                  <strong>3</strong>
                  <span>Tap <b>Add to Home screen</b>, then choose <b>Install</b>.</span>
                  <PlusSquare size={22} aria-label="Add to Home Screen symbol" />
                </li>
                <li>
                  <strong>4</strong>
                  <span>Use the new <b>Our Days</b> icon from your Home Screen.</span>
                </li>
              </ol>
            ) : (
              <ol className="install-steps">
                <li>
                  <strong>1</strong>
                  <span>Open this page in <b>Safari</b> on her iPhone.</span>
                </li>
                <li>
                  <strong>2</strong>
                  <span>Tap the <b>Share</b> button at the bottom of Safari.</span>
                  <Share size={22} aria-label="Share symbol" />
                </li>
                <li>
                  <strong>3</strong>
                  <span>Scroll down and tap <b>Add to Home Screen</b>.</span>
                  <PlusSquare size={22} aria-label="Add to Home Screen symbol" />
                </li>
                <li>
                  <strong>4</strong>
                  <span>Tap <b>Add</b>. That’s it — she can use the new Our Days icon.</span>
                </li>
              </ol>
            )}

            <div className="install-guide-note">
              {isIos ? "She" : "You"} may need to sign in once when it first opens.
            </div>
            <button className="btn btn-primary btn-block" type="button" onClick={() => setShowGuide(false)}>
              Got it
            </button>
          </section>
        </div>
      )}
    </>
  );
}
