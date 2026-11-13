import { createHash } from "node:crypto";
import { ReplitConnectors } from "@replit/connectors-sdk";
import { Router, type Request, type Response as ExpressResponse } from "express";

const router = Router();

type AppointmentRow = {
  id: string;
  date: string;
  time: string;
  client: string;
  professional_id: string;
  service: string;
  duration: number;
  status: string;
};

type AuthContext = {
  token: string;
  supabaseUrl: string;
  anonKey: string;
};

type GoogleEventResult = {
  id?: string;
  htmlLink?: string;
};

class RouteError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
  ) {
    super(message);
  }
}

function getSupabaseConfig(): Pick<AuthContext, "supabaseUrl" | "anonKey"> {
  const rawUrl = process.env.VITE_SUPABASE_URL;
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY;
  if (!rawUrl || !anonKey) {
    throw new RouteError("A configuração do Supabase não está disponível no servidor.", 503);
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(rawUrl);
  } catch {
    throw new RouteError("A URL do Supabase configurada no servidor é inválida.", 503);
  }

  if (parsedUrl.protocol !== "https:" && parsedUrl.hostname !== "localhost") {
    throw new RouteError("A URL do Supabase configurada no servidor deve usar HTTPS.", 503);
  }

  return { supabaseUrl: parsedUrl.origin, anonKey };
}

async function authenticate(req: Request, res: ExpressResponse): Promise<AuthContext | null> {
  const authorization = req.header("authorization") || "";
  const token = authorization.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) {
    res.status(401).json({ error: "Faça login para sincronizar o Google Agenda." });
    return null;
  }

  const config = getSupabaseConfig();
  const response = await fetch(`${config.supabaseUrl}/auth/v1/user`, {
    headers: {
      apikey: config.anonKey,
      Authorization: `Bearer ${token}`,
    },
    signal: AbortSignal.timeout(8000),
  });

  if (response.status === 401 || response.status === 403) {
    res.status(401).json({ error: "Sua sessão expirou. Entre novamente." });
    return null;
  }
  if (!response.ok) {
    throw new RouteError("Não foi possível validar sua sessão do Supabase.", 502);
  }

  const user = (await response.json()) as { id?: unknown };
  if (typeof user.id !== "string" || !user.id) {
    res.status(401).json({ error: "Não foi possível validar sua sessão." });
    return null;
  }

  return { token, ...config };
}

async function supabaseRows<T>(
  context: AuthContext,
  resource: string,
): Promise<T[]> {
  const response = await fetch(`${context.supabaseUrl}/rest/v1/${resource}`, {
    headers: {
      apikey: context.anonKey,
      Authorization: `Bearer ${context.token}`,
      Accept: "application/json",
    },
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) {
    if (response.status === 401) {
      throw new RouteError("Sua sessão expirou. Entre novamente.", 401);
    }
    throw new RouteError("Não foi possível consultar os agendamentos autorizados.", 502);
  }

  const rows = (await response.json()) as unknown;
  if (!Array.isArray(rows)) {
    throw new RouteError("O Supabase retornou uma resposta inválida.", 502);
  }
  return rows as T[];
}

async function getAppointment(context: AuthContext, appointmentId: string): Promise<AppointmentRow | null> {
  const query = new URLSearchParams({
    select: "id,date,time,client,professional_id,service,duration,status",
    id: `eq.${appointmentId}`,
    limit: "1",
  });
  const rows = await supabaseRows<AppointmentRow>(context, `appointments?${query.toString()}`);
  return rows[0] ?? null;
}

function googleEventId(appointmentId: string): string {
  return createHash("sha256").update(appointmentId).digest("hex");
}

function localDateTime(date: string, time: string, duration: number): {
  start: { dateTime: string; timeZone: string };
  end: { dateTime: string; timeZone: string };
} {
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const timeMatch = /^(\d{2}):(\d{2})(?::\d{2})?$/.exec(time);
  if (!dateMatch || !timeMatch || !Number.isInteger(duration) || duration < 1 || duration > 1440) {
    throw new RouteError("O agendamento tem data, horário ou duração inválidos.", 422);
  }

  const [, yearText, monthText, dayText] = dateMatch;
  const [, hourText, minuteText] = timeMatch;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const startMillis = Date.UTC(year, month - 1, day, hour, minute);
  const check = new Date(startMillis);

  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day ||
    hour > 23 ||
    minute > 59
  ) {
    throw new RouteError("O agendamento tem data ou horário inválidos.", 422);
  }

  const toRfc3339 = (millis: number) => {
    const value = new Date(millis);
    const pad = (part: number) => String(part).padStart(2, "0");
    return `${value.getUTCFullYear()}-${pad(value.getUTCMonth() + 1)}-${pad(value.getUTCDate())}T${pad(value.getUTCHours())}:${pad(value.getUTCMinutes())}:00-03:00`;
  };

  return {
    start: { dateTime: toRfc3339(startMillis), timeZone: "America/Sao_Paulo" },
    end: { dateTime: toRfc3339(startMillis + duration * 60_000), timeZone: "America/Sao_Paulo" },
  };
}

