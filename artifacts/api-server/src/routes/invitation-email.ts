import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { ReplitConnectors } from "@replit/connectors-sdk";
import {
  SendInvitationEmailBody,
  SendInvitationEmailParams,
  SendInvitationEmailResponse,
} from "@workspace/api-zod";
import { Router, type Request, type Response as ExpressResponse } from "express";

const router = Router();
const connectors = new ReplitConnectors();
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const sender = "Beauty Manager <nao-responda@auth.msstudios.com.br>";

type AuthContext = {
  token: string;
  supabaseUrl: string;
  anonKey: string;
};

type InvitationRow = {
  id: string;
  email: string | null;
  token_hash: string;
  expires_at: string;
  accepted_at: string | null;
  revoked_at: string | null;
};

type SupabaseAdminContext = {
  supabaseUrl: string;
  serviceRoleKey: string;
};

type ResendWebhookEvent = {
  type: string;
  created_at: string;
  data: {
    email_id: string;
  };
};

const resendEventStatuses: Record<string, string> = {
  "email.sent": "sent",
  "email.delivery_delayed": "delayed",
  "email.delivered": "delivered",
  "email.bounced": "bounced",
  "email.failed": "failed",
  "email.complained": "complained",
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

function getSupabaseAdminContext(): SupabaseAdminContext {
  const { supabaseUrl } = getSupabaseConfig();
  const serviceRoleKey =
    process.env.NODE_ENV === "production"
      ? process.env.SUPABASE_SERVICE_ROLE_KEY
      : process.env.E2E_SUPABASE_TEST_SERVICE_ROLE_KEY;

  if (!serviceRoleKey) {
    throw new RouteError("A configuração segura do Supabase não está disponível no servidor.", 503);
  }
  return { supabaseUrl, serviceRoleKey };
}

async function authenticate(req: Request, res: ExpressResponse): Promise<AuthContext | null> {
  const authorization = req.header("authorization") || "";
  const token = authorization.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) {
    res.status(401).json({ error: "Faça login para enviar o convite." });
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

async function supabaseRows<T>(context: AuthContext, resource: string): Promise<T[]> {
  const response = await fetch(`${context.supabaseUrl}/rest/v1/${resource}`, {
    headers: {
      apikey: context.anonKey,
      Authorization: `Bearer ${context.token}`,
      Accept: "application/json",
    },
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) {
    throw new RouteError("Não foi possível validar o convite na organização.", 502);
  }

  const rows = await response.json();
  if (!Array.isArray(rows)) {
    throw new RouteError("A resposta do Supabase para o convite é inválida.", 502);
  }
  return rows as T[];
}

function validateInvitationUrl(rawUrl: string, token: string, requestOrigin: string | undefined): string {
  let url: URL;
  let origin: URL;
  try {
    if (!requestOrigin) throw new Error("Missing origin");
    url = new URL(rawUrl);
    origin = new URL(requestOrigin);
  } catch {
    throw new RouteError("Não foi possível validar o link do convite.", 400);
  }

  const isLocalHttp = url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname);
  if (
    url.origin !== origin.origin ||
    requestOrigin !== origin.origin ||
    (url.protocol !== "https:" && !isLocalHttp) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new RouteError("O link do convite precisa pertencer a este aplicativo.", 400);
  }

  const pathSegments = url.pathname.split("/").filter(Boolean);
  if (
    pathSegments.length < 2 ||
    pathSegments[pathSegments.length - 2] !== "convite" ||
    decodeURIComponent(pathSegments[pathSegments.length - 1] ?? "") !== token
  ) {
    throw new RouteError("O link não corresponde ao token deste convite.", 400);
  }

  return url.toString();
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function verifyResendSignature(
  rawBody: Buffer,
  messageId: string | undefined,
  timestampHeader: string | undefined,
  signatureHeader: string | undefined,
): boolean {
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (!secret || !messageId || messageId.length > 200 || !timestampHeader || !signatureHeader) {
    return false;
  }

  const timestamp = Number(timestampHeader);
  if (!Number.isSafeInteger(timestamp) || Math.abs(Date.now() / 1000 - timestamp) > 300) {
    return false;
  }

  let signingKey: Buffer;
  try {
    const encodedKey = secret.startsWith("whsec_") ? secret.slice(6) : "";
    signingKey = Buffer.from(encodedKey, "base64");
    if (!encodedKey || signingKey.length === 0) return false;
  } catch {
    return false;
  }

  const expected = createHmac("sha256", signingKey)
    .update(`${messageId}.${timestampHeader}.${rawBody.toString("utf8")}`)
    .digest();

  return signatureHeader.split(/\s+/).some((versionedSignature) => {
    const [version, encodedSignature] = versionedSignature.split(",", 2);
    if (version !== "v1" || !encodedSignature) return false;
    let received: Buffer;
    try {
      received = Buffer.from(encodedSignature, "base64");
    } catch {
      return false;
    }
    return received.length === expected.length && timingSafeEqual(received, expected);
  });
}

async function saveResendEmailId(
  admin: SupabaseAdminContext,
  invitationId: string,
  emailId: string,
): Promise<boolean> {
  const query = new URLSearchParams({ id: `eq.${invitationId}` });
  let response: Response;
  try {
    response = await fetch(`${admin.supabaseUrl}/rest/v1/organization_invitations?${query}`, {
      method: "PATCH",
      headers: {
        apikey: admin.serviceRoleKey,
        Authorization: `Bearer ${admin.serviceRoleKey}`,
        "Content-Type": "application/json",
        Prefer: "return=representation",
      },
      body: JSON.stringify({
        resend_email_id: emailId,
        email_delivery_status: "sent",
        email_delivery_updated_at: new Date().toISOString(),
      }),
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    return false;
  }
  if (!response.ok) return false;
  try {
    const rows = await response.json();
    return Array.isArray(rows) && rows.length === 1;
  } catch {
    return false;
  }
}

async function recordResendWebhookEvent(
  admin: SupabaseAdminContext,
  emailId: string,
  status: string,
  eventAt: string,
): Promise<boolean> {
  let response: Response;
  try {
    response = await fetch(
      `${admin.supabaseUrl}/rest/v1/rpc/record_resend_invitation_email_event`,
      {
        method: "POST",
        headers: {
          apikey: admin.serviceRoleKey,
          Authorization: `Bearer ${admin.serviceRoleKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          p_email_id: emailId,
          p_status: status,
          p_event_at: eventAt,
        }),
        signal: AbortSignal.timeout(8000),
      },
    );
  } catch {
    return false;
  }
  return response.ok;
}

router.post("/webhooks/resend", async (req, res): Promise<void> => {
  const rawBody = req.body;
  if (!Buffer.isBuffer(rawBody)) {
    res.status(400).json({ error: "O evento recebido não é válido." });
    return;
  }

  if (!verifyResendSignature(
    rawBody,
    req.header("svix-id"),
    req.header("svix-timestamp"),
    req.header("svix-signature"),
  )) {
    res.status(401).json({ error: "Não foi possível validar o evento." });
    return;
  }

  let event: ResendWebhookEvent;
  try {
    const parsed = JSON.parse(rawBody.toString("utf8")) as Partial<ResendWebhookEvent>;
    if (
      typeof parsed.type !== "string" ||
      typeof parsed.created_at !== "string" ||
      !Number.isFinite(Date.parse(parsed.created_at)) ||
      !parsed.data ||
      typeof parsed.data.email_id !== "string" ||
      !parsed.data.email_id ||
      parsed.data.email_id.length > 255
    ) {
      res.status(400).json({ error: "O evento recebido não é válido." });
      return;
    }
    event = parsed as ResendWebhookEvent;
  } catch {
    res.status(400).json({ error: "O evento recebido não é válido." });
    return;
  }

  const status = resendEventStatuses[event.type];
  if (!status) {
    res.status(200).json({ received: true });
    return;
  }

  try {
    const updated = await recordResendWebhookEvent(
      getSupabaseAdminContext(),
      event.data.email_id,
      status,
      new Date(event.created_at).toISOString(),
    );
    if (!updated) {
      res.status(502).json({ error: "Não foi possível registrar o evento recebido." });
      return;
    }
    res.status(200).json({ received: true });
  } catch {
    res.status(503).json({ error: "Não foi possível processar o evento recebido." });
  }
});

router.post("/invitations/:invitationId/email", async (req, res) => {
  try {
    const params = SendInvitationEmailParams.safeParse(req.params);
    if (!params.success || !uuidPattern.test(params.data.invitationId)) {
      res.status(400).json({ error: "O identificador do convite é inválido." });
      return;
    }

    const body = SendInvitationEmailBody.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: "Os dados do envio do convite são inválidos." });
      return;
    }
    if (!body.data.consentConfirmed) {
      res.status(400).json({ error: "Confirme a autorização para enviar o convite." });
      return;
    }

    const context = await authenticate(req, res);
    if (!context) return;

    const token = body.data.token.trim();
    const tokenHash = createHash("sha256").update(token).digest("hex");
    const query = new URLSearchParams({
      select: "id,email,token_hash,expires_at,accepted_at,revoked_at",
      id: `eq.${params.data.invitationId}`,
      token_hash: `eq.${tokenHash}`,
      limit: "1",
    });
    const [invitation] = await supabaseRows<InvitationRow>(
      context,
      `organization_invitations?${query.toString()}`,
    );

    if (!invitation) {
      res.status(404).json({ error: "Convite não encontrado ou sem permissão para enviá-lo." });
      return;
    }
    if (
      invitation.revoked_at ||
      invitation.accepted_at ||
      !Number.isFinite(Date.parse(invitation.expires_at)) ||
      Date.parse(invitation.expires_at) <= Date.now()
    ) {
      res.status(409).json({ error: "Este convite expirou, foi cancelado ou já foi aceito." });
      return;
    }
    if (!invitation.email?.trim()) {
      res.status(409).json({ error: "Este convite não possui um e-mail de destino." });
      return;
    }

    const admin = getSupabaseAdminContext();
    const invitationUrl = validateInvitationUrl(
      body.data.invitationUrl,
      token,
      req.header("origin"),
    );
    const safeUrl = escapeHtml(invitationUrl);
    const text = [
      "Olá!",
      "",
      "Você recebeu um convite para entrar na equipe do Beauty Manager.",
      `Acesse este link para continuar: ${invitationUrl}`,
      "",
      "Se você não esperava este convite, pode ignorar esta mensagem.",
    ].join("\n");
    const html = [
      '<div style="font-family:Arial,sans-serif;color:#222;line-height:1.6;max-width:560px;margin:0 auto;padding:24px">',
      '<h1 style="font-size:22px">Convite para o Beauty Manager</h1>',
      "<p>Olá! Você recebeu um convite para entrar na equipe do Beauty Manager.</p>",
      `<p style="margin:28px 0"><a href="${safeUrl}" style="background:#c9a94d;color:#151515;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:700">Aceitar convite</a></p>`,
      `<p>Se o botão não abrir, copie este link para o navegador:<br><a href="${safeUrl}">${safeUrl}</a></p>`,
      "<p>Se você não esperava este convite, pode ignorar esta mensagem.</p>",
      "</div>",
    ].join("");

    let resendResponse: Response;
    try {
      resendResponse = await connectors.proxy("resend", "/emails", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": params.data.invitationId,
        },
        body: JSON.stringify({
          from: sender,
          to: invitation.email.trim(),
          subject: "Convite para o Beauty Manager",
          text,
          html,
        }),
      });
    } catch {
      throw new RouteError("Não foi possível conectar ao Resend para enviar o convite.", 502);
    }

    if (resendResponse.status === 429) {
      res.status(429).json({ error: "O limite de envio de e-mails foi atingido. Tente novamente mais tarde." });
      return;
    }
    if (!resendResponse.ok) {
      throw new RouteError(
        resendResponse.status === 401 || resendResponse.status === 403
          ? "O Resend não autorizou o envio. Verifique a conexão e o domínio do remetente."
          : "O Resend recusou o convite. Verifique se o domínio e o endereço remetente estão verificados.",
        502,
      );
    }

    const resendResult = (await resendResponse.json()) as { id?: unknown };
    if (typeof resendResult.id !== "string" || !resendResult.id) {
      throw new RouteError("O Resend não confirmou o envio do convite.", 502);
    }
    if (!(await saveResendEmailId(admin, invitation.id, resendResult.id))) {
      throw new RouteError("O e-mail foi enviado, mas não foi possível atualizar o histórico do convite.", 502);
    }

    res.status(200).json(
      SendInvitationEmailResponse.parse({ emailId: resendResult.id, status: "sent" }),
    );
  } catch (error) {
    if (error instanceof RouteError) {
      res.status(error.statusCode).json({ error: error.message });
      return;
    }
    res.status(502).json({ error: "Não foi possível enviar o convite por e-mail." });
  }
});

export default router;
