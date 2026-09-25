"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import {
  Bot,
  ExternalLink,
  Minus,
  Send,
  Sparkles,
  X
} from "lucide-react";
import clsx from "clsx";
import type { VitokoAction, VitokoBrief, VitokoTone } from "@/lib/vitoko";

type VitokoMessage = {
  role: "user" | "vitoko";
  text: string;
  actions?: VitokoAction[];
  sources?: string[];
};

const quickPrompts = [
  "Tengo un cliente con presupuesto y quiere SUV",
  "Revisa bonos o campañas importantes",
  "Necesito cuidar rentabilidad e impuesto verde",
  "Quiero evaluar credito Amicar"
];

function toneClasses(tone: VitokoTone = "neutral") {
  return clsx(
    tone === "good" && "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-200",
    tone === "warn" && "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200",
    tone === "bad" && "border-red-200 bg-red-50 text-red-900 dark:border-red-800 dark:bg-red-950 dark:text-red-200",
    tone === "neutral" && "border-slate-200 bg-slate-50 text-slate-900 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200"
  );
}

function ActionLink({ action }: { action: VitokoAction }) {
  return (
    <Link
      href={action.href}
      className={clsx(
        "inline-flex min-h-9 items-center gap-2 rounded-lg border px-3 py-2 text-xs font-black transition hover:-translate-y-0.5 shadow-sm",
        toneClasses(action.tone)
      )}
    >
      {action.label}
      <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
    </Link>
  );
}