function toGoogleEvent(appointment: AppointmentRow, includeId: boolean) {
  const cancelled = appointment.status === "cancelled";
  const summary = `${cancelled ? "[CANCELADO] " : ""}Beauty Manager | ${appointment.client}`.slice(0, 250);
  const event = {
    summary,
    description: [
      "Agendamento criado pelo Beauty Manager.",
      `Serviço: ${appointment.service}`,
      `Duração: ${appointment.duration} minutos`,
    ].join("\n"),
    ...localDateTime(appointment.date, appointment.time, Number(appointment.duration)),
    visibility: "private",
    transparency: cancelled ? "transparent" : "opaque",
    extendedProperties: {
      private: {
        source: "barber-manager",
        appointmentId: appointment.id,
      },
    },
  };

  return includeId ? { id: googleEventId(appointment.id), ...event } : event;
}

async function googleRequest(
  path: string,
  method: "GET" | "POST" | "PATCH" | "DELETE",
  body?: Record<string, unknown>,
): Promise<Response> {
  const connectors = new ReplitConnectors();
  return connectors.proxy("google-calendar", path, {
    method,
    ...(body ? {
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    } : {}),
  });
}

async function readEventResponse(response: Response): Promise<GoogleEventResult> {
  if (!response.ok) {
    throw new RouteError(`O Google Calendar retornou HTTP ${response.status}.`, 502);
  }
  const result = (await response.json().catch(() => ({}))) as GoogleEventResult;
  return result;
}

async function upsertGoogleEvent(appointment: AppointmentRow): Promise<GoogleEventResult> {
  const eventId = googleEventId(appointment.id);
  const encodedEventId = encodeURIComponent(eventId);
  const existing = await googleRequest(
    `/calendar/v3/calendars/primary/events/${encodedEventId}?fields=id,status`,
    "GET",
  );

  if (existing.ok) {
    const update = await googleRequest(
      `/calendar/v3/calendars/primary/events/${encodedEventId}?sendUpdates=none`,
      "PATCH",
      toGoogleEvent(appointment, false),
    );
    return readEventResponse(update);
  }
  if (existing.status !== 404) {
    throw new RouteError(`O Google Calendar retornou HTTP ${existing.status}.`, 502);
  }

  const created = await googleRequest(
    "/calendar/v3/calendars/primary/events?sendUpdates=none",
    "POST",
    toGoogleEvent(appointment, true),
  );
  if (created.status === 409) {
    const update = await googleRequest(
      `/calendar/v3/calendars/primary/events/${encodedEventId}?sendUpdates=none`,
      "PATCH",
      toGoogleEvent(appointment, false),
    );
    return readEventResponse(update);
  }
  return readEventResponse(created);
}

