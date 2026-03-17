export async function sendOrUpdateDiscord(env, payload) {
  if (!env.DISCORD_WEBHOOK_URL) {
    return { messageId: payload.messageId || null, skipped: true };
  }

  const content = {
    embeds: [
      {
        title: "Mechanic Expense",
        color: statusColor(payload.status),
        fields: [
          { name: "Expense ID", value: String(payload.expenseId), inline: true },
          { name: "User", value: payload.username, inline: true },
          { name: "Amount", value: `$${Number(payload.amount).toFixed(2)}`, inline: true },
          { name: "Status", value: payload.status, inline: true },
          { name: "Category", value: payload.category || "N/A", inline: true },
          { name: "Date", value: payload.expenseDate, inline: true },
          { name: "Description", value: payload.description || "N/A", inline: false },
        ],
        timestamp: new Date().toISOString(),
      },
    ],
  };

  if (payload.messageId) {
    const editUrl = `${env.DISCORD_WEBHOOK_URL}/messages/${payload.messageId}`;
    const res = await fetch(editUrl, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(content),
    });

    if (res.ok) {
      return { messageId: payload.messageId, updated: true };
    }
  }

  const createUrl = `${env.DISCORD_WEBHOOK_URL}?wait=true`;
  const res = await fetch(createUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(content),
  });

  if (!res.ok) {
    return { messageId: payload.messageId || null, failed: true };
  }

  const data = await res.json();
  return { messageId: data.id || null, created: true };
}

function statusColor(status) {
  if (status === "approved") return 5763719;
  if (status === "rejected") return 15548997;
  if (status === "paid") return 3447003;
  return 15844367;
}
