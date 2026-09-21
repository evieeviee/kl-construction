export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // =====================================================
    // JSON RESPONSE HELPER
    // =====================================================
    const json = (data, status = 200) => {
      return new Response(JSON.stringify(data), {
        status,
        headers: {
          "content-type": "application/json; charset=UTF-8",
          "cache-control": "no-store"
        }
      });
    };


    // =====================================================
    // ADMIN LOGIN
    // =====================================================
    if (
      url.pathname === "/api/auth" &&
      request.method === "POST"
    ) {
      try {
        let token = "";

        // ---------------------------------------------
        // METHOD 1:
        // Get password from Authorization header
        //
        // Authorization: Bearer PASSWORD
        // ---------------------------------------------
        const authorization =
          request.headers.get("Authorization") || "";

        if (authorization.startsWith("Bearer ")) {
          token = authorization
            .slice(7)
            .trim();
        }


        // ---------------------------------------------
        // METHOD 2:
        // JSON body fallback
        //
        // {
        //   "password": "PASSWORD"
        // }
        // ---------------------------------------------
        if (!token) {
          try {
            const body = await request.json();

            token =
              body?.token ||
              body?.password ||
              "";
          } catch {
            // No JSON body.
          }
        }


        // ---------------------------------------------
        // Make sure ADMIN_TOKEN exists
        // ---------------------------------------------
        if (!env.ADMIN_TOKEN) {
          return json(
            {
              ok: false,
              error:
                "Admin authentication is not configured."
            },
            500
          );
        }


        // ---------------------------------------------
        // Check password
        // ---------------------------------------------
        if (
          !token ||
          token !== env.ADMIN_TOKEN
        ) {
          return json(
            {
              ok: false,
              error:
                "Incorrect password."
            },
            401
          );
        }


        // ---------------------------------------------
        // Login successful
        // ---------------------------------------------
        return json({
          ok: true,
          message:
            "Login successful."
        });

      } catch (error) {
        return json(
          {
            ok: false,
            error:
              "Unable to verify login.",
            details:
              error.message
          },
          500
        );
      }
    }


    // =====================================================
    // GET WEBSITE CONTENT
    // =====================================================
    if (
      url.pathname === "/api/content" &&
      request.method === "GET"
    ) {
      try {

        if (!env.DB) {
          return json(
            {
              error:
                "Database is not configured."
            },
            500
          );
        }


        const row =
          await env.DB
            .prepare(
              `
              SELECT value
              FROM site_content
              WHERE key = ?
              `
            )
            .bind("main")
            .first();


        // No saved content yet
        if (!row) {
          return json({
            content: null
          });
        }


        // Parse saved JSON
        let content = null;

        try {
          content =
            JSON.parse(row.value);
        } catch {
          return json(
            {
              error:
                "Saved website content is invalid."
            },
            500
          );
        }


        return json({
          content
        });

      } catch (error) {
        return json(
          {
            error:
              "Unable to load website content.",
            details:
              error.message
          },
          500
        );
      }
    }


    // =====================================================
    // SAVE / PUBLISH WEBSITE CONTENT
    // =====================================================
    if (
      url.pathname === "/api/content" &&
      request.method === "PUT"
    ) {

      // ---------------------------------------------
      // Require admin login
      // ---------------------------------------------
      if (!isAdmin(request, env)) {
        return json(
          {
            error:
              "Unauthorized"
          },
          401
        );
      }


      // ---------------------------------------------
      // Check D1
      // ---------------------------------------------
      if (!env.DB) {
        return json(
          {
            error:
              "Database is not configured."
          },
          500
        );
      }


      // ---------------------------------------------
      // Read content
      // ---------------------------------------------
      let body;

      try {
        body =
          await request.json();
      } catch {
        return json(
          {
            error:
              "Invalid content data."
          },
          400
        );
      }


      // ---------------------------------------------
      // Validate content
      // ---------------------------------------------
      if (
        !body ||
        typeof body.content !== "object" ||
        body.content === null ||
        Array.isArray(body.content)
      ) {
        return json(
          {
            error:
              "Missing website content."
          },
          400
        );
      }


      // ---------------------------------------------
      // Save into D1
      // ---------------------------------------------
      try {

        await env.DB
          .prepare(
            `
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
            `
          )
          .bind(
            "main",
            JSON.stringify(
              body.content
            )
          )
          .run();


        return json({
          ok: true,
          message:
            "Website updated successfully."
        });

      } catch (error) {
        return json(
          {
            error:
              "Unable to save website content.",
            details:
              error.message
          },
          500
        );
      }
    }


    // =====================================================
    // IMAGE UPLOAD
    // =====================================================
    if (
      url.pathname === "/api/upload" &&
      request.method === "POST"
    ) {

      // ---------------------------------------------
      // Require admin login
      // ---------------------------------------------
      if (!isAdmin(request, env)) {
        return json(
          {
            error:
              "Unauthorized"
          },
          401
        );
      }


      // ---------------------------------------------
      // Check R2 binding
      // ---------------------------------------------
      if (!env.MEDIA_BUCKET) {
        return json(
          {
            error:
              "Image storage is not configured."
          },
          503
        );
      }


      try {

        // -------------------------------------------
        // Read uploaded image
        // -------------------------------------------
        const form =
          await request.formData();

        const file =
          form.get("file");


        // -------------------------------------------
        // Make sure file exists
        // -------------------------------------------
        if (!(file instanceof File)) {
          return json(
            {
              error:
                "Please select an image."
            },
            400
          );
        }


        // -------------------------------------------
        // Only allow images
        // -------------------------------------------
        if (
          !file.type ||
          !file.type.startsWith("image/")
        ) {
          return json(
            {
              error:
                "Only image files are allowed."
            },
            400
          );
        }


        // -------------------------------------------
        // Safety limit: 8 MB
        //
        // admin.html already compresses the image
        // BEFORE sending it here.
        //
        // This is just an additional protection.
        // -------------------------------------------
        const MAX_SIZE =
          8 * 1024 * 1024;

        if (file.size > MAX_SIZE) {
          return json(
            {
              error:
                "Image is too large. Maximum upload size is 8 MB."
            },
            413
          );
        }


        // -------------------------------------------
        // Determine extension
        // -------------------------------------------
        let extension = "webp";

        if (
          file.type === "image/jpeg"
        ) {
          extension = "jpg";
        }

        else if (
          file.type === "image/png"
        ) {
          extension = "png";
        }

        else if (
          file.type === "image/webp"
        ) {
          extension = "webp";
        }

        else if (
          file.type === "image/gif"
        ) {
          extension = "gif";
        }

        else {
          const originalExtension =
            file.name
              ?.split(".")
              .pop()
              ?.replace(
                /[^a-zA-Z0-9]/g,
                ""
              )
              .toLowerCase();

          if (originalExtension) {
            extension =
              originalExtension;
          }
        }


        // -------------------------------------------
        // Create unique R2 filename
        //
        // Example:
        //
        // uploads/2026-09-21/123456-uuid.webp
        // -------------------------------------------
        const date =
          new Date()
            .toISOString()
            .slice(0, 10);

        const key =
          "uploads/" +
          date +
          "/" +
          Date.now() +
          "-" +
          crypto.randomUUID() +
          "." +
          extension;


        // -------------------------------------------
        // Upload to R2
        // -------------------------------------------
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
                file.name ||
                "uploaded-image"
            }
          }
        );


        // -------------------------------------------
        // Return image URL
        // -------------------------------------------
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
            error:
              "Image upload failed.",
            details:
              error.message
          },
          500
        );
      }
    }


    // =====================================================
    // SERVE IMAGES FROM R2
    // =====================================================
    if (
      url.pathname.startsWith("/media/") &&
      request.method === "GET"
    ) {

      // ---------------------------------------------
      // Check R2
      // ---------------------------------------------
      if (!env.MEDIA_BUCKET) {
        return new Response(
          "Image storage is not configured.",
          {
            status: 503
          }
        );
      }


      try {

        // -------------------------------------------
        // Get R2 key
        // -------------------------------------------
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


        // -------------------------------------------
        // Get image from R2
        // -------------------------------------------
        const object =
          await env.MEDIA_BUCKET.get(
            key
          );


        if (!object) {
          return new Response(
            "Image not found.",
            {
              status: 404
            }
          );
        }


        // -------------------------------------------
        // Image headers
        // -------------------------------------------
        const headers =
          new Headers();

        object.writeHttpMetadata(
          headers
        );


        if (object.httpEtag) {
          headers.set(
            "etag",
            object.httpEtag
          );
        }


        headers.set(
          "cache-control",
          "public, max-age=31536000, immutable"
        );


        // -------------------------------------------
        // Return image
        // -------------------------------------------
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


    // =====================================================
    // STATIC WEBSITE
    // =====================================================
    //
    // Handles:
    //
    // /
    // index.html
    // admin.html
    // assets
    // CSS
    // JS
    // existing website images
    //
    // =====================================================
    if (env.ASSETS) {
      return env.ASSETS.fetch(
        request
      );
    }


    // =====================================================
    // FALLBACK
    // =====================================================
    return new Response(
      "Not found",
      {
        status: 404
      }
    );
  }
};


// =========================================================
// ADMIN AUTHORIZATION CHECK
// =========================================================
function isAdmin(request, env) {

  // ADMIN_TOKEN must exist
  if (!env.ADMIN_TOKEN) {
    return false;
  }


  // Get Authorization header
  const authorization =
    request.headers.get(
      "Authorization"
    ) || "";


  // Expected:
  //
  // Authorization: Bearer PASSWORD
  //
  const expected =
    `Bearer ${env.ADMIN_TOKEN}`;


  return (
    authorization === expected
  );
}
