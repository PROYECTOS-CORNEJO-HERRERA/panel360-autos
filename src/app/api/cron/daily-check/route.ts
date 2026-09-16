import { NextResponse } from "next/server";
import { verificarCron } from "@/lib/cron-auth";
import { prisma } from "@/lib/prisma";
import { sendBirthdayGreetingEmail, sendCreditRenewalEmail } from "@/lib/services/email";
import { sendTelegramMessage } from "@/lib/services/notifications/telegram";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Traduce lo que respondieron Telegram y Resend a un estado honesto para
// el historial: SENT solo si algo salio de verdad, PARTIAL si un canal
// fallo, FAILED si no llego por ninguno.
function resumirEntrega(
  telegram: { ok: boolean; message?: string } | null,
  correo: { sent: boolean; reason?: string } | null
) {
  const canales: { ok: boolean; detalle: string }[] = [];
  if (telegram) canales.push({ ok: telegram.ok, detalle: `Telegram: ${telegram.ok ? "ok" : telegram.message ?? "fallo"}` });
  if (correo) canales.push({ ok: correo.sent, detalle: `Correo: ${correo.sent ? "ok" : correo.reason ?? "fallo"}` });

  const entregados = canales.filter((c) => c.ok).length;
  const status = entregados === 0 ? "FAILED" : entregados === canales.length ? "SENT" : "PARTIAL";
  const detalle = canales.filter((c) => !c.ok).map((c) => c.detalle).join(" | ");
  return { status, detalle };
}

const RENEWAL_THRESHOLDS = [30, 60, 90, 180]; // días antes del vencimiento (incluyendo 180 días)

export async function GET(request: Request) {
  const noAutorizado = verificarCron(request);
  if (noAutorizado) return noAutorizado;

  const today = new Date();
  const results: string[] = [];
  let notificationsSent = 0;

  // 1. Credit Renewals (30, 60, 90, 180 days thresholds)
  for (const days of RENEWAL_THRESHOLDS) {
    const targetDate = new Date(today);
    targetDate.setDate(targetDate.getDate() + days);

    const start = new Date(targetDate);
    start.setHours(0, 0, 0, 0);
    const end = new Date(targetDate);
    end.setHours(23, 59, 59, 999);

    const credits = await prisma.creditContract.findMany({
      where: { lastInstallmentDate: { gte: start, lte: end } },
      include: { customer: { select: { id: true, firstName: true, lastName: true, rut: true, phone: true, email: true } } }
    });

    for (const credit of credits) {
      const name = `${credit.customer.firstName} ${credit.customer.lastName ?? ""}`.trim();
      const phone = credit.customer.phone ?? "";
      const email = credit.customer.email;
      const rut = credit.customer.rut ?? "Sin RUT";

      const msg = [
        `🔄 <b>RENOVACIÓN EN ${days} DÍAS</b>`,
        `Cliente: <b>${name}</b>`,
        `RUT: ${rut}`,
        phone ? `Teléfono: ${phone}` : "",
        email ? `Email: ${email}` : "",
        `Financiera: ${credit.financialEntity ?? "No registrada"}`,
        credit.installmentAmount ? `Cuota: $${credit.installmentAmount.toLocaleString("es-CL")}` : "",
        `Última cuota: ${credit.lastInstallmentDate?.toLocaleDateString("es-CL") ?? "—"}`,
        ``,
        `💡 Cotiza su renovación en Panel360 Autos`
      ].filter(Boolean).join("\n");

      // El resultado del envio SI importa: antes se descartaba y el
      // historial se escribia como "SENT" pasara lo que pasara. Con el
      // correo mal configurado quedaba un historial lleno de avisos
      // "enviados" que nunca llegaron a nadie.
      const avisoTelegram = await sendTelegramMessage(msg);
      const avisoCorreo = email
        ? await sendCreditRenewalEmail({
            to: email,
            customerName: name,
            vehicleLabel: "tu vehículo actual",
            installmentNumber: (credit.installments ?? 36) - Math.round((days / 30)),
            totalInstallments: credit.installments ?? 36
          })
        : null;

      const entrega = resumirEntrega(avisoTelegram, avisoCorreo);

      await prisma.notificationHistory.create({
        data: {
          channel: "telegram_and_email",
          eventType: "RENOVATION_ALERT",
          message: entrega.detalle ? `${msg}

[${entrega.detalle}]` : msg,
          status: entrega.status
        }
      });

      if (entrega.status !== "FAILED") notificationsSent++;
      results.push(`${name} — ${days}d`);
    }
  }

  // 2. Birthday check (same-day birthdays in Chile)
  const chileNow = new Date(today.toLocaleString("en-US", { timeZone: "America/Santiago" }));
  const todayMonth = chileNow.getMonth() + 1;
  const todayDay = chileNow.getDate();

  const customersWithBirthday = await prisma.customer.findMany({
    where: { birthDate: { not: null } },
    select: { id: true, firstName: true, lastName: true, phone: true, email: true, rut: true, birthDate: true }
  });

  for (const c of customersWithBirthday) {
    if (!c.birthDate) continue;
    const bd = new Date(c.birthDate);
    if (bd.getMonth() + 1 === todayMonth && bd.getDate() === todayDay) {
      const name = `${c.firstName} ${c.lastName ?? ""}`.trim();
      const msg = [
        `🎂 <b>CUMPLEAÑOS HOY</b>`,
        `Cliente: <b>${name}</b>`,
        c.rut ? `RUT: ${c.rut}` : "",
        c.phone ? `Teléfono: ${c.phone}` : "",
        c.email ? `Email: ${c.email}` : "",
        ``,
        `💡 Es un momento ideal para felicitarlo y mantener la relación comercial.`
      ].filter(Boolean).join("\n");

      const avisoTelegram = await sendTelegramMessage(msg);
      const avisoCorreo = c.email ? await sendBirthdayGreetingEmail({ to: c.email, customerName: name }) : null;
      const entrega = resumirEntrega(avisoTelegram, avisoCorreo);

      await prisma.notificationHistory.create({
        data: {
          channel: "telegram_and_email",
          eventType: "BIRTHDAY_ALERT",
          message: entrega.detalle ? `${msg}

[${entrega.detalle}]` : msg,
          status: entrega.status
        }
      });

      if (entrega.status !== "FAILED") notificationsSent++;
      results.push(`🎂 ${name}`);
    }
  }

  return NextResponse.json({
    ok: true,
    notificationsSent,
    results,
    executedAt: new Date().toISOString()
  });
}
