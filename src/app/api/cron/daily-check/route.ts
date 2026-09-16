import { NextResponse } from "next/server";
import { verificarCron } from "@/lib/cron-auth";
import { prisma } from "@/lib/prisma";
import { sendBirthdayGreetingEmail, sendCreditRenewalEmail } from "@/lib/services/email";
import { sendTelegramMessage } from "@/lib/services/notifications/telegram";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

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
        `🔄 *RENOVACIÓN EN ${days} DÍAS*`,
        `Cliente: *${name}*`,
        `RUT: ${rut}`,
        phone ? `Teléfono: ${phone}` : "",
        email ? `Email: ${email}` : "",
        `Financiera: ${credit.financialEntity ?? "No registrada"}`,
        credit.installmentAmount ? `Cuota: $${credit.installmentAmount.toLocaleString("es-CL")}` : "",
        `Última cuota: ${credit.lastInstallmentDate?.toLocaleDateString("es-CL") ?? "—"}`,
        ``,
        `💡 Cotiza su renovación en Panel360 Autos`
      ].filter(Boolean).join("\n");

      // Dispatch Telegram notification
      await sendTelegramMessage(msg);

      // Dispatch Resend Email if email present
      if (email) {
        await sendCreditRenewalEmail({
          to: email,
          customerName: name,
          vehicleLabel: "tu vehículo actual",
          installmentNumber: (credit.installments ?? 36) - Math.round((days / 30)),
          totalInstallments: credit.installments ?? 36
        });
      }

      await prisma.notificationHistory.create({
        data: {
          channel: "telegram_and_email",
          eventType: "RENOVATION_ALERT",
          message: msg,
          status: "SENT"
        }
      });

      notificationsSent++;
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
        `🎂 *CUMPLEAÑOS HOY*`,
        `Cliente: *${name}*`,
        c.rut ? `RUT: ${c.rut}` : "",
        c.phone ? `Teléfono: ${c.phone}` : "",
        c.email ? `Email: ${c.email}` : "",
        ``,
        `💡 Es un momento ideal para felicitarlo y mantener la relación comercial.`
      ].filter(Boolean).join("\n");

      // Telegram dispatch
      await sendTelegramMessage(msg);

      // Resend Email dispatch if customer email present
      if (c.email) {
        await sendBirthdayGreetingEmail({
          to: c.email,
          customerName: name
        });
      }

      await prisma.notificationHistory.create({
        data: {
          channel: "telegram_and_email",
          eventType: "BIRTHDAY_ALERT",
          message: msg,
          status: "SENT"
        }
      });

      notificationsSent++;
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
