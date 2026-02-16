/**
 * GET: OAuth callback — code в query, обмен на токен и сохранение.
 */
import { NextRequest, NextResponse } from "next/server";
import { Amo } from "@shevernitskiy/amo";
import { saveToken } from "@/lib/tokenStore";

const subdomain = process.env.AMOCRM_SUBDOMAIN ?? "";
const clientId = process.env.AMOCRM_CLIENT_ID ?? "";
const clientSecret = process.env.AMOCRM_CLIENT_SECRET ?? "";
const redirectUri = process.env.AMOCRM_REDIRECT_URI ?? "";

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  if (!code) {
    return NextResponse.redirect(new URL("/?error=no_code", req.url));
  }
  try {
    const amo = new Amo(
      `${subdomain}.amocrm.ru`,
      {
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
        code,
      },
      {
        on_token: async (newToken) => {
          await saveToken({
            access_token: newToken.access_token,
            refresh_token: newToken.refresh_token,
            expires_at: (newToken as { expires_at?: number }).expires_at ?? Math.floor(Date.now() / 1000) + 86400,
          });
        },
      }
    );
    // один запрос чтобы триггернуть обмен кода на токен и on_token
    await amo.account.getAccount();
    return NextResponse.redirect(new URL("/?amo=ok", req.url));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.redirect(new URL(`/?error=${encodeURIComponent(msg)}`, req.url));
  }
}
