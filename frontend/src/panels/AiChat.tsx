import { useState } from "react";

const API_URL = import.meta.env.VITE_BACKEND_API_URL ?? "http://localhost:8000";

type Exchange = { question: string; answer: string };

export function AiChat() {
  const [question, setQuestion] = useState("");
  const [exchanges, setExchanges] = useState<Exchange[]>([]);

  async function handleSend() {
    if (!question.trim()) return;
    const askedQuestion = question;
    setQuestion("");
    const response = await fetch(`${API_URL}/ai/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question: askedQuestion }),
    });
    const data = await response.json();
    setExchanges((prev) => [...prev, { question: askedQuestion, answer: data.answer }]);
  }

  return (
    <div>
      <div style={{ maxHeight: 220, overflowY: "auto" }}>
        {exchanges.map((exchange, i) => (
          <div key={i} style={{ marginBottom: 8, fontSize: 12 }}>
            <div style={{ color: "#6b7280" }}>{exchange.question}</div>
            <div>{exchange.answer}</div>
          </div>
        ))}
      </div>
      <label htmlFor="ai-chat-question">Ask a question</label>
      <input
        id="ai-chat-question"
        value={question}
        onChange={(e) => setQuestion(e.target.value)}
      />
      <button type="button" onClick={handleSend}>Send</button>
    </div>
  );
}
