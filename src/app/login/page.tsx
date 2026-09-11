import { ShieldCheck } from "lucide-react";
import { LoginForm } from "@/components/auth-forms";
import { BrandLogo } from "@/components/brand-logo";
import { LoginIntro } from "@/components/login-intro";
import { ThemeToggle } from "@/components/theme-toggle";

export const dynamic = "force-dynamic";

function firstParam(value?: string | string[]) {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

function loginMessage(searchParams: Record<string, string | string[] | undefined>) {
  if (firstParam(searchParams.salida)) return "Sesion cerrada correctamente.";
  if (firstParam(searchParams.clave) === "actualizada") return "Clave actualizada. Ya puedes entrar con tu nueva clave.";
  return "";
}

export default function LoginPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  return (
    <main
      className="relative min-h-screen bg-slate-950 px-4 py-8"
      style={{
        backgroundImage:
          "linear-gradient(90deg, rgba(2,6,23,0.82) 0%, rgba(2,6,23,0.6) 46%, rgba(2,6,23,0.32) 100%), url('/prentacion.jpg')",
        backgroundSize: "cover",
        backgroundPosition: "center"
      }}
    >
      <LoginIntro />
      <ThemeToggle className="absolute right-4 top-4 z-20 flex h-10 w-10 items-center justify-center rounded-lg border border-white/20 bg-white/10 text-white backdrop-blur transition hover:bg-white/20" />
      <div className="mx-auto grid min-h-[calc(100vh-4rem)] max-w-5xl items-center gap-8 lg:grid-cols-[1fr_420px]">
        <section className="login-anim login-anim-1">
          <BrandLogo variant="auth" forceDark />
          <p className="mt-6 text-xs font-black uppercase text-copper">Sistema privado Panel360</p>
          <h1 className="mt-2 text-4xl font-black tracking-normal text-white md:text-5xl">Asistente Comercial Automotriz</h1>
          <p className="mt-4 max-w-xl text-base font-semibold leading-7 text-slate-200">
            Modulo independiente para ventas, clientes, cotizaciones, rentabilidad, documentos y Asistente IA 360.
          </p>
          <div className="mt-6 grid gap-3 text-sm font-semibold text-slate-200 sm:grid-cols-2">
            <p className="rounded-lg border border-white/15 bg-white/10 p-4 backdrop-blur-sm">Datos comerciales protegidos por sesion.</p>
            <p className="rounded-lg border border-white/15 bg-white/10 p-4 backdrop-blur-sm">Recuperacion de clave con enlace temporal.</p>
          </div>
        </section>

        <section className="panel login-anim login-anim-2 rounded-lg p-6">
          <p className="flex items-center gap-2 text-xs font-black uppercase text-copper">
            <ShieldCheck className="h-4 w-4" aria-hidden="true" />
            Iniciar sesion
          </p>
          <h2 className="mt-2 text-2xl font-black text-ink dark:text-white">Entra a tu panel</h2>
          <p className="mb-5 mt-2 text-sm font-semibold leading-6 text-steel dark:text-slate-300">Usa tu correo y clave del sistema.</p>
          <LoginForm next={firstParam(searchParams.next)} message={loginMessage(searchParams)} />
        </section>
      </div>
    </main>
  );
}