async function deleteGoogleEvent(appointmentId: string): Promise<void> {
  const response = await googleRequest(
    `/calendar/v3/calendars/primary/events/${encodeURIComponent(googleEventId(appointmentId))}?sendUpdates=none`,
    "DELETE",
  );
  if (!response.ok && response.status !== 404 && response.status !== 410) {
    throw new RouteError(`O Google Calendar retornou HTTP ${response.status}.`, 502);
  }
}

function handleRouteError(req: Request, res: ExpressResponse, error: unknown, operation: string): void {
  if (error instanceof RouteError) {
    if (error.statusCode >= 500) req.log.error({ err: error }, operation);
    res.status(error.statusCode).json({ error: error.message });
    return;
  }

  req.log.error({ err: error }, operation);
  res.status(502).json({ error: "Não foi possível concluir a operação no Google Calendar." });
}

router.post("/google-calendar/appointments/:id/sync", async (req, res): Promise<void> => {
  try {
    const context = await authenticate(req, res);
    if (!context) return;

    const appointmentId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    if (!/^[a-zA-Z0-9_-]{1,80}$/.test(appointmentId)) {
      res.status(400).json({ error: "Identificador de agendamento inválido." });
      return;
    }

    const appointment = await getAppointment(context, appointmentId);
    if (!appointment) {
      res.status(404).json({ error: "Agendamento não encontrado ou sem permissão de acesso." });
      return;
    }

    const event = await upsertGoogleEvent(appointment);
    res.json({ synced: true, eventLink: event.htmlLink ?? null });
  } catch (error) {
    handleRouteError(req, res, error, "Google Calendar appointment sync failed");
  }
});

router.post("/google-calendar/sync", async (req, res): Promise<void> => {
  try {
    const context = await authenticate(req, res);
    if (!context) return;

    const rawIds = req.body?.appointmentIds;
    if (
      !Array.isArray(rawIds) ||
      rawIds.length < 1 ||
      rawIds.length > 100 ||
      rawIds.some((id: unknown) => typeof id !== "string" || !/^[a-zA-Z0-9_-]{1,80}$/.test(id))
    ) {
      res.status(400).json({ error: "Envie de 1 a 100 identificadores válidos de agendamento." });
      return;
    }

    const ids = [...new Set(rawIds as string[])];
    const query = new URLSearchParams({
      select: "id,date,time,client,professional_id,service,duration,status",
      id: `in.(${ids.join(",")})`,
      limit: String(ids.length),
    });
    const appointments = await supabaseRows<AppointmentRow>(context, `appointments?${query.toString()}`);
    const appointmentById = new Map(appointments.map((appointment) => [appointment.id, appointment]));
    const failed: Array<{ appointmentId: string; error: string }> = [];
    let syncedCount = 0;

    for (const appointmentId of ids) {
      const appointment = appointmentById.get(appointmentId);
      if (!appointment) {
        failed.push({ appointmentId, error: "Agendamento não encontrado ou sem permissão de acesso." });
        continue;
      }
      try {
        await upsertGoogleEvent(appointment);
        syncedCount += 1;
      } catch (error) {
        failed.push({
          appointmentId,
          error: error instanceof RouteError
            ? error.message
            : "Não foi possível sincronizar este agendamento.",
        });
      }
    }

    res.json({ syncedCount, failed });
  } catch (error) {
    handleRouteError(req, res, error, "Google Calendar batch sync failed");
  }
});

router.delete("/google-calendar/appointments/:id", async (req, res): Promise<void> => {
  try {
    const context = await authenticate(req, res);
    if (!context) return;

    const appointmentId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    if (!/^[a-zA-Z0-9_-]{1,80}$/.test(appointmentId)) {
      res.status(400).json({ error: "Identificador de agendamento inválido." });
      return;
    }

    const appointment = await getAppointment(context, appointmentId);
    if (!appointment) {
      res.status(404).json({ error: "Agendamento não encontrado ou sem permissão de acesso." });
      return;
    }

    await deleteGoogleEvent(appointment.id);
    res.status(204).end();
  } catch (error) {
    handleRouteError(req, res, error, "Google Calendar appointment delete failed");
  }
});

export default router;