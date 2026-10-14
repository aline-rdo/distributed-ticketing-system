// Each service keeps its HTTP helper locally so it can be built independently.
export async function postJson(url, data, timeoutMs = 20000) {
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } catch (cause) {
    const error = new Error(`Request to ${url} failed`, { cause });
    error.status = 502;
    throw error;
  }
}

export async function reportEvent(type, data) {
  const analyticsUrl = process.env.ANALYTICS_SERVICE_URL || "http://localhost:8003";
  try {
    await postJson(`${analyticsUrl}/events`, { type, data }, 2000);
  } catch (error) {
    console.error("Analytics reporting failed:", error.message);
  }
}
