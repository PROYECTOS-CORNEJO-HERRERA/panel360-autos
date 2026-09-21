"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import {
  TrendingUp,
  BadgeDollarSign,
  Bell,
  BookOpen,
  Calculator,
  CalendarDays,
  CarFront,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  CreditCard,
  FileSpreadsheet,
  FileText,
  Gauge,
  History,
  Info,
  Instagram,
  LayoutDashboard,
  LogOut,
  Menu,
  MessageSquareText,
  Moon,
  RefreshCw,
  Search,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Sun,
  UserCircle2,
  UsersRound,
  Wrench,
  X
} from "lucide-react";
import clsx from "clsx";
import { BrandLogo } from "@/components/brand-logo";
import { VitokoAssistant } from "@/components/vitoko-assistant";
import { logoutAction } from "@/lib/actions/auth";
import { useDealContext } from "@/lib/deal-context";

type NavItem = {
  href: string;
  label: string;
  icon: React.ElementType;
  badge?: string;
};

type NavSection = {
  title: string;
  items: NavItem[];
};

const navSections: NavSection[] = [
  {
    title: "INICIO",
    items: [{ href: "/", label: "Dashboard", icon: LayoutDashboard }]
  },
  {
    title: "CLIENTES Y OPORTUNIDADES",
    items: [
      { href: "/clientes", label: "Clientes (Ficha 360)", icon: UsersRound },
      { href: "/cliente-frente-a-mi", label: "Cliente frente a mí", icon: Gauge },
      { href: "/agenda", label: "Seguimientos", icon: CalendarDays },
      { href: "/renovaciones", label: "Renovaciones", icon: RefreshCw, badge: "NUEVO" }
    ]
  },
  {
    title: "PRODUCTO",
    items: [
      { href: "/vehiculos", label: "Vehículos", icon: CarFront },
      { href: "/comparador", label: "Comparador", icon: SlidersHorizontal }
    ]
  },
  {
    title: "VENTA",
    items: [
      { href: "/cotizador", label: "Cotizador", icon: ClipboardCheck },
      { href: "/rentabilidad", label: "Rentabilidad", icon: Calculator },
      { href: "/creditos", label: "Créditos / Amicar", icon: CreditCard },
      { href: "/cierre-venta", label: "Cierre de Venta", icon: CheckCircle2, badge: "NUEVO" },
      { href: "/whatsapp", label: "WhatsApp / Contacto", icon: MessageSquareText }
    ]
  },
  {
    // Todo lo que ENTRA al sistema desde un archivo de la marca vive aqui,
    // separado de lo que se consulta. Antes la carga estaba escondida
    // dentro de "Actualizacion Comercial" (un nombre que no dice subir) y
    // "Listas de Precios" del menu llevaba al historial de cambios, no a
    // cargar una lista.
    title: "CARGAR DOCUMENTOS",
    items: [
      { href: "/cargar/listas-precios", label: "Listas de precios", icon: FileSpreadsheet },
      { href: "/cargar/acciones-comerciales", label: "Acciones comerciales", icon: BadgeDollarSign },
      { href: "/actualizaciones", label: "Revisar y aprobar cargas", icon: Bell }
    ]
  },
  {
    title: "INTELIGENCIA COMERCIAL",
    items: [
      { href: "/cambios", label: "¿Qué cambió este mes?", icon: TrendingUp },
      { href: "/ayudas-comerciales", label: "Acciones comerciales vigentes", icon: BadgeDollarSign },
      { href: "/historial-precios", label: "Historial de precios", icon: History },
      { href: "/documentos", label: "Documentos guardados", icon: FileText },
      { href: "/promociones", label: "Promociones", icon: Sparkles }
    ]
  },
  {
    title: "MARKETING",
    items: [{ href: "/publicaciones", label: "Publicaciones Instagram", icon: Instagram, badge: "NUEVO" }]
  },
  {
    title: "CONOCIMIENTO",
    items: [{ href: "/aprender", label: "Aprender", icon: BookOpen }]
  },
  {
    title: "ADMINISTRACIÓN",
    items: [
      { href: "/admin/importar-clientes", label: "Importar Clientes", icon: FileSpreadsheet, badge: "NUEVO" },
      { href: "/configuracion/telegram", label: "Notificaciones", icon: Settings },
      { href: "/configuracion/instagram", label: "Instagram", icon: Instagram },
      { href: "/admin", label: "Administración", icon: Wrench }
    ]
  }
];

