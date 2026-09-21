export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // ==========================================
    // JSON RESPONSE HELPER
    // ==========================================
    const json = (data, status = 200) =>
      new Response(JSON.stringify(data), {
        status,
        headers: {
          "content-type": "application/json; charset=UTF-8",
          "cache-control": "no-store"
        }
      });


    // ==========================================
    // ADMIN LOGIN
    // ==========================================
    if (url.pathname === "/api/auth" && request.method === "POST") {
      try {
        const body = await request.json();

        const token =
          body?.token ||
          body?.password ||
          "";

        if (!env.ADMIN_TOKEN) {
          return json(
            {
              ok: false,
              error: "Admin authentication is not configured."
            },
            500
          );
        }

        if (token !== env.ADMIN_TOKEN) {
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
          400
        );
      }
    }


    // ==========================================
    // GET WEBSITE CONTENT
    // ==========================================
    if (
      url.pathname === "/api/content" &&
      request.method === "GET"
    ) {
      try {
        const row = await env.DB
          .prepare(
            "SELECT value FROM site_content WHERE key = ?"
          )
          .bind("main")
          .first();

        return json({
          content: row
            ? JSON.parse(row.value)
            : null
        });

      } catch (error) {
        return json(
          {
            error: "Unable to load website content.",
            details: error.message
          },
          500
        );
      }
    }


    // ==========================================
    // SAVE / PUBLISH WEBSITE CONTENT
    // ==========================================
    if (
      url.pathname === "/api/content" &&
      request.method === "PUT"
    ) {
      if (!isAdmin(request, env)) {
        return json(
          {
            error: "Unauthorized"
          },
          401
        );
      }

      let body;

      try {
        body = await request.json();
      } catch {
        return json(
          {
            error: "Invalid content data."
          },
          400
        );
      }

      if (
        !body ||
        typeof body.content !== "object" ||
        body.content === null
      ) {
        return json(
          {
            error: "Missing website content."
          },
          400
        );
      }

      try {
        await env.DB
          .prepare(`
            INSERT INTO site_content (
              key,
              value,
              updated_at
            )
            VALUES (
              ?,
              ?,
              datetime('now')
            )

            ON CONFLICT(key)
            DO UPDATE SET
              value = excluded.value,
              updated_at = datetime('now')
          `)
          .bind(
            "main",
            JSON.stringify(body.content)
          )
          .run();

        return json({
          ok: true,
          message: "Website updated successfully."
        });

      } catch (error) {
        return json(
          {
            error: "Unable to save website content.",
            details: error.message
          },
          500
        );
      }
    }


    // ==========================================
    // IMAGE UPLOAD
    // ==========================================
    if (
      url.pathname === "/api/upload" &&
      request.method === "POST"
    ) {
      if (!isAdmin(request, env)) {
        return json(
          {
            error: "Unauthorized"
          },
          401
        );
      }

      if (!env.MEDIA_BUCKET) {
        return json(
          {
            error: "Image storage is not configured."
          },
          503
        );
      }

      try {
        const form = await request.formData();

        const file = form.get("file");

        if (!(file instanceof File)) {
          return json(
            {
              error: "Please select an image."
            },
            400
          );
        }


        // ======================================
        // ONLY ALLOW IMAGES
        // ======================================
        if (
          !file.type ||
          !file.type.startsWith("image/")
        ) {
          return json(
            {
              error: "Only image files are allowed."
            },
            400
          );
        }


        // ======================================
        // MAXIMUM UPLOAD SIZE
        //
        // The new admin compresses images
        // BEFORE uploading.
        //
        // This is an additional safety limit.
        // ======================================
        const MAX_SIZE =
          8 * 1024 * 1024;

        if (file.size > MAX_SIZE) {
          return json(
            {
              error:
                "Image is too large. Please use an image below 8 MB."
            },
            413
          );
        }


        // ======================================
        // DETERMINE FILE EXTENSION
        // ======================================
        let extension = "webp";

        if (file.type === "image/jpeg") {
          extension = "jpg";
        } else if (file.type === "image/png") {
          extension = "png";
        } else if (file.type === "image/webp") {
          extension = "webp";
        } else if (file.type === "image/gif") {
          extension = "gif";
        } else {
          const originalExtension =
            file.name
              .split(".")
              .pop()
              ?.replace(/[^a-zA-Z0-9]/g, "")
              .toLowerCase();

          if (originalExtension) {
            extension = originalExtension;
          }
        }


        // ======================================
        // CREATE UNIQUE FILE NAME
        // ======================================
        const key =
          "uploads/" +
          new Date()
            .toISOString()
            .slice(0, 10) +
          "/" +
          Date.now() +
          "-" +
          crypto.randomUUID() +
          "." +
          extension;


        // ======================================
        // SAVE IMAGE INTO R2
        // ======================================
        await env.MEDIA_BUCKET.put(
          key,
          file.stream(),
          {
            httpMetadata: {
              contentType:
                file.type ||
                "application/octet-stream",

              cacheControl:
                "public, max-age=31536000, immutable"
            },

            customMetadata: {
              originalName:
                file.name || "uploaded-image"
            }
          }
        );


        // ======================================
        // RETURN IMAGE URL TO ADMIN
        // ======================================
        return json({
          ok: true,

          url:
            "/media/" +
            key,

          size:
            file.size,

          type:
            file.type
        });

      } catch (error) {
        return json(
          {
            error: "Image upload failed.",
            details: error.message
          },
          500
        );
      }
    }


    // ==========================================
    // SERVE R2 IMAGES
    // ==========================================
    if (
      url.pathname.startsWith("/media/") &&
      request.method === "GET"
    ) {
      if (!env.MEDIA_BUCKET) {
        return new Response(
          "Image storage is not configured.",
          {
            status: 503
          }
        );
      }

      try {
        const key =
          url.pathname.slice(
            "/media/".length
          );

        if (!key) {
          return new Response(
            "Image not found.",
            {
              status: 404
            }
          );
        }

        const object =
          await env.MEDIA_BUCKET.get(key);

        if (!object) {
          return new Response(
            "Image not found.",
            {
              status: 404
            }
          );
        }

        const headers =
          new Headers();

        object.writeHttpMetadata(
          headers
        );

        headers.set(
          "etag",
          object.httpEtag
        );

        headers.set(
          "cache-control",
          "public, max-age=31536000, immutable"
        );

        return new Response(
          object.body,
          {
            headers
          }
        );

      } catch (error) {
        return new Response(
          "Unable to load image.",
          {
            status: 500
          }
        );
      }
    }


    // ==========================================
    // STATIC WEBSITE
    //
    // index.html
    // admin.html
    // assets
    // images
    // etc.
    // ==========================================
    if (env.ASSETS) {
      return env.ASSETS.fetch(
        request
      );
    }


    // ==========================================
    // FALLBACK
    // ==========================================
    return new Response(
      "Not found",
      {
        status: 404
      }
    );
  }
};


// ==============================================
// ADMIN AUTHORIZATION
// ==============================================
function isAdmin(request, env) {

  if (!env.ADMIN_TOKEN) {
    return false;
  }

  const authorization =
    request.headers.get(
      "Authorization"
    ) || "";

  return (
    authorization ===
    `Bearer ${env.ADMIN_TOKEN}`
  );
}