export function VitokoAssistant() {
  const [isOpen, setIsOpen] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);
  const [brief, setBrief] = useState<VitokoBrief | null>(null);
  const [messages, setMessages] = useState<VitokoMessage[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;

    fetch("/api/vitoko")
      .then((response) => response.json())
      .then((data) => {
        if (!cancelled && data?.brief) setBrief(data.brief);
      })
      .catch(() => {
        if (!cancelled) setError("El Asistente IA 360 no pudo leer el resumen ahora.");
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [messages, isOpen]);

  async function sendMessage(message: string) {
    const cleanMessage = message.trim();
    if (!cleanMessage || isLoading) return;

    setInput("");
    setError("");
    setIsLoading(true);
    setMessages((current) => [...current, { role: "user", text: cleanMessage }]);

    try {
      const response = await fetch("/api/vitoko", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: cleanMessage })
      });
      const data = await response.json();

      if (!response.ok || !data?.answer) {
        throw new Error("Respuesta no disponible");
      }

      setMessages((current) => [
        ...current,
        {
          role: "vitoko",
          text: data.answer.reply,
          actions: data.answer.actions,
          sources: data.answer.sources
        }
      ]);
    } catch {
      setError("No pude consultar el Asistente IA 360. Reintenta en unos segundos.");
    } finally {
      setIsLoading(false);
    }
  }

  const primaryInsight = brief?.insights[0];

  return (
    <div className="asistente-flotante no-print fixed bottom-4 right-4 z-40 transition-[bottom] sm:bottom-5 sm:right-5">
      {isOpen && !isMinimized ? (
        <section
          role="dialog"
          aria-label="Asistente IA 360"
          className="fixed inset-x-3 bottom-3 max-h-[calc(100vh-2rem)] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-800 dark:bg-slate-900 sm:left-auto sm:right-5 sm:w-[420px]"
        >
          {/* Header */}
          <div className="flex items-center justify-between gap-3 border-b border-slate-200 bg-slate-900 px-4 py-3.5 text-white dark:border-slate-800 dark:bg-slate-950">
            <div className="flex min-w-0 items-center gap-3">
              <div className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-teal-500/20 text-teal-400 border border-teal-500/30">
                <Bot className="h-5 w-5" aria-hidden="true" />
                <span className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-emerald-400 ring-2 ring-slate-900" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <p className="truncate text-sm font-black">Asistente IA 360</p>
                  <span className="rounded bg-teal-500/20 px-1.5 py-0.5 text-[10px] font-extrabold text-teal-300">Mascota</span>
                </div>
                <p className="truncate text-xs text-slate-400">Asistente comercial & rentabilidad</p>
              </div>
            </div>

            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setIsMinimized(true)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white"
                title="Minimizar"
                aria-label="Minimizar Asistente IA 360"
              >
                <Minus className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white"
                title="Cerrar"
                aria-label="Cerrar Asistente IA 360"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          {/* Chat content */}
          <div className="max-h-[calc(100vh-14rem)] overflow-y-auto px-4 py-4 space-y-4">
            {primaryInsight && messages.length === 0 ? (
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3.5 text-xs dark:border-slate-800 dark:bg-slate-950">
                <p className="font-black text-slate-900 dark:text-white">{primaryInsight.title}</p>
                <p className="mt-1 text-slate-600 dark:text-slate-400">{primaryInsight.detail}</p>
              </div>
            ) : null}

            {messages.length === 0 ? (
              <div className="space-y-2">
                <p className="text-xs font-black uppercase tracking-wider text-slate-400">Consultas rápidas:</p>
                <div className="grid gap-1.5">
                  {quickPrompts.map((prompt) => (
                    <button
                      key={prompt}
                      type="button"
                      onClick={() => sendMessage(prompt)}
                      className="rounded-xl border border-slate-200 bg-white p-2.5 text-left text-xs font-semibold text-slate-700 shadow-sm transition hover:border-teal-500 hover:bg-teal-50/50 hover:text-teal-900 dark:border-slate-800 dark:bg-slate-800/80 dark:text-slate-300 dark:hover:border-teal-500 dark:hover:bg-slate-800"
                    >
                      {prompt}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                {messages.map((message, index) => (
                  <div
                    key={index}
                    className={clsx(
                      "rounded-2xl p-3.5 text-xs leading-relaxed",
                      message.role === "user"
                        ? "ml-auto max-w-[85%] bg-slate-900 text-white dark:bg-teal-600"
                        : "mr-auto max-w-[90%] border border-slate-200 bg-slate-50 text-slate-800 dark:border-slate-800 dark:bg-slate-800 dark:text-slate-200"
                    )}
                  >
                    <p className="whitespace-pre-wrap">{message.text}</p>
                    {message.actions?.length ? (
                      <div className="mt-2.5 flex flex-wrap gap-1.5">
                        {message.actions.map((item) => (
                          <ActionLink key={`${item.label}-${item.href}`} action={item} />
                        ))}
                      </div>
                    ) : null}
                  </div>
                ))}
                <div ref={messagesEndRef} />
              </div>
            )}

            {isLoading ? <p className="text-xs font-bold text-teal-600 dark:text-teal-400">Asistente IA 360 está procesando tu consulta...</p> : null}
            {error ? <p className="rounded-xl bg-red-50 p-3 text-xs font-bold text-red-800 dark:bg-red-950/60 dark:text-red-300">{error}</p> : null}
          </div>

          {/* Input Form */}
          <form
            className="border-t border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900"
            onSubmit={(event) => {
              event.preventDefault();
              sendMessage(input);
            }}
          >
            <div className="flex items-center gap-2">
              <input
                value={input}
                onChange={(event) => setInput(event.target.value)}
                className="input text-xs"
                placeholder="Escribe tu consulta sobre vehículos o bonos..."
                aria-label="Mensaje para el Asistente IA 360"
              />
              <button
                type="submit"
                className="btn btn-primary shrink-0 px-3"
                disabled={isLoading || !input.trim()}
                aria-label="Enviar al Asistente IA 360"
              >
                <Send className="h-4 w-4" />
              </button>
            </div>
          </form>
        </section>
      ) : (
        /* DISCREET FLOATING MASCOT BUTTON */
        <button
          type="button"
          onClick={() => {
            setIsOpen(true);
            setIsMinimized(false);
          }}
          className="flex items-center gap-2.5 rounded-full border border-slate-200 bg-slate-900 px-4 py-2.5 text-left text-white shadow-xl transition-all duration-300 hover:scale-105 hover:bg-slate-800 dark:border-slate-700 dark:bg-teal-600 dark:hover:bg-teal-500"
          aria-label="Abrir Asistente IA 360"
        >
          <div className="relative flex h-7 w-7 items-center justify-center rounded-full bg-teal-400/20 text-teal-300">
            <Bot className="h-4 w-4" />
            <span className="absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full bg-emerald-400 ring-2 ring-slate-900" />
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-black tracking-wide">Asistente IA 360</span>
            <span className="text-xs">👋</span>
          </div>
          <Sparkles className="h-3.5 w-3.5 text-teal-300" />
        </button>
      )}
    </div>
  );
}
