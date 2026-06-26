/**
 * GET: OAuth callback — code в query, обмен на токен и сохранение.
 */
import { NextRequest, NextResponse } from "next/server";
import { Amo } from "@shevernitskiy/amo";
import { saveToken } from "@/lib/tokenStore";
import { getAmoApiDomain, getAmoCredentials } from "@/lib/amo/config";

const { clientId, clientSecret, redirectUri } = getAmoCredentials();

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  if (!code) {
    return NextResponse.redirect(new URL("/?error=no_code", req.url));
  }
  try {
    const amo = new Amo(
      getAmoApiDomain(),
      {
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
        code,
      },
      {
        on_token: async (newToken) => {
          const exp = (newToken as { expires_at?: number }).expires_at;
          await saveToken({
            access_token: newToken.access_token,
            refresh_token: newToken.refresh_token,
            expires_at: exp != null ? exp : Date.now() + 86400 * 1000,
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
