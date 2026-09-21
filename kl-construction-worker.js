// ==========================================
// ADMIN LOGIN
// ==========================================
if (
  url.pathname === "/api/auth" &&
  request.method === "POST"
) {
  try {

    // First check Authorization header
    const authorization =
      request.headers.get("Authorization") || "";

    let token = "";

    if (authorization.startsWith("Bearer ")) {
      token = authorization.slice(7).trim();
    }

    // Also support JSON body as fallback
    if (!token) {
      try {
        const body = await request.json();

        token =
          body?.token ||
          body?.password ||
          "";
      } catch {
        // No JSON body is okay
      }
    }

    if (!env.ADMIN_TOKEN) {
      return json(
        {
          ok: false,
          error: "Admin authentication is not configured."
        },
        500
      );
    }

    if (!token || token !== env.ADMIN_TOKEN) {
      return json(
        {
          ok: false,
          error: "Incorrect password."
        },
        401
      );
    }

    return json({
      ok: true,
      message: "Login successful."
    });

  } catch (error) {
    return json(
      {
        ok: false,
        error: "Unable to verify login."
      },
      500
    );
  }
}
