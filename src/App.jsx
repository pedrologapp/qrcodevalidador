import { useState, useEffect, useRef, useCallback } from "react";
import {
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Camera,
  RotateCcw,
  Loader2,
  Users,
  PartyPopper,
  Volume2,
  VolumeX,
} from "lucide-react";

const WEBHOOK_URL = "https://webhook.escolaamadeus.com/webhook/qrcode";

/* ───────────────────────── helpers ───────────────────────── */

function vibrate(ms = 200) {
  try {
    navigator?.vibrate?.(ms);
  } catch (_) {}
}

function playBeep(type = "success") {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    gain.gain.value = 0.18;

    if (type === "success") {
      osc.frequency.value = 880;
      osc.type = "sine";
    } else if (type === "duplicate") {
      osc.frequency.value = 440;
      osc.type = "triangle";
    } else {
      osc.frequency.value = 280;
      osc.type = "square";
    }

    osc.start();
    osc.stop(ctx.currentTime + (type === "success" ? 0.15 : 0.3));
  } catch (_) {}
}

function getQrBoxSize(containerWidth) {
  const size = Math.floor(Math.min(containerWidth * 0.65, 260));
  return { width: size, height: size };
}

/* ───────────────────── componente principal ──────────────── */

export default function QRValidator() {
  const [scriptReady, setScriptReady] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [count, setCount] = useState({ ok: 0, nao: 0 });
  const [soundOn, setSoundOn] = useState(true);
  const [cameraError, setCameraError] = useState(null);

  const scannerRef = useRef(null);
  const wakeLockRef = useRef(null);
  const lastScanRef = useRef({ code: null, at: 0 });
  const containerRef = useRef(null);

  /* ── Wake Lock ── */
  const requestWakeLock = useCallback(async () => {
    try {
      if ("wakeLock" in navigator) {
        wakeLockRef.current = await navigator.wakeLock.request("screen");
      }
    } catch (_) {}
  }, []);

  const releaseWakeLock = useCallback(() => {
    try {
      wakeLockRef.current?.release();
      wakeLockRef.current = null;
    } catch (_) {}
  }, []);

  /* ── Carrega html5-qrcode via CDN ── */
  useEffect(() => {
    if (window.Html5Qrcode) {
      setScriptReady(true);
      return;
    }
    const s = document.createElement("script");
    s.src =
      "https://cdnjs.cloudflare.com/ajax/libs/html5-qrcode/2.3.8/html5-qrcode.min.js";
    s.async = true;
    s.onload = () => setScriptReady(true);
    s.onerror = () =>
      setResult({
        status: "error",
        message: "Não consegui carregar o leitor. Recarregue a página.",
      });
    document.head.appendChild(s);
  }, []);

  /* ── Cleanup ao desmontar ── */
  useEffect(() => {
    return () => {
      cleanupScanner();
      releaseWakeLock();
    };
  }, []);

  /* ── Para e limpa o scanner de forma segura ── */
  const cleanupScanner = useCallback(async () => {
    if (scannerRef.current) {
      try {
        const state = scannerRef.current.getState?.();
        if (state === 2 || state === 3) {
          await scannerRef.current.stop();
        }
        scannerRef.current.clear();
      } catch (_) {}
      scannerRef.current = null;
    }
  }, []);

  /* ── Envia pro webhook ── */
  const sendToWebhook = useCallback(async (code) => {
    setLoading(true);
    try {
      const resp = await fetch(WEBHOOK_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          qrCode: code,
          timestamp: new Date().toISOString(),
        }),
      });

      let body = {};
      try {
        body = await resp.json();
      } catch (_) {}

      const normalizedStatus = (() => {
        if (typeof body.status === "string") {
          const s = body.status.toLowerCase();
          if (["valid", "ok", "success"].includes(s)) return "success";
          if (["already_used", "used", "duplicate"].includes(s))
            return "duplicate";
          if (["invalid", "error", "fail", "failed"].includes(s))
            return "error";
        }
        if (body.used === true) return "duplicate";
        if (body.valid === true) return "success";
        if (body.valid === false) return "error";
        return resp.ok ? "success" : "error";
      })();

      const message =
        body.message ||
        (normalizedStatus === "success"
          ? "Pode entrar!"
          : normalizedStatus === "duplicate"
          ? "Essa entrada já foi usada."
          : "QR Code não reconhecido.");

      return {
        status: normalizedStatus,
        message,
        nome: body.nome || body.name || null,
        extra: body.turma || body.categoria || body.info || null,
      };
    } catch (err) {
      return {
        status: "error",
        message: "Sem conexão. Verifique a internet e tente de novo.",
      };
    } finally {
      setLoading(false);
    }
  }, []);

  /* ── Callback ao ler um QR Code ── */
  const handleScan = useCallback(
    async (code) => {
      const now = Date.now();
      if (
        lastScanRef.current.code === code &&
        now - lastScanRef.current.at < 3000
      ) {
        return;
      }
      lastScanRef.current = { code, at: now };

      // Pausa a câmera (mantém aberta, sem pedir permissão de novo)
      if (scannerRef.current) {
        try {
          scannerRef.current.pause(true);
        } catch (_) {}
      }

      const entry = await sendToWebhook(code);
      setResult(entry);

      if (entry.status === "success") {
        vibrate(150);
        if (soundOn) playBeep("success");
        setCount((c) => ({ ...c, ok: c.ok + 1 }));
      } else if (entry.status === "duplicate") {
        vibrate([100, 50, 100]);
        if (soundOn) playBeep("duplicate");
        setCount((c) => ({ ...c, nao: c.nao + 1 }));
      } else {
        vibrate([100, 50, 100, 50, 100]);
        if (soundOn) playBeep("error");
        setCount((c) => ({ ...c, nao: c.nao + 1 }));
      }
    },
    [sendToWebhook, soundOn]
  );

  /* ── Inicia o scanner (com fallback de câmera) ── */
  const startScanning = useCallback(async () => {
    if (!scriptReady || !window.Html5Qrcode) return;

    setCameraError(null);
    setResult(null);

    await cleanupScanner();

    const el = document.getElementById("qr-reader");
    if (!el) return;

    const containerW = containerRef.current?.offsetWidth || 320;
    const qrbox = getQrBoxSize(containerW);

    try {
      const scanner = new window.Html5Qrcode("qr-reader", { verbose: false });
      scannerRef.current = scanner;

      try {
        await scanner.start(
          { facingMode: "environment" },
          { fps: 10, qrbox, aspectRatio: 1.0 },
          (decoded) => handleScan(decoded),
          () => {}
        );
      } catch (envErr) {
        const devices = await window.Html5Qrcode.getCameras();
        if (devices && devices.length > 0) {
          await scanner.start(
            devices[devices.length - 1].id,
            { fps: 10, qrbox, aspectRatio: 1.0 },
            (decoded) => handleScan(decoded),
            () => {}
          );
        } else {
          throw envErr;
        }
      }

      setScanning(true);
      requestWakeLock();
    } catch (err) {
      const msg = String(err?.message || err || "");
      if (msg.includes("NotAllowedError") || msg.includes("Permission")) {
        setCameraError(
          "Você precisa permitir o acesso à câmera. Toque no ícone de cadeado na barra do navegador e ative a câmera."
        );
      } else if (msg.includes("NotFoundError") || msg.includes("no camera")) {
        setCameraError("Nenhuma câmera encontrada neste aparelho.");
      } else {
        setCameraError(
          "Não foi possível abrir a câmera. Use um navegador atualizado (Chrome ou Safari) e acesse por HTTPS."
        );
      }
    }
  }, [scriptReady, handleScan, cleanupScanner, requestWakeLock]);

  /* ── Continua escaneando após resultado ── */
  const continueScan = useCallback(async () => {
    setResult(null);
    setCameraError(null);
    // Tenta retomar a câmera pausada (sem pedir permissão de novo)
    if (scannerRef.current) {
      try {
        scannerRef.current.resume();
        return;
      } catch (_) {}
    }
    // Se falhar, aí sim reinicia do zero
    await startScanning();
  }, [startScanning]);

  const rootStyle = {
    minHeight: "100dvh",
    paddingTop: "env(safe-area-inset-top)",
    paddingBottom: "env(safe-area-inset-bottom)",
    paddingLeft: "env(safe-area-inset-left)",
    paddingRight: "env(safe-area-inset-right)",
    overscrollBehavior: "none",
    WebkitOverflowScrolling: "touch",
    touchAction: "manipulation",
  };

  return (
    <div
      className="bg-gradient-to-b from-sky-50 to-white font-sans"
      style={rootStyle}
    >
      {/* Header */}
      <header className="bg-white shadow-sm sticky top-0 z-10">
        <div className="max-w-md mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-10 h-10 rounded-xl bg-sky-100 flex items-center justify-center">
              <PartyPopper className="w-5 h-5 text-sky-600" />
            </div>
            <div>
              <h1 className="font-semibold text-slate-800 leading-tight text-base">
                Entrada do Evento
              </h1>
              <p className="text-xs text-slate-500">Escola Amadeus</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setSoundOn((s) => !s)}
              className="w-9 h-9 rounded-full flex items-center justify-center active:bg-slate-100 transition"
              aria-label={soundOn ? "Desativar som" : "Ativar som"}
            >
              {soundOn ? (
                <Volume2 className="w-4 h-4 text-slate-400" />
              ) : (
                <VolumeX className="w-4 h-4 text-slate-300" />
              )}
            </button>
            <div className="flex items-center gap-1.5 bg-sky-50 rounded-full px-3 py-1.5">
              <Users className="w-4 h-4 text-sky-600" />
              <span className="font-semibold text-sky-700 text-sm">
                {count.ok}
              </span>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-md mx-auto px-4 py-5 space-y-4">
        {/* Área da câmera */}
        <div
          ref={containerRef}
          className="relative w-full bg-slate-100 rounded-3xl overflow-hidden shadow-lg"
          style={{ aspectRatio: "1 / 1" }}
        >
          <div
            id="qr-reader"
            className="w-full h-full"
            style={{ minHeight: "280px" }}
          />

          {/* Estado inicial — botão de abrir câmera */}
          {!scanning && !loading && !result && !cameraError && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-gradient-to-br from-sky-50 to-slate-50">
              <div className="w-20 h-20 rounded-full bg-white shadow-md flex items-center justify-center">
                <Camera className="w-10 h-10 text-sky-600" />
              </div>
              <button
                onClick={startScanning}
                disabled={!scriptReady}
                className="bg-sky-600 active:bg-sky-800 disabled:bg-slate-300 text-white font-semibold rounded-full px-8 py-4 text-lg shadow-lg shadow-sky-600/30 transition-colors flex items-center gap-2 select-none"
              >
                {!scriptReady ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" />
                    Preparando...
                  </>
                ) : (
                  <>
                    <Camera className="w-5 h-5" />
                    Começar a ler
                  </>
                )}
              </button>
            </div>
          )}

          {/* Erro de câmera */}
          {cameraError && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-white/95 px-6 text-center">
              <div className="w-16 h-16 rounded-full bg-red-50 flex items-center justify-center">
                <Camera className="w-8 h-8 text-red-400" />
              </div>
              <p className="text-slate-700 text-sm leading-relaxed">
                {cameraError}
              </p>
              <button
                onClick={startScanning}
                className="bg-sky-600 active:bg-sky-800 text-white font-semibold rounded-full px-6 py-3 text-sm transition-colors select-none"
              >
                Tentar novamente
              </button>
            </div>
          )}

          {/* Overlay do scanner ativo */}
          {scanning && !loading && !result && (
            <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
              <div
                className="relative"
                style={{ width: "65%", maxWidth: "260px", aspectRatio: "1/1" }}
              >
                <div className="absolute top-0 left-0 w-8 h-8 border-t-4 border-l-4 border-white rounded-tl-xl" />
                <div className="absolute top-0 right-0 w-8 h-8 border-t-4 border-r-4 border-white rounded-tr-xl" />
                <div className="absolute bottom-0 left-0 w-8 h-8 border-b-4 border-l-4 border-white rounded-bl-xl" />
                <div className="absolute bottom-0 right-0 w-8 h-8 border-b-4 border-r-4 border-white rounded-br-xl" />
              </div>
            </div>
          )}

          {/* Loading de validação */}
          {loading && (
            <div className="absolute inset-0 flex items-center justify-center bg-white/90">
              <div className="flex flex-col items-center gap-3">
                <Loader2 className="w-10 h-10 animate-spin text-sky-600" />
                <span className="text-base text-slate-700 font-medium">
                  Verificando...
                </span>
              </div>
            </div>
          )}
        </div>

        {/* Dica de uso */}
        {scanning && !result && !loading && (
          <p className="text-center text-slate-500 text-sm">
            Aponte a câmera para o QR Code do convidado
          </p>
        )}

        {/* Card de resultado */}
        {result && !cameraError && (
          <ResultCard result={result} onContinue={continueScan} />
        )}

        {/* Contadores */}
        {(count.ok > 0 || count.nao > 0) && (
          <div className="flex gap-3">
            <div className="flex-1 bg-emerald-50 border border-emerald-100 rounded-2xl p-3 text-center">
              <div className="text-2xl font-bold text-emerald-600">
                {count.ok}
              </div>
              <div className="text-xs text-emerald-700 font-medium">
                Entradas liberadas
              </div>
            </div>
            <div className="flex-1 bg-slate-50 border border-slate-100 rounded-2xl p-3 text-center">
              <div className="text-2xl font-bold text-slate-500">
                {count.nao}
              </div>
              <div className="text-xs text-slate-500 font-medium">
                Não liberadas
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

/* ──────────────── Card de resultado ──────────────── */

function ResultCard({ result, onContinue }) {
  const config = {
    success: {
      bg: "bg-emerald-500",
      bgSoft: "bg-emerald-50",
      border: "border-emerald-200",
      text: "text-emerald-700",
      Icon: CheckCircle2,
      title: "Pode entrar! 🎉",
      btnBg: "bg-emerald-600 active:bg-emerald-800",
    },
    duplicate: {
      bg: "bg-amber-500",
      bgSoft: "bg-amber-50",
      border: "border-amber-200",
      text: "text-amber-700",
      Icon: AlertTriangle,
      title: "Atenção",
      btnBg: "bg-amber-600 active:bg-amber-800",
    },
    error: {
      bg: "bg-red-500",
      bgSoft: "bg-red-50",
      border: "border-red-200",
      text: "text-red-700",
      Icon: XCircle,
      title: "Não liberado",
      btnBg: "bg-red-600 active:bg-red-800",
    },
  }[result.status] || {
    bg: "bg-slate-500",
    bgSoft: "bg-slate-50",
    border: "border-slate-200",
    text: "text-slate-700",
    Icon: XCircle,
    title: "Algo deu errado",
    btnBg: "bg-slate-600 active:bg-slate-800",
  };

  const Icon = config.Icon;

  return (
    <div
      className={`${config.bgSoft} border-2 ${config.border} rounded-3xl p-6 shadow-lg`}
    >
      <div className="flex flex-col items-center text-center">
        <div
          className={`w-20 h-20 ${config.bg} rounded-full flex items-center justify-center mb-4 shadow-lg`}
        >
          <Icon className="w-12 h-12 text-white" strokeWidth={2.5} />
        </div>
        <h2 className={`text-2xl font-bold ${config.text} mb-1`}>
          {config.title}
        </h2>
        <p className="text-slate-700 text-lg">{result.message}</p>

        {result.nome && (
          <div className="mt-4 bg-white rounded-2xl px-5 py-3 w-full shadow-sm">
            <div className="text-[11px] text-slate-400 uppercase tracking-wide mb-0.5">
              Convidado
            </div>
            <div className="text-lg font-semibold text-slate-800">
              {result.nome}
            </div>
            {result.extra && (
              <div className="text-sm text-slate-500 mt-0.5">
                {result.extra}
              </div>
            )}
          </div>
        )}
      </div>

      <button
        onClick={onContinue}
        className={`w-full mt-5 ${config.btnBg} text-white font-semibold rounded-2xl py-4 text-lg shadow-md transition-colors flex items-center justify-center gap-2 select-none`}
      >
        <RotateCcw className="w-5 h-5" />
        Ler próximo QR Code
      </button>
    </div>
  );
}
