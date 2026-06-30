import * as fs from "node:fs";

export async function refreshYoutubeAccessToken(
  clientId: string,
  clientSecret: string,
  refreshToken: string,
): Promise<string> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }).toString(),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Token refresh failed (${res.status}): ${err}`);
  }
  const data = (await res.json()) as { access_token?: string; error?: string };
  if (!data.access_token) throw new Error(data.error ?? "No access token returned");
  return data.access_token;
}

export async function uploadVideoToYoutube(
  filePath: string,
  accessToken: string,
  title: string,
  onProgress: (pct: number) => void,
): Promise<string> {
  const fileSize = fs.statSync(filePath).size;

  // Initialize resumable upload session
  const initRes = await fetch(
    "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        "X-Upload-Content-Type": "video/mp4",
        "X-Upload-Content-Length": String(fileSize),
      },
      body: JSON.stringify({
        snippet: {
          title,
          description: "Recorded with SonicPlank.Maker",
          categoryId: "20",
        },
        status: { privacyStatus: "private" },
      }),
    },
  );
  if (!initRes.ok) {
    const body = await initRes.text();
    throw new Error(`Upload init failed (${initRes.status}): ${body}`);
  }
  const uploadUrl = initRes.headers.get("Location");
  if (!uploadUrl) throw new Error("No resumable upload URL returned");

  // Upload in 8 MB chunks with Content-Range
  const CHUNK = 8 * 1024 * 1024;
  const fd = fs.openSync(filePath, "r");
  let sent = 0;
  try {
    while (sent < fileSize) {
      const end = Math.min(sent + CHUNK, fileSize);
      const buf = Buffer.allocUnsafe(end - sent);
      fs.readSync(fd, buf, 0, buf.length, sent);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const chunkRes = await (fetch as any)(uploadUrl, {
        method: "PUT",
        headers: {
          "Content-Length": String(buf.length),
          "Content-Range": `bytes ${sent}-${end - 1}/${fileSize}`,
          "Content-Type": "video/mp4",
        },
        body: buf,
        duplex: "half",
      });

      if (chunkRes.status === 308) {
        sent = end;
        onProgress(Math.round((sent / fileSize) * 100));
      } else if (chunkRes.status === 200 || chunkRes.status === 201) {
        const data = (await chunkRes.json()) as { id?: string };
        if (!data.id) throw new Error("No video ID in upload response");
        onProgress(100);
        return `https://www.youtube.com/watch?v=${data.id}`;
      } else {
        const body = await chunkRes.text();
        throw new Error(`Chunk upload failed (${chunkRes.status}): ${body}`);
      }
    }
  } finally {
    fs.closeSync(fd);
  }
  throw new Error("Upload loop ended without receiving a video ID");
}
