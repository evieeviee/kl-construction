export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    const json = (data, status = 200) =>
      new Response(JSON.stringify(data), {
        status,
        headers: {
          "content-type": "application/json;charset=UTF-8",
          "cache-control": "no-store"
        }
      });

    // ================================
    // GET WEBSITE CONTENT
    // ================================
    if (url.pathname === "/api/content" && request.method === "GET") {
      try {
        const row = await env.DB
          .prepare("SELECT value FROM site_content WHERE key = ?")
          .bind("main")
          .first();

        return json({
          content: row ? JSON.parse(row.value) : null
        });
      } catch (error) {
        return json(
          {
            error: "Unable to load website content",
            details: error.message
          },
          500
        );
      }
    }

    // ================================
    // SAVE / PUBLISH WEBSITE CONTENT
    // ================================
    if (url.pathname === "/api/content" && request.method === "PUT") {
      if (!isAdmin(request, env)) {
        return json({ error: "Unauthorized" }, 401);
      }

      let body;

      try {
        body = await request.json();
      } catch {
        return json({ error: "Invalid JSON" }, 400);
      }

      if (!body || typeof body.content !== "object") {
        return json({ error: "Missing content" }, 400);
      }

      try {
        await env.DB
          .prepare(`
            INSERT INTO site_content (
              key,
              value,
              updated_at
            )
            VALUES (?, ?, datetime('now'))

            ON CONFLICT(key)
            DO UPDATE SET
              value = excluded.value,
              updated_at = datetime('now')
          `)
          .bind("main", JSON.stringify(body.content))
          .run();

        return json({
          ok: true,
          message: "Website content published successfully"
        });
      } catch (error) {
        return json(
          {
            error: "Unable to save website content",
            details: error.message
          },
          500
        );
      }
    }

    // ================================
    // IMAGE UPLOAD
    // ================================
    if (url.pathname === "/api/upload" && request.method === "POST") {
      if (!isAdmin(request, env)) {
        return json({ error: "Unauthorized" }, 401);
      }

      // R2 hasn't been connected yet
      if (!env.MEDIA_BUCKET) {
        return json(
          {
            error: "Image storage is not configured yet"
          },
          503
        );
      }

      try {
        const form = await request.formData();
        const file = form.get("file");

        if (!(file instanceof File)) {
          return json({ error: "No image selected" }, 400);
        }

        if (!file.type.startsWith("image/")) {
          return json({ error: "Only image files are allowed" }, 400);
        }

        // Maximum 8 MB
        if (file.size > 8 * 1024 * 1024) {
          return json(
            {
              error: "Image is too large. Maximum size is 8 MB."
            },
            413
          );
        }

        const extension = (
          file.name.split(".").pop() || "jpg"
        )
          .replace(/[^a-z0-9]/gi, "")
          .toLowerCase();

        const key =
          "uploads/" +
          Date.now() +
          "-" +
          crypto.randomUUID() +
          "." +
          extension;

        await env.MEDIA_BUCKET.put(
          key,
          file.stream(),
          {
            httpMetadata: {
              contentType: file.type,
              cacheControl: "public, max-age=31536000"
            }
          }
        );

        return json({
          ok: true,
          url: "/media/" + key
        });
      } catch (error) {
        return json(
          {
            error: "Image upload failed",
            details: error.message
          },
          500
        );
      }
    }

    // ================================
    // SERVE IMAGES FROM R2
    // ================================
    if (
      url.pathname.startsWith("/media/") &&
      request.method === "GET"
    ) {
      if (!env.MEDIA_BUCKET) {
        return new Response("Image storage not configured", {
          status: 503
        });
      }

      const key = url.pathname.slice("/media/".length);

      const object = await env.MEDIA_BUCKET.get(key);

      if (!object) {
        return new Response("Image not found", {
          status: 404
        });
      }

      const headers = new Headers();

      object.writeHttpMetadata(headers);

      headers.set("etag", object.httpEtag);
      headers.set(
        "cache-control",
        "public, max-age=31536000"
      );

      return new Response(object.body, {
        headers
      });
    }

    // ================================
    // STATIC WEBSITE
    // index.html / admin.html / assets
    // ================================
    if (env.ASSETS) {
      return env.ASSETS.fetch(request);
    }

    return new Response("Not found", {
      status: 404
    });
  }
};


// ====================================
// ADMIN AUTHENTICATION
// ====================================

function isAdmin(request, env) {
  const auth =
    request.headers.get("Authorization") || "";

  return (
    !!env.ADMIN_TOKEN &&
    auth === `Bearer ${env.ADMIN_TOKEN}`
  );
}
