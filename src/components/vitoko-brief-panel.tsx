import Link from "next/link";
import { AlertTriangle, Bot, CheckCircle2, ExternalLink, Sparkles } from "lucide-react";
import clsx from "clsx";
import { Panel, StatusPill } from "@/components/ui";
import type { VitokoBrief, VitokoTone } from "@/lib/vitoko";

function toneClasses(tone: VitokoTone) {
  return clsx(
    tone === "good" && "border-emerald-200 bg-emerald-50 dark:border-emerald-800/80 dark:bg-emerald-950/60 dark:text-emerald-200",
    tone === "warn" && "border-amber-200 bg-amber-50 dark:border-amber-800/80 dark:bg-amber-950/60 dark:text-amber-200",
    tone === "bad" && "border-red-200 bg-red-50 dark:border-red-800/80 dark:bg-red-950/60 dark:text-red-200",
    tone === "neutral" && "border-graphite/10 bg-white dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100"
  );
}

export function VitokoBriefPanel({ brief }: { brief: VitokoBrief }) {
  const primaryActions = brief.insights.flatMap((insight) => insight.actions).slice(0, 4);

  return (
    <Panel className="overflow-hidden">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-xs font-black uppercase text-copper dark:text-amber-400">
            <Bot className="h-4 w-4" aria-hidden="true" />
            Asistente IA 360
          </p>
          <h2 className="mt-1 text-2xl font-black text-ink dark:text-white">{brief.headline}</h2>
          <p className="mt-2 text-sm font-semibold leading-6 text-steel dark:text-slate-300">{brief.summary}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {primaryActions.map((item) => (
            <Link key={`${item.label}-${item.href}`} href={item.href} className="btn btn-secondary">
              {item.label}
              <ExternalLink className="h-4 w-4" aria-hidden="true" />
            </Link>
          ))}
        </div>
      </div>

      <div className="mt-5 grid gap-3 lg:grid-cols-3">
        {brief.insights.slice(0, 3).map((insight) => (
          <div key={insight.id} className={clsx("rounded-lg border p-4", toneClasses(insight.tone))}>
            <div className="flex items-start justify-between gap-3">
              <p className="flex items-center gap-2 text-xs font-black uppercase text-steel dark:text-slate-300">
                {insight.tone === "warn" ? <AlertTriangle className="h-4 w-4 text-amber-700 dark:text-amber-400" aria-hidden="true" /> : <Sparkles className="h-4 w-4 text-signal dark:text-teal-400" aria-hidden="true" />}
                {insight.agent}
              </p>
              <StatusPill tone={insight.tone}>{insight.tone === "warn" ? "Revisar" : insight.tone === "good" ? "Oportunidad" : "Dato"}</StatusPill>
            </div>
            <h3 className="mt-3 text-base font-black leading-6 text-ink dark:text-white">{insight.title}</h3>
            <p className="mt-2 text-sm font-semibold leading-6 text-steel dark:text-slate-300">{insight.detail}</p>
            {insight.actions.length ? (
              <Link href={insight.actions[0].href} className="mt-4 inline-flex items-center gap-2 text-sm font-black text-signal dark:text-teal-400">
                {insight.actions[0].label}
                <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
              </Link>
            ) : null}
          </div>
        ))}
      </div>
    </Panel>
  );
}
