/** Builds display-independent statistics for an Instagram Wrapped graphic. */
export function summarizeInstagramThread(messages, { mediaCount = 0, hourlyStats = [], emojiStats = {}, senderStats = {} } = {}) {
    const messageItems = messages.filter((item) => item.type === "msg");
    const totalWords = messageItems.reduce((sum, message) => sum + (message.text || "").trim().split(/\s+/).filter(Boolean).length, 0);
    let firstTimestamp = null, lastTimestamp = null;
    for (const message of messageItems) {
        if (!Number.isFinite(message.ts)) continue;
        if (firstTimestamp == null || message.ts < firstTimestamp) firstTimestamp = message.ts;
        if (lastTimestamp == null || message.ts > lastTimestamp) lastTimestamp = message.ts;
    }
    let peakHour = 0;
    for (let hour = 1; hour < hourlyStats.length; hour += 1) {
        if ((hourlyStats[hour] || 0) > (hourlyStats[peakHour] || 0)) peakHour = hour;
    }
    return {
        messageCount: messageItems.length,
        totalWords,
        mediaCount,
        peakHour,
        firstTimestamp,
        lastTimestamp,
        topEmojis: Object.entries(emojiStats).sort((a, b) => b[1] - a[1]).slice(0, 6),
        topSenders: Object.entries(senderStats).sort((a, b) => b[1] - a[1]).slice(0, 4)
    };
}