export function AppShell({
  children,
  user
}: {
  children: React.ReactNode;
  user?: { name: string; email: string; role: string } | null;
}) {
  const pathname = usePathname();
  const isAuthPage = pathname === "/login" || pathname.startsWith("/recuperar-clave");

  const [isCollapsed, setIsCollapsed] = useState(false);
  const [isMobileOpen, setIsMobileOpen] = useState(false);
  const [isDark, setIsDark] = useState(false);
  const { context } = useDealContext();

  useEffect(() => {
    const savedCollapsed = localStorage.getItem("panel360_sidebar_collapsed");
    if (savedCollapsed === "true") {
      setIsCollapsed(true);
    }

    const savedTheme = localStorage.getItem("panel360_theme");
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    const shouldBeDark = savedTheme === "dark" || (!savedTheme && prefersDark);

    setIsDark(shouldBeDark);
    if (shouldBeDark) {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
  }, []);

  function toggleSidebar() {
    const nextState = !isCollapsed;
    setIsCollapsed(nextState);
    localStorage.setItem("panel360_sidebar_collapsed", String(nextState));
  }

  function toggleTheme() {
    const nextTheme = !isDark;
    setIsDark(nextTheme);
    localStorage.setItem("panel360_theme", nextTheme ? "dark" : "light");
    if (nextTheme) {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
  }

  if (isAuthPage) {
    return <>{children}</>;
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      {/* DESKTOP SIDEBAR */}
      <aside
        className={clsx(
          "fixed inset-y-0 left-0 z-30 hidden border-r border-slate-200 bg-white/90 backdrop-blur-xl transition-all duration-300 dark:border-slate-800 dark:bg-slate-900/90 lg:flex lg:flex-col",
          isCollapsed ? "w-20 px-2 py-5" : "w-72 px-4 py-5"
        )}
      >
        <div className="flex items-center justify-between gap-2">
          <Link href="/" className="block min-w-0 rounded-lg px-2 py-1 transition hover:bg-slate-100 dark:hover:bg-slate-800">
            <BrandLogo />
          </Link>
          <button
            type="button"
            onClick={toggleSidebar}
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-slate-600 transition hover:bg-slate-100 hover:text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700 dark:hover:text-white"
            title={isCollapsed ? "Expandir menú" : "Contraer menú"}
            aria-label={isCollapsed ? "Expandir menú" : "Contraer menú"}
          >
            {isCollapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
          </button>
        </div>

        {/* ACTIVE DEAL CONTEXT BADGE IF PRESENT */}
        {context.customerName && !isCollapsed ? (
          <div className="mt-3 rounded-lg border border-teal-500/30 bg-teal-50/60 p-2.5 dark:border-teal-800 dark:bg-teal-950/40">
            <p className="flex items-center gap-1.5 text-[10px] font-black uppercase text-teal-700 dark:text-teal-400">
              <ShieldCheck className="h-3.5 w-3.5" />
              Cliente Activo
            </p>
            <p className="mt-0.5 truncate text-xs font-extrabold text-slate-900 dark:text-white">{context.customerName}</p>
            {context.vehicleLabel ? <p className="truncate text-[11px] font-medium text-slate-500 dark:text-slate-400">{context.vehicleLabel}</p> : null}
          </div>
        ) : null}

        <nav className="mt-4 flex-1 space-y-4 overflow-y-auto pr-1" aria-label="Navegación principal">
          {navSections.map((section) => (
            <div key={section.title} className="space-y-1">
              {!isCollapsed && (
                <p className="px-3 text-[10px] font-black uppercase tracking-wider text-slate-400 dark:text-slate-500">
                  {section.title}
                </p>
              )}
              {section.items.map((item) => {
                const active = pathname === item.href || (item.href !== "/" && pathname.startsWith(item.href));
                const Icon = item.icon;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    title={isCollapsed ? item.label : undefined}
                    className={clsx(
                      "flex items-center gap-3 rounded-lg py-2 text-xs font-bold transition",
                      isCollapsed ? "justify-center px-2" : "px-3",
                      active
                        ? "bg-slate-900 text-white shadow-md dark:bg-teal-600 dark:text-white"
                        : "text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
                    )}
                  >
                    <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                    {!isCollapsed && (
                      <span className="flex flex-1 items-center justify-between truncate">
                        <span className="truncate">{item.label}</span>
                        {item.badge ? (
                          <span className="rounded bg-teal-500/20 px-1.5 py-0.5 text-[9px] font-black text-teal-700 dark:text-teal-300">
                            {item.badge}
                          </span>
                        ) : null}
                      </span>
                    )}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>

        {/* User Footer */}
        <div
          className={clsx(
            "mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-900/60",
            isCollapsed ? "text-center" : ""
          )}
        >
          {!isCollapsed && (
            <>
              <p className="flex items-center gap-2 text-sm font-black text-slate-900 dark:text-white">
                <UserCircle2 className="h-4 w-4 text-teal-600 dark:text-teal-400" aria-hidden="true" />
                <span className="truncate">{user?.name ?? "Usuario"}</span>
              </p>
              <p className="mt-0.5 truncate text-xs font-medium text-slate-500 dark:text-slate-400">{user?.email ?? ""}</p>
            </>
          )}

          <div className={clsx("flex items-center gap-2", isCollapsed ? "flex-col" : "mt-2")}>
            <form action={logoutAction} className="w-full">
              <button
                type="submit"
                className={clsx(
                  "flex w-full items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white py-1.5 text-xs font-bold text-slate-700 shadow-sm transition hover:bg-slate-100 hover:text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700",
                  isCollapsed ? "px-0" : "px-3"
                )}
                title="Cerrar sesión"
              >
                <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
                {!isCollapsed && <span>Salir</span>}
              </button>
            </form>
          </div>
        </div>

        {!isCollapsed && (
          <p className="mt-3 px-1 text-center text-[10px] font-semibold leading-tight text-slate-400 dark:text-slate-500">
            Sistema creado por Víctor Herrera
          </p>
        )}
      </aside>

      {/* MOBILE DRAWER OVERLAY */}
      {isMobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={() => setIsMobileOpen(false)} />
          <aside className="fixed inset-y-0 left-0 w-80 max-w-[calc(100vw-3rem)] border-r border-slate-200 bg-white p-5 shadow-2xl dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-center justify-between">
              <BrandLogo />
              <button
                type="button"
                onClick={() => setIsMobileOpen(false)}
                className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
                aria-label="Cerrar menú"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <nav className="mt-4 space-y-4 overflow-y-auto max-h-[calc(100vh-10rem)]">
              {navSections.map((section) => (
                <div key={section.title} className="space-y-1">
                  <p className="px-3 text-[10px] font-black uppercase tracking-wider text-slate-400 dark:text-slate-500">
                    {section.title}
                  </p>
                  {section.items.map((item) => {
                    const active = pathname === item.href || (item.href !== "/" && pathname.startsWith(item.href));
                    const Icon = item.icon;
                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        onClick={() => setIsMobileOpen(false)}
                        className={clsx(
                          "flex items-center gap-3 rounded-lg px-3 py-2 text-xs font-bold transition",
                          active
                            ? "bg-slate-900 text-white dark:bg-teal-600"
                            : "text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
                        )}
                      >
                        <Icon className="h-4 w-4" />
                        <span className="flex flex-1 items-center justify-between">
                          <span>{item.label}</span>
                          {item.badge ? (
                            <span className="rounded bg-teal-500/20 px-1.5 py-0.5 text-[9px] font-black text-teal-700 dark:text-teal-300">
                              {item.badge}
                            </span>
                          ) : null}
                        </span>
                      </Link>
                    );
                  })}
                </div>
              ))}
            </nav>
          </aside>
        </div>
      )}

      {/* TOP HEADER */}
      <header className="sticky top-0 z-20 border-b border-slate-200/80 bg-white/80 px-4 py-3 backdrop-blur-md dark:border-slate-800/80 dark:bg-slate-900/80 sm:px-6">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setIsMobileOpen(true)}
              className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-slate-700 transition hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700 lg:hidden"
              aria-label="Abrir menú móvil"
            >
              <Menu className="h-5 w-5" />
            </button>

            <Link href="/" className="lg:hidden">
              <BrandLogo variant="mobile" />
            </Link>
          </div>

          <div className="flex items-center gap-2">
            <Link
              href="/buscar"
              className="flex h-9 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-xs font-bold text-slate-700 shadow-sm transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
              aria-label="Buscar en el catálogo"
            >
              <Search className="h-3.5 w-3.5 text-slate-400" />
              <span className="hidden sm:inline">Buscar...</span>
            </Link>

            <button
              type="button"
              onClick={toggleTheme}
              className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-700 shadow-sm transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-amber-400 dark:hover:bg-slate-700"
              title={isDark ? "Cambiar a Modo Claro" : "Cambiar a Modo Oscuro"}
              aria-label={isDark ? "Cambiar a Modo Claro" : "Cambiar a Modo Oscuro"}
            >
              {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </button>
          </div>
        </div>
      </header>

      {/* MAIN CONTENT AREA */}
      <div className={clsx("app-content-wrap transition-all duration-300", isCollapsed ? "lg:pl-20" : "lg:pl-72")}>
        <main className="mx-auto min-h-[calc(100vh-4rem)] w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          {children}
        </main>
      </div>

      {/* VITOKO IA FLOATING MASCOT */}
      <VitokoAssistant />
    </div>
  );
}
